const TERMINAL_SETUP_STATES = new Set([
  "TRIGGERED",
  "CANCELLED",
  "EXPIRED",
  "INVALIDATED",
  "REPLACED",
]);

export const SETUP_STATES_V1 = Object.freeze({
  NONE: "NONE",
  SETUP_CANDIDATE: "SETUP_CANDIDATE",
  PRE_ARMED: "PRE_ARMED",
  ARMED_CONDITIONAL: "ARMED_CONDITIONAL",
  TRIGGERED: "TRIGGERED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  INVALIDATED: "INVALIDATED",
  REPLACED: "REPLACED",
});

export const SETUP_COMMANDS_V1 = Object.freeze({
  NOOP: "NOOP",
  UPSERT_CANDIDATE: "UPSERT_CANDIDATE",
  PRE_ARM: "PRE_ARM",
  ARM: "ARM",
  CANCEL: "CANCEL",
  EXPIRE: "EXPIRE",
  INVALIDATE: "INVALIDATE",
  REPLACE: "REPLACE",
  ENGINE_TRIGGER: "ENGINE_TRIGGER",
});

const TRANSITIONS = Object.freeze({
  NONE: Object.freeze({
    NOOP: "NONE",
    UPSERT_CANDIDATE: "SETUP_CANDIDATE",
    PRE_ARM: "PRE_ARMED",
    ARM: "ARMED_CONDITIONAL",
  }),
  SETUP_CANDIDATE: Object.freeze({
    NOOP: "SETUP_CANDIDATE",
    UPSERT_CANDIDATE: "SETUP_CANDIDATE",
    PRE_ARM: "PRE_ARMED",
    ARM: "ARMED_CONDITIONAL",
    CANCEL: "CANCELLED",
    EXPIRE: "EXPIRED",
    INVALIDATE: "INVALIDATED",
    REPLACE: "REPLACED",
  }),
  PRE_ARMED: Object.freeze({
    NOOP: "PRE_ARMED",
    UPSERT_CANDIDATE: "PRE_ARMED",
    PRE_ARM: "PRE_ARMED",
    ARM: "ARMED_CONDITIONAL",
    CANCEL: "CANCELLED",
    EXPIRE: "EXPIRED",
    INVALIDATE: "INVALIDATED",
    REPLACE: "REPLACED",
  }),
  ARMED_CONDITIONAL: Object.freeze({
    NOOP: "ARMED_CONDITIONAL",
    ARM: "ARMED_CONDITIONAL",
    CANCEL: "CANCELLED",
    EXPIRE: "EXPIRED",
    INVALIDATE: "INVALIDATED",
    REPLACE: "REPLACED",
    ENGINE_TRIGGER: "TRIGGERED",
  }),
  TRIGGERED: Object.freeze({ NOOP: "TRIGGERED" }),
  CANCELLED: Object.freeze({ NOOP: "CANCELLED" }),
  EXPIRED: Object.freeze({ NOOP: "EXPIRED" }),
  INVALIDATED: Object.freeze({ NOOP: "INVALIDATED" }),
  REPLACED: Object.freeze({ NOOP: "REPLACED" }),
});

export function transitionSetupStateV1({
  currentState = SETUP_STATES_V1.NONE,
  command = SETUP_COMMANDS_V1.NOOP,
  authority = "GPT",
} = {}) {
  const previousState = normalizeEnum(currentState);
  const normalizedCommand = normalizeEnum(command);
  if (!Object.hasOwn(TRANSITIONS, previousState)) {
    return transitionResult(false, previousState, null, normalizedCommand, "UNKNOWN_SETUP_STATE");
  }
  if (!Object.hasOwn(SETUP_COMMANDS_V1, normalizedCommand)) {
    return transitionResult(false, previousState, null, normalizedCommand, "UNKNOWN_SETUP_COMMAND");
  }
  if (normalizedCommand === SETUP_COMMANDS_V1.ENGINE_TRIGGER && normalizeEnum(authority) !== "ENGINE") {
    return transitionResult(false, previousState, null, normalizedCommand, "ENGINE_AUTHORITY_REQUIRED");
  }
  if (TERMINAL_SETUP_STATES.has(previousState) && normalizedCommand !== SETUP_COMMANDS_V1.NOOP) {
    return transitionResult(false, previousState, null, normalizedCommand, "TERMINAL_SETUP_IMMUTABLE");
  }
  const nextState = TRANSITIONS[previousState][normalizedCommand];
  if (!nextState) {
    return transitionResult(false, previousState, null, normalizedCommand, "INVALID_SETUP_TRANSITION");
  }
  return transitionResult(true, previousState, nextState, normalizedCommand, "APPLIED");
}

function transitionResult(accepted, previousState, nextState, command, reason) {
  return {
    schema_version: "setup_transition_v1",
    domain: "setup",
    accepted,
    previous_state: previousState,
    next_state: nextState,
    command,
    reason,
    terminal: Boolean(nextState && TERMINAL_SETUP_STATES.has(nextState)),
  };
}

function normalizeEnum(value) {
  return String(value || "").trim().toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
}
