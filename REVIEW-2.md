# Agent Session Keeper — Architecture & Security Review

Oct 12, 2026 · @Danny

## Verdict

The build is well structured and well tested, but it is not ready to rely on yet: four high-severity bugs break exact capture and corrupt session titles, and one high-severity security issue lets a repository's settings run commands. All five are confirmed against the real code with probe tests, and each fix is small.

The repo's own `REVIEW.md` calls v0.0.3 "publishable as-is". That pass checked that its 14 earlier fixes were applied, and they were. It did not test the paths that connect components (installer → hook script → spool → correlator, and resume → terminal monitor → record). Those links are where the new bugs sit.

**Fix first, in this order:**

1. **Claude hooks never work.** The installer writes the bare `hook.js` path into `~/.claude/settings.json`, so every event is logged as agent `unknown` and dropped (A1).
2. **Hooks write to the wrong folder** when the storage location is changed in settings, which `docs/TESTING.md` §3.2 tells you to do (A2).
3. **Titles get overwritten.** Every resume and every hook event resets a session's name to `Claude Code · api · 15:00` (A3).
4. **Claude subagent transcripts become fake sessions** and take over the main session's terminal binding (A4).
5. **Workspace settings can set the resume command and the storage folder.** A cloned repo's `.vscode/settings.json` can therefore run commands, or plant a hook that runs in every future Claude session (S1).

Nothing found allows remote access or exfiltration: the extension has no network code, no `eval` and no runtime dependencies.

## What was reviewed

I reviewed v0.0.3 (commit `91c27ab`) from `~/Development/AgentSessionKeeper/code`, reading every file in `src/`, `resources/` and `media/`, plus `package.json`, the packaged `.vsix`, `PROGRESS.md` and the earlier `REVIEW.md`.

| Check | Result |
| --- | --- |
| `tsc --noEmit` | Clean |
| Existing unit tests (`vitest`) | 167 / 167 pass |
| Packaged VSIX | 13 files; no dev or doc files shipped |
| Probe tests written for this review | 9 / 9 reproduce the reported behaviour (A1–A4, A6, A8) |
| Integration tests | Not re-run: they need a VS Code download, and the earlier review reports them passing |

The probe tests live in a scratch copy only; your repo was not modified. Findings marked **verified** were reproduced by running the real code. Findings marked **code reading** follow directly from the source but were not executed, usually because they need a live VS Code window.

Out of scope: Codex, which `PROGRESS.md` decision D4 dropped on your instruction, and Windows-specific behaviour beyond quoting.

## Architecture review

The module layout matches the spec and is easy to follow. The problems come from two design choices: every signal funnels through one `bind()` that rebuilds the whole record, and no rule says which VS Code window owns a session. Most of the correctness bugs below follow from those two.

&#91;embedded content: capture and resume flow · where each finding breaks it\]

Each marker is a finding below. The three capture paths on the left each have their own break (A8, A4, A1/A2). Everything they deliver then goes through `bind()` (A3, A6), and the way back out to a terminal starts duplicate or orphaned sessions (A5, A7).

### What is solid

- **Clear layering.** `agents/`, `capture/`, `store/`, `restore/`, `ui/` and `hooks/` are separated cleanly, and the `AgentAdapter` interface really does keep agent specifics to one file each.
- **Store design.** One JSON file per session, atomic tmp-and-rename writes with `fsync`, a cross-process `mkdir` lock, field-level merge, and a test that races two real processes.
- **Defensive input handling.** Session IDs are validated at every entry point, records from disk are structurally checked and normalised, and file names are sanitised.
- **Good test base.** 167 unit tests, a pure Correlator with an injected clock, and fake agents that refuse to touch real config.

### Findings

**A1 — Claude hooks are installed with the wrong command, so exact capture never works for Claude.** High · verified

`HooksInstaller.installClaudeHooks` calls `addClaudeHooks(settings, this.hookJsPath)` (`src/hooks/installer.ts:169`), which writes the bare path `…/bin/hook.js` as the hook command. The intended command, `node "…/hook.js" claude`, exists in the `hookCommand` getter (line 113) but nothing uses it. Claude runs the file through its shebang with no argument, so `hook.js` logs `agent: "unknown"` and `Correlator.onHookEvent` drops the event because no adapter has that id. The probe ran the installed command with `sh -c`, exactly as Claude does, and saw `agent = unknown`. The tests missed it because the installer test only checks that the string contains `hook.js`, and the spool test writes its own line with `agent: "claude"`. On Windows the bare `.js` path cannot run at all.

