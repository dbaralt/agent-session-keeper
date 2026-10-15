# AGENTS.md — Agent Session Keeper

You are building **Agent Session Keeper**, a personal VS Code extension. It records the session ID of every Claude Code, Codex and pi session started in an integrated terminal, and lets the owner reopen those sessions after VS Code restarts.

This folder is the extension's repository. Build the extension here, with `package.json` at the root.

## Current status (read this first)

All seven milestones and both external reviews are done and the extension is
published as **v0.0.4**. The project is no longer in "build one milestone at a
time" mode. Before doing anything else, read `docs/CHECKPOINT.md` for the current
state, the one open issue (History webview renders black on some machines), and
the ordered next steps. Then read `RELEASE.md` before publishing any release, and
`PROGRESS.md` for the decisions made so far. Codex was deliberately dropped
(decision D4); only claude and pi are supported.

## Read first, in this order

1. `docs/CHECKPOINT.md` — current state, open issue, and next steps.
2. `docs/SPEC.md` — the full spec: research, architecture, data model, manifest, module specs and the build plan. It is the source of truth (Codex parts are superseded by `PROGRESS.md` decision D4).
3. `docs/design/` — HTML mockups of the three main screens. Open them or read their markup for layout, wording, grouping and colours. The extension's real UI uses VS Code's own theme colours and codicons, so match the structure, not the exact hex values.
4. `docs/TESTING.md` — the manual tests the owner will run. Your work is done when those steps pass.
5. `PROGRESS.md` — the milestone checklist and decisions. Keep it up to date.

## How to work

- Build one milestone at a time, in the order in `docs/SPEC.md` § "Build plan". Do not start the next milestone until the current one's "Done when" checks pass.
- At the end of each milestone:
  1. Run `npm run build` and `npm test`; both must pass.
  2. Tick the milestone in `PROGRESS.md` and add a short note on anything that differs from the spec.
  3. Commit with a message like `M3: adapters for claude, codex, pi`.
  4. Stop, and tell the owner which sections of `docs/TESTING.md` they can now run, plus anything you could not verify yourself.
- If the spec is ambiguous or wrong, pick the simplest option that keeps the spec's intent, note it in `PROGRESS.md` under "Decisions", and mention it in your milestone report. Ask before any change that alters behaviour the owner would notice.
- Keep the code plain: TypeScript strict mode, esbuild bundle, no runtime dependencies beyond `chokidar` (optional). Dev dependencies as needed (`@types/vscode`, `@vscode/test-electron`, `@vscode/vsce`, a test runner).

## Safety rules (do not break these)

- **Never touch the owner's real agent data in tests or scripts.** Automated tests and the sandbox must point `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `PI_CODING_AGENT_DIR` and the extension's storage at temporary folders.
- **Never edit `~/.claude/`, `~/.codex/` or `~/.pi/` yourself.** Only the extension's `Install Agent Hooks` command may write there, and only when the owner runs it. Do not run that command against real config during development.
- **Never run the real `claude`, `codex` or `pi` from tests.** Use the fake agents described below.
- Before copying a real session file into `test/fixtures/` as a sample, ask the owner. Strip prompts, code and paths from any file you keep.

## Required npm scripts

The owner's testing guide relies on these names. Provide all of them.

| Script | What it must do |
| --- | --- |
| `npm run build` | Type-check and bundle to `dist/extension.js` |
| `npm run watch` | Rebuild on change (used by F5) |
| `npm test` | Unit tests; no VS Code window, no network |
| `npm run test:integration` | `@vscode/test-electron` tests using the fake agents |
| `npm run sandbox` | Open an Extension Development Host in a throwaway profile, with fake agents on `PATH` and every data folder pointing into `.sandbox/` (details below) |
| `npm run package` | Produce `agent-session-keeper-<version>.vsix` in the repo root |

Also provide `.vscode/launch.json` with a "Run Extension" configuration, so F5 works.

## Additions to the spec

These came up while preparing the handoff and are not in `docs/SPEC.md`:

1. **Storage override by environment variable.** Honour `AGENT_SESSIONS_STORAGE_DIR` when set; it takes precedence over the `agentSessions.storageDir` setting. The sandbox and the integration tests use it.
2. **Fake agents** in `test/bin/claude`, `test/bin/codex`, `test/bin/pi` (Node scripts with a shebang, plus `.cmd` shims for Windows). Each one:
   - prints a short banner and a `>` prompt, and reads lines from stdin until `/exit` or Ctrl+D;
   - creates its session file on the first line read, in the same folder layout and first-line format as the real agent (see the research table in the spec), under the folder named by `CLAUDE_CONFIG_DIR`, `CODEX_HOME` or `PI_CODING_AGENT_DIR`;
   - appends one line per input, so the file's modification time changes;
   - honours `--session-id`, `--name`/`-n`, `--resume <id>` (claude), `resume <id>` (codex) and `--session <id>` (pi), and prints the session ID it is using;
   - treats `/clear` (claude) and `/new` (pi) as "start a new session file" without exiting.
3. **`npm run sandbox`** creates `.sandbox/` (git-ignored) with `home/.claude`, `home/.codex`, `home/.pi/agent`, `storage/` and a `workspace/` folder holding one small sample file. It then launches VS Code with `--extensionDevelopmentPath=<repo>`, `--user-data-dir=.sandbox/user-data`, `--extensions-dir=.sandbox/extensions`, opening `.sandbox/workspace`. The environment carries `PATH` with `test/bin` first, the three agent root variables and `AGENT_SESSIONS_STORAGE_DIR`. Print the paths it used. A `--reset` flag deletes `.sandbox/` first.

## Open question for the owner

Storage defaults to one global history in `~/.agent-sessions/`. The owner has not yet confirmed this over a per-project file. Build the global default, but keep all path logic behind the `storageDir` setting so switching later is a small change. Raise it again in your milestone 2 report.

## Things to verify on this machine before relying on them

- Minimum VS Code version for `window.onDidStartTerminalShellExecution`: check `@types/vscode` and set `engines.vscode` to match.
- `pi --help` lists `--session-id`; if not, treat pi like Codex (no preset ID).
- The installed Codex writes plain `rollout-*.jsonl` with a `session_meta` first line; handle `.jsonl.zst` regardless.
- Record what you found in `PROGRESS.md` under "Environment notes".
