import { expect, test } from "@playwright/test";

const operatorPin = process.env.DESK_OPERATOR_ADMIN_PIN || "";

test("navigation réelle et détails paramétrés sur les projections V2", async ({ page, request }) => {
  await page.goto("/#/command-center", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeVisible();
  await expect(page.getByTestId("command-center-golden-master")).toBeVisible();

  await page.getByRole("link", { name: "Live Trading", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Live Trading", exact: true })).toBeVisible();
  await expect(page.getByTestId("live-trading-golden-master")).toBeVisible();
  await expect(page.getByText(/AUTO EXECUTION (ON|OFF)/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Human Execution Gate" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();

  const live = await request.get("/front-api/v1/views/live-trading");
  expect(live.ok()).toBeTruthy();
  const liveEnvelope = await live.json();
  const signalId = liveEnvelope.data.signals[0]?.signalId;
  if (signalId) {
    await page.goto(`/#/live/signals/${encodeURIComponent(signalId)}`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(signalId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await expect(page.getByText(signalId, { exact: true }).first()).toBeVisible();
  } else {
    await page.goto("/#/live/signals", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Signaux live" })).toBeVisible();
  }

  const orders = await request.get("/front-api/v1/views/orders");
  expect(orders.ok()).toBeTruthy();
  const ordersEnvelope = await orders.json();
  const orderId = ordersEnvelope.data.activeOrders[0]?.orderId;
  if (orderId) {
    await page.goto(`/#/execution/orders/${encodeURIComponent(orderId)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(orderId, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /dossier d'exécution/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Human Execution Gate" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm OrderIntent" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Reject OrderIntent" })).toBeDisabled();
    await expect(page.locator(".order-dossier__terms input, .order-dossier__terms select, .order-dossier__terms textarea, .order-dossier__terms [contenteditable=true]")).toHaveCount(0);
    await expect(page.getByText(/Confirmation indisponible : le backend ne publie aucun allowedAction/).first()).toBeVisible();
  }

  const portfolio = await request.get("/front-api/v1/views/portfolio");
  expect(portfolio.ok()).toBeTruthy();
  const portfolioEnvelope = await portfolio.json();
  const positionId = portfolioEnvelope.data.brokerPositions[0]?.positionId;
  if (positionId) {
    await page.goto(`/#/execution/portfolio/positions/${encodeURIComponent(positionId)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(positionId, { exact: true }).first()).toBeVisible();
  }

  await page.goto("/#/replay", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Replay" })).toBeVisible();
  await expect(page.getByText("Capacité backend indisponible")).toHaveCount(0);

  const replays = await request.get("/front-api/v1/views/replay-runs");
  expect(replays.ok()).toBeTruthy();
  const replayEnvelope = await replays.json();
  const replayId = replayEnvelope.data.items[0]?.id;
  if (replayId) {
    await page.goto(`/#/replay/runs/${encodeURIComponent(replayId)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Détail Replay" })).toBeVisible();
    await expect(page.getByText(replayId, { exact: true }).first()).toBeVisible();
  }

  const datasets = await request.get("/front-api/v1/views/research-data-catalog");
  expect(datasets.ok()).toBeTruthy();
  const datasetEnvelope = await datasets.json();
  const datasetId = datasetEnvelope.data.datasets[0]?.datasetId;
  if (datasetId) {
    await page.goto(`/#/research/data/${encodeURIComponent(datasetId)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Détail dataset" })).toBeVisible();
    await expect(page.getByText(datasetId, { exact: true }).first()).toBeVisible();
  }

  const missingReplay = await request.get("/front-api/v1/views/replay-run-detail?runId=missing-e2e");
  expect(missingReplay.status()).toBe(404);
});

test("session opérateur → commande terminale → audit receipt", async ({ page }) => {
  test.skip(!operatorPin, "DESK_OPERATOR_ADMIN_PIN requis pour la preuve d’écriture opérateur.");
  await page.goto("/#/auth", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Auth & Session" })).toBeVisible();
  const login = page.getByRole("button", { name: /Login opérateur/ });
  if (await login.count()) {
    await page.getByLabel("PIN opérateur").fill(operatorPin);
    await login.click();
    await expect(page.locator(".auth-session-message--ok")).toContainText("Session opérateur active.");
  }
  const verify = page.getByRole("button", { name: "Vérifier le Control Plane" });
  await expect(verify).toBeEnabled();
  await verify.click();
  await expect(page.getByText("SUCCEEDED", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Audit Receipt/)).toBeVisible();
});

test.describe("reflow V2", () => {
  test.use({ viewport: { width: 320, height: 720 } });
  test("les domaines restent accessibles et aucun overflow global n'est imposé", async ({ page }) => {
    for (const route of ["command-center", "live", "research", "execution/portfolio", "governance/access"]) {
      await page.goto(`/#/${route}`, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Plus" }).click();
      await expect(page.getByRole("navigation", { name: "Toutes les rubriques" })).toBeVisible();
      const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
      await page.getByRole("button", { name: "Fermer" }).click();
    }
  });
});
