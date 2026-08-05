import { canonicalSha256 } from "./execution-scope.js";
import {
  normalizeContractOrderTypeV1,
  normalizeEntryModeV1,
  validateEntryOrderSemanticsV1,
} from "./entry-order-semantics-v1.js";

export const BROKER_EXECUTION_SCHEMA_VERSION = "broker_execution_v2";
export const BROKER_RISK_PERCENT = 0.25;
export const BROKER_MAX_ROUNDING_EXCESS_PERCENT = 0.25;
export const BROKER_DEFAULT_MAX_DECISION_AGE_SECONDS = 120;
export const BROKER_CONTRACT_ROUNDING_MODE = "ceil";
export const BROKER_EXECUTION_AUTHORITY_MODES = Object.freeze(["semi_auto", "auto"]);
export const SAFE_BRIDGE_MODES = Object.freeze([
  "disabled",
  "dry_run_file",
  "sim101_ati_manual_arm",
  "sim101_ati_approved_only",
  "sim101_addon_approved_only",
  "live_read_only_reconciliation",
  "live_limited_approved_only",
]);
export const SUBMISSION_BRIDGE_MODES = Object.freeze([
  "sim101_ati_manual_arm",
  "sim101_ati_approved_only",
  "sim101_addon_approved_only",
  "live_limited_approved_only",
]);

export class BrokerExecutionError extends Error {
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = "BrokerExecutionError";
    this.code = code;
    this.details = details;
  }
}

export function brokerExecutionEnvironment(env = process.env) {
  return Object.freeze({
    executionEnabled: env.DESK_BROKER_EXECUTION_ENABLED === "true",
    provider: text(env.DESK_BROKER_PROVIDER || "ninjatrader").toLowerCase(),
    bridgeMode: bridgeMode(env.DESK_NINJA_BRIDGE_MODE),
    requireOperatorApproval: env.DESK_NINJA_REQUIRE_OPERATOR_APPROVAL !== "false",
    defaultAccount: text(env.DESK_NINJA_DEFAULT_ACCOUNT || "ninjatrader_paper_local"),
    accountAllowlist: csv(env.DESK_NINJA_ACCOUNT_ALLOWLIST || "ninjatrader_paper_local"),
    maxContracts: nonNegativeInteger(env.DESK_NINJA_MAX_CONTRACTS, 0),
    allowedInstruments: csv(env.DESK_NINJA_ALLOWED_INSTRUMENTS || "MNQ,MES").map((value) => value.toUpperCase()),
    killSwitch: env.DESK_NINJA_KILL_SWITCH !== "false",
    orderTtlSeconds: boundedInteger(env.DESK_NINJA_ORDER_TTL_SECONDS, 60, 5, 3600),
    bridgeStaleSeconds: boundedInteger(env.DESK_NINJA_BRIDGE_STALE_SECONDS, 30, 5, 300),
    accountSnapshotStaleSeconds: boundedInteger(env.DESK_NINJA_ACCOUNT_SNAPSHOT_STALE_SECONDS, 60, 5, 300),
    allowLiveAccount: env.DESK_NINJA_ALLOW_LIVE_ACCOUNT === "true",
  });
}

export function brokerExecutionAuthorityMode(policy = {}) {
  const configured = text(policy?.execution_authority_mode).toLowerCase();
  if (BROKER_EXECUTION_AUTHORITY_MODES.includes(configured)) return configured;
  return policy?.require_operator_approval === false ? "auto" : "semi_auto";
}

export function resolveBrokerAccountCapital(accountSnapshot = null, { snapshotFresh = true, fallbackEnabled = false, fallbackCapital = null } = {}) {
  if (snapshotFresh && accountSnapshot && typeof accountSnapshot === "object") {
    const payload = accountSnapshot.payload && typeof accountSnapshot.payload === "object" ? accountSnapshot.payload : {};
    const candidates = [
      ["net_liquidation_value", accountSnapshot.net_liquidation_value],
      ["net_liquidation", accountSnapshot.net_liquidation],
      ["payload.net_liquidation_value", payload.net_liquidation_value],
      ["payload.net_liquidation", payload.net_liquidation],
      ["payload.NetLiquidation", payload.NetLiquidation],
      ["cash_value", accountSnapshot.cash_value],
      ["payload.cash_value", payload.cash_value],
      ["payload.cashValue", payload.cashValue],
      ["payload.CashValue", payload.CashValue],
    ];
    for (const [source, candidate] of candidates) {
      const value = finite(candidate);
      if (value !== null && value > 0) return Object.freeze({ value, source, fallback: false });
    }
  }
  const configuredFallback = finite(fallbackCapital);
  if (fallbackEnabled === true && configuredFallback !== null && configuredFallback > 0) {
    return Object.freeze({ value: configuredFallback, source: "policy.fallback_capital", fallback: true });
  }
  return Object.freeze({ value: null, source: null, fallback: false });
}

