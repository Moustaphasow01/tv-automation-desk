import { defineConfig } from "@playwright/test";

const executablePath = process.env.DESK_PLAYWRIGHT_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "control-plane-v2.spec.ts",
  outputDir: "./output/playwright/control-plane-v2",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.DESK_VNEXT_BASE_URL || "http://127.0.0.1:8091",
    browserName: "chromium",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
    serviceWorkers: "block",
    viewport: { width: 1792, height: 1024 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  }
});
