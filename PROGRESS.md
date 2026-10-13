# Progress

The coding agent keeps this file up to date. Tick a milestone only when its "Done when" checks in `docs/SPEC.md` pass, `npm test` passes, and the work is committed.

## Milestones

- [x] M1 Scaffold — F5 opens an Extension Development Host; the "Agent Sessions" log shows "activated"
- [x] M2 Model and store — per-file records, atomic writes, field-level merge, cross-window watcher
- [x] M3 Adapters — command-line matching (25+ cases) and session-file readers for claude, codex, pi
- [x] M4 Capture — terminal monitor, folder watcher, correlator; records appear within 5 s of the first prompt
- [x] M5 Restore — interrupted detection, startup prompt, Restore all, status bar item, `missing` handling
- [x] M6 UI — sidebar tree, history page, rename, pin, archive, copy command, open transcript
- [x] M7 Exact capture — launchers, hook installer and uninstaller, hook bridge, process-tree matching, import existing

## Owner testing

Sections of `docs/TESTING.md` the owner can run after each milestone:

| After | Run these sections |
| --- | --- |
| M1 | 1, 2 (smoke check only) |
| M4 | 2, 4.1–4.3 |
| M5 | 4.4–4.6 |
| M6 | 4.7–4.9 |
| M7 | 4.10–4.11, 5 |

## Milestone notes

### M1 Scaffold

- `package.json` at the repo root, TypeScript strict mode, esbuild bundle to `dist/extension.js`.
- Activates on `onStartupFinished`, opens the `LogOutputChannel` "Agent Sessions" and logs `activated`.
- Activity bar container `agentSessions` with tree view `agentSessions.tree` (placeholder item until M6).
- All 18 contributed commands registered as logging stubs so the manifest and UI are valid from M1; real behaviour lands per milestone.
- Added `test/unit` (Vitest, 9 tests) and a `@vscode/test-electron` smoke suite under `test/integration` (cannot run here: no `code` CLI).
- `npm run sandbox` is implemented (creates `.sandbox/`, launches `code` with fake-agent PATH and temp data roots); fake agents themselves arrive in M3.
- Deviation from spec layout: added `scripts/sandbox.mjs`, `vitest.config.ts`, `test/integration/run.mjs` and `test/integration/suite/` (the spec named these areas but not the exact files).

### M2 Model and store

- `src/model/types.ts`: `AgentId`, `SessionStatus`, `SessionRecord`, `PendingLaunch`, `SessionFileInfo`, plus `sessionKey`, `isSessionRecord` and `mergeSessionRecords`.
- `src/store/atomicWrite.ts`: write to a temp file in the same directory, `fsync`, then `rename` — a crash cannot leave a half-written record.
- `src/store/lock.ts`: cross-process mutex built on atomic `mkdir`, with staleness recovery and a timeout.
- `src/store/storageDir.ts`: the single `resolveStorageDir` from decision D3 (`AGENT_SESSIONS_STORAGE_DIR` → setting → `~/.agent-sessions`, with `~` expansion).
- `src/store/SessionStore.ts`: one file per `agent/sessionId`; `upsert` (field-level merge, newer `updatedAt` wins), `update` (field patch applied to the freshest on-disk copy under the lock), `delete`, `loadFromDisk`/`reload`, `onDidChange`, and a recursive `fs.watch` with a non-recursive fallback.
- `src/extension.ts` now resolves the storage dir, creates the store, logs `storage: <path>` and the record count, and disposes the store.
- Tests (23 total): create/load/update/delete, merge-by-`updatedAt` with optional fields preserved, no leftover `.tmp` files, cross-window watcher upsert+delete, storage-dir precedence, and **two real child processes** racing to update different fields of one record — both survive.
- Deviation: the spec's concurrency wording says "two concurrent writer processes"; the test bundles the store with esbuild on the fly and spawns two Node processes (`test/unit/helpers/updateField.ts`) to prove the lock works across processes, not just promises.

### M3 Adapters

