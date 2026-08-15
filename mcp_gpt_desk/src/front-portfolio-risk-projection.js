import { SystemClock } from "@tv-automation/desk-time";

export const PORTFOLIO_RISK_FRONT_CONTRACT = "DeskPortfolioRiskOverview";
export const PORTFOLIO_RISK_FRONT_SCHEMA_VERSION = "portfolio_risk_front_v1";
const PORTFOLIO_RISK_FRONT_CLOCK = new SystemClock();

const ACTIVE_INTENT_STATUSES = new Set(["draft", "pending_approval", "approved", "queued", "leased", "rendered", "delivered"]);
const ACTIVE_ORDER_STATUSES = new Set(["created", "submitted", "accepted", "working", "partially_filled"]);
const OPEN_TRADE_STATUSES = new Set(["planned", "open", "protected", "scaling", "armed"]);

export async function buildPortfolioRiskOverviewFromStore(store, args = {}) {
  const [execution, strategy, performance] = await Promise.allSettled([
    store.getExecutionOverview(args),
    store.getStrategyV2Overview(args),
    store.getOperationsPerformance(args),
  ]);
  return buildPortfolioRiskOverview({
    generatedAt: store.clock?.now?.().utc,
    execution: settledValue(execution),
    strategy: settledValue(strategy),
    performance: settledValue(performance),
    errors: settledErrors({ execution, strategy, performance }),
  });
}

export function buildPortfolioRiskOverview({ generatedAt, execution, strategy, performance, errors = [] } = {}) {
  const summary = buildSummary({ execution, strategy, performance, errors });
  const controls = buildControls({ execution, strategy, errors });
  return {
    contract: PORTFOLIO_RISK_FRONT_CONTRACT,
    schemaVersion: PORTFOLIO_RISK_FRONT_SCHEMA_VERSION,
    generatedAt: generatedAt || PORTFOLIO_RISK_FRONT_CLOCK.now().utc,
    source: sourceState({ execution, strategy, performance, errors }),
    summary,
    accounts: accountRows(execution),
    exposures: exposureRows(execution),
    controls,
    portfolio_state: portfolioState({ execution, generatedAt }),
    risk_center: riskCenterState({ execution, generatedAt, controls }),
    strategy_concentration: strategyConcentrationRows(strategy),
    order_intents: orderIntentRows(execution),
    portfolio_order_intents: portfolioOrderIntentRows(execution),
    reconciliation: reconciliationRows(execution),
    actions: controlledActions(controls),
  };
}

function buildSummary({ execution, strategy, errors }) {
  const safety = execution?.safety || {};
  const counts = {
    accounts: safeArray(execution?.accounts).length,
    openTrades: safeArray(execution?.trades).filter(isOpenTrade).length,
    pendingIntents: safeArray(execution?.intents).filter(isActiveIntent).length + safeArray(execution?.portfolioOrderIntents).filter(isActivePortfolioIntent).length,
    activeOrders: safeArray(execution?.orders).filter(isActiveOrder).length,
    activeLocks: safeArray(execution?.locks).length,
    reconciliationDivergences: safeArray(execution?.adapterParityRuns).filter((item) => item.status === "diverged").length
      + safeArray(execution?.reconciliations).filter((item) => item.status === "diverged").length,
    liveInstances: safeArray(strategy?.instances).filter((item) => item.execution_mode === "LIVE").length,
    paperInstances: safeArray(strategy?.instances).filter((item) => item.execution_mode === "PAPER").length,
    pendingTargetPositions: unique(safeArray(execution?.portfolioOrderIntents).map((item) => item.target_position_id).filter(Boolean)).length,
    pendingHumanGates: safeArray(execution?.humanExecutionGates).filter((item) => String(item.status || "").toUpperCase() === "AWAITING_MANUAL_CONFIRMATION").length,
  };
  return {
    status: portfolioStatus({ counts, errors, submissionPossible: safety.submissionPossible }),
    portfolio_table_status: "execution_projection",
    submission_possible: Boolean(safety.submissionPossible),
    live_account_allowed: Boolean(safety.liveAccountAllowed),
    risk_percent: finite(safety.riskPercent),
    max_contracts: finite(safety.maxContracts),
    ...counts,
  };
}

