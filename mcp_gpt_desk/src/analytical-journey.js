import { randomUUID } from "node:crypto";
import { deskError } from "./desk-errors.js";
import {
  ANALYTICAL_AUDIT_EVENT_SCHEMA_VERSION,
  ANALYTICAL_COVERAGE_MATRIX_SCHEMA_VERSION,
  ANALYTICAL_JOURNEY_SCHEMA_VERSION,
  ANALYTICAL_PHASE_CATALOG,
  ANALYTICAL_PHASES,
  ANALYTICAL_RESEARCH_PROGRESS_SCHEMA_VERSION,
  analyticalPhaseDefinition,
  isAnalyticalTerminalPhaseStatus,
} from "./analytical-journey-catalog.js";
import {
  hashAnalyticalPayload,
  issueAnalyticalEvidenceReceipt,
  verifyAnalyticalEvidenceReceipt,
} from "./analytical-evidence-receipts.js";

const JOURNEY_SCOPES = new Set(["live", "replay"]);
const PHASE_CLOSED_STATUSES = new Set(["COMPLETE", "DEGRADED", "UNAVAILABLE", "BLOCKED"]);

export function createAnalyticalJourney({
  journeyId = `analytical_journey_${randomUUID()}`,
  scope,
  workflow,
  cutoffUtc,
  identity = {},
  actor = "desk_backend",
  createdAtUtc = new Date().toISOString(),
} = {}) {
  const normalizedScope = String(scope || "").trim().toLowerCase();
  if (!JOURNEY_SCOPES.has(normalizedScope)) {
    throw journeyError(
      "ANALYTICAL_JOURNEY_SCOPE_INVALID",
      "Analytical journey scope must be live or replay.",
      { scope: scope ?? null },
    );
  }
  const normalizedWorkflow = requiredString(workflow, "workflow");
  const normalizedJourneyId = requiredString(journeyId, "journeyId");
  const normalizedCutoff = normalizeTimestamp(cutoffUtc, "cutoffUtc");
  const timestamp = normalizeTimestamp(createdAtUtc, "createdAtUtc");
  const normalizedIdentity = normalizeIdentity(identity);
  const phases = ANALYTICAL_PHASE_CATALOG.map((definition) => ({
    phase: definition.phase,
    ordinal: definition.ordinal,
    criticality: definition.criticality,
    required_evidence_kinds: [...definition.required_evidence_kinds],
    status: "NOT_STARTED",
    started_at_utc: null,
    completed_at_utc: null,
    summary: null,
    evidence_receipt_ids: [],
    reason_codes: [],
  }));
  const createdEvent = buildAuditEvent({
    journeyId: normalizedJourneyId,
    sequence: 1,
    eventType: "JOURNEY_CREATED",
    actor,
    atUtc: timestamp,
    previousEventHash: null,
    details: {
      scope: normalizedScope,
      workflow: normalizedWorkflow,
      cutoff_utc: normalizedCutoff,
      identity_hash: hashAnalyticalPayload(normalizedIdentity),
      phase_order: ANALYTICAL_PHASES,
    },
  });
  return finalizeJourney({
    schema_version: ANALYTICAL_JOURNEY_SCHEMA_VERSION,
    journey_id: normalizedJourneyId,
    scope: normalizedScope,
    workflow: normalizedWorkflow,
    cutoff_utc: normalizedCutoff,
    identity: normalizedIdentity,
    phase_order: [...ANALYTICAL_PHASES],
    status: "NOT_STARTED",
    phases,
    evidence_receipts: [],
    audit_events: [createdEvent],
    revision: 0,
    created_at_utc: timestamp,
    updated_at_utc: timestamp,
  });
}

