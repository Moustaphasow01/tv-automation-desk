import assert from "node:assert/strict";
import test from "node:test";

import {
  applyValidatedConclusionPhase,
  applyValidatedOpportunityPhase,
  completeAnalyticalPhase,
  createAnalyticalJourney,
  recordMcpAnalyticalContextReceipt,
  startAnalyticalPhase,
  validateAnalyticalDecision,
} from "../src/analytical-journey-api.js";
import {
  ANALYTICAL_TEST_CUTOFF,
  analyticalDecisionFixture,
  buildCompletedAnalyticalJourney,
} from "./support/analytical-journey-fixtures.js";

test("MCP context receipt maps into backend evidence without trusting a model receipt", () => {
  let journey = createAnalyticalJourney({
    journeyId: "journey-mcp-context",
    scope: "live",
    workflow: "LIVE_MASTER",
    cutoffUtc: ANALYTICAL_TEST_CUTOFF,
    identity: {
      work_item_id: "live-work-1",
      bundle_id: "live-bundle-1",
    },
    createdAtUtc: "2026-08-02T10:00:00.000Z",
  });
  journey = startAnalyticalPhase(journey, {
    phase: "CONTINUITY",
    atUtc: "2026-08-02T10:00:01.000Z",
  });
  const resultHash = "a".repeat(64);
  const recorded = recordMcpAnalyticalContextReceipt(journey, {
    phase: "CONTINUITY",
    tool: "get_active_thesis",
    status: "COMPLETE",
    result_sha256: resultHash,
    evidence_count: 2,
    receipt_id: "mcp-context-001",
    effective_at_utc: ANALYTICAL_TEST_CUTOFF,
  }, {
    atUtc: "2026-08-02T10:00:02.000Z",
  });
  assert.equal(recorded.receipt.issuer, "DESK_BACKEND");
  assert.equal(recorded.receipt.evidence_kind, "CONTINUITY_STATE");
  assert.equal(recorded.receipt.availability, "AVAILABLE");
  assert.equal(recorded.receipt.content_hash, resultHash);
  assert.equal(recorded.receipt.content_hash_origin, "IMMUTABLE_SOURCE_HASH");
  assert.equal(recorded.receipt.source.source_type, "MCP_TOOL_RESULT");
  assert.equal(recorded.receipt.source.source_id, "get_active_thesis");
  assert.equal(recorded.receipt.metadata.mcp_evidence_count, 2);

  journey = completeAnalyticalPhase(recorded.journey, {
    phase: "CONTINUITY",
    summary: "Continuity state was loaded through the MCP context layer.",
    atUtc: "2026-08-02T10:00:03.000Z",
  });
  assert.equal(journey.phases[0].status, "COMPLETE");

  assert.throws(
    () => recordMcpAnalyticalContextReceipt(journey, {
      phase: "CORE_MARKET",
      tool: "get_market_pack",
      status: "MODEL_DECIDES",
      result_sha256: resultHash,
    }),
    (error) => error.code === "ANALYTICAL_MCP_STATUS_INVALID",
  );
});

test("validated OPPORTUNITY and CONCLUSION outputs are backend-hashed and close the route", () => {
  const decision = analyticalDecisionFixture({ action: "ARM_CONDITIONAL_SETUP" });
  let journey = buildCompletedAnalyticalJourney({
    decision,
    throughPhase: "THESIS_EVOLUTION",
  });
  const opportunity = applyValidatedOpportunityPhase(journey, {
    output: {
      candidates: [{
        setup_id: "setup-june11-01",
        direction: "SHORT",
        score: 0.68,
      }],
    },
    sourceId: "validated-master-output-june11",
    validationId: "strategy-validation-june11",
    summary: "One conditional short opportunity survived deterministic validation.",
    atUtc: "2026-08-02T10:01:00.000Z",
    toolCallsByPhase: { OPPORTUNITY: 1 },
  });
  journey = opportunity.journey;
  assert.equal(journey.phases[8].status, "COMPLETE");
  assert.equal(opportunity.receipt.evidence_kind, "OPPORTUNITY_SET");
  assert.equal(opportunity.progress.coverage.complete, 9);
  assert.equal(opportunity.progress.current_phase, "OPPORTUNITY");

  const conclusion = applyValidatedConclusionPhase(journey, {
    decision,
    sourceId: "validated-master-output-june11",
    validationId: "strategy-validation-june11",
    summary: "The backend accepts the conditional setup decision.",
    atUtc: "2026-08-02T10:01:01.000Z",
    toolCallsByPhase: { OPPORTUNITY: 1, CONCLUSION: 1 },
  });
  assert.equal(conclusion.journey.status, "COMPLETE");
  assert.equal(conclusion.receipt.evidence_kind, "ANALYTICAL_CONCLUSION");
  assert.equal(conclusion.receipt.content_hash_origin, "BACKEND_HASHED_PAYLOAD");
  assert.equal(conclusion.progress.coverage.complete, 10);
  assert.equal(conclusion.progress.evidence_receipts_count, 10);

  const validation = validateAnalyticalDecision({
    journey: conclusion.journey,
    decision,
    intent: "RISK_INCREASING",
    validatedAtUtc: "2026-08-02T10:01:02.000Z",
  });
  assert.equal(validation.decision_allowed, true);
  assert.equal(validation.conclusion_receipt_id, conclusion.receipt.receipt_id);
});
