import {
  applyValidatedConclusionPhase,
  applyValidatedOpportunityPhase,
  assertAnalyticalDecisionAllowed,
  buildAnalyticalResearchProgress,
  completeAnalyticalPhase,
  createAnalyticalJourney,
  recordMcpAnalyticalContextReceipt,
  startAnalyticalPhase,
} from "./analytical-journey-api.js";
import {
  verifyDeskContextEvidenceReceipt,
} from "./desk-ai-context-capability.js";

const CONTEXT_PHASE_TO_PRIMARY_TOOL = Object.freeze({
  CONTINUITY: "get_continuity_context",
  CORE_MARKET: "get_market_context",
  INDEX_CONFIRMATION: "get_market_context",
  CROSS_ASSET: "get_market_context",
  MEGACAPS: "get_market_context",
  MACRO: "get_macro_context",
  NEWS: "get_news_context",
  THESIS_EVOLUTION: "get_thesis_evolution_context",
});

const CONTEXT_PHASES = Object.freeze(Object.keys(CONTEXT_PHASE_TO_PRIMARY_TOOL));

export function buildDeskAiResearchSession({
  envelope,
  analysisOutput,
  contextEvidenceReceipts = [],
  contextCapability,
  startedAtUtc = new Date().toISOString(),
  completedAtUtc = new Date().toISOString(),
} = {}) {
  if (!envelope?.job_id || !envelope?.scope || !envelope?.workflow) {
    throw researchError(
      "AI_ANALYTICAL_JOURNEY_ENVELOPE_INVALID",
      "A complete Desk AI envelope is required for analytical coverage.",
    );
  }
  if (!analysisOutput || typeof analysisOutput !== "object" || Array.isArray(analysisOutput)) {
    throw researchError(
      "AI_ANALYTICAL_JOURNEY_OUTPUT_INVALID",
      "A structurally validated analytical output is required.",
    );
  }
  const contextJourney = buildDeskAiContextJourney({
    envelope,
    contextEvidenceReceipts,
    contextCapability,
    startedAtUtc,
    updatedAtUtc: completedAtUtc,
  });
  const {
    receiptProtocol,
    toolCallsByPhase,
    cutoffUtc,
  } = contextJourney;
  let { journey, journeyClockMs } = contextJourney;

  const contextTraversalComplete = CONTEXT_PHASES.every((phase) => (
    journey.phases.find((entry) => entry.phase === phase)?.status !== "NOT_STARTED"
  ));
  if (contextTraversalComplete) {
    journeyClockMs = Math.max(journeyClockMs, Date.parse(normalizeIso(completedAtUtc)));
    const outputAtUtc = new Date(journeyClockMs).toISOString();
    const dataQualityDegraded = analysisOutput.data_quality_status === "degraded";
    const validationId = `structural_${envelope.envelope_hash}`;
    const opportunity = applyValidatedOpportunityPhase(journey, {
      output: extractOpportunityOutput(analysisOutput),
      sourceId: envelope.job_id,
      validationId,
      summary: String(analysisOutput.decision_summary || "Opportunity set evaluated.").slice(0, 2_000),
      availability: dataQualityDegraded ? "DEGRADED" : "AVAILABLE",
      reasonCodes: dataQualityDegraded ? ["ANALYSIS_DATA_QUALITY_DEGRADED"] : [],
      actor: "desk_backend:validated_output",
      atUtc: outputAtUtc,
      toolCallsByPhase,
    });
    journey = opportunity.journey;
    const conclusion = applyValidatedConclusionPhase(journey, {
      decision: analysisOutput,
      sourceId: envelope.job_id,
      validationId,
      summary: String(analysisOutput.decision_summary || "Analytical conclusion produced.").slice(0, 2_000),
      availability: dataQualityDegraded ? "DEGRADED" : "AVAILABLE",
      reasonCodes: dataQualityDegraded ? ["ANALYSIS_DATA_QUALITY_DEGRADED"] : [],
      actor: "desk_backend:validated_output",
      atUtc: outputAtUtc,
      toolCallsByPhase,
    });
    journey = conclusion.journey;
  }

  const progress = buildAnalyticalResearchProgress(journey, { toolCallsByPhase });
  return {
    journey,
    progress,
    tool_calls_by_phase: toolCallsByPhase,
    context_catalog_verified: receiptProtocol.catalog_complete,
    decision: analysisOutput,
    decision_intent: classifyDeskAiDecisionIntent(analysisOutput),
  };
}

