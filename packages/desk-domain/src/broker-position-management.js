import { canonicalSha256 } from "./execution-scope.js";
import {
  BROKER_EXECUTION_SCHEMA_VERSION,
  SUBMISSION_BRIDGE_MODES,
  brokerExecutionAuthorityMode,
  renderNinjaOifCommand,
  renderNinjaOifManagementCommand,
} from "./broker-execution.js";

export const BROKER_MANAGEMENT_SCHEMA_VERSION = "broker_management_v1";
export const DEFAULT_MANAGEMENT_BREAK_EVEN_AT_R = 0.7;
export const BROKER_MANAGEMENT_ACTIONS = Object.freeze(["move_stop", "reduce_position", "close_position"]);

const MONITOR_ACTIONS = Object.freeze({
  MOVE_STOP_BE: "move_stop",
  TAKE_PARTIAL: "reduce_position",
  REDUCE_RISK: "reduce_position",
  EXIT_POSITION: "close_position",
  INVALIDATE_THESIS: "close_position",
});

export function deriveBrokerManagementRequest({ monitor, trade, mark = null, now = new Date().toISOString(), maxMarkAgeSeconds = 30 } = {}) {
  if (!monitor || !trade) return Object.freeze({ actionable: false, reason: "MONITOR_OR_TRADE_MISSING" });
  const nativeRequest = nativePositionRequest(monitor);
  const sourceAction = nativeRequest
    ? text(nativeRequest.type).toUpperCase()
    : text(monitor.monitor_decision?.decision || monitor.monitor_decision?.action || monitor.action).toUpperCase();
  const check = monitor.position_check || {};
  const request = nativeRequest || {
    type: sourceAction,
    position_id: check.position_id || null,
    reduce_quantity: check.reduce_quantity ?? check.quantity_to_close ?? monitor.monitor_decision?.quantity_to_close,
    reduce_fraction: check.partial_fraction ?? check.reduce_fraction ?? monitor.monitor_decision?.partial_fraction,
    reason: monitor.monitor_decision?.reason_summary || monitor.monitor_decision?.detailed_reason || check.reason || null,
  };
  return evaluatePositionRequestEligibility({
    request,
    position: trade,
    mark,
    now,
    maxMarkAgeSeconds,
    sourceAction,
  });
}

/**
 * Shared fail-closed eligibility boundary for compiled Monitor position requests.
 * GPT requests an action; this evaluator alone decides whether it may be materialized.
 * LIVE must provide a fresh reconciled broker mark. Replay provides an immutable mark.
 */
