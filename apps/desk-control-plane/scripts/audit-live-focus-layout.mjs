import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const viewports = [
  { width: 1280, height: 720 },
  { width: 1280, height: 600 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 1024, height: 768 },
  { width: 960, height: 540 }, // Reflow equivalent of Full HD at 200%.
  { width: 390, height: 844 },
  { width: 320, height: 640 },
];
const targetUrl = process.argv[2] || "http://127.0.0.1:8096/#/live?focus=1";
const projectionTest = process.env.DESK_FOCUS_DASHBOARD_PROJECTION_TEST === "1";
if (projectionTest && !["localhost", "127.0.0.1"].includes(new URL(targetUrl).hostname)) {
  throw new Error("Read-model preview is a local test only, never a deployed-runtime certificate.");
}
const outputRoot = resolve(process.env.DESK_LAYOUT_OUTPUT || "output/playwright/live-focus-layout");
mkdirSync(outputRoot, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.DESK_PLAYWRIGHT_EXECUTABLE_PATH || undefined,
});
const results = [];
const networkErrors = [];
const pageErrors = [];
let interactions;
let publishedDashboard;
try {
  const context = await browser.newContext({ timezoneId: "Europe/Paris" });
  const page = await context.newPage();
  if (projectionTest) await installDashboardProjectionTest(page);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) networkErrors.push({ path: new URL(response.url()).pathname, status: response.status() });
    if (new URL(response.url()).pathname === "/front-api/v1/views/live-focus" && response.ok()) {
      response.json().then((body) => { publishedDashboard = body.data?.dashboard; }).catch(() => undefined);
    }
  });
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await loginIfNeeded(page);
  await page.locator(".live-focus__queue").waitFor({ state: "visible", timeout: 60_000 });
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    results.push(await page.evaluate(auditLiveFocusLayout, viewport));
    await page.screenshot({ path: resolve(outputRoot, `live-focus-${viewport.width}x${viewport.height}.png`) });
    console.log(`Checked ${viewport.width}x${viewport.height}`);
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  interactions = await checkJournalInteractions(page);
  interactions.dashboard = await checkDashboardInteractions(page);
  interactions.failures.push(...interactions.dashboard.failures);
  const accessibility = await new AxeBuilder({ page }).include(".live-focus").analyze();
  const serious = accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact));
  const report = { target: targetUrl, evidenceMode: projectionTest ? "LOCAL_NEW_PROJECTION_WITH_REAL_READONLY_BFF_DATA" : "UNMODIFIED_RUNTIME", generatedAt: new Date().toISOString(), results, interactions, pageErrors, networkErrors, publishedDashboard,
    accessibility: { violations: accessibility.violations.map(({ id, impact, nodes }) => ({ id, impact, count: nodes.length })), seriousCritical: serious.length } };
  writeFileSync(resolve(outputRoot, "live-focus-layout-audit.json"), JSON.stringify(report, null, 2));
  const failures = results.flatMap((result) => result.failures.map((failure) => `${result.viewport.width}x${result.viewport.height}: ${failure}`));
  failures.push(...interactions.failures, ...pageErrors);
  if (serious.length) failures.push(`Axe: ${serious.length} serious/critical`);
  if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
  else console.log(`Live Focus layout: ${results.length} viewports, interactions and Axe passed. Network errors observed: ${networkErrors.length}.`);
  await context.close();
} catch (error) {
  const fatalError = error instanceof Error ? error.message : String(error);
  writeFileSync(resolve(outputRoot, "live-focus-layout-audit.json"), JSON.stringify({ target: targetUrl, generatedAt: new Date().toISOString(), results, interactions, pageErrors, networkErrors, fatalError }, null, 2));
  console.error(fatalError);
  process.exitCode = 1;
} finally {
  await browser.close();
}

// Test harness only: apply the new reporting projection to real read-only BFF
// records while the deployed API still lacks dashboard/closedAt. No invented
// trade, result or command; no application runtime fallback is installed.
async function installDashboardProjectionTest(page) {
  const { buildLiveFocusDashboard } = await import("../../../mcp_gpt_desk/src/front-live-focus-dashboard.js");
  await page.route("**/front-api/v1/views/live-focus**", async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const envelope = await response.json();
    const endpoint = new URL(route.request().url());
    endpoint.pathname = "/front-api/v1/views/live-trading";
    const live = await page.request.get(endpoint.toString());
    if (!live.ok()) throw new Error("Canonical theoretical rows unavailable for local projection test.");
    const rows = (await live.json()).data.theoreticalExecution.rows;
    const cards = envelope.data.tradeCards.map((card) => {
      const theoretical = rows.find((row) => row.portfolioOrderIntentId === card.orderIntentId);
      return { ...card, closedAt: theoretical?.exitAt || null, theoreticalTradeStatus: theoretical?.tradeStatus || null };
    });
    envelope.data.dashboard = buildLiveFocusDashboard({ tradeCards: cards, observedOpportunities: envelope.data.observedOpportunities,
      nowIso: new Date().toISOString() });
    await route.fulfill({ response, json: envelope });
  });
}

