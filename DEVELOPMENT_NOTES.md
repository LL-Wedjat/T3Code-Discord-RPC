# Development notes — standalone Discord RPC bridge for T3 Code

This document explains the whole process: the original question, what I inspected, why I chose the
design I did, what I built, how it was verified, and what the remaining limitations are.

## 1. The starting question

The user asked: *"I want to slop up a Discord RPC integration for T3 Code. How hard would it be?"*
"Slop up" was read as "throw together quickly", so the goal was a fast, low-friction integration,
not a production-grade upstream feature.

The working directory was an empty scratch folder:

`C:\Users\Wedjat\.t3\scratch\2026-11-20-i-want-to-slop-up-90c14e14`

There was no T3 Code source checkout in it, so the first job was to find out what T3 Code actually
is on this machine and what hooks it exposes.

## 2. Investigation of the installed T3 Code app

### 2.1 Where the app lives

I found the installed nightly build at:

`C:\Users\Wedjat\AppData\Local\Programs\t3code`

Key contents:

- `T3 Code (Nightly).exe` — a ~369 MB Electron executable.
- `resources\app.asar` (~20 MB) — the Electron main/renderer bundle.
- `resources\server.asar` (~268 MB) — the bundled local server.
- `resources\app.asar.unpacked`, `resources\server.asar.unpacked` — native modules.

The app's `package.json` inside `app.asar` contained:

```json
{
  "name": "t3code",
  "version": "0.1.12-nightly.20261120.4994",
  "main": "apps/desktop/dist-electron/boot.cjs",
  "license": "MIT",
  "homepage": "https://t3.codes"
}
```

So T3 Code is an Electron desktop app wrapping a local Node server, MIT licensed.

### 2.2 Reading the asar bundles

Because the scratch folder had no source, I wrote a small asar reader in the temp folder
(`C:\Users\Wedjat\AppData\Local\Temp\opencode\asar.cjs`) that parses the asar header, walks its
file tree, and extracts individual files. With it I pulled out:

- `apps/desktop/dist-electron/main.cjs` (~6.6 MB, bundled Electron main process)
- `apps/desktop/dist-electron/preload.cjs`
- `apps/server/dist/server-XcuWCaQQ.mjs` (~4.7 MB, bundled server)

Then I grepped those bundles for integration points.

### 2.3 Findings from the bundles

**No existing Discord support.** Searching `main.cjs` and `server-*.mjs` for `discord`,
`presence`, and `rich presence` found no real integration (only unrelated words in long
compressed dictionaries).

**No plugin/extension API in the desktop app.** Searches for `plugin`, `extension`, `hooks`
in `main.cjs` turned up only generic schema/relay code — nothing user-extensible. So modifying
behavior requires either patching source or running a separate process.

**The local server has a rich HTTP/SSE API.** In `server-XcuWCaQQ.mjs` I found routes such as:

- `GET /api/session`
- `GET /api/session/active`
- `GET /api/event` (Server-Sent Events)
- `GET /api/config`
- `/global/event` (WebSocket-ish route)

And event schemas including:

- `session.created` / `session.updated` / `session.deleted`
- `session.idle`, `session.error`, `session.status`
- `message.updated`

`SessionInfo` carries exactly the data a presence integration needs:

```
id, slug, projectID, directory, path, parentID, summary, cost, tokens,
title, agent, model, version, metadata, time
```

So the data was available; the problem was authentication. The app has bearer-token sessions
(`auth_sessions` table, `server-signing-key.bin`, Clerk, DPoP, etc.), meaning a standalone script
would have to scrape a token from the app/keyring to use the API — brittle.

**Runtime state file.** `C:\Users\Wedjat\.t3\userdata\server-runtime.json` showed the local server
on port `3773`, and `userdata\statev2.sqlite` (~96 MB + WAL) held all thread state.

### 2.4 Upstream repository

A web search confirmed the project is open source: <https://github.com/pingdotgg/t3code> (MIT).
Its README/AGENTS.md describe an Effect-heavy monorepo:

- `apps/server` — WebSocket/orchestration/providers
- `apps/web`, `apps/desktop`, `apps/mobile`
- `packages/contracts`, `packages/shared`, `packages/client-runtime`

Important: the README says they are "mostly not accepting contributions yet" and "big features
will not be" considered. So an upstream PR for Discord presence was a dead end; a fork or
standalone app was required.

