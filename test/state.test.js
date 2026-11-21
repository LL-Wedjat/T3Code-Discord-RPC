'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildSnapshot } = require('../src/t3-state');

describe('t3-state snapshot building', () => {
  test('user fork is retained and genuine subagents are excluded', () => {
    const rows = {
      threads: [
        {
          thread_id: 'thread-root-1',
          title: 'Root Thread',
          updated_at: 1000,
          payload_json: JSON.stringify({
            createdAt: 1000,
            createdBy: 'user',
          }),
        },
        {
          thread_id: 'thread-fork-1',
          title: 'User Fork',
          updated_at: 2000,
          payload_json: JSON.stringify({
            createdAt: 2000,
            createdBy: 'user',
            lineage: { relationshipToParent: 'fork', parentThreadId: 'thread-root-1' },
          }),
        },
        {
          thread_id: 'thread-subagent-child',
          title: 'Subagent Child',
          updated_at: 3000,
          payload_json: JSON.stringify({
            createdAt: 3000,
            createdBy: 'user',
            lineage: { relationshipToParent: 'subagent', parentThreadId: 'thread-root-1' },
          }),
        },
        {
          thread_id: 'thread-agent-created',
          title: 'Agent Created',
          updated_at: 4000,
          payload_json: JSON.stringify({
            createdAt: 4000,
            createdBy: 'agent',
          }),
        },
        {
          thread_id: 'thread:subagent:abc',
          title: 'Subagent Prefix',
          updated_at: 5000,
          payload_json: JSON.stringify({ createdAt: 5000 }),
        },
        {
          thread_id: 'thread:delegated-task:xyz',
          title: 'Delegated Prefix',
          updated_at: 6000,
          payload_json: JSON.stringify({ createdAt: 6000 }),
        },
      ],
      sessions: [],
      requests: [],
      runs: [],
      subagents: [],
      visits: [],
    };

    const snapshot = buildSnapshot(rows, 1000);
    assert.equal(snapshot.threads, 2);
    // Working or active threads should contain root and fork only
    assert.ok(snapshot.active);
    assert.ok(['thread-root-1', 'thread-fork-1'].includes(snapshot.active.threadId));
  });

  test('window title selects thread and subagent title maps to parent', () => {
    const rows = {
      threads: [
        {
          thread_id: 'parent-thread-1',
          title: 'Parent Work',
          updated_at: 1000,
          project_title: 'ProjectAlpha',
          payload_json: JSON.stringify({
            title: 'Parent Work',
          }),
        },
        {
          thread_id: 'other-thread-2',
          title: 'Other Work',
          updated_at: 5000,
          project_title: 'ProjectBeta',
          payload_json: JSON.stringify({
            title: 'Other Work',
          }),
        },
      ],
      sessions: [],
      requests: [],
      runs: [],
      subagents: [],
      visits: [],
      subagentParentMap: new Map([['sub-1', 'parent-thread-1']]),
      subagentTitleToParentMap: new Map([['Child Task Subagent', 'parent-thread-1']]),
    };

    // 1. Direct window title matching Parent Work
    const directSnap = buildSnapshot(rows, 1000, 'ProjectAlpha / Parent Work');
    assert.equal(directSnap.active?.threadId, 'parent-thread-1');

    // 2. Window title showing subagent title should map to parent
    const subSnap = buildSnapshot(rows, 1000, 'ProjectAlpha / Child Task Subagent');
    assert.equal(subSnap.active?.threadId, 'parent-thread-1');
  });

  test('busy from running run with no completed_at and completed run not busy', () => {
    const runningRunRows = {
      threads: [
        {
          thread_id: 'thread-run-test',
          title: 'Run Test',
          updated_at: 1000,
          payload_json: JSON.stringify({ title: 'Run Test' }),
        },
      ],
      sessions: [],
      requests: [],
      runs: [
        {
          run_id: 'run-1',
          thread_id: 'thread-run-test',
          status: 'running',
          requested_at: 1000,
          completed_at: null,
        },
      ],
      subagents: [],
      visits: [],
    };

    const snapRunning = buildSnapshot(runningRunRows, 1000);
    assert.equal(snapRunning.active?.busy, true);
    assert.equal(snapRunning.status, 'working');

    const completedRunRows = {
      threads: [
        {
          thread_id: 'thread-run-test',
          title: 'Run Test',
          updated_at: 1000,
          payload_json: JSON.stringify({ title: 'Run Test' }),
        },
      ],
      sessions: [],
      requests: [],
      runs: [
        {
          run_id: 'run-1',
          thread_id: 'thread-run-test',
          status: 'running',
          requested_at: 1000,
          completed_at: 2000, // completed!
        },
      ],
      subagents: [],
      visits: [],
    };

    const snapCompleted = buildSnapshot(completedRunRows, 1000);
    assert.equal(snapCompleted.active?.busy, false);
    assert.equal(snapCompleted.status, 'idle');
  });

  test('orchestrating timer anchored to parent run requested_at', () => {
    const rows = {
      threads: [
        {
          thread_id: 'thread-orch',
          title: 'Orchestrating Thread',
          updated_at: 5000,
          payload_json: JSON.stringify({ title: 'Orchestrating Thread' }),
        },
      ],
      sessions: [],
      requests: [],
      runs: [
        {
          run_id: 'parent-run-42',
          thread_id: 'thread-orch',
          status: 'completed',
          requested_at: 1500,
          completed_at: 2000,
        },
      ],
      subagents: [
        {
          subagent_id: 'sub-agent-1',
          thread_id: 'thread-orch',
          run_id: 'parent-run-42',
          status: 'running',
          started_at: 2500,
          completed_at: null,
        },
      ],
      visits: [],
    };

    const snap = buildSnapshot(rows, 1000);
    assert.equal(snap.active?.status, 'orchestrating');
    assert.equal(snap.active?.activeSubagentCount, 1);
    assert.equal(snap.active?.episodeStartMs, 1500); // Anchored to parent run requested_at!
    assert.equal(snap.active?.activityStartMs, 1500);
  });

  test('new run resets timer', () => {
    const rows = {
      threads: [
        {
          thread_id: 'thread-turn',
          title: 'Turn Thread',
          updated_at: 10000,
          payload_json: JSON.stringify({ title: 'Turn Thread' }),
        },
      ],
      sessions: [],
      requests: [],
      runs: [
        {
          run_id: 'run-turn-1',
          thread_id: 'thread-turn',
          ordinal: 1,
          status: 'completed',
          requested_at: 1000,
          completed_at: 2000,
        },
        {
          run_id: 'run-turn-2',
          thread_id: 'thread-turn',
          ordinal: 2,
          status: 'running',
          requested_at: 8000,
          completed_at: null,
        },
      ],
      subagents: [],
      visits: [],
    };

    const snap = buildSnapshot(rows, 1000);
    assert.equal(snap.active?.busy, true);
    assert.equal(snap.active?.episodeStartMs, 8000); // Resets to latest run requested_at
  });

  test('workingThreads includes orchestrating threads', () => {
    const rows = {
      threads: [
        {
          thread_id: 'thread-orch-1',
          title: 'Orch 1',
          updated_at: 1000,
          payload_json: JSON.stringify({ title: 'Orch 1' }),
        },
        {
          thread_id: 'thread-idle-2',
          title: 'Idle 2',
          updated_at: 1000,
          payload_json: JSON.stringify({ title: 'Idle 2' }),
        },
      ],
      sessions: [],
      requests: [],
      runs: [
        {
          run_id: 'run-1',
          thread_id: 'thread-orch-1',
          status: 'completed',
          requested_at: 500,
          completed_at: 600,
        },
      ],
      subagents: [
        {
          subagent_id: 'sub-1',
          thread_id: 'thread-orch-1',
          run_id: 'run-1',
          status: 'running',
          started_at: 700,
        },
      ],
      visits: [],
    };

    const snap = buildSnapshot(rows, 1000);
    assert.equal(snap.workingThreads.length, 1);
    assert.equal(snap.workingThreads[0].threadId, 'thread-orch-1');
    assert.equal(snap.workingThreads[0].status, 'orchestrating');
    assert.equal(snap.status, 'working');
  });
});
