export type DomainStatus = "accepted" | "rejected" | "review_required";

export type DomainResult = { ok: boolean; status: DomainStatus; reasons: string[]; flags: string[]; evidence: Record<string, unknown>; };

export type DecisionAuditLifecycleResult = DomainResult & { audit: Record<string, unknown> | null; record: Record<string, unknown> | null; };

export type DecisionAuditCorrectionResult = DomainResult & { correction: Record<string, unknown> | null; record: Record<string, unknown> | null; };

export type DecisionAuditEnvelopeResult = DomainResult & { audit: Record<string, unknown> | null; record: Record<string, unknown> | null; };

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
export const PROBLEM_DETAILS_SCHEMA_VERSION: "desk_problem_details_v1";
export const ERROR_CATEGORIES: readonly ["business", "technical", "operator", "security", "data"];
export const ERROR_SEVERITIES: readonly ["info", "warning", "error", "critical"];
export const DESK_ERROR_REGISTRY: Readonly<Record<string, {
  status: number;
  category: "business" | "technical" | "operator" | "security" | "data";
  severity: "info" | "warning" | "error" | "critical";
  title: string;
  operator_message: string;
  retryable: boolean;
}>>;

export function normalizeDecision(input?: Record<string, unknown>, options?: Record<string, unknown>): DecisionModelResult;
export function accepted(options?: Record<string, unknown>): DomainResult;
export function rejected(reason: string, options?: Record<string, unknown>): DomainResult;
export function reviewRequired(reason: string, options?: Record<string, unknown>): DomainResult;
export function domainResult(options?: Record<string, unknown>): DomainResult;
export function resultFromIssues(options?: Record<string, unknown>): DomainResult;
export function problemDetailsFromError(error?: unknown, options?: Record<string, unknown>): Record<string, unknown>;
export function normalizeDeskErrorCode(value?: unknown, fallbackCode?: string): string;
export function isRetryableProblem(problem?: Record<string, unknown>): boolean;
export function operatorMessageForProblem(problem?: Record<string, unknown>): string;

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
export function compareNinjaAdapterSnapshots(left?: Record<string, unknown>, right?: Record<string, unknown>): Record<string, unknown>; export const NINJATRADER_PROVIDER_ADAPTER_SCHEMA_VERSION_V1: "ninjatrader_provider_adapter_v1", NINJATRADER_PROVIDER_ADAPTER_STATUSES_V1: readonly string[], adaptExecutionProviderCommandToNinjaAddonV1: (input?: Record<string, unknown>) => Record<string, unknown>, adaptNinjaAddonEventToBrokerProviderEventV1: (input?: Record<string, unknown>) => Record<string, unknown>, PICKMYTRADE_PROVIDER_ADAPTER_SCHEMA_VERSION_V1: "pickmytrade_provider_adapter_v1", PICKMYTRADE_PROVIDER_ADAPTER_STATUSES_V1: readonly string[], PICKMYTRADE_EXECUTION_MODES_V1: readonly string[], adaptExecutionProviderCommandToPickMyTradeWebhookV1: (input?: Record<string, unknown>) => Record<string, unknown>, adaptPickMyTradeWebhookEventToBrokerProviderEventV1: (input?: Record<string, unknown>) => Record<string, unknown>, EXECUTION_PROVIDER_CIRCUIT_BREAKER_SCHEMA_VERSION_V1: "execution_provider_circuit_breaker_v1", EXECUTION_PROVIDER_ROUTE_STATUSES_V1: readonly string[], EXECUTION_PROVIDER_CIRCUIT_STATES_V1: readonly string[], EXECUTION_PROVIDER_FALLBACK_MODES_V1: readonly string[], planExecutionProviderCircuitBreakerV1: (input?: Record<string, unknown>) => Record<string, unknown>;

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
export const OPPORTUNITY_EVALUATION_PHASES_V1: readonly ["PLAN_COMPILE", "SETUP_ARM", "ENTRY_TRIGGER", "BROKER_SUBMIT"];
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

export const STRATEGY_REGISTRY_SCHEMA_VERSION_V1: "strategy_registry_v1";
export const STRATEGY_DEFINITION_SCHEMA_VERSION_V1: "strategy_definition_v1";
export const STRATEGY_VERSION_SCHEMA_VERSION_V1: "strategy_version_v1";
export const STRATEGY_INSTANCE_SCHEMA_VERSION_V1: "strategy_instance_v1";
export const STRATEGY_VERSION_STATUSES_V1: readonly ["DRAFT", "IN_SIMULATION", "VALIDATED", "PUBLISHED", "DEPRECATED"];
export const STRATEGY_INSTANCE_RUNTIME_STATES_V1: readonly ["CREATED", "STARTING", "RUNNING", "PAUSED", "STOPPING", "STOPPED", "FAILED_TO_START", "ERRORED"];
export const STRATEGY_INSTANCE_EXECUTION_MODES_V1: readonly ["SHADOW", "PAPER", "LIVE"];
export const STRATEGY_VERSION_TRANSITIONS_V1: Readonly<Record<string, readonly string[]>>;
export const STRATEGY_INSTANCE_RUNTIME_TRANSITIONS_V1: Readonly<Record<string, readonly string[]>>;
export const STRATEGY_INSTANCE_EXECUTION_MODE_TRANSITIONS_V1: Readonly<Record<string, readonly string[]>>;
export function validateStrategyDefinitionV1(input?: Record<string, unknown>): DomainResult & {
  entity: "strategy_definition";
  schema_version: "strategy_registry_v1";
  issues: Record<string, unknown>[];
  normalized: Record<string, unknown>;
};
export function validateStrategyVersionV1(input?: Record<string, unknown>): DomainResult & {
  entity: "strategy_version";
  schema_version: "strategy_registry_v1";
  issues: Record<string, unknown>[];
  normalized: Record<string, unknown>;
};
export function validateStrategyInstanceV1(input?: Record<string, unknown>, options?: Record<string, unknown>): DomainResult & {
  entity: "strategy_instance";
  schema_version: "strategy_registry_v1";
  issues: Record<string, unknown>[];
  normalized: Record<string, unknown>;
};
export function validateStrategyVersionTransitionV1(previous?: Record<string, unknown>, next?: Record<string, unknown>): DomainResult & {
  entity: "strategy_version_transition";
  schema_version: "strategy_registry_v1";
  issues: Record<string, unknown>[];
  normalized: Record<string, unknown>;
};
export function validateStrategyInstanceTransitionV1(
  previous?: Record<string, unknown>,
  next?: Record<string, unknown>,
  options?: Record<string, unknown>,
): DomainResult & {
  entity: "strategy_instance_transition";
  schema_version: "strategy_registry_v1";
  issues: Record<string, unknown>[];
  normalized: Record<string, unknown>;
};
export function strategyDefinitionHashV1(input?: Record<string, unknown>): string;
export function strategyVersionHashV1(input?: Record<string, unknown>): string;
export function strategyInstanceHashV1(input?: Record<string, unknown>): string;

