'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildActivity,
  truncate,
  structuralKey,
  PresenceBridge,
} = require('../src/presence');

describe('presence activity and formatting', () => {
  const baseConfig = {
    activityName: 'T3 Code',
    showProject: true,
    showModel: true,
    workingMessage: 'Working for',
    idleMessage: 'Idle in',
    clearWhenNoThread: true,
    buttons: [],
  };

  test('buildActivity formats for single working, redundant project suppressed', () => {
    const now = Date.now();
    // 1. Single working thread with distinct project
    const snap1 = {
      available: true,
      appStartMs: now - 60000,
      active: {
        threadId: 't1',
        title: 'Fix issue',
        project: 'MyProject',
        status: 'working',
        episodeStartMs: now - 30000,
        activeSubagentCount: 0,
      },
      workingThreads: [
        {
          threadId: 't1',
          title: 'Fix issue',
          project: 'MyProject',
          status: 'working',
          episodeStartMs: now - 30000,
          activeSubagentCount: 0,
        },
      ],
    };

    const act1 = buildActivity(baseConfig, snap1);
    assert.match(act1.state, /^Working for \d+s in MyProject$/);
    assert.equal(act1.details, 'Fix issue');

    // 2. Redundant project: project equals title or project is "No project"
    const snapRedundant = {
      available: true,
      appStartMs: now - 60000,
      active: {
        threadId: 't2',
        title: 'Fix issue',
        project: 'Fix issue', // redundant!
        status: 'working',
        episodeStartMs: now - 30000,
        activeSubagentCount: 0,
      },
      workingThreads: [
        {
          threadId: 't2',
          title: 'Fix issue',
          project: 'Fix issue',
          status: 'working',
          episodeStartMs: now - 30000,
          activeSubagentCount: 0,
        },
      ],
    };

    const actRedundant = buildActivity(baseConfig, snapRedundant);
    assert.match(actRedundant.state, /^Working for \d+s$/); // in Project suppressed!
  });

  test('buildActivity formats for orchestrating singular and plural', () => {
    const now = Date.now();
    // Singular: 1 agent
    const snapSingular = {
      available: true,
      appStartMs: now - 60000,
      active: {
        threadId: 't1',
        title: 'Lead Task',
        project: 'Core',
        status: 'orchestrating',
        episodeStartMs: now - 10000,
        activeSubagentCount: 1,
      },
      workingThreads: [
        {
          threadId: 't1',
          title: 'Lead Task',
          project: 'Core',
          status: 'orchestrating',
          episodeStartMs: now - 10000,
          activeSubagentCount: 1,
        },
      ],
    };
    const actSingular = buildActivity(baseConfig, snapSingular);
    assert.match(actSingular.state, /^Orchestrating 1 agent · \d+s$/);

    // Plural: 3 agents
    const snapPlural = {
      available: true,
      appStartMs: now - 60000,
      active: {
        threadId: 't1',
        title: 'Lead Task',
        project: 'Core',
        status: 'orchestrating',
        episodeStartMs: now - 15000,
        activeSubagentCount: 3,
      },
      workingThreads: [
        {
          threadId: 't1',
          title: 'Lead Task',
          project: 'Core',
          status: 'orchestrating',
          episodeStartMs: now - 15000,
          activeSubagentCount: 3,
        },
      ],
    };
    const actPlural = buildActivity(baseConfig, snapPlural);
    assert.match(actPlural.state, /^Orchestrating 3 agents · \d+s$/);
  });

  test('buildActivity formats multi with agents and multi without agents', () => {
    const now = Date.now();
    // Multi with agents
    const snapWithAgents = {
      available: true,
      appStartMs: now - 60000,
      active: {
        threadId: 't1',
        title: 'Task 1',
        project: 'ProjectA',
        status: 'orchestrating',
        episodeStartMs: now - 40000,
        activeSubagentCount: 2,
      },
      workingThreads: [
        {
          threadId: 't1',
          title: 'Task 1',
          project: 'ProjectA',
          status: 'orchestrating',
          episodeStartMs: now - 40000,
          activeSubagentCount: 2,
        },
        {
          threadId: 't2',
          title: 'Task 2',
          project: 'ProjectB',
          status: 'working',
          episodeStartMs: now - 20000,
          activeSubagentCount: 0,
        },
      ],
    };
    const actWithAgents = buildActivity(baseConfig, snapWithAgents);
    assert.match(actWithAgents.state, /^2 agents · 2 threads · \d+s$/);

    // Multi without agents
    const snapWithoutAgents = {
      available: true,
      appStartMs: now - 60000,
      active: {
        threadId: 't1',
        title: 'Task 1',
        project: 'ProjectA',
        status: 'working',
        episodeStartMs: now - 35000,
        activeSubagentCount: 0,
      },
      workingThreads: [
        {
          threadId: 't1',
          title: 'Task 1',
          project: 'ProjectA',
          status: 'working',
          episodeStartMs: now - 35000,
          activeSubagentCount: 0,
        },
        {
          threadId: 't2',
          title: 'Task 2',
          project: 'ProjectB',
          status: 'working',
          episodeStartMs: now - 25000,
          activeSubagentCount: 0,
        },
      ],
    };
    const actWithoutAgents = buildActivity(baseConfig, snapWithoutAgents);
    assert.match(actWithoutAgents.state, /^Working for \d+s across 2 threads$/);
  });

  test('buildActivity formats for idle', () => {
    const now = Date.now();
    const snapIdle = {
      available: true,
      appStartMs: now - 60000,
      active: {
        threadId: 't1',
        title: 'Idle Thread',
        project: 'MyProject',
        status: 'idle',
      },
      workingThreads: [],
    };
    const actIdle = buildActivity(baseConfig, snapIdle);
    assert.equal(actIdle.state, 'Idle in MyProject');
    assert.equal(actIdle.details, 'Idle Thread');
  });

  test('truncate byte limit and surrogate guard', () => {
    // 1. ASCII within limit
    assert.equal(truncate('hello', 10), 'hello');

    // 2. Multibyte UTF-8 byte boundary limit
    // '€' is 3 bytes in UTF-8
    const euros = '€€€€'; // 12 bytes
    // Truncate to 8 bytes. Ellipsis '…' is 3 bytes. Target is 8 - 3 = 5 bytes.
    // One '€' is 3 bytes, two is 6 bytes (exceeds 5). So 1 euro + ellipsis = 3 + 3 = 6 bytes <= 8 bytes.
    const resEuro = truncate(euros, 8);
    assert.equal(resEuro, '€…');
    assert.ok(Buffer.byteLength(resEuro, 'utf8') <= 8);

    // 3. Surrogate pair guard
    // 𠮷 is surrogate pair \uD842\uDFB7 (4 bytes in UTF-8, 2 code units in UTF-16)
    const surrogateStr = 'abc𠮷def';
    // Let's truncate so it ends right in the middle of surrogate if not guarded
    // 'abc' = 3 bytes. '𠮷' = 4 bytes. Ellipsis = 3 bytes.
    // If maxBytes is 8, targetBytes = 5 bytes.
    // 'abc' + first half of surrogate would be 3 + 3 = 6 bytes > 5 or 3 code units.
    // Let's test with emoji '🚀' (\uD83D\uDE80)
    const textWithEmoji = 'a' + '🚀'.repeat(5);
    const truncatedEmoji = truncate(textWithEmoji, 10);
    assert.ok(Buffer.byteLength(truncatedEmoji, 'utf8') <= 10);
    // Ensure no broken surrogate (lone surrogate)
    assert.doesNotMatch(truncatedEmoji, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  test('structuralKey ignores duration-only changes', () => {
    const act1 = {
      name: 'T3 Code',
      state: 'Working for 15s in MyProject',
      details: 'Task',
    };
    const act2 = {
      name: 'T3 Code',
      state: 'Working for 1m 20s in MyProject',
      details: 'Task',
    };
    const act3 = {
      name: 'T3 Code',
      state: 'Working for 2h 5m 10s in MyProject',
      details: 'Task',
    };
    const actDifferent = {
      name: 'T3 Code',
      state: 'Idle in MyProject',
      details: 'Task',
    };

    assert.equal(structuralKey(act1), structuralKey(act2));
    assert.equal(structuralKey(act2), structuralKey(act3));
    assert.notEqual(structuralKey(act1), structuralKey(actDifferent));
  });

  test('rate-limit telemetry logs when 5-writes-per-20s safety cap is reached', () => {
    const logs = [];
    const bridge = new PresenceBridge({ clientId: '123' }, (msg) => logs.push(msg));
    bridge.connected = true;
    bridge.client = {
      user: {
        setActivity: async () => {},
        clearActivity: async () => {},
      },
    };

    const now = Date.now();
    // Pre-fill sendTimestamps with 4 recent sends within last 5 seconds (cap is 4 writes)
    bridge.sendTimestamps = [now - 4000, now - 3000, now - 2000, now - 1000];
    bridge.lastSentAt = now - 1000;
    bridge.nextActivity = { name: 'T3 Code', state: 'Work', details: 'Task' };

    bridge.flushPending();

    // Check that telemetry logged the deferral message
    assert.ok(logs.some((l) => l.includes('Rate-limit safety cap reached')));
    if (bridge.pendingTimer) clearTimeout(bridge.pendingTimer);
  });
});
