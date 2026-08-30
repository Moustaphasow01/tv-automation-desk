export const HUMAN_EXECUTION_GATE_POLICY_VERSION_V1 = "human_execution_gate_policy_v1";

export const HUMAN_EXECUTION_GATE_STATES_V1 = Object.freeze([
  "AWAITING_MANUAL_CONFIRMATION",
  "CONFIRMED",
  "REJECTED",
  "EXPIRED",
  "INVALIDATED",
  "EXECUTION_BLOCKED",
  "CERTIFICATION_AUTO_APPROVED",
]);

export const HUMAN_EXECUTION_GATE_EVENTS_V1 = Object.freeze([
  "CONFIRM",
  "REJECT",
  "UNDO",
]);

export const DEFAULT_HUMAN_GATE_UNDO_WINDOW_SECONDS_V1 = 10;

export function humanGateUndoDeadlineV1({ decidedAtUtc, gateExpiresAtUtc = null, policy = {} } = {}) {
  const normalized = normalizeHumanGateUndoPolicyV1(policy);
  if (!normalized.enabled) return null;
  const decidedAt = timestamp(decidedAtUtc);
  if (decidedAt === null) return null;
  const policyDeadline = decidedAt + normalized.windowSeconds * 1_000;
  const gateDeadline = timestamp(gateExpiresAtUtc);
  return new Date(gateDeadline === null ? policyDeadline : Math.min(policyDeadline, gateDeadline)).toISOString();
}

export function evaluateHumanGateUndoV1({ gate = {}, nowUtc, expectedRevision = null, providerCommandCount = 0, policy = {} } = {}) {
  const normalized = normalizeHumanGateUndoPolicyV1(policy);
  const state = String(gate.status || "").trim().toUpperCase();
  const now = timestamp(nowUtc);
  const currentRevision = Number(gate.revision || 0);
  const parsedExpectedRevision = expectedRevision === null || expectedRevision === undefined || expectedRevision === ""
    ? null
    : Number(expectedRevision);
  const decidedAtUtc = state === "CONFIRMED" ? gate.confirmed_at_utc : state === "REJECTED" ? gate.rejected_at_utc : null;
  const undoExpiresAtUtc = validIso(gate.undo_expires_at_utc)
    || humanGateUndoDeadlineV1({ decidedAtUtc, gateExpiresAtUtc: gate.expires_at_utc, policy: normalized });

  if (!normalized.enabled) return denied("HUMAN_GATE_UNDO_DISABLED", { state, currentRevision, undoExpiresAtUtc: null, policy: normalized });
  if (!normalized.reversibleStates.includes(state)) return denied("HUMAN_GATE_STATE_NOT_REVERSIBLE", { state, currentRevision, undoExpiresAtUtc, policy: normalized });
  if (now === null) return denied("HUMAN_GATE_UNDO_NOW_INVALID", { state, currentRevision, undoExpiresAtUtc, policy: normalized });
  if (parsedExpectedRevision !== null && (!Number.isInteger(parsedExpectedRevision) || parsedExpectedRevision !== currentRevision)) {
    return denied("HUMAN_GATE_REVISION_CONFLICT", { state, currentRevision, undoExpiresAtUtc, policy: normalized });
  }
  if (Number(providerCommandCount || 0) > 0) return denied("HUMAN_GATE_PROVIDER_COMMAND_EXISTS", { state, currentRevision, undoExpiresAtUtc, policy: normalized });
  const gateExpiry = timestamp(gate.expires_at_utc);
  if (gateExpiry !== null && gateExpiry <= now) return denied("HUMAN_GATE_EXPIRED", { state, currentRevision, undoExpiresAtUtc, policy: normalized });
  const undoExpiry = timestamp(undoExpiresAtUtc);
  if (undoExpiry === null || undoExpiry <= now) return denied("HUMAN_GATE_UNDO_WINDOW_EXPIRED", { state, currentRevision, undoExpiresAtUtc, policy: normalized });
  return {
    allowed: true,
    reason: null,
    state,
    nextState: "AWAITING_MANUAL_CONFIRMATION",
    currentRevision,
    undoExpiresAtUtc,
    policy: normalized,
  };
}

export function normalizeHumanGateUndoPolicyV1(policy = {}) {
  const requestedWindow = Number(policy.windowSeconds ?? policy.window_seconds ?? DEFAULT_HUMAN_GATE_UNDO_WINDOW_SECONDS_V1);
  return {
    schemaVersion: HUMAN_EXECUTION_GATE_POLICY_VERSION_V1,
    enabled: policy.enabled === true,
    windowSeconds: Number.isFinite(requestedWindow) ? Math.max(3, Math.min(60, Math.round(requestedWindow))) : DEFAULT_HUMAN_GATE_UNDO_WINDOW_SECONDS_V1,
    reversibleStates: Object.freeze(["CONFIRMED", "REJECTED"]),
  };
}

function denied(reason, context) {
  return { allowed: false, reason, nextState: null, ...context };
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function validIso(value) {
  const parsed = timestamp(value);
  return parsed === null ? null : new Date(parsed).toISOString();
}
