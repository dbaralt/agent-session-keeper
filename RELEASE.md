# RELEASE.md — Build, install and publish Agent Session Keeper

This is a runbook for the coding agent. Start it only after every item in the `REVIEW-2.md` fix list is done and committed. It does four things:

1. Prepares release `0.2.0`: version, changelog, packaging rules.
2. Rewrites `README.md` into a front page that tells people how to install the extension.
3. Builds the `.vsix` and installs it into the owner's VS Code, then waits for the owner's smoke test.
4. Pushes to GitHub and publishes a GitHub Release with the `.vsix` attached, built by a GitHub Action from a version tag.

Publishing to the VS Code Marketplace or Open VSX is **out of scope**. Do not create accounts, tokens or publisher IDs.

This file is reusable: for later releases, repeat sections 1, 3, 4 and 5 with the new version number.

---

## 0. Ground rules

- **Stop at every ⏸ checkpoint** and wait for the owner's answer.
- **Never** force-push, rewrite published history, delete tags or releases, or change repository visibility without the owner asking for it.
- **Never** edit `~/.claude/`, `~/.pi/` or `~/.agent-sessions/` yourself. The owner runs the extension's commands. You may *read* those files only when a step below says so.
- **Never** commit secrets, `.sandbox/`, `node_modules/`, `dist/` or `*.vsix`; `.gitignore` already excludes these, so keep it that way.
- Run every command from the repository root. If a step fails, stop, show the error and propose a fix; do not skip the step.
- Record anything you decide differently from this file under "Decisions" in `PROGRESS.md`.

## 1. Preflight

Run these and confirm each result before continuing:

```bash
git status --short                 # must be empty, apart from this RELEASE.md if it is not committed yet
git branch --show-current          # must be main
git fetch origin && git status -sb # must not be behind origin/main
grep -c "\- \[x\]" REVIEW-2.md     # every fix-list item ticked (10 of 10)
npm ci
npm run build
npm test
npm run test:integration
gh auth status                     # signed in to github.com with repo scope
gh repo view dbaralt/agent-session-keeper --json visibility,defaultBranchRef
code --version                     # the VS Code CLI is on PATH
```

If `code` is not found, tell the owner to run **Shell Command: Install 'code' command in PATH** from the VS Code Command Palette, then retry. Do not guess the application path.

⏸ **Checkpoint A — ask the owner three things before going further:**

1. **Repository visibility.** It is currently `<visibility from gh repo view>`. Peers can only download releases from a **public** repo, or from a private repo they've been added to. Should it stay as is, or should the owner make it public? The owner changes visibility; you don't.
2. **Which VS Code to install into:** Stable (`code`) or Insiders (`code-insiders`)?
3. **Hooks:** are Agent Hooks installed in the owner's current setup? (This decides the extra migration step in section 4.)

## 2. Prepare release 0.2.0

### 2.1 Version

Set `"version": "0.2.0"` in `package.json` (use `npm version 0.2.0 --no-git-tag-version` so `package-lock.json` matches). VS Code recommends an **even** minor number for releases and an odd one for pre-releases, and does not accept tags like `-beta`. Keep `"preview": true` while on 0.x.

Check these `package.json` fields and fix any that are wrong:

| Field | Required value |
| --- | --- |
| `publisher` | `danielbaralt` |
| `name` | `agent-session-keeper` |
| `repository.url` | `https://github.com/dbaralt/agent-session-keeper` |
| `bugs.url` | `https://github.com/dbaralt/agent-session-keeper/issues` (add it) |
| `homepage` | `https://github.com/dbaralt/agent-session-keeper#readme` (add it) |
| `icon` | a PNG of at least 128×128 (not SVG) |
| `license` | `MIT`, with a matching `LICENSE` file |
| `engines.vscode` | unchanged unless a fix needed a newer API |

### 2.2 CHANGELOG.md

Create `CHANGELOG.md` at the repo root. Newest version first; each version is a `## <version> — <YYYY-MM-DD>` heading. The release workflow in section 5 extracts the release notes from this heading, so keep the format exact.

For `0.2.0`, write short, user-facing bullets in three groups:

- **Fixed:** one line per `REVIEW-2.md` item, in plain words. For example: "Claude hooks now record sessions (they were installed with the wrong command)", "Session titles are no longer replaced when you resume a session", "Claude subagent runs no longer appear as separate sessions".
- **Security:** settings that can run commands (resume command, storage folder, session roots) can now only be set in user settings, not by a workspace's `.vscode/settings.json`.
- **Changed:** anything a user will notice, such as a click on a running session now focusing its terminal.

