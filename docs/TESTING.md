# Testing Agent Session Keeper yourself

This guide is for you, the owner, once the coding agent says a milestone is ready. `PROGRESS.md` lists which sections apply after each milestone. Start with the sandbox (section 3.1): it uses fake agents and throwaway folders, so nothing you do there can touch your real Claude Code, Codex or pi history.

## 1. Before you start

You need:

- VS Code with the `code` command on your `PATH`. On macOS, open the Command Palette (Cmd+Shift+P) and run **Shell Command: Install 'code' command in PATH**.
- Node.js 20 or newer (`node -v`).
- git.
- For the real-agent tests in section 4: whichever of `claude`, `codex` and `pi` you use, installed and signed in.
- A terminal shell VS Code supports for shell integration: zsh, bash, fish or PowerShell.

Check shell integration is on: open a terminal in VS Code, run `echo hi`, then hover the terminal's tab. The hover should say **Shell integration: Rich** (or Basic). If it says None, see section 7.

## 2. Build it and run the automated tests

In the project folder:

```bash
npm install
npm run build
npm test
```

Expected: the build finishes without errors and every test passes. From milestone 4 on, also run:

```bash
npm run test:integration
```

This opens and closes a VS Code window by itself, which is normal. It uses fake agents, not your real ones.

## 3. Three ways to run the extension

### 3.1 Sandbox (safest — start here)

```bash
npm run sandbox
```

A separate VS Code window opens on a small sample folder. In this window:

- typing `claude`, `codex` or `pi` in a terminal runs a **fake** agent that only echoes what you type;
- all session data goes into the project's `.sandbox/` folder;
- your real settings, extensions and agent history are not used or changed.

The fake agents accept the same flags as the real ones (`--session-id`, `--name`, `--resume`, `/clear`, `/exit`), so every test in section 4 works here. To start over, run `npm run sandbox -- --reset`.

### 3.2 Development mode with your real agents

1. Open the project folder in VS Code and press **F5**. A second window titled **[Extension Development Host]** opens.
2. In that window, open **Settings** and set **Agent Sessions: Storage Dir** to `~/.agent-sessions-dev`, so test records stay apart from the history you will keep later.
3. Open a real project folder in that window and run the tests in section 4 with your real agents.

Closing the Extension Development Host window ends the run. Your agents' own history is untouched; the extension only reads it.

### 3.3 Install it for everyday use

When you are happy with it:

```bash
npm run package
code --install-extension agent-session-keeper-*.vsix
```

Then reload VS Code (**Developer: Reload Window** in the Command Palette). To update later, run the same two commands again.

## 4. Test checklist

Each test lists what to do and what you should see. Results from the sidebar refer to the **Agent Sessions** icon (a clock with an arrow) in the activity bar.