export function startAnalyticalPhase(journey, {
  phase,
  actor = "desk_backend",
  atUtc = new Date().toISOString(),
} = {}) {
  assertAnalyticalJourneyIntegrity(journey);
  const phaseName = normalizePhase(phase);
  const current = phaseEntry(journey, phaseName);
  if (current.status === "IN_PROGRESS") return journey;
  if (PHASE_CLOSED_STATUSES.has(current.status)) {
    throw journeyError(
      "ANALYTICAL_PHASE_ALREADY_CLOSED",
      "A terminal analytical phase cannot be restarted.",
      { phase: phaseName, status: current.status },
    );
  }
  const unfinishedPriorPhases = journey.phases
    .filter((entry) => entry.ordinal < current.ordinal)
    .filter((entry) => !isAnalyticalTerminalPhaseStatus(entry.status))
    .map((entry) => entry.phase);
  if (unfinishedPriorPhases.length) {
    throw journeyError(
      "ANALYTICAL_PHASE_ORDER_VIOLATION",
      "Analytical phases must be traversed in their backend-defined order.",
      { phase: phaseName, unfinished_prior_phases: unfinishedPriorPhases },
    );
  }

  const timestamp = normalizeTimestamp(atUtc, "atUtc");
  assertMonotonicTimestamp(journey, timestamp);
  const next = cloneJson(journey);
  const target = phaseEntry(next, phaseName);
  target.status = "IN_PROGRESS";
  target.started_at_utc = timestamp;
  next.status = "IN_PROGRESS";
  next.updated_at_utc = timestamp;
  next.revision += 1;
  appendAuditEvent(next, {
    eventType: "PHASE_STARTED",
    actor,
    atUtc: timestamp,
    details: { phase: phaseName, ordinal: target.ordinal },
  });
  return finalizeJourney(next);
}

export function recordAnalyticalEvidence(journey, {
  phase,
  evidence,
  actor = "desk_backend",
  atUtc = new Date().toISOString(),
} = {}) {
  assertAnalyticalJourneyIntegrity(journey);
  const phaseName = normalizePhase(phase);
  const current = phaseEntry(journey, phaseName);
  if (PHASE_CLOSED_STATUSES.has(current.status)) {
    throw journeyError(
      "ANALYTICAL_PHASE_EVIDENCE_CLOSED",
      "Evidence cannot be attached after an analytical phase is closed.",
      { phase: phaseName, status: current.status },
    );
  }
  const timestamp = normalizeTimestamp(atUtc, "atUtc");
  assertMonotonicTimestamp(journey, timestamp);
  const receipt = issueAnalyticalEvidenceReceipt({
    journeyId: journey.journey_id,
    phase: phaseName,
    journeyCutoffUtc: journey.cutoff_utc,
    evidence,
    issuedAtUtc: timestamp,
  });
  const existing = journey.evidence_receipts.find((item) => item.receipt_id === receipt.receipt_id);
  if (existing) {
    if (existing.receipt_hash !== receipt.receipt_hash) {
      throw journeyError(
        "ANALYTICAL_EVIDENCE_RECEIPT_COLLISION",
        "An evidence receipt identifier is already bound to different content.",
        { receipt_id: receipt.receipt_id },
      );
    }
    return Object.freeze({ journey, receipt: existing, replayed: true });
  }

  const next = cloneJson(journey);
  next.evidence_receipts.push(receipt);
  next.updated_at_utc = timestamp;
  next.revision += 1;
  appendAuditEvent(next, {
    eventType: "EVIDENCE_RECORDED",
    actor,
    atUtc: timestamp,
    details: {
      phase: phaseName,
      evidence_kind: receipt.evidence_kind,
      availability: receipt.availability,
      receipt_id: receipt.receipt_id,
      receipt_hash: receipt.receipt_hash,
    },
  });
  return Object.freeze({
    journey: finalizeJourney(next),
    receipt,
    replayed: false,
  });
}

