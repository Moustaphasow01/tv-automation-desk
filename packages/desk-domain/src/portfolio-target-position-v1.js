import { canonicalSha256 } from "./execution-scope.js";

export const PORTFOLIO_TARGET_POSITION_PLAN_SCHEMA_VERSION_V1 = "portfolio_target_position_plan_v1";
export const TARGET_POSITION_SCHEMA_VERSION_V1 = "target_position_v1";
export const TARGET_POSITION_STATUSES_V1 = Object.freeze(["TARGETED", "FLAT", "NO_APPROVED_SIZE"]);

export function buildPortfolioTargetPositionPlanV1(input = {}) {
  const asOf = iso(firstDefined(input.as_of_utc, input.asOfUtc, new Date().toISOString()));
  const accountId = text(firstDefined(input.account_id, input.accountId, "default"));
  const allocations = array(firstDefined(input.candidate_allocations, input.allocations));
  const risk = normalizeRiskBudgetEvaluation(input.risk_budget_evaluation);
  const currentPositions = normalizeCurrentPositions(firstDefined(input.current_positions, input.positions, []), accountId);
  const legs = allocations.map((allocation) => approvedAllocationLeg(allocation, risk, accountId));
  const targets = buildTargets(legs, currentPositions, asOf);
  const base = {
    schema_version: PORTFOLIO_TARGET_POSITION_PLAN_SCHEMA_VERSION_V1,
    status: targets.length ? "TARGETS_READY" : "NO_TARGETS",
    as_of_utc: asOf,
    account_id: accountId,
    target_positions: targets,
    skipped_allocations: legs.filter((leg) => leg.skip_reason).map((leg) => ({ candidate_allocation_id: leg.candidate_allocation_id, reason: leg.skip_reason })),
  };
  return { ...base, plan_hash: hash(base) };
}

function approvedAllocationLeg(allocation, risk, accountId) {
  const id = text(allocation.id);
  const rawEvaluation = risk.evaluations.get(id);
  const riskIssue = riskDecisionIssue(allocation, rawEvaluation, risk);
  const evaluation = rawEvaluation || {};
  const approved = approvedSize(allocation, evaluation);
  const direction = upper(firstDefined(allocation.net_direction, allocation.direction));
  const riskDecisionStatus = upper(firstDefined(evaluation?.status, allocation.status, "PASS"));
  const riskDecisionReference = riskIssue ? "" : riskDecisionRef(id, evaluation, approved, risk);
  return {
    candidate_allocation_id: id,
    risk_decision_ref: riskDecisionReference,
    risk_decision_status: riskDecisionStatus,
    risk_rule_set_version: text(firstDefined(evaluation?.rule_set_version, risk.rule_set_version)),
    risk_evaluation_hash: risk.evaluation_hash,
    account_id: text(firstDefined(allocation.account_id, allocation.accountId, accountId)),
    instrument: upper(allocation.instrument),
    direction,
    signed_size: signedSize(direction, approved),
    approved_size: approved,
    requested_size: positiveOrZero(firstDefined(allocation.proposed_size, evaluation.requested_size)),
    status: text(firstDefined(evaluation.status, allocation.status, "PASS")),
    strategy_breakdown: strategyBreakdown(allocation, approved),
    approved_trade_plan: approvedTradePlanForAllocation(allocation, approved),
    risk_allocation: riskAllocationForEvaluation({ evaluation, approved, riskDecisionReference }),
    skip_reason: allocationSkipReason(allocation, approved, riskIssue, riskDecisionStatus),
  };
}

function buildTargets(legs, currentPositions, asOf) {
  const groups = groupBy(legs.filter((leg) => !leg.skip_reason), targetKey);
  return [...groups.entries()].sort(byKey).map(([key, items]) => targetForGroup(key, items, currentPositions, asOf));
}

