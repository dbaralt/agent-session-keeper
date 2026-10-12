# Progress

The coding agent keeps this file up to date. Tick a milestone only when its "Done when" checks in `docs/SPEC.md` pass, `npm test` passes, and the work is committed.

## Milestones

- [x] M1 Scaffold — F5 opens an Extension Development Host; the "Agent Sessions" log shows "activated"
- [x] M2 Model and store — per-file records, atomic writes, field-level merge, cross-window watcher
- [x] M3 Adapters — command-line matching (25+ cases) and session-file readers for claude, codex, pi
- [ ] M4 Capture — terminal monitor, folder watcher, correlator; records appear within 5 s of the first prompt
- [ ] M5 Restore — interrupted detection, startup prompt, Restore all, status bar item, `missing` handling
- [ ] M6 UI — sidebar tree, history page, rename, pin, archive, copy command, open transcript
- [ ] M7 Exact capture — launchers, hook installer and uninstaller, hook bridge, process-tree matching, import existing

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

## Environment notes

Checked at handoff (macOS, Apple Silicon):

- Node v24.14.0, npm 11.9.0, git 2.54.0 — all fine (Node 20+ required).
- `claude` 2.1.220 installed: supports `--session-id`, `-n/--name`, `-r/--resume`, `--fork-session`.
- `pi` 1.1.0 installed: supports `--session-id`, `-n/--name`, `--session`, `--fork`, `--session-dir`. Treat pi as `supportsPresetId: true`.
- `codex` is **not installed** and `~/.codex` does not exist. Codex adapter and hooks still build and are covered by fixtures/fakes, but the real-agent Codex tests in docs/TESTING.md (§4.2, §5 step 2) cannot be run on this machine yet.
- `code` CLI is **not on PATH**. `npm run sandbox` and `npm run test:integration` need it (or an explicit VS Code executable path). Install via Command Palette → **Shell Command: Install 'code' command in PATH** before running those scripts.
- `engines.vscode` pinned to `^1.93.0` per spec. `npm install` resolved `@types/vscode` to 1.140.0, which does contain `window.onDidStartTerminalShellExecution` (index.d.ts:11210) and `LogOutputChannel`; only stable APIs are used in M1.
