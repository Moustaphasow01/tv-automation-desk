const TERMINAL_REPLAN_STATES = new Set(["COMPLETED", "CANCELLED"]);

export const REPLAN_STATES_V1 = Object.freeze({
  IDLE: "IDLE",
  REQUESTED: "REQUESTED",
  QUEUED: "QUEUED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
});

export const REPLAN_EVENTS_V1 = Object.freeze({
  NOOP: "NOOP",
  REQUEST: "REQUEST",
  QUEUE: "QUEUE",
  START: "START",
  COMPLETE: "COMPLETE",
  FAIL: "FAIL",
  RETRY: "RETRY",
  CANCEL: "CANCEL",
  RESET: "RESET",
});

const TRANSITIONS = Object.freeze({
  IDLE: Object.freeze({ NOOP: "IDLE", REQUEST: "REQUESTED" }),
  REQUESTED: Object.freeze({
    NOOP: "REQUESTED",
    REQUEST: "REQUESTED",
    QUEUE: "QUEUED",
    START: "IN_PROGRESS",
    CANCEL: "CANCELLED",
  }),
  QUEUED: Object.freeze({
    NOOP: "QUEUED",
    REQUEST: "QUEUED",
    START: "IN_PROGRESS",
    FAIL: "FAILED",
    CANCEL: "CANCELLED",
  }),
  IN_PROGRESS: Object.freeze({
    NOOP: "IN_PROGRESS",
    COMPLETE: "COMPLETED",
    FAIL: "FAILED",
    CANCEL: "CANCELLED",
  }),
  FAILED: Object.freeze({
    NOOP: "FAILED",
    REQUEST: "REQUESTED",
    RETRY: "QUEUED",
    CANCEL: "CANCELLED",
  }),
  COMPLETED: Object.freeze({ NOOP: "COMPLETED", RESET: "IDLE", REQUEST: "REQUESTED" }),
  CANCELLED: Object.freeze({ NOOP: "CANCELLED", RESET: "IDLE", REQUEST: "REQUESTED" }),
});

export function transitionReplanStateV1({
  currentState = REPLAN_STATES_V1.IDLE,
  event = REPLAN_EVENTS_V1.NOOP,
} = {}) {
  const previousState = normalizeEnum(currentState);
  const normalizedEvent = normalizeEnum(event);
  if (!Object.hasOwn(TRANSITIONS, previousState)) {
    return transitionResult(false, previousState, null, normalizedEvent, "UNKNOWN_REPLAN_STATE");
  }
  if (!Object.hasOwn(REPLAN_EVENTS_V1, normalizedEvent)) {
    return transitionResult(false, previousState, null, normalizedEvent, "UNKNOWN_REPLAN_EVENT");
  }
  const nextState = TRANSITIONS[previousState][normalizedEvent];
  if (!nextState) {
    return transitionResult(false, previousState, null, normalizedEvent, "INVALID_REPLAN_TRANSITION");
  }
  return transitionResult(true, previousState, nextState, normalizedEvent, "APPLIED");
}

function transitionResult(accepted, previousState, nextState, event, reason) {
  return {
    schema_version: "replan_transition_v1",
    domain: "replan",
    accepted,
    previous_state: previousState,
    next_state: nextState,
    event,
    reason,
    terminal: Boolean(nextState && TERMINAL_REPLAN_STATES.has(nextState)),
  };
}

function normalizeEnum(value) {
  return String(value || "").trim().toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
}
