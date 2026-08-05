const TERMINAL_THESIS_STATES = new Set(["INVALIDATED", "EXPIRED", "SUPERSEDED"]);

export const THESIS_STATES_V1 = Object.freeze({
  NO_ACTIVE: "NO_ACTIVE",
  WAIT_MONITORED: "WAIT_MONITORED",
  CONDITIONAL: "CONDITIONAL",
  ACTIVE: "ACTIVE",
  WEAKENED: "WEAKENED",
  AT_RISK: "AT_RISK",
  POST_EVENT: "POST_EVENT",
  INVALIDATED: "INVALIDATED",
  EXPIRED: "EXPIRED",
  REPLAN_REQUIRED: "REPLAN_REQUIRED",
  SUPERSEDED: "SUPERSEDED",
});

export const THESIS_COMMANDS_V1 = Object.freeze({
  NOOP: "NOOP",
  CREATE_WAIT: "CREATE_WAIT",
  MAKE_CONDITIONAL: "MAKE_CONDITIONAL",
  ACTIVATE: "ACTIVATE",
  MAINTAIN: "MAINTAIN",
  WEAKEN: "WEAKEN",
  MARK_AT_RISK: "MARK_AT_RISK",
  MARK_POST_EVENT: "MARK_POST_EVENT",
  INVALIDATE: "INVALIDATE",
  EXPIRE: "EXPIRE",
  REQUIRE_REPLAN: "REQUIRE_REPLAN",
  SUPERSEDE: "SUPERSEDE",
});

const STATE_ALIASES = Object.freeze({
  NO_ACTIVE_THESIS: "NO_ACTIVE",
  THESIS_ACTIVE: "ACTIVE",
  THESIS_CONDITIONAL: "CONDITIONAL",
  THESIS_WEAKENED: "WEAKENED",
  THESIS_AT_RISK: "AT_RISK",
  POST_EVENT_REPLAN_ONLY: "POST_EVENT",
  REPLAN: "REPLAN_REQUIRED",
  SETUP_CANDIDATE: "CONDITIONAL",
  SETUP_ARMED: "ACTIVE",
  SETUP_TRIGGERED: "ACTIVE",
});

