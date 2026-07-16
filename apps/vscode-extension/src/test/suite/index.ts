import * as path from 'node:path';
import { glob } from 'glob';
import Mocha from 'mocha';

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 60_000 });
  const testsRoot = __dirname;

  // The ops-validation matrix runs only via its dedicated runner (opsIndex.js),
  // never in the normal gates.
  const files = (await glob('**/*.test.js', { cwd: testsRoot })).filter((f) => !f.includes('opsValidation'));
  for (const file of files) {
    mocha.addFile(path.resolve(testsRoot, file));
  }

  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
}