I also fetched the desktop source layout from GitHub (`apps/desktop/src/main.ts`,
`apps/desktop/src/electron/*`). `main.ts` builds the app out of many Effect layers
(`Layer.mergeAll`, `Layer.provideMerge`, etc.). A clean in-app integration would mean adding a new
layer and wiring it in — doable, but a real chunk of work.

### 2.5 Initial assessment given to the user

I presented two routes:

| Route | Effort | Catch |
| --- | --- | --- |
| Standalone sidecar reading local state + Discord RPC | ~2–4 h | Needs auth token if using the API; brittle |
| Fork + Electron main-process layer | ~1–3 days | Must match Effect architecture; no upstream acceptance |

The user replied: **"No, I want a standalone app"** — so I built the standalone route as a real
program rather than patching T3 Code.

## 3. Choosing how the standalone app reads T3 Code state

I rejected using the authenticated HTTP API because a separate app would have to obtain and
refresh a bearer token that the desktop app owns. Instead I explored the SQLite state file with
`node:sqlite` (built into the installed Node 26) using read-only connections.

Schema exploration showed:

- `projection_threads` — empty/legacy in this install.
- `orchestration_v2_projection_threads` — the real thread table, with `thread_id`, `title`,
  `default_provider`, `updated_at`, `archived_at`, `deleted_at`, and a `payload_json` blob.
- `projection_projects` — project title/workspace root.
- `orchestration_v2_projection_provider_sessions` — `status` values like `running`, `ready`,
  `stopped`; this tells us whether a thread is actively working.
- `orchestration_v2_projection_provider_threads` — `status` values like `active`, `idle`.
- `orchestration_v2_projection_runtime_requests` — `status` values like `pending`, `resolved`,
  `cancelled`; useful for a "needs input" state.
- `auth_sessions` — bearer sessions (not used by this app).

A sample `payload_json` from the current thread contained:

```json
{
  "id": "71f9bafe-...",
  "title": "Discord RPC Integration Difficulty",
  "modelSelection": { "model": "opencode/hy4-flash-free", ... },
  "worktreePath": "C:\\Users\\Wedjat\\.t3\\scratch\\...",
  "lineage": { "parentThreadId": null, ... },
  "createdAt": "2026-11-20T21:31:02.148Z",
  "lastVisitedAt": "2026-11-20T21:40:44.721Z",
  "opens": { "openedAt": 1795210262404, ... }
}
```

This gave a clean, token-free data source. The tradeoff: it depends on T3 Code's internal DB
schema, which could change in an update. I documented that as a limitation.

## 4. What I built

A standalone Node.js app named `t3code-discord-rpc` in the scratch folder. Dependencies: only
`@xhayper/discord-rpc` (pure JS Discord IPC client, no native build). Node 26 provides
`node:sqlite` and all other needed APIs.

### 4.1 Files created

| File | Purpose |
| --- | --- |
| `package.json` | App metadata, `start` / `init` / `once` scripts, dependency. |
| `config.example.json` | Example config with all options. |
| `.gitignore` | Ignores `node_modules/`, local `config.json`, logs. |
| `src/index.js` | CLI entry: argument parsing, config load, poll loop, signal handling. |
| `src/config.js` | Defaults, config path resolution, template creation, env overrides. |
| `src/t3-state.js` | Read-only SQLite reader; picks the active thread and derives status. |
| `src/presence.js` | Discord RPC client wrapper: activity building, throttling, reconnect. |
| `README.md` | Setup guide, config reference, CLI flags, limitations. |
| `DEVELOPMENT_NOTES.md` | This document. |
| `start-hidden.vbs` | Windows launcher with no console window. |
| `install-autostart.cmd` / `install-autostart.ps1` | Creates a Startup shortcut on Windows. |

### 4.2 `src/config.js`

- Defaults: empty `clientId`, `pipeId: 0` (auto/default pipe 0-9), `pollIntervalMs: 500`, `activityName: 'T3 Code'`,
  `showProject: true`, `showModel: true`, empty asset keys, empty buttons, `workingMessage: 'Working for'`,
  `idleMessage: 'Idle in'`, `clearWhenNoThread: true`, `debug: false`.
