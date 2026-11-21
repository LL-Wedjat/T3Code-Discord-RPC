'use strict';

// Helpers
function formatDuration(ms) {
  if (typeof ms !== 'number' || isNaN(ms) || ms < 0) {
    return '00:00:00';
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0')
  ].join(':');
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', () => {
  const api = window.api;

  // Header indicators
  const statusPill = document.getElementById('statusPill');
  const connectionBadge = document.getElementById('connectionBadge');

  // Overview Now Showing
  const activityState = document.getElementById('activityState');
  const activityDetails = document.getElementById('activityDetails');
  const elapsed = document.getElementById('elapsed');

  // Overview Live Threads
  const threadList = document.getElementById('threadList');

  // Overview Controls
  const btnStart = document.getElementById('btnStart');
  const btnStop = document.getElementById('btnStop');
  const btnPickState = document.getElementById('btnPickState');

  // Overview Config Summary
  const configSummary = document.getElementById('configSummary');

  // Settings
  const settingsForm = document.getElementById('settingsForm');
  const saveStatus = document.getElementById('saveStatus');

  // Logs & Footer
  const logView = document.getElementById('logView');
  const linkRepo = document.getElementById('linkRepo');

  // Navigation tabs
  const navBtns = document.querySelectorAll('.sidebar-nav .nav-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  navBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      navBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      tabPanes.forEach((pane) => {
        if (pane.id === `tab-${targetTab}`) {
          pane.hidden = false;
          pane.classList.add('active');
        } else {
          pane.hidden = true;
          pane.classList.remove('active');
        }
      });
    });
  });

  // Elapsed timer tracking
  let currentStartTimestamp = null;
  function updateElapsed() {
    if (!currentStartTimestamp) {
      if (elapsed) elapsed.textContent = '00:00:00';
      return;
    }
    const ms = Date.now() - currentStartTimestamp * 1000;
    if (elapsed) {
      elapsed.textContent = formatDuration(ms);
    }
  }
  setInterval(updateElapsed, 1000);

  // Status Pill styling update
  function updateStatusPill(statusText) {
    if (!statusPill) return;
    const raw = (statusText || 'idle').toLowerCase();
    statusPill.textContent = raw.charAt(0).toUpperCase() + raw.slice(1);

    // Reset base classes
    statusPill.className = 'status-pill';
    if (raw === 'working') {
      statusPill.classList.add('ok', 'status-working');
    } else if (raw === 'orchestrating') {
      statusPill.classList.add('info', 'status-orchestrating');
    } else if (raw === 'needs-input') {
      statusPill.classList.add('warn', 'status-needs-input');
    } else {
      statusPill.classList.add('muted', 'status-idle');
    }
  }

  // Connection Badge update
  function updateConnectionBadge(connected) {
    if (!connectionBadge) return;
    connectionBadge.className = 'connection-badge';
    if (connected) {
      connectionBadge.textContent = 'Connected';
      connectionBadge.classList.add('status-connected', 'ok');
    } else {
      connectionBadge.textContent = 'Disconnected';
      connectionBadge.classList.add('status-disconnected', 'muted');
    }
  }

  // Config Summary render
  function renderConfigSummary(cfg) {
    if (!configSummary) return;
    if (!cfg) {
      configSummary.innerHTML = '<p class="placeholder-text">No configuration loaded.</p>';
      return;
    }
    configSummary.innerHTML = `
      <div class="summary-item"><span class="summary-label">Client ID:</span> <span class="summary-val">${escapeHtml(cfg.clientId || 'Not configured')}</span></div>
      <div class="summary-item"><span class="summary-label">Pipe ID:</span> <span class="summary-val">${escapeHtml(cfg.pipeId ?? 0)}</span></div>
      <div class="summary-item"><span class="summary-label">Poll Interval:</span> <span class="summary-val">${escapeHtml(cfg.pollIntervalMs ?? 500)} ms</span></div>
    `;
  }

  // Populate settings form inputs from config
  function populateSettingsForm(cfg) {
    if (!settingsForm || !cfg) return;
    const elements = settingsForm.elements;

    if (elements.clientId) elements.clientId.value = cfg.clientId || '';
    if (elements.pipeId) elements.pipeId.value = cfg.pipeId !== undefined ? cfg.pipeId : 0;
    if (elements.stateFile) elements.stateFile.value = cfg.stateFile || '';
    if (elements.pollIntervalMs) elements.pollIntervalMs.value = cfg.pollIntervalMs !== undefined ? cfg.pollIntervalMs : 500;
    if (elements.activityName) elements.activityName.value = cfg.activityName || '';
    if (elements.largeImageKey) elements.largeImageKey.value = cfg.largeImageKey || '';
    if (elements.smallImageKey) elements.smallImageKey.value = cfg.smallImageKey || '';
    if (elements.largeImageText) elements.largeImageText.value = cfg.largeImageText || '';
    if (elements.smallImageText) elements.smallImageText.value = cfg.smallImageText || '';
    if (elements.workingMessage) elements.workingMessage.value = cfg.workingMessage || '';
    if (elements.idleMessage) elements.idleMessage.value = cfg.idleMessage || '';

    if (elements.buttons) {
      elements.buttons.value = JSON.stringify(cfg.buttons || [], null, 2);
    }

    if (elements.showProject) elements.showProject.checked = Boolean(cfg.showProject);
    if (elements.showModel) elements.showModel.checked = Boolean(cfg.showModel);
    if (elements.clearWhenNoThread) elements.clearWhenNoThread.checked = Boolean(cfg.clearWhenNoThread);
    if (elements.debug) elements.debug.checked = Boolean(cfg.debug);
  }

  // Render threads list
  function renderThreadList(threads) {
    if (!threadList) return;
    if (!Array.isArray(threads) || threads.length === 0) {
      threadList.innerHTML = '<p class="placeholder-text">No active threads detected.</p>';
      return;
    }

    const html = threads.map((thread) => {
      const title = escapeHtml(thread.title || 'Untitled Thread');
      const project = escapeHtml(thread.project || 'No project');
      const status = escapeHtml(thread.status || 'idle');
      const statusClass = status.toLowerCase();
      const agentCount = Number(thread.activeSubagentCount) || 0;
      const agentBadge = agentCount > 0
        ? `<span class="agent-count-badge">${agentCount} ${agentCount === 1 ? 'agent' : 'agents'}</span>`
        : '';

      return `
        <div class="thread-row">
          <div class="thread-main">
            <span class="thread-title">${title}</span>
            <span class="thread-project">${project}</span>
          </div>
          <div class="thread-meta">
            ${agentBadge}
            <span class="status-badge ${statusClass}">${status}</span>
          </div>
        </div>
      `;
    }).join('');

    threadList.innerHTML = html;
  }

  // State update handler
  function handleState(data) {
    if (!data) return;
    const { snapshot, activity } = data;

    // Status pill
    if (snapshot && snapshot.status) {
      updateStatusPill(snapshot.status);
    } else if (snapshot) {
      updateStatusPill('idle');
    }

    // Activity State & Details
    if (activity) {
      if (activityState) activityState.textContent = activity.state || 'Idle';
      if (activityDetails) activityDetails.textContent = activity.details || 'Waiting for activity...';

      if (activity.startTimestamp) {
        currentStartTimestamp = activity.startTimestamp;
        updateElapsed();
      } else {
        currentStartTimestamp = null;
        if (elapsed) elapsed.textContent = '00:00:00';
      }
    } else {
      if (activityState) activityState.textContent = 'Idle';
      if (activityDetails) activityDetails.textContent = 'Waiting for activity...';
      currentStartTimestamp = null;
      if (elapsed) elapsed.textContent = '00:00:00';
    }

    // Thread list
    if (snapshot && Array.isArray(snapshot.workingThreads)) {
      renderThreadList(snapshot.workingThreads);
    } else {
      renderThreadList([]);
    }
  }

  // Logging
  const logs = [];
  function appendLog(line) {
    if (!line) return;
    const timestamp = new Date().toLocaleTimeString();
    logs.push(`[${timestamp}] ${line}`);
    if (logs.length > 200) {
      logs.shift();
    }
    if (logView) {
      logView.textContent = logs.join('\n');
      logView.scrollTop = logView.scrollHeight;
    }
  }

  // Subscribe to api events
  if (api && typeof api.onState === 'function') {
    api.onState((data) => {
      handleState(data);
    });
  }

  if (api && typeof api.onConnection === 'function') {
    api.onConnection(({ connected }) => {
      updateConnectionBadge(connected);
    });
  }

  if (api && typeof api.onLog === 'function') {
    api.onLog((line) => {
      appendLog(line);
    });
  }

  // Button actions
  if (btnStart && api && typeof api.start === 'function') {
    btnStart.addEventListener('click', async () => {
      try {
        await api.start();
      } catch (err) {
        appendLog(`Start error: ${err.message}`);
      }
    });
  }

  if (btnStop && api && typeof api.stop === 'function') {
    btnStop.addEventListener('click', async () => {
      try {
        await api.stop();
      } catch (err) {
        appendLog(`Stop error: ${err.message}`);
      }
    });
  }

  if (btnPickState && api && typeof api.pickStateFile === 'function') {
    btnPickState.addEventListener('click', async () => {
      try {
        const filePath = await api.pickStateFile();
        if (filePath && settingsForm && settingsForm.elements.stateFile) {
          settingsForm.elements.stateFile.value = filePath;
        }
      } catch (err) {
        appendLog(`Pick state file error: ${err.message}`);
      }
    });
  }

  // Settings form submission
  async function handleSettingsSubmit(event) {
    if (event) event.preventDefault();
    if (!settingsForm || !api || typeof api.saveConfig !== 'function') return;

    if (saveStatus) {
      saveStatus.textContent = 'Saving...';
      saveStatus.style.color = 'var(--muted)';
    }

    try {
      const formData = new FormData(settingsForm);
      const cfg = {};

      const clientId = formData.get('clientId');
      if (clientId !== null) cfg.clientId = clientId.toString().trim();

      const pipeId = formData.get('pipeId');
      if (pipeId !== null && pipeId.toString().trim() !== '') {
        cfg.pipeId = parseInt(pipeId.toString(), 10);
      }

      const stateFile = formData.get('stateFile');
      if (stateFile !== null) cfg.stateFile = stateFile.toString().trim();

      const pollIntervalMs = formData.get('pollIntervalMs');
      if (pollIntervalMs !== null && pollIntervalMs.toString().trim() !== '') {
        cfg.pollIntervalMs = parseInt(pollIntervalMs.toString(), 10);
      }

      const activityName = formData.get('activityName');
      if (activityName !== null) cfg.activityName = activityName.toString().trim();

      const largeImageKey = formData.get('largeImageKey');
      if (largeImageKey !== null) cfg.largeImageKey = largeImageKey.toString().trim();

      const smallImageKey = formData.get('smallImageKey');
      if (smallImageKey !== null) cfg.smallImageKey = smallImageKey.toString().trim();

      const largeImageText = formData.get('largeImageText');
      if (largeImageText !== null) cfg.largeImageText = largeImageText.toString().trim();

      const smallImageText = formData.get('smallImageText');
      if (smallImageText !== null) cfg.smallImageText = smallImageText.toString().trim();

      const workingMessage = formData.get('workingMessage');
      if (workingMessage !== null) cfg.workingMessage = workingMessage.toString().trim();

      const idleMessage = formData.get('idleMessage');
      if (idleMessage !== null) cfg.idleMessage = idleMessage.toString().trim();

      // Checkboxes: FormData only contains checked checkboxes
      cfg.showProject = formData.get('showProject') !== null;
      cfg.showModel = formData.get('showModel') !== null;
      cfg.clearWhenNoThread = formData.get('clearWhenNoThread') !== null;
      cfg.debug = formData.get('debug') !== null;

      // Buttons JSON
      const rawButtons = formData.get('buttons');
      if (rawButtons && rawButtons.toString().trim()) {
        try {
          cfg.buttons = JSON.parse(rawButtons.toString().trim());
        } catch (jsonErr) {
          if (saveStatus) {
            saveStatus.textContent = `Error in Buttons JSON: ${jsonErr.message}`;
            saveStatus.style.color = 'var(--warn)';
          }
          return;
        }
      } else {
        cfg.buttons = [];
      }

      await api.saveConfig(cfg);
      renderConfigSummary(cfg);
      if (saveStatus) {
        saveStatus.textContent = 'Settings saved successfully!';
        saveStatus.style.color = 'var(--ok)';
        setTimeout(() => {
          if (saveStatus.textContent === 'Settings saved successfully!') {
            saveStatus.textContent = '';
          }
        }, 3000);
      }
    } catch (err) {
      if (saveStatus) {
        saveStatus.textContent = `Save failed: ${err.message}`;
        saveStatus.style.color = 'var(--warn)';
      }
    }
  }

  if (settingsForm) {
    settingsForm.addEventListener('submit', handleSettingsSubmit);
  }
  const btnSaveSettings = document.getElementById('btnSaveSettings');
  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', handleSettingsSubmit);
  }

  // External repository link
  if (linkRepo && api && typeof api.openExternal === 'function') {
    linkRepo.addEventListener('click', (event) => {
      event.preventDefault();
      const href = linkRepo.getAttribute('href');
      if (href) {
        api.openExternal(href);
      }
    });
  }

  // Initial Load
  if (api) {
    const promises = [
      typeof api.getStatus === 'function' ? api.getStatus().catch(() => null) : Promise.resolve(null),
      typeof api.getConfig === 'function' ? api.getConfig().catch(() => null) : Promise.resolve(null),
      typeof api.getLogs === 'function' ? api.getLogs().catch(() => []) : Promise.resolve([])
    ];

    Promise.all(promises).then(([status, config, initialLogs]) => {
      if (config) {
        populateSettingsForm(config);
        renderConfigSummary(config);
      }
      if (status) {
        handleState(status);
        if (typeof status.connected === 'boolean') {
          updateConnectionBadge(status.connected);
        }
      }
      if (Array.isArray(initialLogs)) {
        initialLogs.forEach((l) => appendLog(l));
      }
    }).catch((err) => {
      appendLog(`Initial load error: ${err.message}`);
    });
  }
});