function targetForGroup(key, legs, currentPositions, asOf) {
  const first = legs[0];
  const netTargetSize = round(legs.reduce((total, leg) => total + leg.signed_size, 0));
  const currentNetSize = currentPositions.get(key) || 0;
  const base = {
    schema_version: TARGET_POSITION_SCHEMA_VERSION_V1,
    account_id: first.account_id,
    instrument: first.instrument,
    net_target_size: netTargetSize,
    net_direction: directionFromSignedSize(netTargetSize),
    current_net_size: currentNetSize,
    delta_size: round(netTargetSize - currentNetSize),
    status: netTargetSize === 0 ? "FLAT" : "TARGETED",
    derived_from_risk_decision_ids: legs.map((leg) => leg.risk_decision_ref),
    risk_decision_statuses: legs.map((leg) => leg.risk_decision_status),
    risk_rule_set_versions: unique(legs.map((leg) => leg.risk_rule_set_version).filter(Boolean)),
    risk_evaluation_hashes: unique(legs.map((leg) => leg.risk_evaluation_hash).filter(Boolean)),
    risk_approved_net_size: netTargetSize,
    candidate_allocation_ids: legs.map((leg) => leg.candidate_allocation_id),
    strategy_breakdown: mergeStrategyBreakdown(legs),
    approved_trade_plan: mergeApprovedTradePlans(legs),
    risk_allocation: mergeRiskAllocation(legs),
    expected_exposure: {
      availability: "KNOWN",
      current: currentNetSize,
      resulting: netTargetSize,
      delta: round(netTargetSize - currentNetSize),
      unit: "CONTRACTS",
    },
    lineage: {
      strategy_signal_ids: unique(legs.flatMap((leg) => leg.strategy_breakdown.flatMap((item) => item.signal_ids || [item.signal_id]).filter(Boolean))),
      strategy_instance_ids: unique(legs.flatMap((leg) => leg.strategy_breakdown.map((item) => item.strategy_instance_id).filter(Boolean))),
      candidate_allocation_ids: legs.map((leg) => leg.candidate_allocation_id),
      risk_decision_ids: legs.map((leg) => leg.risk_decision_ref).filter(Boolean),
    },
    computed_at_utc: asOf,
  };
  return { id: `targetpos:${canonicalSha256(base)}`, ...base };
}

function strategyBreakdown(allocation, approved) {
  const signedNetSize = numberOrNull(allocation.net_size);
  const requested = Math.abs(signedNetSize ?? signedSize(upper(firstDefined(allocation.net_direction, allocation.direction)), positiveOrZero(allocation.proposed_size)));
  const approvalRatio = requested > 0 ? approved / requested : 0;
  return array(allocation.contributing_signals).map((signal) => {
    const rawSize = positiveOrZero(signal.proposed_size);
    const signalSignedSize = signedSize(upper(firstDefined(signal.direction, signal.net_direction)), rawSize);
    const signedApprovedSize = round(signalSignedSize * approvalRatio);
    return {
      strategy_instance_id: text(signal.strategy_instance_id),
      signal_id: text(signal.signal_id),
      approved_size: Math.abs(signedApprovedSize),
      signed_size: signedApprovedSize,
    };
  });
}

function mergeStrategyBreakdown(legs) {
  const rows = new Map();
  for (const item of legs.flatMap((leg) => leg.strategy_breakdown)) {
    const key = item.strategy_instance_id || "UNKNOWN";
    const row = rows.get(key) || { strategy_instance_id: key, signal_ids: [], signed_size: 0, approved_size: 0 };
    row.signal_ids.push(item.signal_id);
    row.signed_size = round(row.signed_size + item.signed_size);
    row.approved_size = round(row.approved_size + item.approved_size);
    rows.set(key, row);
  }
  return [...rows.values()].sort((left, right) => left.strategy_instance_id.localeCompare(right.strategy_instance_id));
}

function normalizeRiskBudgetEvaluation(input) {
  const source = record(input) || {};
  const status = upper(source.status);
  const rows = array(source.allocation_evaluations);
  return {
    status,
    evaluation_hash: text(source.evaluation_hash),
    rule_set_version: text(firstDefined(source.rule_set_version, source.budget?.budget_hash, source.budget?.budget_id)),
    available: rows.length > 0 && !["CONFIG_MISSING", "UNAVAILABLE", "ERROR", "FAILED"].includes(status),
    evaluations: new Map(rows.map((row) => [text(row.candidate_allocation_id), row])),
  };
}

