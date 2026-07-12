import { defineConfig } from "vitest/config";
import * as path from "path";

// The extension imports `vscode`, which only exists inside the VS Code
// extension host. For behavior tests we alias it to a faithful in-memory mock
// (test/harness/vscodeMock.ts) so the SAME production code under src/ runs
// unchanged against controllable APIs. Only the vscode boundary is mocked —
// pilotClient's fetch/SSE parsing, ContextCollector, and the message builders
// all run for real.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // test/integration runs inside a REAL VS Code (@vscode/test-electron): it imports the
    // genuine `vscode` module and needs a display. vitest's in-memory mock cannot load it,
    // and CI has no VS Code. Run it with `npm run test:integration`, never with vitest.
    exclude: ["node_modules/**", "test/integration/**"],
    environment: "node",
    globals: false,
    hookTimeout: 20000,
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, "test/harness/vscodeMock.ts"),
    },
  },
});
