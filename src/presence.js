'use strict';

const { Client } = require('@xhayper/discord-rpc');

const MIN_SEND_INTERVAL_MS = 0;
const DURATION_THROTTLE_MS = 5000;
const ROLLING_WINDOW_MS = 20000;
const ROLLING_MAX_WRITES = 4;
const MAX_RECONNECT_DELAY_MS = 60000;

function truncate(value, maxBytes) {
  const text = String(value ?? '');
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return text;
  }
  const ellipsis = '…';
  const ellipsisBytes = Buffer.byteLength(ellipsis, 'utf8'); // 3 bytes
  const targetBytes = maxBytes - ellipsisBytes;
  if (targetBytes <= 0) {
    // If not even enough room for ellipsis, slice raw bytes
    const buf = Buffer.from(text, 'utf8');
    return buf.subarray(0, maxBytes).toString('utf8');
  }

  // Slice code points until byteLength fits within targetBytes
  let end = text.length;
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > targetBytes) {
    end -= 1;
  }
  if (end > 0 && end < text.length) {
    const codeBefore = text.charCodeAt(end - 1);
    const codeAt = text.charCodeAt(end);
    if (codeBefore >= 0xd800 && codeBefore <= 0xdbff && codeAt >= 0xdc00 && codeAt <= 0xdfff) {
      end -= 1;
    }
  }
  return `${text.slice(0, end)}${ellipsis}`;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function buildActivity(config, snapshot) {
  if (!snapshot.available) return null;
  const thread = snapshot.active;
  const working = Array.isArray(snapshot.workingThreads) ? snapshot.workingThreads : [];

  if (!thread && working.length === 0) {
    if (!config.clearWhenNoThread) {
      return {
        name: config.activityName,
        state: 'No active thread',
        details: 'T3 Code',
      };
    }
    return null;
  }

  let detailsThread = thread;
  let state;

  if (working.length >= 2) {
    const isFocusedWorking = Boolean(
      thread && (thread.status === 'working' || thread.status === 'orchestrating' || working.some((t) => t.threadId === thread.threadId))
    );
    if (isFocusedWorking) {
      detailsThread = thread;
    } else {
      const longestRunning = [...working].sort((a, b) => {
        const aStart = typeof a.episodeStartMs === 'number' && a.episodeStartMs > 0
          ? a.episodeStartMs
          : (typeof a.activityStartMs === 'number' && a.activityStartMs > 0 ? a.activityStartMs : Infinity);
        const bStart = typeof b.episodeStartMs === 'number' && b.episodeStartMs > 0
          ? b.episodeStartMs
          : (typeof b.activityStartMs === 'number' && b.activityStartMs > 0 ? b.activityStartMs : Infinity);
        return aStart - bStart;
      })[0] || working[0];
      detailsThread = longestRunning;
    }

    const now = Date.now();
    const validStarts = working
      .map((t) => (typeof t.episodeStartMs === 'number' && t.episodeStartMs > 0 ? t.episodeStartMs : t.activityStartMs))
      .filter((ms) => typeof ms === 'number' && ms > 0);
    const minStart = validStarts.length > 0 ? Math.min(...validStarts) : now;
    const combinedActiveMs = Math.max(0, now - minStart);
    const duration = formatDuration(combinedActiveMs);

    const totalSubagents = working.reduce((sum, t) => sum + Math.max(0, Number(t.activeSubagentCount) || 0), 0);
    if (totalSubagents > 0) {
      const agentWord = totalSubagents === 1 ? 'agent' : 'agents';
      const threadWord = working.length === 1 ? 'thread' : 'threads';
      state = `${totalSubagents} ${agentWord} · ${working.length} ${threadWord} · ${duration}`;
    } else {
      state = `${config.workingMessage} ${duration} across ${working.length} threads`;
    }
  } else if (working.length === 1) {
    detailsThread = working[0];
    const isRedundantProject =
      !detailsThread.project ||
      detailsThread.project === 'No project' ||
      detailsThread.project === detailsThread.title;

    const effectiveStartMs =
      typeof detailsThread.episodeStartMs === 'number' && detailsThread.episodeStartMs > 0
        ? detailsThread.episodeStartMs
        : detailsThread.activityStartMs;

    const isOrchestrating =
      detailsThread.status === 'orchestrating' ||
      (Number(detailsThread.activeSubagentCount) > 0 && !detailsThread.busy);

    if (isOrchestrating) {
      const count = detailsThread.activeSubagentCount || 1;
      const duration = typeof effectiveStartMs === 'number' && effectiveStartMs > 0
        ? formatDuration(Date.now() - effectiveStartMs)
        : '0s';
      state = `Orchestrating ${count} ${count === 1 ? 'agent' : 'agents'} · ${duration}`;
    } else if (typeof effectiveStartMs === 'number' && effectiveStartMs > 0) {
      const duration = formatDuration(Date.now() - effectiveStartMs);
      state = config.showProject && !isRedundantProject
        ? `${config.workingMessage} ${duration} in ${detailsThread.project}`
        : `${config.workingMessage} ${duration}`;
    } else {
      state = config.showProject && !isRedundantProject
        ? `${config.workingMessage} ${detailsThread.project}`
        : config.workingMessage.replace(/ in$/, '');
    }
  } else {
    detailsThread = thread;
    const isRedundantProject =
      !detailsThread.project ||
      detailsThread.project === 'No project' ||
      detailsThread.project === detailsThread.title;

    if (detailsThread.status === 'working') {
      const effectiveStartMs =
        typeof detailsThread.episodeStartMs === 'number' && detailsThread.episodeStartMs > 0
          ? detailsThread.episodeStartMs
          : detailsThread.activityStartMs;
      if (typeof effectiveStartMs === 'number' && effectiveStartMs > 0) {
        const duration = formatDuration(Date.now() - effectiveStartMs);
        state = config.showProject && !isRedundantProject
          ? `${config.workingMessage} ${duration} in ${detailsThread.project}`
          : `${config.workingMessage} ${duration}`;
      } else {
        state = config.showProject && !isRedundantProject
          ? `${config.workingMessage} ${detailsThread.project}`
          : config.workingMessage.replace(/ in$/, '');
      }
    } else if (detailsThread.status === 'orchestrating') {
      const effectiveStartMs =
        typeof detailsThread.episodeStartMs === 'number' && detailsThread.episodeStartMs > 0
          ? detailsThread.episodeStartMs
          : detailsThread.activityStartMs;
      const count = detailsThread.activeSubagentCount || 1;
      const duration = typeof effectiveStartMs === 'number' && effectiveStartMs > 0
        ? formatDuration(Date.now() - effectiveStartMs)
        : '0s';
      state = `Orchestrating ${count} ${count === 1 ? 'agent' : 'agents'} · ${duration}`;
    } else if (detailsThread.status === 'needs-input') {
      state = config.showProject && !isRedundantProject
        ? `Needs input in ${detailsThread.project}`
        : 'Needs input';
    } else {
      state = config.showProject && !isRedundantProject
        ? `${config.idleMessage} ${detailsThread.project}`
        : config.idleMessage.replace(/ in$/, '');
    }
  }

  const startTimestamp =
    typeof snapshot.appStartMs === 'number' && snapshot.appStartMs > 0
      ? Math.floor(snapshot.appStartMs / 1000)
      : undefined;

  const activity = {
    name: config.activityName,
    state: truncate(state, 128),
    details: truncate(detailsThread ? detailsThread.title : 'T3 Code', 128),
    startTimestamp,
  };

  const model = detailsThread?.model || thread?.model;
  const modelNote = config.showModel && model ? ` · ${model}` : '';
  if (config.largeImageKey) activity.largeImageKey = config.largeImageKey;
  if (config.smallImageKey) activity.smallImageKey = config.smallImageKey;

  if (working.length >= 2 && !config.largeImageText) {
    activity.largeImageText = truncate(
      working.map((t) => t.title || 'Untitled thread').join(' · '),
      128,
    );
  } else {
    activity.largeImageText = truncate(config.largeImageText || `T3 Code${modelNote}`, 128);
  }
  if (config.smallImageText) activity.smallImageText = truncate(config.smallImageText, 128);

  const buttons = (Array.isArray(config.buttons) ? config.buttons : [])
    .filter((button) => button && button.label && button.url)
    .slice(0, 2)
    .map((button) => ({ label: truncate(button.label, 32), url: button.url }));
  if (buttons.length > 0) activity.buttons = buttons;

  return activity;
}