function approvedTradePlanForAllocation(allocation, approved) {
  const signals = array(allocation.contributing_signals);
  const netDirection = upper(firstDefined(allocation.net_direction, allocation.direction));
  const directionalSignals = signals.filter((item) => upper(firstDefined(item.direction, item.net_direction, item.proposed_trade_plan?.direction, item.proposedTradePlan?.direction)) === netDirection);
  const planSignals = directionalSignals.length ? directionalSignals : signals;
  const plans = planSignals.map((item) => record(firstDefined(item.proposed_trade_plan, item.proposedTradePlan))).filter(Boolean);
  const plan = plans[0];
  if (!plan) return { availability: "UNAVAILABLE", reason_code: "PROPOSED_TRADE_PLAN_UNAVAILABLE" };
  const authorizedQuantity = round(approved);
  return {
    availability: plans.length === 1 && plan.availability === "KNOWN" ? "KNOWN" : "PARTIAL",
    source_signal_id: text(planSignals[0]?.signal_id),
    side: upper(firstDefined(plan.direction, netDirection)),
    authorized_quantity: authorizedQuantity,
    order_type: text(firstDefined(plan.order_type, "LIMIT")),
    entry: plan.entry || null,
    stop: plan.stop || null,
    targets: array(plan.targets),
    time_in_force: text(firstDefined(plan.time_in_force, "DAY")),
    invalidation: plan.invalidation || null,
    economics: plan.economics || record(firstDefined(signals[0]?.trade_plan_economics, signals[0]?.tradePlanEconomics)) || null,
    immutable_after_risk: true,
    merge_policy: plans.length === 1 ? "SINGLE_SIGNAL" : "FIRST_SIGNAL_PARTIAL",
  };
}

function riskAllocationForEvaluation({ evaluation, approved, riskDecisionReference }) {
  const authorized = record(evaluation.authorized) || {};
  const tradeRisk = record(evaluation.trade_risk) || record(evaluation.risk_economics?.trade_risk) || {};
  return {
    availability: authorized.availability || tradeRisk.availability || "PARTIAL",
    risk_decision_id: text(riskDecisionReference),
    risk_amount: numberOrNull(authorized.risk_amount),
    risk_pct: numberOrNull(authorized.risk_pct),
    risk_per_contract: numberOrNull(tradeRisk.risk_per_contract),
    authorized_quantity: round(approved),
    risk_budget_id: text(firstDefined(evaluation.risk_budget_id, evaluation.riskBudgetId)),
  };
}

function mergeApprovedTradePlans(legs) {
  const plans = legs.map((leg) => leg.approved_trade_plan).filter((item) => item && item.availability !== "UNAVAILABLE");
  if (!plans.length) return { availability: "UNAVAILABLE", reason_code: "APPROVED_TRADE_PLAN_UNAVAILABLE" };
  if (plans.length === 1) return plans[0];
  return {
    availability: "PARTIAL",
    merge_policy: "MULTI_SIGNAL_NETTED",
    authorized_quantity: round(legs.reduce((total, leg) => total + Math.abs(leg.signed_size), 0)),
    plans,
    reason_code: "MULTIPLE_TRADE_PLANS_NETTED",
  };
}

function mergeRiskAllocation(legs) {
  const rows = legs.map((leg) => leg.risk_allocation).filter(Boolean);
  const allKnown = rows.length && rows.every((item) => item.availability === "KNOWN");
  return {
    availability: allKnown ? "KNOWN" : rows.length ? "PARTIAL" : "UNAVAILABLE",
    risk_amount: sumNullable(rows, "risk_amount"),
    risk_pct: sumNullable(rows, "risk_pct"),
    risk_per_contract: rows.length === 1 ? numberOrNull(rows[0].risk_per_contract) : null,
    risk_budget_ids: unique(rows.map((item) => item.risk_budget_id).filter(Boolean)),
    risk_decision_ids: unique(rows.map((item) => item.risk_decision_id).filter(Boolean)),
  };
}