export function evaluatePositionRequestEligibility({
  request,
  position,
  mark = null,
  now = new Date().toISOString(),
  maxMarkAgeSeconds = 30,
  sourceAction = null,
} = {}) {
  if (!request || !position) return Object.freeze({ actionable: false, reason: "POSITION_REQUEST_OR_POSITION_MISSING" });
  const requestType = text(sourceAction || request.type).toUpperCase();
  const action = MONITOR_ACTIONS[requestType] || null;
  if (!action) return Object.freeze({ actionable: false, reason: "MONITOR_ACTION_NOT_MANAGEMENT", source_action: requestType || null });
  const requestedPositionId = text(request.position_id);
  if (requestedPositionId && requestedPositionId !== text(position.trade_id) && requestedPositionId !== text(position.position_id)) {
    return Object.freeze({
      actionable: false,
      reason: "POSITION_REQUEST_SCOPE_MISMATCH",
      source_action: requestType,
      requested_position_id: requestedPositionId,
      trade_id: text(position.trade_id) || null,
      position_id: text(position.position_id) || null,
    });
  }
  if (!managementPositionOpen(position)) {
    return Object.freeze({ actionable: false, reason: "POSITION_NOT_OPEN", source_action: requestType, action });
  }
  const quantityOpen = managementQuantityOpen(position);
  if (!quantityOpen) return Object.freeze({ actionable: false, reason: "TRADE_QUANTITY_NOT_OPEN", source_action: requestType, action });
  const requestReason = text(request.reason);
  if (action === "move_stop") {
    const entry = finite(position.avg_entry_price ?? position.entry_price ?? position.entry);
    const currentStop = finite(position.current_stop_price ?? position.stop_loss ?? position.stop ?? position.raw?.current_stop_price ?? position.raw?.protective_stop_price);
    const initialStop = finite(position.initial_stop_loss ?? position.initial_stop ?? position.stop_loss_at_entry ?? position.raw?.initial_stop_loss ?? position.raw?.protective_stop_price ?? currentStop);
    const side = managementDirection(position);
    if (entry === null) return Object.freeze({ actionable: false, reason: "TRADE_ENTRY_PRICE_MISSING", source_action: requestType, action });
    if (initialStop === null || !(Math.abs(entry - initialStop) > 0)) {
      return Object.freeze({ actionable: false, reason: "INITIAL_RISK_GEOMETRY_MISSING", source_action: requestType, action });
    }
    if (!side) return Object.freeze({ actionable: false, reason: "POSITION_DIRECTION_UNKNOWN", source_action: requestType, action });
    const requestedStop = entry;
    const alreadyProtected = side === "long"
      ? currentStop !== null && currentStop >= requestedStop
      : currentStop !== null && currentStop <= requestedStop;
    if (alreadyProtected) return Object.freeze({ actionable: false, reason: "BREAK_EVEN_ALREADY_APPLIED", source_action: requestType, action });
    const normalizedMark = managementMark(mark);
    if (normalizedMark.price === null) {
      return Object.freeze({ actionable: false, reason: "MANAGEMENT_MARK_MISSING", source_action: requestType, action });
    }
    if (!normalizedMark.immutable && normalizedMark.reconciled !== true) {
      return Object.freeze({ actionable: false, reason: "BROKER_MARK_NOT_RECONCILED", source_action: requestType, action });
    }
    let markAgeSeconds = null;
    if (!normalizedMark.immutable) {
      const nowMs = Date.parse(now);
      const markMs = Date.parse(normalizedMark.timestamp || "");
      markAgeSeconds = Number.isFinite(nowMs) && Number.isFinite(markMs) ? (nowMs - markMs) / 1000 : null;
      const allowedAge = finite(maxMarkAgeSeconds);
      if (markAgeSeconds === null || markAgeSeconds < -5 || allowedAge === null || allowedAge < 0 || markAgeSeconds > allowedAge) {
        return Object.freeze({ actionable: false, reason: "BROKER_MARK_STALE", source_action: requestType, action, mark_age_seconds: markAgeSeconds });
      }
    }
    const thresholdR = positiveNumber(position.management_policy?.break_even_at_r ?? position.break_even_at_r, DEFAULT_MANAGEMENT_BREAK_EVEN_AT_R);
    const risk = Math.abs(entry - initialStop);
    const thresholdPrice = side === "long" ? entry + risk * thresholdR : entry - risk * thresholdR;
    const thresholdReached = side === "long" ? normalizedMark.price >= thresholdPrice : normalizedMark.price <= thresholdPrice;
    if (!thresholdReached) {
      return Object.freeze({
        actionable: false,
        reason: "BREAK_EVEN_THRESHOLD_NOT_REACHED",
        source_action: requestType,
        action,
        mark_price: normalizedMark.price,
        threshold_price: thresholdPrice,
        break_even_at_r: thresholdR,
      });
    }
    return Object.freeze({
      actionable: true,
      source_action: requestType,
      action,
      requested_stop_price: requestedStop,
      requested_quantity: null,
      mark_price: normalizedMark.price,
      mark_timestamp: normalizedMark.timestamp,
      mark_source: normalizedMark.source,
      mark_age_seconds: markAgeSeconds,
      threshold_price: thresholdPrice,
      break_even_at_r: thresholdR,
      ...(requestReason ? { reason: requestReason } : {}),
    });
  }
  if (action === "reduce_position") {
    const explicit = positiveIntegerOrNull(request.reduce_quantity ?? request.quantity_to_close);
    const fraction = boundedFraction(request.reduce_fraction ?? request.partial_fraction, 0.5);
    const requestedQuantity = explicit || Math.ceil(quantityOpen * fraction);
    if (requestedQuantity >= quantityOpen) {
      return Object.freeze({ actionable: false, reason: quantityOpen === 1 ? "MINIMUM_CONTRACT_NO_PARTIAL" : "REDUCTION_WOULD_CLOSE_POSITION", source_action: requestType, action });
    }
    return Object.freeze({ actionable: true, source_action: requestType, action, requested_quantity: requestedQuantity, requested_stop_price: null, ...(requestReason ? { reason: requestReason } : {}) });
  }
  return Object.freeze({ actionable: true, source_action: requestType, action, requested_quantity: quantityOpen, requested_stop_price: null, ...(requestReason ? { reason: requestReason } : {}) });
}

