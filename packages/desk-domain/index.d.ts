export type DomainStatus = "accepted" | "rejected" | "review_required";

export type DomainResult = {
  ok: boolean;
  status: DomainStatus;
  reasons: string[];
  flags: string[];
  evidence: Record<string, unknown>;
};

export type DecisionAuditLifecycleResult = DomainResult & {
  audit: Record<string, unknown> | null;
  record: Record<string, unknown> | null;
};

export type DecisionAuditCorrectionResult = DomainResult & {
  correction: Record<string, unknown> | null;
  record: Record<string, unknown> | null;
};

export type DecisionAuditEnvelopeResult = DomainResult & {
  audit: Record<string, unknown> | null;
  record: Record<string, unknown> | null;
};

export type DecisionModelResult = DomainResult & {
  decision: Record<string, unknown>;
  record: Record<string, unknown>;
  audit_result: DomainResult | null;
  gate_result: DomainResult;
};

export const DECISION_SCHEMA_VERSION = "decision_v2";
export const DECISION_MODEL_VERSION = "single_decision_chain_v1";
export const DECISION_SOURCE_ROLE = "proposer";
export const DECISION_SOURCE_TYPES: string[];
export const DOMAIN_STATUSES: {
  ACCEPTED: "accepted";
  REJECTED: "rejected";
  REVIEW_REQUIRED: "review_required";
};

export function normalizeDecision(input?: Record<string, unknown>, options?: Record<string, unknown>): DecisionModelResult;
export function accepted(options?: Record<string, unknown>): DomainResult;
export function rejected(reason: string, options?: Record<string, unknown>): DomainResult;
export function reviewRequired(reason: string, options?: Record<string, unknown>): DomainResult;
export function domainResult(options?: Record<string, unknown>): DomainResult;
export function resultFromIssues(options?: Record<string, unknown>): DomainResult;

export function buildDecisionAuditEnvelope(input?: Record<string, unknown>, options?: Record<string, unknown>): DecisionAuditEnvelopeResult;
export function evaluateAntiLookahead(options?: Record<string, unknown>): DomainResult;
export function finalizeDecisionAudit(audit?: Record<string, unknown>, options?: Record<string, unknown>): DecisionAuditLifecycleResult;
export function assertDecisionAuditWritable(existingAudit?: Record<string, unknown> | null, candidateAudit?: Record<string, unknown>, options?: Record<string, unknown>): DomainResult;
export function createDecisionAuditCorrection(existingAudit?: Record<string, unknown>, correction?: Record<string, unknown>, options?: Record<string, unknown>): DecisionAuditCorrectionResult;
export function isDecisionAuditFinalized(audit?: Record<string, unknown>): boolean;
export function decisionAuditContentHash(audit?: Record<string, unknown>): string;
export function evaluateGates(options?: Record<string, unknown>): DomainResult;
export function evaluateRisk(options?: Record<string, unknown>): DomainResult;
export function validateSetup(options?: Record<string, unknown>): DomainResult;
export function replayOutcome(options?: Record<string, unknown>): DomainResult;
export function evaluatePositionManagement(options?: Record<string, unknown>): DomainResult;
export const POSITION_THESIS_STATUSES: string[];
export function isPositionThesisStatus(status?: unknown): boolean;
export function planThesisSetupPositionSplit(thesis?: Record<string, unknown>, options?: Record<string, unknown>): DomainResult & {
  migration_required: boolean;
  thesis_patch: Record<string, unknown> | null;
  position_record: Record<string, unknown> | null;
};

export const THESIS_STATES: Record<string, string>;
export const allowedThesisTransitions: Record<string, string[]>;
export function transitionThesisState(options?: Record<string, unknown>): DomainResult;

