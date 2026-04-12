import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@migrateck/api-contracts": path.resolve(__dirname, "./packages/api-contracts/src/index.ts"),
      "@migrateck/auth-core": path.resolve(__dirname, "./packages/auth-core/src/index.ts"),
      "@migrateck/org-core": path.resolve(__dirname, "./packages/org-core/src/index.ts"),
      "@migrateck/audit-core": path.resolve(__dirname, "./packages/audit-core/src/index.ts"),
      "@migrateck/events": path.resolve(__dirname, "./packages/events/src/index.ts"),
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
