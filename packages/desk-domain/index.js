export {
  DECISION_MODEL_VERSION,
  DECISION_SCHEMA_VERSION,
  DECISION_SOURCE_ROLE,
  DECISION_SOURCE_TYPES,
  normalizeDecision,
} from "./src/decision-model.js";
export {
  DOMAIN_STATUSES,
  accepted,
  domainResult,
  rejected,
  resultFromIssues,
  reviewRequired,
} from "./src/result.js";
export {
  buildDecisionAuditEnvelope,
  evaluateAntiLookahead,
} from "./src/anti-lookahead-guard.js";
export {
  assertDecisionAuditWritable,
  createDecisionAuditCorrection,
  decisionAuditContentHash,
  finalizeDecisionAudit,
  isDecisionAuditFinalized,
} from "./src/decision-audit-lifecycle.js";
export { evaluateGates } from "./src/gate-evaluator.js";
export { evaluateRisk } from "./src/risk-engine.js";
export { validateSetup } from "./src/setup-validator.js";
export { replayOutcome } from "./src/outcome-replayer.js";
export { evaluatePositionManagement } from "./src/position-manager.js";
export {
  POSITION_THESIS_STATUSES,
  isPositionThesisStatus,
  planThesisSetupPositionSplit,
} from "./src/thesis-position-split.js";
export {
  THESIS_STATES,
  allowedThesisTransitions,
  transitionThesisState,
} from "./src/thesis-state-machine.js";
export {
  DESK_EXECUTION_MODES,
  DESK_SCOPE_SCHEMA_VERSION,
  DESK_STRATEGY_REGISTRY,
  DESK_TIMEZONE,
  DeskScopeError,
  assertSameExecutionScope,
  canonicalJson,
  canonicalSha256,
  createDeskExecutionScope,
  defaultCutoffParis,
  strategyDefinition,
} from "./src/execution-scope.js";