export function calculateContractQuantity({
  capital,
  entryPrice,
  stopPrice,
  pointValue,
  riskPercent = BROKER_RISK_PERCENT,
  roundingMode = BROKER_CONTRACT_ROUNDING_MODE,
} = {}) {
  const normalizedCapital = positiveNumber(capital, "capital");
  const normalizedEntry = finite(entryPrice);
  const normalizedStop = finite(stopPrice);
  const normalizedPointValue = positiveNumber(pointValue, "point_value");
  const normalizedRiskPercent = positiveNumber(riskPercent, "risk_percent");
  if (normalizedEntry === null || normalizedStop === null) {
    throw new BrokerExecutionError("SIZING_PRICE_REQUIRED", "Entry and stop prices are required for contract sizing.");
  }
  if (normalizedEntry === normalizedStop) {
    throw new BrokerExecutionError("SIZING_STOP_DISTANCE_REQUIRED", "Entry and stop prices must define a positive risk distance.");
  }
  if (roundingMode !== "ceil") {
    throw new BrokerExecutionError("SIZING_ROUNDING_MODE_INVALID", "Only upward integer contract rounding is supported.", { rounding_mode: roundingMode });
  }

  const riskBudget = normalizedCapital * normalizedRiskPercent / 100;
  const riskPoints = Math.abs(normalizedEntry - normalizedStop);
  const riskPerContract = riskPoints * normalizedPointValue;
  const rawContracts = riskBudget / riskPerContract;
  const contracts = stableCeil(rawContracts);
  const actualRisk = contracts * riskPerContract;
  const actualRiskPercent = actualRisk / normalizedCapital * 100;
  const roundingExcess = Math.max(0, actualRisk - riskBudget);

  return Object.freeze({
    schema_version: "contract_sizing_v1",
    risk_percent: normalizedRiskPercent,
    rounding_mode: roundingMode,
    capital: metric(normalizedCapital),
    risk_budget: metric(riskBudget),
    entry_price: normalizedEntry,
    stop_price: normalizedStop,
    risk_points: metric(riskPoints),
    point_value: normalizedPointValue,
    risk_per_contract: metric(riskPerContract),
    raw_contracts: metric(rawContracts),
    contracts,
    actual_risk: metric(actualRisk),
    actual_risk_percent: metric(actualRiskPercent),
    rounding_excess: metric(roundingExcess),
    rounding_excess_percent: metric(roundingExcess / normalizedCapital * 100),
    exceeds_risk_target: roundingExcess > 1e-8,
  });
}

export function materializeTradeDecision({ position, setup = null, master = null, monitor = null, now = new Date().toISOString() } = {}) {
  if (!position || typeof position !== "object") throw new BrokerExecutionError("POSITION_REQUIRED", "A canonical paper position is required.");
  const sourceId = text(position.position_id || position.id);
  const instrument = canonicalInstrument(position.instrument || setup?.instrument);
  const side = canonicalSide(position.direction || position.side || setup?.direction);
  const entryPrice = finite(position.entry_price ?? setup?.entry_price);
  const stopPrice = finite(position.stop_loss ?? position.stop_price ?? setup?.stop_loss);
  const targetPrice = finite(position.take_profit_1 ?? position.target_price ?? setup?.take_profit_1);
  const requestedQuantity = positiveIntegerOrNull(position.quantity ?? position.size);
  const triggerTimestamp = text(
    position.triggered_at_utc
      || position.triggered_at_paris
      || position.opened_at_utc
      || position.opened_at_paris,
  );
  if (!triggerTimestamp || !Number.isFinite(Date.parse(triggerTimestamp))) {
    throw new BrokerExecutionError(
      "DECISION_TRIGGER_TIMESTAMP_REQUIRED",
      "A valid canonical fill/trigger timestamp is required to materialize a broker decision.",
      { trigger_timestamp: triggerTimestamp || null },
    );
  }
  const decidedAt = iso(triggerTimestamp);
  const validUntil = isoOrNull(position.valid_until || position.expires_at || setup?.expires_at_utc || setup?.expires_at_paris);
  const status = String(position.status || "").toUpperCase();
  const missing = [
    !sourceId && "position_id",
    !instrument && "instrument",
    !side && "side",
    entryPrice === null && "entry_price",
    stopPrice === null && "stop_loss",
    targetPrice === null && "take_profit_1",
  ].filter(Boolean);
  if (missing.length) throw new BrokerExecutionError("DECISION_SOURCE_INCOMPLETE", `Paper position is incomplete: ${missing.join(", ")}.`, { missing });
  if (!["OPEN", "PROTECTED", "SCALING", "ARMED"].includes(status)) {
    throw new BrokerExecutionError("POSITION_NOT_ELIGIBLE", `Position status ${status || "UNKNOWN"} is not eligible for broker materialization.`, { status });
  }

  const contractOrderType = normalizeContractOrderTypeV1(position.order_type || setup?.order_type);
  const entryMode = normalizeEntryModeV1(position.entry_mode || setup?.entry_mode);
  const orderSemantics = validateEntryOrderSemanticsV1({
    entryMode,
    orderType: contractOrderType,
    limitPrice: position.order_limit_price
      ?? setup?.order_limit_price
      ?? (contractOrderType === "LIMIT" ? entryPrice : null),
    stopPrice: position.order_stop_price
      ?? setup?.order_stop_price
      ?? (contractOrderType === "STOP" ? entryPrice : null),
    requireExecutablePrices: true,
  });
  if (!orderSemantics.valid) {
    throw new BrokerExecutionError(
      "DECISION_ENTRY_ORDER_INVALID",
      "The position entry mode and order type cannot be materialized safely.",
      { errors: orderSemantics.errors },
    );
  }

  const materializationKey = canonicalSha256({ source_collection: "desk_positions", source_document_id: sourceId, schema: BROKER_EXECUTION_SCHEMA_VERSION });
  const decisionId = `trade_decision_${materializationKey.slice(0, 24)}`;
  return Object.freeze({
    trade_decision_id: decisionId,
    materialization_key: materializationKey,
    source_collection: "desk_positions",
    source_document_id: sourceId,
    mode: "paper",
    status: "candidate",
    instrument_code: instrument,
    symbol_id: position.symbol_id || null,
    side,
    strategy_id: position.strategy_id || setup?.strategy_id || null,
    trading_date: position.trading_date || position.date || null,
    session: position.session || null,
    decided_at: decidedAt,
    valid_until: validUntil,
    entry_plan: {
      order_type: orderSemantics.broker_order_type,
      contract_order_type: orderSemantics.order_type,
      entry_mode: orderSemantics.entry_mode,
      entry_price: entryPrice,
      limit_price: orderSemantics.limit_price,
      stop_price: orderSemantics.stop_price,
      quantity: null,
      requested_quantity: requestedQuantity,
      quantity_source: "capital_risk_model",
      time_in_force: "DAY",
    },
    risk_plan: {
      stop_price: stopPrice,
      target_price: targetPrice,
      risk_percent: BROKER_RISK_PERCENT,
      contract_rounding_mode: BROKER_CONTRACT_ROUNDING_MODE,
      initial_risk_points: Math.abs(entryPrice - stopPrice),
      reward_points: Math.abs(targetPrice - entryPrice),
    },
    thesis_ref: {
      master_id: position.linked_master_analysis_id || master?.master_id || master?.analysis_id || null,
      monitor_id: position.monitor_id || monitor?.monitor_id || null,
      thesis_id: position.linked_active_thesis_id || null,
      setup_id: position.setup_record_id || setup?.setup_record_id || null,
      position_id: sourceId,
    },
    confidence: normalizedConfidence(position.confidence ?? setup?.confidence),
    rationale: text(position.rationale || setup?.rationale) || null,
    raw: {
      schema_version: BROKER_EXECUTION_SCHEMA_VERSION,
      paper_position_status: status,
      broker_execution: false,
      source_hash: canonicalSha256(position),
    },
  });
}