function portfolioStatus({ counts, errors, submissionPossible }) {
  if (errors.length >= 3) return "DATA_UNAVAILABLE";
  if (errors.length > 0) return "ACTION_REQUIRED";
  if (counts.activeLocks || counts.reconciliationDivergences) return "ACTION_REQUIRED";
  if (!submissionPossible) return "BROKER_SUBMIT_BLOCKED";
  return "CONTROLLED";
}

function sourceState({ execution, strategy, performance, errors }) {
  const reads = [
    readState("execution", execution, errors),
    readState("strategy", strategy, errors),
    readState("performance", performance, errors),
  ];
  return {
    status: reads.every((read) => read.status === "error") ? "unavailable" : reads.some((read) => read.status === "error") ? "partial" : "ready",
    reads,
  };
}

function readState(name, value, errors) {
  const error = errors.find((item) => item.source === name);
  return {
    source: name,
    status: error ? "error" : "ok",
    count: sourceCount(value),
    error_code: error?.code || null,
    error_message: error?.message || null,
  };
}

function settledValue(result) {
  return result.status === "fulfilled" ? result.value : null;
}

function settledErrors(results = {}) {
  return Object.entries(results)
    .filter(([, result]) => result.status === "rejected")
    .map(([source, result]) => ({
      source,
      code: result.reason?.code || "SOURCE_READ_FAILED",
      message: result.reason?.message || String(result.reason),
    }));
}

function sourceCount(value) {
  if (!value) return 0;
  if (Array.isArray(value.items)) return value.items.length;
  if (Array.isArray(value.instances)) return value.instances.length;
  if (Array.isArray(value.trades)) return value.trades.length;
  return 1;
}

function accountRows(execution) {
  const snapshots = new Map(safeArray(execution?.accountSnapshots).map((item) => [item.broker_account_id, item]));
  const policies = safeArray(execution?.policies);
  return safeArray(execution?.accounts).map((account) => {
    const snapshot = snapshots.get(account.broker_account_id);
    const policy = policies.find((item) => accountAllowedByPolicy(account, item)) || policies[0] || {};
    const capital = brokerCapital(snapshot, policy);
    return {
      account_id: account.broker_account_id,
      label: account.account_label,
      mode: account.mode,
      read_only: Boolean(account.read_only),
      submission_enabled: Boolean(account.order_submission_enabled),
      max_contracts: finite(account.max_contracts ?? policy.max_contracts),
      risk_percent: finite(policy.risk_per_trade_pct),
      capital,
      capital_source: snapshot ? "broker_snapshot" : policy.fallback_capital_enabled ? "fallback_policy" : "missing",
      captured_at: snapshot?.captured_at || null,
      status: accountStatus(account, snapshot, policy),
      controls: accountControls(account, snapshot, policy),
    };
  });
}

function accountAllowedByPolicy(account, policy) {
  const allowed = Array.isArray(policy?.allowed_accounts) ? policy.allowed_accounts : [];
  return allowed.includes(account.broker_account_id);
}

function brokerCapital(snapshot, policy) {
  const candidates = [
    snapshot?.payload?.net_liquidation_value,
    snapshot?.payload?.net_liquidation,
    snapshot?.payload?.NetLiquidation,
    snapshot?.cash_value,
    policy?.fallback_capital_enabled ? policy?.fallback_capital : null,
  ];
  return candidates.map(finite).find((value) => value !== null && value > 0) ?? null;
}

function accountStatus(account, snapshot, policy) {
  if (account.read_only || !account.order_submission_enabled) return "READ_ONLY";
  if (!policy?.enabled) return "POLICY_DISABLED";
  if (!snapshot && !policy?.fallback_capital_enabled) return "CAPITAL_MISSING";
  return "CONTROLLED";
}

function accountControls(account, snapshot, policy) {
  return [
    ...(account.read_only ? ["ACCOUNT_READ_ONLY"] : []),
    ...(!account.order_submission_enabled ? ["SUBMISSION_DISABLED"] : []),
    ...(!policy?.enabled ? ["POLICY_DISABLED"] : []),
    ...(!snapshot && !policy?.fallback_capital_enabled ? ["CAPITAL_SNAPSHOT_MISSING"] : []),
  ];
}

