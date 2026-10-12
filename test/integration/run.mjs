import { runTests } from '@vscode/test-electron';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'agent-session-keeper-it-'));

// Safety: every agent root and the extension storage point at a temp folder.
// No real Claude Code, Codex or pi data is touched.
const env = {
  ...process.env,
  CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'),
  CODEX_HOME: path.join(tmp, 'codex'),
  PI_CODING_AGENT_DIR: path.join(tmp, 'pi'),
  AGENT_SESSIONS_STORAGE_DIR: path.join(tmp, 'storage'),
};
for (const key of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'PI_CODING_AGENT_DIR', 'AGENT_SESSIONS_STORAGE_DIR'] as const) {
  mkdirSync(env[key], { recursive: true });
}

const workspace = path.join(tmp, 'workspace');
mkdirSync(workspace, { recursive: true });

try {
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'test/integration/suite/index.cjs'),
    launchArgs: [
      workspace,
      '--disable-extensions',
      `--user-data-dir=${path.join(tmp, 'user-data')}`,
      `--extensions-dir=${path.join(tmp, 'extensions')}`,
    ],
    extensionTestsEnv: env,
  });
} catch (error) {
  console.error('Integration tests failed:', error);
  process.exitCode = 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
