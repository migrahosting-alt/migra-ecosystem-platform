import * as path from 'node:path';
import Mocha from 'mocha';

// Dedicated runner for the P6 operational-validation matrix — runs ONLY the ops
// suite, in isolation, so evidence snapshots are clean and uncontaminated by the
// normal test suites.
export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 120_000 });
  mocha.addFile(path.resolve(__dirname, 'opsValidation.test.js'));

  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} ops scenario(s) failed.`));
      } else {
        resolve();
      }
    });
  });
}
