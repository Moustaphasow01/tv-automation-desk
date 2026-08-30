import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.DESK_VNEXT_BASE_URL || "http://127.0.0.1:8190";
const outputRoot = resolve(process.cwd(), "../../reports/ui-ux/command-center");
const scenarioCatalog = [
  { name: "golden-1672x941", viewport: { width: 1672, height: 941 }, golden: true },
  { name: "desktop-full-hd-1920x1080", viewport: { width: 1920, height: 1080 } },
  { name: "laptop-1440x900", viewport: { width: 1440, height: 900 } },
  { name: "tablet-1024x768", viewport: { width: 1024, height: 768 } },
  { name: "mobile-390x844", viewport: { width: 390, height: 844 } },
];
const requestedScenario = process.env.DESK_VNEXT_VISUAL_SCENARIO;
const scenarios = requestedScenario ? scenarioCatalog.filter((scenario) => scenario.name === requestedScenario) : scenarioCatalog;
if (!scenarios.length) throw new Error(`UNKNOWN_VISUAL_SCENARIO:${requestedScenario}`);

const golden = {
  sidebar: { x: 0, y: 0, width: 200, height: 941 },
  header: { x: 200, y: 0, width: 1472, height: 57 },
  workspace: { x: 200, y: 57, width: 1472, height: 884 },
  kpis: { x: 214, y: 66, width: 1448, height: 93 },
  top: { x: 214, y: 168, width: 1448, height: 288 },
  middle: { x: 214, y: 465, width: 1448, height: 214 },
  bottom: { x: 214, y: 688, width: 1448, height: 202 },
};

const rect = (value) => value ? {
  x: value.x,
  y: value.y,
  width: value.width,
  height: value.height,
} : null;

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch(browserLaunchOptions());
const results = [];
try {
  for (const scenario of scenarios) {
    const context = await browser.newContext({ viewport: scenario.viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) consoleErrors.push(`HTTP ${response.status()} ${response.url()}`);
    });
    await page.goto(`${baseUrl}/#/command-center`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await establishOperatorSession(page);
    await page.locator(".cc-page").waitFor({ state: "visible", timeout: 45_000 });
    await page.locator(".cc-panel").first().waitFor({ state: "visible", timeout: 45_000 });
    await page.screenshot({ path: resolve(outputRoot, `${scenario.name}.png`), fullPage: false });
    const measurement = await page.evaluate(() => {
      const read = (selector) => {
        const node = document.querySelector(selector);
        return node ? node.getBoundingClientRect().toJSON() : null;
      };
      const interactive = [...document.querySelectorAll("a, button, input, select, textarea, [tabindex]")]
        .filter((node) => {
          const style = getComputedStyle(node);
          const bounds = node.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
        });
      const isInsideHorizontalScroller = (node) => {
        let ancestor = node.parentElement;
        while (ancestor && ancestor !== document.body) {
          const style = getComputedStyle(ancestor);
          if (["auto", "scroll"].includes(style.overflowX) && ancestor.scrollWidth > ancestor.clientWidth) return true;
          ancestor = ancestor.parentElement;
        }
        return false;
      };
      const clippedInteractives = interactive.filter((node) => {
        const bounds = node.getBoundingClientRect();
        return (bounds.right > innerWidth + 1 || bounds.left < -1) && !isInsideHorizontalScroller(node);
      });
      return {
        viewport: { width: innerWidth, height: innerHeight },
        document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
        sidebar: read(".desk-sidebar"),
        header: read(".cc-header"),
        workspace: read(".cc-workspace"),
        kpis: read(".cc-kpis"),
        top: read(".cc-grid--top"),
        middle: read(".cc-grid--middle"),
        bottom: read(".cc-grid--bottom"),
        kpiCount: document.querySelectorAll(".cc-kpis > .cc-kpi").length,
        panelCount: document.querySelectorAll(".cc-panel").length,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        clippedInteractiveCount: clippedInteractives.length,
        clippedInteractives: clippedInteractives.map((node) => ({
          tag: node.tagName,
          className: node.className,
          text: (node.textContent || "").trim().slice(0, 80),
          bounds: node.getBoundingClientRect().toJSON(),
        })),
      };
    });
    const geometryFailures = [];
    if (scenario.golden) {
      for (const [key, expected] of Object.entries(golden)) {
        const actual = rect(measurement[key]);
        if (!actual) {
          geometryFailures.push(`${key}: missing`);
          continue;
        }
        for (const metric of ["x", "y", "width", "height"]) {
          if (Math.abs(actual[metric] - expected[metric]) > 1) {
            geometryFailures.push(`${key}.${metric}: expected ${expected[metric]}, got ${actual[metric]}`);
          }
        }
      }
    }
    results.push({ scenario, measurement, geometryFailures, consoleErrors });
    await context.close();
  }
} finally {
  await browser.close();
}

const failures = results.filter(({ measurement, geometryFailures, consoleErrors }) =>
  measurement.horizontalOverflow
  || measurement.clippedInteractiveCount > 0
  || measurement.kpiCount !== 6
  || measurement.panelCount !== 10
  || geometryFailures.length > 0
  || consoleErrors.length > 0);

const reportPath = resolve(outputRoot, "command-center-visual-qa.json");
await writeFile(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl, results }, null, 2)}\n`);
console.log(`Command Center visual QA: ${results.length - failures.length}/${results.length} scenarios passed · ${reportPath}`);
for (const result of results) {
  console.log(`${result.scenario.name}: overflow=${result.measurement.horizontalOverflow} clipped=${result.measurement.clippedInteractiveCount} panels=${result.measurement.panelCount} geometry=${result.geometryFailures.length} console=${result.consoleErrors.length}`);
}
if (failures.length) process.exitCode = 1;

function browserLaunchOptions() {
  return {
    headless: true,
    ...(process.env.DESK_PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.DESK_PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
  };
}

async function establishOperatorSession(page) {
  const gate = page.locator(".operator-login-gate");
  if (!await gate.isVisible({ timeout: 5_000 }).catch(() => false)) return;

  for (let attempt = 0; attempt < 15; attempt += 1) {
    const form = gate.locator(".operator-login-gate__form");
    if (await form.isVisible().catch(() => false)) {
      await form.locator("input[autocomplete='username']").fill(process.env.DESK_OPERATOR_LOGIN || "MSO");
      await form.locator("input[autocomplete='current-password']").fill(process.env.DESK_OPERATOR_PASSWORD || "2018");
      await form.locator("button[type='submit']").click();
      await gate.waitFor({ state: "hidden", timeout: 45_000 }).catch(() => undefined);
      if (!await gate.isVisible().catch(() => false)) return;
    }

    const retry = gate.locator("button.operator-login-gate__secondary");
    if (await retry.isVisible().catch(() => false)) await retry.click();
    await page.waitForTimeout(1_000);
  }

  throw new Error(`OPERATOR_SESSION_NOT_ESTABLISHED: ${(await gate.innerText().catch(() => "")).slice(0, 500)}`);
}
