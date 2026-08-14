import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.DESK_VNEXT_BASE_URL || "http://127.0.0.1:8090";
const outputRoot = resolve(process.cwd(), "../../reports/ui-ux/screenshots");
const scenarios = [
  {
    name: "workstation-1792x1024",
    viewport: { width: 1792, height: 1024 },
    deviceScaleFactor: 1,
    expectedPhysical: { sidebarWidth: 196, topbarHeight: 64, footerHeight: 32 }
  },
  {
    name: "windows150-1920x878",
    viewport: { width: 1280, height: 585 },
    deviceScaleFactor: 1.5,
    platform: "Win32",
    screenWidth: 1280,
    expectedPhysical: { sidebarWidth: 196, topbarHeight: 64, footerHeight: 32 }
  },
  { name: "laptop-1366x768", viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 },
  { name: "mobile-320x720", viewport: { width: 320, height: 720 }, deviceScaleFactor: 1 }
];

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const scenario of scenarios) {
    const context = await browser.newContext({ viewport: scenario.viewport, deviceScaleFactor: scenario.deviceScaleFactor });
    const page = await context.newPage();
    if (scenario.platform) {
      await page.addInitScript(({ platform, screenWidth }) => {
        Object.defineProperty(window.navigator, "platform", { configurable: true, get: () => platform });
        Object.defineProperty(window.navigator, "userAgentData", { configurable: true, get: () => ({ platform }) });
        Object.defineProperty(window.screen, "width", { configurable: true, get: () => screenWidth });
      }, { platform: scenario.platform, screenWidth: scenario.screenWidth });
    }
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.goto(`${baseUrl}/#/execution/portfolio`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.getByRole("heading", { name: "Portefeuille & Positions" }).waitFor({ state: "visible", timeout: 45_000 });
    const screenshot = resolve(outputRoot, `${scenario.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: false });
    const geometry = await page.evaluate(() => {
      const rect = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const value = node.getBoundingClientRect();
        return { x: value.x, y: value.y, width: value.width, height: value.height };
      };
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
        document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
        sidebar: rect(".desk-sidebar"),
        topbar: rect(".desk-topbar"),
        footer: rect(".desk-status-footer"),
        kpiCount: document.querySelectorAll(".portfolio-kpi-strip > .ds-card").length,
        sidebarOverflow: (() => {
          const sidebar = document.querySelector(".desk-sidebar");
          if (!sidebar || getComputedStyle(sidebar).display === "none") return false;
          const boundary = sidebar.getBoundingClientRect();
          return [...sidebar.querySelectorAll(".brand-block, .sidebar-nav, .sidebar-status-stack")]
            .some((node) => node.getBoundingClientRect().right > boundary.right + 1);
        })(),
        globalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    });
    const physicalGeometry = {
      sidebarWidth: geometry.sidebar ? geometry.sidebar.width * scenario.deviceScaleFactor : null,
      topbarHeight: geometry.topbar ? geometry.topbar.height * scenario.deviceScaleFactor : null,
      footerHeight: geometry.footer ? geometry.footer.height * scenario.deviceScaleFactor : null
    };
    const geometryFailures = scenario.expectedPhysical
      ? Object.entries(scenario.expectedPhysical)
        .filter(([key, expected]) => physicalGeometry[key] == null || Math.abs(physicalGeometry[key] - expected) > 1)
        .map(([key, expected]) => `${key}: expected ${expected}px, got ${physicalGeometry[key] ?? "missing"}px`)
      : [];
    results.push({ ...scenario, screenshot, geometry, physicalGeometry, geometryFailures, consoleErrors });
    await context.close();
  }
} finally {
  await browser.close();
}

const report = resolve(outputRoot, "visual-qa.json");
await writeFile(report, `${JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl, results }, null, 2)}\n`);
const failures = results.filter((result) => result.geometry.globalOverflow
  || result.geometry.sidebarOverflow
  || result.consoleErrors.length
  || result.geometry.kpiCount !== 6
  || result.geometryFailures.length);
console.log(`Visual QA: ${results.length} captures · ${failures.length} failure(s) · ${report}`);
for (const result of results) console.log(`${result.name}: ${JSON.stringify(result.geometry)} · physical=${JSON.stringify(result.physicalGeometry)} · geometryFailures=${result.geometryFailures.length} · consoleErrors=${result.consoleErrors.length}`);
if (failures.length) process.exitCode = 1;
