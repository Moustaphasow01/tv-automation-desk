import { defineConfig } from "@playwright/test";

const executablePath = process.env.DESK_PLAYWRIGHT_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "operations-real-stack.spec.ts",
  outputDir: "./output/playwright/real-stack-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8080",
    browserName: "chromium",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
    serviceWorkers: "block",
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  }
});
