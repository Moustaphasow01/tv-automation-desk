import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAgentTaskRunMetricV1 } from "../index.js";

describe("agent runtime metrics V1", () => {
  it("normalizes latency tokens cost and stable hash", () => {
    const metric = buildAgentTaskRunMetricV1({
      task_id: "44444444-4444-4444-8444-444444444444",
      mission_id: "22222222-2222-4222-8222-222222222222",
      conversation_id: "33333333-3333-4333-8333-333333333333",
      execution_policy_snapshot_id: "55555555-5555-4555-8555-555555555555",
      worker_id: "agent-runtime-live-01",
      lane: "live",
      task_type: "LIVE_M15_MONITOR",
      model: "codex",
      reasoning_effort: "ultra",
      outcome: "completed",
      queue_latency_ms: 1000,
      run_duration_ms: 2000,
      total_latency_ms: 3000,
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      cost_micros_usd: 2500,
      started_at_utc: "2026-08-09T10:00:00.000Z",
      finished_at_utc: "2026-08-09T10:00:02.000Z",
    });

    assert.equal(metric.outcome, "COMPLETED");
    assert.equal(metric.total_tokens, 150);
    assert.match(metric.metric_hash, /^sha256:[a-f0-9]{64}$/);
  });
});