- Automatic migrations: legacy `pollIntervalMs` of 5000 or 2000 ms automatically migrates to 500 ms. Legacy `workingMessage: 'Working on'` migrates to `'Working for'`. Clamps `pollIntervalMs` to at least 250 ms.
- Schema validation: validates string fields, pipe ID range (0–9), positive polling interval, and valid button label/url structures with explicit error messages.
- Config path: `%APPDATA%\t3code-discord-rpc\config.json` on Windows, otherwise
  `~/.config/t3code-discord-rpc/config.json`. Overridable with `T3CODE_RPC_CONFIG` or `--config`.
- State file default: `~/.t3/userdata/statev2.sqlite`, overridable with `T3CODE_STATE_DB` or
  `--state-file`.
- `--init` writes a template; it refuses to overwrite an existing config.

### 4.3 `src/t3-state.js`

- Opens the state DB with `new DatabaseSync(path, { readOnly: true })` each poll and closes it in
  a `finally`. Read-only + WAL works alongside the running server.
- Queries: threads (joined to projects), provider sessions, runtime requests, projection runs, projection subagents, and thread visit events.
- Parses `payload_json`; skips archived/deleted/snoozed threads. Excludes genuine background subagent threads (`lineage.relationshipToParent === 'subagent'`, `createdBy === 'agent'`, or prefix `thread:subagent:` / `thread:delegated-task:`) while explicitly retaining user-created thread forks as root threads.
- Window title detection (Windows): probes Electron window title via PowerShell to instantly focus the active thread, resolving subagent window titles back to parent threads. Fallback relies on recent visit events, then opens/updates timestamps.
- Run timer & episode start tracking:
  - Busy detection anchors to the latest run with a busy status and no `completed_at`.
  - Timer reflects current run turn (`requested_at`), resetting when a new run starts.
  - Orchestrating state: When subagents are running without a local busy run, anchors timer to the parent run `requested_at`.
- Returns a snapshot `{ available, appStartMs, status, active, runningThreads, threads, workingThreads }`.

### 4.4 `src/presence.js`

- Uses `@xhayper/discord-rpc`'s `Client`. Handlers:
  - `ready` → mark connected, reset backoff, flush pending activity.
  - `disconnected` → reset the client object and schedule reconnect.
- Reconnect uses exponential backoff 5s → 60s, with guards so the failure path and the
  `disconnected` event don't double-schedule.
- `buildActivity(config, snapshot)` maps:
  - Multi-thread (2+ running): summarized active duration, active agents count, working thread count, and joined titles in asset tooltip.
  - Single working thread: shows turn duration and project (omitting redundant project names identical to thread title or "No project").
  - Orchestrating: `Orchestrating N agent(s) · <duration>`.
  - Idle / Needs input: cleanly formatted without stale run duration.
  - App start uptime timestamp passed to Discord's elapsed counter.
  - UTF-8 byte truncation with surrogate pair boundary safety.
- Rate-limit throttling and safety caps:
  - Structural changes (thread switch, status change) dispatched immediately (0ms throttle).
  - Duration-only ticking changes throttled to 5000ms via `structuralKey()`.
  - Rolling safety cap: maximum 4 writes per 20 seconds. If triggered, defers sending and logs telemetry.
- `stop()` clears activity, destroys the client, and cancels timers.

### 4.5 `src/index.js`

- CLI entry with shebang `#!/usr/bin/env node`.
- Flags: `--init`, `--once`, `--config`, `--client-id`, `--state-file`, `--pipe-id`,
  `-v/--verbose`, `-h/--help`.
- `--once` prints the detected state as JSON and exits — useful for verifying T3 detection
  without Discord or a client ID.
- Missing/placeholder client ID prints setup instructions and exits with code 1.
- Poll loop uses chained `setTimeout` (500ms default), logs only on signature changes unless
  verbose, and handles SIGINT/SIGTERM to stop cleanly.
- `--once` prints the detected state as JSON and exits — useful for verifying T3 detection
  without Discord or a client ID.
- Missing/placeholder client ID prints setup instructions and exits with code 1.
- Poll loop uses chained `setTimeout` (never overlapping), logs only on signature changes unless
  verbose, and handles SIGINT/SIGTERM to stop cleanly.
- `--verbose` also turns on internal debug logging.

### 4.6 Windows helpers

- `start-hidden.vbs`: uses `WScript.Shell.Run "node ...", 0, False` to run hidden; assumes Node
  is on PATH.