- `src/agents/AgentAdapter.ts`: the `AgentAdapter` interface + `applyResumeTemplate`. Adding a harness is one file implementing this plus one `register(...)` line in `src/agents/registry.ts`.
- `src/agents/registry.ts`: `AgentRegistry` and `createDefaultRegistry`. Adding a harness touches only this file plus the new adapter file.
- `src/agents/commandLine.ts`: quote-aware tokenizer, wrapper stripping (`env`, assignments, `sudo`, `npx`/`bunx`/`pnpx`, `pnpm dlx`, `npm exec`), flag helpers.
- `src/agents/claude.ts`: matches `claude`/`claude-code`, ignores `-p`/`--print`/`mcp`/`doctor`/`update`/`config`/help; reads `projects/<encoded-cwd>/<id>.jsonl` (id = filename, cwd/branch/start/first prompt from the head); 200-char folder truncation handled.
- `src/agents/pi.ts`: matches `pi`/`pi-coding-agent`, ignores `-p`/`--print`/`install`/`export`/`auth`/help; reads `<sessions>/--<cwd>--/<ts>_<id>.jsonl` (header `type:session`, `session_info` name, first user message); cwd check prefers the header.
- **Codex dropped** per the owner's instruction. `AgentId` is now a plain string, so a Codex adapter can be added later without touching the model, the store or the UI. Removed `agentSessions.newCodex` and all `agents.codex.*` settings.
- Tests: 113 total; `commandLine` 19, `claude` 40, `pi` 31 — 70+ distinct command lines plus fixture-based readers.
- Fixtures are synthetic (not copied from real transcripts); the real on-disk layouts were inspected read-only to confirm them.

### M4 Capture

- `src/capture/Correlator.ts`: binds launches, session files and terminal events to records. Pure (clock injected), so it is unit-tested with synthetic events. Handles explicit-id launch, file-watcher match (oldest launch first), `/clear` rebinding with `parentSessionId`, existing-transcript activity updates (throttled 10 s), pending-launch expiry, and exited/closed transitions.
- `src/capture/SessionDirWatcher.ts`: watches each adapter's roots (or their nearest existing ancestor, so roots may be created later), debounces 250 ms, marks files already present at start as known, and emits `SessionFileEvent`s.
- `src/capture/TerminalMonitor.ts`: subscribes to `onDidStart/EndTerminalShellExecution` and `onDidCloseTerminal`, matches commands via the registry, and feeds the correlator.
- Fake agents in `test/bin/claude` and `test/bin/pi` (+ `.cmd` shims) write realistic session files under the three root env vars and honour `--session-id`, `--name`, `--resume`/`--session`, `/clear` and `/new`.
- Tests: 9 Correlator + 1 watcher unit tests, plus 3 integration tests in a real Extension Development Host (claude transcript, pi transcript, and a terminal launch bound with `shell-integration` / `high` confidence).
- Fixed a real macOS bug: VS Code reports `/var/...` while an agent's `process.cwd()` is `/private/var/...`; cwd comparison now resolves symlinks (`canonicalPath`/`pathsEqual`).
- `npm run test:integration` works without the `code` CLI: `@vscode/test-electron` downloads VS Code; `run.mjs` handles the macOS binary rename (`Code` instead of `Electron`) in recent builds.
- Confirmed `agentSessions` as an activity-bar container id now collides with a built-in in VS Code 1.141, so the container is `agentSessionKeeper` (the tree view stays `agentSessions.tree`).

### M5 Restore

- `src/restore/interrupted.ts`: pure `detectInterrupted(records, windowSessionId, liveTerminals)` — marks foreign `running`/`pending` records with no live terminal as `interrupted`, rebinds ones whose shell pid (or terminal name) is still alive after a reload. Unit-tested.
- `src/restore/Restorer.ts`: `resume`/`resumeMany` (500 ms apart). Checks the transcript exists first and sets `missing` with a warning if not; falls back to a folder picker when `cwd` is gone; creates a terminal with `AGENT_SESSIONS_TERMINAL_ID`; waits up to 3 s for shell integration then runs the resume command (or `sendText`); records `running`, `lastResumedAt` and the new `windowSessionId`.
- `src/restore/StatusBar.ts`: `$(history) N interrupted`, shown only when N > 0, click opens the restore picker.
- `src/restore/StartupRestore.ts`: runs on activation, applies `restoreOnStartup` (`prompt`/`always`/`never`), filters to the current workspace, and offers **Restore all** / **Choose…** / **Dismiss**.
- `agentSessions.resume` and `agentSessions.restoreInterrupted` are now real commands; the status bar refreshes on store changes.
- Integration tests: a session with a deleted transcript becomes `missing`; a session with a live transcript reopens in a terminal named after it and returns to `running`. The startup notification/status bar run at activation, so their logic is covered by the `detectInterrupted` unit tests rather than the integration run.

### M6 UI