function exposureRows(execution) {
  const groups = new Map();
  const contracts = new Map(safeArray(execution?.contracts).map((item) => [item.broker_contract_id, item]));
  for (const trade of safeArray(execution?.trades).filter(isOpenTrade)) addExposure(groups, exposureKey(trade, contracts), { open: signedTradeQuantity(trade) });
  for (const intent of safeArray(execution?.intents).filter(isActiveIntent)) addExposure(groups, exposureKey(intent, contracts), signedIntentQuantity(intent));
  for (const order of safeArray(execution?.orders).filter(isActiveOrder)) addExposure(groups, exposureKey(order, contracts), { activeOrder: Math.abs(finite(order.quantity) || 0) });
  return [...groups.values()].map((row) => ({ ...row, status: exposureStatus(row), detail: exposureDetail(row) }));
}

function portfolioState({ execution, generatedAt }) {
  const brokerPositions = safeArray(execution?.trades).filter(isOpenTrade);
  const portfolioIntents = safeArray(execution?.portfolioOrderIntents).filter(isActivePortfolioIntent);
  const snapshots = safeArray(execution?.accountSnapshots);
  const pendingRisk = portfolioIntents.map((item) => riskSnapshot(item)).filter((item) => item.availability !== "UNAVAILABLE");
  return {
    schemaVersion: "portfolio_authoritative_state_v1",
    asOf: generatedAt || null,
    availability: execution ? "PARTIAL" : "UNAVAILABLE",
    sourceTypes: {
      broker: brokerPositions.length ? "BROKER_CONFIRMED" : snapshots.length ? "RECONCILED" : "UNKNOWN",
      target: portfolioIntents.length ? "PENDING" : "UNKNOWN",
      strategy: portfolioIntents.length ? "VIRTUAL" : "UNKNOWN",
    },
    accounts: accountRows(execution).map((item) => ({
      accountId: item.account_id,
      equity: item.capital === null ? availabilityNode("UNAVAILABLE", "ACCOUNT_EQUITY_UNAVAILABLE") : { availability: "KNOWN", value: item.capital, currency: "USD", asOf: item.captured_at, source: item.capital_source },
      cash: availabilityNode("UNAVAILABLE", "ACCOUNT_CASH_UNAVAILABLE"),
      margin: availabilityNode("UNAVAILABLE", "ACCOUNT_MARGIN_UNAVAILABLE"),
      buyingPower: availabilityNode("UNAVAILABLE", "ACCOUNT_BUYING_POWER_UNAVAILABLE"),
      source: item.capital_source,
    })),
    positions: brokerPositions.map((item) => ({
      positionId: item.trade_id,
      sourceType: "BROKER_CONFIRMED",
      accountId: item.broker_account_id,
      instrument: instrumentFor(item, execution),
      quantity: finite(item.quantity_open),
      side: item.side,
    })),
    pendingTargetPositions: portfolioIntents.map((item) => ({
      targetPositionId: item.target_position_id,
      orderIntentId: item.portfolio_order_intent_id,
      sourceType: "PENDING",
      accountId: item.target_account_id || item.payload?.account_id || item.order_intent_payload?.account_id || null,
      instrument: item.target_instrument || item.payload?.instrument || item.order_intent_payload?.instrument || null,
      targetNetSize: finite(item.net_target_size),
      deltaSize: finite(item.delta_size),
      riskApprovedNetSize: finite(item.risk_approved_net_size),
    })),
    openRisk: aggregateMoney(pendingRisk.map((item) => item.riskAmount)),
    pnl: availabilityNode("UNAVAILABLE", "PNL_SOURCE_UNAVAILABLE"),
    concentration: availabilityNode("UNAVAILABLE", "CONCENTRATION_NOT_IMPLEMENTED"),
    correlation: availabilityNode("NOT_IMPLEMENTED", "CORRELATION_NOT_IMPLEMENTED"),
  };
}

