import { expect, test, type Page } from "@playwright/test";
import { canonicalViewDataset } from "../apps/desk-control-plane/src/mocks/canonicalDataset";

test.beforeEach(async ({ page }) => {
  await installCanonicalFrontApi(page);
});

test("session activity routes a signal to decision, chart and canonical dossier", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("net::ERR_FAILED")) consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/#/live", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("live-trading-golden-master")).toBeVisible();
  await page.getByRole("tab", { name: /Signaux/ }).click();
  await page.getByRole("button", { name: "Plein écran" }).click();
  const fullscreen = page.locator(".lt-activity-dock--fullscreen");
  await expect(fullscreen).toBeVisible();

  const row = fullscreen.locator(".lt-signal-inbox tbody tr").first();
  const signalId = canonicalViewDataset["live-signal-detail"].data.identity.signalId;
  await row.getByRole("button", { name: "Graphique" }).click();
  await expect(fullscreen).toBeHidden();
  await expect(page).toHaveURL(/chartAt=/);
  await expect(page.locator(".lt-chart-signal-context")).toContainText(signalId);
  await expect(page.locator(".lt-cockpit__canvas")).toBeFocused();

  await page.getByRole("button", { name: "Plein écran" }).click();
  await fullscreen.getByRole("button", { name: "Décision" }).first().click();
  await expect(fullscreen).toBeHidden();
  await expect(page.locator(".lt-cockpit__decision")).toBeFocused();
  await expect(page.locator(".lt-decision-stack__dossier")).toContainText(signalId.slice(0, 12));

  await page.getByRole("button", { name: "Plein écran" }).click();
  await fullscreen.getByRole("link", { name: "Dossier complet" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/live/signals/${signalId}`));
  await expect(page.getByRole("heading", { name: /Dossier signal/ })).toBeVisible();
  await expect(page.locator(".signal-hero")).toContainText("Fenêtre terminée");
  await expect(page.locator(".signal-hero")).toContainText("État backend brut");
  await expect(page.locator(".signal-lifecycle li")).toHaveCount(6);
  await expect(page.getByText("Aucune position liée")).toHaveCount(0);
  await page.screenshot({ path: "output/playwright/live-signal-experience/signal-dossier.png", fullPage: true });

  expect(consoleErrors).toEqual([]);
});

async function installCanonicalFrontApi(page: Page) {
  await page.route("**/front-api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/events")) return route.abort();
    if (url.pathname.endsWith("/capabilities")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { capabilities: [] } }) });
    }
    const match = url.pathname.match(/\/views\/([^/]+)$/);
    if (!match) return route.fulfill({ status: 404, body: "{}" });
    const view = canonicalViewDataset[match[1] as keyof typeof canonicalViewDataset];
    if (!view) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "VIEW_NOT_FOUND" }) });
    const body: any = structuredClone(view);
    if (match[1] === "auth-session") {
      body.data.permissions = [...body.data.permissions, { capability: "front.read", label: "Front read", domain: "COMMAND", decision: "ALLOW", reason: "Fixture de parcours", requiresStepUp: false }];
    }
    if (match[1] === "live-signal-detail") {
      body.meta.asOf = "2026-08-10T10:15:00.000Z";
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}
