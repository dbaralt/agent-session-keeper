# Design mockups

Three screens of the extension inside a VS Code window, using sample sessions from a project called `api`. Open the `.html` files in any browser, or look at the matching PNGs in `screenshots/`.

| File | Shows | Spec section |
| --- | --- | --- |
| `01-startup-restore.html` | The Agent Sessions sidebar (Interrupted, Running, This workspace, All workspaces), the startup notification offering Restore all, and the status bar badge | Restore flow and UI › Detecting interrupted sessions, Surfaces |
| `02-session-history.html` | The Session History page: search, filters, bulk selection, statuses including a Missing transcript | Restore flow and UI › Surfaces |
| `03-after-restore-and-new-session.html` | Terminals reopened and named after their sessions, one running `claude --resume <id>`, plus the New Session title prompt | Restore flow and UI › Resuming one session; Session capture › D. Launcher commands |

## Notes for the coding agent

- These are mockups, not code to copy. The sidebar is a native `TreeView`, the startup prompt is `window.showInformationMessage`, the New Session prompt is `window.showInputBox`, and the status bar badge is a `StatusBarItem`. Only the History page is a webview.
- In the webview, use VS Code's theme variables (`--vscode-editor-background`, `--vscode-button-background` and so on) and codicons instead of the hex colours here, so it follows the user's theme.
- Keep the structure and wording: the group names and order, the columns, the status labels (Interrupted, Running, Exited, Closed, Missing, Archived), and the agent badges (Claude Code = C, Codex = X, pi = π).
- Sample titles, IDs and times are illustrative only.

The editable original lives on the owner's Claude design canvas, "Agent Session Keeper UI".