export const STRATEGY_DSL_SCHEMA_VERSION_V1: "strategy_dsl_v1";
export const STRATEGY_DSL_COMPILER_VERSION_V1: "strategy-dsl-compiler-v1";
export const STRATEGY_COMPILED_ARTIFACT_SCHEMA_VERSION_V1: "strategy_compiled_artifact_v1";
export const STRATEGY_PATTERN_BREAKOUT_RETEST_V1: "BREAKOUT_RETEST";
export function parseStrategyDslSourceV1(source?: unknown, issues?: Record<string, unknown>[]): Record<string, unknown> | null;
export function compileStrategyVersionToDeterministicPlanV1(input?: {
  strategy_definition?: Record<string, unknown> | null;
  strategy_version?: Record<string, unknown> | null;
  dsl_source?: unknown;
  runtime_bindings?: Record<string, unknown>;
  scope?: Record<string, unknown>;
  source_mode?: string;
  policy?: Record<string, unknown>;
}): DomainResult & {
  schema_version: "strategy_dsl_compilation_result_v1";
  compiler_version: "strategy-dsl-compiler-v1";
  issues: Record<string, unknown>[];
  strategy_definition: Record<string, unknown> | null;
  strategy_version: Record<string, unknown> | null;
  dsl: Record<string, unknown> | null;
  deterministic_execution_plan: Record<string, unknown> | null;
  compiled_artifact: Record<string, unknown> | null;
  evidence: Record<string, unknown>;
};
export const STRATEGY_INSTANCE_SCHEDULER_SCHEMA_VERSION_V1: "strategy_instance_scheduler_plan_v1";
export const STRATEGY_INSTANCE_SCHEDULER_STATUSES_V1: readonly ["DUE", "LATE", "WAITING", "PAUSED", "DISABLED", "NOT_RUNNABLE"];
export function evaluateStrategyInstanceScheduleV1(input?: Record<string, unknown>): Record<string, unknown>;
export function planStrategyInstanceSchedulerCycleV1(input?: Record<string, unknown>): Record<string, unknown>;
export const STRATEGY_SIGNAL_SCHEMA_VERSION_V1: "strategy_signal_v1", STRATEGY_SIGNAL_DIRECTIONS_V1: readonly ["LONG", "SHORT", "FLAT"], STRATEGY_SIGNAL_EXECUTION_MODES_V1: readonly ["SHADOW", "PAPER", "LIVE"];
export const normalizeStrategySignalV1: (input?: Record<string, unknown>) => Record<string, unknown>, strategySignalEnvelopeV1: (signal?: Record<string, unknown>) => Record<string, unknown>; export const AI_CONTEXT_ADVISORY_SCHEMA_VERSION_V1: "ai_context_advisory_v1", AI_CONTEXT_ADVISORY_ISOLATION_PROOF_SCHEMA_VERSION_V1: "ai_context_advisory_isolation_proof_v1", AI_CONTEXT_ADVISORY_RECOMMENDATIONS_V1: readonly ["TAKE", "TAKE_REDUCED", "WAIT", "REJECT"], AI_CONTEXT_ADVISORY_SUBJECT_TYPES_V1: readonly ["SIGNAL", "POSITION", "CANDIDATE_ALLOCATION"], AI_CONTEXT_ADVISORY_EFFECTS_V1: readonly ["READ_ONLY_ADVISORY"], AI_CONTEXT_ADVISORY_PROHIBITED_CAPABILITIES_V1: readonly string[], buildAiContextAdvisoryV1: (input?: Record<string, unknown>) => Record<string, unknown>, proveAiContextAdvisoryIsolationV1: (input?: Record<string, unknown>) => Record<string, unknown>; export const AI_CONTEXT_GATE_EXECUTION_SCHEMA_VERSION_V1: "ai_context_gate_execution_v1", AI_CONTEXT_GATE_MODES_V1: readonly ["SHADOW", "ADVISORY", "ENFORCED"], AI_CONTEXT_GATE_STATUSES_V1: readonly string[], AI_CONTEXT_GATE_FALLBACK_REASONS_V1: readonly string[], AI_CONTEXT_GATE_POLICY_VERSION_V1: "ai_context_gate_policy_v1", evaluateAiContextGateV1: (input?: Record<string, unknown>) => Record<string, unknown>;
export const PORTFOLIO_CANDIDATE_ALLOCATION_SCHEMA_VERSION_V1: "portfolio_candidate_allocation_plan_v1", VIRTUAL_STRATEGY_PORTFOLIO_SCHEMA_VERSION_V1: "virtual_strategy_portfolio_v1", PORTFOLIO_ALLOCATION_DIRECTIONS_V1: readonly ["LONG", "SHORT", "FLAT"], PORTFOLIO_STRATEGY_RUNTIME_STATES_V1: readonly ["ACTIVE", "SUSPENDED", "DISABLED"], DEFAULT_PORTFOLIO_CANDIDATE_ALLOCATION_POLICY_V1: Readonly<Record<string, unknown>>;
export const buildCandidateAllocationPortfolioV1: (input?: Record<string, unknown>) => Record<string, unknown>, buildVirtualStrategyPortfolioV1: (input?: Record<string, unknown>) => Record<string, unknown>;
export const PORTFOLIO_RISK_BUDGET_SCHEMA_VERSION_V1: "portfolio_risk_budget_v1", PORTFOLIO_RISK_BUDGET_EVALUATION_SCHEMA_VERSION_V1: "portfolio_risk_budget_evaluation_v1", PORTFOLIO_RISK_BUDGET_STATUSES_V1: readonly string[], DEFAULT_PORTFOLIO_CORRELATION_GROUPS_V1: Readonly<Record<string, readonly string[]>>, normalizePortfolioRiskBudgetV1: (input?: Record<string, unknown>) => Record<string, unknown>, evaluatePortfolioRiskBudgetV1: (input?: Record<string, unknown>) => Record<string, unknown>;
export const PORTFOLIO_TARGET_POSITION_PLAN_SCHEMA_VERSION_V1: "portfolio_target_position_plan_v1", TARGET_POSITION_SCHEMA_VERSION_V1: "target_position_v1", TARGET_POSITION_STATUSES_V1: readonly string[], buildPortfolioTargetPositionPlanV1: (input?: Record<string, unknown>) => Record<string, unknown>;
export const PORTFOLIO_ORDER_INTENT_PLAN_SCHEMA_VERSION_V1: "portfolio_order_intent_plan_v1", ORDER_INTENT_SCHEMA_VERSION_V1: "portfolio_order_intent_v1", ORDER_INTENT_ACTIONS_V1: readonly string[], ORDER_INTENT_LIFECYCLE_ACTIONS_V1: readonly string[], ORDER_INTENT_STATUSES_V1: readonly string[], buildPortfolioOrderIntentPlanV1: (input?: Record<string, unknown>) => Record<string, unknown>, PORTFOLIO_EXECUTION_RECONCILIATION_SCHEMA_VERSION_V1: "portfolio_execution_reconciliation_v1", PORTFOLIO_EXECUTION_RECONCILIATION_STATUSES_V1: readonly string[], PORTFOLIO_EXECUTION_CONTROL_CODES_V1: readonly string[], evaluatePortfolioExecutionReconciliationV1: (input?: Record<string, unknown>) => Record<string, unknown>, EXECUTION_PROVIDER_PORT_SCHEMA_VERSION_V1: "execution_provider_port_v1", EXECUTION_PROVIDER_COMMAND_SCHEMA_VERSION_V1: "execution_provider_command_v1", BROKER_PROVIDER_EVENT_SCHEMA_VERSION_V1: "broker_provider_event_v1", EXECUTION_PROVIDER_COMMAND_TYPES_V1: readonly string[], EXECUTION_PROVIDER_COMMAND_STATUSES_V1: readonly string[], BROKER_PROVIDER_EVENT_TYPES_V1: readonly string[], BROKER_PROVIDER_ORDER_STATUSES_V1: readonly string[], buildExecutionProviderCommandV1: (input?: Record<string, unknown>) => Record<string, unknown>, normalizeBrokerProviderEventV1: (input?: Record<string, unknown>) => Record<string, unknown>, PORTFOLIO_VIRTUAL_PNL_ATTRIBUTION_SCHEMA_VERSION_V1: "portfolio_virtual_pnl_attribution_v1", PORTFOLIO_STRATEGY_SIMILARITY_SCHEMA_VERSION_V1: "portfolio_strategy_similarity_v1", PORTFOLIO_SIMILARITY_DECISIONS_V1: readonly string[], buildPortfolioVirtualPnlAttributionV1: (input?: Record<string, unknown>) => Record<string, unknown>, PROP_FIRM_ACCOUNT_RISK_SCHEMA_VERSION_V1: "prop_firm_account_risk_v1", PROP_FIRM_ACCOUNT_RISK_STATUSES_V1: readonly string[], PROP_FIRM_DRAWDOWN_MODES_V1: readonly string[], evaluatePropFirmAccountRiskV1: (input?: Record<string, unknown>) => Record<string, unknown>;
export const STRATEGY_SHADOW_PARITY_SCHEMA_VERSION_V1: "strategy_shadow_parity_report_v1", STRATEGY_SHADOW_PARITY_STATUSES_V1: readonly ["PARITY_OK", "PARITY_MISMATCH", "PARITY_INVALID"], STRATEGY_SHADOW_PARITY_OUTPUT_KINDS_V1: readonly ["SIGNAL", "NO_OP"], buildStrategyShadowParityReportV1: (input?: Record<string, unknown>) => Record<string, unknown>;
export const STRATEGY_LIVE_PERFORMANCE_DRIFT_SCHEMA_VERSION_V1: "strategy_live_performance_drift_v1", STRATEGY_LIVE_PERFORMANCE_DRIFT_STATUSES: Readonly<Record<string, string>>, DEFAULT_STRATEGY_PERFORMANCE_DRIFT_POLICY_V1: Readonly<Record<string, number>>;
export function buildStrategyLivePerformanceDriftReportV1(input?: Record<string, unknown>): Record<string, unknown>;
export const PROMPT_RENDER_SNAPSHOT_SCHEMA_VERSION_V1: "prompt_render_snapshot_v1";
export const PROMPT_COMPOSITION_SCHEMA_VERSION_V1: "prompt_composition_v1";
export const PROMPT_RENDERER_VERSION_V1: "1.0.0";
export function renderPromptCompositionV1(input?: Record<string, unknown>): {
  ok: boolean;
  reasons: string[];
  snapshot: Record<string, unknown> | null;
};
export function promptCompositionHashV1(composition?: Record<string, unknown>): string;
export function normalizePromptTemplateTextV1(value?: unknown): string;
export function validatePromptVariablesV1(schema?: Record<string, unknown>, variables?: Record<string, unknown>): {
  ok: boolean;
  reasons: string[];
};
export function redactPromptVariablesV1(variables?: Record<string, unknown>, schema?: Record<string, unknown>): Record<string, unknown>;

