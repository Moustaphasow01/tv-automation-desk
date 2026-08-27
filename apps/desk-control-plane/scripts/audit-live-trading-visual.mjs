import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.DESK_VNEXT_BASE_URL || "http://127.0.0.1:8190";
const outputRoot = resolve(process.cwd(), "../../reports/ui-ux/live-trading");
const scenarios = [
  { name: "golden-1672x941", viewport: { width: 1672, height: 941 }, golden: true },
  { name: "laptop-1440x900", viewport: { width: 1440, height: 900 } },
  { name: "compact-1280x800", viewport: { width: 1280, height: 800 } },
  { name: "mobile-390x844", viewport: { width: 390, height: 844 } },
  { name: "mobile-430x932", viewport: { width: 430, height: 932 } },
];
const golden = {
  sidebar: { x: 0, y: 0, width: 96, height: 941 },
  header: { x: 96, y: 0, width: 1576, height: 52 },
  policy: { x: 96, y: 52, width: 1576, height: 32 },
  ribbon: { x: 96, y: 84, width: 1576, height: 60 },
  grid: { x: 96, y: 144, width: 1576, height: 797 },
};

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch(browserLaunchOptions());
const results = [];
try {
  for (const scenario of scenarios) {
    const context = await browser.newContext({ viewport: scenario.viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.goto(`${baseUrl}/#/live`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (await page.locator(".operator-login-gate").isVisible({ timeout: 5_000 }).catch(() => false)) {
      await page.locator(".operator-login-gate input[autocomplete='username']").fill(process.env.DESK_OPERATOR_LOGIN || "MSO");
      await page.locator(".operator-login-gate input[autocomplete='current-password']").fill(process.env.DESK_OPERATOR_PASSWORD || "2018");
      await page.locator(".operator-login-gate button[type='submit']").click();
    }
    await page.locator(".lt-page").waitFor({ state: "visible", timeout: 45_000 });
    await page.locator(".lt-panel").first().waitFor({ state: "visible", timeout: 45_000 });
    await page.screenshot({ path: resolve(outputRoot, `${scenario.name}.png`), fullPage: false });
    const measurement = await page.evaluate(() => {
      const read = (selector) => { const node = document.querySelector(selector); return node ? node.getBoundingClientRect().toJSON() : null; };
      const interactives = [...document.querySelectorAll("a,button,input,select,textarea,[tabindex]")].filter((node) => { const bounds = node.getBoundingClientRect(); const style = getComputedStyle(node); return bounds.width > 0 && bounds.height > 0 && style.visibility !== "hidden" && style.display !== "none"; });
      return {
        viewport: { width: innerWidth, height: innerHeight },
        document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
        sidebar: read(".desk-sidebar"), header: read(".lt-header"), policy: read(".lt-policy"), ribbon: read(".lt-decision-ribbon"), grid: read(".lt-grid"),
        panelCount: document.querySelectorAll(".lt-panel").length,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        clippedInteractiveCount: interactives.filter((node) => { const bounds = node.getBoundingClientRect(); return bounds.right > innerWidth + 1 || bounds.left < -1; }).length,
        editablePostRiskCount: document.querySelectorAll(".lt-panel--intent input,.lt-panel--intent select,.lt-panel--intent textarea,[contenteditable='true']").length,
        enabledGateActions: [...document.querySelectorAll(".lt-gate-actions button")].filter((node) => !node.disabled).length,
      };
    });
    const geometryFailures = [];
    if (scenario.golden) for (const [key, expected] of Object.entries(golden)) {
      const actual = measurement[key];
      if (!actual) geometryFailures.push(`${key}: missing`);
      else for (const metric of ["x", "y", "width", "height"]) if (Math.abs(actual[metric] - expected[metric]) > 1) geometryFailures.push(`${key}.${metric}: expected ${expected[metric]}, got ${actual[metric]}`);
    }
    results.push({ scenario, measurement, geometryFailures, consoleErrors });
    await context.close();
  }
} finally { await browser.close(); }

const failures = results.filter(({ measurement, geometryFailures, consoleErrors }) => measurement.horizontalOverflow || measurement.clippedInteractiveCount > 0 || measurement.panelCount !== 16 || measurement.editablePostRiskCount > 0 || geometryFailures.length || consoleErrors.length);
const reportPath = resolve(outputRoot, "live-trading-visual-qa.json");
await writeFile(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl, results }, null, 2)}\n`);
console.log(`Live Trading visual QA: ${results.length - failures.length}/${results.length} scenarios passed · ${reportPath}`);
for (const item of results) console.log(`${item.scenario.name}: overflow=${item.measurement.horizontalOverflow} clipped=${item.measurement.clippedInteractiveCount} panels=${item.measurement.panelCount} immutable=${item.measurement.editablePostRiskCount === 0} gateEnabled=${item.measurement.enabledGateActions} geometry=${item.geometryFailures.length} console=${item.consoleErrors.length}`);
if (failures.length) process.exitCode = 1;

function browserLaunchOptions() {
  return {
    headless: true,
    ...(process.env.DESK_PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.DESK_PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
  };
}