- `install-autostart.cmd`: calls a small PowerShell script that creates a `.lnk` in the user's
  Startup folder pointing to `wscript.exe` with `start-hidden.vbs` as its argument. I verified the
  PowerShell script parses cleanly, but I did **not** run it, since that would modify the user's
  startup settings without being asked.

## 5. Problems found and fixed during implementation

1. **Noisy reconnect loop.** The first test with a dummy client ID produced repeated
   `Discord RPC disconnected` messages. Cause: both the library's `disconnected` event and the
   failed `login()` catch path scheduled a reconnect. Fixed by:
   - recreating the `Client` on each attempt,
   - ignoring stale events from old client objects (`if (this.client !== client) return`),
   - ignoring `disconnected` while `connecting`,
   - centralizing cleanup in `resetClient()`.
   After the fix, reconnects happen once per backoff interval.

2. **Possible duplicate presence send after reconnect.** `ready` originally reset `lastKey` to
   `null`, so the next poll would resend the same activity. Fixed by setting `lastKey` from the
   pending activity when ready fires.

3. **PowerShell quoting in the autostart installer.** The original one-line `powershell -Command`
   had fragile escaping for the VBS path. Replaced it with a separate `install-autostart.ps1`
   script that takes `-Root` as a parameter.

4. **Fake-RPC test needed a pipe override.** Discord is actually running on this machine, so
   pipe 0 was occupied and a dummy client ID was rejected by the real client. I added a `pipeId`
   config/CLI option so the end-to-end test could target a fake server on pipe 1. This is also
   useful for users running multiple Discord instances.

## 6. Verification performed

1. **Syntax checks:** `node --check` passed for all source files (`index.js`, `config.js`, `t3-state.js`, `presence.js`).
2. **Automated unit tests:** Node native test runner (`node --test`) covering:
   - State filtering (root thread & user fork retention, genuine subagent exclusion).
   - Window title probe matching and subagent title resolution to parent.
   - Run busy resolution and per-turn episode duration tracking.
   - Orchestrating timer resolution anchored to parent run request.
   - Multi-thread, single-thread, orchestrating, and idle presence formatting.
   - Redundant project name suppression.
   - UTF-8 byte boundary truncation and surrogate pair handling.
   - Config loading, clamping, auto-migrations, validation, and template writing.
   - Presence throttling, structural key stability, and rate-limit safety cap telemetry.
3. **State detection:** `npm run once` correctly reports active snapshot, projects, and working threads.
4. **CI Workflow:** Matrix testing on Ubuntu and Windows across Node.js 22.x and 24.x.

## 7. Usage recap

```powershell
npm install              # install dependencies
npm run init             # create config at %APPDATA%\t3code-discord-rpc\config.json
npm run once             # sanity-check T3 detection
npm test                 # run automated test suite
npm run check            # verify syntax and run tests
npm start                # run the bridge (Discord desktop must be open)
```

Set `clientId` in the config to your own Discord application ID from
<https://discord.com/developers/applications>. Optionally upload artwork assets and set
`largeImageKey` / `smallImageKey`. On Windows, run `install-autostart.cmd` if you want it to
launch at login.

## 8. Known limitations

- **You need your own Discord application ID and assets.** The app ships none.
- **Discord desktop must be running.** The RPC client reconnects with backoff when it isn't.
- **State DB schema dependency.** The app reads `orchestration_v2_projection_*` tables and
  `payload_json` fields directly. A T3 Code update could change these; `npm run once` is the
  quick way to diagnose that.
- **No auth-token use.** Reading the DB avoids credentials entirely, but it also means this only
  works for a local T3 Code install on the same machine — not a remote T3 Connect environment.
- **Presence rate limiting.** Structural updates dispatch immediately; duration-only ticking updates are throttled to 5s, with a 4-writes-per-20s rolling safety cap.
- **System Tray Icon / Settings UI (Deferred):** The bridge is designed as an ultra-lightweight, headless background service (~20MB memory). Adding Electron or a native GUI library would introduce heavy dependencies, bloated binaries, and platform-specific windowing issues for minimal gain over JSON configuration and startup scripts.
- **Executable Code Signing (Deferred):** Distributed purely as standard Node.js source files without compiling to native binary packages or installers. Code-signing certificates are unnecessary for script execution.
- **Windows helpers assume Node on PATH.** `start-hidden.vbs` and the autostart shortcut do not
  bundle a Node runtime.
