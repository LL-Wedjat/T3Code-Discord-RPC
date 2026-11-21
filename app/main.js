'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const { readState } = require('../src/t3-state');
const { PresenceBridge, buildActivity } = require('../src/presence');
const { loadConfig, defaultConfigPath, validateConfig } = require('../src/config');

let mainWindow = null;
let tray = null;
let bridge = null;
let pollTimer = null;
let isRunning = false;
let isConnected = false;
let config = null;
let latestSnapshot = null;
let latestActivity = null;

const logs = [];
const MAX_LOGS = 200;

function addLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  logs.push(line);
  if (logs.length > MAX_LOGS) {
    logs.shift();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', line);
  }
}

function updateConnection(status) {
  isConnected = Boolean(status);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('connection', { connected: isConnected });
  }
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: mainWindow && mainWindow.isVisible() ? 'Hide' : 'Show',
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
        updateTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: isRunning ? 'Stop' : 'Start',
      click: () => {
        if (isRunning) {
          stopBridge();
        } else {
          startBridge();
        }
      },
    },
    {
      type: 'checkbox',
      label: 'Start with Windows',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function createTrayIcon() {
  // 16x16 transparent PNG icon fallback if no icon file exists
  const iconBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAzSURBVDhPY/wPBAwUACZcDCmAiTGgoRjA+P//fyYqGvD//38GvAZgmhpGyBhYQDAwAABnKRLzB5U3ZgAAAABJRU5ErkJggg==';
  const img = nativeImage.createFromBuffer(Buffer.from(iconBase64, 'base64'));
  return img;
}

function setupTray() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : createTrayIcon();

  tray = new Tray(icon);
  tray.setToolTip('T3 Code Discord RPC');
  updateTrayMenu();

  tray.on('double-click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
    updateTrayMenu();
  });
}

function pollCycle() {
  if (!config) return;
  try {
    const snapshot = readState(config.stateFile);
    latestSnapshot = snapshot;
    latestActivity = buildActivity(config, snapshot);

    if (isRunning && bridge) {
      bridge.update(snapshot);
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('state', {
        snapshot: latestSnapshot,
        activity: latestActivity,
        running: isRunning,
      });
    }
  } catch (err) {
    addLog(`Error during poll cycle: ${err.message}`);
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollCycle();
  pollTimer = setInterval(pollCycle, 500);
}

async function startBridge() {
  if (isRunning) return;
  if (!config?.clientId) {
    addLog('Cannot start bridge: clientId is not configured');
    return;
  }

  isRunning = true;
  updateTrayMenu();
  addLog('Starting Discord RPC bridge...');

  const customLogger = (msg) => {
    addLog(msg);
    if (msg.includes('Connected to Discord RPC') || msg.includes('Discord RPC login OK')) {
      updateConnection(true);
    } else if (msg.includes('Discord RPC disconnected') || msg.includes('Discord RPC unavailable')) {
      updateConnection(false);
    }
  };

  try {
    bridge = new PresenceBridge(config, customLogger);
    await bridge.connect();
    if (bridge.connected) {
      updateConnection(true);
    }
  } catch (err) {
    addLog(`Bridge connection failed: ${err.message}`);
    updateConnection(false);
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state', {
      snapshot: latestSnapshot,
      activity: latestActivity,
      running: isRunning,
    });
  }
}

async function stopBridge() {
  if (!isRunning && !bridge) return;
  isRunning = false;
  updateConnection(false);
  updateTrayMenu();
  addLog('Stopping Discord RPC bridge...');

  if (bridge) {
    const currentBridge = bridge;
    bridge = null;
    try {
      await currentBridge.stop();
    } catch (err) {
      addLog(`Error stopping bridge: ${err.message}`);
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state', {
      snapshot: latestSnapshot,
      activity: latestActivity,
      running: isRunning,
    });
  }
}