Then add a `## 0.0.3` entry summarising the earlier development builds in one or two lines.

### 2.3 Move developer notes out of the README

`README.md` becomes the user front page (section 3). Move today's developer content — the build commands, sandbox, adding an agent, and the pointers to `docs/SPEC.md`, `docs/TESTING.md` and `PROGRESS.md` — into a new `CONTRIBUTING.md`, and link to it from the README.

### 2.4 Packaging rules

Add these lines to `.vscodeignore` so they don't end up in the `.vsix`:

```text
.github/
CONTRIBUTING.md
RELEASE.md
REVIEW-2.md
SHA256SUMS.txt
notes.md
```

`README.md`, `CHANGELOG.md` and `LICENSE` must stay **in** the package; VS Code shows the README and changelog on the extension's page. Do not add them to `.vscodeignore`.

## 3. Rewrite README.md as the front page

The same `README.md` is shown on the GitHub repo page **and** on the extension's page inside VS Code. So:

- Use **absolute `https://` links** for everything: other files in the repo, releases, issues. Relative links break inside VS Code because `docs/` isn't packaged.
- Images are optional. If you add any, they must be `https` URLs, not SVG, and real screenshots of the running extension. Do **not** use the mockups in `docs/design/` as product screenshots.
- Write for someone who has never seen the project. Keep sentences short and plain.

Use exactly this structure and fill in the parts in angle brackets:

````markdown
# Agent Session Keeper

Reopen your Claude Code and pi terminal sessions after VS Code restarts.

<Two or three sentences: the agents already save every conversation and can resume
it by ID; a restart only loses which terminal held which session; this extension
remembers that and reopens each session with one click.>

> **Preview.** Tested on macOS and Linux with Claude Code <claude --version used> and pi <pi --version used>.

## What it does

- Records every `claude` and `pi` session you start in a VS Code terminal: title, folder, branch, start time and last activity.
- After a restart or crash, offers to reopen the sessions that were still running, each in its own terminal with its full history.
- Lists every session in the **Agent Sessions** sidebar and a searchable history page, with resume, rename, pin and archive.

## Requirements

- VS Code <minimum version from engines.vscode> or newer.
- macOS or Linux. On Windows, sessions are recorded from the terminal, but Agent Hooks are not supported yet.
- Claude Code and/or pi installed and on your `PATH`.
- Terminal shell integration turned on (the default for zsh, bash, fish and PowerShell). Hover a terminal tab: it should say "Shell integration: Rich" or "Basic".

## Install

