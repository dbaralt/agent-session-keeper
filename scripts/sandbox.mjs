import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Launch an Extension Development Host in a throwaway profile.
 *
 *   npm run sandbox            create .sandbox/ if needed and launch
 *   npm run sandbox -- --reset delete .sandbox/ first
 *
 * Every agent root and the extension storage point inside .sandbox/, and
 * test/bin is put first on PATH, so nothing can touch real agent history.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = path.join(root, '.sandbox');
const reset = process.argv.includes('--reset');

if (reset && existsSync(sandbox)) {
  rmSync(sandbox, { recursive: true, force: true });
  console.log(`[sandbox] removed ${sandbox}`);
}

const dirs = {
  claude: path.join(sandbox, 'home/.claude'),
  codex: path.join(sandbox, 'home/.codex'),
  pi: path.join(sandbox, 'home/.pi/agent'),
  storage: path.join(sandbox, 'storage'),
  workspace: path.join(sandbox, 'workspace'),
  userData: path.join(sandbox, 'user-data'),
  extensions: path.join(sandbox, 'extensions'),
};

for (const dir of Object.values(dirs)) {
  mkdirSync(dir, { recursive: true });
}

const sample = path.join(dirs.workspace, 'README.md');
if (!existsSync(sample)) {
  writeFileSync(
    sample,
    '# Sandbox workspace\n\nA throwaway folder for testing Agent Session Keeper with fake agents.\n',
  );
}

if (!existsSync(path.join(root, 'dist/extension.js'))) {
  console.warn('[sandbox] dist/extension.js is missing — run `npm run build` first.');
}

const env = {
  ...process.env,
  PATH: [path.join(root, 'test/bin'), process.env.PATH ?? ''].join(path.delimiter),
  CLAUDE_CONFIG_DIR: dirs.claude,
  CODEX_HOME: dirs.codex,
  PI_CODING_AGENT_DIR: dirs.pi,
  AGENT_SESSIONS_STORAGE_DIR: dirs.storage,
};

console.log('[sandbox] paths:');
for (const [name, dir] of Object.entries(dirs)) {
  console.log(`  ${name.padEnd(10)} ${dir}`);
}
console.log('[sandbox] launching VS Code (Extension Development Host)…');

const result = spawnSync(
  'code',
  [
    `--extensionDevelopmentPath=${root}`,
    `--user-data-dir=${dirs.userData}`,
    `--extensions-dir=${dirs.extensions}`,
    dirs.workspace,
  ],
  { env, stdio: 'inherit' },
);

if (result.error?.code === 'ENOENT') {
  console.error(
    '[sandbox] could not find the `code` command.\n' +
      '          In VS Code run: Shell Command: Install \'code\' command in PATH.',
  );
  process.exitCode = 1;
} else if (typeof result.status === 'number') {
  process.exitCode = result.status;
}
