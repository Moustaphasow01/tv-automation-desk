import { canonicalSha256 } from "./execution-scope.js";

export const PORTFOLIO_EXECUTION_RECONCILIATION_SCHEMA_VERSION_V1 = "portfolio_execution_reconciliation_v1";
export const PORTFOLIO_EXECUTION_RECONCILIATION_STATUSES_V1 = Object.freeze(["PASS", "FILL_INCOMPLETE", "CONTROLLED_DIVERGENCE", "NO_ACTIVITY"]);
export const PORTFOLIO_EXECUTION_CONTROL_CODES_V1 = Object.freeze(["WAIT_FOR_FILLS", "HALT_BROKER_SUBMIT", "RECONCILE_BROKER_SNAPSHOT", "OPERATOR_REVIEW"]);

export function evaluatePortfolioExecutionReconciliationV1(input = {}) {
  const asOf = iso(firstDefined(input.as_of_utc, input.asOfUtc, new Date().toISOString()));
  const intents = activeIntents(firstDefined(input.order_intents, input.active_order_intents, []));
  const fillMap = fillsByIntent(firstDefined(input.broker_fills, input.fills, input.broker_events, []));
  const audits = intents.map((intent) => intentAudit(intent, fillMap));
  const duplicateIssues = duplicateIdempotencyIssues(intents);
  const divergences = positionDivergences({
    targets: targetPositions(input),
    brokerPositions: brokerPositionMap(firstDefined(input.broker_positions, [])),
    outstanding: outstandingDeltas(audits),
  });
  const controls = controlsFor({ audits, duplicateIssues, divergences });
  const base = {
    schema_version: PORTFOLIO_EXECUTION_RECONCILIATION_SCHEMA_VERSION_V1,
    status: statusFor({ audits, duplicateIssues, divergences, controls }),
    as_of_utc: asOf,
    intent_audits: audits,
    duplicate_issues: duplicateIssues,
    divergences,
    controls,
  };
  return { ...base, reconciliation_hash: hash(base) };
}

function intentAudit(intent, fillMap) {
  const quantity = positiveOrZero(intent.quantity);
  const fills = fillMap.get(intentId(intent)) || [];
  const filledQuantity = round(fills.reduce((total, fill) => total + positiveOrZero(firstDefined(fill.quantity, fill.filled_quantity)), 0));
  const remaining = round(Math.max(0, quantity - filledQuantity));
  const status = fillStatus(quantity, filledQuantity);
  return {
    order_intent_id: intentId(intent),
    idempotency_key: text(intent.idempotency_key),
    account_id: text(firstDefined(intent.account_id, intent.broker_account_id)),
    instrument: upper(intent.instrument),
    action: upper(intent.action || (intent.side === "buy" ? "BUY" : "SELL")),
    requested_quantity: quantity,
    filled_quantity: filledQuantity,
    remaining_quantity: remaining,
    status,
    outstanding_signed_delta: signedDelta(intent, remaining),
    fills,
  };
}

function duplicateIdempotencyIssues(intents) {
  const seen = new Map();
  const issues = [];
  for (const intent of intents) {
    const key = text(intent.idempotency_key);
    if (!key) continue;
    const previous = seen.get(key);
    if (previous && intentId(previous) !== intentId(intent)) issues.push({ code: "DUPLICATE_IDEMPOTENCY_KEY", idempotency_key: key, order_intent_ids: [intentId(previous), intentId(intent)].sort() });
    if (!previous) seen.set(key, intent);
  }
  return issues;
}

function positionDivergences({ targets, brokerPositions, outstanding }) {
  const divergences = [];
  for (const target of targets) {
    const key = targetKey(target);
    const broker = brokerPositions.get(key) || 0;
    const pending = outstanding.get(key) || 0;
    const expected = finite(firstDefined(target.net_target_size, target.target_net_size)) || 0;
    const projected = round(broker + pending);
    if (projected !== round(expected)) {
      divergences.push({ code: "BROKER_DESK_POSITION_DIVERGENCE", account_id: accountId(target), instrument: upper(target.instrument), broker_net_size: round(broker), outstanding_delta: round(pending), projected_net_size: projected, expected_target_size: round(expected) });
    }
  }
  return divergences;
}