function activityKey(activity) {
  return activity ? JSON.stringify(activity) : 'clear';
}

function structuralKey(activity) {
  if (!activity) return 'clear';
  const copy = { ...activity };
  // duration patterns: e.g. "1h 2m 3s", "48m 12s", "15s"
  if (typeof copy.state === 'string') {
    copy.state = copy.state.replace(/\b(?:\d+h\s*)?(?:\d+m\s*)?(?:\d+s)\b/g, '<duration>');
  }
  return JSON.stringify(copy);
}

class PresenceBridge {
  constructor(config, logger) {
    this.config = config;
    this.log = logger;
    this.client = null;
    this.connected = false;
    this.connecting = false;
    this.stopping = false;
    this.lastKey = null;
    this.lastStructuralKey = null;
    this.lastSentAt = 0;
    this.sendTimestamps = [];
    this.pendingTimer = null;
    this.reconnectTimer = null;
    this.reconnectDelay = 5000;
  }

  async connect() {
    if (this.stopping || this.connecting || this.connected) return;
    this.connecting = true;
    const client = new Client({
      clientId: this.config.clientId,
      ...(this.config.pipeId ? { pipeId: Number(this.config.pipeId) } : {}),
    });
    this.client = client;
    client.on('ready', () => {
      if (this.client !== client) return;
      this.connected = true;
      this.reconnectDelay = 5000;
      this.log('Connected to Discord RPC');
      this.lastKey = null;
      this.lastStructuralKey = null;
      this.flushPending();
    });
    client.on('disconnected', () => {
      if (this.client !== client || this.connecting || this.stopping) return;
      this.log('Discord RPC disconnected');
      void this.resetClient();
      this.scheduleReconnect();
    });
    try {
      await client.login();
      this.log('Discord RPC login OK');
    } catch (error) {
      this.log(`Discord RPC unavailable: ${error.message}`);
      await this.resetClient();
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  async resetClient() {
    const client = this.client;
    this.client = null;
    this.connected = false;
    this.lastKey = null;
    this.lastStructuralKey = null;
    this.nextActivity = undefined;
    if (client) {
      try {
        await client.destroy();
      } catch {
        // best-effort cleanup
      }
    }
  }

  scheduleReconnect() {
    if (this.stopping || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    if (this.config.debug) this.log(`Will reconnect in ${delay / 1000}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((error) => this.log(`Reconnect failed: ${error.message}`));
    }, delay);
  }

  update(snapshot) {
    const activity = buildActivity(this.config, snapshot);
    const key = activityKey(activity);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.nextActivity = activity;
    this.flushPending();
  }

  flushPending() {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    if (!this.connected || !this.client?.user || this.nextActivity === undefined) return;

    const now = Date.now();
    // Prune send timestamps older than 20 seconds
    this.sendTimestamps = this.sendTimestamps.filter((t) => now - t < ROLLING_WINDOW_MS);

    let wait = 0;

    // Check rolling safety cap: if there are already 4 sends in the last 20 seconds,
    // defer until the oldest send expires
    if (this.sendTimestamps.length >= ROLLING_MAX_WRITES) {
      const oldest = this.sendTimestamps[0];
      const safetyWait = Math.max(0, ROLLING_WINDOW_MS - (now - oldest));
      if (safetyWait > wait) {
        wait = safetyWait;
        if (typeof this.log === 'function') {
          this.log(`Rate-limit safety cap reached (${ROLLING_MAX_WRITES} writes/20s); deferring update for ${Math.ceil(safetyWait / 1000)}s`);
        }
      }
    }

    const currentStructural = structuralKey(this.nextActivity);
    const isStructuralChange = currentStructural !== this.lastStructuralKey;
    const minInterval = isStructuralChange ? MIN_SEND_INTERVAL_MS : DURATION_THROTTLE_MS;

    const intervalWait = Math.max(0, minInterval - (now - this.lastSentAt));
    wait = Math.max(wait, intervalWait);

    if (wait > 0) {
      this.pendingTimer = setTimeout(() => {
        this.pendingTimer = null;
        this.flushPending();
      }, wait);
      return;
    }

    const activity = this.nextActivity;
    this.nextActivity = undefined;
    const sendTime = Date.now();
    this.lastSentAt = sendTime;
    this.sendTimestamps.push(sendTime);
    this.lastStructuralKey = currentStructural;
    const task = activity
      ? this.client.user.setActivity(activity)
      : this.client.user.clearActivity();
    task.catch((error) => {
      this.log(`Failed to set presence: ${error.message}`);
      void this.resetClient();
      this.scheduleReconnect();
    });
  }

  async stop() {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.reconnectTimer = null;
    this.pendingTimer = null;
    try {
      if (this.client?.user) await this.client.user.clearActivity();
      if (this.client) await this.client.destroy();
    } catch {
      // best-effort cleanup
    }
    this.connected = false;
  }
}

module.exports = {
  PresenceBridge,
  buildActivity,
  truncate,
  formatDuration,
  structuralKey,
  activityKey,
  MIN_SEND_INTERVAL_MS,
  DURATION_THROTTLE_MS,
  ROLLING_WINDOW_MS,
  ROLLING_MAX_WRITES,
};
