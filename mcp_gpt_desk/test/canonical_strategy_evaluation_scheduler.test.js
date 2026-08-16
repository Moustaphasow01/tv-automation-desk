import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson } from "@tv-automation/desk-domain";
import { CanonicalStrategyEvaluationScheduler, scopedSchedulerRunKey } from "../src/canonical-strategy-evaluation-scheduler.js";

describe("Canonical Strategy Evaluation Scheduler", () => {
  test("wakes a due SHADOW instance and persists a deterministic NO_SIGNAL result", async () => {
    const asOf = "2026-08-12T14:05:00.000Z";
    const dsl = strategyDsl();
    const version = strategyVersion(dsl);
    const instance = strategyInstance(version.strategy_version_id);
    const evaluations = [];
    let published = false;
    const store = {
      clock: { now: () => ({ utc: asOf }) },
      persistence: { pool: marketPool(asOf) },
      strategyKernel: {
        async listInstances() { return [instance]; },
        async planInstanceSchedulerCycle() { return { plan: { summary: { total: 1, due: 0, late: 1, waiting: 0, paused: 0, suppressed: 0 }, due: [{ strategy_instance_id: instance.strategy_instance_id, strategy_version_id: version.strategy_version_id, scheduler_run_key: `scheduler:${asOf}`, scheduled_for_utc: "2026-07-01T00:00:00.000Z", cadence_seconds: 300 }] } }; },
        async getInstance() { return instance; },
        async getVersion() { return version; },
        async getDefinition() { return strategyDefinition(); },
      },
      strategyEvaluations: {
        async listRecent() { return []; },
        async record(input) { const saved = { strategy_evaluation_id: "strategy_eval_test", ...input }; evaluations.push(saved); return saved; },
      },
      async publishStrategyV2Signal() { published = true; throw new Error("NO_SIGNAL must not publish a StrategySignal"); },
    };

    const scheduler = new CanonicalStrategyEvaluationScheduler({ store });
    const result = await scheduler.runCycle({ now_utc: asOf, source_class: "SHADOW" });

    assert.equal(result.status, "EVALUATED", JSON.stringify(result));
    assert.equal(result.outcomes[0].status, "NO_SIGNAL");
    assert.deepEqual(result.outcomes[0].reasonCodes, ["NO_STRATEGY_SIGNAL_AT_CUTOFF"]);
    assert.equal(evaluations[0].status, "NO_SIGNAL");
    assert.equal(evaluations[0].source_data_cutoff_utc, asOf);
    assert.equal(evaluations[0].next_evaluation_at_utc, "2026-08-12T14:10:00.000Z");
    assert.equal(published, false);
  });

  test("keeps certification evaluations isolated from nominal scheduler continuity", async () => {
    const captured = [];
    const store = {
      persistence: { pool: {} },
      strategyKernel: {
        async listInstances() { return []; },
        async planInstanceSchedulerCycle(input) { captured.push(input); return { plan: { summary: {}, due: [] } }; },
      },
      strategyEvaluations: {
        async listRecent() {
          return [
            { strategy_instance_id: "nominal", source_class: "LIVE", source_data_cutoff_utc: "2026-08-12T14:00:00.000Z" },
            { strategy_instance_id: "cert", source_class: "CERTIFICATION_REPLAY", certification_run_id: "cert-a", source_data_cutoff_utc: "2026-06-01T10:00:00.000Z" },
          ];
        },
      },
    };
    const scheduler = new CanonicalStrategyEvaluationScheduler({ store });
    await scheduler.runCycle({ now_utc: "2026-08-12T14:05:00.000Z", source_class: "LIVE" });
    assert.deepEqual(captured[0].last_scheduled_at_by_instance, { nominal: "2026-08-12T14:00:00.000Z" });
  });

  test("scopes certification scheduler idempotency to its certification run", () => {
    const nominal = scopedSchedulerRunKey("scheduler:instance:cutoff", { sourceClass: "LIVE" });
    const first = scopedSchedulerRunKey("scheduler:instance:cutoff", { sourceClass: "CERTIFICATION_REPLAY", certificationRunId: "cert-a" });
    const repeated = scopedSchedulerRunKey("scheduler:instance:cutoff", { sourceClass: "CERTIFICATION_REPLAY", certificationRunId: "cert-a" });
    const second = scopedSchedulerRunKey("scheduler:instance:cutoff", { sourceClass: "CERTIFICATION_REPLAY", certificationRunId: "cert-b" });

    assert.equal(nominal, "scheduler:instance:cutoff");
    assert.equal(first, repeated);
    assert.notEqual(first, second);
  });
});

