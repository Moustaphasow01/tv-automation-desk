import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROMPT_EVALUATION_REPORT_SCHEMA_VERSION_V1,
  evaluatePromptCandidateV1,
} from "../index.js";

describe("prompt evaluation policy V1", () => {
  it("passes a fully evaluated prompt candidate and builds a stable report", () => {
    const first = evaluatePromptCandidateV1(candidate());
    const second = evaluatePromptCandidateV1(candidate());

    assert.equal(first.ok, true);
    assert.equal(first.status, "PASS");
    assert.equal(first.evaluation.report.schema_version, PROMPT_EVALUATION_REPORT_SCHEMA_VERSION_V1);
    assert.equal(first.evaluation.security_status, "PASS");
    assert.equal(first.evaluation.regression_status, "PASS");
    assert.equal(first.evaluation.report_hash, second.evaluation.report_hash);
  });

  it("blocks publication without the minimum evaluation evidence", () => {
    const result = evaluatePromptCandidateV1({ prompt_composition_id: "composition-live" });

    assert.equal(result.ok, false);
    assert.equal(result.status, "FAIL");
    assert.ok(result.reasons.includes("RENDERED_HASH_REQUIRED"));
    assert.ok(result.reasons.includes("SECURITY_EVALUATION_REQUIRED"));
    assert.ok(result.reasons.includes("REGRESSION_EVALUATION_REQUIRED"));
  });

  it("blocks dangerous prompts and contract violations", () => {
    const result = evaluatePromptCandidateV1(candidate({
      security_scan: { status: "PASS", findings: [{ severity: "CRITICAL", code: "SECRET_LEAK" }] },
      contract_validation: { status: "PASS", violations: ["MISSING_SAVE_TARGET"] },
    }));

    assert.equal(result.status, "FAIL");
    assert.ok(result.reasons.includes("PROMPT_SECURITY_CRITICAL_FINDING"));
    assert.ok(result.reasons.includes("PROMPT_CONTRACT_VIOLATION"));
  });

  it("requires non-regression within the configured threshold", () => {
    const result = evaluatePromptCandidateV1(candidate({
      regression: { status: "PASS", quality_score_delta: -0.08 },
      thresholds: { max_quality_drop: 0.03 },
    }));

    assert.equal(result.status, "FAIL");
    assert.deepEqual(result.reasons, ["PROMPT_REGRESSION_TOO_LARGE"]);
  });

  it("keeps costly or slow prompts in operator review instead of silent activation", () => {
    const result = evaluatePromptCandidateV1(candidate({
      metrics: { ...metrics(), latency_ms: 180000, cost_usd: 1.8, output_token_count: 100000 },
      thresholds: { max_latency_ms: 120000, max_cost_usd: 1, max_total_tokens: 120000 },
    }));

    assert.equal(result.ok, false);
    assert.equal(result.status, "REVIEW");
    assert.ok(result.reasons.includes("LATENCY_ABOVE_BUDGET"));
    assert.ok(result.reasons.includes("COST_ABOVE_BUDGET"));
    assert.ok(result.reasons.includes("TOKEN_BUDGET_EXCEEDED"));
  });
});

function candidate(overrides = {}) {
  return {
    prompt_composition_id: "composition-live-worker-2-4-0",
    dataset_id: "dataset-prompt-eval-2026-08-09",
    rendered_sha256: "sha256:58805173a2a0f7db96cfc4c8ed0ad213b4a2d74045990f9ee151255730fa4ffd",
    security_scan: { status: "PASS", findings: [] },
    contract_validation: { status: "PASS", violations: [] },
    regression: { status: "PASS", quality_score_delta: -0.01 },
    metrics: metrics(),
    thresholds: {
      min_quality_score: 0.8,
      max_quality_drop: 0.03,
      max_latency_ms: 120000,
      max_cost_usd: 1,
      max_total_tokens: 120000,
    },
    generated_at_utc: "2026-08-09T12:00:00.000Z",
    ...overrides,
  };
}

function metrics() {
  return {
    quality_score: 0.86,
    latency_ms: 90000,
    cost_usd: 0.42,
    input_token_count: 65000,
    output_token_count: 12000,
  };
}