export const PROMPT_BINDING_POLICY_VERSION_V1: "1.0.0";
export const PROMPT_BINDING_RESOLUTION_SCHEMA_VERSION_V1: "prompt_binding_resolution_v1";
export const PROMPT_DEPLOYMENT_STAGES_V1: readonly ["SHADOW", "CANARY", "ACTIVE", "ROLLED_BACK", "REVOKED"];
export const PROMPT_RUNTIME_COMPOSITION_STATUSES_V1: readonly ["PUBLISHED"];
export function resolveAgentPromptBindingV1(input?: Record<string, unknown>): {
  ok: boolean;
  reasons: string[];
  resolution: Record<string, unknown> | null;
  binding_key?: string | null;
};
export function buildPromptRollbackDecisionV1(input?: Record<string, unknown>): {
  ok: boolean;
  reasons: string[];
  next_binding: Record<string, unknown> | null;
  audit_event: Record<string, unknown> | null;
};
export function validateAgentPromptBindingV1(binding?: Record<string, unknown>): {
  ok: boolean;
  reasons: string[];
};

export const PROMPT_EVALUATION_POLICY_VERSION_V1: "1.0.0";
export const PROMPT_EVALUATION_REPORT_SCHEMA_VERSION_V1: "prompt_evaluation_report_v1";
export const PROMPT_EVALUATION_STATUSES_V1: readonly ["PASS", "FAIL", "REVIEW"];
export function evaluatePromptCandidateV1(input?: Record<string, unknown>): {
  ok: boolean;
  status: "PASS" | "FAIL" | "REVIEW";
  reasons: string[];
  evaluation: Record<string, unknown>;
};
export function buildPromptEvaluationRecordV1(input?: Record<string, unknown>): Record<string, unknown>;

