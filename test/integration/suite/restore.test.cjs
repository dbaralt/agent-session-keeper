const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const STORAGE = process.env.AGENT_SESSIONS_STORAGE_DIR;
const CLAUDE_ROOT = process.env.CLAUDE_CONFIG_DIR;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await delay(100);
  }
}

function encodeClaudeDir(cwd) {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

function recordPath(agent, sessionId) {
  return path.join(STORAGE, 'sessions', agent, `${sessionId}.json`);
}

function writeRecord(record) {
  const file = recordPath(record.agent, record.sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
}

function readRecord(agent, sessionId) {
  try {
    return JSON.parse(fs.readFileSync(recordPath(agent, sessionId), 'utf8'));
  } catch {
    return undefined;
  }
}

function makeRecord(overrides) {
  const now = '2026-01-02T03:00:00.000Z';
  return {
    schemaVersion: 1,
    agent: 'claude',
    sessionId: 'restore-session',
    title: 'Live session',
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

suite('Agent Session Keeper restore', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('danielbaralt.agent-session-keeper').activate();
  });

  test('marks a session whose transcript is gone as missing', async () => {
    const sessionId = 'restore-missing';
    const record = makeRecord({ sessionId, title: 'Gone', cwd: '/p/gone' });
    writeRecord(record);

    await vscode.commands.executeCommand('agentSessions.resume', record);

    const updated = await waitFor(() => {
      const current = readRecord('claude', sessionId);
      return current && current.status === 'missing' ? current : undefined;
    });
    assert.strictEqual(updated.status, 'missing');
  });

  test('resumes a session with a live transcript in a new terminal', async function () {
    this.timeout(40000);
    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    const cwd = folder ? folder.uri.fsPath : process.cwd();
    const sessionId = 'restore-live';

    const projectDir = path.join(CLAUDE_ROOT, 'projects', encodeClaudeDir(cwd));
    fs.mkdirSync(projectDir, { recursive: true });
    const transcript = path.join(projectDir, `${sessionId}.jsonl`);
    fs.writeFileSync(
      transcript,
      `${JSON.stringify({
        type: 'user',
        sessionId,
        cwd,
        isMeta: false,
        timestamp: '2026-01-02T03:00:00.000Z',
        message: { role: 'user', content: 'a recorded session' },
      })}\n`,
    );

    const record = makeRecord({
      sessionId,
      title: 'Resume me',
      cwd,
      transcriptPath: transcript,
    });
    writeRecord(record);

    await vscode.commands.executeCommand('agentSessions.resume', record);

    const updated = await waitFor(() => {
      const current = readRecord('claude', sessionId);
      return current && current.lastResumedAt ? current : undefined;
    });
    assert.strictEqual(updated.status, 'running');
    assert.ok(updated.lastResumedAt);

    const terminal = await waitFor(() =>
      vscode.window.terminals.find((candidate) => candidate.name.includes('Resume me')),
    );
    assert.ok(terminal, 'a terminal named after the session should exist');
  });
});
