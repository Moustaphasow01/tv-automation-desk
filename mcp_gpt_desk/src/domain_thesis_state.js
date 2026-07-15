import { accepted, transitionThesisState } from "@tv-automation/desk-domain";

const CONTRACT_TO_DOMAIN_STATE = Object.freeze({
  THESIS_INVALIDATED: "INVALIDATED",
  THESIS_WEAKENED: "THESIS_ACTIVE",
  THESIS_AT_RISK: "THESIS_ACTIVE",
});

export function evaluateActiveThesisSave(thesis) {
  return evaluateActiveThesisTransition({
    currentStatus: "NO_ACTIVE_THESIS",
    nextStatus: thesis?.status,
    payload: thesis,
  });
}

export function evaluateActiveThesisUpdate(update, existing = {}) {
  if (!update?.status) {
    return accepted({
      evidence: {
        current_status: existing?.status || null,
        next_status: null,
        status_update: false,
      },
    });
  }

  return evaluateActiveThesisTransition({
    currentStatus: existing?.status || update.previous_status || update.current_status || "NO_ACTIVE_THESIS",
    nextStatus: update.status,
    payload: { ...(existing || {}), ...update },
  });
}

export function assertActiveThesisSavePass(thesis) {
  return assertThesisTransitionPass(evaluateActiveThesisSave(thesis));
}

export function assertActiveThesisUpdatePass(update, existing = {}) {
  return assertThesisTransitionPass(evaluateActiveThesisUpdate(update, existing));
}

function evaluateActiveThesisTransition({ currentStatus, nextStatus, payload }) {
  const currentState = toDomainState(currentStatus);
  const nextState = toDomainState(nextStatus);
  const result = transitionThesisState({
    currentState,
    nextState,
    context: transitionContext(payload),
  });
  return {
    ...result,
    evidence: {
      ...result.evidence,
      current_status: currentStatus || null,
      next_status: nextStatus || null,
      current_domain_state: currentState || null,
      next_domain_state: nextState || null,
    },
  };
}

function assertThesisTransitionPass(result) {
  if (result.status === "rejected") {
    throw new Error(`thesis_state_machine_rejected:${result.reasons.join(",")}`);
  }
  if (result.status === "review_required") {
    throw new Error(`thesis_state_machine_review_required:${result.reasons.join(",")}`);
  }
  return result;
}

function toDomainState(status) {
  const normalized = String(status || "").trim().toUpperCase();
  return CONTRACT_TO_DOMAIN_STATE[normalized] || normalized;
}

function transitionContext(payload = {}) {
  return {
    decisionAudit: payload.decision_audit || payload.decisionAudit || null,
    transitionAudit: payload.transition_audit || payload.transitionAudit || null,
    auditRef: payload.audit_ref || payload.audit_id || payload.linked_audit_id || payload.decision_audit_id || null,
    triggeredSetup: payload.triggered_setup || payload.setup_triggered || null,
    fill_proof: payload.fill_proof || payload.trigger_proof || null,
  };
}
