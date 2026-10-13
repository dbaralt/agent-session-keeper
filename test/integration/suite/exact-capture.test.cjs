const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const STORAGE = process.env.AGENT_SESSIONS_STORAGE_DIR;
const CLAUDE_ROOT = process.env.CLAUDE_CONFIG_DIR;
const PI_ROOT = process.env.PI_CODING_AGENT_DIR;

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

function readRecord(agent, sessionId) {
  const file = path.join(STORAGE, 'sessions', agent, `${sessionId}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function findRecord(agent, predicate) {
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
      if (predicate(record)) return record;
    } catch {
      // ignore
    }
  }
  return undefined;
}

suite('Agent Session Keeper exact capture', () => {
  suiteSetup(async () => {
    await vscode.extensions.getExtension('danielbaralt.agent-session-keeper').activate();
  });

  test('launches a new Claude session with a preset id', async () => {
    await vscode.commands.executeCommand('agentSessions.newClaude');
    const record = await waitFor(() =>
      findRecord('claude', (candidate) => candidate.launch && candidate.launch.via === 'launcher'),
    );
    assert.ok(record.status === 'running' || record.status === 'pending');
    assert.strictEqual(record.bindingConfidence, 'exact');
    assert.ok(record.sessionId);
  });

  test('installs and removes hooks without touching real config', async () => {
    const settingsPath = path.join(CLAUDE_ROOT, 'settings.json');
    const piExtension = path.join(PI_ROOT, 'extensions', 'agent-session-keeper.ts');
    const before = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath) : undefined;

    await vscode.commands.executeCommand('agentSessions.installHooks');
    assert.ok(fs.existsSync(piExtension), 'pi extension should be installed');
    assert.ok(fs.existsSync(path.join(STORAGE, 'bin', 'hook.js')), 'hook.js should be copied');
    const installed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(JSON.stringify(installed).includes('hook.js'), 'claude hooks should be installed');

    await vscode.commands.executeCommand('agentSessions.uninstallHooks');
    assert.ok(!fs.existsSync(piExtension), 'pi extension should be removed');
    if (before) assert.strictEqual(fs.readFileSync(settingsPath), before);
    else assert.ok(!fs.existsSync(settingsPath));
  });

  test('imports session files that already exist', async () => {
    const sessionId = 'import-existing-1';
    const projectDir = path.join(CLAUDE_ROOT, 'projects', '-p-imported');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, `${sessionId}.jsonl`),
      `${JSON.stringify({
        type: 'user',
        sessionId,
        cwd: '/p/imported',
        isMeta: false,
        timestamp: '2026-01-02T03:00:00.000Z',
        message: { role: 'user', content: 'an old imported session' },
      })}\n`,
    );

    await vscode.commands.executeCommand('agentSessions.importExisting');
    const record = await waitFor(() => readRecord('claude', sessionId));
    assert.strictEqual(record.launch.via, 'import');
    assert.strictEqual(record.title, 'an old imported session');
    assert.strictEqual(record.status, 'closed');
  });

  test('spool hook events are captured exactly', async () => {
    const spoolDir = path.join(STORAGE, 'spool');
    fs.mkdirSync(spoolDir, { recursive: true });
    const sessionId = 'hook-event-1';
    const date = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(
      path.join(spoolDir, `events-${date}.jsonl`),
      `${JSON.stringify({
        agent: 'claude',
        event: 'SessionStart',
        session_id: sessionId,
        cwd: '/p/hooked',
        transcript_path: '/tmp/hooked.jsonl',
        ts: new Date().toISOString(),
      })}\n`,
    );

    const record = await waitFor(() => readRecord('claude', sessionId));
    assert.strictEqual(record.bindingConfidence, 'exact');
    assert.strictEqual(record.launch.via, 'hook');
    assert.strictEqual(record.cwd, '/p/hooked');
  });
});
