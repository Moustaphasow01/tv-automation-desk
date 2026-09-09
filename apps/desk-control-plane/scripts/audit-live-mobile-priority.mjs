import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const target = process.argv[2] || "http://localhost:8097/";
const hostname = new URL(target).hostname;
const local = ["localhost", "127.0.0.1"].includes(hostname);
if (!local && !(process.env.DESK_WORKSPACE_VERIFY_DEPLOYMENT === "1" && target.startsWith("https://vps-6d6969db.vps.ovh.net/"))) throw new Error("Unapproved audit target");
const output = resolve(process.env.DESK_WORKSPACE_OUTPUT || "output/playwright/live-mobile-priority");
mkdirSync(output, { recursive: true });
const report = { target, at: new Date().toISOString(), views: [], checks: [], errors: [], accessibility: [], networkErrors: [], blockedCommands: [] };
const browser = await chromium.launch({ headless: true, executablePath: process.env.DESK_PLAYWRIGHT_EXECUTABLE_PATH || undefined });
let page;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Europe/Paris", reducedMotion: "reduce" });
  page = await context.newPage();
  await page.route("**/front-api/v1/commands**", (route) => {
    if (route.request().method() !== "GET") { report.blockedCommands.push(route.request().method()); return route.abort(); }
    return route.continue();
  });
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 400) report.networkErrors.push({ path: new URL(response.url()).pathname, status: response.status(), at: new Date().toISOString() }); });
  await page.goto(target + "#/live?focus=1", { waitUntil: "domcontentloaded", timeout: 90000 });
  await Promise.race([page.getByLabel(/identifiant/i).waitFor({ timeout: 60000 }), page.getByTestId("trading-workspace").waitFor({ timeout: 60000 })]).catch(() => undefined);
  if (await page.getByLabel(/identifiant/i).isVisible()) {
    if (!process.env.DESK_OPERATOR_PASSWORD) throw new Error("Authenticated read-only audit requires credentials");
    await page.getByLabel(/identifiant/i).fill(process.env.DESK_OPERATOR_LOGIN || "MSO");
    await page.getByLabel(/mot de passe/i).fill(process.env.DESK_OPERATOR_PASSWORD);
    await page.getByRole("button", { name: /entrer dans le desk/i }).click();
  }
  await page.getByTestId("trading-workspace").waitFor({ timeout: 90000 });
  await page.locator(".tw-chart__canvas").first().waitFor({ timeout: 60000 });
  await checkHiddenPausedChart();
  await checkMobileMarkets();
  await checkOverview();
  if (local) await checkIsolatedPriorityEvents();
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error));
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true }).catch(() => undefined);
    writeFileSync(resolve(output, "failure-dom.txt"), await page.locator("body").ariaSnapshot().catch(() => "Unavailable"));
  }
} finally {
  await page?.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);
  writeFileSync(resolve(output, "live-mobile-audit.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ checks: report.checks, errors: report.errors, networkErrors: report.networkErrors, views: report.views, accessibility: report.accessibility }, null, 2));
if (report.errors.length || report.blockedCommands.length) process.exitCode = 1;

async function checkMobileMarkets() {
  for (const [width, height] of [[320, 640], [390, 844], [768, 1024], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator(".tw-chart-slot:visible")).toHaveCount(1);
    const picker = await page.locator(".tw-mobile-markets").boundingBox();
    const chart = await page.locator(".tw-chart__canvas").first().boundingBox();
    expect(picker.y).toBeLessThan(chart.y);
    expect(picker.height).toBeGreaterThanOrEqual(44);
    await recordView("focus", width, height, ".trading-workspace");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("navigation", { name: "Accès rapide aux marchés" }).getByRole("button", { name: "ZW", exact: true }).click();
  await expect(page.getByLabel("Actif du graphique 1", { exact: true })).toHaveValue("ZW");
  await page.getByRole("button", { name: "Listes", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Choisir un marché" })).toBeVisible();
  await checkAxe("mobile-market-picker", ".tw-dialog");
  await page.keyboard.press("Escape");
  await page.getByLabel("Actif du graphique 1", { exact: true }).selectOption("ZC");
  await expect(page.locator(".tw-chart-slot:visible .tw-chart")).toHaveAttribute("data-instrument", "ZC");
  await checkAxe("focus-mobile", ".trading-workspace");
  report.checks.push("One mobile chart, asset controls before the chart, 44px targets, dropdown and lists, portrait/landscape, Escape.");
}

async function checkHiddenPausedChart() {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[aria-label="Nombre de graphiques"]').getByRole("button", { name: "2", exact: true }).click();
  const second = page.locator(".tw-chart-slot").nth(1);
  await second.locator(".tw-chart__canvas").waitFor({ timeout: 60000 });
  await second.getByRole("button", { name: "Figer la lecture", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Reprendre toutes les lectures", exact: true })).toBeVisible();
  await expect(page.locator(".tw-chart-slot:visible")).toHaveCount(1);
  await page.getByRole("button", { name: "Reprendre toutes les lectures", exact: true }).click();
  await expect(page.locator(".tw-hidden-pauses")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(second.getByRole("button", { name: "Figer la lecture", exact: true })).toHaveAttribute("aria-pressed", "false");
  report.checks.push("A frozen secondary desktop chart stays frozen on mobile and has an explicit resume control; rotation never traps the operator in read-only mode.");
}

async function checkOverview() {
  await page.goto(target + "#/live", { waitUntil: "domcontentloaded" });
  await page.locator(".lt-overview").waitFor({ timeout: 90000 });
  await page.locator(".lt-overview .tw-chart__canvas").waitFor({ timeout: 60000 });
  for (const [width, height] of [[1440, 900], [1280, 600], [1024, 768], [390, 844], [320, 640]]) {
    await page.setViewportSize({ width, height });
    await recordView("live", width, height, ".lt-overview");
  }
  await page.getByLabel("Instrument du cockpit", { exact: true }).selectOption("ZW");
  await expect(page.locator(".lt-overview__market > .tw-chart")).toHaveAttribute("data-instrument", "ZW");
  await page.getByRole("tab", { name: /^Signaux/ }).click();
  await expect(page.getByRole("tabpanel", { name: /^Signaux/ })).toBeVisible();
  await checkAxe("live-mobile-signals", ".lt-overview");
  await page.setViewportSize({ width: 1440, height: 900 });
  await checkAxe("live-desktop", ".lt-overview");
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await page.getByTestId("trading-workspace").waitFor({ timeout: 60000 });
  report.checks.push("Live overview: real candle renderer, independent selector, signal tab, full context on demand and return to Focus.");
}

async function checkIsolatedPriorityEvents() {
  // Only localhost may receive these ephemeral contract fixtures; never the deployed desk.
  let stage = 0;
  await page.route("**/front-api/v1/views/live-focus*", async (route) => {
    try {
    const response = await route.fetch();
    if (!response.ok() || !stage) return route.fulfill({ response });
    const body = await response.json();
    const stamp = new Date().toISOString();
    const template = body.data.tradeCards[0];
    if (!template) throw new Error("No real card schema available for the isolated transition fixture");
    const card = { ...template, instrument: "ZC", orderIntentId: `TEST_LOCAL_PRIORITY_${stage}`, tradeCardId: `TEST_LOCAL_CARD_${stage}`, signalId: null,
      createdAt: stamp, asOf: stamp, expiresAt: new Date(Date.now() + 300000).toISOString(), availability: "AVAILABLE", actionable: true, terminal: false,
      terminalReason: null, temporalState: "ACTIVE", expiredByTime: false, operatorState: "PENDING", theoreticalState: "PENDING_ENTRY", theoreticalTradeStatus: "PENDING_ENTRY",
      lifecycleLabel: "TEST LOCAL · ticket à examiner", allowedActions: ["CONFIRM"], source: "ISOLATED_BROWSER_TEST_NO_EXECUTION" };
    body.meta = { ...body.meta, generatedAt: stamp, asOf: stamp, stale: false, availability: "AVAILABLE" };
    body.data = { ...body.data, asOf: stamp, tradeCards: [card] };
    await route.fulfill({ response, json: body });
    } catch {
      if (!page.isClosed()) report.networkErrors.push({ path: "/front-api/v1/views/live-focus", status: "ISOLATED_TEST_ROUTE_INTERRUPTED" });
      await route.abort().catch(() => undefined);
    }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(target + "#/live?focus=1&instrument=ZW&ticketId=none", { waitUntil: "domcontentloaded" });
  await page.getByTestId("trading-workspace").waitFor({ timeout: 90000 });
  await page.locator(".tw-chart__canvas").first().waitFor({ timeout: 60000 });
  stage = 1; await refreshFocus();
  await expect(page.getByLabel("Actif du graphique 1", { exact: true })).toHaveValue("ZC", { timeout: 60000 });
  await expect(page.locator(".tw-priority-message")).toContainText("ZC", { timeout: 60000 });
  await expect(page).toHaveURL(/ticketId=trade%3ATEST_LOCAL_PRIORITY_1/);
  await page.getByLabel("Actif du graphique 1", { exact: true }).selectOption("ZW");
  await refreshFocus();
  await expect(page.getByLabel("Actif du graphique 1", { exact: true })).toHaveValue("ZW");
  await page.locator(".tw-chart-slot:visible").getByRole("button", { name: "Figer la lecture", exact: true }).click();
  stage = 2; await refreshFocus();
  await expect(page.locator(".tw-priority-message")).toContainText("votre lecture est préservée", { timeout: 60000 });
  await expect(page.getByLabel("Actif du graphique 1", { exact: true })).toHaveValue("ZW");
  await page.locator(".tw-chart-slot:visible").getByRole("button", { name: /^Reprendre/ }).click();
  await expect(page.getByLabel("Actif du graphique 1", { exact: true })).toHaveValue("ZC", { timeout: 60000 });
  await page.screenshot({ path: resolve(output, "isolated-ticket-pivot.png") });
  report.checks.push("ISOLATED LOCAL FIXTURES: ZW → new ZC ticket and matching URL; no duplicate pivot; pause buffers next ticket until explicit resume. No order submitted.");
  await page.unroute("**/front-api/v1/views/live-focus*");
}

async function refreshFocus() {
  const options = page.locator(".tw-options");
  if (await options.getAttribute("open") === null) await options.locator("summary").click();
  await options.getByRole("button", { name: "Actualiser la séance", exact: true }).click();
  if (await options.getAttribute("open") !== null) await options.locator("summary").click();
}

async function recordView(screen, width, height, selector) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const geometry = await page.locator(selector).evaluate((element) => ({ contentWidth: element.getBoundingClientRect().width, scrollWidth: document.documentElement.scrollWidth, chartTop: element.querySelector(".tw-chart__canvas")?.getBoundingClientRect().top }));
  report.views.push({ screen, width, height, ...geometry });
  if (geometry.scrollWidth > width + 1) report.errors.push(`${screen}: overflow ${geometry.scrollWidth} at ${width}`);
  await page.screenshot({ path: resolve(output, `${screen}-${width}x${height}.png`) });
}

async function checkAxe(label, selector) {
  const result = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  report.accessibility.push({ label, violations: result.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) })) });
  if (result.violations.length) report.errors.push(`${label}: ${result.violations.length} accessibility violations`);
  writeFileSync(resolve(output, "live-mobile-audit.json"), JSON.stringify(report, null, 2));
}