**A2 — The hook script and the pi extension ignore the storage-folder setting.** High · verified

Both decide where to write from `AGENT_SESSIONS_STORAGE_DIR` or `~/.agent-sessions` (`resources/hook.js:19`, `resources/pi-extension.ts:15`). A Claude or pi process never has that variable unless it was started from the sandbox, so with `agentSessions.storageDir` set, hook events go to `~/.agent-sessions/spool` while the extension reads `<storageDir>/spool`. `docs/TESTING.md` §3.2 tells you to set exactly that setting for development, so hook tests would silently do nothing. A related problem: uninstall finds hooks by the current storage path, so changing the setting between install and uninstall leaves the old hooks in `~/.claude/settings.json`.

**A3 — `bind()` rebuilds the whole record, overwriting titles and the launch command.** High · verified

`Correlator.bind` (`src/capture/Correlator.ts:272`) builds a complete record from the current event and upserts it, and `resolveTitle` only keeps titles whose source is `user`. Resuming a session (the Restorer's own `claude --resume <id>` is picked up by the terminal monitor) renamed "add health check" to `claude · api · 15:00` in the probe. Once A1 is fixed, every `UserPromptSubmit` and `Stop` hook will do the same to agent-named sessions, and will replace `launch.commandLine` with `(hook Stop)`. The fallback time is also shown in UTC, not local time.

**A4 — Claude subagent transcripts are treated as sessions.** High · verified with a synthetic layout

Current Claude Code writes Task-tool subagents to `projects/<project>/<session-id>/subagents/agent-<id>.jsonl` ([layout reference](https://cdn.jsdelivr.net/npm/oh-my-opencode@4.18.2/dist/skills/coding-agent-sessions/references/claude.md)). The Claude adapter accepts any `.jsonl` (`src/agents/claude.ts:118`). As a result, Import Existing adds one fake session per subagent run, and a subagent file appearing during a live session is read as a `/clear`-style switch: the terminal is rebound to `agent-<id>` and the real session loses its binding. Resuming the fake session then fails. To confirm on your Mac: `ls ~/.claude/projects/*/*/subagents | head`.

**A5 — Resume does not check whether the session is already running.** Medium · code reading

The spec's first resume step ("if a live terminal is already bound, focus it") is missing from `Restorer.resume` (`src/restore/Restorer.ts:37`), and clicking a sidebar item runs Resume (`src/ui/SessionTreeProvider.ts:107`). A click on a running session starts a second agent on the same session ID. Claude's docs warn that two processes on one session interleave their messages into a single transcript.

**A6 — No window owns a session, so windows overwrite each other.** Medium · partly verified

Every window tails the same spool and binds every hook event, which sets `launch.windowSessionId` to whichever window wrote last; the probe confirmed this. `StartupRestore.run` also rewrites ownership to the new window for sessions that are alive in another window (`src/restore/StartupRestore.ts:47`). If you then close only the window that really ran the session, it stays "Running" under an owner that is still alive and is never offered for restore. When VS Code reopens several windows at once, each one can mark the same sessions interrupted and restore them, which starts duplicate agents.

**A7 — Terminals are not re-linked after a window reload.** Medium · code reading

After **Developer: Reload Window**, `StartupRestore` finds the still-running terminals but never registers them with the terminal monitor or correlator. Only `TerminalMonitor.handleStart` calls `registerTerminal`. Closing those terminals later doesn't mark the sessions closed, so after the next restart they show up as interrupted even though you closed them.

**A8 — Resuming by name or file path is dropped or recorded wrongly.** Medium · verified

Claude accepts `claude --resume <name>` and pi accepts `pi --session <path>`. A name with a space or a path fails `isSafeSessionId`, so `onLaunch` drops the launch entirely: no record and no pending launch. A one-word name such as `auth-refactor` is stored as if it were the session ID, which creates a ghost record next to the real one. The fix is to treat any value that is not ID-shaped as a pending resume and let the watcher or a hook supply the real ID.

**A9 — Smaller items.** Low

- **Sleep and wake.** A window opened right after the machine wakes sees every other window's heartbeat as stale (older than 90 s), deletes those heartbeat files and marks live sessions interrupted. Store the process ID in the heartbeat and check it with `process.kill(pid, 0)` before declaring a window dead.
- **Startup message count.** The startup notification counts every interrupted session, but Restore all only restores those in the current workspace.
- **Settings read once.** Settings are read once at activation and there is no `onDidChangeConfiguration` handler, so changes need a window reload.
- **Slow first activation.** `SessionDirWatcher.preload` walks all of `~/.claude/projects` synchronously, which can slow the first activation when you have a large history.

### Structural recommendations

1. **Split `bind()` into three operations.** `create` makes a new record. `attach` links a terminal to an existing record by patching only `status`, `windowSessionId`, terminal fields and `transcriptPath`. `touch` updates activity. Existing records should only ever receive `store.update` patches. This fixes A3 and prevents a whole class of similar bugs.
2. **Give each session one owner window.** A window acts on a hook event only when the event's `terminalId` or ancestor PIDs match one of its own terminals; other windows ignore it, or at most update `lastActiveAt`. Claim restores with a compare-and-set under the store lock: change `interrupted` to `running` and record this window as owner, and skip the session if another window got there first.
3. **Keep the storage path in one place.** Write it into every installed file at install time: pass it as a hook argument and template it into the pi extension. Then the setting, the hook script and the pi extension cannot disagree.
4. **Test the joins, not just the parts.** Add tests that run the installed hook command through `sh -c` and feed its output to the correlator, and that run a resume and check the record afterwards.

## Security review

The one real exposure is configuration: all 13 settings can be set by a repository you open, and two of them, the resume command and the storage folder, lead to running commands. Everything else is low severity or already handled well.

**Threat model.** This is a single-user, local tool, so other processes running as you are not a meaningful attacker: they could already edit your shell config. The realistic attackers are a cloned repository (through its `.vscode/settings.json`, file names and anything an agent writes into transcripts) and other installed extensions (through public commands). There is no network surface.

| ID | Severity | Finding | Where |
| --- | --- | --- | --- |
| S1 | High | Workspace settings can set the resume command, storage folder, session roots and command patterns | `package.json` configuration (no `scope` on any setting) |
| S2 | Medium | The Claude hook is installed as a shell command string built from the storage path | `src/hooks/installer.ts:113`, `:169` |
| S3 | Low | Shell quoting is POSIX-only; fish and PowerShell parse it differently | `src/util/shellQuote.ts` |
| S4 | Low | Session commands accept a caller-supplied record instead of looking it up | `src/extension.ts:261`, `src/ui/SessionCommands.ts:35` |
| S5 | Low | A stored `transcriptPath` is trusted without checking it is under the agent's folder | `src/agents/claude.ts:169`, `src/agents/pi.ts:178` |
| S6 | Info | The hook script creates spool folders and files with default permissions | `resources/hook.js:48` |

**S1 — Workspace settings reach command execution.** No setting declares a `scope`, so all of them default to `window`, which [VS Code allows in workspace settings](https://code.visualstudio.com/api/references/contribution-points). Once you trust a repository, its `.vscode/settings.json` can:

- set `agentSessions.agents.claude.resumeCommand` to any shell command. It runs the next time you click Resume on any session in that window, including sessions from other projects, since history is global.
- set `agentSessions.storageDir` to a folder inside the repository. If you then run **Install Agent Hooks** in that window, `~/.claude/settings.json` gets a hook pointing into the repository, and a later `git pull` can replace that file. It then runs inside every Claude session on the machine, in every folder, until you uninstall the hooks.
- point `sessionRoot` and `commandPatterns` elsewhere, which corrupts capture but does not execute anything.

The extension is disabled in Restricted Mode because it declares no `untrustedWorkspaces` capability ([VS Code docs](https://code.visualstudio.com/api/extension-guides/workspace-trust)), so this needs a trusted workspace. That is a low bar for repositories you clone. **Fix:** add `"scope": "machine"` to `storageDir`, every `resumeCommand` and every `sessionRoot`, and `"scope": "application"` or `"machine"` to `commandPatterns` and `enabled`. Also make **Install Agent Hooks** refuse a storage folder that is inside a workspace folder or outside your home folder.

**S2 — Hook command built as a shell string.** Claude runs a hook's `command` through a shell unless the hook uses exec form. Today the command is the unquoted storage path, so a path with spaces breaks and a path with `;` or `$()` runs code. The unused `hookCommand` getter would quote it with `JSON.stringify`, but double quotes still allow `$()` expansion. **Fix:** use exec form, `{ "type": "command", "command": "node", "args": [hookJsPath, "claude", "--spool", spoolDir] }`, which [Claude Code supports](https://code.claude.com/docs/en/hooks) and which needs no quoting. This also fixes A1 and A2.

**S3 — POSIX-only quoting.** `shellQuote` escapes a single quote as `'\''`. In fish, `\'` inside single quotes is itself an escape, so a value containing `\'` closes the quote early and the rest of the line runs as commands. PowerShell does not treat `\` as an escape, so the same value breaks or splits the command. The earlier review's note that PowerShell "handles this correctly" is wrong. Today this only matters if you add `${title}` or `${cwd}` to a resume template, or launch a titled session from fish or PowerShell. Titles can come from prompt text or agent-set names, so they are not fully yours. **Fix:** remove `${title}` and `${cwd}` from templates (the terminal's `cwd` is already set when it is created), and pass `--name` only for titles that match a plain-text allowlist.

**S4 — Commands trust their argument.** `agentSessions.resume` and the session commands fall back to treating whatever object is passed as a record (`store.get(…) ?? candidate`). Another extension, or a `command:` link in trusted Markdown, can make Resume open a terminal in any folder and run the resume template there. The session ID is still validated, so impact is low. **Fix:** resolve the record from the store by `agent` and `sessionId` only, and do nothing if it is not found.

**S5 — Unchecked transcript path.** `transcriptPathFor` returns `record.transcriptPath` whenever the file exists, and that value can come from a hook event's `transcript_path`. **Open Transcript** will open any existing file. **Fix:** accept it only if `isUnder(path, sessionRoot)`.

**S6 — Spool permissions.** `hook.js` creates `spool/` as 0755 and files as 0644 when it runs before the extension. The next activation tightens the folder to 0700, so this is defence in depth only. **Fix:** `mkdirSync(dir, { recursive: true, mode: 0o700 })` and `appendFileSync(file, line, { mode: 0o600 })`.

**Checked and fine:** the webview's Content Security Policy, its DOM building with `textContent` only, and its message handling (actions are looked up in the store). Also fine: session-ID validation at capture, resume and copy; path sanitising in the store; the tree tooltip's `appendText`; the lock and atomic writes; the fake agents' safety guard; and the packaged VSIX contents. There is no `child_process` use in the extension itself, only in `hook.js` and the pi extension, which run `ps` with fixed arguments.

## Fix list

Apply in this order. Each item can be committed on its own, and each comes with the test that proves it.

- [x] **1. Install the Claude hook in exec form with an explicit spool folder** (A1, A2, S2). In `installer.ts`, write `{ type: "command", command: "node", args: [hookJsPath, "claude", "--spool", path.join(storageDir, "spool")] }`. Find and remove hooks by matching `args` containing `hookJsPath`, and also remove any older entry whose `command` is the bare path. In `hook.js`, read `--spool` and fall back to `path.join(__dirname, "..", "spool")`, never the environment variable alone. Create the folder 0700 and files 0600 (S6). *Test:* install into a temp `~/.claude`, run each installed hook exactly as Claude does, check that the spool line has `agent: "claude"` and lands in `<storageDir>/spool`, then feed that line to the `Correlator` and check that a record appears.
- [x] **2. Template the spool path into the pi extension at install time** (A2). Write a constant into the copied `agent-session-keeper.ts` instead of reading the environment. *Test:* install with a custom storage folder and check the constant in the installed file.
- [ ] **3. Lock settings to user scope** (S1). Add `"scope": "machine"` to `storageDir`, `agents.*.resumeCommand` and `agents.*.sessionRoot`, and `"scope": "application"` to `agents.*.commandPatterns` and `agents.*.enabled`. Make **Install Agent Hooks** refuse a storage folder that is inside any workspace folder or outside your home folder. *Test:* extend `test/unit/manifest.test.ts` to assert every setting has an explicit scope and the four above are not `window` or `resource`.
- [ ] **4. Split `Correlator.bind`** (A3). Keep `create` for new records. For existing records, apply a patch: `status`, `launch.windowSessionId`, terminal fields, `transcriptPath` if missing, `lastActiveAt`. Never change `title`, `titleSource` or `launch.commandLine` on an existing record. Compute fallback titles from local time. *Test:* both probe cases (resume, then a `Stop` hook) keep the original title and command line.
- [ ] **5. Ignore subagent transcripts** (A4). In the Claude adapter, `isSessionFile` accepts only `projects/<one folder>/<name>.jsonl`, exactly two levels under `projects/`, and rejects anything under a `subagents/` folder. Apply the same rule in `importExisting`. *Test:* a fixture tree with `<id>/subagents/agent-x.jsonl` imports one session and does not rebind the terminal.
- [ ] **6. Resume focuses a running session instead of starting another** (A5). At the top of `Restorer.resume`, if `findTerminal(sessionKey)` returns a terminal, show it and return `'focused'`. Keep click-to-resume in the sidebar (your earlier choice); with this check, a click on a running session just brings its terminal forward. *Test:* resuming a session bound to a live terminal creates no terminal.
- [ ] **7. Make one window the owner of each session** (A6). In `onHookEvent`, act only when `terminalKeyForHook` matches one of this window's terminals; otherwise update `lastActiveAt` only. In `StartupRestore.run`, rewrite `windowSessionId` only for records matched to a live terminal in this window, never for ones kept alive by another window's heartbeat. Claim each restore under the record lock: change `interrupted` to `running` with this window as owner, and skip the record if another window got there first. *Test:* two correlators sharing one store; the non-owner window's hook event does not change ownership.
- [ ] **8. Re-link live terminals after a reload** (A7). In `StartupRestore.run`, for each record matched to a live terminal, call `monitor.adopt(terminal, sessionKey)`, which registers the key and pid with the correlator. *Test:* a unit test with a fake terminal list; then closing that terminal sets `closed`.
- [ ] **9. Handle resume by name or path** (A8). If a `--resume` or `--session` value is not ID-shaped, record the launch as a pending resume (`isResume: true`, no explicit ID) so the watcher or a hook binds the real ID. *Test:* `claude --resume "auth refactor"` followed by a session-file event creates one record with the real ID.
- [ ] **10. Small hardening** (S3, S4, S5, A9). Remove `${title}` and `${cwd}` from resume templates and pass `--name` only for plain-text titles. Resolve command arguments from the store only. Check `transcriptPath` with `isUnder`. Store the process ID in the heartbeat and check it before treating a window as dead. Make the startup message count match what Restore all restores. Re-read settings on `onDidChangeConfiguration`.

After items 1–5, re-run `docs/TESTING.md` sections 4.1–4.4 and 5 in the sandbox, then with real agents. Items 6–9 are covered by sections 4.5, 4.7 and 4.9.

## Prompt for the coding agent

Paste this into your coding agent in the project folder, with this review saved as `REVIEW-2.md` (export it as Markdown from this doc):

```text
Read REVIEW-2.md in full. It is a second architecture and security review of v0.0.3; its findings
are new and are not covered by REVIEW.md. Work through its "Fix list" in order, one item per commit.

For each item:
1. First write the test named in the item and confirm it FAILS on the current code.
2. Make the fix, then run npm run build, npm test and npm run test:integration.
3. Commit as "R2-<n>: <short summary>" and tick the item in REVIEW-2.md.

Rules:
- Items 1 and 2 change what is written to ~/.claude/settings.json and ~/.pi/agent/extensions.
  Uninstall must still remove both the old (bare path) and the new (exec form) Claude entries
  and stay byte-identical to the original file.
- Item 4 must not change any title whose titleSource is "user"; keep the existing title tests green.
- Do not change the sidebar's click-to-resume behaviour; item 6 makes it safe.
- Never touch my real ~/.claude, ~/.pi or ~/.agent-sessions; use temp folders in every test.
- Stop after item 5 and tell me which sections of docs/TESTING.md to re-run. Then do 6-10.
- Record anything you decide differently from the review under "Decisions" in PROGRESS.md.
```