export function completeAnalyticalPhase(journey, {
  phase,
  summary,
  status,
  actor = "desk_backend",
  atUtc = new Date().toISOString(),
} = {}) {
  assertAnalyticalJourneyIntegrity(journey);
  const phaseName = normalizePhase(phase);
  const current = phaseEntry(journey, phaseName);
  const normalizedSummary = normalizeSummary(summary);
  if (PHASE_CLOSED_STATUSES.has(current.status)) {
    if (current.summary === normalizedSummary
      && (!status || current.status === String(status).trim().toUpperCase())) {
      return journey;
    }
    throw journeyError(
      "ANALYTICAL_PHASE_ALREADY_CLOSED",
      "A completed analytical phase is immutable.",
      { phase: phaseName, status: current.status },
    );
  }
  if (current.status !== "IN_PROGRESS") {
    throw journeyError(
      "ANALYTICAL_PHASE_NOT_IN_PROGRESS",
      "An analytical phase must be started before it can be completed.",
      { phase: phaseName, status: current.status },
    );
  }

  const receipts = journey.evidence_receipts.filter((receipt) => receipt.phase === phaseName);
  const assessment = assessPhaseEvidence(current, receipts);
  if (assessment.missing_evidence_kinds.length) {
    throw journeyError(
      "ANALYTICAL_PHASE_EVIDENCE_INCOMPLETE",
      "The phase cannot close until every required evidence kind has a backend receipt.",
      {
        phase: phaseName,
        missing_evidence_kinds: assessment.missing_evidence_kinds,
      },
    );
  }
  if (status && String(status).trim().toUpperCase() !== assessment.status) {
    throw journeyError(
      "ANALYTICAL_PHASE_STATUS_FORGERY",
      "Phase status is derived by the backend from evidence receipts.",
      {
        phase: phaseName,
        requested_status: String(status).trim().toUpperCase(),
        backend_status: assessment.status,
      },
    );
  }

  const timestamp = normalizeTimestamp(atUtc, "atUtc");
  assertMonotonicTimestamp(journey, timestamp);
  const next = cloneJson(journey);
  const target = phaseEntry(next, phaseName);
  target.status = assessment.status;
  target.completed_at_utc = timestamp;
  target.summary = normalizedSummary;
  target.evidence_receipt_ids = receipts.map((receipt) => receipt.receipt_id);
  target.reason_codes = assessment.reason_codes;
  next.updated_at_utc = timestamp;
  next.revision += 1;
  next.status = deriveJourneyStatus(next.phases);
  appendAuditEvent(next, {
    eventType: "PHASE_COMPLETED",
    actor,
    atUtc: timestamp,
    details: {
      phase: phaseName,
      status: assessment.status,
      summary_hash: hashAnalyticalPayload(normalizedSummary),
      evidence_receipt_ids: target.evidence_receipt_ids,
      evidence_receipt_hashes: receipts.map((receipt) => receipt.receipt_hash),
      reason_codes: target.reason_codes,
    },
  });
  return finalizeJourney(next);
}

export function buildAnalyticalCoverageMatrix(journey, {
  generatedAtUtc = journey?.updated_at_utc,
} = {}) {
  assertAnalyticalJourneyIntegrity(journey);
  const generatedAt = normalizeTimestamp(generatedAtUtc, "generatedAtUtc");
  const rows = journey.phases.map((phase) => {
    const receipts = journey.evidence_receipts.filter((receipt) => receipt.phase === phase.phase);
    const assessment = assessPhaseEvidence(phase, receipts);
    const required = phase.required_evidence_kinds;
    const accountedKinds = required.filter((kind) => (
      receipts.some((receipt) => receipt.evidence_kind === kind)
    ));
    const usableKinds = required.filter((kind) => (
      receipts.some((receipt) => (
        receipt.evidence_kind === kind
        && ["AVAILABLE", "DEGRADED"].includes(receipt.availability)
      ))
    ));
    return {
      phase: phase.phase,
      ordinal: phase.ordinal,
      criticality: phase.criticality,
      status: phase.status,
      visited: phase.status !== "NOT_STARTED",
      terminal: isAnalyticalTerminalPhaseStatus(phase.status),
      required_evidence_kinds: [...required],
      accounted_evidence_kinds: accountedKinds,
      usable_evidence_kinds: usableKinds,
      missing_evidence_kinds: assessment.missing_evidence_kinds,
      receipt_count: receipts.length,
      evidence_accounted_ratio: ratio(accountedKinds.length, required.length),
      evidence_usable_ratio: ratio(usableKinds.length, required.length),
      reason_codes: assessment.reason_codes,
    };
  });
  const traversalComplete = rows.every((row) => row.terminal);
  const evidenceAccounted = rows.every((row) => row.missing_evidence_kinds.length === 0);
  const conclusion = rows.find((row) => row.phase === "CONCLUSION");
  const blockedPhases = rows.filter((row) => row.status === "BLOCKED").map((row) => row.phase);
  const unavailableHardPhases = rows
    .filter((row) => row.criticality === "HARD" && row.status === "UNAVAILABLE")
    .map((row) => row.phase);
  const degradedPhases = rows
    .filter((row) => ["DEGRADED", "UNAVAILABLE"].includes(row.status))
    .map((row) => row.phase);
  const pendingPhases = rows.filter((row) => !row.terminal).map((row) => row.phase);
  const decisionReady = traversalComplete
    && evidenceAccounted
    && ["COMPLETE", "DEGRADED"].includes(conclusion?.status);
  const riskIncreaseReady = decisionReady
    && blockedPhases.length === 0
    && unavailableHardPhases.length === 0;
  const core = {
    schema_version: ANALYTICAL_COVERAGE_MATRIX_SCHEMA_VERSION,
    journey_id: journey.journey_id,
    journey_revision: journey.revision,
    generated_at_utc: generatedAt,
    rows,
    summary: {
      phase_count: rows.length,
      visited_count: rows.filter((row) => row.visited).length,
      terminal_count: rows.filter((row) => row.terminal).length,
      mandatory_traversal_complete: traversalComplete,
      mandatory_evidence_accounted: evidenceAccounted,
      decision_ready: decisionReady,
      risk_increase_ready: riskIncreaseReady,
      blocked_phases: blockedPhases,
      unavailable_hard_phases: unavailableHardPhases,
      degraded_phases: degradedPhases,
      pending_phases: pendingPhases,
    },
  };
  return deepFreeze({
    ...core,
    matrix_hash: hashAnalyticalPayload(core),
  });
}