export const PROMPT_REGISTRY_GOVERNANCE_VERSION_V1: "1.0.0";
export const PROMPT_REGISTRY_GOVERNANCE_SCHEMA_VERSION_V1: "prompt_registry_governance_v1";
export const PROMPT_REGISTRY_ACTIONS_V1: readonly ["READ_PROMPT_REGISTRY", "PUBLISH_PROMPT_VERSION", "DEPLOY_PROMPT_COMPOSITION", "ROLLBACK_PROMPT_BINDING", "REVOKE_PROMPT_BINDING"];
export function authorizePromptRegistryActionV1(input?: Record<string, unknown>): {
  ok: boolean;
  reasons: string[];
  decision: Record<string, unknown>;
};
export function scanPromptTextForSecretsV1(promptText?: string): {
  ok: boolean;
  findings: Array<Record<string, unknown>>;
};

export const AGENT_RUNTIME_VERSION_V1: "1.0.0";
export const AGENT_RUNTIME_SCHEMA_VERSION_V1: "agent_runtime_v1";
export const AGENT_SCHEMA_VERSION_V1: "agent_v1";
export const AGENT_MISSION_SCHEMA_VERSION_V1: "agent_mission_v1";
export const AGENT_CONVERSATION_SCHEMA_VERSION_V1: "agent_conversation_v1";
export const AGENT_TASK_SCHEMA_VERSION_V1: "agent_task_v1";
export const AGENT_LEASE_SCHEMA_VERSION_V1: "agent_lease_v1";
export const AGENT_EVENT_SCHEMA_VERSION_V1: "agent_event_v1";
export const AGENT_STATUSES_V1: readonly ["IDLE", "BUSY", "OFFLINE", "DISABLED"];
export const AGENT_MISSION_STATUSES_V1: readonly ["CREATED", "ASSIGNED", "IN_PROGRESS", "PAUSED", "COMPLETED", "FAILED", "CANCELLED"];
export const AGENT_CONVERSATION_STATUSES_V1: readonly ["OPEN", "ROTATING", "ARCHIVED", "FAILED"];
export const AGENT_TASK_STATUSES_V1: readonly ["PENDING", "READY", "CLAIMED", "RUNNING", "WAITING_DEPENDENCY", "DONE", "ERROR", "CANCELLED", "EXPIRED"];
export const AGENT_LEASE_STATUSES_V1: readonly ["ACTIVE", "EXPIRED", "RELEASED", "BROKEN"];
export const AGENT_EVENT_TYPES_V1: readonly ["AGENT_REGISTERED", "MISSION_CREATED", "CONVERSATION_ATTACHED", "EXECUTION_POLICY_RESOLVED", "TASK_CREATED", "TASK_CLAIMED", "LEASE_EXTENDED", "TASK_COMPLETED", "TASK_FAILED", "TASK_EXPIRED", "TASK_DEAD_LETTERED", "TASK_REQUEUED", "TASK_CANCELLED"];
export function validateAgentV1(input?: Record<string, unknown>): DomainResult & {
  entity: "agent";
  schema_version: "agent_runtime_v1";
  issues: Record<string, unknown>[];
  normalized: Record<string, unknown>;
};
export function validateAgentMissionV1(input?: Record<string, unknown>): DomainResult & {
  entity: "agent_mission";
  schema_version: "agent_runtime_v1";
  issues: Record<string, unknown>[];
  normalized: Record<string, unknown>;
};
export function validateAgentConversationV1(input?: Record<string, unknown>): DomainResult & {
  entity: "agent_conversation";
  schema_version: "agent_runtime_v1";
  issues: Record<string, unknown>[];
  normalized: Record<string, unknown>;
};
export function validateAgentTaskV1(input?: Record<string, unknown>): DomainResult & {
  entity: "agent_task";
  schema_version: "agent_runtime_v1";
  issues: Record<string, unknown>[];
  normalized: Record<string, unknown>;
};
export function claimAgentTaskV1(task?: Record<string, unknown>, command?: Record<string, unknown>): {
  ok: boolean;
  reasons: string[];
  task: Record<string, unknown> | null;
  lease: Record<string, unknown> | null;
  event: Record<string, unknown> | null;
};
export function extendAgentLeaseV1(task?: Record<string, unknown>, command?: Record<string, unknown>): {
  ok: boolean;
  reasons: string[];
  task: Record<string, unknown> | null;
  lease: Record<string, unknown> | null;
  event: Record<string, unknown> | null;
};
export function completeAgentTaskV1(task?: Record<string, unknown>, command?: Record<string, unknown>): {
  ok: boolean;
  reasons: string[];
  task: Record<string, unknown> | null;
  lease: Record<string, unknown> | null;
  event: Record<string, unknown> | null;
};
export function failAgentTaskV1(task?: Record<string, unknown>, command?: Record<string, unknown>): {
  ok: boolean;
  reasons: string[];
  task: Record<string, unknown> | null;
  lease: Record<string, unknown> | null;
  event: Record<string, unknown> | null;
};
export function expireAgentTaskLeaseV1(task?: Record<string, unknown>, command?: Record<string, unknown>): {
  ok: boolean;
  reasons: string[];
  task: Record<string, unknown> | null;
  lease: Record<string, unknown> | null;
  event: Record<string, unknown> | null;
};
export function buildAgentEventV1(input?: Record<string, unknown>): Record<string, unknown>;
export function agentRuntimeHashV1(input?: Record<string, unknown>): string;

export const AGENT_CONVERSATION_AFFINITY_VERSION_V1: "1.0.0";
export const AGENT_CONVERSATION_ASSIGNMENT_SCHEMA_VERSION_V1: "agent_conversation_assignment_v1";
export const AGENT_CONVERSATION_ASSIGNMENT_MODES_V1: readonly ["CREATED", "RESUMED", "ROTATED"];
export const DEFAULT_AGENT_CONVERSATION_MAX_TURNS_V1: 12;
export function buildAgentConversationAffinityKeyV1(input?: Record<string, unknown>): string;
export function planAgentConversationAssignmentV1(input?: Record<string, unknown>): Record<string, unknown>;
export function applyAgentConversationUseV1(
  conversation?: Record<string, unknown>,
  command?: Record<string, unknown>,
): Record<string, unknown>;

