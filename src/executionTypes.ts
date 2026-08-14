export interface ExecutionOverview {
  contract: "DeskExecutionOverview";
  schemaVersion: string;
  generatedAt: string;
  safety: {
    executionEnabled: boolean;
    bridgeMode: string;
    killSwitchEnv: boolean;
    maxContracts: number;
    riskPercent: number;
    maxRoundingExcessPercent: number;
    maxDecisionAgeSeconds: number;
    executionAuthorityMode: "semi_auto" | "auto";
    entryOperatorApprovalRequired: boolean;
    managementOperatorApprovalRequired: boolean;
    contractRoundingMode: "ceil";
    fallbackCapitalEnabled: boolean;
    fallbackCapital: number | null;
    sizingPolicyRevision: number;
    accountSnapshotMaxAgeSeconds: number;
    allowedInstruments: string[];
    liveAccountAllowed: boolean;
    databaseLocked: boolean;
    submissionPossible: boolean;
  };
  ninjaTraderStartup: {
    available: boolean;
    enabled: boolean;
    revision: number;
    connectionName: string;
    connectionProvider: string;
    autoConnectRequired: boolean;
    simulationOnly: boolean;
    supervisorInstalled: boolean;
    supervisorRunning: boolean;
    processRunning: boolean;
    processWindowTitle: string | null;
    loginRequired: boolean;
    platformReady: boolean;
    autoConnectConfigured: boolean;
    addonHeartbeatFresh: boolean;
    addonConnected: boolean;
    connectionReady: boolean;
    lastStartedAt: string | null;
    lastAppliedAt: string | null;
    lastError: string | null;
    state: "unavailable" | "error" | "disabled" | "running" | "login_required" | "waiting_addon" | "waiting_restart" | "waiting_supervisor";
  };
  summary: {
    pendingApproval: number;
    queued: number;
    activeOrders: number;
    openTrades: number;
    healthyBridges: number;
    activeLocks: number;
    pendingManagement: number;
    queuedManagement: number;
    addonSnapshots: number;
    addonEvents: number;
    addonParityDivergences: number;
  };
  providers: BrokerProvider[];
  accounts: BrokerAccount[];
  accountSnapshots: BrokerAccountSnapshot[];
  contracts: BrokerContract[];
  policies: TradePolicy[];
  policyAudits: BrokerPolicyAudit[];
  bridges: BrokerBridge[];
  locks: ExecutionLock[];
  decisions: TradeDecision[];
  intents: OrderIntent[];
  orders: BrokerOrder[];
  trades: BrokerTrade[];
  reconciliations: BrokerReconciliation[];
  managementIntents: BrokerManagementIntent[];
  managementApprovals: BrokerManagementApproval[];
  managementOutbox: BrokerManagementOutbox[];
  addonSnapshots: BrokerAddonSnapshot[];
  addonEvents: BrokerAddonEvent[];
  adapterParityRuns: BrokerAdapterParityRun[];
}

export interface BrokerProvider { broker_provider_code: string; display_name: string; enabled: boolean; }
export interface BrokerAccount { broker_account_id: string; account_label: string; environment: string; mode: string; read_only: boolean; order_submission_enabled: boolean; max_contracts: number | null; }
export interface BrokerAccountSnapshot { broker_account_snapshot_id: string; broker_account_id: string; cash_value: number | null; buying_power: number | null; realized_pnl: number | null; unrealized_pnl: number | null; captured_at: string; payload: Record<string, unknown>; }
export interface BrokerContract { broker_contract_id: string; instrument_code: string; broker_symbol: string; expiry_date: string | null; tick_size: number | null; point_value: number | null; active: boolean; }
export interface TradePolicy { policy_profile_id: string; display_name: string; enabled: boolean; max_contracts: number; max_daily_loss: number; min_reward_risk: number; require_operator_approval: boolean; execution_authority_mode: "semi_auto" | "auto"; risk_per_trade_pct: number; max_rounding_excess_pct: number; max_decision_age_seconds: number; fallback_capital_enabled: boolean; fallback_capital: number | null; revision: number; }
export interface BrokerPolicyAudit { broker_policy_audit_event_id: string; policy_profile_id: string; action: "configure_sizing" | "configure_execution_authority"; expected_revision: number; applied_revision: number; actor: string; reason: string; previous_values: Record<string, unknown>; next_values: Record<string, unknown>; created_at: string; }
export interface BrokerBridge { bridge_id: string; mode: string; status: string; account_name: string | null; ninja_connected: boolean; ati_enabled: boolean; last_seen_at: string; adapter_kind: "unknown" | "ati" | "addon"; protocol_version: string | null; capabilities: Record<string, unknown>; command_enabled: boolean; }
export interface ExecutionLock { execution_lock_id: string; scope_type: string; scope_value: string; locked: boolean; reason: string; set_by: string; set_at: string; }
export interface TradeDecision { trade_decision_id: string; source_document_id: string; status: string; instrument_code: string; side: string; strategy_id: string | null; trading_date: string | null; session: string | null; decided_at: string | null; entry_plan: Record<string, unknown>; risk_plan: Record<string, unknown>; thesis_ref: Record<string, unknown>; }
export interface ContractSizing { risk_percent: number; rounding_mode: "ceil"; capital: number; risk_budget: number; risk_points: number; point_value: number; risk_per_contract: number; raw_contracts: number; contracts: number; actual_risk: number; actual_risk_percent: number; rounding_excess: number; rounding_excess_percent: number; exceeds_risk_target: boolean; }
export interface OrderIntent { order_intent_id: string; trade_decision_id: string; status: string; approval_status: string; side: string; order_type: string; quantity: number; limit_price: number | null; expires_at: string | null; instrument_code?: string; broker_symbol?: string; strategy_id?: string; trading_date?: string; session?: string; raw?: { position_sizing?: ContractSizing }; }
export interface BrokerOrder { broker_order_id: string; broker_order_ref: string | null; status: string; side: string; order_type: string; quantity: number; limit_price: number | null; updated_at: string; }
export interface BrokerTrade {
  trade_id: string;
  status: string;
  side: string;
  quantity_open: number;
  avg_entry_price: number | null;
  realized_pnl: number | null;
  unrealized_pnl: number | null;
  updated_at: string;
  broker_account_id?: string;
  broker_contract_id?: string;
  raw?: Record<string, unknown>;
}
export interface BrokerReconciliation {
  reconciliation_run_id: string;
  status: string;
  mismatch_count: number;
  started_at: string;
  completed_at: string | null;
  mismatches?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}
