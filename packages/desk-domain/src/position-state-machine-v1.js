const TERMINAL_POSITION_STATES = new Set(["CLOSED", "STOPPED", "CANCELLED"]);
const ENGINE_ONLY_EVENTS = new Set([
  "SUBMISSION_ACCEPTED",
  "FILL_CONFIRMED",
  "PROTECTION_CONFIRMED",
  "PARTIAL_FILL_CONFIRMED",
  "CLOSE_CONFIRMED",
  "STOP_FILL_CONFIRMED",
  "CANCEL_CONFIRMED",
]);

export const POSITION_STATES_V1 = Object.freeze({
  NONE: "NONE",
  PENDING_SUBMISSION: "PENDING_SUBMISSION",
  OPEN: "OPEN",
  PROTECTED: "PROTECTED",
  PARTIAL_TAKEN: "PARTIAL_TAKEN",
  CLOSED: "CLOSED",
  STOPPED: "STOPPED",
  CANCELLED: "CANCELLED",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
});

export const POSITION_EVENTS_V1 = Object.freeze({
  NOOP: "NOOP",
  SUBMISSION_ACCEPTED: "SUBMISSION_ACCEPTED",
  FILL_CONFIRMED: "FILL_CONFIRMED",
  PROTECTION_CONFIRMED: "PROTECTION_CONFIRMED",
  PARTIAL_FILL_CONFIRMED: "PARTIAL_FILL_CONFIRMED",
  CLOSE_CONFIRMED: "CLOSE_CONFIRMED",
  STOP_FILL_CONFIRMED: "STOP_FILL_CONFIRMED",
  CANCEL_CONFIRMED: "CANCEL_CONFIRMED",
  MARK_REVIEW_REQUIRED: "MARK_REVIEW_REQUIRED",
  RECONCILIATION_RECOVERED: "RECONCILIATION_RECOVERED",
});

export const POSITION_REQUESTS_V1 = Object.freeze({
  NONE: "NONE",
  REDUCE_RISK: "REDUCE_RISK",
  MOVE_STOP_BE: "MOVE_STOP_BE",
  TAKE_PARTIAL: "TAKE_PARTIAL",
  EXIT_POSITION: "EXIT_POSITION",
});

const TRANSITIONS = Object.freeze({
  NONE: Object.freeze({
    NOOP: "NONE",
    SUBMISSION_ACCEPTED: "PENDING_SUBMISSION",
    MARK_REVIEW_REQUIRED: "REVIEW_REQUIRED",
  }),
  PENDING_SUBMISSION: Object.freeze({
    NOOP: "PENDING_SUBMISSION",
    FILL_CONFIRMED: "OPEN",
    CANCEL_CONFIRMED: "CANCELLED",
    MARK_REVIEW_REQUIRED: "REVIEW_REQUIRED",
  }),
  OPEN: Object.freeze({
    NOOP: "OPEN",
    PROTECTION_CONFIRMED: "PROTECTED",
    PARTIAL_FILL_CONFIRMED: "PARTIAL_TAKEN",
    CLOSE_CONFIRMED: "CLOSED",
    STOP_FILL_CONFIRMED: "STOPPED",
    MARK_REVIEW_REQUIRED: "REVIEW_REQUIRED",
  }),
  PROTECTED: Object.freeze({
    NOOP: "PROTECTED",
    PROTECTION_CONFIRMED: "PROTECTED",
    PARTIAL_FILL_CONFIRMED: "PARTIAL_TAKEN",
    CLOSE_CONFIRMED: "CLOSED",
    STOP_FILL_CONFIRMED: "STOPPED",
    MARK_REVIEW_REQUIRED: "REVIEW_REQUIRED",
  }),
  PARTIAL_TAKEN: Object.freeze({
    NOOP: "PARTIAL_TAKEN",
    PROTECTION_CONFIRMED: "PARTIAL_TAKEN",
    PARTIAL_FILL_CONFIRMED: "PARTIAL_TAKEN",
    CLOSE_CONFIRMED: "CLOSED",
    STOP_FILL_CONFIRMED: "STOPPED",
    MARK_REVIEW_REQUIRED: "REVIEW_REQUIRED",
  }),
  REVIEW_REQUIRED: Object.freeze({
    NOOP: "REVIEW_REQUIRED",
    RECONCILIATION_RECOVERED: "OPEN",
    CLOSE_CONFIRMED: "CLOSED",
    STOP_FILL_CONFIRMED: "STOPPED",
    CANCEL_CONFIRMED: "CANCELLED",
  }),
  CLOSED: Object.freeze({ NOOP: "CLOSED" }),
  STOPPED: Object.freeze({ NOOP: "STOPPED" }),
  CANCELLED: Object.freeze({ NOOP: "CANCELLED" }),
});

export function transitionPositionStateV1({
  currentState = POSITION_STATES_V1.NONE,
  event = POSITION_EVENTS_V1.NOOP,
  authority = "ENGINE",
} = {}) {
  const previousState = normalizeEnum(currentState);
  const normalizedEvent = normalizeEnum(event);
  if (!Object.hasOwn(TRANSITIONS, previousState)) {
    return transitionResult(false, previousState, null, normalizedEvent, "UNKNOWN_POSITION_STATE");
  }
  if (!Object.hasOwn(POSITION_EVENTS_V1, normalizedEvent)) {
    return transitionResult(false, previousState, null, normalizedEvent, "UNKNOWN_POSITION_EVENT");
  }
  if (ENGINE_ONLY_EVENTS.has(normalizedEvent) && normalizeEnum(authority) !== "ENGINE") {
    return transitionResult(false, previousState, null, normalizedEvent, "ENGINE_AUTHORITY_REQUIRED");
  }
  if (TERMINAL_POSITION_STATES.has(previousState) && normalizedEvent !== POSITION_EVENTS_V1.NOOP) {
    return transitionResult(false, previousState, null, normalizedEvent, "TERMINAL_POSITION_IMMUTABLE");
  }
  const nextState = TRANSITIONS[previousState][normalizedEvent];
  if (!nextState) {
    return transitionResult(false, previousState, null, normalizedEvent, "INVALID_POSITION_TRANSITION");
  }
  return transitionResult(true, previousState, nextState, normalizedEvent, "APPLIED");
}

function transitionResult(accepted, previousState, nextState, event, reason) {
  return {
    schema_version: "position_transition_v1",
    domain: "position",
    accepted,
    previous_state: previousState,
    next_state: nextState,
    event,
    reason,
    terminal: Boolean(nextState && TERMINAL_POSITION_STATES.has(nextState)),
  };
}

function normalizeEnum(value) {
  return String(value || "").trim().toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
}
