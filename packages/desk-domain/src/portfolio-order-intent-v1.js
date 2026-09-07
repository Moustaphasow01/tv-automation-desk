import { canonicalSha256 } from "./execution-scope.js";
import { TARGET_POSITION_SCHEMA_VERSION_V1 } from "./portfolio-target-position-v1.js";

export const PORTFOLIO_ORDER_INTENT_PLAN_SCHEMA_VERSION_V1 = "portfolio_order_intent_plan_v1";
export const ORDER_INTENT_SCHEMA_VERSION_V1 = "portfolio_order_intent_v1";
export const ORDER_INTENT_ACTIONS_V1 = Object.freeze(["BUY", "SELL"]);
export const ORDER_INTENT_LIFECYCLE_ACTIONS_V1 = Object.freeze(["OPEN", "INCREASE", "REDUCE", "CLOSE", "REVERSE", "CANCEL_REPLACE"]);
export const ORDER_INTENT_STATUSES_V1 = Object.freeze(["READY", "PROTECTION_REQUIRED", "DUPLICATE_PROTECTED", "NO_DELTA", "ACTIVE_INTENT_EXISTS"]);

export function buildPortfolioOrderIntentPlanV1(input = {}) {
  const asOf = iso(firstDefined(input.as_of_utc, input.asOfUtc, new Date().toISOString()));
  const policy = normalizePolicy(firstDefined(input.execution_policy, input.policy, {}));
  const targets = targetPositions(input).sort((left, right) => targetKey(left).localeCompare(targetKey(right)));
  const existing = activeOrderIntents(firstDefined(input.existing_order_intents, input.active_order_intents, []));
  const state = { order_intents: [], cancel_replace_requests: [], skipped_targets: [] };
  for (const target of targets) applyTarget(state, target, { asOf, policy, existing, input });
  const base = {
    schema_version: PORTFOLIO_ORDER_INTENT_PLAN_SCHEMA_VERSION_V1,
    status: planStatus(state),
    as_of_utc: asOf,
    provider_id: policy.provider_id,
    order_intents: state.order_intents,
    cancel_replace_requests: state.cancel_replace_requests,
    skipped_targets: state.skipped_targets,
  };
  return { ...base, plan_hash: hash(base) };
}

function applyTarget(state, target, context) {
  const draft = orderIntentForTarget(target, context);
  if (draft.skip_reason) {
    state.skipped_targets.push(skip(target, draft.skip_reason, draft));
    return;
  }
  const duplicate = context.existing.find((intent) => text(intent.idempotency_key) === draft.idempotency_key);
  if (duplicate) {
    state.skipped_targets.push(skip(target, "DUPLICATE_INTENT_EXISTS", { order_intent_id: intentId(duplicate), idempotency_key: draft.idempotency_key }));
    return;
  }
  const conflict = context.existing.find((intent) => sameTargetKey(intent, target));
  if (conflict && !context.policy.allow_cancel_replace) {
    state.skipped_targets.push(skip(target, "ACTIVE_INTENT_EXISTS", { order_intent_id: intentId(conflict) }));
    return;
  }
  const intent = conflict ? { ...draft, replaces_order_intent_id: intentId(conflict), lifecycle_action: "CANCEL_REPLACE" } : draft;
  if (conflict) state.cancel_replace_requests.push(cancelReplaceRequest(conflict, intent, target, context.asOf));
  state.order_intents.push(intent);
}