function managementMark(mark) {
  if (typeof mark === "number") return { price: finite(mark), timestamp: null, reconciled: false, immutable: false, source: null };
  const source = mark && typeof mark === "object" ? mark : {};
  return {
    price: finite(source.price ?? source.mark_price ?? source.last_price ?? source.market_price ?? source.current_price ?? source.close),
    timestamp: text(source.timestamp ?? source.mark_time ?? source.captured_at ?? source.timestamp_utc) || null,
    reconciled: source.reconciled === true,
    immutable: source.immutable === true,
    source: text(source.source ?? source.dataset) || null,
  };
}

function managementQuantityOpen(position = {}) {
  return positiveIntegerOrNull(position.quantity_open ?? position.remaining_quantity ?? position.initial_quantity ?? position.quantity);
}

function managementDirection(position = {}) {
  const value = text(position.side ?? position.direction).toLowerCase();
  if (["long", "buy"].includes(value)) return "long";
  if (["short", "sell"].includes(value)) return "short";
  return null;
}

function managementPositionOpen(position = {}) {
  const status = text(position.status).toUpperCase();
  if (["CLOSED", "STOPPED", "CANCELLED", "CANCELED", "EXPIRED", "REVIEW_REQUIRED", "REJECTED"].includes(status)) return false;
  if (position.closed_at || position.closed_at_utc || position.closed_at_paris || position.exit_reason || (position.exit_price !== undefined && position.exit_price !== null)) return false;
  return ["OPEN", "PROTECTED", "SCALING", "PARTIAL_TAKEN", "PENDING", "RUNNING", "ARMED"].includes(status);
}

function positiveNumber(value, fallback) {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 ? parsed : fallback;
}
function nativePositionRequest(monitor = {}) {
  const compiled = monitor.deterministic_monitor_command?.position_request;
  if (compiled && typeof compiled === "object" && !Array.isArray(compiled) && compiled.type) return compiled;
  const projected = monitor.position_request;
  if (projected && typeof projected === "object" && !Array.isArray(projected) && projected.type) return projected;
  return null;
}
export function createBrokerManagementIntent({ monitor, trade, request, now = new Date().toISOString(), ttlSeconds = 900 } = {}) {
  if (!request?.actionable || !BROKER_MANAGEMENT_ACTIONS.includes(request.action)) throw managementError("MANAGEMENT_REQUEST_INVALID", request?.reason || "A valid management request is required.");
  const sourceDocumentId = requiredText(monitor.monitor_id || monitor.id, "monitor_id");
  const tradeId = requiredText(trade.trade_id, "trade_id");
  const material = {
    schema: BROKER_MANAGEMENT_SCHEMA_VERSION,
    source_collection: "desk_manual_monitors",
    source_document_id: sourceDocumentId,
    trade_id: tradeId,
    action: request.action,
    requested_quantity: request.requested_quantity ?? null,
    requested_stop_price: request.requested_stop_price ?? null,
  };
  const idempotencyKey = canonicalSha256(material);
  return Object.freeze({
    management_intent_id: `management_intent_${idempotencyKey.slice(0, 24)}`,
    trade_id: tradeId,
    source_collection: material.source_collection,
    source_document_id: sourceDocumentId,
    source_action: request.source_action,
    action: request.action,
    status: "draft",
    approval_status: "required",
    expected_trade_revision: nonNegativeInteger(trade.revision),
    requested_quantity: request.requested_quantity ?? null,
    requested_stop_price: request.requested_stop_price ?? null,
    reason: text(request.reason || monitor.monitor_decision?.reason_summary || monitor.monitor_decision?.detailed_reason || monitor.position_check?.reason || request.source_action),
    risk_reducing: true,
    guard_evidence: {},
    command_payload: {},
    idempotency_key: idempotencyKey,
    requested_at: iso(now),
    expires_at: new Date(Date.parse(now) + boundedInteger(ttlSeconds, 900, 30, 3600) * 1000).toISOString(),
  });
}

