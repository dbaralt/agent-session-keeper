# Start here

This folder is everything a coding agent needs to build **Agent Session Keeper**: a VS Code extension that records your Claude Code, Codex and pi terminal sessions and reopens them after a restart.

## What's inside

| Path | For | What it is |
| --- | --- | --- |
| `START_HERE.md` | You | This page |
| `AGENTS.md` | The coding agent | Its brief: read order, how to work milestone by milestone, safety rules, required scripts. Codex and pi read it automatically |
| `CLAUDE.md` | Claude Code | One line that loads `AGENTS.md`, so Claude Code reads the same brief |
| `PROGRESS.md` | Both | Milestone checklist the agent ticks off, and which tests you can run after each |
| `docs/SPEC.md` | The coding agent | Full spec: research, architecture, data model, manifest, module specs, build plan, risks |
| `docs/TESTING.md` | You | Step-by-step tests you run yourself, with expected results |
| `docs/design/` | Both | Mockups of the three main screens. Open the `.html` files in any browser; PNG screenshots are in `docs/design/screenshots/` |
| `.gitignore` | Both | Keeps build output, the sandbox folder and packaged `.vsix` files out of git |

## How to use it

1. **Make the project folder.** Unzip this; you get a folder named `agent-session-keeper`. Move it to where you keep code (for example `~/code/`) and run `git init` inside it, so the agent can commit each milestone.
2. **Open it in VS Code** and start your coding agent in that folder (`claude`, `codex` or `pi`).
3. **Paste this kickoff prompt:**

   > Read AGENTS.md, then docs/SPEC.md and docs/TESTING.md in full, and look at the mockups in docs/design/. Then give me a short plan for milestone 1, list anything you need to check on this machine, and ask any questions. Don't write code until I say go.

4. **Answer its questions, then say go:**

   > Go: build milestone 1. Stop when its checks pass and tell me which parts of docs/TESTING.md I can run.

5. **After each milestone,** run the sections of `docs/TESTING.md` that `PROGRESS.md` lists for it. Start with the sandbox (`npm run sandbox`), which uses fake agents and cannot touch your real history. Then say "go: milestone N" for the next one.

Milestones 1 to 5 already solve the restart problem. Milestones 6 and 7 add the history page, the New Session commands and exact capture through agent hooks.

## One decision still open

The spec stores one global history in `~/.agent-sessions/`, shared by every project and VS Code window. If you would rather keep a history file inside each project, tell the agent before milestone 2.