export type DeskExecutionMode = "live" | "paper" | "replay" | "backtest";
export type DeskExecutionScopeV1 = {
  scope_schema_version: "1.0.0";
  strategy_id: "ny_open_1530" | "asia_open";
  session: "ny_open" | "asia_open";
  mode: DeskExecutionMode;
  trading_date: string;
  timezone: "Europe/Paris";
  cutoff_paris: string;
  cutoff_utc: string;
  run_id: string | null;
  backtest_id: string | null;
  pack_id: string | null;
  pack_build_id: string | null;
  scope_hash: string;
};
export const DESK_SCOPE_SCHEMA_VERSION = "1.0.0";
export const DESK_TIMEZONE = "Europe/Paris";
export const DESK_EXECUTION_MODES: DeskExecutionMode[];
export const DESK_STRATEGY_REGISTRY: Record<string, { strategy_id: string; session: string; cutoff_time_paris: string }>;
export class DeskScopeError extends Error {
  code: string;
  details: Record<string, unknown>;
}
export function canonicalJson(value: unknown): string;
export function canonicalSha256(value: unknown): string;
export function defaultCutoffParis(strategyId: string, tradingDate: string): string;
export function createDeskExecutionScope(input?: Record<string, unknown>, options?: Record<string, unknown>): DeskExecutionScopeV1;
export function assertSameExecutionScope(parent?: Record<string, unknown>, child?: Record<string, unknown>, options?: Record<string, unknown>): true;
export function strategyDefinition(strategyId: string): { strategy_id: string; session: string; cutoff_time_paris: string };

export const CONTRACT_ORDER_TYPES_V1: readonly ["MARKET", "LIMIT", "STOP", "STOP_LIMIT"];
export const ENTRY_MODES_V1: readonly ["NEXT_BAR_MARKET_AFTER_CONFIRMATION", "RETEST_ZONE_AFTER_CONFIRMATION", "STOP_CROSS", "LIMIT_TOUCH"];
export function normalizeContractOrderTypeV1(value?: unknown): "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT" | null;
export function normalizeEntryModeV1(value?: unknown): "NEXT_BAR_MARKET_AFTER_CONFIRMATION" | "RETEST_ZONE_AFTER_CONFIRMATION" | "STOP_CROSS" | "LIMIT_TOUCH" | null;
export function validateEntryOrderSemanticsV1(input?: Record<string, unknown>): Record<string, unknown>;
export const BROKER_EXECUTION_SCHEMA_VERSION: "broker_execution_v2";
export const BROKER_RISK_PERCENT: 0.25;
export const BROKER_DEFAULT_MAX_DECISION_AGE_SECONDS: 120;
export const BROKER_CONTRACT_ROUNDING_MODE: "ceil";
export const BROKER_EXECUTION_AUTHORITY_MODES: readonly ["semi_auto", "auto"];
export const SAFE_BRIDGE_MODES: string[];
export const SUBMISSION_BRIDGE_MODES: string[];
export class BrokerExecutionError extends Error {
  code: string;
  details: Record<string, unknown>;
}
export function brokerExecutionEnvironment(env?: Record<string, string | undefined>): Record<string, unknown>;
export function brokerExecutionAuthorityMode(policy?: Record<string, unknown>): "semi_auto" | "auto";
export function resolveBrokerAccountCapital(accountSnapshot?: Record<string, unknown> | null, options?: Record<string, unknown>): { value: number | null; source: string | null; fallback: boolean };
export function calculateContractQuantity(input?: Record<string, unknown>): Record<string, unknown>;
export function materializeTradeDecision(input?: Record<string, unknown>): Record<string, unknown>;
export function evaluateBrokerPolicy(input?: Record<string, unknown>): Record<string, unknown>;
export function createOrderIntent(input?: Record<string, unknown>): Record<string, unknown>;
export function renderNinjaOifCommand(intent?: Record<string, unknown>, options?: Record<string, unknown>): string;
export function renderNinjaOifManagementCommand(input?: Record<string, unknown>, options?: Record<string, unknown>): string;
export function normalizeNinjaUpdate(input?: Record<string, unknown>, now?: string): Record<string, unknown>;
export function normalizeAtiOrderState(value?: unknown): string;
export function parseNinjaAtiOutgoingFile(input?: Record<string, unknown>): Record<string, unknown> | null;
export function ninjaAtiExternalEventKey(input?: Record<string, unknown>): string;
export const BROKER_MANAGEMENT_SCHEMA_VERSION: "broker_management_v1";
export const BROKER_MANAGEMENT_ACTIONS: string[];
export function deriveBrokerManagementRequest(input?: Record<string, unknown>): Record<string, unknown>;
export function createBrokerManagementIntent(input?: Record<string, unknown>): Record<string, unknown>;
export function evaluateBrokerManagementPolicy(input?: Record<string, unknown>): Record<string, unknown>;
export function renderBrokerManagementCommand(input?: Record<string, unknown>): string;
export const NINJA_ADDON_PROTOCOL_VERSION: "desk_ninja_addon_v1";
export const NINJA_ADDON_ACTIONS: string[];
export class NinjaAddonProtocolError extends Error {
  code: string;
  details: Record<string, unknown>;
}
export function createNinjaAddonCommand(input?: Record<string, unknown>): Record<string, unknown>;
export function normalizeNinjaAddonEvent(input?: Record<string, unknown>, now?: string): Record<string, unknown>;
export function compareNinjaAdapterSnapshots(left?: Record<string, unknown>, right?: Record<string, unknown>): Record<string, unknown>;