function orderIntentForTarget(target, { asOf, policy, input }) {
  const current = finite(firstDefined(target.current_net_size, target.currentNetSize)) || 0;
  const targetSize = finite(firstDefined(target.net_target_size, target.netTargetSize)) || 0;
  const delta = finite(firstDefined(target.delta_size, target.deltaSize, targetSize - current)) || 0;
  const rawQuantity = Math.abs(delta);
  if (!rawQuantity) return { skip_reason: "NO_DELTA" };
  const authorityIssues = targetAuthorityIssues(target, { targetSize });
  if (authorityIssues.length) return { skip_reason: authorityIssues[0], authority_issues: authorityIssues };
  const quantity = Math.ceil(rawQuantity);
  const action = delta > 0 ? "BUY" : "SELL";
  const approvedTradePlan = approvedTradePlanForTarget(target);
  const orderTypeValue = orderTypeForTarget(approvedTradePlan, policy);
  const tifValue = timeInForceForTarget(approvedTradePlan, policy);
  const entry = entryForTradePlan(approvedTradePlan);
  const targets = targetsForTradePlan(approvedTradePlan);
  const protection = protectionPlan(firstDefined(target.protection_plan, protectionFromTradePlan(approvedTradePlan), input.default_protection_plan, policy.default_protection_plan), policy);
  const contract = contractRef(target, firstDefined(input.provider_contracts, input.contracts, policy.provider_contracts), policy);
  const idempotencyKey = canonicalSha256({ target_position_id: target.id, account_id: accountId(target, policy), instrument: instrument(target), targetSize, current, delta, quantity, action, contract, order_type: orderTypeValue, time_in_force: tifValue, entry, protection, targets, policy: policyHashScope(policy) });
  const brokerAccount = brokerAccountId(target, policy);
  const base = {
    schema_version: ORDER_INTENT_SCHEMA_VERSION_V1,
    order_intent_id: `portfolio_order_intent_${idempotencyKey.slice(0, 24)}`,
    target_position_id: text(target.id),
    account_id: accountId(target, policy),
    broker_account_id: brokerAccount,
    instrument: instrument(target),
    provider_id: policy.provider_id,
    provider_contract_ref: contract,
    action,
    quantity,
    side: action,
    order_type: orderTypeValue,
    time_in_force: tifValue,
    lifecycle_action: lifecycleAction(current, targetSize, delta),
    current_net_size: round(current),
    target_net_size: round(targetSize),
    delta_size: round(delta),
    closing_size: round(closingSize(current, delta)),
    opening_size: round(openingSize(current, targetSize)),
    status: protection.ready ? "READY" : "PROTECTION_REQUIRED",
    broker_submission_allowed: protection.ready && policy.submission_enabled,
    entry,
    targets,
    approved_trade_plan: approvedTradePlan || null,
    risk_allocation: target.risk_allocation || null,
    expected_exposure: target.expected_exposure || null,
    protection,
    execution_terms: executionTermsForIntent({ target, action, quantity, orderTypeValue, tifValue, entry, protection, targets, brokerAccount }),
    risk_snapshot: riskSnapshotForTarget(target),
    idempotency_key: idempotencyKey,
    requested_at_utc: asOf,
    source: {
      kind: "TARGET_POSITION",
      target_position_id: text(target.id),
      risk_decision_ids: array(target.derived_from_risk_decision_ids),
      candidate_allocation_ids: array(target.candidate_allocation_ids),
      lineage: target.lineage || null,
    },
    audit: {
      direct_llm_order: false,
      derived_from_netting_engine: true,
      quantity_rounding: { mode: "ceil", raw_quantity: round(rawQuantity), quantity, rounding_excess: round(quantity - rawQuantity) },
      post_risk_immutable_fields: ["account_id", "instrument", "action", "quantity", "order_type", "entry", "protection.stop_price", "targets"],
    },
  };
  const immutability = postRiskImmutability(base);
  return { ...base, immutability, immutable_terms_hash: immutability.immutable_terms_hash, order_intent_hash: hash({ ...base, immutability }) };
}

function normalizePolicy(input) {
  const policy = record(input) || {};
  return {
    provider_id: text(firstDefined(policy.provider_id, "provider-neutral")),
    account_id: text(policy.account_id),
    broker_account_id: text(policy.broker_account_id),
    broker_account_ids: normalizeBrokerAccountMap(firstDefined(policy.broker_account_ids, policy.brokerAccountIds, policy.account_broker_map, policy.accountBrokerMap, {})),
    order_type: upper(firstDefined(policy.order_type, "MARKET")),
    time_in_force: upper(firstDefined(policy.time_in_force, "DAY")),
    allow_cancel_replace: firstDefined(policy.allow_cancel_replace, true) !== false,
    submission_enabled: firstDefined(policy.submission_enabled, false) === true,
    require_protection: firstDefined(policy.require_protection, true) !== false,
    require_profit_target: firstDefined(policy.require_profit_target, true) !== false,
    provider_contracts: firstDefined(policy.provider_contracts, {}),
    default_protection_plan: firstDefined(policy.default_protection_plan, null),
  };
}

