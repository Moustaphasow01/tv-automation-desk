import { parseInstant } from "./instant.js";
import { resultFromIssues } from "./result.js";
import { firstPresent, numberOrNull } from "./setup-shape.js";

export function evaluatePositionManagement({
  position = {},
  action = {},
  rules = {},
  macroEvents = [],
} = {}) {
  const rejectReasons = [];
  const reviewReasons = [];
  const flags = [];
  const actionType = normalizedAction(action);
  const currentR = numberOrNull(firstPresent(
    action.current_r,
    action.unrealized_r,
    position.current_r,
    position.unrealized_r,
    position.r_multiple,
  ));
  const openSize = openPositionSize(position);
  const actionSize = actionCloseSize(action, openSize);
  const beThreshold = numberOrNull(firstPresent(rules.beThresholdR, rules.be_threshold_r, rules.break_even_threshold_r)) ?? 1;
  const majorWindowMinutes = numberOrNull(firstPresent(rules.majorEventWindowMinutes, rules.major_event_window_minutes)) ?? 60;
  const evidence = {
    action: actionType,
    current_r: currentR,
    open_size: openSize,
    action_size: actionSize,
    be_threshold_r: beThreshold,
  };

  if (["break_even", "be"].includes(actionType) && (currentR === null || currentR < beThreshold)) {
    rejectReasons.push("be_threshold_not_reached");
    flags.push("POSITION_BE_THRESHOLD_NOT_REACHED");
  }

  if (["partial", "take_partial", "reduce"].includes(actionType)
    && actionSize !== null
    && openSize !== null
    && actionSize > openSize) {
    rejectReasons.push("partial_size_invalid");
    flags.push("POSITION_PARTIAL_SIZE_INVALID");
  }

  const blockingEvent = imminentMajorEvent(macroEvents, { ...rules, majorWindowMinutes });
  if (isFullRisk(position) && blockingEvent) {
    reviewReasons.push("major_event_full_risk");
    flags.push("POSITION_MAJOR_EVENT_FULL_RISK");
    evidence.major_event = blockingEvent;
  }

  return resultFromIssues({ rejectReasons, reviewReasons, flags, evidence });
}

function normalizedAction(action = {}) {
  return String(firstPresent(action.action, action.management_action, action.type, "hold")).trim().toLowerCase();
}

function openPositionSize(position = {}) {
  return numberOrNull(firstPresent(
    position.open_size,
    position.remaining_size,
    position.size_open,
    position.quantity_open,
    position.quantity,
    position.size,
  ));
}

function actionCloseSize(action = {}, openSize) {
  const direct = numberOrNull(firstPresent(
    action.close_size,
    action.action_size,
    action.size,
    action.quantity,
  ));
  if (direct !== null) return direct;

  const pct = numberOrNull(firstPresent(action.close_pct, action.partial_pct, action.reduce_pct));
  if (pct !== null && openSize !== null) return openSize * (pct > 1 ? pct / 100 : pct);
  return null;
}

function isFullRisk(position = {}) {
  const status = String(position.status || position.position_status || "").toLowerCase();
  if (status.includes("protected") || position.protected === true) return false;
  const remainingRisk = numberOrNull(firstPresent(position.risk_remaining_pct, position.remaining_risk_pct));
  if (remainingRisk !== null) return remainingRisk > 0.75;
  return true;
}

function imminentMajorEvent(events, rules = {}) {
  const windowMinutes = numberOrNull(rules.majorWindowMinutes) ?? 60;
  const nowMs = parseInstant(firstPresent(rules.now_paris, rules.now_utc, rules.now));
  for (const event of events || []) {
    if (!event || typeof event !== "object") continue;
    const importance = String(event.importance || event.impact || "").toLowerCase();
    if (importance && !["high", "major", "red"].includes(importance)) continue;
    const minutesUntil = numberOrNull(firstPresent(event.minutes_until, event.minutesUntil));
    if (minutesUntil !== null && minutesUntil >= 0 && minutesUntil <= windowMinutes) return event;
    const scheduledMs = parseInstant(firstPresent(event.scheduled_at_paris, event.scheduled_at_utc, event.timestamp));
    if (nowMs !== null && scheduledMs !== null) {
      const deltaMinutes = (scheduledMs - nowMs) / 60000;
      if (deltaMinutes >= 0 && deltaMinutes <= windowMinutes) return event;
    }
  }
  return null;
}
