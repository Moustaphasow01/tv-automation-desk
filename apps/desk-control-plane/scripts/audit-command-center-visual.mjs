import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.DESK_VNEXT_BASE_URL || "http://127.0.0.1:8190";
const outputRoot = resolve(process.cwd(), "../../reports/ui-ux/command-center");
const scenarios = [
  { name: "golden-1672x941", viewport: { width: 1672, height: 941 }, golden: true },
  { name: "desktop-full-hd-1920x1080", viewport: { width: 1920, height: 1080 } },
  { name: "laptop-1440x900", viewport: { width: 1440, height: 900 } },
  { name: "tablet-1024x768", viewport: { width: 1024, height: 768 } },
  { name: "mobile-390x844", viewport: { width: 390, height: 844 } },
];

const golden = {
  sidebar: { x: 0, y: 0, width: 164, height: 941 },
  header: { x: 164, y: 0, width: 1508, height: 57 },
  workspace: { x: 164, y: 57, width: 1508, height: 884 },
  kpis: { x: 178, y: 66, width: 1484, height: 93 },
  top: { x: 178, y: 168, width: 1484, height: 288 },
  middle: { x: 178, y: 465, width: 1484, height: 214 },
  bottom: { x: 178, y: 688, width: 1484, height: 202 },
};

const rect = (value) => value ? {
  x: value.x,
  y: value.y,
  width: value.width,
  height: value.height,
} : null;

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({ headless: true });
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
    await page.goto(`${baseUrl}/#/command-center`, { waitUntil: "domcontentloaded", timeout: 45_000 });
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
        clippedInteractiveCount: interactive.filter((node) => {
          const bounds = node.getBoundingClientRect();
          return bounds.right > innerWidth + 1 || bounds.left < -1;
        }).length,
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
