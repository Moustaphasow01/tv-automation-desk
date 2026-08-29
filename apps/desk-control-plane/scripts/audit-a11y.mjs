import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readySelectorForRoute } from "./audit-readiness.mjs";

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
const routeAttempts = Math.max(1, Number(process.env.DESK_A11Y_ROUTE_ATTEMPTS || 3));
const browser = await chromium.launch(browserLaunchOptions());
const findings = [];

try {
  for (const viewport of [{ name: "workstation", width: 1792, height: 1024 }, { name: "mobile", width: 320, height: 720 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: "block" });
    const loginPage = await context.newPage();
    await loginPage.goto(`${baseUrl}/#/command-center`, { waitUntil: "domcontentloaded" });
    await establishOperatorSessionWithRetry(loginPage);
    await loginPage.close();
    for (const route of routes) {
      let completed = false;
      let lastError = null;
      for (let attempt = 1; attempt <= routeAttempts; attempt += 1) {
        const page = await context.newPage();
        const runtimeErrors = [];
        page.on("console", (message) => {
          if (message.type() === "error") runtimeErrors.push({ type: "console", text: message.text() });
        });
        page.on("pageerror", (error) => runtimeErrors.push({ type: "pageerror", text: error.message }));
        try {
          await page.goto(`${baseUrl}/#/${route}`, { waitUntil: "domcontentloaded" });
          await establishOperatorSessionWithRetry(page);
          await page.locator("#main-content > *").first().waitFor({ state: "visible", timeout: 45_000 });
          const readySelector = readySelectorForRoute(route);
          if (readySelector) await page.locator(readySelector).waitFor({ state: "visible", timeout: 45_000 });
          if (route === "live") await page.locator(".lt-panel").first().waitFor({ state: "visible", timeout: 45_000 });
          const result = await new AxeBuilder({ page }).analyze();
          const operatorCopyAudit = await page.locator("body").innerText().then((content) => {
            const matches = content.match(/\b(?:unavailable|undefined)\b/gi) ?? [];
            return {
              defects: [...new Set(matches.map((match) => match.toLowerCase()))],
              contexts: [...new Set([...content.matchAll(/\b(?:unavailable|undefined)\b/gi)].map((match) =>
                content.slice(Math.max(0, (match.index ?? 0) - 120), Math.min(content.length, (match.index ?? 0) + 180)).replace(/\s+/g, " ").trim()
              ))]
            };
          });
          findings.push({ viewport: viewport.name, route, violations: result.violations, runtimeErrors: uniqueRuntimeErrors(runtimeErrors), operatorCopyDefects: operatorCopyAudit.defects, operatorCopyContexts: operatorCopyAudit.contexts });
          completed = true;
          console.log(`Axe progress ${findings.length}/${routes.length * 2}: ${viewport.name} /${route}`);
          break;
        } catch (error) {
          lastError = error;
          if (attempt < routeAttempts) {
            console.warn(`Axe retry ${attempt}/${routeAttempts - 1}: ${viewport.name} /${route} · ${error instanceof Error ? error.message : String(error)}`);
            await page.waitForTimeout(1_000).catch(() => undefined);
          }
        } finally {
          await page.close();
        }
      }
      if (!completed) {
        throw new Error(`A11Y_AUDIT_ROUTE_FAILED ${viewport.name} /${route}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const reportPath = resolve(scriptDirectory, "../../../reports/ui-ux/front-v2-axe.json");
await mkdir(resolve(reportPath, ".."), { recursive: true });
await writeFile(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl, findings }, null, 2)}\n`);
const blockers = findings.flatMap((finding) => finding.violations.map((violation) => ({ ...finding, violation }))).filter(({ violation }) => ["critical", "serious"].includes(violation.impact));
const runtimeBlockers = findings.flatMap((finding) => finding.runtimeErrors.map((runtimeError) => ({ ...finding, runtimeError })));
const copyBlockers = findings.filter((finding) => finding.operatorCopyDefects.length);
console.log(`Axe: ${findings.length} audits · ${blockers.length} blocker(s) serious/critical · ${runtimeBlockers.length} runtime error(s) · ${copyBlockers.length} operator-copy defect(s) · ${reportPath}`);
if (blockers.length || runtimeBlockers.length || copyBlockers.length) {
  blockers.forEach(({ viewport, route, violation }) => console.error(`${violation.impact} ${viewport} /${route} ${violation.id}: ${violation.help}`));
  runtimeBlockers.forEach(({ viewport, route, runtimeError }) => console.error(`runtime ${viewport} /${route} ${runtimeError.type}: ${runtimeError.text}`));
  copyBlockers.forEach(({ viewport, route, operatorCopyDefects }) => console.error(`operator-copy ${viewport} /${route}: ${operatorCopyDefects.join(", ")}`));
  process.exitCode = 1;
}

function uniqueRuntimeErrors(errors) {
  return [...new Map(errors.map((error) => [`${error.type}:${error.text}`, error])).values()];
}

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

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!await gate.isVisible().catch(() => false)) return;
    const form = gate.locator(".operator-login-gate__form");
    if (await form.isVisible().catch(() => false)) {
      await form.locator("input[autocomplete='username']").fill(process.env.DESK_OPERATOR_LOGIN || "MSO");
      await form.locator("input[autocomplete='current-password']").fill(process.env.DESK_OPERATOR_PASSWORD || "2018");
      await form.locator("button[type='submit']").click();
      await gate.waitFor({ state: "hidden", timeout: 45_000 }).catch(() => undefined);
      if (!await gate.isVisible().catch(() => false)) return;
    }

    const retry = gate.locator("button.operator-login-gate__secondary");
    if (await retry.isVisible().catch(() => false)) await retry.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);
    if (!await gate.isVisible().catch(() => false)) return;
  }

  throw new Error(`OPERATOR_SESSION_NOT_ESTABLISHED: ${(await gate.innerText().catch(() => "")).slice(0, 500)}`);
}

async function establishOperatorSessionWithRetry(page) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await establishOperatorSession(page);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await page.waitForTimeout(2_000).catch(() => undefined);
        await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
      }
    }
  }
  throw lastError;
}
