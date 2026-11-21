#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');
const { defaultConfigPath, loadConfig, writeTemplate } = require('./config');
const { readState } = require('./t3-state');
const { PresenceBridge } = require('./presence');
const { startSettingsServer } = require('./settings-ui');

function parseArgs(argv) {
  const args = {
    configPath: defaultConfigPath(),
    init: false,
    once: false,
    settings: false,
    verbose: false,
    clientId: null,
    stateFile: null,
    pipeId: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--init') args.init = true;
    else if (arg === '--once') args.once = true;
    else if (arg === '--settings') args.settings = true;
    else if (arg === '--verbose' || arg === '-v') args.verbose = true;
    else if (arg === '--config' && argv[i + 1]) args.configPath = path.resolve(argv[++i]);
    else if (arg === '--client-id' && argv[i + 1]) args.clientId = argv[++i];
    else if (arg === '--state-file' && argv[i + 1]) args.stateFile = path.resolve(argv[++i]);
    else if (arg === '--pipe-id' && argv[i + 1]) args.pipeId = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`t3code-discord-rpc

Usage:
  node src/index.js [--config <path>] [--client-id <id>] [--state-file <path>]
  node src/index.js --init
  node src/index.js --once [--verbose]

Options:
  --init            Write a config template and exit.
  --once            Print the detected T3 Code state and exit (no Discord needed).
  --settings          open the local settings page in your browser
  --config <path>   Use a specific config file.
  --client-id <id>  Override the Discord application ID.
  --state-file <p>  Override the T3 Code state SQLite file.
  --pipe-id <n>     Force a Discord IPC pipe (0 = auto).
  -v, --verbose     Log every poll.
  -h, --help        Show this help.`);
}

function makeLogger(verbose) {
  return (message) => {
    const time = new Date().toISOString().slice(11, 19);
    console.log(`[${time}] ${message}`);
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.init) {
    const written = writeTemplate(args.configPath);
    console.log(`Wrote config template: ${written}`);
    console.log('Set clientId to your Discord application ID, then run: npm start');
    return;
  }

  const config = loadConfig(args.configPath);
  if (args.clientId) config.clientId = args.clientId;
  if (args.stateFile) config.stateFile = args.stateFile;
  if (args.pipeId !== null) config.pipeId = args.pipeId;
  if (args.verbose) config.debug = true;
  const log = makeLogger(config.debug);

  if (args.settings) {
    const port = Number(process.env.T3CODE_RPC_SETTINGS_PORT) || 8765;
    startSettingsServer({ configPath: args.configPath, port });
    const url = `http://127.0.0.1:${port}`;
    console.log(`Settings: ${url}`);
    try {
      const opener = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      childProcess.exec(`${opener} ${url}`, () => {});
    } catch {
      // ignore failures
    }
    return;
  }

  if (args.once) {
    console.log(JSON.stringify(readState(config.stateFile), null, 2));
    return;
  }

  if (!config.clientId || config.clientId.includes('PASTE_')) {
    console.error(
      'No Discord application ID configured.\n' +
        `1. Create an app at https://discord.com/developers/applications\n` +
        `2. Copy its Application ID into "${args.configPath}" (clientId),\n` +
        `   or pass --client-id <id>.\n` +
        `3. Run "npm run once" first to verify T3 Code state detection.`,
    );
    process.exitCode = 1;
    return;
  }

  const bridge = new PresenceBridge(config, log);
  let previousSignature = null;
  let timer = null;
  let stopping = false;

  const poll = async () => {
    if (stopping) return;
    const snapshot = readState(config.stateFile);
    const active = snapshot.active;
    const signature = active
      ? `${active.threadId}|${snapshot.status}|${active.status}|${active.title}|${active.project}|${snapshot.runningThreads}`
      : snapshot.available
        ? 'none'
        : 'unavailable';

    if (signature !== previousSignature) {
      previousSignature = signature;
      if (!snapshot.available) log(snapshot.reason || 'T3 Code state unavailable');
      else if (!active) log('No active T3 Code thread');
      else {
        const stateWord = snapshot.status === 'working' ? 'Working' : snapshot.status === 'needs-input' ? 'Needs input' : 'Idle';
        log(
          `${stateWord}: ${active.title} — ${active.project}`,
        );
      }
    } else if (args.verbose) {
      log(`poll: ${signature}`);
    }

    bridge.update(snapshot);
    timer = setTimeout(poll, config.pollIntervalMs);
  };

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    if (timer) clearTimeout(timer);
    log('Stopping...');
    await bridge.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  log(`Starting (config: ${args.configPath}, state: ${config.stateFile})`);
  await bridge.connect();
  await poll();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