export function evaluateBrokerManagementPolicy({ intent, trade, provider, account, contract, policy, bridge, locks = [], environment = {}, now = new Date().toISOString() } = {}) {
  const rules = [];
  const add = (code, pass, details = {}) => rules.push({ code, status: pass ? "pass" : "fail", details });
  const nowMs = Date.parse(now);
  const bridgeMs = Date.parse(bridge?.last_seen_at || "");
  const bridgeFresh = Number.isFinite(bridgeMs) && Number.isFinite(nowMs) && nowMs >= bridgeMs
    && nowMs - bridgeMs <= Number(environment.bridgeStaleSeconds || 30) * 1000;
  const accountId = text(account?.broker_account_id);
  const instrument = text(contract?.instrument_code).toUpperCase();
  const quantityOpen = positiveIntegerOrNull(trade?.quantity_open);
  const requestedQuantity = positiveIntegerOrNull(intent?.requested_quantity);
  const newStop = finite(intent?.requested_stop_price);
  const currentStop = finite(trade?.current_stop_price ?? trade?.raw?.current_stop_price ?? trade?.raw?.protective_stop_price);
  const entry = finite(trade?.avg_entry_price);
  const protectiveStopOrderRef = text(trade?.raw?.protective_stop_order_ref);
  const authorityMode = brokerExecutionAuthorityMode(policy);
  const activeLocks = (locks || []).filter((lock) => lock?.locked !== false && (!lock.expires_at || Date.parse(lock.expires_at) > nowMs));
  const matchingLock = activeLocks.find((lock) => lock.scope_type === "global"
    || (lock.scope_type === "account" && lock.scope_value === accountId)
    || (lock.scope_type === "instrument" && text(lock.scope_value).toUpperCase() === instrument)
    || (lock.scope_type === "session" && lock.scope_value === trade?.session));

  add("ENV_EXECUTION_ENABLED", environment.executionEnabled === true);
  add("ENV_KILL_SWITCH_RELEASED", environment.killSwitch === false);
  add("ENV_BRIDGE_MODE_SUBMITS", SUBMISSION_BRIDGE_MODES.includes(environment.bridgeMode), { mode: environment.bridgeMode });
  add("PROVIDER_ENABLED", provider?.broker_provider_code === "ninjatrader" && provider?.enabled === true);
  add("ACCOUNT_ALLOWLIST", environment.accountAllowlist?.includes(accountId), { account_id: accountId });
  add("ACCOUNT_SIM_ONLY", account?.mode === "paper" && /^sim\d*$/i.test(text(bridge?.account_name || account?.metadata?.account_name || "Sim101")));
  add("ACCOUNT_WRITABLE", account?.read_only === false && account?.order_submission_enabled === true);
  add("POLICY_ENABLED", policy?.enabled === true);
  add("POLICY_EXECUTION_AUTHORITY_VALID", ["semi_auto", "auto"].includes(authorityMode), { mode: authorityMode });
  add("MANAGEMENT_AUTOMATION_ALLOWED", ["semi_auto", "auto"].includes(authorityMode), { mode: authorityMode });
  add("POLICY_ACCOUNT_ALLOWED", array(policy?.allowed_accounts).includes(accountId));
  add("POLICY_INSTRUMENT_ALLOWED", array(policy?.allowed_instruments).map((value) => text(value).toUpperCase()).includes(instrument));
  add("POLICY_SESSION_ALLOWED", array(policy?.allowed_sessions).includes(trade?.session));
  add("NO_EXECUTION_LOCK", !matchingLock, matchingLock ? { lock_id: matchingLock.execution_lock_id, reason: matchingLock.reason } : {});
  add("BRIDGE_HEALTHY", ["armed", "healthy"].includes(bridge?.status) && bridgeFresh, { status: bridge?.status, fresh: bridgeFresh });
  const bridgeTransportReady = environment.bridgeMode === "sim101_addon_approved_only"
    ? bridge?.ninja_connected === true && bridge?.adapter_kind === "addon" && bridge?.command_enabled === true
    : bridge?.ninja_connected === true && bridge?.ati_enabled === true;
  add("BRIDGE_CONNECTED", bridgeTransportReady, { adapter_kind: bridge?.adapter_kind || "ati", command_enabled: bridge?.command_enabled === true, ati_enabled: bridge?.ati_enabled === true });
  add("TRADE_OPEN", ["open", "scaling", "protected"].includes(text(trade?.status).toLowerCase()) && quantityOpen !== null);
  add("TRADE_REVISION_MATCH", nonNegativeInteger(trade?.revision) === nonNegativeInteger(intent?.expected_trade_revision), { expected: intent?.expected_trade_revision, current: trade?.revision });
  add("INTENT_NOT_EXPIRED", Date.parse(intent?.expires_at || "") > nowMs);
  add("ACTION_RISK_REDUCING", intent?.risk_reducing === true && BROKER_MANAGEMENT_ACTIONS.includes(intent?.action));
  add("CONTRACT_ACTIVE", contract?.active === true && Boolean(contract?.broker_symbol));

  if (intent?.action === "move_stop") {
    const tightens = trade?.side === "long"
      ? newStop !== null && entry !== null && newStop >= entry && (currentStop === null || newStop >= currentStop)
      : trade?.side === "short"
        ? newStop !== null && entry !== null && newStop <= entry && (currentStop === null || newStop <= currentStop)
        : false;
    add("STOP_REFERENCE_PRESENT", Boolean(protectiveStopOrderRef));
    add("STOP_ONLY_TIGHTENS", tightens, { side: trade?.side, current_stop: currentStop, requested_stop: newStop, entry });
    add("STOP_TICK_ALIGNED", newStop !== null && tickAligned(newStop, contract?.tick_size));
  } else if (intent?.action === "reduce_position") {
    add("REDUCTION_QUANTITY_VALID", requestedQuantity !== null && quantityOpen !== null && requestedQuantity < quantityOpen, { requested: requestedQuantity, open: quantityOpen });
  } else if (intent?.action === "close_position") {
    add("CLOSE_QUANTITY_MATCH", requestedQuantity !== null && requestedQuantity === quantityOpen, { requested: requestedQuantity, open: quantityOpen });
  }

  const violations = rules.filter((rule) => rule.status === "fail");
  return Object.freeze({
    schema_version: BROKER_MANAGEMENT_SCHEMA_VERSION,
    status: violations.length ? "fail" : "pass",
    pass: violations.length === 0,
    rules,
    violations,
    metrics: {
      quantity_open: quantityOpen,
      requested_quantity: requestedQuantity,
      requested_stop_price: newStop,
      execution_authority_mode: authorityMode,
      management_operator_approval_required: false,
      bridge_age_seconds: bridgeFresh ? (nowMs - bridgeMs) / 1000 : null,
    },
  });
}

