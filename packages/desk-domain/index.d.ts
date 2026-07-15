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