export function buildAnalyticalResearchProgress(journey, {
  toolCallsByPhase = {},
} = {}) {
  assertAnalyticalJourneyIntegrity(journey);
  if (!toolCallsByPhase || typeof toolCallsByPhase !== "object" || Array.isArray(toolCallsByPhase)) {
    throw journeyError(
      "ANALYTICAL_TOOL_CALL_COUNTS_INVALID",
      "Tool call counts must be supplied as a phase-keyed backend object.",
    );
  }
  const phases = journey.phases.map((phase) => {
    const evidenceCount = journey.evidence_receipts
      .filter((receipt) => receipt.phase === phase.phase)
      .length;
    return {
      phase: phase.phase,
      status: phase.status,
      required: true,
      evidence_count: evidenceCount,
      tool_call_count: nonNegativeInteger(toolCallsByPhase[phase.phase] || 0),
      started_at_utc: phase.started_at_utc,
      completed_at_utc: phase.completed_at_utc,
      degraded_reasons: [...phase.reason_codes],
    };
  });
  const terminalCount = phases.filter((phase) => (
    isAnalyticalTerminalPhaseStatus(phase.status)
  )).length;
  const current = phases.find((phase) => phase.status === "IN_PROGRESS")
    || [...phases].reverse().find((phase) => phase.status !== "NOT_STARTED")
    || null;
  return deepFreeze({
    schema_version: ANALYTICAL_RESEARCH_PROGRESS_SCHEMA_VERSION,
    status: journey.status,
    current_phase: current?.phase || null,
    started_at_utc: phases.find((phase) => phase.started_at_utc)?.started_at_utc
      || journey.created_at_utc,
    updated_at_utc: journey.updated_at_utc,
    phases,
    coverage: {
      required: phases.length,
      total: phases.length,
      complete: terminalCount,
      percent: Math.round((terminalCount / phases.length) * 100),
    },
    tool_calls_count: phases.reduce((sum, phase) => sum + phase.tool_call_count, 0),
    evidence_receipts_count: journey.evidence_receipts.length,
  });
}

