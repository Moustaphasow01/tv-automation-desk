import { expect, test } from "@playwright/test";
import { installDeskApiMock } from "./mockDeskApi";

test.beforeEach(async ({ page }) => {
  await installDeskApiMock(page);
});

test("parcours V5 Master → Monitor → Setup → Position → clôture", async ({ page }) => {
  await page.goto("/#/master", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Master Analysis" })).toBeVisible();
  await page.getByText("Références techniques").click();
  await expect(page.getByText("master_ny_2026_07_13_1530")).toBeVisible();

  await page.goto("/#/monitors", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/#\/live\/monitors$/);
  await expect(page.getByRole("heading", { name: "Monitors" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "EXPIRE_SETUP" })).toBeVisible();

  await page.goto("/#/setup", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Plan & exécution" })).toBeVisible();
  await expect(page.getByRole("main").getByText("Expiré · Résultat strict +0,89R", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trade historique clôturé" })).toBeVisible();

  await page.goto("/#/timeline", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Journal de décision" })).toBeVisible();
  for (const event of ["Master NY Open", "Setup déclenché", "Marque conservatrice", "Fenêtre expirée", "Monitor final"]) {
    await expect(page.getByText(event, { exact: true })).toBeVisible();
  }
});

test("la commande opérateur exige la confirmation et renvoie l’audit", async ({ page }) => {
  await page.goto("/#/setup", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Demander un replan/ }).click();

  const confirm = page.getByRole("button", { name: "Confirmer l’écriture" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Justification opérateur").fill("La thèse est expirée et exige un contexte canonique neuf.");
  await page.getByLabel("Recopiez REQUEST_REPLAN").fill("REQUEST_REPLAN");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByText(/Demander un replan enregistrée · révision 1 · audit mock-audit-1/)).toBeVisible();
  await expect(page.getByText("désactivé", { exact: true })).toBeVisible();
});

test.describe("mobile 320 px", () => {
  test.use({ viewport: { width: 320, height: 720 } });

  test("le cockpit et les alertes qualité restent utilisables sans débordement global", async ({ page }) => {
    await page.goto("/#/live", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeVisible();
    await expect(page.getByLabel(/Session automatique :/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Setup expiré après déclenchement strict", exact: true })).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

    const mobileLayout = await page.evaluate(() => {
      const main = document.querySelector(".app-main")?.getBoundingClientRect();
      const navigation = document.querySelector(".bottom-nav")?.getBoundingClientRect();
      return { mainBottom: main?.bottom ?? 0, navigationTop: navigation?.top ?? 0 };
    });
    expect(mobileLayout.mainBottom).toBeLessThanOrEqual(mobileLayout.navigationTop);

    await page.goto("/#/audit", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Audit" })).toBeVisible();
    await expect(page.getByText("News digest", { exact: true })).toBeVisible();
    await expect(page.getByText("warning", { exact: true })).toBeVisible();
  });
});

test("le shell V5 reste contenu aux quatre largeurs de référence", async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 720 },
    { width: 768, height: 900 },
    { width: 1280, height: 900 },
    { width: 1600, height: 1000 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/#/live", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Setup expiré après déclenchement strict", exact: true })).toBeVisible();
    const layout = await page.evaluate(() => {
      const main = document.querySelector(".app-main")?.getBoundingClientRect();
      const bottom = document.querySelector(".bottom-nav")?.getBoundingClientRect();
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        main: main && { left: main.left, right: main.right, bottom: main.bottom, width: main.width },
        bottom: bottom && { top: bottom.top, bottom: bottom.bottom, width: bottom.width }
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.main?.right).toBeLessThanOrEqual(viewport.width);
    if (viewport.width < 1024) {
      expect(layout.bottom?.width).toBe(viewport.width);
      expect(layout.bottom?.bottom).toBe(viewport.height);
      expect(layout.main?.bottom).toBeLessThanOrEqual(layout.bottom?.top || 0);
    } else {
      expect(layout.main?.left).toBe(248);
      expect(layout.main?.width).toBe(viewport.width - 248);
    }
  }
});

test("les 36 routes restent directement accessibles dans le shell V5", async ({ page }) => {
  const routes = [
    "/dashboard", "/live", "/sessions", "/master", "/monitors", "/thesis", "/setup", "/timeline", "/news", "/audit", "/alerts", "/performance",
    "/operations", "/operations/observability", "/operations/incidents", "/operations/incidents/incident-e2e",
    "/operations/notifications", "/operations/notifications/notification-e2e",
    "/operations/runbooks", "/operations/runbooks/runbook-e2e",
    "/operations/execution", "/operations/claim-lanes",
    "/operations/workflows/workflow-e2e", "/operations/workflows/workflow-e2e/events/event-e2e",
    "/replay", "/replay/compare", "/replay/runs/run-e2e", "/replay/runs/run-e2e/days/2026-07-13",
    "/replay/runs/run-e2e/days/2026-07-13/sessions/session-e2e", "/replay/runs/run-e2e/gpt/process-e2e",
    "/performance/analysis", "/history", "/history/sessions/session-e2e", "/strategies", "/strategies/strategy-e2e", "/more"
  ];
  expect(routes).toHaveLength(36);

  // /live, /thesis et /setup redirigent vers la page fusionnée /live/thesis ;
  // /sessions, /master, /monitors, /timeline et /news redirigent vers leur onglet /live/<tab> respectif ;
  // /replay/runs/:runId/days/:date/sessions/:id redirige vers la page journée fusionnée (chantier 3b —
  // la session redevient un état sélectionné dans la page, plus un segment d'URL).
  const redirectTargets: Record<string, string> = {
    "/live": "/live/thesis",
    "/thesis": "/live/thesis",
    "/setup": "/live/thesis",
    "/sessions": "/live/sessions",
    "/master": "/live/master",
    "/monitors": "/live/monitors",
    "/timeline": "/live/timeline",
    "/news": "/live/news",
    "/replay/runs/run-e2e/days/2026-07-13/sessions/session-e2e": "/replay/runs/run-e2e/days/2026-07-13"
  };

  for (const route of routes) {
    await page.goto(`/#${route}`, { waitUntil: "domcontentloaded" });
    const expectedPath = redirectTargets[route] ?? route;
    await expect(page).toHaveURL(new RegExp(`#${expectedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await expect(page.getByRole("main")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `débordement global sur ${route}`).toBeLessThanOrEqual(0);
  }
});