function setupIpc() {
  ipcMain.handle('get-status', () => {
    return {
      snapshot: latestSnapshot,
      activity: latestActivity,
      config,
      running: isRunning,
      connected: isConnected,
    };
  });

  ipcMain.handle('get-config', () => {
    return config;
  });

  ipcMain.handle('save-config', (_event, cfg) => {
    try {
      validateConfig(cfg);
      const confPath = defaultConfigPath();
      fs.mkdirSync(path.dirname(confPath), { recursive: true });
      fs.writeFileSync(confPath, JSON.stringify(cfg, null, 2), 'utf8');
      config = loadConfig(confPath);
      addLog(`Saved configuration to ${confPath}`);

      if (isRunning && bridge) {
        bridge.config = config;
      }

      return { ok: true };
    } catch (err) {
      addLog(`Failed to save configuration: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('start', async () => {
    await startBridge();
    return { ok: true, running: isRunning };
  });

  ipcMain.handle('stop', async () => {
    await stopBridge();
    return { ok: true, running: isRunning };
  });

  ipcMain.handle('get-logs', () => {
    return logs;
  });

  ipcMain.handle('open-external', async (_event, url) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
      await shell.openExternal(url);
    }
  });

  ipcMain.handle('pick-state-file', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Select T3 Code State Database',
      properties: ['openFile'],
      filters: [
        { name: 'SQLite Database', extensions: ['sqlite', 'db'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (!res.canceled && res.filePaths.length > 0) {
      return res.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('capture', async (_event, filePath) => {
    if (!mainWindow) return false;
    const img = await mainWindow.webContents.capturePage();
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
    fs.writeFileSync(filePath, img.toPNG());
    return true;
  });

  ipcMain.handle('get-login-item', () => ({ openAtLogin: app.getLoginItemSettings().openAtLogin }));
  ipcMain.handle('set-login-item', (_event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), args: ['--hidden'] });
    return { openAtLogin: app.getLoginItemSettings().openAtLogin };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  if (!process.argv.includes('--hidden')) {
    mainWindow.show();
    mainWindow.focus();
  }

  mainWindow.on('close', (event) => {
    if (process.platform === 'win32' && !app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      updateTrayMenu();
    }
  });

  mainWindow.on('show', () => {
    updateTrayMenu();
  });

  mainWindow.on('hide', () => {
    updateTrayMenu();
  });

  const screenshotArgIdx = process.argv.indexOf('--screenshot');
  if (screenshotArgIdx !== -1) {
    const nextArg = process.argv[screenshotArgIdx + 1];
    const targetPath = nextArg && !nextArg.startsWith('--') ? nextArg : 'app-screenshot.png';

    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const tabArg = process.argv.find((a) => a.startsWith('--tab='));
          if (tabArg) {
            const tab = tabArg.slice(6);
            await mainWindow.webContents.executeJavaScript('document.querySelector(\'.nav-btn[data-tab=\"' + tab + '\"]\')?.click()');
            await new Promise((r) => setTimeout(r, 300));
          }
          if (process.argv.includes('--scroll-bottom')) {
            await mainWindow.webContents.executeJavaScript("const m = document.querySelector('.app-main'); if (m) m.scrollTop = m.scrollHeight;");
            await new Promise((r) => setTimeout(r, 300));
          }
          const img = await mainWindow.webContents.capturePage();
          const resolvedPath = path.resolve(targetPath);
          fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
          fs.writeFileSync(resolvedPath, img.toPNG());
          addLog(`Screenshot saved to ${resolvedPath}`);
        } catch (err) {
          console.error('Screenshot capture failed:', err);
        } finally {
          app.isQuitting = true;
          app.quit();
        }
      }, 1200);
    });
  }
}

app.whenReady().then(() => {
  try {
    const confPath = defaultConfigPath();
    config = loadConfig(confPath);
  } catch (err) {
    addLog(`Config load warning: ${err.message}`);
    config = loadConfig('');
  }

  setupIpc();
  setupTray();
  createWindow();
  startPolling();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'win32') {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (bridge) {
    void bridge.stop();
  }
});
