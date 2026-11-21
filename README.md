# t3code-discord-rpc

A standalone Discord Rich Presence bridge for [T3 Code](https://t3.codes/). It runs as its own
process — no fork, no patching, no T3 Code auth token. It reads T3 Code's local SQLite state
(`~/.t3/userdata/statev2.sqlite`) and pushes the current thread as your Discord activity.

## Desktop app (Windows .exe)

The project includes an Electron-based desktop application providing a full graphical interface and system tray integration.

### Quick run and build
- **Install dependencies:**
  ```powershell
  npm install
  ```
- **Run in development:**
  ```powershell
  npm run electron
  ```
- **Build Windows installer & portable exe:**
  ```powershell
  npm run dist
  ```
  Build artifacts are generated in `dist-electron/` (x64 architecture, NSIS installer with desktop shortcut and custom icon, as well as a standalone portable `.exe`).

### Desktop GUI features
- **Overview tab:** Live presence status, detected threads list, and controls to start, stop, or re-poll the bridge.
- **Settings tab:** Full configuration editor for all options, including a file picker to locate your T3 Code state SQLite database.
- **Logs tab:** Real-time log viewer for bridge operations and diagnostic messages.
- **System Tray:** Minimizes to the Windows system tray with context menu controls for **Show/Hide**, **Start/Stop**, and **Quit**.

## CLI / headless usage

### Installation

#### Prerequisites
- Node.js >= 22.5.0 (`node:sqlite` built-in support required)
- Discord desktop app running locally
- T3 Code running locally

#### Global install or running via npx
```bash
npm install -g t3code-discord-rpc
t3code-discord-rpc --init
```

Or clone / download this repository directly:
```powershell
npm install
npm run init        # writes %APPDATA%\t3code-discord-rpc\config.json (Windows) or ~/.config/...
npm run once        # verify T3 Code thread detection (no Discord needed)
```

## Discord Application Setup

1. Go to <https://discord.com/developers/applications> and click **New Application**. Name it e.g. "T3 Code".
2. Under the **General Information** page, copy the **Application ID**.
3. Paste the Application ID into `clientId` in your `config.json` file (or pass via `--client-id <id>`).
4. (Optional) Under **Rich Presence → Artwork Assets**, upload images:
   - Upload an icon for the large image (e.g. name it `t3code`).
   - Add the key to `largeImageKey` in your config.
5. Run the bridge:
```powershell
npm start
# or if installed globally:
t3code-discord-rpc
```

## Quick start

```powershell
npm install
npm run init        # writes %APPDATA%\t3code-discord-rpc\config.json
npm run once        # verify T3 Code thread detection (no Discord needed)
npm start           # runs the presence bridge
```

## What it shows

- **Details:** current thread title (the focused thread, matched via Electron window title or visit heartbeats)
- **State:**
  - Multi-thread (2+ running): `5 agents · 2 threads · 12m` when subagents are active, or fallback `Working for 48m across 2 threads` when no subagents are active (wall-clock active working time from earliest start across all working threads)
  - Single thread orchestrating subagents: `Orchestrating 2 agents · 11m 42s` (active when the thread is waiting on subagents)
  - Single thread running: `Working for 11m 42s in <project>` (shows current run/turn duration while active; resets when a new run begins, matching T3's own 'Working for X' display; project omitted if redundant or "No project")
  - Idle / Needs input: `Idle in <project>` / `Needs input in <project>` (idle shows no duration; project omitted if redundant or "No project")
- **Start timestamp:** Discord's elapsed timer shows total T3 Code uptime (from `server-runtime.json` `startedAt`)
- **Image text:**
  - Multi-thread (2+ running): other running thread titles joined with dots, e.g. `Fix RPC · Analyze Relationship History` (byte-truncated to 128 bytes)
  - Single thread / default: `T3 Code · <model>` (override with `largeImageText`)

Discord allows one activity, so the bridge summarizes all running threads into a single presence: the headline is the focused thread, the status shows wall-clock active time across running threads, and any other running thread titles appear in the image tooltip.

### Focus detection & thread filtering
Presence follows the thread actively focused in the UI:
1. **Window title probe (Windows):** Probes the T3 Code Electron main window title (`project / thread` format) to identify the currently displayed thread immediately.
2. **Visit heartbeats fallback:** T3 Code records `thread.visit-recorded` events in `orchestration_events` roughly every 10s for the open thread. If the window title is unavailable, threads with recent visit heartbeats take priority.
3. **Opens fallback:** Falls back to command-palette opens (`opens.openedAt`), last visited, and updated timestamps.

User-created forks (e.g. `createdBy: "user"` with `lineage.relationshipToParent: "fork"`) are retained as first-class candidate threads. Genuine background subagents and delegated task threads are excluded from root thread lists.

### Run timer & orchestrating state
- **Per-turn run timer:** When a thread is active (busy or orchestrating subagents), its active duration measures the current T3 Code run/turn and resets when a new run begins, matching T3's own 'Working for X' display. If the thread is busy, it uses the current run's `requested_at`; if the thread is waiting on subagents without a busy local run, the timer stays anchored to the parent run that spawned the subagents (`requested_at`) and keeps counting through the wait until the parent picks the work up again with a new run.
- **Orchestrating state:** While a thread is waiting on background subagents without a running local run, presence reports `Orchestrating N agents · <duration>` instead of plain `Working for` or `Idle`.

### Discord rate-limit throttling
To avoid hitting Discord RPC rate limits from ticking elapsed seconds:
- Structural changes (thread switch, status change from idle to working, etc.) are dispatched immediately (subject to a 4-writes-per-20s rolling safety cap).
- Ticking duration-only changes are throttled to every 5 seconds (5000ms).
- When the 4-writes-per-20s rolling safety cap is reached, updates are deferred until the oldest write window expires, and a telemetry message is logged.
- All string truncations enforce Discord's UTF-8 byte limits (128 bytes for text fields, 32 bytes for button labels) with unicode surrogate pair protection.

## Config

| Key | Default | Notes |
| --- | --- | --- |
| `clientId` | `""` | Discord application ID (required string). |
| `pipeId` | `0` | Discord IPC pipe ID (0–9; `0` = default / first instance). Useful when running multiple Discord clients (e.g. Discord Stable vs Discord PTB/Canary) or testing with mock pipes. |
| `stateFile` | auto | Override path to `statev2.sqlite`. |
| `pollIntervalMs` | `500` | State polling interval in ms (default 500ms, clamped to >= 250ms); structural changes sent immediately (subject to rolling safety cap), duration text every 5s. Old values of 2000ms or 5000ms automatically migrate to 500ms. |
| `activityName` | `T3 Code` | The app name shown in Discord. |
| `showProject` | `true` | Include project name in the state line. |
| `showModel` | `true` | Include model in `largeImageText`. |
| `largeImageKey` / `smallImageKey` | `""` | Asset keys from your Discord app. |
| `largeImageText` / `smallImageText` | `""` | Tooltip text for assets. |
| `buttons` | `[]` | Up to two `{ "label": "...", "url": "https://..." }`. |
| `workingMessage` / `idleMessage` | `Working for` / `Idle in` | State verbs. Any legacy `"Working on"` migrates to `"Working for"`. |
| `clearWhenNoThread` | `true` | Clear presence when there is no active thread. |
| `debug` | `false` | Verbose logging. |

Config lives at `%APPDATA%\t3code-discord-rpc\config.json` on Windows and
`~/.config/t3code-discord-rpc/config.json` elsewhere. Override with `--config <path>`.

### Multiple Discord Clients & `pipeId`
Discord uses local named pipes (`\\?\pipe\discord-ipc-0` through `9` on Windows, or `$XDG_RUNTIME_DIR/discord-ipc-0` on Linux/macOS). If you run multiple instances (such as Stable on pipe 0 and Canary or PTB on pipe 1), set `"pipeId": 1` in your config or pass `--pipe-id 1` on the command line to target a specific Discord client instance.

## CLI flags

```
--init                 write a config template and exit
--once                 print detected T3 Code state and exit (no Discord needed)
--settings             open local settings web UI in browser
--config <path>        use a specific config file
--client-id <id>       override the Discord application ID
--state-file <path>    override the T3 Code state SQLite path
--pipe-id <n>          force a Discord IPC pipe (0-9, 0 = default)
-v, --verbose          log every poll and debug telemetry
-h, --help             show help
```

## Run hidden / at startup (Windows)

`start-hidden.vbs` launches the bridge without a console window. To auto-start it, put a shortcut
to that script in `shell:startup` (`Win+R` → `shell:startup`). Or run `install-autostart.cmd`
to create the shortcut automatically.

### Settings UI

Run `npm run settings` (or `node src/index.js --settings`) to open a local configuration page in your browser at `http://127.0.0.1:8765` for editing config without touching JSON. The port can be changed with `T3CODE_RPC_SETTINGS_PORT`. The page saves to the same config file and validates input.

### System tray (Windows)

Run `powershell -File tray.ps1` to get a system tray icon with menu options for Open settings / Start bridge / Stop bridge / Exit.

### Windows package and code signing

electron-builder produces the Windows installer and portable `.exe` packages via `npm run dist`. For standalone ZIP distributions and code signing, run `powershell -File scripts\package-windows.ps1` to build `dist\t3code-discord-rpc-<version>.zip`. If `T3CODE_SIGN_THUMBPRINT` or `T3CODE_SIGN_PFX` (plus `T3CODE_SIGN_PASSWORD`) and optional `T3CODE_SIGN_TIMESTAMP` are set, the optional `scripts\sign-windows.ps1` script can sign the binaries/zip with signtool when a certificate is configured. Without a certificate it still builds an unsigned distribution.

## Testing

Run unit tests via Node's native test runner:
```powershell
npm test
```

Run code syntax and type checks alongside tests:
```powershell
npm run check
```

The Electron UI can also be captured in headless/automated mode:
```powershell
npx electron app/main.js --screenshot <path>
```

The test suite covers:
- Exclusion of genuine subagents while retaining user forks.
- Window title thread selection and subagent title resolution to parent threads.
- Run state evaluation (`busy` status anchored to running runs without completion).
- Per-turn run timers and orchestrating episode start resolution.
- Presence formatting across single-thread, multi-thread, and orchestrating scenarios.
- UTF-8 byte truncation and surrogate pair preservation.
- Configuration validation, schema migrations, and template generation.
- Rate-limiting telemetry and throttling behavior.

## Notes & Limitations

- **Discord desktop required:** Discord desktop must be running; the RPC client reconnects with exponential backoff if it is closed or restarted.
- **State DB schema dependency:** This reads T3 Code's local state database directly. Schema updates to T3 Code could require adjustments; verify detection with `npm run once`.
- **Read-only access:** No credentials or tokens are stored or accessed; state is read directly from SQLite with read-only locks.
- **System Tray Icon / GUI:** The full GUI and tray integration are provided in the Electron desktop app; `tray.ps1` remains available as a lightweight tray-only alternative.
- **Windows Packaging & Code Signing:** Packaged distribution archives and optional Authenticode signing via signtool are supported; see [Windows package and code signing](#windows-package-and-code-signing).

## License

This project is licensed under the MIT License. The MIT `LICENSE` file is included in this repository.
