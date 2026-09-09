import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const target = process.argv[2] || "http://localhost:8097/#/live?focus=1&workspace=next";
const targetHost = new URL(target).hostname;
const approvedVps = process.env.DESK_WORKSPACE_VERIFY_DEPLOYMENT === "1" && targetHost === "vps-6d6969db.vps.ovh.net" && new URL(target).protocol === "https:";
if (!["localhost", "127.0.0.1"].includes(targetHost) && !approvedVps) throw new Error("Only the local preview or the explicitly selected deployed desk may be audited.");
const output = resolve(process.env.DESK_WORKSPACE_OUTPUT || "output/playwright/trading-workspace");
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.DESK_PLAYWRIGHT_EXECUTABLE_PATH || undefined });
const report = { target, generatedAt: new Date().toISOString(), viewports: [], checks: [], errors: [], networkErrors: [], blockedCommands: [], accessibility: [] };
let auditPage;
let offlineSimulation = false;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "Europe/Paris", reducedMotion: "reduce" });
  const page = await context.newPage();
  auditPage = page;
  await page.route("**/front-api/v1/commands**", async (route) => {
    if (route.request().method() !== "GET") { report.blockedCommands.push(route.request().method()); return route.abort(); }
    return route.continue();
  });
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (response.status() >= 400) report.networkErrors.push({ path, status: response.status(), at: new Date().toISOString(), offlineSimulation });
    if (path === "/front-api/v1/views/live-focus" && response.ok()) response.json().then((body) => {
      report.source = { meta: body.meta, asOf: body.data.asOf, session: body.data.session, ticketCount: body.data.tradeCards.length, firstCard: body.data.tradeCards[0] };
    }).catch(() => undefined);
  });
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await Promise.race([page.getByLabel(/identifiant/i).waitFor({ timeout: 60_000 }), page.getByTestId("trading-workspace").waitFor({ timeout: 60_000 })]).catch(() => undefined);
  if (await page.getByLabel(/identifiant/i).isVisible()) {
    if (!process.env.DESK_OPERATOR_PASSWORD) throw new Error("DESK_OPERATOR_PASSWORD is required for authenticated read-only audit.");
    await page.getByLabel(/identifiant/i).fill(process.env.DESK_OPERATOR_LOGIN || "MSO");
    await page.getByLabel(/mot de passe/i).fill(process.env.DESK_OPERATOR_PASSWORD);
    await page.getByRole("button", { name: /entrer dans le desk/i }).click();
  }
  await page.getByTestId("trading-workspace").waitFor({ timeout: 90_000 });
  await page.locator(".tw-chart__canvas").first().waitFor({ timeout: 60_000 });
  await page.screenshot({ path: resolve(output, "workspace-desktop-initial.png"), fullPage: true });
  report.initial = await page.locator(".trading-workspace").innerText();
  for (const [width, height] of [[1440, 900], [1280, 720], [1280, 600], [1920, 1080], [2560, 1440], [1024, 768], [960, 540], [768, 1024], [390, 844], [320, 640]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await expect.poll(() => page.getByTestId("trading-workspace").evaluate((element) => element.getBoundingClientRect().width), { timeout: 5_000 }).toBeGreaterThan(width - 60);
    const geometry = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
      chartTop: document.querySelector(".tw-chart__canvas")?.getBoundingClientRect().top,
      canvasWidth: document.querySelector(".tw-chart__canvas")?.getBoundingClientRect().width }));
    report.viewports.push({ width, height, ...geometry });
    if (geometry.scrollWidth > width + 1) report.errors.push(`Horizontal overflow at ${width}: ${geometry.scrollWidth}`);
    if (geometry.canvasWidth < 220) report.errors.push(`Unusable chart width at ${width}: ${geometry.canvasWidth}`);
    if (geometry.chartTop > height - 140) report.errors.push(`Fewer than 140px of initial chart visible at ${width}×${height}: top ${geometry.chartTop}`);
    await expect(page.locator(".tw-chart__quote").first()).toContainText("Clôture reçue");
    await expect(page.locator(".tw-chart__quote").first()).toContainText("Paris");
    await page.screenshot({ path: resolve(output, `workspace-${width}x${height}.png`) });
    console.log(`Workspace checked ${width}×${height}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await checkDesktop(page);
  await checkEvolutions(page);
  await checkMobile(page);
  await context.close();
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error));
  if (auditPage && !auditPage.isClosed()) {
    await auditPage.screenshot({ path: resolve(output, "audit-failure.png"), fullPage: true }).catch(() => undefined);
    writeFileSync(resolve(output, "audit-failure-dom.txt"), await auditPage.locator("body").ariaSnapshot().catch(() => "Snapshot unavailable"));
  }
} finally {
  writeFileSync(resolve(output, "workspace-audit.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
if (report.errors.length || report.blockedCommands.length) { console.error(report.errors.join("\n")); process.exitCode = 1; }
else console.log(`Workspace audit passed: ${report.viewports.length} viewports, ${report.checks.length} interactions, no trading commands sent.`);

async function checkDesktop(page) {
  await page.getByRole("button", { name: /^Historique/ }).click();
  const first = page.locator(".tw-ticket-row").first();
  await first.click();
  const selectedId = await first.getAttribute("data-ticket-id");
  await expect(page.locator(".tw-inspector")).toContainText("Dossier historique");
  const otherQuote = page.locator('.tw-quote[aria-pressed="false"]').first();
  const previousInstrument = await page.getByLabel("Actif du graphique 1", { exact: true }).inputValue();
  if (await otherQuote.count()) {
    await otherQuote.click();
    await expect(page.getByLabel("Actif du graphique 1", { exact: true })).not.toHaveValue(previousInstrument);
  }
  await expect(page.locator(`.tw-ticket-row[data-ticket-id="${selectedId}"]`)).toHaveAttribute("aria-pressed", "true");
  report.checks.push("Changing the chart instrument preserves the selected historical ticket.");
  const layout = page.locator('[aria-label="Nombre de graphiques"]');
  await layout.getByRole("button", { name: "4", exact: true }).click();
  await expect(page.locator(".tw-chart")).toHaveCount(4);
  await expect(page.locator(".tw-chart__canvas")).toHaveCount(4, { timeout: 60_000 });
  await page.screenshot({ path: resolve(output, "workspace-four-charts.png"), fullPage: true });
  await layout.getByRole("button", { name: "1", exact: true }).click();
  await expect(page.locator(".tw-chart")).toHaveCount(1);
  await layout.getByRole("button", { name: "2", exact: true }).click();
  await expect(page.locator(".tw-chart")).toHaveCount(2);
  report.checks.push("One, two and four independent chart layouts work without changing the decision ticket.");
  await page.getByRole("button", { name: "Zoomer", exact: true }).first().click();
  await page.getByRole("button", { name: "Déplacer vers le passé", exact: true }).first().click();
  await page.getByRole("button", { name: "Afficher toutes les bougies", exact: true }).first().click();
  report.checks.push("Chart zoom, historical navigation and reset remain available without leaving the session.");
  await page.getByRole("button", { name: "Contexte", exact: true }).click();
  await expect(page.getByLabel("Contexte du ticket", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Parcours", exact: true }).click();
  await expect(page.getByLabel("Parcours du ticket", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.screenshot({ path: resolve(output, "workspace-ticket-desktop.png"), fullPage: true });
  const search = page.getByRole("searchbox", { name: "Filtrer les tickets" });
  await search.fill("not-a-real-ticket-qa");
  await expect(page.locator(".tw-ticket-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Effacer le filtre" }).click();
  await expect(page.locator(".tw-ticket-row").first()).toBeVisible();
  report.checks.push("History, context, journey, search and reset work.");
  await page.getByRole("button", { name: "Figer la lecture", exact: true }).first().click();
  await expect(page.locator(".tw-health")).toContainText("Reprenez tous les graphiques");
  await page.getByRole("button", { name: /^Reprendre/ }).first().click();
  report.checks.push("Paused chart puts the entire decision surface in read-only mode.");
  await page.getByRole("button", { name: "Données", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("table")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Données", exact: true }).first()).toBeFocused();
  report.checks.push("Chart has accessible tabular data and native modal restores focus on Escape.");
  await axe(page, "desktop", ".trading-workspace");
  await page.getByRole("button", { name: "Bilan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bilan de séance" })).toBeVisible();
  await page.getByLabel("Période du bilan").selectOption("WEEK");
  await page.screenshot({ path: resolve(output, "workspace-review-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Marchés & tickets", exact: true }).click();
}

async function checkMobile(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.getByRole("dialog").isVisible()) await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Tickets", exact: true }).click();
  await page.getByRole("button", { name: /^Historique/ }).click();
  await page.locator(".tw-ticket-row").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: resolve(output, "workspace-ticket-mobile.png") });
  await axe(page, "mobile-ticket", ".tw-dialog");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: resolve(output, "workspace-tickets-mobile.png") });
  await page.getByRole("button", { name: "Marchés", exact: true }).click();
  await page.getByRole("button", { name: "Suivi", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Suivi des tickets et positions" })).toBeVisible();
  await page.getByRole("combobox", { name: "Afficher", exact: true }).selectOption("all");
  await expect(page.locator(".tw-followup").first()).toBeVisible();
  await page.screenshot({ path: resolve(output, "workspace-tracking-mobile.png"), fullPage: true });
  await axe(page, "mobile-tracking", ".trading-workspace");
  await page.getByRole("button", { name: "Marchés", exact: true }).click();
  await page.locator(".tw-options > summary").click();
  await page.getByRole("button", { name: "Lire la séance" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  report.checks.push("Mobile markets/tickets navigation, ticket sheet and session brief work.");
  await axe(page, "mobile", ".trading-workspace");
  offlineSimulation = true;
  await page.context().setOffline(true);
  await expect(page.locator(".tw-health")).toContainText(/Connexion|Actualisation/, { timeout: 30_000 });
  await page.screenshot({ path: resolve(output, "workspace-offline-mobile.png") });
  report.checks.push("Offline state is visible and blocks decisions.");
  await page.context().setOffline(false);
}

async function checkEvolutions(page) {
  const unit1 = page.getByLabel("Unité du graphique 1", { exact: true });
  const unit2 = page.getByLabel("Unité du graphique 2", { exact: true });
  const originalUnit = await unit1.inputValue();
  const alternative = await unit2.locator("option").evaluateAll((options, current) => options.find((option) => option.value !== current)?.value, originalUnit);
  if (!alternative) throw new Error("No second published timeframe for independent chart check.");
  await unit2.selectOption(alternative);
  await expect(unit1).toHaveValue(originalUnit);
  await page.getByRole("button", { name: "Curseurs liés", exact: true }).click();
  await expect(page.getByRole("button", { name: "Curseurs liés", exact: true })).toHaveAttribute("aria-pressed", "true");
  const chart = page.locator(".tw-chart__canvas").first();
  const bounds = await chart.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 80);
  await page.getByRole("button", { name: "Agrandir le graphique 2", exact: true }).click();
  await expect(page.locator(".tw-chart:visible")).toHaveCount(1);
  await page.getByRole("button", { name: "Réduire le graphique 2", exact: true }).click();
  await expect(page.locator(".tw-chart:visible")).toHaveCount(2);
  report.checks.push("Independent timeframes, optional linked cursors and single-pane enlargement work.");

  await page.locator(".tw-options > summary").click();
  await page.getByRole("button", { name: "Configurer mon poste", exact: true }).click();
  await page.getByLabel("Densité de lecture").selectOption("compact");
  await page.getByRole("slider").focus();
  await page.keyboard.press("End");
  await page.screenshot({ path: resolve(output, "workspace-settings.png"), fullPage: true });
  await axe(page, "settings", ".tw-dialog");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("trading-workspace")).toHaveAttribute("data-density", "compact");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("trading-workspace")).toHaveAttribute("data-density", "compact", { timeout: 90_000 });
  await expect(page.getByLabel("Unité du graphique 2", { exact: true })).toHaveValue(alternative);
  await expect.poll(() => page.getByTestId("trading-workspace").evaluate((element) => element.style.getPropertyValue("--tw-inspector-width"))).toBe("480px");
  report.checks.push("Density, inspector width and independent timeframes survive a reload; URL selection is preserved.");

  await page.getByRole("button", { name: "Mes listes", exact: true }).click();
  await page.getByLabel("Nom de la liste").fill("Liste de vérification locale");
  await page.getByRole("button", { name: "Créer ma liste", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Liste enregistrée");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox", { name: "Liste de marchés", exact: true }).locator("option:checked")).toHaveText("Liste de vérification locale");
  const favorite = page.locator('.tw-favorite[aria-pressed="false"]').first();
  if (await favorite.count()) await favorite.click();
  await page.getByRole("combobox", { name: "Liste de marchés", exact: true }).selectOption("favorites");
  await expect(page.locator(".tw-quote").first()).toBeVisible();
  await page.screenshot({ path: resolve(output, "workspace-favorites.png"), fullPage: true });
  await page.getByRole("combobox", { name: "Liste de marchés", exact: true }).selectOption("desk");
  report.checks.push("Named watchlists and favorites are saved locally without modifying the desk universe.");

  await page.getByRole("button", { name: "État des données", exact: false }).click();
  await expect(page.getByRole("dialog")).toContainText("Calendrier publié par le desk");
  await page.screenshot({ path: resolve(output, "workspace-sources.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Alertes/ }).click();
  await expect(page.getByRole("dialog")).toContainText("pas un acquittement métier");
  await page.screenshot({ path: resolve(output, "workspace-alerts.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Suivi", exact: true }).click();
  await page.getByRole("combobox", { name: "Afficher", exact: true }).selectOption("all");
  await expect(page.locator(".tw-execution-lanes").first()).toContainText("Preuve courtier");
  await page.screenshot({ path: resolve(output, "workspace-tracking-desktop.png"), fullPage: true });
  await axe(page, "tracking", ".trading-workspace");
  await page.getByRole("button", { name: "Bilan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Journal des décisions" })).toBeVisible();
  await page.getByRole("combobox", { name: "Parcours", exact: true }).selectOption("after");
  await expect(page.locator(".tw-journal-row").first()).toBeVisible();
  await page.screenshot({ path: resolve(output, "workspace-journal-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Marchés & tickets", exact: true }).click();
  await page.getByRole("button", { name: "Figer la lecture", exact: true }).first().click();
  await page.getByRole("button", { name: "Bilan", exact: true }).click();
  await expect(page.locator(".tw-health")).toContainText("Reprenez tous les graphiques");
  await page.getByRole("button", { name: "Marchés & tickets", exact: true }).click();
  await page.getByRole("button", { name: /^Reprendre/ }).first().click();
  report.checks.push("Sources, alerts, unified tracking and journal work; changing panels never silently resumes a frozen chart.");
}

async function axe(page, state, selector) {
  const result = await new AxeBuilder({ page }).include(selector).analyze();
  report.accessibility.push({ state, violations: result.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) })) });
  const serious = result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact));
  if (serious.length) report.errors.push(`${state}: ${serious.length} serious/critical accessibility rule(s).`);
}