export interface BrokerManagementIntent { management_intent_id: string; trade_id: string; source_document_id: string; source_action: string; action: "move_stop" | "reduce_position" | "close_position"; status: string; approval_status: string; expected_trade_revision: number; requested_quantity: number | null; requested_stop_price: number | null; reason: string; expires_at: string; instrument_code: string; broker_symbol: string; trade_side: string; quantity_open: number; trade_revision: number; guard_evidence?: { violations?: Array<{ code: string }> }; }
export interface BrokerManagementApproval { management_approval_id: string; management_intent_id: string; status: string; actor: string; reason: string; created_at: string; }
export interface BrokerManagementOutbox { management_outbox_id: string; management_intent_id: string; status: string; attempt_count: number; delivered_at: string | null; acknowledged_at: string | null; last_error: string | null; }
export interface BrokerAddonSnapshot { addon_snapshot_id: string; bridge_id: string; broker_account_id: string; account_name: string; captured_at: string; content_hash: string; connection: Record<string, unknown>; account: Record<string, unknown>; orders: Array<Record<string, unknown>>; positions: Array<Record<string, unknown>>; }
export interface BrokerAddonEvent { addon_event_id: string; bridge_id: string; event_type: "order" | "execution" | "position" | "account" | "connection" | "command"; intent_id: string | null; management_intent_id: string | null; command_id: string | null; occurred_at: string; payload: Record<string, unknown>; }
export interface BrokerAdapterParityRun { adapter_parity_run_id: string; broker_account_id: string; left_adapter: "ati" | "addon"; right_adapter: "ati" | "addon"; status: "matched" | "diverged" | "incomplete" | "failed"; mismatch_count: number; mismatches: Array<Record<string, unknown>>; compared_at: string; metadata: Record<string, unknown>; }

export type ExecutionAction =
  | { action: "materialize"; scope?: { run_id?: string; trading_date?: string; session?: string } }
  | { action: "materialize_management"; monitorId?: string; limit?: number; scope?: { strategy_id?: string; trading_date?: string; session?: string } }
  | { action: "evaluate"; decisionId: string; accountId?: string; policyProfileId?: string }
  | { action: "configure_sizing"; policyProfileId: string; expectedRevision: number; riskPercent: number; maxRoundingExcessPercent: number; maxDecisionAgeSeconds: number; fallbackCapitalEnabled: boolean; fallbackCapital: number; idempotencyKey: string; confirmationPhrase: "CONFIRM_SIM101_SIZING_POLICY"; reason: string }
  | { action: "configure_execution_mode"; policyProfileId: string; expectedRevision: number; mode: "semi_auto" | "auto"; idempotencyKey: string; confirmationPhrase: "CONFIRM_SIM101_EXECUTION_MODE"; reason: string }
  | { action: "configure_ninjatrader_startup"; enabled: boolean; expectedRevision: number; idempotencyKey: string; confirmationPhrase: "CONFIRM_NINJATRADER_AUTOSTART"; reason: string }
  | { action: "approve"; intentId: string; idempotencyKey: string; confirmationPhrase: "CONFIRM_SIM101_ORDER"; reason: string }
  | { action: "reject"; intentId: string; idempotencyKey: string; confirmationPhrase: "CONFIRM_REJECT"; reason: string }
  | { action: "approve_management"; managementIntentId: string; idempotencyKey: string; confirmationPhrase: "CONFIRM_SIM101_MANAGEMENT"; reason: string }
  | { action: "reject_management"; managementIntentId: string; idempotencyKey: string; confirmationPhrase: "CONFIRM_REJECT"; reason: string }
  | { action: "kill_switch"; locked: boolean; confirmationPhrase: "ENGAGE_KILL_SWITCH" | "RELEASE_SIM101_KILL_SWITCH"; reason: string };