function protectionPlan(input, policy) {
  const source = record(input) || {};
  const stop = finite(firstDefined(source.stop_price, source.protective_stop));
  const target = finite(firstDefined(source.target_price, source.profit_target));
  const missing = [];
  if (policy.require_protection && stop === null) missing.push("STOP_PRICE_REQUIRED");
  if (policy.require_protection && policy.require_profit_target && target === null) missing.push("TARGET_PRICE_REQUIRED");
  return {
    required: policy.require_protection,
    ready: missing.length === 0,
    missing,
    stop_price: stop,
    target_price: target,
    max_slippage_ticks: positiveOrNull(source.max_slippage_ticks),
    oco_required: firstDefined(source.oco_required, true) !== false,
  };
}

function approvedTradePlanForTarget(target) {
  const plan = record(firstDefined(target.approved_trade_plan, target.approvedTradePlan));
  if (!plan || plan.availability === "UNAVAILABLE") return null;
  return plan;
}

function orderTypeForTarget(plan, policy) {
  return upper(firstDefined(plan?.order_type, plan?.orderType, policy.order_type, "MARKET"));
}

function timeInForceForTarget(plan, policy) {
  return upper(firstDefined(plan?.time_in_force, plan?.timeInForce, policy.time_in_force, "DAY"));
}

function entryForTradePlan(plan) {
  const entry = record(plan?.entry) || {};
  return {
    availability: text(entry.availability || (entry.price !== undefined ? "KNOWN" : "UNAVAILABLE")),
    type: text(entry.type || "PRICE"),
    price: finite(firstDefined(entry.price, entry.calculation_price)),
    low: finite(entry.low),
    high: finite(entry.high),
    unit: "PRICE",
  };
}

function targetsForTradePlan(plan) {
  return array(plan?.targets).map((item, index) => ({
    label: text(firstDefined(item.label, `T${index + 1}`)),
    price: finite(item.price),
    expected_r: finite(firstDefined(item.expected_r, item.expectedR)),
    reward_risk: finite(firstDefined(item.reward_risk, item.rewardRisk)),
    availability: text(item.availability || "PARTIAL"),
  }));
}

function protectionFromTradePlan(plan) {
  if (!plan) return null;
  const stopPrice = finite(record(plan.stop)?.price);
  const firstTarget = targetsForTradePlan(plan).find((item) => item.price !== null);
  if (stopPrice === null && !firstTarget) return null;
  return {
    stop_price: stopPrice,
    target_price: firstTarget?.price ?? null,
    targets: targetsForTradePlan(plan),
    source: "APPROVED_TRADE_PLAN",
  };
}

function executionTermsForIntent({ target, action, quantity, orderTypeValue, tifValue, entry, protection, targets, brokerAccount }) {
  return {
    account_id: accountId(target, {}),
    broker_account_id: brokerAccount,
    instrument: instrument(target),
    side: action,
    quantity,
    order_type: orderTypeValue,
    entry,
    stop: { availability: protection.stop_price === null ? "UNAVAILABLE" : "KNOWN", price: protection.stop_price },
    targets,
    time_in_force: tifValue,
  };
}

function riskSnapshotForTarget(target) {
  const allocation = record(target.risk_allocation) || {};
  const tradeRisk = record(target.approved_trade_plan?.economics) || {};
  return {
    requested_qty: target.risk_approved_net_size ?? target.net_target_size,
    authorized_qty: target.risk_approved_net_size ?? target.net_target_size,
    requested_risk_pct: allocation.risk_pct ?? null,
    authorized_risk_pct: allocation.risk_pct ?? null,
    risk_amount: allocation.risk_amount ?? null,
    risk_per_contract: allocation.risk_per_contract ?? tradeRisk.risk_per_contract ?? null,
    stop_distance: {
      points: tradeRisk.stop_distance_points ?? null,
      ticks: tradeRisk.stop_distance_ticks ?? null,
    },
    nearest_limit: target.nearest_limit || null,
    reason_codes: array(target.risk_decision_statuses),
  };
}

