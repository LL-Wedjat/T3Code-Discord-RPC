'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const childProcess = require('node:child_process');

const BUSY_RUN_STATUSES = new Set([
  'running',
  'starting',
  'active',
  'busy',
  'working',
  'thinking',
  'in_progress',
  'in-progress',
]);

const TERMINAL_SUBAGENT_STATUSES = new Set([
  'completed',
  'failed',
  'interrupted',
  'cancelled',
  'rolled_back',
]);

const PENDING_REQUEST_STATUSES = new Set(['pending', 'open', 'waiting', 'awaiting_input', 'awaiting-input']);

function toMs(value) {
  if (!value) return 0;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shortModel(model) {
  if (!model) return '';
  const parts = String(model).split('/');
  return parts[parts.length - 1];
}

function projectName(row, payload) {
  if (row.project_title) return row.project_title;
  if (payload.worktreePath) {
    const normalized = String(payload.worktreePath).replace(/[\\/]+$/, '');
    const leaf = normalized.split(/[\\/]/).pop();
    if (leaf) return leaf;
  }
  return 'T3 Code';
}

function openQueries(db) {
  const threads = db.prepare(`
    SELECT t.thread_id, t.title, t.updated_at, t.payload_json, p.title AS project_title
    FROM orchestration_v2_projection_threads t
    LEFT JOIN projection_projects p ON p.project_id = t.project_id
    WHERE t.deleted_at IS NULL AND t.archived_at IS NULL
  `).all();

  const sessions = db.prepare(`
    SELECT thread_id, status, updated_at FROM orchestration_v2_projection_provider_sessions
  `).all();

  const requests = db.prepare(`
    SELECT thread_id, status FROM orchestration_v2_projection_runtime_requests
  `).all();

  const runs = db.prepare(`
    SELECT run_id, thread_id, ordinal, status, requested_at, completed_at
    FROM orchestration_v2_projection_runs
  `).all();

  const subagents = db.prepare(`
    SELECT subagent_id, thread_id, run_id, status, started_at, completed_at, updated_at
    FROM orchestration_v2_projection_subagents
  `).all();

  let visits = [];
  try {
    const ninetySecAgoIso = new Date(Date.now() - 90000).toISOString();
    visits = db.prepare(`
      SELECT stream_id, MAX(occurred_at) AS last_arrival, COUNT(*) AS hits
      FROM orchestration_events
      WHERE event_type = 'thread.visit-recorded' AND occurred_at >= ?
      GROUP BY stream_id
    `).all(ninetySecAgoIso);
  } catch {
    visits = [];
  }

  // Pre-load subagent-to-parent mapping so subagent visits can attribute to parent thread,
  // and subagent-title-to-parent mapping so window titles showing subagents resolve to parent
  const subagentParentMap = new Map();
  const subagentTitleToParentMap = new Map();
  for (const row of threads) {
    try {
      const p = JSON.parse(row.payload_json);
      const threadIdStr = String(row.thread_id);
      const isSubagent =
        p.lineage?.relationshipToParent === 'subagent' ||
        p.createdBy === 'agent' ||
        threadIdStr.startsWith('thread:subagent:') ||
        threadIdStr.startsWith('thread:delegated-task:');

      if (isSubagent && p.lineage?.parentThreadId) {
        subagentParentMap.set(row.thread_id, p.lineage.parentThreadId);
        const title = (row.title || p.title || '').trim();
        if (title) {
          subagentTitleToParentMap.set(title, p.lineage.parentThreadId);
        }
      }
    } catch {}
  }

  return { threads, sessions, requests, runs, subagents, visits, subagentParentMap, subagentTitleToParentMap };
}

let cachedWindowTitle = '';
let windowTitleProbeInProgress = false;

function refreshWindowTitleAsync() {
  if (process.platform !== 'win32' || windowTitleProbeInProgress) return;
  windowTitleProbeInProgress = true;
  childProcess.execFile(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      "Get-Process -Name 'T3 Code*' -ErrorAction SilentlyContinue | ForEach-Object { if ($_.MainWindowTitle) { $_.MainWindowTitle } }",
    ],
    { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] },
    (error, stdout) => {
      windowTitleProbeInProgress = false;
      if (!error && typeof stdout === 'string') {
        const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (lines.length > 0) {
          cachedWindowTitle = lines[0];
        }
      }
    },
  );
}

