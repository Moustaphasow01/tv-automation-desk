import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson } from "@tv-automation/desk-domain";
import { CanonicalStrategyEvaluationScheduler, latestNewPosition, schedulerContinuityAnchorUtc, scopedSchedulerRunKey, selectLatestNewPosition, strategySignalFromRuntimePosition } from "../src/canonical-strategy-evaluation-scheduler.js";

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
    assert.deepEqual(result.outcomes[0].reasonCodes, ["NO_STRATEGY_SIGNAL_AT_CUTOFF", "NO_SIMULATED_POSITION"]);
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

  test("anchors failed stale evaluations on completion time instead of stale market cutoff", () => {
    const stale = schedulerContinuityAnchorUtc({
      status: "FAILED",
      source_data_cutoff_utc: "2026-08-12T11:40:00.000Z",
      completed_at_utc: "2026-08-12T14:05:00.000Z",
      payload: { availability: "STALE", marketCutoff: "2026-08-12T11:40:00.000Z" },
    });
    const healthy = schedulerContinuityAnchorUtc({
      status: "NO_SIGNAL",
      source_data_cutoff_utc: "2026-08-12T14:00:00.000Z",
      completed_at_utc: "2026-08-12T14:05:00.000Z",
      payload: { availability: "KNOWN", marketCutoff: "2026-08-12T14:00:00.000Z" },
    });

    assert.equal(stale, "2026-08-12T14:05:00.000Z");
    assert.equal(healthy, "2026-08-12T14:00:00.000Z");
  });

  test("anchors nominal scheduler continuity on scheduled tick rather than market data cutoff", () => {
    const anchor = schedulerContinuityAnchorUtc({
      status: "NO_SIGNAL",
      scheduler_run_key: "strategy_scheduler:61c2fbed-b58c-4570-9b0e-c6ef0f5d7380:2026-08-21T00_05_00_000Z",
      source_data_cutoff_utc: "2026-08-21T00:00:00.000Z",
      completed_at_utc: "2026-08-21T00:07:47.056Z",
      payload: { availability: "KNOWN", marketCutoff: "2026-08-21T00:00:00.000Z" },
    });

    assert.equal(anchor, "2026-08-21T00:05:00.000Z");
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

  test("publishes a candidate discovered on the prior closed cutoff when prior cycle had no signal", () => {
    const candidate = latestNewPosition([
      position("too_old", "2026-08-21T14:15:00.000Z"),
      position("confirmed_one_bar_late", "2026-08-21T14:20:00.000Z"),
    ], {
      status: "NO_SIGNAL",
      source_data_cutoff_utc: "2026-08-21T14:20:00.000Z",
    }, "2026-08-21T14:25:00.000Z");

    assert.equal(candidate.position_id, "confirmed_one_bar_late");
  });

  test("does not republish a prior-cutoff candidate when prior cycle already created a signal", () => {
    const selection = selectLatestNewPosition([
      position("already_published", "2026-08-21T14:20:00.000Z"),
    ], {
      status: "SIGNAL_CREATED",
      source_data_cutoff_utc: "2026-08-21T14:20:00.000Z",
    }, "2026-08-21T14:25:00.000Z");

    assert.equal(selection.candidate, null);
    assert.equal(selection.diagnostics.reason, "PREVIOUS_CUTOFF_ALREADY_PUBLISHED");
  });

  test("keeps older retroactive candidates out of the live publication window", () => {
    const candidate = latestNewPosition([
      position("retroactive_hindsight", "2026-08-21T13:55:00.000Z"),
    ], {
      status: "NO_SIGNAL",
      source_data_cutoff_utc: "2026-08-21T14:20:00.000Z",
    }, "2026-08-21T14:25:00.000Z");

    assert.equal(candidate, null);
  });

  test("does not publish a simulated position after the signal TTL expired", () => {
    const selection = selectLatestNewPosition([
      position("expired_candidate", "2026-08-21T13:50:00.000Z"),
    ], null, "2026-08-21T14:25:00.000Z");

    assert.equal(selection.candidate, null);
    assert.equal(selection.diagnostics.reason, "NO_UNEXPIRED_SIMULATED_POSITION_IN_PUBLICATION_WINDOW");
    assert.equal(selection.diagnostics.expired_position_count, 1);
  });

  test("publishes signal validity from market cutoff instead of simulated fill time", () => {
    const signal = strategySignalFromRuntimePosition({
      signalId: "signal-001",
      correlationId: "correlation-001",
      definition: strategyDefinition(),
      version: strategyVersion(strategyDsl()),
      instance: strategyInstance("3b2f1a90-6e3d-4b8e-9d1a-2f6c8e0a9b11"),
      candidate: {
        position_id: "candidate-001",
        setup_id: "setup-001",
        instrument: "MNQ",
        direction: "long",
        entry_price: 20100,
        entry_time: "2026-08-21T14:00:00.000Z",
        entry_row: { timestamp_utc: "2026-08-21T14:00:00.000Z" },
        entry_order: { order_type: "MARKET", limit_price: 20100 },
        stop_loss: 20080,
        take_profit_1: 20140,
        quantity: 1,
      },
      market: { cutoffUtc: "2026-08-21T14:25:00.000Z" },
      timeframe: "5",
      evaluationId: "strategy_eval_001",
      sourceClass: "LIVE",
      certificationRunId: null,
    });

    assert.equal(signal.generated_at_utc, "2026-08-21T14:25:00.000Z");
    assert.equal(signal.expires_at_utc, "2026-08-21T14:55:00.000Z");
    assert.equal(signal.source_data_cutoff_utc, "2026-08-21T14:25:00.000Z");
    assert.equal(signal.signal_quality.temporal_alignment, "PUBLICATION_CUTOFF");
    assert.equal(signal.signal_quality.simulated_entry_time_utc, "2026-08-21T14:00:00.000Z");
  });

  test("explains empty simulation results in NO_SIGNAL diagnostics", () => {
    const selection = selectLatestNewPosition([], {
      status: "NO_SIGNAL",
      source_data_cutoff_utc: "2026-08-21T14:20:00.000Z",
    }, "2026-08-21T14:25:00.000Z");

    assert.equal(selection.candidate, null);
    assert.equal(selection.diagnostics.reason, "NO_SIMULATED_POSITION");
    assert.equal(selection.diagnostics.total_positions, 0);
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
      if (sql.includes("INTERVAL '10 days'")) {
        assert.match(sql, /trading_date::date\s+>=/);
        assert.match(sql, /trading_date::date\s+<=/);
      }
      return { rows };
    },
  };
}

function position(positionId, timestampUtc) {
  return {
    position_id: positionId,
    direction: "short",
    entry_row: { timestamp_utc: timestampUtc },
    entry_order: { limit_price: 29230.5 },
  };
}
