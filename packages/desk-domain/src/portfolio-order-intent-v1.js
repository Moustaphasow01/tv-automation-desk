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
  const protection = protectionPlan(firstDefined(target.protection_plan, input.default_protection_plan, policy.default_protection_plan), policy);
  const contract = contractRef(target, firstDefined(input.provider_contracts, input.contracts, policy.provider_contracts), policy);
  const idempotencyKey = canonicalSha256({ target_position_id: target.id, account_id: accountId(target, policy), instrument: instrument(target), targetSize, current, delta, quantity, action, contract, policy: policyHashScope(policy) });
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
    order_type: policy.order_type,
    time_in_force: policy.time_in_force,
    lifecycle_action: lifecycleAction(current, targetSize, delta),
    current_net_size: round(current),
    target_net_size: round(targetSize),
    delta_size: round(delta),
    closing_size: round(closingSize(current, delta)),
    opening_size: round(openingSize(current, targetSize)),
    status: protection.ready ? "READY" : "PROTECTION_REQUIRED",
    broker_submission_allowed: protection.ready && policy.submission_enabled,
    protection,
    idempotency_key: idempotencyKey,
    requested_at_utc: asOf,
    source: {
      kind: "TARGET_POSITION",
      target_position_id: text(target.id),
      risk_decision_ids: array(target.derived_from_risk_decision_ids),
      candidate_allocation_ids: array(target.candidate_allocation_ids),
    },
    audit: {
      direct_llm_order: false,
      derived_from_netting_engine: true,
      quantity_rounding: { mode: "ceil", raw_quantity: round(rawQuantity), quantity, rounding_excess: round(quantity - rawQuantity) },
    },
  };
  return { ...base, order_intent_hash: hash(base) };
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
  return issues;
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
function finite(value) { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function positiveOrNull(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : null; }
function iso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function round(value) { return Math.round(Number(value || 0) * 10000) / 10000; }
