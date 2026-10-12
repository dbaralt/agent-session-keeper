# Agent Session Keeper

A personal VS Code extension that records the session ID of every Claude Code
and pi session started in an integrated terminal and lets you reopen those
sessions after VS Code restarts.

The agents already save their conversations and can resume them by ID. What a
restart destroys is only the link between a terminal and its session ID, so the
extension keeps that link and replays the agent's own resume command.

- Full spec: [`docs/SPEC.md`](docs/SPEC.md)
- Manual test guide: [`docs/TESTING.md`](docs/TESTING.md)
- Screen mockups: [`docs/design/`](docs/design/)
- Build order and status: [`PROGRESS.md`](PROGRESS.md)

## Storage

Session records live in one global history folder shared by every project and
VS Code window. See the decision in [`PROGRESS.md`](PROGRESS.md#decisions) for
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

## Status

See [`PROGRESS.md`](PROGRESS.md) for the milestone checklist and notes.
