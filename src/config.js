'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DEFAULTS = Object.freeze({
  clientId: '',
  pipeId: 0,
  stateFile: '',
  pollIntervalMs: 500,
  activityName: 'T3 Code',
  showProject: true,
  showModel: true,
  largeImageKey: '',
  smallImageKey: '',
  largeImageText: '',
  smallImageText: '',
  buttons: [],
  workingMessage: 'Working for',
  idleMessage: 'Idle in',
  clearWhenNoThread: true,
  debug: false,
});

function validateConfig(config) {
  if (config.clientId !== undefined && typeof config.clientId !== 'string') {
    throw new Error('Config validation error: "clientId" must be a string.');
  }
  if (config.pipeId !== undefined) {
    if (!Number.isInteger(Number(config.pipeId)) || Number(config.pipeId) < 0 || Number(config.pipeId) > 9) {
      throw new Error('Config validation error: "pipeId" must be an integer between 0 and 9.');
    }
  }
  if (config.pollIntervalMs !== undefined) {
    const val = Number(config.pollIntervalMs);
    if (!Number.isFinite(val) || val < 0) {
      throw new Error('Config validation error: "pollIntervalMs" must be a positive number.');
    }
  }
  if (config.buttons !== undefined && !Array.isArray(config.buttons)) {
    throw new Error('Config validation error: "buttons" must be an array.');
  }
  if (Array.isArray(config.buttons)) {
    for (let i = 0; i < config.buttons.length; i += 1) {
      const b = config.buttons[i];
      if (!b || typeof b !== 'object' || typeof b.label !== 'string' || typeof b.url !== 'string') {
        throw new Error(`Config validation error: button at index ${i} must have "label" and "url" strings.`);
      }
    }
  }
  if (config.largeImageKey !== undefined && typeof config.largeImageKey !== 'string') {
    throw new Error('Config validation error: "largeImageKey" must be a string.');
  }
  if (config.smallImageKey !== undefined && typeof config.smallImageKey !== 'string') {
    throw new Error('Config validation error: "smallImageKey" must be a string.');
  }
}

function defaultConfigPath() {
  if (process.env.T3CODE_RPC_CONFIG) return process.env.T3CODE_RPC_CONFIG;
  const base =
    process.platform === 'win32' && process.env.APPDATA
      ? process.env.APPDATA
      : path.join(os.homedir(), '.config');
  return path.join(base, 't3code-discord-rpc', 'config.json');
}

function defaultStateFile() {
  if (process.env.T3CODE_STATE_DB) return process.env.T3CODE_STATE_DB;
  return path.join(os.homedir(), '.t3', 'userdata', 'statev2.sqlite');
}

function loadConfig(configPath) {
  let raw = {};
  if (fs.existsSync(configPath)) {
    try {
      raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
      throw new Error(`Config file is not valid JSON: ${configPath}\n${error.message}`);
    }
  }
  validateConfig(raw);
  const config = { ...DEFAULTS, ...raw };
  if (config.workingMessage === 'Working on') {
    config.workingMessage = 'Working for';
  }
  if (config.pollIntervalMs === 5000 || config.pollIntervalMs === 2000) {
    config.pollIntervalMs = 500;
  }
  config.stateFile = config.stateFile || defaultStateFile();
  config.pollIntervalMs = Math.max(250, Number(config.pollIntervalMs) || 500);
  return config;
}

function writeTemplate(configPath) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  if (fs.existsSync(configPath)) {
    throw new Error(`Config already exists: ${configPath}`);
  }
  const template = {
    ...DEFAULTS,
    clientId: 'PASTE_YOUR_DISCORD_APPLICATION_ID_HERE',
    stateFile: '',
  };
  fs.writeFileSync(configPath, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
  return configPath;
}

module.exports = { DEFAULTS, defaultConfigPath, defaultStateFile, loadConfig, writeTemplate, validateConfig };
