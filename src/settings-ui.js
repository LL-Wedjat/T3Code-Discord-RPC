'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, defaultConfigPath, validateConfig } = require('./config');

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseUrlEncoded(body) {
  const params = new URLSearchParams(body);
  const result = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

function renderForm(config) {
  const buttonsJson = JSON.stringify(config.buttons || [], null, 2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>T3 Code Discord RPC Settings</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 2rem auto; max-width: 640px; padding: 0 1rem; color: #222; }
    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; }
    .field { margin-bottom: 1rem; }
    label { display: block; font-weight: 600; margin-bottom: 0.25rem; font-size: 0.9rem; }
    .checkbox-label { display: flex; align-items: center; gap: 0.5rem; font-weight: normal; cursor: pointer; }
    input[type="text"], input[type="number"], textarea { width: 100%; box-sizing: border-box; padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px; font-family: inherit; font-size: 0.9rem; }
    textarea { font-family: monospace; resize: vertical; }
    .actions { margin-top: 1.5rem; }
    button { background: #5865F2; color: #fff; border: none; padding: 0.6rem 1.2rem; font-size: 1rem; border-radius: 4px; cursor: pointer; font-weight: 600; }
    button:hover { background: #4752C4; }
  </style>
</head>
<body>
  <h1>T3 Code Discord RPC Settings</h1>
  <form method="POST" action="/">
    <div class="field">
      <label for="clientId">Discord Client ID</label>
      <input type="text" id="clientId" name="clientId" value="${escapeHtml(config.clientId || '')}" />
    </div>

    <div class="field">
      <label for="pipeId">Pipe ID</label>
      <input type="number" id="pipeId" name="pipeId" min="0" max="9" value="${escapeHtml(config.pipeId !== undefined ? config.pipeId : 0)}" />
    </div>

    <div class="field">
      <label for="stateFile">State File Path</label>
      <input type="text" id="stateFile" name="stateFile" value="${escapeHtml(config.stateFile || '')}" />
    </div>

    <div class="field">
      <label for="pollIntervalMs">Poll Interval (ms)</label>
      <input type="number" id="pollIntervalMs" name="pollIntervalMs" min="250" value="${escapeHtml(config.pollIntervalMs !== undefined ? config.pollIntervalMs : 500)}" />
    </div>

    <div class="field">
      <label for="activityName">Activity Name</label>
      <input type="text" id="activityName" name="activityName" value="${escapeHtml(config.activityName || '')}" />
    </div>

    <div class="field">
      <label class="checkbox-label">
        <input type="checkbox" id="showProject" name="showProject" ${config.showProject ? 'checked' : ''} />
        Show Project
      </label>
    </div>

    <div class="field">
      <label class="checkbox-label">
        <input type="checkbox" id="showModel" name="showModel" ${config.showModel ? 'checked' : ''} />
        Show Model
      </label>
    </div>

    <div class="field">
      <label for="largeImageKey">Large Image Key</label>
      <input type="text" id="largeImageKey" name="largeImageKey" value="${escapeHtml(config.largeImageKey || '')}" />
    </div>

    <div class="field">
      <label for="smallImageKey">Small Image Key</label>
      <input type="text" id="smallImageKey" name="smallImageKey" value="${escapeHtml(config.smallImageKey || '')}" />
    </div>

    <div class="field">
      <label for="largeImageText">Large Image Text</label>
      <input type="text" id="largeImageText" name="largeImageText" value="${escapeHtml(config.largeImageText || '')}" />
    </div>

    <div class="field">
      <label for="smallImageText">Small Image Text</label>
      <input type="text" id="smallImageText" name="smallImageText" value="${escapeHtml(config.smallImageText || '')}" />
    </div>

    <div class="field">
      <label for="buttons">Buttons (JSON)</label>
      <textarea id="buttons" name="buttons" rows="6">${escapeHtml(buttonsJson)}</textarea>
    </div>

    <div class="field">
      <label for="workingMessage">Working Message</label>
      <input type="text" id="workingMessage" name="workingMessage" value="${escapeHtml(config.workingMessage || '')}" />
    </div>

    <div class="field">
      <label for="idleMessage">Idle Message</label>
      <input type="text" id="idleMessage" name="idleMessage" value="${escapeHtml(config.idleMessage || '')}" />
    </div>

    <div class="field">
      <label class="checkbox-label">
        <input type="checkbox" id="clearWhenNoThread" name="clearWhenNoThread" ${config.clearWhenNoThread ? 'checked' : ''} />
        Clear When No Thread
      </label>
    </div>

    <div class="field">
      <label class="checkbox-label">
        <input type="checkbox" id="debug" name="debug" ${config.debug ? 'checked' : ''} />
        Debug
      </label>
    </div>

    <div class="actions">
      <button type="submit">Save Settings</button>
    </div>
  </form>
</body>
</html>`;
}

function renderSuccess() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Settings Saved</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 3rem auto; max-width: 640px; padding: 0 1rem; color: #222; text-align: center; }
    h1 { color: #2e7d32; }
    a { display: inline-block; margin-top: 1rem; color: #5865F2; text-decoration: none; font-weight: 600; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Settings saved successfully!</h1>
  <p>The configuration file has been updated.</p>
  <a href="/">&larr; Back to Settings</a>
</body>
</html>`;
}

function startSettingsServer(options = {}) {
  const port = options.port ?? 8765;
  const configPath = options.configPath || defaultConfigPath();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

    if (req.method === 'GET' && url.pathname === '/') {
      try {
        const config = loadConfig(configPath);
        const html = renderForm(config);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Error loading configuration: ${err.message}`);
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });

      req.on('end', () => {
        try {
          const form = parseUrlEncoded(body);

          let buttons = [];
          if (form.buttons && form.buttons.trim()) {
            buttons = JSON.parse(form.buttons.trim());
          }

          const newConfig = {
            clientId: form.clientId !== undefined ? form.clientId : '',
            pipeId: form.pipeId !== undefined && form.pipeId !== '' ? Number(form.pipeId) : 0,
            stateFile: form.stateFile !== undefined ? form.stateFile : '',
            pollIntervalMs: form.pollIntervalMs !== undefined && form.pollIntervalMs !== '' ? Number(form.pollIntervalMs) : 500,
            activityName: form.activityName !== undefined ? form.activityName : 'T3 Code',
            showProject: Boolean(form.showProject),
            showModel: Boolean(form.showModel),
            largeImageKey: form.largeImageKey !== undefined ? form.largeImageKey : '',
            smallImageKey: form.smallImageKey !== undefined ? form.smallImageKey : '',
            largeImageText: form.largeImageText !== undefined ? form.largeImageText : '',
            smallImageText: form.smallImageText !== undefined ? form.smallImageText : '',
            buttons,
            workingMessage: form.workingMessage !== undefined ? form.workingMessage : 'Working for',
            idleMessage: form.idleMessage !== undefined ? form.idleMessage : 'Idle in',
            clearWhenNoThread: Boolean(form.clearWhenNoThread),
            debug: Boolean(form.debug),
          };

          validateConfig(newConfig);

          fs.mkdirSync(path.dirname(configPath), { recursive: true });
          fs.writeFileSync(configPath, `${JSON.stringify(newConfig, null, 2)}\n`, 'utf8');

          const html = renderSuccess();
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Error</title></head>
<body style="font-family: sans-serif; margin: 2rem; color: #c62828;">
  <h2>Failed to save settings</h2>
  <p>${escapeHtml(err.message)}</p>
  <p><a href="/">&larr; Back to Settings</a></p>
</body>
</html>`);
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  });

  server.listen(port, '127.0.0.1');

  return {
    server,
    port,
    close(callback) {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (callback) callback(err);
          if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') reject(err);
          else resolve();
        });
      });
    },
  };
}

module.exports = {
  startSettingsServer,
};
