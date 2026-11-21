'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { startSettingsServer } = require('../src/settings-ui.js');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
        });
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(data);
    }
    req.end();
  });
}

describe('settings UI server', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 't3rpc-settings-test-'));
  const configPath = path.join(tempDir, 'config.json');

  after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('start server, reach endpoints, save config, and close', async () => {
    const service = startSettingsServer({ port: 0, configPath });
    if (!service.server.listening) await new Promise((resolve) => service.server.once('listening', resolve));
    try {
      const port = service.server.address().port;
      assert.ok(port > 0, 'Server should have an ephemeral port assigned');

      // GET / returns HTML containing "T3 Code Discord RPC Settings" and a field named clientId
      const getRes = await request({
        hostname: '127.0.0.1',
        port,
        path: '/',
        method: 'GET',
      });

      assert.equal(getRes.statusCode, 200);
      assert.match(getRes.body, /T3 Code Discord RPC Settings/);
      assert.match(getRes.body, /name="clientId"/);

      // POST / with URL-encoded body
      const postData = new URLSearchParams({
        clientId: '12345',
        pipeId: '1',
        pollIntervalMs: '500',
        activityName: 'T3 Code',
        workingMessage: 'Working for',
        idleMessage: 'Idle in',
        buttons: '[]',
      }).toString();

      const postRes = await request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        postData,
      );

      assert.equal(postRes.statusCode, 200);

      // Verify saved config file
      assert.ok(fs.existsSync(configPath), 'Config file should have been written');
      const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.equal(savedConfig.clientId, '12345');
      assert.equal(savedConfig.pipeId, 1);
    } finally {
      // close() stops the server
      await service.close();
    }
  });
});
