import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["test/integration/**/*.integration.test.ts"],
    globalSetup: ["./test/setup/global.ts"],
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
