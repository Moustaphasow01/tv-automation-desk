import assert from "node:assert/strict";
import test from "node:test";

import {
  ANALYTICAL_EVIDENCE_ISSUER,
  ANALYTICAL_PHASES,
  assertAnalyticalJourneyIntegrity,
  buildAnalyticalCoverageMatrix,
  buildAnalyticalResearchProgress,
  completeAnalyticalPhase,
  createAnalyticalJourney,
  hashAnalyticalPayload,
  issueAnalyticalEvidenceReceipt,
  recordAnalyticalEvidence,
  startAnalyticalPhase,
  verifyAnalyticalEvidenceReceipt,
} from "../src/analytical-journey-api.js";
import {
  ANALYTICAL_TEST_CUTOFF,
  buildCompletedAnalyticalJourney,
} from "./support/analytical-journey-fixtures.js";

test("analytical journey exposes the mandatory ordered ten-phase route", () => {
  const journey = createBaseJourney();
  assert.deepEqual(journey.phase_order, [
    "CONTINUITY",
    "CORE_MARKET",
    "INDEX_CONFIRMATION",
    "CROSS_ASSET",
    "MEGACAPS",
    "MACRO",
    "NEWS",
    "THESIS_EVOLUTION",
    "OPPORTUNITY",
    "CONCLUSION",
  ]);
  assert.deepEqual(journey.phase_order, ANALYTICAL_PHASES);
  assert.equal(journey.status, "NOT_STARTED");
  assert.ok(journey.phases.every((phase) => phase.status === "NOT_STARTED"));
  assert.equal(journey.audit_events.length, 1);
  assert.equal(journey.audit_events[0].event_type, "JOURNEY_CREATED");
  assert.equal(Object.isFrozen(journey), true);
  assertAnalyticalJourneyIntegrity(journey);

  assert.throws(
    () => startAnalyticalPhase(journey, { phase: "CORE_MARKET" }),
    (error) => error.code === "ANALYTICAL_PHASE_ORDER_VIOLATION",
  );
});

test("evidence receipts are issued and hashed by the backend, reject forgery and lookahead", () => {
  const payload = { close: 21987.25, instrument: "MNQ" };
  const receipt = issueAnalyticalEvidenceReceipt({
    journeyId: "journey-proof",
    phase: "CORE_MARKET",
    journeyCutoffUtc: ANALYTICAL_TEST_CUTOFF,
    issuedAtUtc: "2026-08-02T10:00:00.000Z",
    evidence: {
      evidence_kind: "CANONICAL_MARKET",
      availability: "AVAILABLE",
      source: {
        source_type: "IMMUTABLE_PACK",
        source_id: "MNQ_M5",
        source_version: "pack-build-1",
        source_ref: "object://pack-build-1/mnq-m5",
      },
      payload,
      effective_at_utc: ANALYTICAL_TEST_CUTOFF,
    },
  });
  assert.equal(receipt.issuer, ANALYTICAL_EVIDENCE_ISSUER);
  assert.equal(receipt.content_hash, hashAnalyticalPayload(payload));
  assert.equal(receipt.content_hash_origin, "BACKEND_HASHED_PAYLOAD");
  assert.equal(receipt.receipt_id, `analytical_evidence_${receipt.receipt_hash.slice(0, 32)}`);
  assert.equal(verifyAnalyticalEvidenceReceipt(receipt).valid, true);

  assert.throws(
    () => issueAnalyticalEvidenceReceipt({
      journeyId: "journey-proof",
      phase: "CORE_MARKET",
      journeyCutoffUtc: ANALYTICAL_TEST_CUTOFF,
      evidence: {
        receipt_id: "model-forged",
        evidence_kind: "CANONICAL_MARKET",
        source: { source_type: "MODEL", source_id: "forged" },
        payload,
      },
    }),
    (error) => error.code === "ANALYTICAL_EVIDENCE_RECEIPT_FORGERY_ATTEMPT",
  );

  assert.throws(
    () => issueAnalyticalEvidenceReceipt({
      journeyId: "journey-proof",
      phase: "CORE_MARKET",
      journeyCutoffUtc: ANALYTICAL_TEST_CUTOFF,
      evidence: {
        evidence_kind: "CANONICAL_MARKET",
        source: { source_type: "IMMUTABLE_PACK", source_id: "MNQ_M5" },
        payload,
        effective_at_utc: "2026-06-11T08:16:00.000Z",
      },
    }),
    (error) => error.code === "ANALYTICAL_EVIDENCE_LOOKAHEAD",
  );

  const tampered = JSON.parse(JSON.stringify(receipt));
  tampered.availability = "DEGRADED";
  assert.equal(verifyAnalyticalEvidenceReceipt(tampered).valid, false);
  assert.ok(
    verifyAnalyticalEvidenceReceipt(tampered).violations
      .some((violation) => violation.code === "ANALYTICAL_EVIDENCE_RECEIPT_HASH_MISMATCH"),
  );
});

