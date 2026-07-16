import { expect, test } from "@playwright/test";
import { installDeskApiMock } from "./mockDeskApi";

test.beforeEach(async ({ page }) => {
  await installDeskApiMock(page);
});

test("parcours Master → Monitor → Setup → Position → clôture", async ({ page }) => {
  await page.goto("/#/master", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Master Analysis" })).toBeVisible();
  await expect(page.getByText("master_ny_2026_07_13_1530")).toBeVisible();

  await page.goto("/#/monitors", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/#\/monitors$/);
  await expect(page.getByRole("heading", { name: "Monitors" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "EXPIRE_SETUP" })).toBeVisible();

  await page.goto("/#/setup", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Setup & Position" })).toBeVisible();
  await expect(page.getByRole("main").getByText("EXPIRED", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trade historique clôturé" })).toBeVisible();
  await expect(page.getByRole("main").getByText("CLOSED", { exact: true })).toBeVisible();

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