function sumNullable(items, key) {
  const values = items.map((item) => numberOrNull(item[key])).filter((value) => value !== null);
  return values.length ? round(values.reduce((total, value) => total + value, 0)) : null;
}

function normalizeCurrentPositions(items, defaultAccountId) {
  const state = new Map();
  for (const item of array(items)) {
    const key = `${text(firstDefined(item.account_id, item.accountId, defaultAccountId))}:${upper(item.instrument)}`;
    state.set(key, round((state.get(key) || 0) + signedPositionSize(item)));
  }
  return state;
}

function signedPositionSize(item) {
  const explicit = Number(item.signed_size);
  if (Number.isFinite(explicit)) return explicit;
  return signedSize(upper(item.direction), positiveOrZero(firstDefined(item.size, item.quantity, item.contracts)));
}

function approvedSize(allocation, evaluation) {
  const status = upper(firstDefined(evaluation.status, allocation.status, "PASS"));
  if (status === "BLOCK" || status === "NEUTRALIZED") return 0;
  return positiveOrZero(firstDefined(evaluation.approved_size, allocation.approved_size, allocation.proposed_size));
}

function allocationSkipReason(allocation, approved, riskIssue = "", riskStatus = "") {
  if (riskIssue) return riskIssue;
  if (!text(allocation.id)) return "ALLOCATION_ID_MISSING";
  if (!upper(allocation.instrument)) return "INSTRUMENT_MISSING";
  if (approved < 0) return "APPROVED_SIZE_INVALID";
  if (approved === 0) return `RISK_${upper(firstDefined(riskStatus, allocation.status, "BLOCK"))}_NO_APPROVED_SIZE`;
  return "";
}

function riskDecisionIssue(allocation, evaluation, risk) {
  if (isNonExposureAllocation(allocation)) return "";
  if (!risk.available && !evaluation) return "GLOBAL_RISK_UNAVAILABLE";
  if (!evaluation) return "RISK_DECISION_MISSING";
  const status = upper(evaluation.status);
  if (["CONFIG_MISSING", "UNAVAILABLE", "ERROR", "FAILED"].includes(status)) return "GLOBAL_RISK_UNAVAILABLE";
  if (!status) return "RISK_DECISION_STATUS_MISSING";
  return "";
}

function isNonExposureAllocation(allocation) {
  return upper(allocation.status) === "NEUTRALIZED"
    || upper(firstDefined(allocation.net_direction, allocation.direction)) === "FLAT"
    || positiveOrZero(allocation.proposed_size) === 0;
}

function riskDecisionRef(allocationId, evaluation, approved, risk) {
  const explicit = text(firstDefined(evaluation.risk_decision_id, evaluation.riskDecisionId));
  if (explicit) return explicit;
  return `riskeval:${canonicalSha256({ allocationId, approved, status: evaluation.status || "PASS", evaluation_hash: risk.evaluation_hash })}`;
}

function directionFromSignedSize(value) {
  if (value > 0) return "LONG";
  if (value < 0) return "SHORT";
  return "FLAT";
}

function signedSize(direction, size) {
  if (direction === "SHORT") return -Math.abs(size || 0);
  if (direction === "LONG") return Math.abs(size || 0);
  return 0;
}

function targetKey(leg) { return `${leg.account_id}:${leg.instrument}`; }
function hash(value) { return `sha256:${canonicalSha256(value)}`; }
function array(value) { return Array.isArray(value) ? value : []; }
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
function firstDefined(...values) { return values.find((value) => value !== undefined && value !== null && value !== "") ?? null; }
function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function positiveOrZero(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; }
function numberOrNull(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function iso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function round(value) { return Math.round(Number(value || 0) * 10000) / 10000; }
function groupBy(items, selector) {
  return items.reduce((state, item) => {
    const key = selector(item);
    if (!state.has(key)) state.set(key, []);
    state.get(key).push(item);
    return state;
  }, new Map());
}
function byKey(left, right) { return left[0].localeCompare(right[0]); }
function unique(items) { return [...new Set(items)]; }
