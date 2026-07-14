import { defineConfig } from "vitest/config";

/**
 * Unit tests for the console app.
 *
 * The workspace-root vitest.config.ts only includes `test/integration/**`, so
 * without this the console's unit tests are silently never collected — which is
 * how security-sensitive behaviour (support actor resolution) shipped untested.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