export function assertAnalyticalJourneyIntegrity(journey) {
  const violations = [];
  if (!journey || typeof journey !== "object" || Array.isArray(journey)) {
    throw journeyError(
      "ANALYTICAL_JOURNEY_REQUIRED",
      "Analytical journey must be a JSON object.",
    );
  }
  if (journey.schema_version !== ANALYTICAL_JOURNEY_SCHEMA_VERSION) {
    violations.push({ code: "ANALYTICAL_JOURNEY_SCHEMA_MISMATCH" });
  }
  if (JSON.stringify(journey.phase_order) !== JSON.stringify(ANALYTICAL_PHASES)) {
    violations.push({ code: "ANALYTICAL_JOURNEY_PHASE_ORDER_MISMATCH" });
  }
  const journeyPhases = Array.isArray(journey.phases) ? journey.phases : [];
  const journeyReceipts = Array.isArray(journey.evidence_receipts)
    ? journey.evidence_receipts
    : [];
  if (!Array.isArray(journey.evidence_receipts)) {
    violations.push({ code: "ANALYTICAL_JOURNEY_EVIDENCE_LIST_INVALID" });
  }
  if (journeyPhases.length !== ANALYTICAL_PHASES.length) {
    violations.push({ code: "ANALYTICAL_JOURNEY_PHASES_INVALID" });
  } else {
    let openPhaseSeen = false;
    let inProgressCount = 0;
    journeyPhases.forEach((phase, index) => {
      const definition = ANALYTICAL_PHASE_CATALOG[index];
      if (phase.phase !== definition.phase
        || Number(phase.ordinal) !== definition.ordinal
        || phase.criticality !== definition.criticality
        || JSON.stringify(phase.required_evidence_kinds)
          !== JSON.stringify(definition.required_evidence_kinds)) {
        violations.push({
          code: "ANALYTICAL_JOURNEY_PHASE_DEFINITION_MISMATCH",
          phase: phase.phase || definition.phase,
        });
      }
      if (!["NOT_STARTED", "IN_PROGRESS", ...PHASE_CLOSED_STATUSES].includes(phase.status)) {
        violations.push({
          code: "ANALYTICAL_JOURNEY_PHASE_STATUS_INVALID",
          phase: phase.phase,
        });
      }
      if (phase.status === "IN_PROGRESS") inProgressCount += 1;
      if (!isAnalyticalTerminalPhaseStatus(phase.status)) openPhaseSeen = true;
      if (openPhaseSeen && isAnalyticalTerminalPhaseStatus(phase.status)) {
        violations.push({
          code: "ANALYTICAL_JOURNEY_PHASE_SEQUENCE_INVALID",
          phase: phase.phase,
        });
      }
      const phaseReceipts = journeyReceipts
        .filter((receipt) => receipt.phase === phase.phase)
        .map((receipt) => receipt.receipt_id);
      if (phase.status === "NOT_STARTED"
        && (phase.started_at_utc || phase.completed_at_utc || phase.summary
          || (phase.evidence_receipt_ids || []).length)) {
        violations.push({
          code: "ANALYTICAL_JOURNEY_NOT_STARTED_PHASE_DIRTY",
          phase: phase.phase,
        });
      }
      if (phase.status === "IN_PROGRESS"
        && (!phase.started_at_utc || phase.completed_at_utc || phase.summary
          || (phase.evidence_receipt_ids || []).length)) {
        violations.push({
          code: "ANALYTICAL_JOURNEY_IN_PROGRESS_PHASE_INVALID",
          phase: phase.phase,
        });
      }
      if (isAnalyticalTerminalPhaseStatus(phase.status)
        && (!phase.started_at_utc || !phase.completed_at_utc || !phase.summary
          || JSON.stringify(phase.evidence_receipt_ids || []) !== JSON.stringify(phaseReceipts))) {
        violations.push({
          code: "ANALYTICAL_JOURNEY_TERMINAL_PHASE_INVALID",
          phase: phase.phase,
        });
      }
    });
    if (inProgressCount > 1) {
      violations.push({ code: "ANALYTICAL_JOURNEY_MULTIPLE_ACTIVE_PHASES" });
    }
  }

  const receipts = journeyReceipts;
  const receiptIds = new Set();
  receipts.forEach((receipt) => {
    const verification = verifyAnalyticalEvidenceReceipt(receipt, {
      journeyId: journey.journey_id,
      cutoffUtc: journey.cutoff_utc,
    });
    if (!verification.valid) {
      violations.push({
        code: "ANALYTICAL_JOURNEY_EVIDENCE_INVALID",
        receipt_id: receipt?.receipt_id || null,
        violations: verification.violations,
      });
    }
    if (receiptIds.has(receipt?.receipt_id)) {
      violations.push({
        code: "ANALYTICAL_JOURNEY_EVIDENCE_DUPLICATE",
        receipt_id: receipt?.receipt_id || null,
      });
    }
    receiptIds.add(receipt?.receipt_id);
  });
  for (const phase of journeyPhases) {
    for (const receiptId of phase.evidence_receipt_ids || []) {
      const receipt = receipts.find((item) => item.receipt_id === receiptId);
      if (!receipt || receipt.phase !== phase.phase) {
        violations.push({
          code: "ANALYTICAL_JOURNEY_PHASE_EVIDENCE_BINDING_INVALID",
          phase: phase.phase,
          receipt_id: receiptId,
        });
      }
    }
  }

  verifyAuditChain(journey, violations);
  const auditEvents = Array.isArray(journey.audit_events) ? journey.audit_events : [];
  if (auditEvents.length && Number(journey.revision) !== auditEvents.length - 1) {
    violations.push({ code: "ANALYTICAL_JOURNEY_REVISION_MISMATCH" });
  }
  if (journeyPhases.length === ANALYTICAL_PHASES.length
    && journey.status !== deriveJourneyStatus(journeyPhases)) {
    violations.push({ code: "ANALYTICAL_JOURNEY_STATUS_MISMATCH" });
  }
  if (auditEvents.length
    && journey.updated_at_utc !== auditEvents.at(-1)?.occurred_at_utc) {
    violations.push({ code: "ANALYTICAL_JOURNEY_UPDATED_AT_MISMATCH" });
  }
  const expectedJourneyHash = hashAnalyticalPayload(journeyCore(journey));
  if (journey.journey_hash !== expectedJourneyHash) {
    violations.push({ code: "ANALYTICAL_JOURNEY_HASH_MISMATCH" });
  }
  if (violations.length) {
    throw journeyError(
      "ANALYTICAL_JOURNEY_INTEGRITY_FAILED",
      "Analytical journey audit integrity validation failed.",
      { violations },
    );
  }
  return journey;
}