export const AGENT_EXECUTION_POLICY_VERSION_V1: "1.0.0";
export const AGENT_EXECUTION_POLICY_SCHEMA_VERSION_V1: "agent_execution_policy_v1";
export const AGENT_EXECUTION_POLICY_SNAPSHOT_SCHEMA_VERSION_V1: "agent_execution_policy_snapshot_v1"; export const AGENT_ROUTING_PROFILES_V1: readonly ["ANALYSIS_MASTER", "ANALYSIS_MONITOR", "CONTEXT_DECISION", "RESEARCH", "SIMULATION", "GENERIC_AGENT_TASK"];
export const AGENT_EXECUTION_REASONING_EFFORTS_V1: readonly ["low", "medium", "high", "xhigh", "max", "ultra"];
export const AGENT_EXECUTION_PROMPT_SOURCES_V1: readonly ["TASK_RENDER_SNAPSHOT", "MISSION_COMPOSITION", "UNBOUND"];
export function resolveAgentExecutionPolicyV1(input?: Record<string, unknown>): {
  ok: boolean;
  reasons: string[];
  policy: Record<string, unknown>;
  snapshot: Record<string, unknown>;
};
export function buildAgentExecutionPolicySnapshotV1(input?: Record<string, unknown>): Record<string, unknown>;
export function agentExecutionPolicyHashV1(input?: Record<string, unknown>): string;

export const AGENT_TASK_RETRY_POLICY_VERSION_V1: "1.0.0";
export function planAgentTaskRetryV1(task?: Record<string, unknown>, command?: Record<string, unknown>, nowUtc?: string | null, nextStatus?: string): Record<string, unknown>;

export const AGENT_TASK_RUN_METRIC_SCHEMA_VERSION_V1: "agent_task_run_metric_v1";
export const AGENT_TASK_RUN_OUTCOMES_V1: readonly ["COMPLETED", "FAILED_RETRYABLE", "FAILED_TERMINAL", "DEAD_LETTERED", "CANCELLED"];
export function buildAgentTaskRunMetricV1(input?: Record<string, unknown>): Record<string, unknown>;

export const AGENT_RUNTIME_ADMIN_POLICY_VERSION_V1: "1.0.0";
export const AGENT_RUNTIME_ADMIN_ACTIONS_V1: readonly ["READ_OVERVIEW", "READ_TASK", "LIST_TASKS", "LIST_DEAD_LETTERS", "LIST_METRICS", "LIST_POOLS", "LIST_EVENTS", "REQUEUE_DEAD_LETTER", "CANCEL_TASK"];
export function authorizeAgentRuntimeAdminActionV1(input?: Record<string, unknown>): {
  ok: boolean;
  status: "accepted" | "rejected";
  reasons: string[];
  command: Record<string, unknown>;
};

export const AGENT_RUNTIME_SCHEDULER_POLICY_VERSION_V1: "1.0.0";
export const AGENT_RUNTIME_SCHEDULER_SCHEMA_VERSION_V1: "agent_runtime_scheduler_policy_v1";
export const AGENT_RUNTIME_SCHEDULER_PLAN_SCHEMA_VERSION_V1: "agent_runtime_scheduler_plan_v1";
export const AGENT_RUNTIME_SCHEDULER_LANES_V1: readonly ["live", "safety", "operations", "replay", "validation", "research", "default"];
export function buildAgentRuntimeSchedulerPolicyV1(input?: Record<string, unknown>): Record<string, unknown>;
export function planAgentRuntimeScheduleV1(input?: Record<string, unknown>): Record<string, unknown>;
export function evaluateAgentRuntimeLaneGateV1(input?: Record<string, unknown>): {
  ok: boolean;
  lane: string;
  allowed: boolean;
  reason: string;
  selected_task_id: string | null;
  blocking_lanes: string[];
  plan_hash: string | null;
};

export const AGENT_WORKER_POOL_POLICY_VERSION_V1: "1.0.0";
export const AGENT_WORKER_POOL_SCHEMA_VERSION_V1: "agent_worker_pool_policy_v1";
export const AGENT_WORKER_POOL_RESOLUTION_SCHEMA_VERSION_V1: "agent_worker_pool_resolution_v1";
export const AGENT_WORKER_POOL_OVERVIEW_SCHEMA_VERSION_V1: "agent_worker_pool_overview_v1";
export const AGENT_WORKER_POOL_IDS_V1: readonly ["live", "safety", "operations", "replay", "validation", "research", "default"];
export function buildAgentWorkerPoolPolicyV1(input?: Record<string, unknown>): Record<string, unknown>;
export function listAgentWorkerPoolsV1(input?: Record<string, unknown>): Record<string, unknown>;
export function resolveAgentWorkerPoolV1(input?: Record<string, unknown>): Record<string, unknown>;
export function evaluateAgentWorkerPoolTaskAccessV1(input?: Record<string, unknown>): Record<string, unknown>;
export function taskTypePatternsForAgentWorkerPoolV1(input?: Record<string, unknown>): string[];
export function summarizeAgentWorkerPoolsV1(input?: Record<string, unknown>): Record<string, unknown>;

export const AGENT_BATCH_JOIN_POLICY_VERSION_V1: "1.0.0";
export const AGENT_BATCH_JOIN_SCHEMA_VERSION_V1: "agent_batch_join_v1";
export const AGENT_BATCH_JOIN_POLICIES_V1: readonly ["ALL", "ANY", "FIRST_SOCK", "QUORUM", "TIMEOUT_WITH_PARTIAL_RESULTS"];
export const AGENT_BATCH_JOIN_STATUSES_V1: readonly ["WAITING", "COMPLETED", "COMPLETED_PARTIAL", "FAILED", "TIMED_OUT"];
export function evaluateAgentBatchJoinPolicyV1(input?: Record<string, unknown>): Record<string, unknown>;

