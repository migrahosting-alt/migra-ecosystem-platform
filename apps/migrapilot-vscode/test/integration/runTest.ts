/**
 * Launch a REAL VS Code with the REAL extension loaded, against the REAL smoke workspace.
 *
 * This is not the vscode mock the unit tests use — it downloads VS Code, starts it on the
 * X display, activates `migrateck.migrapilot-vscode`, and runs the suite inside the actual
 * extension host. The `vscode` module the extension imports is the genuine one.
 *
 * What it CANNOT do: physically click a modal. Where the operator would click, the suite
 * stubs `showWarningMessage` — but it RECORDS the prompt and asserts the command that was
 * about to run, so "did it ask, and did it refuse without approval?" is still really tested.
 * The one thing left for a human is confirming the dialog is visible on screen.
 */
import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main() {
  // __dirname is out-int/test/integration → the package root is three levels up.
  const extensionDevelopmentPath = path.resolve(__dirname, "../../../");
  const extensionTestsPath = path.resolve(__dirname, "./index");
  const workspace = process.env.SMOKE_WORKSPACE
    ?? "/home/bonex/workspace/migrapilot-smoke-workspace";

  /* This session's environment sets ELECTRON_RUN_AS_NODE=1 (VS Code's own extension host
   * does). Inherited by the child, it makes the VS Code binary run as PLAIN NODE: it tries
   * to `require()` the workspace path and rejects every VS Code flag as a "bad option".
   * Strip it, or nothing launches. */
  delete process.env.ELECTRON_RUN_AS_NODE;

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      // --folder-uri, NOT a bare path: Electron treats a leading positional argument as a
      // module to require, and dies with MODULE_NOT_FOUND on the workspace directory.
      `--folder-uri=file://${workspace}`,
      "--disable-extensions",          // only ours loads — no interference
      "--disable-gpu",
      "--no-sandbox",
      "--disable-workspace-trust",     // the workspace is ours; a trust prompt would block
    ],
  });
}

main().catch((err) => {
  console.error("Integration run failed:", err);
  process.exit(1);
});
