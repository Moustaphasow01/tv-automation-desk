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
export {
  CONTRACT_ORDER_TYPES_V1,
  ENTRY_MODES_V1,
  normalizeContractOrderTypeV1,
  normalizeEntryModeV1,
  validateEntryOrderSemanticsV1,
} from "./src/entry-order-semantics-v1.js";
export {
  BROKER_EXECUTION_SCHEMA_VERSION,
  BROKER_RISK_PERCENT,
  BROKER_DEFAULT_MAX_DECISION_AGE_SECONDS,
  BROKER_CONTRACT_ROUNDING_MODE,
  BROKER_EXECUTION_AUTHORITY_MODES,
  SAFE_BRIDGE_MODES,
  SUBMISSION_BRIDGE_MODES,
  BrokerExecutionError,
  brokerExecutionEnvironment,
  brokerExecutionAuthorityMode,
  calculateContractQuantity,
  createOrderIntent,
  evaluateBrokerPolicy,
  materializeTradeDecision,
  normalizeNinjaUpdate,
  resolveBrokerAccountCapital,
  renderNinjaOifCommand,
  renderNinjaOifManagementCommand,
} from "./src/broker-execution.js";
export {
  ninjaAtiExternalEventKey,
  normalizeAtiOrderState,
  parseNinjaAtiOutgoingFile,
} from "./src/ninja-ati.js";
export {
  BROKER_MANAGEMENT_ACTIONS,
  BROKER_MANAGEMENT_SCHEMA_VERSION,
  DEFAULT_MANAGEMENT_BREAK_EVEN_AT_R,
  createBrokerManagementIntent,
  deriveBrokerManagementRequest,
  evaluatePositionRequestEligibility,
  evaluateBrokerManagementPolicy,
  renderBrokerManagementCommand,
} from "./src/broker-position-management.js";
export {
  NINJA_ADDON_ACTIONS,
  NINJA_ADDON_PROTOCOL_VERSION,
  NinjaAddonProtocolError,
  compareNinjaAdapterSnapshots,
  createNinjaAddonCommand,
  normalizeNinjaAddonEvent,
} from "./src/ninja-addon-protocol.js";
export {
  TRADE_OUTCOME_ENGINE_VERSION,
  TRADE_OUTCOME_SCHEMA_VERSION,
  calculateTradeOutcome,
} from "./src/trade-outcome.js";
export {
  DETERMINISTIC_COMPILER_VERSION_V1,
  MASTER_PLAN_SCHEMA_VERSION_V1,
  MONITOR_COMMAND_SCHEMA_VERSION_V1,
  compileMasterPlanV1,
  compileMonitorCommandV1,
} from "./src/deterministic-compiler-entry-v1.js";
export {
  DETERMINISTIC_PREDICATE_CAPABILITIES_V1,
  DETERMINISTIC_PREDICATE_REGISTRY_V1,
  PREDICATE_STATES_V1,
  PREDICATE_TYPES_V1,
  PREDICATE_EVENT_ROWS_INSTRUMENT_V1,
  INTERMARKET_ALIGNMENT_VERSION_V1,
  evaluateDeterministicConditionSetV1,
  canonicalInstrumentV1,
  canonicalTimeframeV1,
  evaluateDeterministicPredicateV1,
  predicateCapabilitiesV1,
  setupConditionInstrumentsV1,
} from "./src/deterministic-predicate-entry-v1.js";
export {
  HARD_GATE_ENFORCEMENT_PHASES_V5,
  HARD_GATE_CODES_V5,
  OPPORTUNITY_EVALUATION_PHASES_V1,
  OPPORTUNITY_POLICY_EVALUATION_SCHEMA_VERSION_V1,
  OPPORTUNITY_POLICY_VERSION_V1,
  SOFT_GATE_CODES_V5,
  OPPORTUNITY_SEEKING_CONTROLLED,
  canonicalOpportunityGateCodeV1,
  classifyOpportunityGateV1,
  evaluateCanonicalGeometry,
  evaluateOpportunitySeekingControlledV1,
} from "./src/opportunity-policy-v1.js";
export {
  SETUP_COMMANDS_V1,
  SETUP_STATES_V1,
  transitionSetupStateV1,
} from "./src/setup-state-machine-v1.js";
export {
  THESIS_COMMANDS_V1,
  THESIS_STATES_V1,
  normalizeThesisStateV1,
  transitionThesisStateV1,
} from "./src/thesis-state-machine-v1.js";
export {
  POSITION_EVENTS_V1,
  POSITION_REQUESTS_V1,
  POSITION_STATES_V1,
  transitionPositionStateV1,
} from "./src/position-state-machine-v1.js";
export {
  REPLAN_EVENTS_V1,
  REPLAN_STATES_V1,
  transitionReplanStateV1,
} from "./src/replan-state-machine-v1.js";