export function evaluateBrokerPolicy({
  decision,
  provider,
  account,
  contract,
  policy,
  bridge,
  locks = [],
  existingTrades = [],
  accountSnapshot = null,
  environment = brokerExecutionEnvironment({}),
  now = new Date().toISOString(),
} = {}) {
  const rules = [];
  const add = (code, pass, details = {}) => rules.push({ code, status: pass ? "pass" : "fail", details });
  const nowMs = Date.parse(now);
  const instrument = canonicalInstrument(decision?.instrument_code);
  const entry = finite(decision?.entry_plan?.entry_price);
  const orderType = text(decision?.entry_plan?.order_type).toLowerCase();
  const orderLimit = finite(decision?.entry_plan?.limit_price);
  const orderStop = finite(decision?.entry_plan?.stop_price);
  const stop = finite(decision?.risk_plan?.stop_price);
  const target = finite(decision?.risk_plan?.target_price);
  const side = canonicalSide(decision?.side);
  const accountId = text(account?.broker_account_id);
  const bridgeLastSeenMs = Date.parse(bridge?.last_seen_at || "");
  const bridgeFresh = Number.isFinite(bridgeLastSeenMs) && Number.isFinite(nowMs)
    && nowMs - bridgeLastSeenMs <= Number(environment.bridgeStaleSeconds || 30) * 1000;
  const accountSnapshotMs = Date.parse(accountSnapshot?.captured_at || "");
  const accountSnapshotFresh = Number.isFinite(accountSnapshotMs) && Number.isFinite(nowMs)
    && nowMs >= accountSnapshotMs
    && nowMs - accountSnapshotMs <= Number(environment.accountSnapshotStaleSeconds || 60) * 1000;
  const riskPercent = finite(policy?.risk_per_trade_pct) ?? BROKER_RISK_PERCENT;
  const maxRoundingExcessPercent = finite(policy?.max_rounding_excess_pct)
    ?? BROKER_MAX_ROUNDING_EXCESS_PERCENT;
  const configuredMaxDecisionAgeSeconds = policy?.max_decision_age_seconds;
  const maxDecisionAgeSeconds = configuredMaxDecisionAgeSeconds === null || configuredMaxDecisionAgeSeconds === undefined
    ? BROKER_DEFAULT_MAX_DECISION_AGE_SECONDS
    : Number(configuredMaxDecisionAgeSeconds);
  const decisionFreshnessPolicyValid = Number.isInteger(maxDecisionAgeSeconds)
    && maxDecisionAgeSeconds >= 5
    && maxDecisionAgeSeconds <= 3_600;
  const decisionTimestamp = text(decision?.decided_at);
  const decisionTimestampMs = Date.parse(decisionTimestamp);
  const decisionTimestampValid = Boolean(decisionTimestamp) && Number.isFinite(decisionTimestampMs);
  const decisionAgeSeconds = decisionTimestampValid && Number.isFinite(nowMs)
    ? (nowMs - decisionTimestampMs) / 1_000
    : null;
  const capital = resolveBrokerAccountCapital(accountSnapshot, {
    snapshotFresh: accountSnapshotFresh,
    fallbackEnabled: policy?.fallback_capital_enabled === true,
    fallbackCapital: policy?.fallback_capital,
  });
  let positionSizing = null;
  let positionSizingError = null;
  try {
    positionSizing = calculateContractQuantity({
      capital: capital.value,
      entryPrice: entry,
      stopPrice: stop,
      pointValue: contract?.point_value,
      riskPercent,
    });
  } catch (error) {
    positionSizingError = { code: error?.code || "POSITION_SIZING_FAILED", message: error?.message || String(error) };
  }
  const quantity = positiveIntegerOrNull(positionSizing?.contracts);
  const activeLocks = (locks || []).filter((lock) => lock?.locked !== false && (!lock.expires_at || Date.parse(lock.expires_at) > nowMs));
  const matchingLock = activeLocks.find((lock) => lock.scope_type === "global"
    || (lock.scope_type === "account" && lock.scope_value === accountId)
    || (lock.scope_type === "instrument" && canonicalInstrument(lock.scope_value) === instrument)
    || (lock.scope_type === "session" && lock.scope_value === decision?.session));
  const providerMatches = text(provider?.broker_provider_code).toLowerCase() === text(environment.provider).toLowerCase();
  const authorityMode = brokerExecutionAuthorityMode(policy);

  add("ENV_EXECUTION_ENABLED", environment.executionEnabled === true);
  add("ENV_KILL_SWITCH_RELEASED", environment.killSwitch === false);
  add("ENV_BRIDGE_MODE_SUBMITS", SUBMISSION_BRIDGE_MODES.includes(environment.bridgeMode), { mode: environment.bridgeMode });
  add("PROVIDER_MATCH", providerMatches);
  add("PROVIDER_ENABLED", providerMatches && provider?.enabled === true);
  add("ACCOUNT_ALLOWLIST", environment.accountAllowlist?.includes(accountId), { account_id: accountId });
  add("ACCOUNT_PREPROD", account?.environment === "preprod");
  add("ACCOUNT_SIM_ONLY", account?.mode === "paper" && /^sim\d*$/i.test(text(bridge?.account_name || account?.metadata?.account_name || "Sim101")));
  add("LIVE_ACCOUNT_FORBIDDEN", environment.allowLiveAccount !== true && account?.mode !== "live");
  add("ACCOUNT_WRITABLE", account?.read_only === false && account?.order_submission_enabled === true);
  add("POLICY_ENABLED", policy?.enabled === true);
  add("POLICY_EXECUTION_AUTHORITY_VALID", BROKER_EXECUTION_AUTHORITY_MODES.includes(authorityMode), { mode: authorityMode });
  add("POLICY_APPROVAL_COMPATIBLE", policy?.require_operator_approval === (authorityMode === "semi_auto"), {
    mode: authorityMode,
    require_operator_approval: policy?.require_operator_approval,
  });
  add("POLICY_ACCOUNT_ALLOWED", array(policy?.allowed_accounts).includes(accountId));
  add("POLICY_INSTRUMENT_ALLOWED", array(policy?.allowed_instruments).map(canonicalInstrument).includes(instrument));
  add("POLICY_SESSION_ALLOWED", array(policy?.allowed_sessions).includes(decision?.session));
  add("ENV_INSTRUMENT_ALLOWED", environment.allowedInstruments?.includes(instrument));
  add("ACCOUNT_SNAPSHOT_OR_FALLBACK_PRESENT", accountSnapshotFresh || capital.fallback, {
    snapshot_present: Boolean(accountSnapshot),
    snapshot_fresh: accountSnapshotFresh,
    fallback_enabled: policy?.fallback_capital_enabled === true,
  });
  add("ACCOUNT_CAPITAL_VALID", capital.value !== null, { source: capital.source, fallback: capital.fallback });
  add("CONTRACT_POINT_VALUE_VALID", finite(contract?.point_value) !== null && Number(contract.point_value) > 0, { point_value: contract?.point_value ?? null });
  add("RISK_PERCENT_POLICY_VALID", riskPercent >= 0.01 && riskPercent <= 0.25, { risk_percent: riskPercent, minimum: 0.01, maximum: 0.25 });
  add("POSITION_SIZE_CALCULATED", quantity !== null, positionSizingError || {});
  add("CONTRACT_ROUNDING_CEIL", positionSizing?.rounding_mode === BROKER_CONTRACT_ROUNDING_MODE, {
    rounding_mode: positionSizing?.rounding_mode || null,
    exceeds_risk_target: positionSizing?.exceeds_risk_target ?? null,
    rounding_excess: positionSizing?.rounding_excess ?? null,
  });
  add(
    "ROUNDING_EXCESS_POLICY",
    positionSizing !== null
      && maxRoundingExcessPercent >= 0
      && maxRoundingExcessPercent <= BROKER_RISK_PERCENT
      && Number(positionSizing.rounding_excess_percent) <= maxRoundingExcessPercent + 1e-10,
    {
      requested_risk_percent: riskPercent,
      actual_risk_percent: positionSizing?.actual_risk_percent ?? null,
      rounding_excess_percent: positionSizing?.rounding_excess_percent ?? null,
      maximum_rounding_excess_percent: maxRoundingExcessPercent,
    },
  );
  add("QUANTITY_VALID", quantity !== null && quantity > 0);
  add("QUANTITY_ENV_LIMIT", quantity !== null && environment.maxContracts > 0 && quantity <= environment.maxContracts, { max: environment.maxContracts });
  add("QUANTITY_ACCOUNT_LIMIT", quantity !== null && Number(account?.max_contracts) > 0 && quantity <= Number(account.max_contracts), { max: account?.max_contracts });
  add("QUANTITY_POLICY_LIMIT", quantity !== null && Number(policy?.max_contracts) > 0 && quantity <= Number(policy.max_contracts), { max: policy?.max_contracts });
  add("CONTRACT_ACTIVE", contract?.active === true);
  add("CONTRACT_INSTRUMENT_MATCH", canonicalInstrument(contract?.instrument_code) === instrument);
  const expiryMs = contractExpiryEndOfDayUtc(contract?.expiry_date);
  add("CONTRACT_NOT_EXPIRED", expiryMs === null || expiryMs > nowMs);
  add("ENTRY_TICK_ALIGNED", priceOnTick(entry, contract?.tick_size));
  add("ORDER_LIMIT_TICK_ALIGNED", !["limit", "stop_limit"].includes(orderType) || priceOnTick(orderLimit, contract?.tick_size), {
    order_type: orderType || null,
    limit_price: orderLimit,
  });
  add("ORDER_STOP_TICK_ALIGNED", !["stop_market", "stop_limit"].includes(orderType) || priceOnTick(orderStop, contract?.tick_size), {
    order_type: orderType || null,
    stop_price: orderStop,
  });
  add("STOP_TICK_ALIGNED", priceOnTick(stop, contract?.tick_size));
  add("TARGET_TICK_ALIGNED", priceOnTick(target, contract?.tick_size));
  add("STOP_VALID", side === "long" ? stop < entry : side === "short" ? stop > entry : false);
  add("TARGET_VALID", side === "long" ? target > entry : side === "short" ? target < entry : false);
  const risk = entry !== null && stop !== null ? Math.abs(entry - stop) : 0;
  const reward = entry !== null && target !== null ? Math.abs(target - entry) : 0;
  const rr = risk > 0 ? reward / risk : 0;
  const minimumRewardRisk = Math.max(2, finite(policy?.min_reward_risk) ?? 2);
  add("REWARD_RISK_MIN", rr >= minimumRewardRisk, {
    reward_risk: rr,
    minimum: minimumRewardRisk,
    configured_minimum: policy?.min_reward_risk ?? null,
  });
  add("DECISION_NOT_EXPIRED", !decision?.valid_until || Date.parse(decision.valid_until) > nowMs);
  add("DECISION_FRESHNESS_POLICY_VALID", decisionFreshnessPolicyValid, {
    maximum_age_seconds: maxDecisionAgeSeconds,
    minimum: 5,
    maximum: 3_600,
  });
  add("DECISION_TIMESTAMP_VALID", decisionTimestampValid, { decided_at: decisionTimestamp || null });
  add("DECISION_NOT_FUTURE", decisionTimestampValid && decisionAgeSeconds !== null && decisionAgeSeconds >= 0, {
    decided_at: decisionTimestamp || null,
    age_seconds: decisionAgeSeconds,
  });
  add(
    "DECISION_FRESH",
    decisionFreshnessPolicyValid
      && decisionTimestampValid
      && decisionAgeSeconds !== null
      && decisionAgeSeconds >= 0
      && decisionAgeSeconds <= maxDecisionAgeSeconds,
    {
      decided_at: decisionTimestamp || null,
      age_seconds: decisionAgeSeconds,
      maximum_age_seconds: maxDecisionAgeSeconds,
      phase: "BROKER_SUBMIT",
    },
  );
  add("NO_EXECUTION_LOCK", !matchingLock, matchingLock ? { lock_id: matchingLock.execution_lock_id, reason: matchingLock.reason } : {});
  add("BRIDGE_HEALTHY", ["armed", "healthy"].includes(bridge?.status) && bridgeFresh, { status: bridge?.status, fresh: bridgeFresh });
  const bridgeTransportReady = environment.bridgeMode === "sim101_addon_approved_only"
    ? bridge?.ninja_connected === true && bridge?.adapter_kind === "addon" && bridge?.command_enabled === true
    : bridge?.ninja_connected === true && bridge?.ati_enabled === true;
  add("BRIDGE_CONNECTED", bridgeTransportReady, { adapter_kind: bridge?.adapter_kind || "ati", command_enabled: bridge?.command_enabled === true, ati_enabled: bridge?.ati_enabled === true });
  const duplicate = (existingTrades || []).some((trade) => canonicalInstrument(trade.instrument_code || trade.broker_contract?.instrument_code) === instrument
    && trade.session === decision?.session
    && !["closed", "cancelled", "rejected", "expired"].includes(String(trade.status || "").toLowerCase()));
  add("NO_DUPLICATE_POSITION", !duplicate);
  const realized = Number(accountSnapshot?.realized_pnl || 0);
  add("DAILY_LOSS_LIMIT", Number(policy?.max_daily_loss) > 0 && realized > -Number(policy.max_daily_loss), { realized_pnl: realized, max_daily_loss: policy?.max_daily_loss });

  const violations = rules.filter((rule) => rule.status === "fail");
  return Object.freeze({
    schema_version: BROKER_EXECUTION_SCHEMA_VERSION,
    status: violations.length ? "fail" : "pass",
    pass: violations.length === 0,
    rules,
    violations,
    metrics: {
      reward_risk: rr,
      quantity,
      position_sizing: positionSizing,
      capital_source: capital.source,
      capital_fallback_used: capital.fallback,
      risk_percent: riskPercent,
      max_rounding_excess_percent: maxRoundingExcessPercent,
      decision_age_seconds: decisionAgeSeconds,
      max_decision_age_seconds: maxDecisionAgeSeconds,
      execution_authority_mode: authorityMode,
      entry_operator_approval_required: authorityMode === "semi_auto",
      management_operator_approval_required: false,
      account_snapshot_age_seconds: accountSnapshotFresh ? Math.max(0, (nowMs - accountSnapshotMs) / 1000) : null,
      bridge_age_seconds: bridgeFresh ? Math.max(0, (nowMs - bridgeLastSeenMs) / 1000) : null,
    },
  });
}

