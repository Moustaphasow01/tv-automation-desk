export type AuditStatus = "accepted" | "rejected" | "review_required";

export type AuditResult = {
  ok: boolean;
  status: AuditStatus;
  reasons: string[];
  flags: string[];
  evidence: Record<string, unknown>;
};

export type DecisionAuditEnvelopeResult = AuditResult & {
  audit: Record<string, unknown> | null;
  record: Record<string, unknown> | null;
};

export type DecisionAuditLifecycleResult = AuditResult & {
  audit: Record<string, unknown> | null;
  record: Record<string, unknown> | null;
};

export type DecisionAuditCorrectionResult = AuditResult & {
  correction: Record<string, unknown> | null;
  record: Record<string, unknown> | null;
};

export const DOMAIN_STATUSES: {
  ACCEPTED: "accepted";
  REJECTED: "rejected";
  REVIEW_REQUIRED: "review_required";
};

export function accepted(options?: Record<string, unknown>): AuditResult;
export function rejected(reason: string, options?: Record<string, unknown>): AuditResult;
export function reviewRequired(reason: string, options?: Record<string, unknown>): AuditResult;
export function domainResult(options?: Record<string, unknown>): AuditResult;
export function resultFromIssues(options?: Record<string, unknown>): AuditResult;

export function buildDecisionAuditEnvelope(input?: Record<string, unknown>, options?: Record<string, unknown>): DecisionAuditEnvelopeResult;
export function evaluateAntiLookahead(options?: Record<string, unknown>): AuditResult;
export function finalizeDecisionAudit(audit?: Record<string, unknown>, options?: Record<string, unknown>): DecisionAuditLifecycleResult;
export function assertDecisionAuditWritable(existingAudit?: Record<string, unknown> | null, candidateAudit?: Record<string, unknown>, options?: Record<string, unknown>): AuditResult;
export function createDecisionAuditCorrection(existingAudit?: Record<string, unknown>, correction?: Record<string, unknown>, options?: Record<string, unknown>): DecisionAuditCorrectionResult;
export function isDecisionAuditFinalized(audit?: Record<string, unknown>): boolean;
export function decisionAuditContentHash(audit?: Record<string, unknown>): string;
