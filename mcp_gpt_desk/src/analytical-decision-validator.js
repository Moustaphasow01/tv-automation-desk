import { deskError } from "./desk-errors.js";
import {
  ANALYTICAL_DECISION_INTENTS,
  ANALYTICAL_DECISION_VALIDATION_SCHEMA_VERSION,
} from "./analytical-journey-catalog.js";
import {
  hashAnalyticalPayload,
  verifyAnalyticalEvidenceReceipt,
} from "./analytical-evidence-receipts.js";
import {
  assertAnalyticalJourneyIntegrity,
  buildAnalyticalCoverageMatrix,
} from "./analytical-journey.js";

export function validateAnalyticalDecision({
  journey,
  decision,
  intent,
  validatedAtUtc = new Date().toISOString(),
} = {}) {
  assertAnalyticalJourneyIntegrity(journey);
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    throw deskError(
      "ANALYTICAL_DECISION_REQUIRED",
      "Decision must be a JSON object validated by the backend.",
    );
  }
  const normalizedIntent = normalizeIntent(intent);
  const timestamp = normalizeTimestamp(validatedAtUtc);
  const decisionHash = hashAnalyticalPayload(decision);
  const matrix = buildAnalyticalCoverageMatrix(journey);
  const structuralViolations = [];
  const policyViolations = [];
  const warnings = [];

  if (!matrix.summary.mandatory_traversal_complete) {
    structuralViolations.push({
      code: "ANALYTICAL_DECISION_TRAVERSAL_INCOMPLETE",
      phases: matrix.summary.pending_phases,
    });
  }
  if (!matrix.summary.mandatory_evidence_accounted) {
    structuralViolations.push({
      code: "ANALYTICAL_DECISION_EVIDENCE_INCOMPLETE",
      phases: matrix.rows
        .filter((row) => row.missing_evidence_kinds.length)
        .map((row) => ({
          phase: row.phase,
          missing_evidence_kinds: row.missing_evidence_kinds,
        })),
    });
  }

  const conclusion = journey.phases.find((phase) => phase.phase === "CONCLUSION");
  if (!["COMPLETE", "DEGRADED"].includes(conclusion?.status)) {
    structuralViolations.push({
      code: "ANALYTICAL_DECISION_CONCLUSION_NOT_COMPLETED",
      status: conclusion?.status || null,
    });
  }
  const conclusionReceipts = new Set(conclusion?.evidence_receipt_ids || []);
  const decisionReceipt = journey.evidence_receipts.find((receipt) => (
    conclusionReceipts.has(receipt.receipt_id)
    && receipt.phase === "CONCLUSION"
    && receipt.evidence_kind === "ANALYTICAL_CONCLUSION"
    && receipt.availability !== "UNAVAILABLE"
    && receipt.availability !== "BLOCKED"
    && receipt.content_hash === decisionHash
    && receipt.content_hash_origin === "BACKEND_HASHED_PAYLOAD"
  ));
  if (!decisionReceipt) {
    structuralViolations.push({
      code: "ANALYTICAL_DECISION_RECEIPT_MISMATCH",
      expected_decision_hash: decisionHash,
    });
  } else {
    const verification = verifyAnalyticalEvidenceReceipt(decisionReceipt, {
      journeyId: journey.journey_id,
      phase: "CONCLUSION",
      cutoffUtc: journey.cutoff_utc,
    });
    if (!verification.valid) {
      structuralViolations.push({
        code: "ANALYTICAL_DECISION_RECEIPT_INVALID",
        violations: verification.violations,
      });
    }
  }

  if (normalizedIntent === "RISK_INCREASING") {
    if (matrix.summary.blocked_phases.length) {
      policyViolations.push({
        code: "ANALYTICAL_DECISION_BLOCKED_PHASE",
        phases: matrix.summary.blocked_phases,
      });
    }
    if (matrix.summary.unavailable_hard_phases.length) {
      policyViolations.push({
        code: "ANALYTICAL_DECISION_HARD_EVIDENCE_UNAVAILABLE",
        phases: matrix.summary.unavailable_hard_phases,
      });
    }
  } else {
    if (matrix.summary.blocked_phases.length) {
      warnings.push({
        code: "ANALYTICAL_BLOCKED_PHASE_RISK_INCREASE_FORBIDDEN",
        phases: matrix.summary.blocked_phases,
      });
    }
    if (matrix.summary.unavailable_hard_phases.length) {
      warnings.push({
        code: "ANALYTICAL_HARD_EVIDENCE_UNAVAILABLE_RISK_INCREASE_FORBIDDEN",
        phases: matrix.summary.unavailable_hard_phases,
      });
    }
  }
  if (matrix.summary.degraded_phases.length) {
    warnings.push({
      code: "ANALYTICAL_DECISION_DEGRADED_CONTEXT",
      phases: matrix.summary.degraded_phases,
    });
  }

  const violations = [...structuralViolations, ...policyViolations];
  const validationCore = {
    schema_version: ANALYTICAL_DECISION_VALIDATION_SCHEMA_VERSION,
    issuer: "DESK_BACKEND",
    journey_id: journey.journey_id,
    journey_hash: journey.journey_hash,
    journey_revision: journey.revision,
    coverage_matrix_hash: matrix.matrix_hash,
    decision_hash: decisionHash,
    decision_intent: normalizedIntent,
    structurally_valid: structuralViolations.length === 0,
    policy_valid: policyViolations.length === 0,
    decision_allowed: violations.length === 0,
    status: violations.length
      ? "REJECTED"
      : warnings.length
        ? "APPROVED_DEGRADED"
        : "APPROVED",
    violations,
    warnings,
    validated_at_utc: timestamp,
    conclusion_receipt_id: decisionReceipt?.receipt_id || null,
    conclusion_receipt_hash: decisionReceipt?.receipt_hash || null,
  };
  const validationHash = hashAnalyticalPayload(validationCore);
  return deepFreeze({
    ...validationCore,
    validation_id: `analytical_validation_${validationHash.slice(0, 32)}`,
    validation_hash: validationHash,
  });
}

export function assertAnalyticalDecisionAllowed(input) {
  const validation = validateAnalyticalDecision(input);
  if (validation.decision_allowed) return validation;
  throw deskError(
    "ANALYTICAL_DECISION_REJECTED",
    "The decision did not pass the mandatory analytical journey gate.",
    validation,
  );
}

function normalizeIntent(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!ANALYTICAL_DECISION_INTENTS.includes(normalized)) {
    throw deskError(
      "ANALYTICAL_DECISION_INTENT_INVALID",
      "Decision intent must be classified by the backend before validation.",
      {
        intent: value ?? null,
        supported_intents: ANALYTICAL_DECISION_INTENTS,
      },
    );
  }
  return normalized;
}

function normalizeTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    throw deskError(
      "ANALYTICAL_DECISION_TIMESTAMP_INVALID",
      "Decision validation timestamp must be ISO-8601.",
      { value: value ?? null },
    );
  }
  return new Date(parsed).toISOString();
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
