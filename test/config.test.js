'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadConfig, writeTemplate, validateConfig } = require('../src/config');

describe('config loading and migrations', () => {
  test('migrations: pollIntervalMs 5000/2000 -> 500 and workingMessage "Working on" -> "Working for"', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 't3rpc-test-'));
    try {
      const configPath5000 = path.join(tempDir, 'c5000.json');
      fs.writeFileSync(
        configPath5000,
        JSON.stringify({
          pollIntervalMs: 5000,
          workingMessage: 'Working on',
        }),
      );
      const conf1 = loadConfig(configPath5000);
      assert.equal(conf1.pollIntervalMs, 500);
      assert.equal(conf1.workingMessage, 'Working for');

      const configPath2000 = path.join(tempDir, 'c2000.json');
      fs.writeFileSync(
        configPath2000,
        JSON.stringify({
          pollIntervalMs: 2000,
          workingMessage: 'Working on',
        }),
      );
      const conf2 = loadConfig(configPath2000);
      assert.equal(conf2.pollIntervalMs, 500);
      assert.equal(conf2.workingMessage, 'Working for');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('clamping pollIntervalMs 100 -> 250', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 't3rpc-test-'));
    try {
      const configPathClamp = path.join(tempDir, 'clamp.json');
      fs.writeFileSync(configPathClamp, JSON.stringify({ pollIntervalMs: 100 }));
      const conf = loadConfig(configPathClamp);
      assert.equal(conf.pollIntervalMs, 250);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('writeTemplate creates then refuses overwrite', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 't3rpc-test-'));
    try {
      const templatePath = path.join(tempDir, 'sub', 'config.json');
      const result = writeTemplate(templatePath);
      assert.equal(result, templatePath);
      assert.ok(fs.existsSync(templatePath));
      const parsed = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
      assert.equal(parsed.clientId, 'PASTE_YOUR_DISCORD_APPLICATION_ID_HERE');

      // Attempting to overwrite should throw
      assert.throws(
        () => writeTemplate(templatePath),
        /Config already exists/,
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('validateConfig catches invalid inputs', () => {
    assert.throws(
      () => validateConfig({ clientId: 12345 }),
      /"clientId" must be a string/,
    );
    assert.throws(
      () => validateConfig({ pipeId: -1 }),
      /"pipeId" must be an integer between 0 and 9/,
    );
    assert.throws(
      () => validateConfig({ pipeId: 10 }),
      /"pipeId" must be an integer between 0 and 9/,
    );
    assert.throws(
      () => validateConfig({ pollIntervalMs: -50 }),
      /"pollIntervalMs" must be a positive number/,
    );
    assert.throws(
      () => validateConfig({ buttons: 'not-an-array' }),
      /"buttons" must be an array/,
    );
    assert.throws(
      () => validateConfig({ buttons: [{ label: 'ok' }] }),
      /button at index 0 must have "label" and "url" strings/,
    );
    assert.throws(
      () => validateConfig({ largeImageKey: 123 }),
      /"largeImageKey" must be a string/,
    );
    assert.throws(
      () => validateConfig({ smallImageKey: 456 }),
      /"smallImageKey" must be a string/,
    );
  });
});
