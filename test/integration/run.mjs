import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'agent-session-keeper-it-'));

// Safety: every agent root and the extension storage point at a temp folder.
// No real Claude Code, Codex or pi data is touched.
const env = {
  ...process.env,
  PATH: [path.join(root, 'test/bin'), process.env.PATH ?? ''].join(path.delimiter),
  CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'),
  PI_CODING_AGENT_DIR: path.join(tmp, 'pi'),
  AGENT_SESSIONS_STORAGE_DIR: path.join(tmp, 'storage'),
};
for (const key of ['CLAUDE_CONFIG_DIR', 'PI_CODING_AGENT_DIR', 'AGENT_SESSIONS_STORAGE_DIR']) {
  mkdirSync(env[key], { recursive: true });
}

const workspace = path.join(tmp, 'workspace');
mkdirSync(workspace, { recursive: true });

// @vscode/test-electron looks for `.../MacOS/Electron`; recent macOS builds
// name the binary `Code`. Download once (cached) and use whichever exists.
async function executablePath() {
  const expected = await downloadAndUnzipVSCode('stable');
  if (existsSync(expected)) return expected;
  const renamed = path.join(path.dirname(expected), 'Code');
  return existsSync(renamed) ? renamed : expected;
}

try {
  await runTests({
    vscodeExecutablePath: await executablePath(),
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