export const RESEARCH_EXPERIMENT_REGISTRY_SCHEMA_VERSION_V1: "research_experiment_registry_v1";
export const RESEARCH_EXPERIMENT_SCHEMA_VERSION_V1: "research_experiment_v1";
export const RESEARCH_HYPOTHESIS_SCHEMA_VERSION_V1: "research_hypothesis_v1";
export const RESEARCH_CANDIDATE_SCHEMA_VERSION_V1: "research_candidate_v1";
export const RESEARCH_EVALUATION_REPORT_SCHEMA_VERSION_V1: "research_evaluation_report_v1";
export const RESEARCH_CANDIDATE_EVALUATION_SUMMARY_VERSION_V1: "research_candidate_evaluation_summary_v1";
export const RESEARCH_EXPERIMENT_STATUSES_V1: readonly ["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED", "ARCHIVED"];
export const RESEARCH_HYPOTHESIS_STATUSES_V1: readonly ["PROPOSED", "TESTING", "SUPPORTED", "FALSIFIED", "INCONCLUSIVE", "RETIRED"];
export const RESEARCH_CANDIDATE_STATUSES_V1: readonly ["IDEA", "BASELINE_REQUIRED", "IN_SIMULATION", "UNDER_REVIEW", "PROMOTION_READY", "REJECTED", "RETIRED"];
export const RESEARCH_CANDIDATE_SOURCE_TYPES_V1: readonly ["AI_GENERATED", "OPERATOR", "DERIVED", "BASELINE"];
export const RESEARCH_EVALUATION_REPORT_KINDS_V1: readonly ["TRAIN", "VALIDATION", "OUT_OF_SAMPLE", "WALK_FORWARD", "ROBUSTNESS", "CONTRADICTORY_REVIEW", "QUALITATIVE_REPLAY", "PORTFOLIO_FIT", "PROMOTION_MATRIX"];
export const RESEARCH_EVALUATION_VERDICTS_V1: readonly ["PASS", "FAIL", "INCONCLUSIVE", "NEEDS_REVIEW"];
export function validateResearchExperimentV1(input?: Record<string, unknown>): Record<string, unknown>;
export function validateResearchHypothesisV1(input?: Record<string, unknown>): Record<string, unknown>;
export function validateResearchCandidateV1(input?: Record<string, unknown>): Record<string, unknown>;
export function validateResearchEvaluationReportV1(input?: Record<string, unknown>): Record<string, unknown>;
export function buildResearchCandidateEvaluationSummaryV1(input?: Record<string, unknown>): Record<string, unknown>;
export function researchExperimentHashV1(input?: Record<string, unknown>): string;
export function researchHypothesisHashV1(input?: Record<string, unknown>): string;
export function researchCandidateHashV1(input?: Record<string, unknown>): string;
export function researchEvaluationReportHashV1(input?: Record<string, unknown>): string;

export const RESEARCH_AGENT_ROLE_CATALOG_VERSION_V1: "1.0.0";
export const RESEARCH_AGENT_ROLE_CATALOG_SCHEMA_VERSION_V1: "research_agent_role_catalog_v1";
export const RESEARCH_AGENT_ROLE_RESOLUTION_SCHEMA_VERSION_V1: "research_agent_role_resolution_v1";
export const RESEARCH_AGENT_ROLE_CAPABILITY_DECISION_SCHEMA_VERSION_V1: "research_agent_role_capability_decision_v1";
export const RESEARCH_INFERENCE_PROFILES_V1: readonly ["STANDARD_RESEARCH", "DEEP_STRATEGY_REVIEW", "SAFETY_REVIEW", "CONTEXT_DECISION"];
export const RESEARCH_AGENT_ROLE_IDS_V1: readonly ["research_planner", "pattern_miner", "strategy_builder", "experiment_agent", "backtest_validator", "robustness_auditor", "regime_analyst", "research_reviewer", "live_performance_monitor"];
export const RESEARCH_PROHIBITED_CAPABILITIES_V1: readonly ["BROKER_ORDER_SUBMIT", "BROKER_ORDER_CANCEL", "BROKER_POSITION_MANAGE", "ORDER_INTENT_CREATE", "EXECUTION_PROVIDER_WRITE"];
export function listResearchAgentRolesV1(input?: Record<string, unknown>): Record<string, unknown>;
export function resolveResearchAgentRoleV1(input?: Record<string, unknown>): Record<string, unknown>;
export function authorizeResearchAgentCapabilityV1(input?: Record<string, unknown>): Record<string, unknown>;
export function buildResearchAgentMissionPolicyV1(input?: Record<string, unknown>): Record<string, unknown>;
export function researchAgentRoleCatalogHashV1(input?: Record<string, unknown>): string;

export const RESEARCH_SCIENTIFIC_PROCESS_VERSION_V1: "1.0.0";
export const RESEARCH_SCIENTIFIC_POLICY_SCHEMA_VERSION_V1: "research_scientific_policy_v1";
export const RESEARCH_HYPOTHESIS_PROTOCOL_SCHEMA_VERSION_V1: "research_hypothesis_protocol_v1";
export const RESEARCH_SCIENTIFIC_MISSION_SCHEMA_VERSION_V1: "research_scientific_mission_v1";
export const RESEARCH_BUDGET_EVALUATION_SCHEMA_VERSION_V1: "research_budget_evaluation_v1";
export const RESEARCH_PROCESS_DECISION_SCHEMA_VERSION_V1: "research_process_decision_v1";
export const RESEARCH_DECISION_AUDIT_SCHEMA_VERSION_V1: "research_decision_audit_v1";
export const RESEARCH_SCIENTIFIC_PHASES_V1: readonly ["HYPOTHESIS", "DATASET_SELECTION", "BASELINE", "CANDIDATE_GENERATION", "SIMULATION", "ROBUSTNESS", "CONTRADICTORY_REVIEW", "DECISION"];
export const RESEARCH_BUDGET_DIMENSIONS_V1: readonly ["tokens", "wall_clock_seconds", "compute_seconds", "simulation_runs", "candidates", "iterations"];
export const RESEARCH_PROCESS_DECISIONS_V1: readonly ["CONTINUE", "WAIT_FOR_EVIDENCE", "STOP_REJECT", "STOP_BUDGET_EXHAUSTED", "PROMOTE_TO_REVIEW", "NEEDS_OPERATOR_REVIEW"];
export const RESEARCH_REQUIRED_EVIDENCE_V1: readonly ["FALSIFIABLE_HYPOTHESIS", "DATASET_SCOPE", "BASELINE_RUN", "VALIDATION_REPORT", "ROBUSTNESS_REPORT", "CONTRADICTORY_REVIEW", "DECISION_AUDIT", "NEGATIVE_RESULT_RECORD"];
export function buildResearchScientificProcessPolicyV1(input?: Record<string, unknown>): Record<string, unknown>;
export function validateResearchHypothesisProtocolV1(input?: Record<string, unknown>): Record<string, unknown>;
export function buildResearchScientificMissionV1(input?: Record<string, unknown>): Record<string, unknown>;
export function evaluateResearchBudgetUsageV1(input?: Record<string, unknown>): Record<string, unknown>;
export function evaluateResearchScientificProcessV1(input?: Record<string, unknown>): Record<string, unknown>;
export function buildResearchDecisionAuditV1(input?: Record<string, unknown>): Record<string, unknown>;
export function researchScientificProcessHashV1(input?: Record<string, unknown>): string;

