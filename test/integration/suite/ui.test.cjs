const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const STORAGE = process.env.AGENT_SESSIONS_STORAGE_DIR;
const CLAUDE_ROOT = process.env.CLAUDE_CONFIG_DIR;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await delay(100);
  }
}

function recordPath(record) {
  return path.join(STORAGE, 'sessions', record.agent, `${record.sessionId}.json`);
}

function writeRecord(record) {
  const file = recordPath(record);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
}

function readRecord(record) {
  return JSON.parse(fs.readFileSync(recordPath(record), 'utf8'));
}

function makeRecord(overrides) {
  const now = '2026-01-02T03:00:00.000Z';
  return {
    schemaVersion: 1,
    agent: 'claude',
    sessionId: 'ui-session',
    title: 'UI session',
    titleSource: 'user',
    cwd: '/p/api',
    createdAt: now,
    lastActiveAt: now,
    status: 'closed',
    bindingConfidence: 'high',
    launch: { commandLine: 'claude', via: 'shell-integration' },
    machine: 'test',
    updatedAt: now,
    ...overrides,
  };
}

suite('Agent Session Keeper UI', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('danielbaralt.agent-session-keeper').activate();
  });

  test('toggles pin and archives a session', async () => {
    const record = makeRecord({ sessionId: 'ui-pin', title: 'Pin me' });
    writeRecord(record);

    await vscode.commands.executeCommand('agentSessions.togglePin', record);
    const pinned = await waitFor(() => {
      const current = readRecord(record);
      return current.pinned ? current : undefined;
    });
    assert.strictEqual(pinned.pinned, true);

    await vscode.commands.executeCommand('agentSessions.archive', record);
    const archived = await waitFor(() => {
      const current = readRecord(record);
      return current.status === 'archived' ? current : undefined;
    });
    assert.strictEqual(archived.status, 'archived');
  });

  test('copies the resume command to the clipboard', async () => {
    const record = makeRecord({ sessionId: 'ui-copy', title: 'Copy me' });
    writeRecord(record);

    await vscode.commands.executeCommand('agentSessions.copyResumeCommand', record);
    const clipboard = await vscode.env.clipboard.readText();
    assert.strictEqual(clipboard, 'claude --resume ui-copy');
  });

  test('copies the session id to the clipboard', async () => {
    const record = makeRecord({ sessionId: 'ui-session-id', title: 'ID me' });
    writeRecord(record);

    await vscode.commands.executeCommand('agentSessions.copySessionId', record);
    const clipboard = await vscode.env.clipboard.readText();
    assert.strictEqual(clipboard, 'ui-session-id');
  });

  test('opens the transcript file', async () => {
    const transcript = path.join(CLAUDE_ROOT, 'projects', '-p-api', 'ui-transcript.jsonl');
    fs.mkdirSync(path.dirname(transcript), { recursive: true });
    fs.writeFileSync(transcript, '{}\n');
    const record = makeRecord({
      sessionId: 'ui-transcript',
      title: 'Transcript me',
      transcriptPath: transcript,
    });
    writeRecord(record);

    await vscode.commands.executeCommand('agentSessions.openTranscript', record);
    const editor = await waitFor(() => {
      const active = vscode.window.activeTextEditor;
      return active && active.document.uri.fsPath === transcript ? active : undefined;
    });
    assert.ok(editor);
  });

  test('opens the history webview panel and refreshes it', async () => {
    await vscode.commands.executeCommand('agentSessions.openHistory');
    const tab = await waitFor(() => {
      for (const group of vscode.window.tabGroups.all) {
        for (const candidate of group.tabs) {
          const viewType = candidate.input ? candidate.input.viewType : undefined;
          if (typeof viewType === 'string' && viewType.includes('agentSessions.history')) {
            return candidate;
          }
        }
      }
      return undefined;
    });
    assert.ok(tab, 'the history webview tab should be open');
    await vscode.commands.executeCommand('agentSessions.refresh');
  });
});