const TRANSITIONS = Object.freeze({
  NO_ACTIVE: Object.freeze({
    NOOP: "NO_ACTIVE",
    CREATE_WAIT: "WAIT_MONITORED",
    MAKE_CONDITIONAL: "CONDITIONAL",
    ACTIVATE: "ACTIVE",
    REQUIRE_REPLAN: "REPLAN_REQUIRED",
  }),
  WAIT_MONITORED: Object.freeze({
    NOOP: "WAIT_MONITORED",
    CREATE_WAIT: "WAIT_MONITORED",
    MAKE_CONDITIONAL: "CONDITIONAL",
    ACTIVATE: "ACTIVE",
    MAINTAIN: "WAIT_MONITORED",
    WEAKEN: "WEAKENED",
    MARK_AT_RISK: "AT_RISK",
    MARK_POST_EVENT: "POST_EVENT",
    INVALIDATE: "INVALIDATED",
    EXPIRE: "EXPIRED",
    REQUIRE_REPLAN: "REPLAN_REQUIRED",
    SUPERSEDE: "SUPERSEDED",
  }),
  CONDITIONAL: Object.freeze({
    NOOP: "CONDITIONAL",
    MAKE_CONDITIONAL: "CONDITIONAL",
    ACTIVATE: "ACTIVE",
    MAINTAIN: "CONDITIONAL",
    WEAKEN: "WEAKENED",
    MARK_AT_RISK: "AT_RISK",
    MARK_POST_EVENT: "POST_EVENT",
    INVALIDATE: "INVALIDATED",
    EXPIRE: "EXPIRED",
    REQUIRE_REPLAN: "REPLAN_REQUIRED",
    SUPERSEDE: "SUPERSEDED",
  }),
  ACTIVE: Object.freeze({
    NOOP: "ACTIVE",
    MAKE_CONDITIONAL: "CONDITIONAL",
    ACTIVATE: "ACTIVE",
    MAINTAIN: "ACTIVE",
    WEAKEN: "WEAKENED",
    MARK_AT_RISK: "AT_RISK",
    MARK_POST_EVENT: "POST_EVENT",
    INVALIDATE: "INVALIDATED",
    EXPIRE: "EXPIRED",
    REQUIRE_REPLAN: "REPLAN_REQUIRED",
    SUPERSEDE: "SUPERSEDED",
  }),
  WEAKENED: Object.freeze({
    NOOP: "WEAKENED",
    MAKE_CONDITIONAL: "CONDITIONAL",
    ACTIVATE: "ACTIVE",
    MAINTAIN: "WEAKENED",
    WEAKEN: "WEAKENED",
    MARK_AT_RISK: "AT_RISK",
    INVALIDATE: "INVALIDATED",
    EXPIRE: "EXPIRED",
    REQUIRE_REPLAN: "REPLAN_REQUIRED",
    SUPERSEDE: "SUPERSEDED",
  }),
  AT_RISK: Object.freeze({
    NOOP: "AT_RISK",
    MAKE_CONDITIONAL: "CONDITIONAL",
    ACTIVATE: "ACTIVE",
    MAINTAIN: "AT_RISK",
    WEAKEN: "WEAKENED",
    MARK_AT_RISK: "AT_RISK",
    INVALIDATE: "INVALIDATED",
    EXPIRE: "EXPIRED",
    REQUIRE_REPLAN: "REPLAN_REQUIRED",
    SUPERSEDE: "SUPERSEDED",
  }),
  POST_EVENT: Object.freeze({
    NOOP: "POST_EVENT",
    MAKE_CONDITIONAL: "CONDITIONAL",
    ACTIVATE: "ACTIVE",
    MAINTAIN: "POST_EVENT",
    INVALIDATE: "INVALIDATED",
    EXPIRE: "EXPIRED",
    REQUIRE_REPLAN: "REPLAN_REQUIRED",
    SUPERSEDE: "SUPERSEDED",
  }),
  REPLAN_REQUIRED: Object.freeze({
    NOOP: "REPLAN_REQUIRED",
    CREATE_WAIT: "WAIT_MONITORED",
    MAKE_CONDITIONAL: "CONDITIONAL",
    ACTIVATE: "ACTIVE",
    REQUIRE_REPLAN: "REPLAN_REQUIRED",
    INVALIDATE: "INVALIDATED",
    EXPIRE: "EXPIRED",
    SUPERSEDE: "SUPERSEDED",
  }),
  INVALIDATED: Object.freeze({ NOOP: "INVALIDATED", REQUIRE_REPLAN: "REPLAN_REQUIRED" }),
  EXPIRED: Object.freeze({ NOOP: "EXPIRED", REQUIRE_REPLAN: "REPLAN_REQUIRED" }),
  SUPERSEDED: Object.freeze({ NOOP: "SUPERSEDED" }),
});

export function normalizeThesisStateV1(value) {
  const normalized = normalizeEnum(value || THESIS_STATES_V1.NO_ACTIVE);
  return STATE_ALIASES[normalized] || normalized;
}

export function transitionThesisStateV1({
  currentState = THESIS_STATES_V1.NO_ACTIVE,
  command = THESIS_COMMANDS_V1.NOOP,
} = {}) {
  const previousState = normalizeThesisStateV1(currentState);
  const normalizedCommand = normalizeEnum(command);
  if (!Object.hasOwn(TRANSITIONS, previousState)) {
    return transitionResult(false, previousState, null, normalizedCommand, "UNKNOWN_THESIS_STATE");
  }
  if (!Object.hasOwn(THESIS_COMMANDS_V1, normalizedCommand)) {
    return transitionResult(false, previousState, null, normalizedCommand, "UNKNOWN_THESIS_COMMAND");
  }
  const nextState = TRANSITIONS[previousState][normalizedCommand];
  if (!nextState) {
    return transitionResult(false, previousState, null, normalizedCommand, "INVALID_THESIS_TRANSITION");
  }
  return transitionResult(true, previousState, nextState, normalizedCommand, "APPLIED");
}

function transitionResult(accepted, previousState, nextState, command, reason) {
  return {
    schema_version: "thesis_transition_v1",
    domain: "thesis",
    accepted,
    previous_state: previousState,
    next_state: nextState,
    command,
    reason,
    terminal: Boolean(nextState && TERMINAL_THESIS_STATES.has(nextState)),
  };
}

function normalizeEnum(value) {
  return String(value || "").trim().toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
}
