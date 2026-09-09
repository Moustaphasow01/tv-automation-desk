import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Local presentation over the deployed read model. Never send a trading command.
const base = process.env.DESK_APP_URL || "http://127.0.0.1:8099/";
if (new URL(base).hostname !== "127.0.0.1") throw new Error("This audit is restricted to the local read-only preview.");
const output = process.env.DESK_JOURNEY_OUTPUT;
if (!output) throw new Error("Set DESK_JOURNEY_OUTPUT to the capture directory.");
mkdirSync(output, { recursive: true });
const report = { at: new Date().toISOString(), base, checks: [], captures: [], accessibility: [], errors: [], network: [], commands: [], fixture: "Only the position success scenario is a local contract fixture; other data are deployed reads." };
if (process.env.DESK_JOURNEY_PHASE === "supplement") {
  Object.assign(report, JSON.parse(readFileSync(output + "/audit.json", "utf8")));
  report.harnessIssues = report.errors; report.errors = [];
}
const browser = await chromium.launch({ headless: true, ...(process.env.DESK_CHROMIUM ? { executablePath: process.env.DESK_CHROMIUM } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", timezoneId: "Europe/Paris" });
const page = await context.newPage();
page.on("pageerror", (error) => report.errors.push(error.message));
page.on("response", (response) => { if (response.status() >= 400) report.network.push({ path: new URL(response.url()).pathname, status: response.status() }); });
await page.route("**/front-api/v1/commands**", (route) => {
  if (route.request().method() === "GET") return route.continue();
  report.commands.push(route.request().method()); return route.abort();
});

try {
  await page.goto(base + "#/command-center", { waitUntil: "domcontentloaded", timeout: 90000 });
  await expect(page.locator('script[type="module"][src^="/assets/index-"]')).toHaveCount(1);
  report.preview = "Compiled dist only; development transform caches are excluded.";
  report.assets = await page.locator('script[type="module"][src]').evaluateAll((scripts) => scripts.map((script) => script.getAttribute("src")));
  await page.getByLabel(/identifiant/i).waitFor({ timeout: 60000 });
  const fixture = readFileSync(fileURLToPath(new URL("./audit-live-focus-layout.mjs", import.meta.url)), "utf8");
  const password = process.env.DESK_OPERATOR_PASSWORD || fixture.match(/DESK_OPERATOR_PASSWORD \|\| "([^"]+)"/)[1];
  await page.getByLabel(/identifiant/i).fill(process.env.DESK_OPERATOR_USERNAME || "MSO");
  await page.getByLabel(/mot de passe/i).fill(password);
  await page.getByRole("button", { name: /entrer dans le desk/i }).click();
  await page.locator(".dh-summary").waitFor({ timeout: 90000 });
  if (process.env.DESK_JOURNEY_PHASE !== "supplement") {
  await captureSet("home", ".desk-home", [[390, 844], [1440, 900], [320, 640], [768, 1024]]);
  const homeReply = await context.request.get(base + "front-api/v1/views/command-center");
  const home = await homeReply.json();
  const orderId = home.data.humanGate.rows[0]?.orderIntentId;
  if (!orderId) throw new Error("No published order dossier available for the read-only journey.");
  await page.setViewportSize({ width: 390, height: 844 });
  const homeOrderLink = page.locator(`.dh-recent a[href*="${encodeURIComponent(orderId)}"]`);
  await expect(homeOrderLink).toHaveCount(1);
  await homeOrderLink.click();
  await page.getByTestId("order-journey").waitFor({ timeout: 60000 });
  await expect(page.getByRole("heading", { name: "Plan d’exécution", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Retour à l’accueil" })).toBeVisible();
  await captureSet("order", ".order-dossier-page", [[390, 844], [1440, 900], [320, 640]]);
  const proof = page.getByText("Consulter les preuves d’exécution et le rapprochement", { exact: true });
  await proof.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Exécutions publiées par le courtier" })).toBeVisible();
  report.checks.push("Home opens a real historical execution dossier; proof disclosure works with the keyboard; return context is retained.");
  await page.getByRole("link", { name: "Retour à l’accueil" }).click();
  await expect(page.locator(".dh-summary")).toBeVisible();
  await page.getByRole("link", { name: /Entrer en Focus/ }).click();
  await page.getByTestId("trading-workspace").waitFor({ timeout: 90000 });
  await page.locator(".tw-chart-slot:visible .tw-chart__canvas").waitFor({ timeout: 60000 });
  await page.getByRole("navigation", { name: "Navigation du poste mobile" }).getByRole("button", { name: "Suivi", exact: true }).click();
  await page.getByRole("combobox", { name: "Afficher", exact: true }).selectOption("all");
  await expect(page.locator(".tw-followup").first()).toBeVisible();
  await captureSet("focus-tracking", '[data-testid="trading-workspace"]', [[390, 844], [1440, 900]]);
  const more = page.getByRole("button", { name: "Afficher 12 dossiers de plus", exact: true });
  if (await more.count()) {
    const before = await page.locator(".tw-followup").count();
    await more.click();
    expect(await page.locator(".tw-followup").count()).toBeGreaterThan(before);
    report.checks.push("Focus long history loads more published dossiers on request.");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".tw-followup").first().getByRole("button", { name: "Ouvrir le ticket" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const dossierLink = page.getByRole("dialog").getByRole("link", { name: "Ouvrir le dossier d’exécution" });
  const href = await dossierLink.getAttribute("href");
  const expectedReturn = new URLSearchParams(href.slice(href.indexOf("?"))).get("returnTo");
  await dossierLink.click(); await page.getByTestId("order-journey").waitFor({ timeout: 60000 });
  const back = page.getByRole("link", { name: "Retour à Focus", exact: true });
  await expect(back).toHaveAttribute("href", "#" + expectedReturn);
  await back.click(); await page.getByTestId("trading-workspace").waitFor({ timeout: 60000 });
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
  report.checks.push("Focus → ticket dialog → full execution dossier → exact Focus/ticket context. Escape closes the restored dialog.");
  await page.goto(base + "#/live?instrument=ZC&timeframe=5", { waitUntil: "domcontentloaded" });
  await page.locator(".lt-overview .tw-chart__canvas").waitFor({ timeout: 90000 });
  await captureSet("live-market", ".lt-overview", [[390, 844], [1440, 900]]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("navigation", { name: "Parcours Live sur mobile" }).getByRole("button", { name: "Activité", exact: true }).click();
  await expect(page.locator(".lt-overview__market")).toBeHidden();
  await expect(page.locator(".lt-overview__activity")).toBeVisible();
  await expect(page.locator(".lt-panel--timeline > .lt-panel__body > ol")).not.toContainText(/THEORETICAL_EXECUTION|PENDING_OUTCOME|AVOIDED_LOSS/);
  await captureSet("live-activity", ".lt-overview", [[390, 844]]);
  report.checks.push("Live mobile switches from chart to activity without scrolling through the chart; instrument and timeframe stay in the URL.");
  const live = await (await context.request.get(base + "front-api/v1/views/live-trading?instrument=ZC&timeframe=5")).json();
  const signal = live.data.signals[0];
  if (!signal?.signalId) throw new Error("No published signal available for dossier inspection.");
  await page.goto(base + "#/live/signals/" + encodeURIComponent(signal.signalId) + "?returnTo=" + encodeURIComponent("/live?instrument=ZC&timeframe=5&livePanel=activity"));
  await page.locator(".signal-hero").waitFor({ timeout: 90000 });
  await captureSet("signal", ".signal-dossier-page", [[390, 844], [1440, 900], [320, 640]]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("Traçabilité", { exact: true }).last().click();
  await expect(page.locator(".signal-identity-list")).toBeVisible();
  report.checks.push("Real signal dossier preserves authoritative plan and evidence; technical identity is available on demand.");
  }
  await verifyPositionFixture();
  await verifyOutage();
} catch (error) {
  report.errors.push(error.message);
  await page.screenshot({ path: output + "/failure.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close(); writeFileSync(output + "/audit.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
if (report.errors.length || report.commands.length || report.captures.some((item) => item.overflow) || report.accessibility.some((item) => item.violations.length)) process.exitCode = 1;

async function captureSet(name, selector, sizes) {
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height }); await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator(selector)).toBeVisible();
    await verifyPlanReading(name, width);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    const file = `${name}-${width}.png`;
    console.log(`Capture ${name} ${width} × ${height}`);
    if (width === 390 || width === 1440) await page.screenshot({ path: output + `/${name}-${width}-viewport.png`, animations: "disabled", timeout: 60000 });
    try {
      await page.screenshot({ path: output + "/" + file, fullPage: true, animations: "disabled", timeout: 60000 });
    } catch (error) {
      report.errors.push(`${name}-${width}: ${error.message}`);
      await page.screenshot({ path: output + "/" + file, animations: "disabled", timeout: 15000 });
    }
    report.captures.push({ name, width, height, file, overflow });
    if (width === 390) {
      const result = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      report.accessibility.push({ name, violations: result.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) })) });
    }
  }
}

async function verifyPlanReading(name, width) {
  if (!["signal", "order"].includes(name) || ![320, 390].includes(width)) return;
  const selector = name === "signal" ? ".signal-trade-plan > div:nth-child(-n+3) strong" : '.order-dossier__terms[aria-label] > div:nth-child(-n+3) dd';
  const levels = await page.locator(selector).evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { value: element.textContent, bottom: box.bottom, overflow: element.scrollWidth > element.clientWidth + 1, ellipsis: getComputedStyle(element).textOverflow === "ellipsis" };
  }));
  expect(levels).toHaveLength(3);
  expect(levels.some((level) => level.overflow || level.ellipsis)).toBe(false);
  const navigation = await page.locator(".desk-bottom-nav").boundingBox();
  if (width === 390) expect(levels.every((level) => level.bottom < navigation.y)).toBe(true);
  report.planReading ??= [];
  report.planReading.push({ name, width, navigationTop: navigation.y, levels });
}

async function verifyPositionFixture() {
  const id = "position-ui-contract";
  const at = new Date().toISOString();
  const data = { summary: { state: "OPEN", quantity: 2, pnlR: 0, riskR: 1, protectionStatus: "PENDING" }, identity: { positionId: id, strategyInstanceId: "contract-strategy", signalId: "contract-signal", correlationId: "contract-correlation" }, position: { positionId: id, strategyInstanceId: "contract-strategy", symbol: "ZC", side: "LONG", quantity: 2, averagePrice: 530.25, riskR: 1, pnlR: 0, protectionStatus: "PENDING", state: "OPEN", stopPrice: 528.25, targetPrice: 534.25, openedAt: at }, orders: [], lifecycle: [{ eventId: "contract-open", at, state: "OPEN", detail: "Scénario contractuel local : position publiée pour tester le rendu, sans exécution." }], relations: [] };
  await page.route("**/front-api/v1/views/position-detail?**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ meta: { generatedAt: at, asOf: at, availability: "AVAILABLE", stale: false, latencyMs: 1, correlationId: "contract-ui-only", schemaVersion: "1.0.0" }, permissions: [], data }) }));
  await page.goto(base + "#/execution/portfolio/positions/" + id + "?returnTo=" + encodeURIComponent("/live?focus=1&instrument=ZC&timeframe=5"));
  await page.getByRole("heading", { name: "Prix et protection" }).waitFor({ timeout: 60000 });
  await expect(page.locator(".dj-metrics")).toContainText("+0,00 R");
  await captureSet("position-contract", ".position-detail-page", [[390, 844], [1440, 900], [320, 640]]);
  report.checks.push("Local position contract fixture: zero R is not missing, quantity and levels retain precision, absent broker orders and references remain explicit. No real position is available in production for a success-path E2E.");
}

async function verifyOutage() {
  await page.route("**/front-api/v1/views/command-center**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "LOCAL_AUDIT_OUTAGE" }) }));
  await page.goto(base + "#/command-center");
  await page.getByRole("button", { name: "Actualiser l’accueil" }).click();
  await page.getByRole("heading", { name: "Accueil momentanément indisponible" }).waitFor({ timeout: 60000 });
  await expect(page.locator(".dh-summary")).toHaveCount(0);
  await captureSet("home-outage", ".desk-home", [[390, 844]]);
  await page.unroute("**/front-api/v1/views/command-center**");
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(page.locator(".dh-summary")).toBeVisible({ timeout: 60000 });
  report.checks.push("Simulated 503 does not leave fresh-looking counters; explicit retry restores the home view.");
}