Useful while testing: run `ls ~/.agent-sessions/sessions/*/` (or the sandbox's `.sandbox/storage/sessions/*/`) to see the record files, and open any of them to read what was saved.

### 4.1 A Claude Code session is recorded

1. Open a new terminal and run `claude`.
2. Type a first prompt, for example "list the files in this folder", and wait for the answer.

Expected within about 5 seconds of the prompt:

- the sidebar shows the session under **Running**, titled with the start of your prompt;
- a file `sessions/claude/<session-id>.json` exists, and its `cwd` is the folder you were in.

Then run `claude -n "Rename test"` in another terminal and send a prompt. That session should be titled **Rename test**.

### 4.2 Codex and pi sessions are recorded

Repeat 4.1 with `codex` and with `pi`.

Expected: each appears under **Running** with its own badge (X for Codex, π for pi) and a record in `sessions/codex/` or `sessions/pi/`.

Also check these are **not** recorded: `claude -p "hello"`, `codex exec "hello"`, `claude mcp list`, `pi --help`.

### 4.3 Switching sessions and closing terminals

1. In a running Claude session, type `/clear` and send a new prompt.
2. Close a terminal that has an agent running (trash-can icon on the terminal tab).
3. In another terminal, exit an agent normally (`/exit` or Ctrl+D) but leave the terminal open.

Expected:

- after `/clear` the sidebar shows a second session; the first one is still listed;
- the session in the closed terminal moves out of **Running** and shows **closed**;
- the session you exited shows **exited**.

### 4.4 The restart test (the reason this extension exists)

1. Open a project folder. Start two or three agents in separate terminals (for example `claude` and `codex`), and give each one a prompt with something memorable, such as "remember the word pineapple".
2. Quit VS Code completely: **Cmd+Q** on macOS, or **File > Exit** on Windows and Linux. Closing the window is not enough.
3. Reopen VS Code on the same folder.

Expected:

- a notification says "N agent sessions were interrupted when VS Code closed", with **Restore all**, **Choose…** and **Dismiss**;
- the status bar shows **N interrupted**, and the sidebar lists them under **Interrupted**.

4. Click **Restore all**.

Expected:

- one new terminal per session, named after the session, each in the folder where it was started;
- each terminal runs the matching resume command: `claude --resume <id>`, `codex resume <id>` or `pi --session <id>`;
- ask each agent "what word did I ask you to remember?" and it answers correctly.

Repeat once using **Choose…** and restore just one session.

### 4.5 Crash and window reload

- **Crash**: with agents running, force-quit VS Code (Activity Monitor on macOS, Task Manager on Windows, `kill` on Linux). Reopen it. You should get the same result as 4.4.
- **Window reload**: with agents running, run **Developer: Reload Window**. You should **not** get the interrupted notification, and the sessions should stay under **Running** (VS Code keeps those terminals alive across a reload).

### 4.6 A session whose transcript is gone

Claude Code deletes transcripts older than 30 days by default; this simulates that.

1. Pick a closed Claude session in the sidebar, right-click it and choose **Open Transcript** to see its file path. Close that editor tab.
2. In a terminal, rename the file: `mv <path> <path>.bak`
3. Click **Resume** on that session.

Expected: no terminal opens; the session shows **Missing** with a message that its transcript was removed.

4. Put the file back (`mv <path>.bak <path>`) and click **Resume** again. It should now resume normally.

### 4.7 Sidebar actions

On any session in the sidebar, try each action:

| Action | Expected |
| --- | --- |
| Resume (play icon) | Opens a terminal running the resume command, or focuses the terminal if the session is already running |
| Rename | New title shows immediately and is still there after **Developer: Reload Window** |
| Pin | Pinned sessions stay at the top of their group |
| Copy Resume Command | Clipboard holds the exact command; pasting it into any terminal resumes the session |
| Show Terminal | Focuses the terminal running that session |
| Archive | Session disappears from the sidebar; still findable in the history page with the Archived filter |

### 4.8 History page

Open it from the list icon at the top of the sidebar, or with **Agent Sessions: Open History** in the Command Palette.

Check that:

- every session from your tests is listed, newest activity first;
- search finds sessions by title, folder, branch and the first characters of a session ID;
- the Agent, Status, Workspace and date filters narrow the list;
- selecting two rows and clicking **Resume selected** opens two terminals;
- the page is still open and filled in after **Developer: Reload Window**.

Compare it with `docs/design/02-session-history.html` for layout.

### 4.9 Two VS Code windows

1. Open a second VS Code window on a different folder.
2. Start an agent there and send a prompt.

Expected: within a few seconds, the first window's sidebar lists it under **All workspaces**. Rename it in one window; the new title appears in the other.

### 4.10 Starting a session from the extension

1. Click **+** at the top of the sidebar and choose **New Claude Code Session** (also try pi and Codex).
2. Enter a title and press Enter.

Expected: a terminal named after the title opens and runs `claude --session-id <new id> --name "<title>"` (pi is similar). The session appears in the sidebar immediately, before you type anything. Codex starts without a preset ID and appears after your first prompt.

### 4.11 Two sessions in the same folder at once

Do this after installing hooks (section 5).

1. Open two terminals in the same folder.
2. Start `claude` in both within a second of each other, and send a different prompt in each.
3. Click **Show Terminal** on each session in the sidebar.

Expected: each session focuses the terminal it is really running in. Without hooks, these two may be swapped, and both are marked low confidence.

## 5. Agent hooks (optional, for exact capture)

Hooks make the agents report their session ID to the extension directly. Installing them changes your agents' own config files, so back those up first:

```bash
cp ~/.claude/settings.json ~/.claude/settings.json.mybackup 2>/dev/null
cp ~/.codex/hooks.json ~/.codex/hooks.json.mybackup 2>/dev/null
```

1. Run **Agent Sessions: Install Agent Hooks** from the Command Palette.
2. Start `codex` once and run `/hooks`; review and trust the new hooks (Codex skips untrusted hooks).
3. Run tests 4.1, 4.3 and 4.11 again. Sessions should now appear as soon as the agent starts, before your first prompt.
4. Run **Agent Sessions: Remove Agent Hooks**, then check your config files are exactly as before:

```bash
diff ~/.claude/settings.json ~/.claude/settings.json.mybackup && echo "claude: identical"
diff ~/.codex/hooks.json ~/.codex/hooks.json.mybackup && echo "codex: identical"
```

Expected: both print "identical". If either differs, restore your backup (`cp ….mybackup …`) and report it to the coding agent.

## 6. Settings worth knowing

Open **Settings** and search for "Agent Sessions".

- **Restore On Startup**: `prompt` (default), `always` or `never`.
- **Agents › Claude › Resume Command**: add your usual flags, e.g. `claude --resume ${sessionId} --permission-mode plan`.
- **Agents › … › Command Patterns**: add your aliases (for example `cc` if you alias `claude` to `cc`).
- **Title From First Prompt**: turn off if your prompts may contain secrets.

## 7. If something doesn't work

1. **Read the log.** Open the Output panel (View > Output) and pick **Agent Sessions** in the dropdown. Each launch, binding and restore is logged there.
2. **Session not detected.** Hover the terminal tab: if shell integration is None, sessions are still picked up from the agents' folders, but more slowly and less exactly. Shell integration does not work inside tmux or a plain `ssh` session; installing hooks (section 5) covers those cases.
3. **Alias not recognised.** Add it under Command Patterns (section 6).
4. **Resume opens the wrong folder or fails.** Right-click the session, choose **Copy Resume Command**, paste it in a terminal yourself and note the error.
5. **Start fresh.** Run **Remove Agent Hooks** if you installed them, then delete the storage folder (`~/.agent-sessions`, or the one you set). Your agents' own history is not stored there and is not affected.

## 8. Reporting a problem to the coding agent

Paste these into your agent's chat:

- which test (for example "4.4 step 4") and what you saw instead of the expected result;
- the relevant lines from the **Agent Sessions** output log;
- the session's record file from `~/.agent-sessions/sessions/<agent>/<id>.json`;
- your OS, shell, VS Code version (**Help > About**) and the agent's version (`claude --version`, `codex --version`, `pi --version`).

## 9. Removing the extension

1. Run **Agent Sessions: Remove Agent Hooks** if you installed them.
2. Uninstall from the Extensions view, or run `code --uninstall-extension <publisher>.agent-session-keeper`.
3. Optionally delete `~/.agent-sessions` (and `~/.agent-sessions-dev` if you used development mode).