export function createOrderIntent({ decision, riskCheck, account, contract, now = new Date().toISOString(), ttlSeconds = 60 } = {}) {
  if (!riskCheck?.pass) throw new BrokerExecutionError("RISK_CHECK_FAILED", "A passing broker risk check is required.", { violations: riskCheck?.violations || [] });
  const side = decision.side === "long" ? "buy" : "sell";
  const positionSizing = riskCheck?.metrics?.position_sizing;
  const orderType = text(decision?.entry_plan?.order_type).toLowerCase();
  if (!["market", "limit", "stop_market", "stop_limit"].includes(orderType)) {
    throw new BrokerExecutionError("INVALID_ORDER_TYPE", `Unsupported broker order type: ${orderType || "missing"}.`);
  }
  const limitPrice = ["limit", "stop_limit"].includes(orderType)
    ? finite(decision.entry_plan.limit_price)
    : null;
  const stopPrice = ["stop_market", "stop_limit"].includes(orderType)
    ? finite(decision.entry_plan.stop_price)
    : null;
  if (["limit", "stop_limit"].includes(orderType) && limitPrice === null) {
    throw new BrokerExecutionError("ORDER_LIMIT_PRICE_REQUIRED", `${orderType} requires an explicit limit price.`);
  }
  if (["stop_market", "stop_limit"].includes(orderType) && stopPrice === null) {
    throw new BrokerExecutionError("ORDER_STOP_PRICE_REQUIRED", `${orderType} requires an explicit stop price.`);
  }
  const payload = {
    account_id: account.broker_account_id,
    contract_id: contract.broker_contract_id,
    broker_symbol: contract.broker_symbol,
    instrument: decision.instrument_code,
    action: side.toUpperCase(),
    quantity: positiveInteger(positionSizing?.contracts),
    order_type: orderType,
    limit_price: limitPrice,
    stop_price: stopPrice,
    time_in_force: decision.entry_plan.time_in_force || "DAY",
    protective_stop: finite(decision.risk_plan.stop_price),
    profit_target: finite(decision.risk_plan.target_price),
    position_sizing: positionSizing,
  };
  const idempotencyKey = canonicalSha256({ decision_id: decision.trade_decision_id, payload, schema: BROKER_EXECUTION_SCHEMA_VERSION });
  const atmStrategyId = `desk_${idempotencyKey.slice(0, 32)}`;
  const commandPayload = { ...payload, atm_strategy_id: atmStrategyId };
  return Object.freeze({
    order_intent_id: `order_intent_${idempotencyKey.slice(0, 24)}`,
    trade_decision_id: decision.trade_decision_id,
    risk_check_id: riskCheck.risk_check_id || null,
    broker_account_id: account.broker_account_id,
    broker_contract_id: contract.broker_contract_id,
    status: "pending_approval",
    approval_status: "required",
    side,
    order_type: payload.order_type,
    quantity: payload.quantity,
    limit_price: payload.limit_price,
    stop_price: payload.stop_price,
    time_in_force: payload.time_in_force,
    bracket: { stop_price: payload.protective_stop, target_price: payload.profit_target },
    idempotency_key: idempotencyKey,
    requested_at: iso(now),
    expires_at: new Date(Date.parse(now) + boundedInteger(ttlSeconds, 60, 5, 3600) * 1000).toISOString(),
    payload: commandPayload,
    raw: { schema_version: BROKER_EXECUTION_SCHEMA_VERSION, direct_gpt_order: false, position_sizing: positionSizing, atm_strategy_id: atmStrategyId },
  });
}