export const DETERMINISTIC_COMPILER_VERSION_V1: "1.4.0";
export const MASTER_PLAN_SCHEMA_VERSION_V1: "deterministic_execution_plan_v1_4";
export const MONITOR_COMMAND_SCHEMA_VERSION_V1: "desk_monitor_command_v1_4";
export function compileMasterPlanV1(rawMaster?: Record<string, unknown>, options?: Record<string, unknown>): Record<string, unknown>;
export function compileMonitorCommandV1(rawMonitor?: Record<string, unknown>, options?: Record<string, unknown>): Record<string, unknown>;

export const PREDICATE_TYPES_V1: readonly string[];
export const PREDICATE_STATES_V1: Record<string, string>;
export const DETERMINISTIC_PREDICATE_CAPABILITIES_V1: Record<string, Record<string, unknown>>;
export const DETERMINISTIC_PREDICATE_REGISTRY_V1: Record<string, (...args: unknown[]) => Record<string, unknown>>;
export function predicateCapabilitiesV1(predicateType?: unknown): Record<string, unknown> | null;
export function canonicalInstrumentV1(value?: unknown): string;
export function canonicalTimeframeV1(value?: unknown): string;
export function setupConditionInstrumentsV1(setup?: Record<string, unknown>): string[];
export function evaluateDeterministicPredicateV1(options?: Record<string, unknown>): Record<string, unknown>;
export function evaluateDeterministicConditionSetV1(options?: Record<string, unknown>): Record<string, unknown>;

export const HARD_GATE_CODES_V5: readonly string[];
export const SOFT_GATE_CODES_V5: readonly string[];
export const OPPORTUNITY_EVALUATION_PHASES_V1: readonly [
  "PLAN_COMPILE",
  "SETUP_ARM",
  "ENTRY_TRIGGER",
  "BROKER_SUBMIT",
];
export const HARD_GATE_ENFORCEMENT_PHASES_V5: Readonly<Record<string, "PLAN_COMPILE" | "SETUP_ARM" | "ENTRY_TRIGGER" | "BROKER_SUBMIT">>;
export const OPPORTUNITY_POLICY_VERSION_V1: "1.2.0";
export const OPPORTUNITY_POLICY_EVALUATION_SCHEMA_VERSION_V1: "opportunity_policy_evaluation_v1_2";
export const OPPORTUNITY_SEEKING_CONTROLLED: {
  policy_id: "OPPORTUNITY_SEEKING_CONTROLLED";
  policy_version: "1.2.0";
  weighted_confirmation_threshold: 0.55;
  max_risk_pct: 0.25;
  min_rr: 2;
  optional_advisory_in_score: false;
  unknown_context_is_soft: true;
  gpt_may_trigger: false;
};
export function canonicalOpportunityGateCodeV1(code?: unknown, options?: Record<string, unknown>): string;
export function classifyOpportunityGateV1(gate?: Record<string, unknown>): "hard" | "soft";
export function evaluateCanonicalGeometry(setup?: Record<string, unknown>, policy?: Record<string, unknown>): Record<string, unknown>;
export function evaluateOpportunitySeekingControlledV1(options?: Record<string, unknown>): Record<string, unknown>;

export const SETUP_STATES_V1: Record<string, string>;
export const SETUP_COMMANDS_V1: Record<string, string>;
export function transitionSetupStateV1(options?: Record<string, unknown>): Record<string, unknown>;

export const THESIS_STATES_V1: Record<string, string>;
export const THESIS_COMMANDS_V1: Record<string, string>;
export function normalizeThesisStateV1(value?: unknown): string;
export function transitionThesisStateV1(options?: Record<string, unknown>): Record<string, unknown>;

export const POSITION_STATES_V1: Record<string, string>;
export const POSITION_EVENTS_V1: Record<string, string>;
export const POSITION_REQUESTS_V1: Record<string, string>;
export function transitionPositionStateV1(options?: Record<string, unknown>): Record<string, unknown>;

export const REPLAN_STATES_V1: Record<string, string>;
export const REPLAN_EVENTS_V1: Record<string, string>;
export function transitionReplanStateV1(options?: Record<string, unknown>): Record<string, unknown>;
