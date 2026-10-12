# Progress

The coding agent keeps this file up to date. Tick a milestone only when its "Done when" checks in `docs/SPEC.md` pass, `npm test` passes, and the work is committed.

## Milestones

- [ ] M1 Scaffold — F5 opens an Extension Development Host; the "Agent Sessions" log shows "activated"
- [ ] M2 Model and store — per-file records, atomic writes, field-level merge, cross-window watcher
- [ ] M3 Adapters — command-line matching (25+ cases) and session-file readers for claude, codex, pi
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

## Decisions

_None yet._

## Environment notes

Checked at handoff (macOS, Apple Silicon):

- Node v24.14.0, npm 11.9.0, git 2.54.0 — all fine (Node 20+ required).
- `claude` 2.1.220 installed: supports `--session-id`, `-n/--name`, `-r/--resume`, `--fork-session`.
- `pi` 1.1.0 installed: supports `--session-id`, `-n/--name`, `--session`, `--fork`, `--session-dir`. Treat pi as `supportsPresetId: true`.
- `codex` is **not installed** and `~/.codex` does not exist. Codex adapter and hooks still build and are covered by fixtures/fakes, but the real-agent Codex tests in docs/TESTING.md (§4.2, §5 step 2) cannot be run on this machine yet.
- `code` CLI is **not on PATH**. `npm run sandbox` and `npm run test:integration` need it (or an explicit VS Code executable path). Install via Command Palette → **Shell Command: Install 'code' command in PATH** before running those scripts.
- `engines.vscode` still to confirm from `@types/vscode` when the scaffold is installed (spec suggests 1.93 for `window.onDidStartTerminalShellExecution`); pin once verified.