export function renderNinjaOifCommand(intent, { accountName = "Sim101", orderId, strategyName = "", strategyId = "" } = {}) {
  if (!/^Sim\d*$/i.test(text(accountName))) throw new BrokerExecutionError("SIM_ACCOUNT_REQUIRED", "Only a NinjaTrader simulation account is accepted by the local bridge.");
  const payload = intent?.command_payload || intent?.payload || intent;
  const type = ninjaOrderType(payload.order_type);
  const action = String(payload.action || (intent.side === "buy" ? "BUY" : "SELL")).toUpperCase();
  if (!["BUY", "SELL"].includes(action)) throw new BrokerExecutionError("INVALID_ORDER_ACTION", `Unsupported NinjaTrader action: ${action}.`);
  const quantity = positiveInteger(payload.quantity || intent.quantity);
  const instrument = requiredText(payload.broker_symbol, "broker_symbol");
  const id = text(orderId || intent.order_intent_id || payload.order_id).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48);
  const fields = [
    "PLACE",
    accountName,
    instrument,
    action,
    String(quantity),
    type,
    type === "MARKET" || type === "STOPMARKET" ? "" : price(payload.limit_price ?? intent.limit_price),
    type === "STOPMARKET" || type === "STOPLIMIT" ? price(payload.stop_price ?? intent.stop_price) : "",
    text(payload.time_in_force || intent.time_in_force || "DAY").toUpperCase(),
    text(payload.oco_id),
    id,
    text(strategyName),
    text(strategyId),
  ];
  return `${fields.join(";")}\r\n`;
}