test("phase status is backend-derived and a phase cannot close without required evidence", () => {
  let journey = createBaseJourney();
  journey = startAnalyticalPhase(journey, {
    phase: "CONTINUITY",
    atUtc: "2026-08-02T10:00:01.000Z",
  });
  assert.throws(
    () => completeAnalyticalPhase(journey, {
      phase: "CONTINUITY",
      summary: "No evidence was recorded.",
    }),
    (error) => error.code === "ANALYTICAL_PHASE_EVIDENCE_INCOMPLETE",
  );

  const recorded = recordAnalyticalEvidence(journey, {
    phase: "CONTINUITY",
    atUtc: "2026-08-02T10:00:02.000Z",
    evidence: {
      evidence_kind: "CONTINUITY_STATE",
      availability: "UNAVAILABLE",
      source: {
        source_type: "STATE_STORE",
        source_id: "previous-thesis",
      },
      reason_codes: ["PREVIOUS_STATE_NOT_FOUND"],
      effective_at_utc: ANALYTICAL_TEST_CUTOFF,
    },
  });
  assert.throws(
    () => completeAnalyticalPhase(recorded.journey, {
      phase: "CONTINUITY",
      status: "COMPLETE",
      summary: "The model attempted to promote an unavailable phase.",
    }),
    (error) => error.code === "ANALYTICAL_PHASE_STATUS_FORGERY",
  );
  journey = completeAnalyticalPhase(recorded.journey, {
    phase: "CONTINUITY",
    summary: "No prior state exists; the absence is explicitly receipted.",
    atUtc: "2026-08-02T10:00:03.000Z",
  });
  assert.equal(journey.phases[0].status, "UNAVAILABLE");
  assert.deepEqual(journey.phases[0].reason_codes, ["PREVIOUS_STATE_NOT_FOUND"]);
});

test("completed journey produces an audited coverage matrix", () => {
  const journey = buildCompletedAnalyticalJourney();
  const matrix = buildAnalyticalCoverageMatrix(journey);
  assert.equal(journey.status, "COMPLETE");
  assert.equal(journey.evidence_receipts.length, 10);
  assert.equal(journey.audit_events.length, 31);
  assert.equal(matrix.rows.length, 10);
  assert.equal(matrix.summary.visited_count, 10);
  assert.equal(matrix.summary.terminal_count, 10);
  assert.equal(matrix.summary.mandatory_traversal_complete, true);
  assert.equal(matrix.summary.mandatory_evidence_accounted, true);
  assert.equal(matrix.summary.decision_ready, true);
  assert.equal(matrix.summary.risk_increase_ready, true);
  assert.ok(matrix.rows.every((row) => row.evidence_accounted_ratio === 1));
  assert.match(matrix.matrix_hash, /^[a-f0-9]{64}$/);
  assertAnalyticalJourneyIntegrity(journey);

  const progress = buildAnalyticalResearchProgress(journey, {
    toolCallsByPhase: {
      CONTINUITY: 1,
      CORE_MARKET: 3,
      CONCLUSION: 2,
    },
  });
  assert.equal(progress.schema_version, "desk_analytical_research_progress_v1");
  assert.equal(progress.status, "COMPLETE");
  assert.equal(progress.current_phase, "CONCLUSION");
  assert.equal(progress.coverage.complete, 10);
  assert.equal(progress.coverage.percent, 100);
  assert.equal(progress.tool_calls_count, 6);
  assert.equal(progress.evidence_receipts_count, 10);
  assert.deepEqual(
    progress.phases.map((phase) => phase.phase),
    ANALYTICAL_PHASES,
  );
  assert.equal(progress.phases[1].evidence_count, 1);

  const tampered = JSON.parse(JSON.stringify(journey));
  tampered.phases[0].summary = "tampered after completion";
  assert.throws(
    () => assertAnalyticalJourneyIntegrity(tampered),
    (error) => error.code === "ANALYTICAL_JOURNEY_INTEGRITY_FAILED",
  );

  const semanticallyForged = JSON.parse(JSON.stringify(journey));
  semanticallyForged.phases[3].status = "NOT_STARTED";
  const { journey_hash: ignored, ...forgedCore } = semanticallyForged;
  semanticallyForged.journey_hash = hashAnalyticalPayload(forgedCore);
  assert.throws(
    () => assertAnalyticalJourneyIntegrity(semanticallyForged),
    (error) => (
      error.code === "ANALYTICAL_JOURNEY_INTEGRITY_FAILED"
      && error.details.violations.some((violation) => (
        violation.code === "ANALYTICAL_JOURNEY_PHASE_SEQUENCE_INVALID"
      ))
    ),
  );
});

function createBaseJourney() {
  return createAnalyticalJourney({
    journeyId: "analytical-journey-base",
    scope: "replay",
    workflow: "REPLAY_MASTER",
    cutoffUtc: ANALYTICAL_TEST_CUTOFF,
    identity: {
      backtest_id: "replay-2026-06-11-v5-1",
      work_item_id: "work-june11-master-001",
    },
    createdAtUtc: "2026-08-02T10:00:00.000Z",
  });
}
