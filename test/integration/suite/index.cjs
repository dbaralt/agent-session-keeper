const path = require('node:path');
const Mocha = require('mocha');

/**
 * Entry point @vscode/test-electron runs inside the Extension Development Host.
 * Add more test files here as milestones land.
 */
async function run() {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 60000 });
  mocha.addFile(path.join(__dirname, 'activation.test.cjs'));
  mocha.addFile(path.join(__dirname, 'capture.test.cjs'));
  mocha.addFile(path.join(__dirname, 'restore.test.cjs'));
  mocha.addFile(path.join(__dirname, 'ui.test.cjs'));

  await new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} integration test(s) failed`));
      } else {
        resolve();
      }
    });
  });
}

module.exports = { run };