function riskCenterState({ execution, generatedAt, controls }) {
  const riskDecisions = safeArray(execution?.portfolioOrderIntents).flatMap((item) => safeArray(item.risk_decisions));
  const riskSnapshots = safeArray(execution?.portfolioOrderIntents).map(riskSnapshot).filter((item) => item.availability !== "UNAVAILABLE");
  const breaches = riskDecisions.flatMap((item) => safeArray(item.breaches));
  const limits = riskDecisions.flatMap((item) => safeArray(item.limits));
  const nearestLimits = riskDecisions.map((item) => item.nearest_limit).filter(Boolean);
  const locks = safeArray(execution?.locks);
  return {
    schemaVersion: "global_risk_center_v1",
    asOf: generatedAt || null,
    source: "portfolio_risk_decisions",
    availability: riskDecisions.length ? "KNOWN" : "UNAVAILABLE",
    globalStatus: controls.some((item) => item.severity === "critical") ? "BLOCKED" : riskDecisions.length ? "CONTROLLED" : "DATA_UNAVAILABLE",
    openRisk: aggregateMoney(riskSnapshots.map((item) => item.riskAmount)),
    limits,
    breaches,
    nearestLimits,
    dailyLoss: availabilityNode("UNAVAILABLE", "DAILY_LOSS_SOURCE_UNAVAILABLE"),
    trailingDrawdown: availabilityNode("UNAVAILABLE", "TRAILING_DRAWDOWN_SOURCE_UNAVAILABLE"),
    margin: availabilityNode("UNAVAILABLE", "MARGIN_SOURCE_UNAVAILABLE"),
    grossExposure: availabilityNode("UNAVAILABLE", "GROSS_EXPOSURE_SOURCE_UNAVAILABLE"),
    netExposure: availabilityNode("UNAVAILABLE", "NET_EXPOSURE_SOURCE_UNAVAILABLE"),
    concentration: availabilityNode("UNAVAILABLE", "CONCENTRATION_SOURCE_UNAVAILABLE"),
    propConstraints: availabilityNode("UNAVAILABLE", "PROP_CONSTRAINTS_SOURCE_UNAVAILABLE"),
    killSwitch: {
      availability: "KNOWN",
      active: locks.length > 0,
      source: "broker_execution_locks",
      reasonCodes: locks.map((item) => item.reason || item.scope_value).filter(Boolean),
    },
    providerCircuitState: availabilityNode("UNAVAILABLE", "PROVIDER_CIRCUIT_STATE_UNAVAILABLE"),
    pendingOrderIntents: safeArray(execution?.portfolioOrderIntents).filter(isActivePortfolioIntent).length,
    pendingTargetPositions: unique(safeArray(execution?.portfolioOrderIntents).map((item) => item.target_position_id).filter(Boolean)).length,
    policyVersions: unique(riskDecisions.map((item) => item.risk_rule_set_version).filter(Boolean)),
  };
}

function exposureKey(item, contracts) {
  const contract = contracts.get(item.broker_contract_id) || {};
  return {
    key: `${item.broker_account_id || "account_missing"}:${contract.instrument_code || item.instrument_code || "instrument_missing"}`,
    account_id: item.broker_account_id || "account_missing",
    instrument_code: contract.instrument_code || item.instrument_code || "instrument_missing",
    broker_symbol: contract.broker_symbol || item.broker_symbol || null,
  };
}

function addExposure(groups, id, patch) {
  const current = groups.get(id.key) || {
    exposure_id: id.key,
    account_id: id.account_id,
    instrument_code: id.instrument_code,
    broker_symbol: id.broker_symbol,
    net_open_quantity: 0,
    pending_buy_quantity: 0,
    pending_sell_quantity: 0,
    active_order_quantity: 0,
  };
  current.net_open_quantity += patch.open || 0;
  current.pending_buy_quantity += patch.buy || 0;
  current.pending_sell_quantity += patch.sell || 0;
  current.active_order_quantity += patch.activeOrder || 0;
  groups.set(id.key, current);
}

function signedTradeQuantity(trade) {
  const qty = finite(trade.quantity_open) || 0;
  return trade.side === "short" ? -qty : qty;
}

function signedIntentQuantity(intent) {
  const qty = Math.abs(finite(intent.quantity) || 0);
  return intent.side === "buy" ? { buy: qty } : { sell: qty };
}

function exposureStatus(row) {
  if (row.instrument_code === "instrument_missing") return "CONTRACT_MAPPING_REQUIRED";
  if (row.active_order_quantity > 0) return "ORDER_ACTIVE";
  if (row.pending_buy_quantity || row.pending_sell_quantity) return "INTENT_PENDING";
  return row.net_open_quantity ? "EXPOSED" : "FLAT";
}