- `src/ui/query.ts`: pure `filterSessions` (text/agent/status/workspace/date range, sort) used by the history page. Unit-tested with 500 synthetic records; the filter runs in well under 100 ms.
- `src/ui/SessionTreeProvider.ts`: groups **Interrupted**, **Running**, **This workspace**, **All workspaces**, pinned first, agent badge icon, relative time, rich tooltip, and Resume on click.
- `src/ui/HistoryPanel.ts` + `media/history.{html,css,js}`: webview with search, agent/status/workspace/date filters, sortable columns, multi-select Resume selected, per-row actions, and a `WebviewPanelSerializer`. Uses VS Code theme variables and text badges (C / π) rather than fixed colours.
- `src/ui/SessionCommands.ts`: Rename, Pin/Unpin, Archive, Copy resume command, Open transcript, Show terminal, Delete record (with confirmation). Registered as commands and reused by the webview.
- Manifest: `view/item/context` menus for the inline and context actions; `openHistory`/`refresh` wired; tree and history refresh on every store change.
- Integration tests: pin/archive, copy resume command (clipboard), open transcript, and opening + refreshing the history webview panel.
- The Rename prompt is interactive (`showInputBox`), so the write itself is covered by the M2 store tests and the command/webview wiring by the integration run.

### M7 Exact capture

- `src/agents/launcher.ts`: **New Claude Code Session** / **New pi Session** (and the `+` quick pick) generate a UUID, create a named terminal with `AGENT_SESSIONS_TERMINAL_ID`, and write the record immediately so it appears before the first prompt. Both agents support a preset id.
- `src/hooks/installer.ts`: installs the `SessionStart` / `UserPromptSubmit` / `Stop` hooks into `~/.claude/settings.json` and a pi extension into `~/.pi/agent/extensions/`, copying `hook.js` to `<storage>/bin/hook.js`. It is idempotent; uninstall removes only its own entries and restores the original `settings.json` bytes via a private backup, so install + uninstall is byte-identical.
- `resources/hook.js`: stdin JSON → one spool line; always exits 0 within milliseconds and prints nothing. `resources/pi-extension.ts`: a real pi extension using `pi.on('session_start'|'agent_start'|'agent_end')`, `ctx.sessionManager.getSessionId()/getSessionFile()` and `ctx.cwd`.
- `src/capture/HookSpoolReader.ts`: polls `spool/events-*.jsonl`, skips what was there at start, forwards complete lines.
- `Correlator.onHookEvent`: exact binding by `terminalId`, ancestor pid or pending launch; `SessionStart` with `source: clear|fork` sets `parentSessionId`.
- `src/import/importExisting.ts`: walks each adapter's session roots and backfills records (`via: import`). Wired to the command and the history page.
- Ancestor pids are computed inside `hook.js` and the pi extension with `ps` (macOS/Linux). Windows process-tree matching is not implemented; hooks there rely on `terminalId`.
- Tests: installer byte-identical round trip, `hook.js` spool output, spool reader, import-once, hook correlation; integration tests for the launcher, install/uninstall, import and a spooled hook event.
- `npm run package` produces `agent-session-keeper-0.0.1.vsix` (~38 KB, 17 files). Packaging needs `--allow-missing-repository` (no remote) and the README's relative links were made plain because `docs/` is not shipped.

### Post-M7 fixes (owner feedback)

- **A closed session no longer reappears under Running.** `Correlator.touchExisting` now only sets `running` when a terminal is still bound; a final transcript write after the terminal closed keeps the `closed`/`exited` status.
- **Resume no longer asks for a folder on every reopen.** `Correlator.bind` never overwrites a known `cwd` with an empty launch cwd, and `Restorer.resume` falls back to the cwd recorded in the transcript, then the workspace folder, before ever prompting. The resolved folder is persisted on the record, so the location and session id survive any number of close/reopen cycles.
- **Sidebar buttons**: Resume (green play) and Rename inline buttons removed; Resume is now click-the-session or right-click, Rename is right-click, Pin/Unpin is a pin icon. Added right-click **Copy Session ID**.
- **Auto-names and unique titles**: sessions without a user/agent name get a fallback name (`pi · folder · HH:MM`), and every title (capture, launcher, rename, import) is deduped against the listed sessions by appending ` (2)`, ` (3)`, … so two sessions never show the same name.

### Review fixes (applied from `REVIEW.md`)

Security and correctness changes after the external architecture/security review:

