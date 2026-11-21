'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const childProcess = require('node:child_process');

const { readState } = require('../src/t3-state');
const { PresenceBridge, buildActivity } = require('../src/presence');
const { loadConfig, defaultConfigPath, validateConfig } = require('../src/config');

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.exit(0);
} else {
  app.on('second-instance', (_event, argv) => {
    if (argv.includes('--hidden')) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

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
      checked: loginItemEnabled(),
      click: (item) => {
        setLoginItemEnabled(item.checked);
        updateTrayMenu();
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
  return nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=');
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

    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
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
  pollTimer = setInterval(pollCycle, config?.pollIntervalMs || 500);
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
    } else if (msg.includes('Failed to set presence')) {
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

function loginItemEnabled() {
  if (process.platform === 'win32') {
    try {
      const out = childProcess.execFileSync(
        'reg',
        ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'T3CodeDiscordRpc'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      );
      return out.includes('REG_SZ');
    } catch {
      return false;
    }
  }
  return app.getLoginItemSettings().openAtLogin;
}

function setLoginItemEnabled(enabled) {
  if (process.platform === 'win32') {
    try {
      if (enabled) {
        const cmd = `"${process.execPath}" --hidden`;
        childProcess.execFileSync(
          'reg',
          ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'T3CodeDiscordRpc', '/t', 'REG_SZ', '/d', cmd, '/f'],
          { stdio: ['ignore', 'ignore', 'ignore'] }
        );
      } else {
        childProcess.execFileSync(
          'reg',
          ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'T3CodeDiscordRpc', '/f'],
          { stdio: ['ignore', 'ignore', 'ignore'] }
        );
      }
    } catch (err) {
      addLog(`Failed to update registry login item: ${err.message}`);
    }
  }

  if (process.platform !== 'win32') {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), args: ['--hidden'] });
  }
  return loginItemEnabled();
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

  ipcMain.handle('save-config', async (_event, cfg) => {
    try {
      const previousClientId = config?.clientId;
      const previousPipeId = config?.pipeId;
      validateConfig(cfg);
      const confPath = defaultConfigPath();
      fs.mkdirSync(path.dirname(confPath), { recursive: true });
      fs.writeFileSync(confPath, JSON.stringify(cfg, null, 2), 'utf8');
      config = loadConfig(confPath);
      startPolling();
      addLog(`Saved configuration to ${confPath}`);

      if (isRunning && bridge) {
        if (config.clientId !== previousClientId || config.pipeId !== previousPipeId) {
          await stopBridge();
          await startBridge();
        } else {
          bridge.config = config;
        }
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

  ipcMain.handle('get-login-item', () => ({ openAtLogin: loginItemEnabled() }));
  ipcMain.handle('set-login-item', (_event, enabled) => {
    const result = setLoginItemEnabled(enabled);
    addLog(`Login item set to: ${result}`);
    updateTrayMenu();
    return { openAtLogin: result };
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
}

if (gotTheLock) {
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
    void startBridge();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  });
}

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