function postRiskImmutability(intent) {
  const immutableTerms = {
    account_id: intent.account_id,
    broker_account_id: intent.broker_account_id,
    instrument: intent.instrument,
    action: intent.action,
    quantity: intent.quantity,
    order_type: intent.order_type,
    time_in_force: intent.time_in_force,
    entry: intent.entry,
    protection: {
      stop_price: intent.protection?.stop_price ?? null,
      target_price: intent.protection?.target_price ?? null,
    },
    targets: intent.targets,
  };
  return {
    policy: "REJECT_AND_REPLAN",
    mutable_after_risk: false,
    immutable_fields: Object.keys(immutableTerms),
    immutable_terms: immutableTerms,
    immutable_terms_hash: hash(immutableTerms),
  };
}

function contractRef(target, contractsInput, policy) {
  const symbol = instrument(target);
  const contracts = normalizeContracts(contractsInput);
  const contract = contracts.get(symbol) || {};
  return {
    provider_id: text(firstDefined(contract.provider_id, policy.provider_id)),
    provider_contract_id: text(firstDefined(contract.provider_contract_id, contract.broker_contract_id, contract.id)),
    provider_symbol: text(firstDefined(contract.provider_symbol, contract.broker_symbol, contract.symbol, symbol)),
    instrument: symbol,
  };
}

function normalizeContracts(input) {
  if (Array.isArray(input)) return new Map(input.map((item) => [upper(item.instrument || item.symbol), item]));
  const source = record(input) || {};
  return new Map(Object.entries(source).map(([key, value]) => [upper(key), record(value) || { provider_symbol: value }]));
}

function activeOrderIntents(input) {
  return array(input).filter((intent) => !terminalStatuses().has(upper(intent.status || intent.approval_status)));
}

function cancelReplaceRequest(conflict, replacement, target, asOf) {
  const base = {
    cancel_replace_id: `cancel_replace_${canonicalSha256({ old: intentId(conflict), next: replacement.order_intent_id }).slice(0, 24)}`,
    stale_order_intent_id: intentId(conflict),
    replacement_order_intent_id: replacement.order_intent_id,
    account_id: accountId(target, {}),
    instrument: instrument(target),
    reason: "TARGET_POSITION_CHANGED",
    requested_at_utc: asOf,
  };
  return { ...base, cancel_replace_hash: hash(base) };
}

function lifecycleAction(current, target, delta) {
  if (current === 0) return "OPEN";
  if (target === 0) return "CLOSE";
  if (Math.sign(current) !== Math.sign(target)) return "REVERSE";
  return Math.abs(target) > Math.abs(current) ? "INCREASE" : "REDUCE";
}

function openingSize(current, target) {
  if (current === 0) return Math.abs(target);
  if (Math.sign(current) !== Math.sign(target)) return Math.abs(target);
  return Math.max(0, Math.abs(target) - Math.abs(current));
}

function closingSize(current, delta) {
  if (current === 0) return 0;
  if (Math.sign(current) === Math.sign(delta)) return 0;
  return Math.min(Math.abs(current), Math.abs(delta));
}

function planStatus(state) {
  if (state.order_intents.length && state.cancel_replace_requests.length) return "CANCEL_REPLACE_READY";
  if (state.order_intents.length) return "ORDER_INTENTS_READY";
  if (state.skipped_targets.length) return "NO_ORDER_INTENTS";
  return "NO_TARGETS";
}