export const RESEARCH_CANDIDATE_LIFECYCLE_VERSION_V1: "1.0.0";
export const RESEARCH_CANDIDATE_LIFECYCLE_SCHEMA_VERSION_V1: "research_candidate_lifecycle_v1";
export const RESEARCH_CANDIDATE_TRANSITION_SCHEMA_VERSION_V1: "research_candidate_transition_v1";
export const RESEARCH_CANDIDATE_LIFECYCLE_EVENT_SCHEMA_VERSION_V1: "research_candidate_lifecycle_event_v1";
export const RESEARCH_CANDIDATE_COMMANDS_V1: readonly ["START_BASELINE", "SUBMIT_TO_SIMULATION", "REQUEST_REVIEW", "REQUEST_REVISION", "MARK_PROMOTION_READY", "REJECT", "RETIRE"];
export const RESEARCH_CANDIDATE_TERMINAL_STATUSES_V1: readonly ["REJECTED", "RETIRED"];
export function buildResearchCandidateLifecyclePolicyV1(input?: Record<string, unknown>): Record<string, unknown>;
export function transitionResearchCandidateLifecycleV1(candidate?: Record<string, unknown>, command?: Record<string, unknown>): Record<string, unknown>;
export function validateResearchCandidateLifecycleSnapshotV1(candidate?: Record<string, unknown>): Record<string, unknown>;
export function researchCandidateLifecycleHashV1(input?: Record<string, unknown>): string;

export function isTradeOutcomeMonetaryProofValid(outcome?: Record<string, unknown> | null): boolean;
export const RESEARCH_CANDIDATE_GENOME_VERSION_V1: "1.0.0";
export const RESEARCH_CANDIDATE_GENOME_SCHEMA_VERSION_V1: "research_candidate_genome_v1";
export const RESEARCH_CANDIDATE_NOVELTY_SCHEMA_VERSION_V1: "research_candidate_novelty_v1";
export const RESEARCH_CANDIDATE_KNOWLEDGE_NODE_SCHEMA_VERSION_V1: "research_candidate_knowledge_node_v1";
export const RESEARCH_STRATEGY_FAMILIES_V1: readonly ["BREAKOUT_RETEST", "MOMENTUM_CONTINUATION", "MEAN_REVERSION", "RANGE_ROTATION", "VOLATILITY_EXPANSION", "EVENT_DRIVEN", "CROSS_ASSET_CONFIRMATION", "RISK_MANAGEMENT_VARIANT", "UNKNOWN"];
export const RESEARCH_MARKET_REGIMES_V1: readonly ["TREND", "RANGE", "LOW_VOL_COMPRESSION", "VOLATILITY_EXPANSION", "EVENT_WINDOW", "CROSS_ASSET_DIVERGENCE", "UNKNOWN"];
export const RESEARCH_NOVELTY_DECISIONS_V1: readonly ["NOVEL", "TOO_CLOSE", "DUPLICATE", "REVIEW"];
export function buildResearchCandidateGenomeV1(input?: Record<string, unknown>): Record<string, unknown>;
export function compareResearchCandidateGenomesV1(left?: Record<string, unknown>, right?: Record<string, unknown>): Record<string, unknown>;
export function evaluateResearchCandidateNoveltyV1(input?: Record<string, unknown>): Record<string, unknown>;
export function buildResearchCandidateKnowledgeNodeV1(input?: Record<string, unknown>): Record<string, unknown>;
export function researchCandidateGenomeHashV1(input?: Record<string, unknown>): string;

