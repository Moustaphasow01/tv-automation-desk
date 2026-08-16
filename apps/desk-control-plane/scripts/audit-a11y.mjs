import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = process.env.DESK_VNEXT_BASE_URL || "http://127.0.0.1:8091";
const defaultRoutes = [
  "command-center", "sessions", "live", "live/signals", "live/plan", "live/news", "live/timeline",
  "research", "research/experiments", "research/candidates", "research/agents", "research/data", "research/compute",
  "strategies", "strategies/deployments", "replay", "replay/runs", "replay/compare",
  "performance", "performance/calendar", "performance/strategies", "performance/trades",
  "operations", "operations/incidents", "operations/events", "operations/runbooks", "operations/observability",
  "execution/orders", "execution/portfolio", "execution/risk", "execution/providers", "execution/reconciliation",
  "governance/access", "governance/prompts", "governance/policies", "settings", "admin", "jarvis"
];
const routes = process.env.DESK_A11Y_ROUTES
  ? process.env.DESK_A11Y_ROUTES.split(",").map((route) => route.trim()).filter(Boolean)
  : defaultRoutes;
const browser = await chromium.launch(browserLaunchOptions());
const findings = [];
const routeConcurrency = Math.max(1, Number(process.env.DESK_A11Y_ROUTE_CONCURRENCY || 1));

try {
  for (const viewport of [{ name: "workstation", width: 1792, height: 1024 }, { name: "mobile", width: 320, height: 720 }]) {
    const context = await browser.newContext({ viewport });
    for (let offset = 0; offset < routes.length; offset += routeConcurrency) {
      const batch = routes.slice(offset, offset + routeConcurrency);
      await Promise.all(batch.map(async (route) => {
        const page = await context.newPage();
        try {
          await page.goto(`${baseUrl}/#/${route}`, { waitUntil: "domcontentloaded" });
          await page.locator("#main-content > *").first().waitFor({ state: "visible", timeout: 45_000 });
          const readySelector = route === "command-center" ? ".cc-page" : route === "live" ? ".lt-page" : null;
          if (readySelector) await page.locator(readySelector).waitFor({ state: "visible", timeout: 45_000 });
          const result = await new AxeBuilder({ page }).analyze();
          findings.push({ viewport: viewport.name, route, violations: result.violations });
        } catch (error) {
          throw new Error(`A11Y_AUDIT_ROUTE_FAILED ${viewport.name} /${route}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          await page.close();
        }
      }));
    }
    await context.close();
  }
} finally {
  await browser.close();
}

const reportPath = resolve(process.cwd(), "../../reports/ui-ux/front-v2-axe.json");
await mkdir(resolve(reportPath, ".."), { recursive: true });
await writeFile(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl, findings }, null, 2)}\n`);
const blockers = findings.flatMap((finding) => finding.violations.map((violation) => ({ ...finding, violation }))).filter(({ violation }) => ["critical", "serious"].includes(violation.impact));
console.log(`Axe: ${findings.length} audits · ${blockers.length} blocker(s) serious/critical · ${reportPath}`);
if (blockers.length) {
  blockers.forEach(({ viewport, route, violation }) => console.error(`${violation.impact} ${viewport} /${route} ${violation.id}: ${violation.help}`));
  process.exitCode = 1;
}

function browserLaunchOptions() {
  return {
    headless: true,
    ...(process.env.DESK_PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.DESK_PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
  };
}