function assessPhaseEvidence(phase, receipts) {
  const requiredKinds = phase.required_evidence_kinds || [];
  const missingEvidenceKinds = requiredKinds.filter((kind) => (
    !receipts.some((receipt) => receipt.evidence_kind === kind)
  ));
  const requiredReceipts = receipts.filter((receipt) => (
    requiredKinds.includes(receipt.evidence_kind)
  ));
  let status = "COMPLETE";
  if (receipts.some((receipt) => receipt.availability === "BLOCKED")) {
    status = "BLOCKED";
  } else if (requiredReceipts.some((receipt) => receipt.availability === "UNAVAILABLE")) {
    status = "UNAVAILABLE";
  } else if (receipts.some((receipt) => (
    ["DEGRADED", "UNAVAILABLE"].includes(receipt.availability)
  ))) {
    status = "DEGRADED";
  }
  return {
    status,
    missing_evidence_kinds: missingEvidenceKinds,
    reason_codes: [...new Set(receipts.flatMap((receipt) => receipt.reason_codes || []))].sort(),
  };
}

function deriveJourneyStatus(phases) {
  if (phases.some((phase) => phase.status === "IN_PROGRESS")) return "IN_PROGRESS";
  if (phases.every((phase) => phase.status === "NOT_STARTED")) return "NOT_STARTED";
  if (!phases.every((phase) => isAnalyticalTerminalPhaseStatus(phase.status))) {
    return "IN_PROGRESS";
  }
  if (phases.some((phase) => phase.status === "BLOCKED")) return "BLOCKED";
  if (phases.some((phase) => ["DEGRADED", "UNAVAILABLE"].includes(phase.status))) {
    return "DEGRADED";
  }
  return "COMPLETE";
}

function appendAuditEvent(journey, {
  eventType,
  actor,
  atUtc,
  details,
}) {
  const previous = journey.audit_events.at(-1) || null;
  journey.audit_events.push(buildAuditEvent({
    journeyId: journey.journey_id,
    sequence: journey.audit_events.length + 1,
    eventType,
    actor,
    atUtc,
    previousEventHash: previous?.event_hash || null,
    details,
  }));
}

function buildAuditEvent({
  journeyId,
  sequence,
  eventType,
  actor,
  atUtc,
  previousEventHash,
  details,
}) {
  const core = {
    schema_version: ANALYTICAL_AUDIT_EVENT_SCHEMA_VERSION,
    journey_id: journeyId,
    sequence,
    event_type: eventType,
    actor: requiredString(actor, "actor"),
    occurred_at_utc: normalizeTimestamp(atUtc, "atUtc"),
    previous_event_hash: previousEventHash,
    details: cloneJson(details || {}),
  };
  const eventHash = hashAnalyticalPayload(core);
  return {
    ...core,
    event_id: `analytical_event_${eventHash.slice(0, 32)}`,
    event_hash: eventHash,
  };
}