async function loginIfNeeded(page) {
  const login = page.getByLabel(/identifiant/i);
  await Promise.race([
    login.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
    page.locator(".live-focus").waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
  ]);
  if (await page.locator(".live-focus").isVisible()) return;
  if (!(await login.isVisible())) throw new Error("Neither login nor Live Focus available.");
  await login.fill(process.env.DESK_OPERATOR_LOGIN || "MSO");
  await page.getByLabel(/mot de passe/i).fill(process.env.DESK_OPERATOR_PASSWORD || "2018");
  await page.getByRole("button", { name: /entrer dans le desk/i }).click();
}

async function checkJournalInteractions(page) {
  const failures = [];
  const cards = page.locator(".live-focus__queue-card");
  const count = await cards.count();
  const track = page.locator(".live-focus__queue-track");
  const initialHeight = await track.evaluate((element) => element.clientHeight);
  await page.locator(".live-focus__queue-summary > summary").click();
  if (await track.evaluate((element) => element.clientHeight) < initialHeight - 2) failures.push("Résumé du journal: la liste est comprimée.");
  await page.locator(".live-focus__queue-summary > summary").click();
  await page.getByLabel("Rechercher dans le journal").fill("no-match-layout-audit");
  if (await cards.count()) failures.push("La recherche ne filtre pas les tickets.");
  await page.getByLabel("Rechercher dans le journal").fill("");
  if (await cards.count() !== count) failures.push("La recherche ne restaure pas la liste.");
  await page.getByLabel("Filtrer par état", { exact: true }).selectOption("ACTIONABLE");
  if (await page.locator('.live-focus__queue-card[data-actionable="false"]').count()) failures.push("Filtre À décider: ticket non actionnable visible.");
  await page.getByLabel("Filtrer par état", { exact: true }).selectOption("ALL");
  if (count) {
    await cards.first().getByText("Parcours et sources", { exact: true }).click();
    if (!(await cards.first().getByLabel("Progression du ticket").isVisible())) failures.push("Parcours non accessible.");
    await cards.first().getByText("Parcours et sources", { exact: true }).click();
    await cards.last().locator("footer").scrollIntoViewIfNeeded();
    const reachable = await cards.last().evaluate((card) => {
      const track = card.closest(".live-focus__queue-track").getBoundingClientRect();
      const footer = card.querySelector("footer").getBoundingClientRect();
      return footer.bottom <= track.bottom + 2 && footer.top >= track.top;
    });
    if (!reachable) failures.push("Dernier ticket: actions inaccessibles.");
    await page.screenshot({ path: resolve(outputRoot, "live-focus-last-ticket.png") });
  }
  await page.locator(".live-focus__queue-track").evaluate((element) => { element.scrollTop = 0; });
  await page.locator(".live-focus__brief").focus();
  await page.keyboard.press("End");
  const briefReachable = await page.locator(".live-focus__brief").evaluate((element) => element.scrollHeight <= element.clientHeight + 2 || element.scrollTop > 0);
  if (!briefReachable) failures.push("Le brief ne défile pas au clavier.");
  await page.locator(".live-focus__brief").evaluate((element) => { element.scrollTop = 0; });
  await page.getByRole("button", { name: /Raccourcis/ }).focus();
  await page.locator(".live-focus__decision").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.screenshot({ path: resolve(outputRoot, "live-focus-market-scroll.png") });
  await page.locator(".live-focus__decision").evaluate((element) => { element.scrollTop = 0; });
  return { publishedTickets: count, filters: true, details: count > 0, failures };
}

