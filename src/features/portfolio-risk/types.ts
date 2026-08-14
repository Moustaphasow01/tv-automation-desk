export type PortfolioRiskSeverity = "critical" | "warning" | "info" | "positive";

export interface PortfolioRiskOverview {
  contract: "DeskPortfolioRiskOverview";
  schemaVersion: "portfolio_risk_front_v1";
  generatedAt: string;
  source: PortfolioRiskSourceState;
  summary: PortfolioRiskSummary;
  accounts: PortfolioRiskAccount[];
  exposures: PortfolioRiskExposure[];
  controls: PortfolioRiskControl[];
  strategy_concentration: PortfolioRiskStrategyConcentration[];
  order_intents: PortfolioRiskOrderIntent[];
  reconciliation: PortfolioRiskReconciliation[];
  actions: PortfolioRiskAction[];
}

export interface PortfolioRiskSourceState {
  status: "ready" | "partial" | "unavailable";
  reads: Array<{ source: string; status: "ok" | "error"; count: number; error_code: string | null; error_message: string | null }>;
}

export interface PortfolioRiskSummary {
  status: "CONTROLLED" | "ACTION_REQUIRED" | "BROKER_SUBMIT_BLOCKED" | "DATA_UNAVAILABLE";
  portfolio_table_status: "execution_projection";
  submission_possible: boolean;
  live_account_allowed: boolean;
  risk_percent: number | null;
  max_contracts: number | null;
  accounts: number;
  openTrades: number;
  pendingIntents: number;
  activeOrders: number;
  activeLocks: number;
  reconciliationDivergences: number;
  liveInstances: number;
  paperInstances: number;
}

export interface PortfolioRiskAccount {
  account_id: string;
  label: string;
  mode: string;
  read_only: boolean;
  submission_enabled: boolean;
  max_contracts: number | null;
  risk_percent: number | null;
  capital: number | null;
  capital_source: "broker_snapshot" | "fallback_policy" | "missing";
  captured_at: string | null;
  status: string;
  controls: string[];
}

export interface PortfolioRiskExposure {
  exposure_id: string;
  account_id: string;
  instrument_code: string;
  broker_symbol: string | null;
  net_open_quantity: number;
  pending_buy_quantity: number;
  pending_sell_quantity: number;
  active_order_quantity: number;
  status: string;
  detail: string;
}

export interface PortfolioRiskControl {
  control_id: string;
  severity: PortfolioRiskSeverity;
  code: string;
  label: string;
  detail: string;
}

export interface PortfolioRiskStrategyConcentration {
  key: string;
  instrument_code: string;
  execution_mode: string;
  instance_count: number;
  runtime_states: string[];
  status: string;
  detail: string;
}

export interface PortfolioRiskOrderIntent {
  order_intent_id: string;
  status: string;
  approval_status: string;
  instrument_code: string | null;
  account_id: string | null;
  side: string;
  quantity: number | null;
  expires_at: string | null;
}

export interface PortfolioRiskReconciliation {
  reconciliation_run_id: string;
  account_id: string | null;
  status: string;
  mismatch_count: number;
  completed_at: string | null;
}

export interface PortfolioRiskAction {
  action_id: string;
  label: string;
  enabled: boolean;
  status: string;
  href: string | null;
  reason: string;
}