export function renderNinjaOifManagementCommand(input = {}, { accountName = "Sim101", allowGlobalCommand = false } = {}) {
  if (!/^Sim\d*$/i.test(text(accountName))) throw new BrokerExecutionError("SIM_ACCOUNT_REQUIRED", "Only a NinjaTrader simulation account is accepted by the local bridge.");
  const command = text(input.command).toUpperCase();
  const orderId = text(input.order_id || input.orderId);
  const strategyId = text(input.strategy_id || input.strategyId);
  const instrument = text(input.instrument || input.broker_symbol);
  let fields;
  if (command === "CANCEL") {
    if (!orderId) throw new BrokerExecutionError("ORDER_ID_REQUIRED", "CANCEL requires an order ID.");
    fields = [command, "", "", "", "", "", "", "", "", "", orderId, "", strategyId];
  } else if (command === "CHANGE") {
    if (!orderId) throw new BrokerExecutionError("ORDER_ID_REQUIRED", "CHANGE requires an order ID.");
    fields = [command, "", "", "", optionalNonNegativeInteger(input.quantity), "", optionalPrice(input.limit_price), optionalPrice(input.stop_price), "", "", orderId, "", strategyId];
  } else if (command === "CLOSEPOSITION") {
    if (!instrument) throw new BrokerExecutionError("INSTRUMENT_REQUIRED", "CLOSEPOSITION requires an instrument.");
    fields = [command, accountName, instrument, "", "", "", "", "", "", "", "", "", ""];
  } else if (command === "CLOSESTRATEGY") {
    if (!strategyId) throw new BrokerExecutionError("STRATEGY_ID_REQUIRED", "CLOSESTRATEGY requires a strategy ID.");
    fields = [command, "", "", "", "", "", "", "", "", "", "", "", strategyId];
  } else if (command === "CANCELALLORDERS" || command === "FLATTENEVERYTHING") {
    if (!allowGlobalCommand) throw new BrokerExecutionError("GLOBAL_COMMAND_CONFIRMATION_REQUIRED", `${command} requires an explicit global-simulation confirmation.`);
    fields = [command, "", "", "", "", "", "", "", "", "", "", "", ""];
  } else if (command === "REVERSEPOSITION") {
    const action = text(input.action).toUpperCase();
    if (!instrument || !["BUY", "SELL"].includes(action)) throw new BrokerExecutionError("REVERSE_INPUT_REQUIRED", "REVERSEPOSITION requires an instrument and BUY/SELL action.");
    const type = ninjaOrderType(input.order_type || "market");
    fields = [command, accountName, instrument, action, String(positiveInteger(input.quantity)), type,
      type === "MARKET" || type === "STOPMARKET" ? "" : price(input.limit_price),
      type === "STOPMARKET" || type === "STOPLIMIT" ? price(input.stop_price) : "",
      text(input.time_in_force || "DAY").toUpperCase(), text(input.oco_id), orderId, text(input.strategy_name), strategyId];
  } else {
    throw new BrokerExecutionError("INVALID_MANAGEMENT_COMMAND", `Unsupported NinjaTrader management command: ${command}.`);
  }
  return `${fields.join(";")}\r\n`;
}

