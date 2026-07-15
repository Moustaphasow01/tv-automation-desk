import { resultFromIssues } from "./result.js";
import { isPositionThesisStatus } from "./thesis-position-split.js";

export const THESIS_STATES = Object.freeze({
  NO_ACTIVE_THESIS: "NO_ACTIVE_THESIS",
  THESIS_ACTIVE: "THESIS_ACTIVE",
  THESIS_CONDITIONAL: "THESIS_CONDITIONAL",
  WAIT_MONITORED: "WAIT_MONITORED",
  SETUP_ARMED: "SETUP_ARMED",
  SETUP_TRIGGERED: "SETUP_TRIGGERED",
  REPLAN_REQUIRED: "REPLAN_REQUIRED",
  EXPIRED: "EXPIRED",
  INVALIDATED: "INVALIDATED",
});

export const allowedThesisTransitions = Object.freeze({
  NO_ACTIVE_THESIS: ["WAIT_MONITORED", "THESIS_ACTIVE", "THESIS_CONDITIONAL"],
  THESIS_ACTIVE: ["WAIT_MONITORED", "SETUP_ARMED", "REPLAN_REQUIRED", "INVALIDATED", "EXPIRED"],
  THESIS_CONDITIONAL: ["WAIT_MONITORED", "REPLAN_REQUIRED", "EXPIRED"],
  WAIT_MONITORED: ["SETUP_ARMED", "REPLAN_REQUIRED", "INVALIDATED", "EXPIRED"],
  SETUP_ARMED: ["SETUP_TRIGGERED", "EXPIRED", "INVALIDATED", "REPLAN_REQUIRED"],
  SETUP_TRIGGERED: ["SETUP_ARMED", "REPLAN_REQUIRED", "INVALIDATED", "EXPIRED"],
  REPLAN_REQUIRED: ["THESIS_ACTIVE", "THESIS_CONDITIONAL", "NO_ACTIVE_THESIS"],
  EXPIRED: ["NO_ACTIVE_THESIS", "REPLAN_REQUIRED"],
  INVALIDATED: ["REPLAN_REQUIRED", "NO_ACTIVE_THESIS"],
});

export function transitionThesisState({ currentState, nextState, context = {} } = {}) {
  const rawCurrent = normalizeText(currentState);
  const rawNext = normalizeText(nextState);
  const current = normalizeState(currentState);
  const next = normalizeState(nextState);
  const rejectReasons = [];
  const flags = [];
  const evidence = { current_state: current || rawCurrent, next_state: next || rawNext };

  if (isPositionThesisStatus(rawCurrent) || isPositionThesisStatus(rawNext)) {
    return resultFromIssues({
      rejectReasons: ["position_state_requires_position_store"],
      flags: ["STATE_POSITION_SPLIT_REQUIRED"],
      evidence: {
        ...evidence,
        required_collections: ["desk_active_theses", "desk_setups", "desk_positions"],
      },
    });
  }

  if (!current || !next || !allowedThesisTransitions[current]) {
    return resultFromIssues({
      rejectReasons: ["invalid_transition"],
      flags: ["STATE_INVALID_TRANSITION"],
      evidence,
    });
  }

  if (current === next) {
    return resultFromIssues({
      flags: ["STATE_UNCHANGED"],
      evidence: {
        ...evidence,
        accepted_state: next,
        state_unchanged: true,
      },
    });
  }

  if (current === THESIS_STATES.INVALIDATED && [THESIS_STATES.THESIS_ACTIVE, THESIS_STATES.THESIS_CONDITIONAL].includes(next)) {
    return resultFromIssues({
      rejectReasons: ["replan_required"],
      flags: ["STATE_REPLAN_REQUIRED"],
      evidence,
    });
  }

  if (!allowedThesisTransitions[current].includes(next)) {
    return resultFromIssues({
      rejectReasons: ["invalid_transition"],
      flags: ["STATE_INVALID_TRANSITION"],
      evidence,
    });
  }

  if ([THESIS_STATES.THESIS_ACTIVE, THESIS_STATES.THESIS_CONDITIONAL].includes(next)
    && current === THESIS_STATES.REPLAN_REQUIRED
    && !hasAuditEvidence(context)) {
    rejectReasons.push("transition_audit_missing");
    flags.push("STATE_TRANSITION_AUDIT_MISSING");
  }

  return resultFromIssues({
    rejectReasons,
    flags,
    evidence: {
      ...evidence,
      accepted_state: rejectReasons.length === 0 ? next : null,
    },
  });
}

function normalizeState(value) {
  const state = normalizeText(value);
  return Object.prototype.hasOwnProperty.call(THESIS_STATES, state) ? state : "";
}

function hasAuditEvidence(context) {
  return Boolean(context.decisionAudit || context.decision_audit || context.transitionAudit || context.transition_audit || context.auditRef || context.audit_ref);
}

function normalizeText(value) {
  return String(value || "").trim().toUpperCase();
}