function targetPositions(input) { return array(firstDefined(input.target_positions, record(input.target_position_plan)?.target_positions)); }
function targetAuthorityIssues(target, { targetSize }) {
  const issues = [];
  if (target.schema_version !== TARGET_POSITION_SCHEMA_VERSION_V1) issues.push("TARGET_POSITION_SCHEMA_REQUIRED");
  if (!text(target.id)) issues.push("TARGET_POSITION_ID_REQUIRED");
  if (!array(target.candidate_allocation_ids).length) issues.push("PORTFOLIO_ARBITRATION_LINEAGE_REQUIRED");
  if (!array(target.derived_from_risk_decision_ids).filter(Boolean).length) issues.push("GLOBAL_RISK_DECISION_REQUIRED");
  const approvedTarget = finite(firstDefined(target.risk_approved_net_size, target.approved_net_target_size));
  if (approvedTarget === null) issues.push("RISK_APPROVED_TARGET_REQUIRED");
  else if (round(approvedTarget) !== round(targetSize)) issues.push("RISK_APPROVED_TARGET_MUTATED");
  issues.push(...approvedTradePlanDirectionIssues(target, targetSize));
  return issues;
}
function approvedTradePlanDirectionIssues(target, targetSize) {
  const plan = record(firstDefined(target.approved_trade_plan, target.approvedTradePlan));
  const expectedDirection = directionFromSignedSize(targetSize);
  const targetDirection = upper(target.net_direction);
  if (targetDirection && !["LONG", "SHORT", "FLAT"].includes(targetDirection)) return ["TARGET_POSITION_DIRECTION_INVALID"];
  if (targetDirection && targetDirection !== expectedDirection) return ["TARGET_POSITION_DIRECTION_MISMATCH"];
  if (!plan || plan.availability === "UNAVAILABLE" || expectedDirection === "FLAT") return [];
  const planDirections = [plan.side, plan.direction, plan.economics?.direction]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map(upper);
  if (!planDirections.length || planDirections.some((direction) => !["LONG", "SHORT"].includes(direction))) {
    return ["APPROVED_TRADE_PLAN_DIRECTION_INVALID"];
  }
  if (new Set(planDirections).size !== 1 || planDirections[0] !== expectedDirection) {
    return ["APPROVED_TRADE_PLAN_DIRECTION_MISMATCH"];
  }
  return [];
}
function directionFromSignedSize(value) {
  if (value > 0) return "LONG";
  if (value < 0) return "SHORT";
  return "FLAT";
}
function sameTargetKey(intent, target) { return upper(firstDefined(intent.instrument, intent.provider_contract_ref?.instrument)) === instrument(target) && text(firstDefined(intent.account_id, intent.broker_account_id)) === accountId(target, {}); }
function targetKey(target) { return `${accountId(target, {})}:${instrument(target)}`; }
function accountId(target, policy) { return text(firstDefined(target.account_id, target.accountId, policy.account_id, "default")); }
function brokerAccountId(target, policy) {
  const targetAccount = accountId(target, policy);
  const explicit = text(target.broker_account_id);
  if (explicit) return explicit;
  const mapped = text(policy.broker_account_ids?.[targetAccount]);
  if (mapped) return mapped;
  const policyAccount = text(policy.account_id);
  const defaultBroker = text(policy.broker_account_id);
  if (defaultBroker && (targetAccount === defaultBroker || targetAccount === policyAccount || (!policyAccount && targetAccount === "default"))) return defaultBroker;
  return targetAccount;
}
function instrument(target) { return upper(target.instrument); }
function intentId(intent) { return text(firstDefined(intent.order_intent_id, intent.id)); }
function skip(target, reason, extra = {}) { return { target_position_id: text(target.id), account_id: accountId(target, {}), instrument: instrument(target), reason, ...extra }; }
function policyHashScope(policy) { return { provider_id: policy.provider_id, broker_account_id: policy.broker_account_id, broker_account_ids: policy.broker_account_ids, order_type: policy.order_type, time_in_force: policy.time_in_force, require_protection: policy.require_protection, require_profit_target: policy.require_profit_target }; }
function terminalStatuses() { return new Set(["REJECTED", "CANCELLED", "CANCELED", "EXPIRED", "FILLED", "DONE", "COMPLETED", "FAILED"]); }
function normalizeBrokerAccountMap(input) {
  const source = record(input) || {};
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [text(key), text(value)]).filter(([key, value]) => key && value));
}
function hash(value) { return `sha256:${canonicalSha256(value)}`; }
function array(value) { return Array.isArray(value) ? value : []; }
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
function firstDefined(...values) { return values.find((value) => value !== undefined && value !== null && value !== "") ?? null; }
function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function finite(value) { if (value === null || value === undefined || value === "" || typeof value === "boolean" || typeof value === "object") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function positiveOrNull(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : null; }
function iso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function round(value) { return Math.round(Number(value || 0) * 10000) / 10000; }