export function normalizeNinjaUpdate(input = {}, now = new Date().toISOString()) {
  const status = String(input.status || input.order_state || input.state || "unknown").trim().toLowerCase().replace(/\s+/g, "_");
  const statusMap = {
    initialized: "submitted", pending_submit: "submitted", pendingsubmit: "submitted", submitted: "submitted",
    accepted: "accepted", working: "working", suspended: "working", change_submitted: "working", changesubmitted: "working",
    cancel_pending: "cancel_requested", cancelpending: "cancel_requested", cancel_submitted: "cancel_requested",
    trigger_pending: "working", triggerpending: "working", partfilled: "partially_filled", partially_filled: "partially_filled",
    partiallyfilled: "partially_filled", filled: "filled", cancelled: "cancelled", canceled: "cancelled",
    rejected: "rejected", expired: "expired", error: "error",
  };
  return Object.freeze({
    broker_order_ref: requiredText(input.broker_order_ref || input.order_id || input.orderId, "broker_order_ref"),
    status: statusMap[status] || "unknown",
    filled_quantity: finite(input.filled_quantity ?? input.filled) || 0,
    average_fill_price: finite(input.average_fill_price ?? input.avg_fill_price),
    remaining_quantity: finite(input.remaining_quantity ?? input.remaining),
    occurred_at: iso(input.occurred_at || input.timestamp || now),
    raw: input,
  });
}