function outstandingDeltas(audits) {
  const result = new Map();
  for (const audit of audits) {
    const key = `${audit.account_id}:${audit.instrument}`;
    result.set(key, round((result.get(key) || 0) + audit.outstanding_signed_delta));
  }
  return result;
}

function brokerPositionMap(input) {
  const result = new Map();
  for (const position of array(input)) {
    const key = `${text(firstDefined(position.account_id, position.broker_account_id, "default"))}:${upper(position.instrument)}`;
    result.set(key, round((result.get(key) || 0) + signedPosition(position)));
  }
  return result;
}

function fillsByIntent(input) {
  const result = new Map();
  for (const fill of array(input)) {
    const key = text(firstDefined(fill.order_intent_id, fill.intent_id));
    if (!key) continue;
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(normalizeFill(fill));
  }
  return result;
}

function normalizeFill(fill) {
  return {
    fill_id: text(firstDefined(fill.fill_id, fill.broker_fill_id, fill.id)),
    order_intent_id: text(firstDefined(fill.order_intent_id, fill.intent_id)),
    quantity: positiveOrZero(firstDefined(fill.quantity, fill.filled_quantity)),
    price: finite(firstDefined(fill.price, fill.average_fill_price, fill.avg_fill_price)),
    filled_at_utc: iso(firstDefined(fill.filled_at_utc, fill.filled_at, fill.timestamp)),
  };
}

function controlsFor({ audits, duplicateIssues, divergences }) {
  const controls = [];
  if (audits.some((audit) => audit.status === "PARTIALLY_FILLED")) controls.push(control("WAIT_FOR_FILLS", "Partial fills are still outstanding."));
  if (duplicateIssues.length || divergences.length) {
    controls.push(control("HALT_BROKER_SUBMIT", "Execution is halted until reconciliation is clean."));
    controls.push(control("RECONCILE_BROKER_SNAPSHOT", "Refresh provider positions and active orders."));
    controls.push(control("OPERATOR_REVIEW", "Operator review required before new submissions."));
  }
  return controls;
}

function statusFor({ audits, duplicateIssues, divergences, controls }) {
  if (duplicateIssues.length || divergences.length) return "CONTROLLED_DIVERGENCE";
  if (controls.some((item) => item.code === "WAIT_FOR_FILLS")) return "FILL_INCOMPLETE";
  if (!audits.length) return "NO_ACTIVITY";
  return "PASS";
}

function fillStatus(quantity, filled) {
  if (filled > quantity) return "OVERFILLED";
  if (filled === quantity && quantity > 0) return "FILLED";
  if (filled > 0) return "PARTIALLY_FILLED";
  return "PENDING";
}

function activeIntents(input) { return array(input).filter((intent) => !terminalStatuses().has(upper(intent.status || intent.approval_status))); }
function targetPositions(input) { return array(firstDefined(input.target_positions, input.target_position_plan?.target_positions)); }
function signedDelta(intent, quantity) { return upper(intent.action || (intent.side === "buy" ? "BUY" : "SELL")) === "SELL" ? -Math.abs(quantity) : Math.abs(quantity); }
function signedPosition(position) { const explicit = finite(position.signed_size); if (explicit !== null) return explicit; return signedDelta({ action: position.direction === "SHORT" ? "SELL" : "BUY" }, positiveOrZero(firstDefined(position.quantity, position.size, position.contracts))); }
function targetKey(target) { return `${accountId(target)}:${upper(target.instrument)}`; }
function accountId(target) { return text(firstDefined(target.account_id, target.broker_account_id, "default")); }
function intentId(intent) { return text(firstDefined(intent.order_intent_id, intent.id)); }
function control(code, reason) { return { code, reason }; }
function terminalStatuses() { return new Set(["REJECTED", "CANCELLED", "CANCELED", "EXPIRED", "FILLED", "DONE", "COMPLETED", "FAILED"]); }
function hash(value) { return `sha256:${canonicalSha256(value)}`; }
function array(value) { return Array.isArray(value) ? value : []; }
function firstDefined(...values) { return values.find((value) => value !== undefined && value !== null && value !== "") ?? null; }
function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function finite(value) { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function positiveOrZero(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; }
function iso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function round(value) { return Math.round(Number(value || 0) * 10000) / 10000; }
