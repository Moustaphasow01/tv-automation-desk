import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "live-signal-experience.spec.ts",
  outputDir: "./output/playwright/live-signal-experience",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8194",
    browserName: "chromium",
    serviceWorkers: "block",
    viewport: { width: 1672, height: 941 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
