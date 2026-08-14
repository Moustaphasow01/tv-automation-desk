import { expect, test } from "@playwright/test";

const apiKey = process.env.DESK_MCP_API_KEY || "local-preprod-key";

test("cockpit, replay multi-session, timeline GPT et gouvernance utilisent la pile réelle", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/#/operations", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Cockpit des opérations" })).toBeVisible();
  await expect(page.getByText("Replay · asia_open", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Attente GPT", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Kanban" }).click();
  await expect(page.getByLabel("Board workflows automatisés")).toBeVisible();
  await page.getByRole("button", { name: "Chronologie" }).click();
  await expect(page.getByRole("heading", { name: "Dernières transitions automatisées" })).toBeVisible();

  await page.goto("/#/operations/execution", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "NinjaTrader · Execution Console" })).toBeVisible();
  await expect(page.getByText(/Démo PAPER (bloquée avant ordre|prête côté broker)/).first()).toBeVisible();
  await expect(page.getByText("Le chemin Sim101 est armable", { exact: true })).toHaveCount(0);

  await page.goto("/#/operations/workflows/replay%3Aacceptance_replay_ny?action=retry", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Actions disponibles" })).toBeVisible();
  await expect(page.locator(".workflow-action-card.is-selected")).toContainText("Retry contrôlé");
  await expect(page.getByRole("heading", { name: "Historique des actions" })).toBeVisible();

  await page.goto("/#/replay", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Replay Lab" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Journées de backtest" })).toBeVisible();
  const consolidatedDay = page.getByRole("row").filter({ hasText: "2026-07-16" }).first();
  await expect(consolidatedDay).toBeVisible();
  await expect(consolidatedDay).toContainText("3 exécutions");
  await expect(consolidatedDay).toContainText("1.25 R");

  await page.goto("/#/replay/runs/acceptance_replay_a1/days/2026-07-16", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Sessions et tentatives" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Variantes, tentatives et résultat" })).toBeVisible();
  await expect(page.getByRole("button", { name: /#2asia_open:15m/ })).toBeVisible();
  await expect(page.getByText("ny_open_1530:15m").first()).toBeVisible();
  await page.getByRole("button", { name: "Décisions" }).click();
  await expect(page.getByRole("heading", { name: "Décisions, étapes et GPT" })).toBeVisible();

  await page.goto("/#/replay/compare", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Comparer les exécutions" })).toBeVisible();
  await page.getByLabel("Sélectionner acceptance_replay_a1").check();
  await page.getByLabel("Sélectionner acceptance_replay_a2").check();
  await expect(page.getByRole("heading", { name: "Scoreboard comparatif" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Matrice comparative" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "acceptance_replay_a2" })).toContainText("1.25 R");

  await page.goto("/#/replay/runs/acceptance_replay_a1/days/2026-07-16", { waitUntil: "domcontentloaded" });
  const replayDayTabs = page.getByLabel("Détail de la journée");
  await replayDayTabs.getByRole("button", { name: "Prix" }).click();
  await expect(page.getByLabel("Évolution du prix et décisions du replay")).toBeVisible();
  await replayDayTabs.getByRole("button", { name: "GPT" }).click();
  await expect(page.getByText("Processus GPT de la session", { exact: true })).toBeVisible();

  await page.goto("/#/replay/runs/acceptance_replay_a1/gpt/acceptance_work_gpt", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Mise à jour du plan" })).toBeVisible();
  const m7Contract = page.locator("details").filter({ hasText: "Transmission technique GPT" });
  await m7Contract.locator("summary").click();
  await expect(m7Contract).toContainText("save_replay_monitor");
  await expect(m7Contract).toContainText("acceptance_work_gpt");
  await expect(m7Contract).toContainText("gpt-connector-acceptance");
  await expect(m7Contract).toContainText("Protégé côté serveur");
  await expect(m7Contract).toContainText("Complet");
  await expect(m7Contract).toContainText("Exposé");
  await expect(page.getByRole("heading", { name: "Command Center GPT" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Action corrective workflow" })).toBeVisible();
  await expect(page.locator(".gpt-corrective-action-panel").getByRole("link", { name: /Préparer pause/ })).toBeVisible();
  await expect(page.getByText("Workflow parent", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Incidents liés", { exact: true })).toBeVisible();
  await expect(page.getByText("Runbooks liés", { exact: true })).toBeVisible();
  await expect(page.getByText("Lease GPT proche de l’expiration", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("La thèse haussière reste valide au-dessus du support.", { exact: true })).toBeVisible();
  await expect(m7Contract).toContainText("Manifest");
  await expect(page.locator("details").filter({ hasText: "Manifest du bundle" })).toBeVisible();
  const saveTargetDetails = page.locator("details").filter({ hasText: "Save target" });
  await saveTargetDetails.locator("summary").click();
  await expect(saveTargetDetails).toContainText("acceptance_work_gpt");
  await expect(saveTargetDetails).not.toContainText("acceptance-lease");
  await page.locator("details").filter({ hasText: "Prompt d’exécution" }).locator("summary").click();
  await expect(page.getByText("Inspecter le bundle et sauvegarder la décision.")).toBeVisible();
  await expect(page.getByLabel("Navigation contextuelle")).toContainText("Analyse GPT");

  await page.goto("/#/operations/observability?process=acceptance_work_gpt", { waitUntil: "domcontentloaded" });
  const navTrail = page.getByLabel("Navigation contextuelle");
  await expect(navTrail).toContainText("Analyse GPT");
  await navTrail.getByRole("link", { name: /Retour.*Analyse GPT/ }).click();
  await expect(page).toHaveURL(/replay\/runs\/acceptance_replay_a1\/gpt\/acceptance_work_gpt/);
  await page.goto("/#/operations/observability?process=acceptance_work_gpt", { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Focus process observabilité")).toBeVisible();
  await expect(page.getByLabel("Focus process observabilité")).toContainText("acceptance_work_gpt");
  await expect(page.locator(".observability-process-table tr.is-selected")).toContainText("REPLAY_MONITOR");
  await page.getByRole("link", { name: "Runbooks liés" }).click();
  await expect(page).toHaveURL(/run_id=acceptance_replay_a1/);
  await expect(page.getByRole("heading", { name: "Runbooks opérateur" })).toBeVisible();
  await expect(page.getByText("Contexte URL", { exact: true })).toBeVisible();
  await expect(page.getByText("Runbook lease GPT").first()).toBeVisible();

  await page.goto("/#/operations/incidents?run_id=acceptance_replay_a1", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Centre incidents" })).toBeVisible();
  await expect(page.getByText("Lease GPT proche de l’expiration", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Ouvrir" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Lease GPT proche de l’expiration" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Runbooks liés" }).first()).toBeVisible();

  await page.goto("/#/operations/incidents", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "File priorisée incidents" })).toBeVisible();
  await expect(page.getByText("Lease GPT proche de l’expiration", { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  await page.request.post("/api/v1/notifications/sync", {
    headers: { "X-Desk-Api-Key": apiKey, Authorization: `Bearer ${apiKey}` },
    data: { autoClear: true, reason: "Sync e2e notifications" },
  });
  await page.goto("/#/operations/notifications", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Notifications & escalade" })).toBeVisible();
  const leaseNotification = page.getByRole("row").filter({ hasText: "Lease GPT proche de l’expiration" }).first();
  await expect(leaseNotification).toBeVisible();
  await leaseNotification.getByRole("link", { name: "Ouvrir" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Lease GPT proche de l’expiration" })).toBeVisible();

  await page.goto("/#/operations/runbooks", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Runbooks opérateur" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "File d’intervention opérateur" })).toBeVisible();
  await expect(page.getByText("Runbook lease GPT").first()).toBeVisible();
  await page.getByRole("link", { name: "Ouvrir" }).first().click();
  await expect(page.getByRole("heading", { name: "Plan d’intervention" })).toBeVisible();
});

test("performance, historique et gouvernance utilisent la pile réelle", async ({ page }) => {
  await page.goto(
    "/#/performance/analysis?strategy=acceptance_strategy&from=2026-07-14&to=2026-07-16",
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.getByRole("heading", { name: "Analyse de performance" })).toBeVisible();
  await expect(page.getByText("+1.25 R", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Focus journée performance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contribution session, stratégie, instrument" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Equity & drawdown" })).toBeVisible();
  await expect(page.getByLabel("Courbe d’equity et drawdown")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Journées matérialisées" })).toBeVisible();
  await page.goto(
    "/#/performance/analysis?strategy=acceptance_strategy&session=ny_open&from=2026-07-15&to=2026-07-15",
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.locator(".metric-card").filter({ hasText: "Résultat net" })).toContainText("-0.50 R");
  await expect(page).toHaveURL(/strategy=acceptance_strategy.*session=ny_open.*from=2026-07-15.*to=2026-07-15/);

  await page.goto("/#/history", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Historique des sessions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Matrice workflows automatisés" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audit trail global" })).toBeVisible();
  const asiaHistory = page.getByRole("row").filter({ hasText: "2026-07-16" }).filter({ hasText: "ASIA OPEN" });
  await expect(asiaHistory).toContainText("2");
  await expect(asiaHistory).toContainText("2 GPT");
  await expect(asiaHistory).toContainText(/[1-9]\d* incidents/);

  await page.goto("/#/history/sessions/2026-07-16%3Aasia_open", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "2026-07-16 · Session Asie" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Couverture workflow" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Flux décisionnel GPT" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audit trail session" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Workflows de la session" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Processus GPT" })).toBeVisible();
  await expect(page.getByText("Lease GPT proche de l’expiration", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timeline de la session" })).toBeVisible();
  await expect(page.locator(".history-timeline").getByText("MAINTAIN", { exact: true })).toBeVisible();

  await page.goto("/#/strategies", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Stratégies & instances" })).toBeVisible();
  await expect(page.getByText("acceptance_strategy").first()).toBeVisible();
  await page.goto("/#/strategies/acceptance_strategy", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Acceptance Momentum" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Performance historique" })).toHaveAttribute("href", "#/performance/analysis?strategy=acceptance_strategy");
  await expect(page.getByRole("heading", { name: "Cycle de publication" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Runtime SHADOW / PAPER / LIVE" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dernières transitions" })).toBeVisible();
  await expect(page.getByText("STRATEGY_VERSION_TRANSITIONED").first()).toBeVisible();
  await expect(page.getByText("2.0.0").first()).toBeVisible();
  await expect(page.getByText("Publiée").first()).toBeVisible();
});

test("l’observabilité consolide télémétrie, coûts mesurés et leases de la pile réelle", async ({ page }) => {
  await page.goto("/#/operations/observability", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Observabilité & coûts GPT" })).toBeVisible();
  const guardrails = page.getByLabel("Guardrails SLA et budgets GPT");
  await expect(guardrails.getByRole("heading", { name: "SLA & budgets mesurés" })).toBeVisible();
  await expect(guardrails.getByText("Lease GPT expirée", { exact: true })).toBeVisible();
  await expect(guardrails.getByText("Couverture de télémétrie insuffisante", { exact: true })).toBeVisible();
  await expect(guardrails.getByText("NON CONFIG.", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Configurer les guardrails" })).toBeVisible();
  await expect(page.getByText("$0.0425", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^\d+\/\d+ · \d+%$/).first()).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "REPLAY_MASTER" })).toContainText("gpt-5");
  await expect(page.getByRole("row").filter({ hasText: "REPLAY_MONITOR" })).toContainText("EXPIRED");
});

test.describe("responsive réel", () => {
  test.use({ viewport: { width: 320, height: 720 } });
  test("le cockpit et Replay Lab restent contenus à 320 px", async ({ page }) => {
    test.setTimeout(120_000);
    const responsivePaths = ["/#/operations", "/#/operations/execution", "/#/operations/observability", "/#/operations/notifications", "/#/operations/runbooks", "/#/replay", "/#/replay/runs/acceptance_replay_a1/days/2026-07-16", "/#/performance/analysis", "/#/history", "/#/history/sessions/2026-07-16%3Aasia_open", "/#/strategies/acceptance_strategy"];
    for (const path of responsivePaths) {
      await test.step(`viewport 320px: ${path}`, async () => {
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await expect(page.locator(".workspace-view")).toBeVisible({ timeout: 30_000 });
        const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
      });
    }
  });
});