function verifyAuditChain(journey, violations) {
  let previousHash = null;
  let previousTimestamp = null;
  if (!Array.isArray(journey.audit_events) || journey.audit_events.length === 0) {
    violations.push({ code: "ANALYTICAL_AUDIT_TRAIL_MISSING" });
    return;
  }
  journey.audit_events.forEach((event, index) => {
    const core = {
      schema_version: event.schema_version,
      journey_id: event.journey_id,
      sequence: event.sequence,
      event_type: event.event_type,
      actor: event.actor,
      occurred_at_utc: event.occurred_at_utc,
      previous_event_hash: event.previous_event_hash,
      details: event.details,
    };
    const expectedHash = hashAnalyticalPayload(core);
    if (event.schema_version !== ANALYTICAL_AUDIT_EVENT_SCHEMA_VERSION
      || event.journey_id !== journey.journey_id
      || Number(event.sequence) !== index + 1
      || event.previous_event_hash !== previousHash
      || event.event_hash !== expectedHash
      || event.event_id !== `analytical_event_${expectedHash.slice(0, 32)}`) {
      violations.push({
        code: "ANALYTICAL_AUDIT_CHAIN_INVALID",
        sequence: index + 1,
      });
    }
    if (previousTimestamp
      && Date.parse(event.occurred_at_utc) < Date.parse(previousTimestamp)) {
      violations.push({
        code: "ANALYTICAL_AUDIT_TIME_ORDER_INVALID",
        sequence: index + 1,
      });
    }
    previousHash = event.event_hash;
    previousTimestamp = event.occurred_at_utc;
  });
}

function finalizeJourney(value) {
  const normalized = {
    ...value,
    status: deriveJourneyStatus(value.phases),
  };
  return deepFreeze({
    ...normalized,
    journey_hash: hashAnalyticalPayload(journeyCore(normalized)),
  });
}

function journeyCore(journey) {
  const {
    journey_hash: ignored,
    ...core
  } = journey;
  return core;
}

function phaseEntry(journey, phase) {
  const entry = journey.phases.find((item) => item.phase === phase);
  if (!entry) {
    throw journeyError(
      "ANALYTICAL_PHASE_MISSING",
      "Analytical journey does not contain the requested phase.",
      { phase },
    );
  }
  return entry;
}

function normalizePhase(value) {
  const definition = analyticalPhaseDefinition(value);
  if (!definition) {
    throw journeyError(
      "ANALYTICAL_PHASE_INVALID",
      "Unknown analytical journey phase.",
      { phase: value ?? null },
    );
  }
  return definition.phase;
}

function normalizeIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw journeyError(
      "ANALYTICAL_JOURNEY_IDENTITY_INVALID",
      "Analytical journey identity must be a plain object.",
    );
  }
  return cloneJson(value);
}

function normalizeSummary(value) {
  const summary = requiredString(value, "summary");
  if (summary.length > 8_000) {
    throw journeyError(
      "ANALYTICAL_PHASE_SUMMARY_TOO_LONG",
      "Analytical phase summary exceeds 8,000 characters.",
    );
  }
  return summary;
}

function normalizeTimestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    throw journeyError(
      "ANALYTICAL_JOURNEY_TIMESTAMP_INVALID",
      `${field} must be an ISO-8601 timestamp.`,
      { field, value: value ?? null },
    );
  }
  return new Date(parsed).toISOString();
}

function assertMonotonicTimestamp(journey, timestamp) {
  if (Date.parse(timestamp) >= Date.parse(journey.updated_at_utc)) return;
  throw journeyError(
    "ANALYTICAL_JOURNEY_TIME_REGRESSION",
    "Analytical journey events cannot move backward in time.",
    {
      previous_updated_at_utc: journey.updated_at_utc,
      attempted_at_utc: timestamp,
    },
  );
}

function requiredString(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw journeyError(
      "ANALYTICAL_JOURNEY_FIELD_REQUIRED",
      `${field} is required.`,
      { field },
    );
  }
  return normalized;
}

function ratio(numerator, denominator) {
  if (!denominator) return 1;
  return Number((numerator / denominator).toFixed(4));
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw journeyError(
      "ANALYTICAL_TOOL_CALL_COUNT_INVALID",
      "Tool call counts must be finite non-negative integers.",
      { value },
    );
  }
  return Math.floor(parsed);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function journeyError(code, message, details = {}) {
  return deskError(code, message, details);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