export const RESEARCH_FAILURE_MEMORY_VERSION_V1: "1.0.0", RESEARCH_FAILURE_RECORD_SCHEMA_VERSION_V1: "research_failure_record_v1", RESEARCH_FAILURE_MEMORY_QUERY_SCHEMA_VERSION_V1: "research_failure_memory_query_v1", RESEARCH_FAILURE_MATCH_SCHEMA_VERSION_V1: "research_failure_match_v1", RESEARCH_FAILURE_KNOWLEDGE_NODE_SCHEMA_VERSION_V1: "research_failure_knowledge_node_v1";
export const RESEARCH_FAILURE_RECORD_STATUSES_V1: readonly ["ACTIVE", "SUPERSEDED", "RETIRED"], RESEARCH_FAILURE_CAUSE_CODES_V1: readonly ["LOW_EDGE", "OVERFIT", "REGIME_DEPENDENT", "INSUFFICIENT_SAMPLE", "HIGH_DRAWDOWN", "POOR_RR", "EXECUTION_FRICTION", "DUPLICATE_OR_TOO_CLOSE", "DATA_QUALITY", "CONTRACT_VIOLATION", "OPERATOR_REJECTED", "UNKNOWN"], RESEARCH_FAILURE_MEMORY_DECISIONS_V1: readonly ["BLOCK_RETEST", "REQUIRE_REVISION", "ALLOW_WITH_MEMORY", "NO_MATCH"];
export const buildResearchFailureRecordV1: (input?: Record<string, unknown>) => Record<string, unknown>, matchResearchFailureMemoryV1: (input?: Record<string, unknown>) => Record<string, unknown>, evaluateResearchFailureMemoryGateV1: (input?: Record<string, unknown>) => Record<string, unknown>, buildResearchFailureKnowledgeNodeV1: (input?: Record<string, unknown>) => Record<string, unknown>, researchFailureMemoryHashV1: (input?: Record<string, unknown>) => string;
export const RESEARCH_KNOWLEDGE_GRAPH_VERSION_V1: "1.0.0", RESEARCH_KNOWLEDGE_GRAPH_SCHEMA_VERSION_V1: "research_knowledge_graph_v1", RESEARCH_KNOWLEDGE_NODE_SCHEMA_VERSION_V1: "research_knowledge_node_v1", RESEARCH_KNOWLEDGE_EDGE_SCHEMA_VERSION_V1: "research_knowledge_edge_v1", RESEARCH_KNOWLEDGE_QUERY_SCHEMA_VERSION_V1: "research_knowledge_query_v1";
export const RESEARCH_KNOWLEDGE_NODE_TYPES_V1: readonly string[], RESEARCH_KNOWLEDGE_EDGE_TYPES_V1: readonly string[];
export const buildResearchKnowledgeNodeV1: (input?: Record<string, unknown>) => Record<string, unknown>, buildResearchKnowledgeEdgeV1: (input?: Record<string, unknown>) => Record<string, unknown>, buildResearchKnowledgeGraphV1: (input?: Record<string, unknown>) => Record<string, unknown>, buildResearchKnowledgeGraphFromArtifactsV1: (input?: Record<string, unknown>) => Record<string, unknown>, queryResearchKnowledgeGraphV1: (graphInput?: Record<string, unknown>, query?: Record<string, unknown>) => Record<string, unknown>, summarizeResearchKnowledgeGraphV1: (graph?: Record<string, unknown>) => Record<string, unknown>, researchKnowledgeGraphHashV1: (input?: Record<string, unknown>) => string;
export const RESEARCH_COVERAGE_PRIORITY_VERSION_V1: "1.0.0", RESEARCH_COVERAGE_MODEL_SCHEMA_VERSION_V1: "research_coverage_model_v1", RESEARCH_PRIORITY_SCORE_SCHEMA_VERSION_V1: "research_priority_score_v1", RESEARCH_PRIORITY_PLAN_SCHEMA_VERSION_V1: "research_priority_plan_v1", RESEARCH_COVERAGE_FRONT_SUMMARY_SCHEMA_VERSION_V1: "research_coverage_front_summary_v1";
export const RESEARCH_COVERAGE_DIMENSIONS_V1: readonly string[], RESEARCH_PRIORITY_DECISIONS_V1: readonly string[], RESEARCH_PRIORITY_WEIGHTS_V1: Readonly<Record<string, number>>;
export const buildResearchCoverageModelV1: (input?: Record<string, unknown>) => Record<string, unknown>, scoreResearchPriorityV1: (input?: Record<string, unknown>) => Record<string, unknown>, rankResearchPrioritiesV1: (input?: Record<string, unknown>) => Record<string, unknown>, summarizeResearchCoverageForFrontV1: (input?: Record<string, unknown>) => Record<string, unknown>, researchCoveragePriorityHashV1: (input?: Record<string, unknown>) => string;
export const RESEARCH_STRATEGY_GENERATION_WORKFLOW_VERSION_V1: "1.0.0", RESEARCH_STRATEGY_GENERATION_POLICY_SCHEMA_VERSION_V1: "research_strategy_generation_policy_v1", RESEARCH_STRATEGY_GENERATION_PLAN_SCHEMA_VERSION_V1: "research_strategy_generation_plan_v1", RESEARCH_STRATEGY_GENERATION_WORK_ITEM_SCHEMA_VERSION_V1: "research_strategy_generation_work_item_v1";
export const RESEARCH_STRATEGY_GENERATION_PHASES_V1: readonly string[], RESEARCH_STRATEGY_GENERATION_DECISIONS_V1: readonly string[];
export const buildResearchStrategyGenerationPolicyV1: (input?: Record<string, unknown>) => Record<string, unknown>, planResearchStrategyGenerationWorkflowV1: (input?: Record<string, unknown>) => Record<string, unknown>, buildResearchStrategyGenerationWorkItemsV1: (input?: Record<string, unknown>) => Record<string, unknown>[], researchStrategyGenerationWorkflowHashV1: (input?: Record<string, unknown>) => string;
export const RESEARCH_CONTRADICTORY_VALIDATION_WORKFLOW_VERSION_V1: "1.0.0", RESEARCH_CONTRADICTORY_VALIDATION_POLICY_SCHEMA_VERSION_V1: "research_contradictory_validation_policy_v1", RESEARCH_CONTRADICTORY_VALIDATION_PLAN_SCHEMA_VERSION_V1: "research_contradictory_validation_plan_v1", RESEARCH_CONTRADICTORY_VALIDATION_WORK_ITEM_SCHEMA_VERSION_V1: "research_contradictory_validation_work_item_v1";
export const RESEARCH_CONTRADICTORY_VALIDATION_PHASES_V1: readonly string[], RESEARCH_CONTRADICTORY_VALIDATION_DECISIONS_V1: readonly string[];
export const buildResearchContradictoryValidationPolicyV1: (input?: Record<string, unknown>) => Record<string, unknown>, planResearchContradictoryValidationWorkflowV1: (input?: Record<string, unknown>) => Record<string, unknown>, buildResearchContradictoryValidationWorkItemsV1: (input?: Record<string, unknown>) => Record<string, unknown>[], researchContradictoryValidationWorkflowHashV1: (input?: Record<string, unknown>) => string;
export const RESEARCH_PROMOTION_MATRIX_VERSION_V1: "1.0.0", RESEARCH_PROMOTION_MATRIX_POLICY_SCHEMA_VERSION_V1: "research_promotion_matrix_policy_v1", RESEARCH_PROMOTION_MATRIX_DECISION_SCHEMA_VERSION_V1: "research_promotion_matrix_decision_v1", RESEARCH_OPERATOR_APPROVAL_SCHEMA_VERSION_V1: "research_operator_approval_v1", RESEARCH_PROMOTION_ROLLBACK_PLAN_SCHEMA_VERSION_V1: "research_promotion_rollback_plan_v1";
export const RESEARCH_PROMOTION_DECISIONS_V1: readonly string[], RESEARCH_OPERATOR_APPROVAL_STATUSES_V1: readonly string[];
export const buildResearchPromotionMatrixPolicyV1: (input?: Record<string, unknown>) => Record<string, unknown>, evaluateResearchPromotionMatrixV1: (input?: Record<string, unknown>) => Record<string, unknown>, normalizeOperatorApprovalV1: (input?: Record<string, unknown>) => Record<string, unknown>, buildResearchPromotionRollbackPlanV1: (input?: Record<string, unknown>) => Record<string, unknown>, researchPromotionMatrixHashV1: (input?: Record<string, unknown>) => string;