export function renderBrokerManagementCommand({ intent, trade, contract, accountName = "Sim101" } = {}) {
  if (intent?.action === "move_stop") {
    return renderNinjaOifManagementCommand({
      command: "CHANGE",
      order_id: requiredText(trade?.raw?.protective_stop_order_ref, "protective_stop_order_ref"),
      quantity: positiveInteger(trade?.quantity_open),
      limit_price: 0,
      stop_price: finite(intent.requested_stop_price),
    }, { accountName });
  }
  if (intent?.action === "reduce_position") {
    return renderNinjaOifCommand({
      order_intent_id: intent.management_intent_id,
      payload: {
        broker_symbol: requiredText(contract?.broker_symbol, "broker_symbol"),
        action: trade?.side === "long" ? "SELL" : "BUY",
        quantity: positiveInteger(intent.requested_quantity),
        order_type: "market",
        time_in_force: "DAY",
      },
    }, { accountName });
  }
  if (intent?.action === "close_position") {
    const atmStrategyId = text(trade?.atm_strategy_id || trade?.raw?.atm_strategy_id);
    return atmStrategyId
      ? renderNinjaOifManagementCommand({ command: "CLOSESTRATEGY", strategy_id: atmStrategyId }, { accountName })
      : renderNinjaOifManagementCommand({ command: "CLOSEPOSITION", instrument: requiredText(contract?.broker_symbol, "broker_symbol") }, { accountName });
  }
  throw managementError("MANAGEMENT_ACTION_UNSUPPORTED", `Unsupported broker management action: ${intent?.action}.`);
}

function managementError(code, message) { const error = new Error(message); error.code = code; return error; }
function text(value) { return String(value || "").trim(); }
function finite(value) { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function positiveIntegerOrNull(value) { const parsed = finite(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; }
function positiveInteger(value) { const parsed = positiveIntegerOrNull(value); if (!parsed) throw managementError("POSITIVE_INTEGER_REQUIRED", `A positive integer is required, received ${value}.`); return parsed; }
function nonNegativeInteger(value) { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0; }
function array(value) { return Array.isArray(value) ? value : []; }
function requiredText(value, name) { const result = text(value); if (!result) throw managementError("MANAGEMENT_FIELD_REQUIRED", `${name} is required.`); return result; }
function boundedInteger(value, fallback, minimum, maximum) { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback; }
function boundedFraction(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : fallback; }
function tickAligned(value, tickSize) { const tick = finite(tickSize); return tick !== null && tick > 0 && Math.abs(value / tick - Math.round(value / tick)) < 1e-8; }
function iso(value) { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw managementError("MANAGEMENT_TIMESTAMP_INVALID", `Invalid timestamp: ${value}`); return new Date(parsed).toISOString(); }
