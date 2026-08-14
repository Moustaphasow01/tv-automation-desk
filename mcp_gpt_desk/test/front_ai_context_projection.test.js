import assert from "node:assert/strict";
import test from "node:test";
import { buildAiContextOverviewFromStore } from "../src/front-ai-context-projection.js";

test("AI Context projection reads real agent-runtime rows without fabricating decisions", async () => {
  const overview = await buildAiContextOverviewFromStore({
    clock: { now: () => ({ utc: "2026-08-10T08:00:00.000Z" }) },
    async listAgentRuntimeTasks() { return { ok: true, items: [task(), task({ task_id: "other", task_type: "RESEARCH_STRATEGY", mission_key: "RESEARCH" })] }; },
    async listAgentRuntimeMetrics() { return { ok: true, items: [metric()] }; },
    async listAgentRuntimeDeadLetters() { return { ok: true, items: [] }; },
  });

  assert.equal(overview.contract, "DeskAiContextOverview");
  assert.equal(overview.source.status, "ready");
  assert.equal(overview.summary.total_decisions, 1);
  assert.equal(overview.summary.shadow_count, 1);
  assert.equal(overview.decisions[0].recommendation, "REJECT");
  assert.equal(overview.decisions[0].binding_action, "BLOCK_CANDIDATE");
  assert.equal(overview.decisions[0].rationale, "Macro headline risk into CPI.");
  assert.equal(overview.metrics.length, 1);
});

test("AI Context projection surfaces source errors and a true empty state", async () => {
  const overview = await buildAiContextOverviewFromStore({
    clock: { now: () => ({ utc: "2026-08-10T08:00:00.000Z" }) },
    async listAgentRuntimeTasks() { return { ok: true, items: [] }; },
    async listAgentRuntimeMetrics() { throw Object.assign(new Error("metrics table unavailable"), { code: "PG_DOWN" }); },
    async listAgentRuntimeDeadLetters() { return { ok: true, items: [] }; },
  });

  assert.equal(overview.source.status, "partial");
  assert.equal(overview.summary.status, "NO_CONTEXT_DECISIONS");
  assert.ok(overview.controls.some((item) => item.code === "AI_CONTEXT_NO_DECISION"));
  assert.ok(overview.controls.some((item) => item.code === "AI_CONTEXT_SOURCE_UNAVAILABLE"));
});

function task(overrides = {}) {
  return {
    task_id: "task-context-1",
    mission_id: "mission-context-1",
    mission_key: "LIVE_CONTEXT_DECISION",
    task_key: "live.context.2026-08-10T08:00",
    task_type: "LIVE_CONTEXT_DECISION_MONITOR",
    lane: "live",
    status: "COMPLETED",
    output_ref: {
      status: "ENFORCED_DECISION_READY",
      mode: "SHADOW",
      recommendation_effect: "OBSERVED_ONLY",
      advisory: { recommendation: "REJECT", rationale: "Macro headline risk into CPI." },
      binding_decision: { portfolio_action: "BLOCK_CANDIDATE" },
    },
    updated_at_utc: "2026-08-10T08:01:00.000Z",
    ...overrides,
  };
}

function metric() {
  return {
    metric_id: "metric-context-1",
    task_id: "task-context-1",
    mission_id: "mission-context-1",
    task_type: "LIVE_CONTEXT_DECISION_MONITOR",
    lane: "live",
    model: "codex",
    reasoning_effort: "xhigh",
    outcome: "COMPLETED",
    total_latency_ms: 12000,
    total_tokens: 3400,
    cost_micros_usd: 1200,
    finished_at_utc: "2026-08-10T08:01:00.000Z",
  };
}