function strategyDsl() {
  return {
    schema_version: "strategy_dsl_v1",
    pattern: "BREAKOUT_RETEST",
    setup_templates: [
      { template_id: "flat_long", direction: "long", instrument: "MNQ", timeframe: "M5", order_type: "LIMIT", rank: 1, tolerance_points: 4, max_bars: 48, rr_minimum: 2, risk_pct: 0.25, require_rejection_confirmation: false },
      { template_id: "flat_short", direction: "short", instrument: "MNQ", timeframe: "M5", order_type: "LIMIT", rank: 2, tolerance_points: 4, max_bars: 48, rr_minimum: 2, risk_pct: 0.25, require_rejection_confirmation: false },
    ],
  };
}

function strategyDefinition() {
  return { strategy_definition_id: "8f14e45f-ceea-467e-add4-8c1f9f0d2a1b", external_key: "flat-breakout-retest", name: "Flat Breakout Retest", description: "Deterministic scheduler test.", owner: "test", asset_class: "FUTURES", default_instruments: ["MNQ"], tags: ["test"], metadata: {}, created_at: "2026-08-01T00:00:00.000Z" };
}

function strategyVersion(dsl) {
  const source = canonicalJson(dsl);
  return { strategy_version_id: "3b2f1a90-6e3d-4b8e-9d1a-2f6c8e0a9b11", strategy_definition_id: strategyDefinition().strategy_definition_id, version_label: "1.0.0", status: "PUBLISHED", dsl_source_hash: `sha256:${createHash("sha256").update(source).digest("hex")}`, compiled_artifact_ref: "artifact://test/flat", compiled_artifact_hash: null, validated_metrics_ref: "6c1a3e00-1111-4a2b-9c3d-abcdef012345", runtime_contract_bundle_version: "deterministic_execution_plan_v1_4", metadata: { dsl_source: dsl }, created_at: "2026-08-01T00:00:00.000Z", published_at: "2026-08-01T00:05:00.000Z" };
}

function strategyInstance(strategyVersionId) {
  return { strategy_instance_id: "61c2fbed-b58c-4570-9b0e-c6ef0f5d7380", strategy_version_id: strategyVersionId, runtime_state: "RUNNING", execution_mode: "SHADOW", account_scope: null, instrument_scope: ["MNQ"], session_scope: [], last_heartbeat_at: "2026-08-12T14:00:00.000Z", started_at: "2026-08-12T14:00:00.000Z", metadata: { scheduler: { cadence_seconds: 300 } } };
}

function marketPool(asOf) {
  const rows = Array.from({ length: 37 }, (_, index) => {
    const timestamp = new Date(Date.parse("2026-08-12T11:05:00.000Z") + index * 5 * 60_000).toISOString();
    return { timestamp_utc: timestamp, timestamp_paris: timestamp, trading_date: "2026-08-12", open: 20000, high: 20001, low: 19999, close: 20000, volume: 100, is_closed: true };
  });
  rows[rows.length - 1].timestamp_utc = asOf;
  rows[rows.length - 1].timestamp_paris = asOf;
  return {
    async query(sql) {
      if (sql.includes("ORDER BY timestamp_utc DESC LIMIT 1")) return { rows: [{ trading_date: "2026-08-12", timestamp_utc: asOf }] };
      return { rows };
    },
  };
}