function exposureDetail(row) {
  return `net ${formatQty(row.net_open_quantity)} · achat ${formatQty(row.pending_buy_quantity)} · vente ${formatQty(row.pending_sell_quantity)}`;
}

function buildControls({ execution, strategy, errors }) {
  return [
    ...errors.map((error) => control(`source:${error.source}`, "critical", "SOURCE_UNAVAILABLE", error.source, error.message)),
    ...safeArray(execution?.locks).map((lock) => control(lock.execution_lock_id, "critical", "EXECUTION_LOCK", lock.scope_value, lock.reason)),
    ...safeArray(execution?.reconciliations).filter((item) => item.status === "diverged").map((item) => control(item.reconciliation_run_id, "critical", "BROKER_DIVERGENCE", `${item.mismatch_count} écart(s)`, "Réconciliation broker/PostgreSQL requise.")),
    ...safeArray(execution?.adapterParityRuns).filter((item) => item.status === "diverged").map((item) => control(item.adapter_parity_run_id, "warning", "ADAPTER_PARITY_DIVERGED", `${item.mismatch_count} écart(s)`, "Écart ATI/AddOn à vérifier.")),
    ...strategyMissingControls(strategy),
  ];
}

function strategyMissingControls(strategy) {
  if (safeArray(strategy?.instances).length) return [];
  return [control("strategy:instances", "warning", "NO_STRATEGY_INSTANCE", "Aucune instance", "Le portefeuille n'a aucune Strategy Instance persistée dans la projection lue.")];
}

function control(id, severity, code, label, detail) {
  return { control_id: id, severity, code, label, detail };
}

function strategyConcentrationRows(strategy) {
  const groups = new Map();
  for (const instance of safeArray(strategy?.instances)) {
    const instruments = safeArray(instance.instrument_scope).length ? instance.instrument_scope : ["instrument_missing"];
    for (const instrument of instruments) addStrategyConcentration(groups, instance, instrument);
  }
  return [...groups.values()].map((row) => ({
    ...row,
    status: row.instance_count > 1 && ["LIVE", "PAPER"].includes(row.execution_mode) ? "REVIEW_SIMILARITY" : "OBSERVE",
    detail: `${row.instance_count} instance(s) · ${row.runtime_states.join(", ") || "runtime absent"}`,
  }));
}

function addStrategyConcentration(groups, instance, instrument) {
  const key = `${instance.execution_mode || "UNKNOWN"}:${instrument}`;
  const row = groups.get(key) || { key, instrument_code: instrument, execution_mode: instance.execution_mode || "UNKNOWN", instance_count: 0, runtime_states: [] };
  row.instance_count += 1;
  row.runtime_states = unique([...row.runtime_states, instance.runtime_state || "UNKNOWN"]);
  groups.set(key, row);
}

function orderIntentRows(execution) {
  return safeArray(execution?.intents).slice(0, 50).map((intent) => ({
    order_intent_id: intent.order_intent_id,
    status: intent.status,
    approval_status: intent.approval_status,
    instrument_code: intent.instrument_code || null,
    account_id: intent.broker_account_id || null,
    side: intent.side,
    quantity: finite(intent.quantity),
    expires_at: intent.expires_at || null,
  }));
}

function portfolioOrderIntentRows(execution) {
  return safeArray(execution?.portfolioOrderIntents).slice(0, 50).map((intent) => {
    const payload = intent.order_intent_payload || intent.payload || {};
    return {
      order_intent_id: intent.portfolio_order_intent_id || payload.order_intent_id,
      target_position_id: intent.target_position_id || payload.target_position_id,
      status: intent.status || payload.status,
      instrument_code: intent.target_instrument || payload.instrument || null,
      account_id: intent.target_account_id || payload.account_id || payload.broker_account_id || null,
      side: payload.action || payload.side || null,
      quantity: finite(intent.quantity ?? payload.quantity),
      execution_terms: intent.execution_terms || payload.execution_terms || null,
      risk_snapshot: riskSnapshot(intent),
      immutability: intent.immutability || payload.immutability || null,
      allowed_actions: {
        allowedActions: ["VIEW"],
        denialReasons: ["HUMAN_GATE_REQUIRED_FOR_MUTATION"],
        revision: intent.immutable_terms_hash || intent.order_intent_hash || payload.order_intent_hash || "unavailable",
      },
    };
  });
}

