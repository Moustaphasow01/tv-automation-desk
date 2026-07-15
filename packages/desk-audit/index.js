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