async function checkDashboardInteractions(page) {
  const failures = [];
  const periodChecks = [];
  const detail = page.locator(".live-focus__dashboard-details");
  if (!(await detail.count())) return { availability: "BACKEND_DASHBOARD_NOT_PUBLISHED", failures };
  const body = page.locator(".live-focus__body");
  const initial = await body.evaluate((element) => element.clientHeight);
  for (const [key, label] of [["WEEK", "Semaine"], ["MONTH", "Mois"], ["TODAY", "Aujourd’hui"], ["TOTAL", "Total"]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
    if (await body.evaluate((element) => element.clientHeight) < initial - 2) failures.push(`Période ${label}: panneaux comprimés.`);
    const value = await page.locator('[data-metric="realized-r"] dd > span').innerText();
    const r = publishedDashboard?.periods[key].results.realizedR;
    const result = publishedDashboard?.periods[key].results;
    const emptyLabel = result?.count === 0 && result?.missingR === 0 ? "Aucune clôture" : "Non publié";
    const expected = r === null ? emptyLabel : `${r > 0 ? "+" : ""}${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(r)} R`;
    if (publishedDashboard && value !== expected) failures.push(`Période ${label}: R affiché différent du BFF.`);
    periodChecks.push({ key, value, expected: publishedDashboard ? expected : null });
  }
  await detail.locator("summary").click();
  await page.screenshot({ path: resolve(outputRoot, "live-focus-dashboard-expanded.png"), fullPage: true });
  if (await body.evaluate((element) => element.clientHeight) < initial - 2) failures.push("Dashboard déplié: panneaux comprimés.");
  await page.locator(".live-focus__footer").scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => ({ top: window.scrollY, height: document.documentElement.scrollHeight, viewport: innerHeight }));
  if (scroll.height > scroll.viewport + 2 && scroll.top <= 0) failures.push("Défilement général inaccessible après expansion.");
  await page.screenshot({ path: resolve(outputRoot, "live-focus-dashboard-expanded-bottom.png") });
  await detail.locator("summary").click();
  await page.getByRole("button", { name: "Aujourd’hui", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  return { availability: "PUBLISHED", periodChecks, generalScroll: scroll, paneHeight: initial, failures };
}

function auditLiveFocusLayout(viewport) {
  const failures = [];
  const root = document.querySelector(".live-focus");
  const desktop = viewport.width >= 1100;
  const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
  const brief = rect(".live-focus__brief");
  const decision = rect(".live-focus__decision");
  const journal = rect(".live-focus__queue");
  if (!root || !brief || !decision || !journal) return { viewport, failures: ["Panneau principal absent"] };
  if (document.documentElement.scrollWidth > viewport.width + 2) failures.push("Débordement horizontal global.");
  for (const [name, pane] of Object.entries({ brief, decision, journal })) {
    if (pane.left < 0 || pane.right > viewport.width + 2) failures.push(`Panneau rogné horizontalement: ${name}`);
    if (!desktop && pane.width < viewport.width * .85) failures.push(`Largeur disponible inutilisée: ${name}`);
  }
  if (desktop) {
    if (brief.right > decision.left || decision.right > journal.left) failures.push("Colonnes superposées ou journal non placé à droite.");
    if (Math.abs(journal.top - decision.top) > 2) failures.push("Journal repoussé sous le panneau central.");
    const track = rect(".live-focus__queue-track");
    if (track.height < 200) failures.push("Zone tickets comprimée.");
    if (rect(".live-focus__body").height < 550) failures.push("Panneaux opérateur comprimés sous le dashboard.");
    if (!/auto|scroll/.test(getComputedStyle(document.documentElement).overflowY)) failures.push("Défilement général bloqué.");
    const dashboard = rect(".live-focus__dashboard");
    if (dashboard.height > 245) failures.push("Dashboard replié trop volumineux.");
  }
  const scrollEvidence = [];
  document.querySelectorAll("[data-focus-scroll]").forEach((element) => {
    const initial = element.scrollTop;
    const overflow = element.scrollHeight - element.clientHeight;
    if (overflow > 2 && /auto|scroll/.test(getComputedStyle(element).overflowY)) {
      element.scrollTop = element.scrollHeight;
      if (element.scrollTop < overflow - 2) failures.push(`Défilement impossible: ${element.className}`);
      scrollEvidence.push({ region: element.className, reachedEnd: element.scrollTop >= overflow - 2 });
      element.scrollTop = initial;
    }
  });
  document.querySelectorAll(".live-focus__ticket strong, .live-focus__queue-card-meta dd").forEach((element) => {
    if (element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2) failures.push(`Valeur tronquée: ${element.textContent}`);
  });
  const ownText = (element) => [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
  const fontSizes = [...root.querySelectorAll("*")].filter((element) => ownText(element) && element.getClientRects().length)
    .map((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  if (Math.min(...fontSizes) < 12) failures.push("Texte fonctionnel sous 12px.");
  const bodyFont = Number.parseFloat(getComputedStyle(root).fontSize);
  return { viewport, desktop, failures, bodyFont, minFont: Math.min(...fontSizes), scrollEvidence,
    panes: { brief: brief.toJSON(), decision: decision.toJSON(), journal: journal.toJSON() } };
}
