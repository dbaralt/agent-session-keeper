# Agent Session Keeper

A personal VS Code extension that records the session ID of every Claude Code
and pi session started in an integrated terminal and lets you reopen those
sessions after VS Code restarts.

The agents already save their conversations and can resume them by ID. What a
restart destroys is only the link between a terminal and its session ID, so the
extension keeps that link and replays the agent's own resume command.

- Full spec: `docs/SPEC.md`
- Manual test guide: `docs/TESTING.md`
- Screen mockups: `docs/design/`
- Build order and status: `PROGRESS.md`

## Requirements

- VS Code 1.93 or newer.
- At least one of `claude` (Claude Code) or `pi` installed and signed in.
- Shell integration enabled for the most exact capture (VS Code default in zsh, bash, fish, PowerShell).

## Install

The production package is committed at the repo root (`agent-session-keeper-<version>.vsix`)
and attached to every GitHub release. Clone the repo (or download the `.vsix` from the
release), then:

1. Make sure the `code` command is on your PATH. In VS Code:
   **Command Palette (Cmd+Shift+P) → Shell Command: Install 'code' command in PATH**.

2. Install the package:

   ```bash
   code --install-extension agent-session-keeper-0.0.4.vsix
   ```

3. Reload VS Code — **Command Palette → Developer: Reload Window** — or fully quit
   and reopen it.

4. The **Agent Sessions** icon (clock with an arrow) appears in the activity bar.
   Open a terminal, run `claude` or `pi`, and send a prompt. The session should show
   under **Running** within a few seconds.

To update later, run the same command with the new file and `--force`:

```bash
code --install-extension agent-session-keeper-<version>.vsix --force
```

### Optional: exact capture before the first prompt

Run **Agent Sessions: Install Agent Hooks** from the Command Palette. This edits your
own `~/.claude/settings.json` and `~/.pi/agent/extensions/`, so back those up first —
see `docs/TESTING.md` §5.

## Storage

Session records live in one global history folder shared by every project and
VS Code window. See the decision in `PROGRESS.md` (Decisions) for
the rationale and how the path is resolved. Build with `AGENT_SESSIONS_STORAGE_DIR`
set to override it (used by the sandbox and integration tests).

## Develop

```bash
npm install
npm run build             # type-check + bundle to dist/extension.js
npm test                  # unit tests, no VS Code window
npm run test:integration  # @vscode/test-electron; downloads VS Code, uses fake agents
npm run watch             # rebuild on change (used by F5)
npm run sandbox           # Extension Development Host with fake agents in .sandbox/
npm run package           # agent-session-keeper-<version>.vsix
```

Press **F5** for a plain Extension Development Host.

Adding another agent is one adapter file implementing `AgentAdapter` plus one
`register(...)` line in `src/agents/registry.ts`; no model, store or UI change.

For maintainers: `docs/CHECKPOINT.md` has the current state and open issues,
`AGENTS.md` has the full brief and safety rules, and `RELEASE.md` is the publish
runbook.

## Notes

- Resume/new-session commands single-quote values that contain spaces or shell
  metacharacters. Use PowerShell (the VS Code default) on Windows; cmd.exe
  would pass those quotes literally for titles with spaces.

## Status

See `PROGRESS.md` for the milestone checklist and notes.
