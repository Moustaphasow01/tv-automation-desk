import { expect, test } from "@playwright/test";

test("cockpit, replay multi-session, timeline GPT et gouvernance utilisent la pile réelle", async ({ page }) => {
  await page.goto("/#/operations", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Cockpit des opérations" })).toBeVisible();
  await expect(page.getByText("Replay · asia_open", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Attente GPT", { exact: true }).first()).toBeVisible();

  await page.goto("/#/replay", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Replay Lab" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "2026-07-16" })).toBeVisible();
  await expect(page.getByText("3 sessions", { exact: true })).toBeVisible();

  await page.goto("/#/replay/runs/acceptance_replay_a1/days/2026-07-16", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Sessions, variantes et tentatives" })).toBeVisible();
  await expect(page.getByText("#2", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "ny_open_1530:30m" })).toBeVisible();

  await page.goto("/#/replay/runs/acceptance_replay_a1/days/2026-07-16/sessions/acceptance_replay_a1", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Prix & décisions" })).toBeVisible();
  await expect(page.getByLabel("Évolution du prix et décisions du replay")).toBeVisible();
  await expect(page.getByText("Processus GPT de la session", { exact: true })).toBeVisible();

  await page.goto("/#/replay/runs/acceptance_replay_a1/gpt/acceptance_work_gpt", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "REPLAY_MONITOR" })).toBeVisible();
  await expect(page.getByText("La thèse haussière reste valide au-dessus du support.", { exact: true })).toBeVisible();
  await expect(page.getByText("acceptance_bundle", { exact: true })).toBeVisible();

  await page.goto("/#/operations/incidents", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Lease GPT proche de l’expiration", { exact: true })).toBeVisible();

  await page.goto("/#/performance/analysis", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Analyse de performance" })).toBeVisible();
  await expect(page.getByText("1.25 R", { exact: true }).first()).toBeVisible();

  await page.goto("/#/strategies", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("acceptance_strategy", { exact: true })).toBeVisible();
});

test.describe("responsive réel", () => {
  test.use({ viewport: { width: 320, height: 720 } });
  test("le cockpit et Replay Lab restent contenus à 320 px", async ({ page }) => {
    for (const path of ["/#/operations", "/#/replay", "/#/replay/runs/acceptance_replay_a1/days/2026-07-16"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".workspace-view")).toBeVisible();
      const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    }
  });
});