function canonicalInstrument(value) { return text(value).toUpperCase().split(":").at(-1).replace(/1!$/, ""); }
function canonicalSide(value) {
  const normalized = text(value).toLowerCase();
  if (["long", "buy"].includes(normalized)) return "long";
  if (["short", "sell"].includes(normalized)) return "short";
  return "";
}
function bridgeMode(value) { const mode = text(value || "disabled"); return SAFE_BRIDGE_MODES.includes(mode) ? mode : "disabled"; }
function csv(value) { return String(value || "").split(",").map(text).filter(Boolean); }
function array(value) { return Array.isArray(value) ? value : []; }
function text(value) { return value === null || value === undefined ? "" : String(value).trim(); }
function requiredText(value, field) { const result = text(value); if (!result) throw new BrokerExecutionError("FIELD_REQUIRED", `${field} is required.`, { field }); return result; }
function finite(value) { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function positiveNumber(value, field) { const parsed = finite(value); if (parsed === null || parsed <= 0) throw new BrokerExecutionError("POSITIVE_NUMBER_REQUIRED", `${field} must be a positive number.`, { field }); return parsed; }
function positiveIntegerOrNull(value) { const parsed = finite(value); return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null; }
function positiveInteger(value) { const parsed = positiveIntegerOrNull(value); if (parsed === null) throw new BrokerExecutionError("POSITIVE_INTEGER_REQUIRED", "A positive integer quantity is required."); return parsed; }
function optionalNonNegativeInteger(value) { const parsed = finite(value); return parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? String(parsed) : "0"; }
function optionalPrice(value) { const parsed = finite(value); return parsed === null ? "0" : String(parsed); }
function nonNegativeInteger(value, fallback) { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback; }
function boundedInteger(value, fallback, min, max) { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback; }
function normalizedConfidence(value) { const parsed = finite(value); if (parsed === null) return null; return parsed > 1 ? Math.max(0, Math.min(1, parsed / 100)) : Math.max(0, Math.min(1, parsed)); }
function iso(value) { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new BrokerExecutionError("INVALID_TIMESTAMP", `Invalid timestamp: ${value}.`); return new Date(parsed).toISOString(); }
function isoOrNull(value) { return value ? iso(value) : null; }
function priceOnTick(value, tick) { const parsed = finite(value); const size = finite(tick); if (parsed === null || size === null || size <= 0) return false; return Math.abs(parsed / size - Math.round(parsed / size)) < 1e-8; }
function stableCeil(value) { const nearest = Math.round(value); return Math.abs(value - nearest) < 1e-10 ? nearest : Math.ceil(value); }
function contractExpiryEndOfDayUtc(value) {
  if (!value) return null;
  const date = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim().slice(0, 10);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T23:59:59.999Z`) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function metric(value) { return Number(Number(value).toFixed(10)); }
function price(value) { const parsed = finite(value); if (parsed === null) return ""; return String(parsed); }
function ninjaOrderType(value) {
  const type = text(value).toLowerCase();
  const map = { market: "MARKET", limit: "LIMIT", stop_market: "STOPMARKET", stopmarket: "STOPMARKET", stop_limit: "STOPLIMIT", stoplimit: "STOPLIMIT" };
  if (!map[type]) throw new BrokerExecutionError("INVALID_ORDER_TYPE", `Unsupported NinjaTrader order type: ${type}.`);
  return map[type];
}
