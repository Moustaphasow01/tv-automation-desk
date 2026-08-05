export const ANALYTICAL_JOURNEY_SCHEMA_VERSION = "desk_analytical_journey_v1";
export const ANALYTICAL_AUDIT_EVENT_SCHEMA_VERSION = "desk_analytical_audit_event_v1";
export const ANALYTICAL_COVERAGE_MATRIX_SCHEMA_VERSION = "desk_analytical_coverage_matrix_v1";
export const ANALYTICAL_DECISION_VALIDATION_SCHEMA_VERSION = "desk_analytical_decision_validation_v1";
export const ANALYTICAL_RESEARCH_PROGRESS_SCHEMA_VERSION =
  "desk_analytical_research_progress_v1";

export const ANALYTICAL_PHASES = Object.freeze([
  "CONTINUITY",
  "CORE_MARKET",
  "INDEX_CONFIRMATION",
  "CROSS_ASSET",
  "MEGACAPS",
  "MACRO",
  "NEWS",
  "THESIS_EVOLUTION",
  "OPPORTUNITY",
  "CONCLUSION",
]);

export const ANALYTICAL_PHASE_STATUSES = Object.freeze([
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLETE",
  "DEGRADED",
  "UNAVAILABLE",
  "BLOCKED",
]);

export const ANALYTICAL_TERMINAL_PHASE_STATUSES = Object.freeze([
  "COMPLETE",
  "DEGRADED",
  "UNAVAILABLE",
  "BLOCKED",
]);

export const ANALYTICAL_EVIDENCE_AVAILABILITIES = Object.freeze([
  "AVAILABLE",
  "DEGRADED",
  "UNAVAILABLE",
  "BLOCKED",
]);

export const ANALYTICAL_DECISION_INTENTS = Object.freeze([
  "NO_RISK_CHANGE",
  "RISK_INCREASING",
  "RISK_REDUCING",
  "POSITION_MANAGEMENT",
]);

export const ANALYTICAL_PHASE_CATALOG = deepFreeze([
  phase("CONTINUITY", "HARD", ["CONTINUITY_STATE"]),
  phase("CORE_MARKET", "HARD", ["CANONICAL_MARKET"]),
  phase("INDEX_CONFIRMATION", "CONTEXT", ["INDEX_CONFIRMATION"]),
  phase("CROSS_ASSET", "CONTEXT", ["CROSS_ASSET_CONTEXT"]),
  phase("MEGACAPS", "CONTEXT", ["MEGACAP_CONTEXT"]),
  phase("MACRO", "CONTEXT", ["MACRO_CONTEXT"]),
  phase("NEWS", "CONTEXT", ["NEWS_CONTEXT"]),
  phase("THESIS_EVOLUTION", "HARD", ["THESIS_STATE"]),
  phase("OPPORTUNITY", "HARD", ["OPPORTUNITY_SET"]),
  phase("CONCLUSION", "HARD", ["ANALYTICAL_CONCLUSION"]),
]);

const PHASE_BY_NAME = new Map(ANALYTICAL_PHASE_CATALOG.map((entry) => [entry.phase, entry]));

export function analyticalPhaseDefinition(value) {
  return PHASE_BY_NAME.get(String(value || "").trim().toUpperCase()) || null;
}

export function isAnalyticalPhase(value) {
  return Boolean(analyticalPhaseDefinition(value));
}

export function isAnalyticalPhaseStatus(value) {
  return ANALYTICAL_PHASE_STATUSES.includes(String(value || "").trim().toUpperCase());
}

export function isAnalyticalTerminalPhaseStatus(value) {
  return ANALYTICAL_TERMINAL_PHASE_STATUSES.includes(
    String(value || "").trim().toUpperCase(),
  );
}

function phase(name, criticality, requiredEvidenceKinds) {
  return {
    phase: name,
    ordinal: ANALYTICAL_PHASES.indexOf(name) + 1,
    criticality,
    required_evidence_kinds: [...requiredEvidenceKinds],
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