1. Download **agent-session-keeper.vsix** from the [latest release](https://github.com/dbaralt/agent-session-keeper/releases/latest).
2. In VS Code, open the Extensions view, click **…** (Views and More Actions) and choose **Install from VSIX…**, then pick the downloaded file.
3. Reload VS Code when asked. An **Agent Sessions** icon appears in the activity bar.

Or from a terminal:

```bash
curl -fL -o agent-session-keeper.vsix \
  https://github.com/dbaralt/agent-session-keeper/releases/latest/download/agent-session-keeper.vsix
code --install-extension agent-session-keeper.vsix
```

<Only if the repo is private: replace the curl line with
`gh release download --repo dbaralt/agent-session-keeper --pattern 'agent-session-keeper.vsix'`
and say that you need access to the repository.>

**Remote windows (SSH, WSL, containers):** open the remote window first, then use **Install from VSIX…** there. The extension runs where your terminals run.

**Check the download (optional):** each release has a `SHA256SUMS.txt`. Run `shasum -a 256 agent-session-keeper.vsix` and compare.

## Get started

1. Open a terminal in VS Code and run `claude` or `pi` as usual. The session appears in the **Agent Sessions** sidebar within a few seconds of your first prompt.
2. Quit VS Code with agents running, then reopen it. Choose **Restore all** to reopen them.
3. Optional, for exact capture: run **Agent Sessions: Install Agent Hooks** from the Command Palette. <One sentence on what it changes: adds entries to ~/.claude/settings.json and one file in ~/.pi/agent/extensions. Removing the hooks restores the original settings file exactly.>

## Update

Releases are not installed automatically. To update, download the new `.vsix` from [Releases](https://github.com/dbaralt/agent-session-keeper/releases) and install it the same way; your session history is kept. <If 0.2.0 needs it: "If you installed Agent Hooks with 0.0.x, run Install Agent Hooks once more after updating.">

## Settings

<A short table of the settings a user is likely to change, taken from package.json:
restoreOnStartup, resumeCommand, commandPatterns, titleFromFirstPrompt, terminalLocation, storageDir.
Note that the resume command, storage folder and session roots can only be set in User settings.>

## Your data

- Session history is stored on your machine in `~/.agent-sessions` (one small JSON file per session).
- The extension makes no network requests and collects no telemetry.
- It reads your agents' session folders (`~/.claude/projects`, `~/.pi/agent/sessions`) but never changes them.
- Titles can come from your first prompt. Turn off **Agent Sessions: Title From First Prompt** if your prompts may contain secrets.

## Uninstall

1. If you installed hooks, run **Agent Sessions: Remove Agent Hooks** first.
2. Uninstall from the Extensions view, or run `code --uninstall-extension danielbaralt.agent-session-keeper`.
3. Optionally delete `~/.agent-sessions`.

## Troubleshooting

<Three or four bullets taken from docs/TESTING.md section 7, rewritten for users:
check the "Agent Sessions" output channel, shell integration, aliases via commandPatterns, how to report an issue.>

Report problems at [GitHub Issues](https://github.com/dbaralt/agent-session-keeper/issues).

## Contributing

See [CONTRIBUTING.md](https://github.com/dbaralt/agent-session-keeper/blob/main/CONTRIBUTING.md).

## License

MIT — see [LICENSE](https://github.com/dbaralt/agent-session-keeper/blob/main/LICENSE).
````

Before moving on, check every command in the README by running it yourself (except the install into the owner's VS Code, which is section 4). Check every setting name against `package.json`.

## 4. Build and install into the owner's VS Code

### 4.1 Build and inspect the package

```bash
rm -f *.vsix
npm run package                          # runs the production build, then vsce package
npx @vscode/vsce ls --no-dependencies    # list exactly what goes into the .vsix
unzip -l agent-session-keeper-0.2.0.vsix
```

Check the listing:

- It contains `package.json`, `readme.md`, `changelog.md`, `LICENSE.txt`, `dist/extension.js`, `resources/` and `media/`.
- It contains **no** `src/`, `test/`, `docs/`, `*.map`, `.sandbox`, `REVIEW*.md`, `RELEASE.md`, `PROGRESS.md`, `AGENTS.md` or `CLAUDE.md`.
- Total size is well under 1 MB.

### 4.2 Install

```bash
code --list-extensions --show-versions | grep -i agent-session-keeper   # note what is installed now
code --install-extension agent-session-keeper-0.2.0.vsix --force
code --list-extensions --show-versions | grep -i agent-session-keeper   # must show danielbaralt.agent-session-keeper@0.2.0
```

Use `code-insiders` instead if the owner said Insiders at Checkpoint A.

Then tell the owner to:

1. Run **Developer: Reload Window** in each open VS Code window.
2. Open **View → Output**, choose **Agent Sessions**, and confirm the log shows the activation line for `0.2.0` and `storage: <home>/.agent-sessions`. If it shows `.agent-sessions-dev`, the development setting is still set: clear **Agent Sessions: Storage Dir** in User settings.
3. **If hooks were installed (Checkpoint A):** run **Agent Sessions: Install Agent Hooks** once to replace the old hook entries with the fixed ones. With the owner's OK, you may then *read* `~/.claude/settings.json`. Confirm that it contains only the new exec-form entry (`"command": "node"` with `args`) and no entry whose command is just a path to `hook.js`.

### 4.3 Owner smoke test

⏸ **Checkpoint B — ask the owner to run these sections of `docs/TESTING.md` with real agents, and wait for "pass":**

- 4.1 (a Claude session is recorded)
- 4.2 (pi)
- 4.4 (the restart test)
- 5 (hooks), if hooks are used

If anything fails, fix it, bump to `0.2.1` (patch), update `CHANGELOG.md`, and repeat section 4 from the start. Do not publish a version the owner hasn't passed.

## 5. Publish to GitHub

### 5.1 Release workflow

Create `.github/workflows/release.yml`. It runs only when a `v*.*.*` tag is pushed. It builds, tests, packages, and creates the GitHub Release with the `.vsix` attached under two names:

- `agent-session-keeper-<version>.vsix`, for people who want a specific version;
- `agent-session-keeper.vsix`, so the README's `releases/latest/download/` link always works.

Use the current major versions of `actions/checkout` and `actions/setup-node`; check their GitHub pages and update `v5` below if newer ones exist. Use no other third-party actions.

```yaml
name: Release

on:
  push:
    tags: ['v*.*.*']

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - name: Tag must match package.json version
        run: |
          version="$(node -p "require('./package.json').version")"
          if [ "v$version" != "$GITHUB_REF_NAME" ]; then
            echo "Tag $GITHUB_REF_NAME does not match package.json version $version"; exit 1
          fi

      - run: npm run build
      - run: npm test
      - run: npm run package

      - name: Name assets and checksums
        run: |
          version="$(node -p "require('./package.json').version")"
          cp "agent-session-keeper-$version.vsix" agent-session-keeper.vsix
          sha256sum agent-session-keeper-*.vsix agent-session-keeper.vsix > SHA256SUMS.txt

      - name: Release notes from CHANGELOG.md
        run: |
          version="$(node -p "require('./package.json').version")"
          awk -v v="$version" '
            /^## / { printing = ($2 == v); next }
            printing
          ' CHANGELOG.md > notes.md
          test -s notes.md || { echo "No CHANGELOG.md section for $version"; exit 1; }

      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          version="$(node -p "require('./package.json').version")"
          gh release create "$GITHUB_REF_NAME" \
            "agent-session-keeper-$version.vsix" agent-session-keeper.vsix SHA256SUMS.txt \
            --title "Agent Session Keeper $version" \
            --notes-file notes.md
```

Integration tests are not run in CI; they need a display. They already ran in preflight (section 1).

Check the workflow locally before committing. Run the `awk` command against your `CHANGELOG.md` and confirm `notes.md` holds exactly the `0.2.0` bullets.

### 5.2 Commit and push

```bash
git add -A
git status --short     # review: only the intended files (package.json, package-lock.json, README.md,
                       # CHANGELOG.md, CONTRIBUTING.md, .vscodeignore, .github/workflows/release.yml,
                       # RELEASE.md, PROGRESS.md and any fix files)
git commit -m "Release 0.2.0: user-facing README, changelog, release workflow"
```

⏸ **Checkpoint C — before pushing, show the owner:**

- the commit list since the last push (`git log --oneline origin/main..HEAD`);
- the rendered README (`gh markdown-preview` if installed, otherwise the file);
- confirmation that `git ls-files` contains nothing private: no `.sandbox`, no real transcripts in `test/fixtures`, no absolute paths under `/Users/` except in documentation examples.

Ask: "Push to GitHub and publish release 0.2.0?" Continue only on a clear yes.

```bash
git push origin main
git tag -a v0.2.0 -m "Agent Session Keeper 0.2.0"
git push origin v0.2.0
sleep 15   # give GitHub a moment to start the run
gh run list --workflow release.yml --limit 1   # confirm this run is for v0.2.0 before watching it
gh run watch "$(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```

If the workflow fails, fix the cause in a new commit on `main`. Then ask the owner whether to delete and re-push the `v0.2.0` tag (allowed only if the release was never created) or to release `0.2.1` instead.

### 5.3 Verify the release

```bash
gh release view v0.2.0 --repo dbaralt/agent-session-keeper
mkdir -p /tmp/ask-release-check && cd /tmp/ask-release-check
gh release download v0.2.0 --repo dbaralt/agent-session-keeper
shasum -a 256 -c SHA256SUMS.txt
unzip -p agent-session-keeper.vsix extension/package.json | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).version)"   # must print 0.2.0
cd - && rm -rf /tmp/ask-release-check
```

If the repo is public, also check the README's one-line download works without signing in:

```bash
curl -fsIL https://github.com/dbaralt/agent-session-keeper/releases/latest/download/agent-session-keeper.vsix | grep -i "^HTTP"
```

Open `https://github.com/dbaralt/agent-session-keeper` and check that the front page renders: headings, both install options, working links.

## 6. Finish

1. Tick a new "Release 0.2.0" line in `PROGRESS.md` with the release URL, commit and push it.
2. Report to the owner in this shape:

```text
Release 0.2.0 is published: <release URL>
Installed in your VS Code: danielbaralt.agent-session-keeper@0.2.0 (<Stable|Insiders>)
Front page: https://github.com/dbaralt/agent-session-keeper
Peers install with: <the one-line curl + code command, or the gh command if private>
Anything I could not verify: <list, or "nothing">
```

3. Remind the owner that VSIX installs don't update automatically. For each future release, repeat sections 1–6 with the new version: bump, changelog, build, install, owner test, tag. Peers then reinstall from the latest release.
