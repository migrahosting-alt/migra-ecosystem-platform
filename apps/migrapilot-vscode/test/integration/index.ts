import * as path from "path";
import Mocha from "mocha";

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 300_000 });
  const suiteFile = process.env.SMOKE_SUITE ?? "smoke.test.js";
  mocha.addFile(path.resolve(__dirname, `./${suiteFile}`));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures ? reject(new Error(`${failures} test(s) failed`)) : resolve()));
  });
}
