import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildResearchFailureKnowledgeNodeV1,
  buildResearchFailureRecordV1,
  evaluateResearchFailureMemoryGateV1,
  matchResearchFailureMemoryV1,
} from "../index.js";

test("TD2-508 records a rejected candidate with causes, evidence and immutable hash", () => {
  const left = buildResearchFailureRecordV1(failure());
  const right = buildResearchFailureRecordV1(failure({ evidence_refs: ["report:validation:01", "run:sim:01"] }));

  assert.equal(left.validation.ok, true);
  assert.deepEqual(left.cause_codes, ["HIGH_DRAWDOWN", "OVERFIT"]);
  assert.equal(left.failure_hash, right.failure_hash);
  assert.equal(left.negative_result_ref, "report:validation:01");
});

test("TD2-508 flags incomplete negative results before they enter memory", () => {
  const record = buildResearchFailureRecordV1({
    candidate: candidate(),
    root_cause_summary: "",
  });

  assert.equal(record.validation.ok, false);
  assert.ok(record.validation.issues.includes("FAILURE_CAUSE_REQUIRED"));
  assert.ok(record.validation.issues.includes("FAILURE_EVIDENCE_REQUIRED"));
  assert.ok(record.validation.issues.includes("NEGATIVE_RESULT_REF_REQUIRED"));
});

test("TD2-508 blocks exact replay of a failed genome", () => {
  const memory = matchResearchFailureMemoryV1({
    candidate: candidate(),
    failure_records: [failure()],
  });
  const gate = evaluateResearchFailureMemoryGateV1({
    candidate: candidate(),
    failure_records: [failure()],
  });

  assert.equal(memory.decision, "BLOCK_RETEST");
  assert.equal(gate.status, "rejected");
  assert.equal(gate.ok, false);
  assert.deepEqual(memory.blocking_failure_ids, ["failure:mnq-breakout-overfit"]);
});

test("TD2-508 requires revision when a candidate is too close to a failed idea", () => {
  const memory = matchResearchFailureMemoryV1({
    candidate: candidate({
      research_candidate_id: "44444444-4444-4444-8444-444444444445",
      confirmation_signals: ["VWAP", "RSI", "DXY"],
    }),
    failure_records: [failure()],
    block_threshold: 0.98,
    review_threshold: 0.7,
  });

  assert.equal(memory.decision, "REQUIRE_REVISION");
  assert.equal(memory.nearest_failures[0].decision_hint, "REQUIRE_REVISION");
});

test("TD2-508 allows distinct candidates while keeping memory visible", () => {
  const memory = matchResearchFailureMemoryV1({
    candidate: candidate({
      research_candidate_id: "44444444-4444-4444-8444-444444444446",
      primary_change_summary: "Mean reversion range rotation around VWAP.",
      instruments: ["MES"],
      timeframes: ["M5"],
      entry_logic: ["range"],
      confirmation_signals: ["volume"],
      exit_logic: ["midline"],
    }),
    failure_records: [failure()],
  });

  assert.equal(memory.decision, "ALLOW_WITH_MEMORY");
  assert.ok(memory.nearest_failures[0].memory_score < memory.review_threshold);
});

test("TD2-508 exposes failures as graph-ready negative-result nodes", () => {
  const node = buildResearchFailureKnowledgeNodeV1(failure());

  assert.ok(node.labels.includes("ResearchFailure"));
  assert.ok(node.edges.some((edge) => edge.type === "FAILED_BECAUSE" && edge.to === "failure_cause:OVERFIT"));
  assert.ok(node.edges.some((edge) => edge.type === "EVIDENCED_BY" && edge.to === "report:validation:01"));
  assert.match(node.node_hash, /^sha256:[a-f0-9]{64}$/);
});

function failure(overrides = {}) {
  return {
    failure_id: "failure:mnq-breakout-overfit",
    research_experiment_id: "exp-mnq-breakout",
    research_hypothesis_id: "hyp-mnq-breakout",
    candidate: candidate(),
    cause_codes: ["OVERFIT", "HIGH_DRAWDOWN"],
    root_cause_summary: "Validation failed: overfit profile and high drawdown outside train window.",
    negative_result_ref: "report:validation:01",
    evidence_refs: ["run:sim:01", "report:validation:01"],
    metrics_snapshot: { net_r: -3.2, max_drawdown_r: -4.6, trades: 12 },
    recorded_at_utc: "2026-08-09T10:00:00.000Z",
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    research_candidate_id: "44444444-4444-4444-8444-444444444444",
    candidate_key: "mnq.breakout.retest.failed",
    primary_change_summary: "Breakout retest continuation with VWAP and RSI confirmation after compression.",
    instruments: ["MNQ"],
    timeframes: ["M1", "M15"],
    session_scope: ["ny_open"],
    entry_logic: ["breakout", "retest"],
    confirmation_signals: ["VWAP", "RSI"],
    exit_logic: ["tp1", "trailing_stop"],
    risk_model: ["fixed_risk_pct", "rr_min_2"],
    ...overrides,
  };
}
