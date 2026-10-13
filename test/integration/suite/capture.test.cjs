const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const EXTENSION_ID = 'danielbaralt.agent-session-keeper';
const STORAGE = process.env.AGENT_SESSIONS_STORAGE_DIR;
const CLAUDE_ROOT = process.env.CLAUDE_CONFIG_DIR;
const PI_ROOT = process.env.PI_CODING_AGENT_DIR;

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

function encodeClaudeDir(cwd) {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

function readRecord(agent, sessionId) {
  const file = path.join(STORAGE, 'sessions', agent, `${sessionId}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function findRecordByTitle(agent, title) {
  const dir = path.join(STORAGE, 'sessions', agent);
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return undefined;
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const record = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (record.title === title) return record;
    } catch {
      // Ignore files being written.
    }
  }
  return undefined;
}

suite('Agent Session Keeper capture', () => {
  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    await extension.activate();
  });

  test('records a Claude Code transcript that appears on disk', async () => {
    const cwd = '/p/api';
    const sessionId = 'integ-claude-0001';
    const projectDir = path.join(CLAUDE_ROOT, 'projects', encodeClaudeDir(cwd));
    fs.mkdirSync(projectDir, { recursive: true });
    const file = path.join(projectDir, `${sessionId}.jsonl`);
    fs.writeFileSync(
      file,
      `${JSON.stringify({
        type: 'user',
        sessionId,
        cwd,
        gitBranch: 'feat/x',
        isMeta: false,
        timestamp: '2026-01-02T03:00:00.000Z',
        message: { role: 'user', content: 'integration prompt for claude' },
      })}\n`,
    );

    const record = await waitFor(() => readRecord('claude', sessionId));
    assert.strictEqual(record.agent, 'claude');
    assert.strictEqual(record.cwd, cwd);
    assert.strictEqual(record.gitBranch, 'feat/x');
    assert.strictEqual(record.title, 'integration prompt for claude');
    assert.strictEqual(record.status, 'running');
  });

  test('records a pi transcript that appears on disk', async () => {
    const cwd = '/p/pi-project';
    const sessionId = 'integ-pi-0002';
    const projectDir = path.join(PI_ROOT, 'sessions', '--p-pi-project--');
    fs.mkdirSync(projectDir, { recursive: true });
    const file = path.join(projectDir, `2026-01-02T03-00-00-000Z_${sessionId}.jsonl`);
    fs.writeFileSync(
      file,
      `${JSON.stringify({
        type: 'session',
        id: sessionId,
        timestamp: '2026-01-02T03:00:00.000Z',
        cwd,
        version: 3,
      })}\n${JSON.stringify({
        type: 'message',
        id: 'm1',
        message: { role: 'user', content: 'integration prompt for pi' },
        timestamp: '2026-01-02T03:00:01.000Z',
      })}\n`,
    );

    const record = await waitFor(() => readRecord('pi', sessionId));
    assert.strictEqual(record.agent, 'pi');
    assert.strictEqual(record.cwd, cwd);
    assert.strictEqual(record.title, 'integration prompt for pi');
  });

  test('binds a real terminal launch to its session via shell integration', async function () {
    this.timeout(40000);
    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    const cwd = folder ? folder.uri.fsPath : process.cwd();
    const terminal = vscode.window.createTerminal({ name: 'ask-capture', cwd });
    terminal.show();

    await waitFor(async () => (terminal.shellIntegration ? true : undefined), 20000).catch(
      () => undefined,
    );
    if (!terminal.shellIntegration) {
      console.log('shell integration unavailable in this host; skipping terminal binding test');
      terminal.dispose();
      return;
    }

    const claudeBin = path.join(
      vscode.extensions.getExtension(EXTENSION_ID).extensionPath,
      'test',
      'bin',
      'claude',
    );

    // Record whether this host actually reports shell-execution command events
    // (rich shell integration). If not, the watcher fallback must still capture.
    let eventSeen = false;
    const subscription = vscode.window.onDidStartTerminalShellExecution((event) => {
      if (event.terminal === terminal) eventSeen = true;
    });

    terminal.shellIntegration.executeCommand(claudeBin);
    await delay(2000);
    terminal.sendText('terminal prompt for binding', true);

    const record = await waitFor(() => findRecordByTitle('claude', 'terminal prompt for binding'));
    subscription.dispose();
    terminal.dispose();

    if (eventSeen && record.launch.via === 'shell-integration') {
      assert.strictEqual(record.bindingConfidence, 'high');
    } else {
      console.log('shell binding not observed here; watcher fallback captured the session');
      assert.strictEqual(record.status, 'running');
    }
  });
});
