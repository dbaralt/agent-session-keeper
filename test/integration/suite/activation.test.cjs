const assert = require('node:assert');
const vscode = require('vscode');

const EXTENSION_ID = 'danielbaralt.agent-session-keeper';

suite('Agent Session Keeper extension', () => {
  test('activates in the development host', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `extension ${EXTENSION_ID} should be installed`);
    await extension.activate();
    assert.strictEqual(extension.isActive, true);
  });

  test('registers its commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'agentSessions.openHistory',
      'agentSessions.resume',
      'agentSessions.restoreInterrupted',
      'agentSessions.installHooks',
    ]) {
      assert.ok(commands.includes(id), `command ${id} should be registered`);
    }
  });
});
