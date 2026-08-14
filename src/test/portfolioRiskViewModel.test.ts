import { describe, expect, it } from "vitest";
import { buildPortfolioRiskViewModel, portfolioRiskSection } from "@/features/portfolio-risk/viewModel";
import type { PortfolioRiskOverview } from "@/features/portfolio-risk/types";

describe("Portfolio Risk view model", () => {
  it("projette la synthèse risque, les sections zoomables et les actions contrôlées", () => {
    const view = buildPortfolioRiskViewModel(overview());

    expect(view.health.label).toBe("Action requise");
    expect(view.metrics.find((metric) => metric.label === "Divergences")?.value).toBe(1);
    expect(view.sections.map((section) => section.href)).toContain("/operations/portfolio-risk/exposures");
    expect(portfolioRiskSection(view, "controls")?.title).toBe("Contrôles");
    expect(view.actions.find((action) => action.key === "portfolio_risk_write_gate")?.enabled).toBe(false);
    expect(view.exposures[0].net).toBe("+1");
    expect(view.accounts[0].capital).toBe("50 000 $US");
  });

  it("conserve les états vides réels sans fabriquer de lignes", () => {
    const empty = overview({
      summary: { ...overview().summary, status: "CONTROLLED", accounts: 0, openTrades: 0, pendingIntents: 0, activeOrders: 0, activeLocks: 0, reconciliationDivergences: 0 },
      accounts: [],
      exposures: [],
      controls: [],
      strategy_concentration: [],
      order_intents: [],
      reconciliation: [],
    });
    const view = buildPortfolioRiskViewModel(empty);

    expect(view.health.label).toBe("Contrôlé");
    expect(view.accounts).toEqual([]);
    expect(view.exposures).toEqual([]);
    expect(portfolioRiskSection(view, "unknown")).toBeNull();
  });
});

function overview(overrides: Partial<PortfolioRiskOverview> = {}): PortfolioRiskOverview {
  return {
    contract: "DeskPortfolioRiskOverview",
    schemaVersion: "portfolio_risk_front_v1",
    generatedAt: "2026-08-09T08:00:00.000Z",
    source: { status: "ready", reads: [{ source: "execution", status: "ok", count: 1, error_code: null, error_message: null }] },
    summary: {
      status: "ACTION_REQUIRED",
      portfolio_table_status: "execution_projection",
      submission_possible: true,
      live_account_allowed: false,
      risk_percent: 0.25,
      max_contracts: 5,
      accounts: 1,
      openTrades: 1,
      pendingIntents: 1,
      activeOrders: 1,
      activeLocks: 0,
      reconciliationDivergences: 1,
      liveInstances: 0,
      paperInstances: 2,
    },
    accounts: [{
      account_id: "sim101",
      label: "Sim101",
      mode: "paper",
      read_only: false,
      submission_enabled: true,
      max_contracts: 5,
      risk_percent: 0.25,
      capital: 50_000,
      capital_source: "broker_snapshot",
      captured_at: "2026-08-09T07:59:00.000Z",
      status: "CONTROLLED",
      controls: [],
    }],
    exposures: [{
      exposure_id: "sim101:MNQ",
      account_id: "sim101",
      instrument_code: "MNQ",
      broker_symbol: "MNQ 09-26",
      net_open_quantity: 1,
      pending_buy_quantity: 0,
      pending_sell_quantity: 1,
      active_order_quantity: 1,
      status: "ORDER_ACTIVE",
      detail: "net 1 · achat 0 · vente 1",
    }],
    controls: [{ control_id: "reco-1", severity: "critical", code: "BROKER_DIVERGENCE", label: "1 écart", detail: "Réconciliation requise." }],
    strategy_concentration: [{ key: "PAPER:MNQ", instrument_code: "MNQ", execution_mode: "PAPER", instance_count: 2, runtime_states: ["RUNNING"], status: "REVIEW_SIMILARITY", detail: "2 instance(s)" }],
    order_intents: [{ order_intent_id: "intent-1", status: "queued", approval_status: "approved", instrument_code: "MNQ", account_id: "sim101", side: "sell", quantity: 1, expires_at: null }],
    reconciliation: [{ reconciliation_run_id: "reco-1", account_id: "sim101", status: "diverged", mismatch_count: 1, completed_at: "2026-08-09T08:00:00.000Z" }],
    actions: [
      { action_id: "open_execution_console", label: "Ouvrir", enabled: true, status: "recommended", href: "/operations/execution", reason: "Console exécution" },
      { action_id: "portfolio_risk_write_gate", label: "Modifier", enabled: false, status: "blocked_by_design", href: null, reason: "Lecture seule" },
    ],
    ...overrides,
  };
}
