import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_APP_PORT || 3209);

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  globalSetup: "./test/e2e/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