function riskSnapshot(intent = {}) {
  const payload = intent.order_intent_payload || intent.payload || {};
  const snapshot = intent.risk_snapshot || payload.risk_snapshot || {};
  const riskDecision = safeArray(intent.risk_decisions)[0] || {};
  const riskAmount = finite(snapshot.riskAmount ?? snapshot.risk_amount ?? riskDecision.authorized?.risk_amount);
  return Object.keys(snapshot).length || Object.keys(riskDecision).length ? {
    availability: "KNOWN",
    authorizedQty: finite(snapshot.authorizedQty ?? snapshot.authorized_qty ?? riskDecision.authorized?.quantity ?? riskDecision.approved_size),
    riskAmount,
    riskPerContract: finite(snapshot.riskPerContract ?? snapshot.risk_per_contract ?? riskDecision.trade_risk?.risk_per_contract),
    stopDistance: snapshot.stopDistance || {
      points: finite(riskDecision.trade_risk?.stop_distance_points),
      ticks: finite(riskDecision.trade_risk?.stop_distance_ticks),
    },
    nearestLimit: snapshot.nearestLimit || riskDecision.nearest_limit || null,
    reasonCodes: safeArray(snapshot.reasonCodes || snapshot.reason_codes || riskDecision.reason_codes).map(String),
  } : { availability: "UNAVAILABLE", reasonCode: "RISK_SNAPSHOT_UNAVAILABLE" };
}

function reconciliationRows(execution) {
  return safeArray(execution?.reconciliations).slice(0, 20).map((item) => ({
    reconciliation_run_id: item.reconciliation_run_id,
    account_id: item.broker_account_id,
    status: item.status,
    mismatch_count: finite(item.mismatch_count) || 0,
    completed_at: item.completed_at || item.started_at,
  }));
}

function controlledActions(controls) {
  const actionRequired = controls.some((item) => ["critical", "warning"].includes(item.severity));
  return [
    {
      action_id: "open_execution_console",
      label: "Ouvrir la console d'exécution",
      enabled: true,
      status: actionRequired ? "recommended" : "available",
      href: "/operations/execution",
      reason: "Les actions broker restent portées par l'Execution Gateway.",
    },
    {
      action_id: "portfolio_risk_write_gate",
      label: "Modifier une décision portefeuille",
      enabled: false,
      status: "blocked_by_design",
      href: null,
      reason: "Le cockpit TD2-705 est une projection en lecture ; les écritures portefeuille arrivent via un use case révisionné.",
    },
  ];
}

function isActiveIntent(intent) {
  return ACTIVE_INTENT_STATUSES.has(String(intent?.status || "").toLowerCase());
}

function isActivePortfolioIntent(intent) {
  return !["REJECTED", "CANCELLED", "CANCELED", "EXPIRED", "FILLED", "DONE", "COMPLETED", "FAILED"].includes(String(intent?.status || "").toUpperCase());
}

function isActiveOrder(order) {
  return ACTIVE_ORDER_STATUSES.has(String(order?.status || "").toLowerCase());
}

function isOpenTrade(trade) {
  return OPEN_TRADE_STATUSES.has(String(trade?.status || "").toLowerCase()) && Math.abs(finite(trade?.quantity_open) || 0) > 0;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function finite(value) {
  const parsed = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(parsed) ? parsed : null;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function formatQty(value) {
  return Number(value || 0).toFixed(0);
}

function instrumentFor(item, execution) {
  const contracts = new Map(safeArray(execution?.contracts).map((contract) => [contract.broker_contract_id, contract]));
  return contracts.get(item.broker_contract_id)?.instrument_code || item.instrument_code || null;
}

function availabilityNode(availability, reasonCode) {
  return { availability, value: null, reasonCode };
}

function aggregateMoney(values) {
  const finiteValues = values.filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  return finiteValues.length
    ? { availability: "KNOWN", value: Math.round(finiteValues.reduce((sum, value) => sum + Number(value), 0) * 100) / 100, currency: "USD" }
    : { availability: "UNAVAILABLE", value: null, currency: "UNAVAILABLE", reasonCode: "MONEY_VALUES_UNAVAILABLE" };
}