export function buildDeskAiContextResearchProgress({
  envelope,
  contextEvidenceReceipts = [],
  contextCapability,
  startedAtUtc = new Date().toISOString(),
  updatedAtUtc = new Date().toISOString(),
} = {}) {
  if (!envelope?.job_id || !envelope?.scope || !envelope?.workflow) {
    throw researchError(
      "AI_ANALYTICAL_JOURNEY_ENVELOPE_INVALID",
      "A complete Desk AI envelope is required for analytical progress.",
    );
  }
  const contextJourney = buildDeskAiContextJourney({
    envelope,
    contextEvidenceReceipts,
    contextCapability,
    startedAtUtc,
    updatedAtUtc,
  });
  return {
    journey: contextJourney.journey,
    progress: buildAnalyticalResearchProgress(contextJourney.journey, {
      toolCallsByPhase: contextJourney.toolCallsByPhase,
    }),
    tool_calls_by_phase: contextJourney.toolCallsByPhase,
    context_catalog_verified: contextJourney.receiptProtocol.catalog_complete,
  };
}

export function assertDeskAiResearchSessionAllowed(session) {
  if (!session?.journey || !session?.decision || !session?.decision_intent) {
    throw researchError(
      "AI_ANALYTICAL_JOURNEY_REQUIRED",
      "The analytical journey was not materialized before the save boundary.",
      undefined,
      true,
    );
  }
  try {
    const validation = assertAnalyticalDecisionAllowed({
      journey: session.journey,
      decision: session.decision,
      intent: session.decision_intent,
    });
    return { ...session, validation };
  } catch (error) {
    throw researchError(
      "AI_ANALYTICAL_RESEARCH_INCOMPLETE",
      "The mandatory analytical journey did not pass the backend save gate.",
      {
        cause_code: error?.code || null,
        cause: String(error?.message || error),
        validation: error?.details || null,
        research_progress: session.progress,
      },
      true,
    );
  }
}

export function classifyDeskAiDecisionIntent(output = {}) {
  const native = output.save_payload?.analysis_output || output.save_payload?.monitor_output || {};
  const setups = native.execution_plan?.setups;
  if (Array.isArray(setups) && setups.length > 0) return "RISK_INCREASING";
  const command = native.command || {};
  const setupCommand = String(
    command.setup_transition?.command
      || command.setup_transition?.type
      || command.setup_command?.type
      || "",
  ).toUpperCase();
  if (["ARM", "PRE_ARM", "UPSERT_CANDIDATE", "REPLACE"].includes(setupCommand)) {
    return "RISK_INCREASING";
  }
  if (["CANCEL", "EXPIRE", "INVALIDATE"].includes(setupCommand)) {
    return "RISK_REDUCING";
  }
  if (command.management_request || command.position_transition) {
    return "POSITION_MANAGEMENT";
  }
  return "NO_RISK_CHANGE";
}

function selectOrderedPrimaryPhaseReceipt(phase, receipts, afterIndex) {
  const primaryTool = CONTEXT_PHASE_TO_PRIMARY_TOOL[phase];
  const phaseOrdinal = CONTEXT_PHASES.indexOf(phase);
  const start = receipts.findIndex((receipt, index) => (
    index > afterIndex
    && String(receipt?.phase || "").toUpperCase() === phase
    && receipt?.tool === primaryTool
  ));
  if (start < 0) return null;
  let selectedIndex = start;
  for (let index = start + 1; index < receipts.length; index += 1) {
    const receiptPhase = String(receipts[index]?.phase || "").toUpperCase();
    const receiptOrdinal = CONTEXT_PHASES.indexOf(receiptPhase);
    if (receiptOrdinal > phaseOrdinal) break;
    if (receiptPhase === phase && receipts[index]?.tool === primaryTool) {
      selectedIndex = index;
    }
  }
  return {
    receipt: receipts[selectedIndex],
    index: selectedIndex,
  };
}