1. **S1+S2 shell injection / path traversal**: `isSafeSessionId()` rejects ids at capture, hook and resume time; `shellQuote()` single-quotes `${sessionId}`/`${cwd}`/`${title}` in resume templates and names in new-session commands; `transcriptPathFor` validates the id and checks the resolved path stays under the agent root.
2. **S3 permissions**: storage dirs are `0700`, records/spool/heartbeat files `0600`; the installer `chmod`s the storage dir, `bin/` and `hook.js`.
3. **A3 atomic settings.json**: `HooksInstaller` writes `~/.claude/settings.json` with `writeJsonAtomic` under `withFileLock`.
4. **A1 multi-window heartbeat**: each window writes `windows/<sessionId>.json`; `detectInterrupted` treats records whose window heartbeat is fresh as still running.
5. **A4 unhandled rejections**: every fire-and-forget event callback and `startup.run()` now catches and logs errors.
6. **A2 spool retention + incremental reads**: new `agentSessions.spoolRetentionDays` (default 7); `HookSpoolReader` prunes old files and reads incrementally from per-file offsets instead of the whole file.
7. **S4 fake-agent safety**: `test/bin/claude` and `test/bin/pi` refuse to run without their config env vars.
8. **P1 packaging**: `.vscodeignore` excludes `tsconfig.json`, `esbuild.mjs`, `vitest.config.ts`, `PROGRESS.md`, `AGENTS.md`, `CLAUDE.md`, `START_HERE.md`, `REVIEW.md`.
9. **P2 manifest/repo**: added `repository`, `keywords`, `icon` (128×128 PNG), `LICENSE`, `preview: true`, removed `private: true` and `--allow-missing-repository`.
10. **A5 launcher**: a launcher now writes `pending` and capture flips it to `running`.
11. **A6 archived**: `Correlator.bind` skips archived records instead of silently un-archiving them.
12. **A7 exact terminal lookup**: `showTerminal` uses the bound terminal reference; the name match is only a fallback.
13. **S6 tooltip**: tree tooltips build untrusted title/cwd with `appendText()`.
14. **A8 partial**: pi extension spool-dir refactor done; the mkdir lock's atomicity already prevents double-acquire (noted, no change); a degraded-store mode was left out as optional.

Left as-is per the review's "explicitly not problems" list: mkdir-lock design, global `~/.agent-sessions`, JSON-per-record, polling spool reader (beyond item 6), no Codex support.

### Review follow-ups (v0.0.2 verification)

- **F1** — `ensureStoragePermissions(storageDir)` now chmods the storage root, `sessions/`, `spool/`, `windows/` and `bin/` to `0700` once per activation, so a storage dir created by 0.0.1 is upgraded without waiting for a hook install.
- **F2** — `TerminalMonitor` deletes closed terminals from `terminalsByKey` in `onDidCloseTerminal` (no per-window reference leak).
- Spool pruning now also runs when the date rolls over in a long-lived window (not only at startup).
- README notes that PowerShell is the safe default on Windows for quoted titles.

### Second review (REVIEW-2.md)

All 10 fix-list items applied, one commit each (`R2-1`…`R2-10`): exec-form Claude hooks with an explicit spool dir, spool path templated into the pi extension, user-scoped settings + hook-storage guard, `bind` split into `create`/`attach`, subagent transcripts ignored, resume focuses a running session, single-window ownership + compare-and-set restore claim, terminals re-linked after reload, resume-by-name/path as a pending resume, and small hardening (plain-text titles, store-only lookups, transcript root check, heartbeat pid, settings re-read).

## Decisions

### D1 — Runtime vs. session recordings

Two different things are stored, and they must not be confused:

| Data | Where | Lifetime |
| --- | --- | --- |
| **Session recordings** (the thing this extension exists for) | one global history folder in `~/.agent-sessions/`, shared by every project and window | kept until the user deletes them; this is the durable artifact |
| **Runtime state** (which terminal currently holds which session) | in memory in each extension host only, never written to disk | dies with the window, rebuilt on activation |

Because terminals do not survive a restart, the runtime map is deliberately not
persisted. On activation it is rebuilt from `window.terminals` by matching
`shellPid` and terminal name.

### D2 — One global history folder (confirmed by owner)

Recordings default to a single shared history in `~/.agent-sessions/`, not a
file inside each project. Layout:

```text
~/.agent-sessions/
  sessions/
    claude/<sessionId>.json
    codex/<sessionId>.json
    pi/<sessionId>.json
  spool/events-YYYY-MM-DD.jsonl   # hook events, append-only, pruned after 14 days
  bin/hook.js                     # hook bridge, copied on activate
```

**Why global:**

