import { deskError } from "./desk-errors.js";
import { analyticalPhaseDefinition } from "./analytical-journey-catalog.js";
import {
  buildAnalyticalResearchProgress,
  completeAnalyticalPhase,
  recordAnalyticalEvidence,
  startAnalyticalPhase,
} from "./analytical-journey.js";

const MCP_STATUS_TO_AVAILABILITY = Object.freeze({
  AVAILABLE: "AVAILABLE",
  COMPLETE: "AVAILABLE",
  OK: "AVAILABLE",
  READY: "AVAILABLE",
  SUCCESS: "AVAILABLE",
  DEGRADED: "DEGRADED",
  PARTIAL: "DEGRADED",
  STALE: "DEGRADED",
  UNAVAILABLE: "UNAVAILABLE",
  MISSING: "UNAVAILABLE",
  NO_DATA: "UNAVAILABLE",
  BLOCKED: "BLOCKED",
  ERROR: "BLOCKED",
  FAILED: "BLOCKED",
});

export function recordMcpAnalyticalContextReceipt(journey, {
  phase,
  tool,
  status,
  result_sha256: resultSha256,
  evidence_count: evidenceCount = 0,
  evidence_kind: evidenceKind,
  effective_at_utc: effectiveAtUtc,
  source_ref: sourceRef,
  source_version: sourceVersion,
  reason_codes: reasonCodes,
  quality_flags: qualityFlags,
  receipt_id: mcpReceiptId,
} = {}, {
  actor = "desk_backend:mcp_context",
  atUtc = new Date().toISOString(),
} = {}) {
  const definition = analyticalPhaseDefinition(phase);
  if (!definition) {
    throw integrationError(
      "ANALYTICAL_MCP_PHASE_INVALID",
      "MCP context receipt targets an unknown analytical phase.",
      { phase: phase ?? null },
    );
  }
  const normalizedTool = requiredString(tool, "tool");
  const normalizedStatus = String(status || "").trim().toUpperCase();
  const availability = MCP_STATUS_TO_AVAILABILITY[normalizedStatus];
  if (!availability) {
    throw integrationError(
      "ANALYTICAL_MCP_STATUS_INVALID",
      "MCP context status cannot be mapped to analytical evidence availability.",
      { status: status ?? null },
    );
  }
  const normalizedEvidenceCount = nonNegativeInteger(evidenceCount, "evidence_count");
  const normalizedReasonCodes = normalizeCodes(reasonCodes);
  if (availability !== "AVAILABLE" && normalizedReasonCodes.length === 0) {
    normalizedReasonCodes.push(`MCP_CONTEXT_${normalizedStatus}`);
  }
  return recordAnalyticalEvidence(journey, {
    phase: definition.phase,
    actor,
    atUtc,
    evidence: {
      evidence_kind: evidenceKind || definition.required_evidence_kinds[0],
      availability,
      source: {
        source_type: "MCP_TOOL_RESULT",
        source_id: normalizedTool,
        source_version: sourceVersion || null,
        source_ref: sourceRef || (mcpReceiptId ? `mcp-receipt:${mcpReceiptId}` : null),
      },
      source_hash: resultSha256 || null,
      effective_at_utc: effectiveAtUtc || journey.cutoff_utc,
      reason_codes: normalizedReasonCodes,
      quality_flags: normalizeCodes(qualityFlags),
      metadata: {
        mcp_status: normalizedStatus,
        mcp_evidence_count: normalizedEvidenceCount,
        mcp_receipt_id: mcpReceiptId || null,
      },
    },
  });
}

export function applyValidatedOpportunityPhase(journey, {
  output,
  sourceId,
  validationId,
  summary,
  availability = "AVAILABLE",
  reasonCodes = [],
  actor = "desk_backend:validated_output",
  atUtc = new Date().toISOString(),
  toolCallsByPhase = {},
} = {}) {
  return applyValidatedOutputPhase(journey, {
    phase: "OPPORTUNITY",
    evidenceKind: "OPPORTUNITY_SET",
    output,
    sourceId,
    validationId,
    summary,
    availability,
    reasonCodes,
    actor,
    atUtc,
    toolCallsByPhase,
  });
}