function buildDeskAiContextJourney({
  envelope,
  contextEvidenceReceipts,
  contextCapability,
  startedAtUtc,
  updatedAtUtc,
}) {
  const receiptProtocol = validateContextEvidenceProtocol({
    envelope,
    capability: contextCapability,
    receipts: contextEvidenceReceipts,
  });
  const verifiedContextReceipts = receiptProtocol.receipts;
  const cutoffUtc = resolveEnvelopeCutoffUtc(envelope);
  const toolCallsByPhase = countToolCallsByPhase(verifiedContextReceipts);
  let journeyClockMs = Date.parse(normalizeIso(startedAtUtc));
  let journey = createAnalyticalJourney({
    journeyId: `analytical_journey_${envelope.job_id}`,
    scope: envelope.scope,
    workflow: envelope.workflow,
    cutoffUtc,
    identity: {
      job_id: envelope.job_id,
      envelope_hash: envelope.envelope_hash,
      worker_id: envelope.worker_id,
      workflow: envelope.workflow,
      claim_handle: redactClaimIdentity(envelope.claim_handle),
      bundle_id: envelope.bundle?.bundle_id || envelope.suggested_payload?.bundle_id || null,
      pack_id: envelope.bundle?.pack_id
        || envelope.bundle?.pack?.pack_id
        || envelope.suggested_payload?.pack_id
        || null,
      pack_build_id: envelope.bundle?.pack_build_id
        || envelope.bundle?.pack?.pack_build_id
        || envelope.suggested_payload?.pack_build_id
        || null,
    },
    actor: "desk_backend:ai_worker",
    createdAtUtc: normalizeIso(startedAtUtc),
  });

  let receiptCursor = receiptProtocol.catalog_complete
    ? receiptProtocol.catalog_index
    : Number.MAX_SAFE_INTEGER;
  for (const phase of CONTEXT_PHASES) {
    const selected = selectOrderedPrimaryPhaseReceipt(
      phase,
      verifiedContextReceipts,
      receiptCursor,
    );
    if (!selected) break;
    const { receipt, index } = selected;
    receiptCursor = index;
    journeyClockMs = Math.max(
      journeyClockMs,
      Date.parse(normalizeIso(receipt.recorded_at_utc || updatedAtUtc)),
    );
    const phaseAtUtc = new Date(journeyClockMs).toISOString();
    journey = startAnalyticalPhase(journey, {
      phase,
      actor: "desk_backend:mcp_context",
      atUtc: phaseAtUtc,
    });
    const recorded = recordMcpAnalyticalContextReceipt(journey, {
      ...receipt,
      phase,
      effective_at_utc: cutoffUtc,
      source_ref: `claim-context:${envelope.envelope_hash}`,
      source_version: "1.0.0",
      reason_codes: contextReasonCodes(receipt),
      quality_flags: contextQualityFlags(receipt),
    }, {
      actor: "desk_backend:mcp_context",
      atUtc: phaseAtUtc,
    });
    journey = completeAnalyticalPhase(recorded.journey, {
      phase,
      summary: contextPhaseSummary(phase, receipt),
      actor: "desk_backend:mcp_context",
      atUtc: phaseAtUtc,
    });
  }
  return {
    journey,
    journeyClockMs,
    cutoffUtc,
    toolCallsByPhase,
    receiptProtocol,
  };
}

function validateContextEvidenceProtocol({
  envelope,
  capability,
  receipts,
}) {
  if (!capability) {
    throw researchError(
      "AI_ANALYTICAL_CONTEXT_CAPABILITY_REQUIRED",
      "The analytical journey requires its private claim-scoped context capability.",
      undefined,
      true,
    );
  }
  if (
    capability.job_id !== envelope.job_id
    || capability.envelope_hash !== envelope.envelope_hash
    || capability.scope !== envelope.scope
    || capability.workflow !== envelope.workflow
  ) {
    throw researchError(
      "AI_ANALYTICAL_CONTEXT_CAPABILITY_MISMATCH",
      "The analytical context capability does not belong to this Desk AI envelope.",
      undefined,
      true,
    );
  }
  const verified = [];
  let previousTimestamp = -Infinity;
  let expectedSequence = 1;
  for (const receipt of receipts || []) {
    const verification = verifyDeskContextEvidenceReceipt(receipt, capability);
    if (!verification.valid) {
      throw researchError(
        "AI_ANALYTICAL_CONTEXT_RECEIPT_INVALID",
        "A context evidence receipt failed its claim-scoped signature or integrity checks.",
        {
          receipt_id: receipt?.receipt_id || null,
          violations: verification.violations,
        },
        true,
      );
    }
    const recordedAt = Date.parse(receipt.recorded_at_utc);
    if (recordedAt < previousTimestamp) {
      throw researchError(
        "AI_ANALYTICAL_CONTEXT_RECEIPT_ORDER_INVALID",
        "Context evidence receipts are not chronologically monotonic.",
        {
          receipt_id: receipt.receipt_id,
          recorded_at_utc: receipt.recorded_at_utc,
        },
        true,
      );
    }
    if (receipt.sequence !== expectedSequence) {
      throw researchError(
        "AI_ANALYTICAL_CONTEXT_RECEIPT_SEQUENCE_INVALID",
        "Context evidence receipt sequence is missing, duplicated or reordered.",
        {
          receipt_id: receipt.receipt_id,
          expected_sequence: expectedSequence,
          actual_sequence: receipt.sequence,
        },
        true,
      );
    }
    expectedSequence += 1;
    previousTimestamp = recordedAt;
    verified.push(receipt);
  }
  const catalogIndex = verified.findIndex((receipt) => receipt.tool === "get_context_catalog");
  const catalog = catalogIndex >= 0 ? verified[catalogIndex] : null;
  const catalogComplete = catalogIndex === 0 && catalog?.status === "COMPLETE";
  return {
    receipts: verified,
    catalog_index: catalogIndex,
    catalog_complete: catalogComplete,
  };
}