1. **Resume must work from anywhere.** Claude and pi can resume a session from
   any directory; Codex records a `cwd` too. A record that lived only inside its
   project folder would be invisible when you open a different folder — exactly
   the case where you want to get back a session.
2. **Cross-window visibility.** The spec requires two VS Code windows to see
   each other's sessions over "All workspaces". A per-project file cannot be
   read by a window that has not opened that project.
3. **One writer per file, no partition logic.** One file per session keeps each
   write independent, so concurrent windows never rewrite a shared index. A
   per-project layout would still need a global index for cross-window views.
4. **The hook script has one place to write.** Hooks may run in a shell without
   a VS Code workspace (tmux, ssh) and cannot be told which project file to use;
   one spool directory is the only layout that always works.
5. **History is a personal log.** The owner wants "every agent session I ran",
   which is inherently global, not scoped to whichever folder happens to be open.

**Why not the alternative:** a per-project file would fragment history across
repositories, make "All workspaces" and startup restore incomplete, and require
an index anyway. It buys nothing for a single-machine personal tool.

### D3 — Keep the choice cheap to reverse

Even though global is the default, all path resolution goes through one
function so a future per-project option is a small change:

1. `resolveStorageDir(context)` returns the storage root, in this precedence:
   1. `AGENT_SESSIONS_STORAGE_DIR` environment variable (sandbox, integration tests);
   2. the `agentSessions.storageDir` setting when non-empty;
   3. `~/.agent-sessions`.
2. `SessionStore` receives that root and never calls `homedir()` itself. Every
   path (`sessions/`, `spool/`, `bin/`) is derived from it in one place.
3. Agent session roots (read-only) use a separate resolver per adapter that
   honours `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `PI_CODING_AGENT_DIR` and the
   per-agent `sessionRoot` setting — unrelated to the recording store.

If a per-project mode is ever wanted, only `resolveStorageDir` changes; the
store, spool and hook script keep working unchanged.

### D4 — Harness scope: claude and pi now, anything later

Focus on `claude` and `pi`. Codex is explicitly out of scope per the owner, but
the architecture is harness-agnostic so it (or any other agent) can be added
later with minimal work:

1. `AgentId` is a plain string; the model, store and UI never hard-code a list
   of agents. `SessionStore` loads whatever `sessions/<agent>/` folders exist.
2. All agent-specific behaviour lives behind `AgentAdapter`. A new harness is
   one file plus one `register(...)` line in `createDefaultRegistry`; it then
   gets command matching, file reading, capture, restore and UI for free.
3. Settings and manifest entries are per-agent and can be added the same way.

Only claude and pi are verified against the real binaries here; Codex is not
installed on this machine.

### D5 — Decisions from the second review (REVIEW-2.md)

- **Hook storage guard (item 3).** `isHookStorageDirSafe` skips the "inside home" check when `AGENT_SESSIONS_STORAGE_DIR` is set explicitly (sandbox/integration harness), but always rejects a folder inside an open workspace.
- **Ownership (item 7).** `detectInterrupted` now returns four lists — `interrupted`, `stillRunning`, `rebound`, `aliveElsewhere` — instead of two; `StartupRestore` rewrites `windowSessionId` only for `rebound`, and a `SessionStore.claimForRestore` compare-and-set prevents two windows restoring the same session.
- **Settings re-read (item 10).** Only the live `titleFromFirstPrompt` flag is applied on `onDidChangeConfiguration`; structural settings (storage, roots, resume command) still need a window reload, which is logged.
- **Resume focus (item 6).** `ResumeOutcome` gained `'focused'`; clicking a running session focuses its terminal instead of opening a second agent.

## Environment notes

Checked at handoff (macOS, Apple Silicon), updated through M7:

- Node v24.14.0, npm 11.9.0, git 2.54.0 — all fine (Node 20+ required).
- `claude` 2.1.220 and `pi` 1.1.0 are installed and both support `--session-id` and `--name`.
- Integration tests run here: `npm run test:integration` downloads VS Code via `@vscode/test-electron` (no `code` CLI needed). `test/integration/run.mjs` handles the recent macOS binary rename (`Code` instead of `Electron`).
- `npm run sandbox` still needs the `code` CLI on `PATH` (Command Palette → **Shell Command: Install 'code' command in PATH**); it opens a throwaway Extension Development Host with the fake agents.
- Codex is intentionally out of scope (decision D4). `docs/SPEC.md` still describes it as it was handed over; D4 supersedes those parts.