export function applyValidatedConclusionPhase(journey, {
  decision,
  sourceId,
  validationId,
  summary,
  availability = "AVAILABLE",
  reasonCodes = [],
  actor = "desk_backend:validated_output",
  atUtc = new Date().toISOString(),
  toolCallsByPhase = {},
} = {}) {
  return applyValidatedOutputPhase(journey, {
    phase: "CONCLUSION",
    evidenceKind: "ANALYTICAL_CONCLUSION",
    output: decision,
    sourceId,
    validationId,
    summary,
    availability,
    reasonCodes,
    actor,
    atUtc,
    toolCallsByPhase,
  });
}

function applyValidatedOutputPhase(journey, {
  phase,
  evidenceKind,
  output,
  sourceId,
  validationId,
  summary,
  availability,
  reasonCodes,
  actor,
  atUtc,
  toolCallsByPhase,
}) {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw integrationError(
      "ANALYTICAL_VALIDATED_OUTPUT_REQUIRED",
      "Validated analytical output must be a JSON object.",
      { phase },
    );
  }
  const normalizedAvailability = String(availability || "").trim().toUpperCase();
  if (!["AVAILABLE", "DEGRADED"].includes(normalizedAvailability)) {
    throw integrationError(
      "ANALYTICAL_VALIDATED_OUTPUT_AVAILABILITY_INVALID",
      "A validated output can only be available or degraded.",
      { phase, availability: availability ?? null },
    );
  }
  const normalizedReasonCodes = normalizeCodes(reasonCodes);
  if (normalizedAvailability === "DEGRADED" && normalizedReasonCodes.length === 0) {
    throw integrationError(
      "ANALYTICAL_VALIDATED_OUTPUT_REASON_REQUIRED",
      "A degraded validated output requires a backend reason code.",
      { phase },
    );
  }
  const started = startAnalyticalPhase(journey, { phase, actor, atUtc });
  const recorded = recordAnalyticalEvidence(started, {
    phase,
    actor,
    atUtc,
    evidence: {
      evidence_kind: evidenceKind,
      availability: normalizedAvailability,
      source: {
        source_type: "VALIDATED_ANALYTICAL_OUTPUT",
        source_id: requiredString(sourceId, "sourceId"),
        source_version: validationId ? String(validationId) : null,
        source_ref: validationId ? `validation:${validationId}` : null,
      },
      payload: output,
      effective_at_utc: journey.cutoff_utc,
      reason_codes: normalizedReasonCodes,
      metadata: {
        validation_id: validationId || null,
        backend_validated: true,
      },
    },
  });
  const completed = completeAnalyticalPhase(recorded.journey, {
    phase,
    summary,
    actor,
    atUtc,
  });
  return Object.freeze({
    journey: completed,
    receipt: recorded.receipt,
    progress: buildAnalyticalResearchProgress(completed, { toolCallsByPhase }),
  });
}

function normalizeCodes(values) {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) {
    throw integrationError(
      "ANALYTICAL_INTEGRATION_CODES_INVALID",
      "Reason codes and quality flags must be arrays.",
    );
  }
  return [...new Set(values.map((value) => {
    const normalized = String(value || "").trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,79}$/.test(normalized)) {
      throw integrationError(
        "ANALYTICAL_INTEGRATION_CODE_INVALID",
        "Reason codes and quality flags must be uppercase symbolic names.",
        { value: value ?? null },
      );
    }
    return normalized;
  }))].sort();
}

function nonNegativeInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw integrationError(
      "ANALYTICAL_INTEGRATION_COUNT_INVALID",
      `${field} must be a finite non-negative integer.`,
      { field, value },
    );
  }
  return Math.floor(parsed);
}

function requiredString(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw integrationError(
      "ANALYTICAL_INTEGRATION_FIELD_REQUIRED",
      `${field} is required.`,
      { field },
    );
  }
  return normalized;
}

function integrationError(code, message, details = {}) {
  return deskError(code, message, details);
}