function countToolCallsByPhase(receipts) {
  const counts = {};
  for (const receipt of receipts || []) {
    const phase = String(receipt?.phase || "").toUpperCase();
    if (!CONTEXT_PHASES.includes(phase)) continue;
    counts[phase] = Number(counts[phase] || 0) + 1;
  }
  return counts;
}

function contextReasonCodes(receipt = {}) {
  if (String(receipt.status || "").toUpperCase() === "COMPLETE") return [];
  return [
    symbolicCode(receipt.error_code || `MCP_CONTEXT_${receipt.status || "DEGRADED"}`),
  ];
}

function contextQualityFlags(receipt = {}) {
  return receipt.status === "DEGRADED" ? ["CONTEXT_PARTIAL"] : [];
}

function contextPhaseSummary(phase, receipt = {}) {
  const count = Number(receipt.evidence_count || 0);
  return `${phase}: ${String(receipt.status || "UNKNOWN").toUpperCase()} (${count} evidence items).`;
}

function extractOpportunityOutput(output = {}) {
  const native = output.save_payload?.analysis_output || output.save_payload?.monitor_output || {};
  return {
    workflow_output: output.save_payload,
    decision_summary: output.decision_summary,
    data_quality_status: output.data_quality_status,
    opportunity_view: native.execution_plan
      ? {
          disposition: native.execution_plan.disposition,
          primary_setup_id: native.execution_plan.primary_setup_id,
          setups: native.execution_plan.setups,
          no_setup_proof: native.execution_plan.no_setup_proof,
        }
      : {
          requested_action: native.command?.requested_action,
          setup_transition: native.command?.setup_transition,
          transformation: native.command?.transformation,
          replan_request: native.command?.replan_request,
          management_request: native.command?.management_request,
          new_opportunities: native.delta_summary?.new_opportunities,
        },
  };
}

function resolveEnvelopeCutoffUtc(envelope) {
  const candidates = [
    envelope.bundle?.as_of_utc,
    envelope.bundle?.cutoff_utc,
    envelope.bundle?.data_cutoff?.cutoff_utc,
    envelope.bundle?.pack?.cutoff_utc,
    envelope.bundle?.pack?.data_cutoff?.end_utc,
    envelope.bundle?.cutoff_paris,
    envelope.bundle?.timestamp_paris,
    envelope.bundle?.pack?.cutoff_paris,
    envelope.bundle?.pack?.data_cutoff?.end_paris,
    envelope.claim_handle?.checkpoint,
    envelope.suggested_payload?.as_of_utc,
    envelope.suggested_payload?.cutoff_paris,
  ];
  const value = candidates.find((candidate) => Number.isFinite(Date.parse(candidate)));
  if (!value) {
    throw researchError(
      "AI_ANALYTICAL_CUTOFF_MISSING",
      "The analytical envelope has no valid immutable cutoff.",
    );
  }
  return new Date(Date.parse(value)).toISOString();
}

function redactClaimIdentity(handle = {}) {
  const {
    lease_token: _leaseToken,
    ...identity
  } = handle || {};
  return identity;
}

function symbolicCode(value) {
  const normalized = String(value || "CONTEXT_DEGRADED")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return /^[A-Z][A-Z0-9_]{1,79}$/.test(normalized)
    ? normalized
    : "CONTEXT_DEGRADED";
}

function normalizeIso(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function researchError(code, message, details = undefined, retryable = false) {
  return Object.assign(new Error(message), { code, details, retryable });
}