function getWindowTitle() {
  refreshWindowTitleAsync();
  return cachedWindowTitle;
}

function resolveAppStartMs(stateFile) {
  try {
    const runtimePath = path.join(path.dirname(stateFile), 'server-runtime.json');
    if (fs.existsSync(runtimePath)) {
      const data = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
      const ms = toMs(data.startedAt);
      if (ms > 0) return ms;
    }
  } catch {
    // fallback below
  }
  return Date.now() - Math.round(process.uptime() * 1000);
}

function buildSnapshot(rows, appStartMs, windowTitle = null) {
  const visitsByThread = new Map();
  for (const visit of rows.visits || []) {
    if (!visit.stream_id) continue;
    let targetId = visit.stream_id;
    if (rows.subagentParentMap && rows.subagentParentMap.has(targetId)) {
      targetId = rows.subagentParentMap.get(targetId);
    }
    const current = visitsByThread.get(targetId) || { lastArrivalMs: 0, hits: 0 };
    current.hits += Number(visit.hits) || 0;
    current.lastArrivalMs = Math.max(current.lastArrivalMs, toMs(visit.last_arrival));
    visitsByThread.set(targetId, current);
  }

  const pendingByThread = new Set();
  for (const request of rows.requests) {
    if (request.thread_id && PENDING_REQUEST_STATUSES.has(request.status)) {
      pendingByThread.add(request.thread_id);
    }
  }

  const runsById = new Map();
  const runsByThread = new Map();
  const latestRunByThread = new Map();
  for (const run of rows.runs || []) {
    if (run.run_id) {
      runsById.set(run.run_id, run);
    }
    if (!run.thread_id) continue;
    let list = runsByThread.get(run.thread_id);
    if (!list) {
      list = [];
      runsByThread.set(run.thread_id, list);
    }
    list.push(run);

    const existing = latestRunByThread.get(run.thread_id);
    if (!existing) {
      latestRunByThread.set(run.thread_id, run);
      continue;
    }
    const runReqMs = toMs(run.requested_at);
    const existReqMs = toMs(existing.requested_at);
    if (runReqMs > existReqMs) {
      latestRunByThread.set(run.thread_id, run);
    } else if (runReqMs === existReqMs) {
      const runOrdinal = Number(run.ordinal) || 0;
      const existOrdinal = Number(existing.ordinal) || 0;
      if (runOrdinal > existOrdinal) {
        latestRunByThread.set(run.thread_id, run);
      }
    }
  }

  const subagentsByThread = new Map();
  for (const sub of rows.subagents || []) {
    if (!sub.thread_id) continue;
    let list = subagentsByThread.get(sub.thread_id);
    if (!list) {
      list = [];
      subagentsByThread.set(sub.thread_id, list);
    }
    list.push(sub);
  }

  const threads = [];
  for (const row of rows.threads) {
    let payload;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      payload = {};
    }

    // Exclude ONLY genuine subagents: relationshipToParent equals subagent OR createdBy equals agent
    // OR thread id starts with thread:subagent: OR thread:delegated-task:. Keep user forks.
    const threadIdStr = String(row.thread_id);
    const isSubagent =
      payload.lineage?.relationshipToParent === 'subagent' ||
      payload.createdBy === 'agent' ||
      threadIdStr.startsWith('thread:subagent:') ||
      threadIdStr.startsWith('thread:delegated-task:');
    if (isSubagent) continue;

    if (payload.deletedAt || payload.archivedAt) continue;
    if (payload.snoozedUntil && toMs(payload.snoozedUntil) > Date.now()) continue;

    const updatedMs = toMs(row.updated_at);
    const openedAtMs = toMs(payload.opens?.openedAt);
    const lastVisitedAtMs = toMs(payload.lastVisitedAt);
    const visitInfo = visitsByThread.get(row.thread_id) || { lastArrivalMs: 0, hits: 0 };

    const focusFromPayload = Math.max(
      lastVisitedAtMs,
      openedAtMs,
    );
    const focusMs = focusFromPayload > 0 ? focusFromPayload : updatedMs;
    const visitedMs = Math.max(
      lastVisitedAtMs,
      openedAtMs,
      updatedMs,
    );
    const latestRun = latestRunByThread.get(row.thread_id);

    const busy = Boolean(
      latestRun &&
        BUSY_RUN_STATUSES.has(latestRun.status) &&
        (latestRun.completed_at === null ||
          latestRun.completed_at === undefined ||
          latestRun.completed_at === '')
    );

    const threadSubagents = subagentsByThread.get(row.thread_id) || [];
    const activeSubagents = threadSubagents.filter(
      (s) => s.status && !TERMINAL_SUBAGENT_STATUSES.has(s.status)
    );
    const activeSubagentCount = activeSubagents.length;
    const activeSubagentStarts = activeSubagents
      .map((s) => toMs(s.started_at))
      .filter((ms) => ms > 0);
    const earliestActiveSubagentMs =
      activeSubagentStarts.length > 0 ? Math.min(...activeSubagentStarts) : 0;

    let episodeStartMs = 0;
    if (busy) {
      episodeStartMs = toMs(latestRun.requested_at);
    } else if (activeSubagentCount > 0) {
      const parentRunStarts = activeSubagents
        .map((s) => (s.run_id ? runsById.get(s.run_id) : null))
        .filter(Boolean)
        .map((r) => toMs(r.requested_at))
        .filter((ms) => ms > 0);
      if (parentRunStarts.length > 0) {
        episodeStartMs = Math.min(...parentRunStarts);
      } else if (latestRun) {
        episodeStartMs = toMs(latestRun.requested_at);
      }
    }

    const activityStartMs = episodeStartMs;

    let threadStatus = 'idle';
    if (busy) {
      threadStatus = 'working';
    } else if (activeSubagentCount > 0) {
      threadStatus = 'orchestrating';
    } else if (pendingByThread.has(row.thread_id)) {
      threadStatus = 'needs-input';
    }

    threads.push({
      threadId: row.thread_id,
      title: row.title || payload.title || 'Untitled thread',
      project: projectName(row, payload),
      model: shortModel(payload.modelSelection?.model),
      directory: payload.worktreePath || null,
      createdMs: toMs(payload.createdAt) || updatedMs,
      activityStartMs,
      episodeStartMs,
      activeSubagentCount,
      status: threadStatus,
      updatedMs,
      visitedMs,
      focusMs,
      openedAtMs,
      lastVisitedAtMs,
      visitHits: visitInfo.hits,
      lastArrivalMs: visitInfo.lastArrivalMs,
      busy,
      needsInput: pendingByThread.has(row.thread_id),
    });
  }

  const workingThreads = threads
    .filter((thread) => thread.busy || thread.activeSubagentCount > 0)
    .map((thread) => ({
      threadId: thread.threadId,
      title: thread.title,
      project: thread.project,
      status: thread.status,
      activityStartMs: thread.activityStartMs,
      episodeStartMs: thread.episodeStartMs,
      activeSubagentCount: thread.activeSubagentCount,
    }))
    .sort((a, b) => a.activityStartMs - b.activityStartMs);

  let active = null;
  if (threads.length > 0) {
    if (windowTitle && typeof windowTitle === 'string' && windowTitle.trim()) {
      const wt = windowTitle.trim();
      // Match against: project / thread title, ending with / thread title, or exact thread title
      const matches = [];
      for (const t of threads) {
        const fullCombo = `${t.project} / ${t.title}`;
        const suffixCombo = `/ ${t.title}`;
        let score = 0;
        if (wt === fullCombo) {
          score = 3;
        } else if (wt.endsWith(suffixCombo)) {
          score = 2;
        } else if (wt === t.title) {
          score = 1;
        }
        if (score > 0) {
          matches.push({ thread: t, score });
        }
      }

      // Check if window title ends with a genuine subagent's title: resolve to parent/root thread
      if (rows.subagentTitleToParentMap && rows.subagentTitleToParentMap.size > 0) {
        const threadsById = new Map(threads.map((t) => [t.threadId, t]));
        for (const [subTitle, parentId] of rows.subagentTitleToParentMap.entries()) {
          const suffix = `/ ${subTitle}`;
          if (wt.endsWith(suffix) || wt === subTitle) {
            const parentThread = threadsById.get(parentId);
            if (parentThread) {
              matches.push({ thread: parentThread, score: 2 });
            }
          }
        }
      }

      if (matches.length > 0) {
        // prefer exact match (higher score), then strongest visit heartbeat
        matches.sort((a, b) => (
          b.score - a.score ||
          b.thread.visitHits - a.thread.visitHits ||
          b.thread.lastArrivalMs - a.thread.lastArrivalMs ||
          b.thread.openedAtMs - a.thread.openedAtMs ||
          b.thread.updatedMs - a.thread.updatedMs
        ));
        active = matches[0].thread;
      }
    }

    // Else pick thread with at least 2 recent visit events and newest last_arrival
    if (!active) {
      const visitCandidates = threads.filter((t) => t.visitHits >= 2 && t.lastArrivalMs > 0);
      if (visitCandidates.length > 0) {
        visitCandidates.sort((a, b) => (
          b.lastArrivalMs - a.lastArrivalMs ||
          b.visitHits - a.visitHits
        ));
        active = visitCandidates[0];
      }
    }

    // Else fallback sort by opens.openedAt, then visit heartbeat, then lastVisitedAt, then updated_at
    if (!active) {
      const fallbackList = [...threads];
      fallbackList.sort((a, b) => (
        b.openedAtMs - a.openedAtMs ||
        b.visitHits - a.visitHits ||
        b.lastArrivalMs - a.lastArrivalMs ||
        b.lastVisitedAtMs - a.lastVisitedAtMs ||
        b.updatedMs - a.updatedMs
      ));
      active = fallbackList[0];
    }
  }
  if (!active) {
    const overallStatus = workingThreads.length > 0 ? 'working' : 'idle';
    return {
      available: true,
      appStartMs,
      status: overallStatus,
      active: null,
      runningThreads: 0,
      threads: 0,
      workingThreads: [],
    };
  }

  let activeStatus = active.status;

  let overallStatus = 'idle';
  if (workingThreads.length > 0) {
    overallStatus = 'working';
  } else if (active.needsInput) {
    overallStatus = 'needs-input';
  }

  return {
    available: true,
    appStartMs,
    status: overallStatus,
    active: { ...active, status: activeStatus },
    runningThreads: workingThreads.length,
    threads: threads.length,
    workingThreads,
  };
}

function readState(stateFile) {
  const appStartMs = resolveAppStartMs(stateFile);

  if (!fs.existsSync(stateFile)) {
    return {
      available: false,
      appStartMs,
      status: 'idle',
      reason: `T3 Code state file not found: ${stateFile}`,
      active: null,
      runningThreads: 0,
      threads: 0,
      workingThreads: [],
    };
  }

  let db;
  try {
    db = new DatabaseSync(stateFile, { readOnly: true });
    const windowTitle = getWindowTitle();
    return buildSnapshot(openQueries(db), appStartMs, windowTitle);
  } catch (error) {
    return {
      available: false,
      appStartMs,
      status: 'idle',
      reason: `Could not read T3 Code state: ${error.message}`,
      active: null,
      runningThreads: 0,
      threads: 0,
      workingThreads: [],
    };
  } finally {
    try {
      db?.close();
    } catch {
      // nothing useful to do here
    }
  }
}

module.exports = {
  readState,
  buildSnapshot,
  openQueries,
  getWindowTitle,
  BUSY_RUN_STATUSES,
  TERMINAL_SUBAGENT_STATUSES,
};
