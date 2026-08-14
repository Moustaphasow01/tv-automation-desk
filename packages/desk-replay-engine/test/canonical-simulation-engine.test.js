import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  STRATEGY_DSL_SCHEMA_VERSION_V1,
  STRATEGY_PATTERN_BREAKOUT_RETEST_V1,
  canonicalJson,
  compileStrategyVersionToDeterministicPlanV1,
} from "@tv-automation/desk-domain";
import {
  CANONICAL_SIMULATION_SCHEMA_VERSION_V1,
  runCanonicalSimulationV1,
} from "../index.js";

const definitionId = "8f14e45f-ceea-467e-add4-8c1f9f0d2a1b";
const versionId = "3b2f1a90-6e3d-4b8e-9d1a-2f6c8e0a9b11";
const metricsRef = "6c1a3e00-1111-4a2b-9c3d-abcdef012345";

describe("canonical simulation engine V1", () => {
  it("replays a compiled Strategy DSL plan with deterministic metrics and events", () => {
    const input = simulationInput({ rows: winningRows(), cutoff: "2026-06-11T10:10:00+02:00" });
    const first = runCanonicalSimulationV1(input);
    const second = runCanonicalSimulationV1(input);

    assert.equal(first.schema_version, CANONICAL_SIMULATION_SCHEMA_VERSION_V1);
    assert.equal(first.status, "COMPLETED");
    assert.equal(first.metrics.metric_version, "2.0.0");
    assert.equal(first.metrics.trade_count, 1);
    assert.equal(first.metrics.total_r, 2.3333);
    assert.equal(first.metrics.segmentations.by_instrument.MNQ.total_r, 2.3333);
    assert.equal(first.metrics_hash, second.metrics_hash);
    assert.equal(first.content_hash, second.content_hash);
    assert.deepEqual(first.metrics, second.metrics);
    assert.ok(first.events.some((event) => event.type === "CONDITIONS_EVALUATED" && event.payload.trigger_eligible === true));
    assert.ok(first.events.some((event) => event.type === "ORDER_FILLED"));
    assert.ok(first.events.some((event) => event.type === "SETUP_TRIGGERED"));
    assert.ok(first.events.some((event) => event.type === "POSITION_CLOSED"));
  });

  it("enforces cutoff and ignores future rows that would change the result", () => {
    const result = runCanonicalSimulationV1(simulationInput({
      rows: winningRows(),
      cutoff: "2026-06-11T10:03:00+02:00",
    }));

    assert.equal(result.status, "COMPLETED");
    assert.equal(result.data_quality.ignored_post_cutoff_rows, 1);
    assert.equal(result.metrics.trade_count, 0);
    assert.equal(result.metrics.open_position_count, 1);
    assert.equal(result.events.some((event) => event.type === "POSITION_CLOSED"), false);
    assert.equal(result.positions[0].status, "OPEN");
  });

  it("can close an open position mark-to-market at cutoff for research comparisons", () => {
    const result = runCanonicalSimulationV1(simulationInput({
      rows: winningRows(),
      cutoff: "2026-06-11T10:03:00+02:00",
      parameters: {
        simulation_policy: { position_at_cutoff: "MARK_TO_MARKET_CLOSE" },
      },
    }));

    assert.equal(result.status, "COMPLETED");
    assert.equal(result.simulation_policy.position_at_cutoff, "MARK_TO_MARKET_CLOSE");
    assert.equal(result.metrics.trade_count, 1);
    assert.equal(result.metrics.open_position_count, 0);
    assert.equal(result.positions[0].status, "CLOSED");
    assert.equal(result.positions[0].exit_reason, "CUTOFF_MARK_TO_MARKET");
    assert.ok(result.events.some((event) => event.type === "POSITION_CLOSED_AT_CUTOFF"));
  });

  it("rejects an unsealed dataset before running the hot loop", () => {
    const result = runCanonicalSimulationV1(simulationInput({
      dataset: { dataset_id: "dataset_unsealed", status: "BUILDING", dataset_hash: null },
    }));

    assert.equal(result.status, "REJECTED");
    assert.ok(result.reasons.includes("DATASET_NOT_SEALED"));
    assert.ok(result.reasons.includes("DATASET_HASH_REQUIRED"));
    assert.equal(result.metrics.trade_count, 0);
  });

  it("does not fabricate an intrabar outcome when stop and target are touched together", () => {
    const rows = [
      row("2026-06-11T10:01:00+02:00", { high: 102, low: 99, close: 101 }),
      row("2026-06-11T10:02:00+02:00", { high: 102, low: 99.5, close: 100.5 }),
      row("2026-06-11T10:03:00+02:00", { high: 102, low: 100.5, close: 101 }),
      row("2026-06-11T10:04:00+02:00", { high: 116, low: 94, close: 100 }),
    ];
    const result = runCanonicalSimulationV1(simulationInput({ rows, cutoff: "2026-06-11T10:10:00+02:00" }));

    assert.equal(result.status, "REVIEW_REQUIRED");
    assert.ok(result.events.some((event) => event.type === "POSITION_REVIEW_REQUIRED"));
    assert.equal(result.metrics.trade_count, 0);
    assert.equal(result.metrics.open_position_count, 1);
  });

  it("applies versioned order simulation costs in the canonical R result", () => {
    const result = runCanonicalSimulationV1(simulationInput({
      rows: winningRows(),
      cutoff: "2026-06-11T10:10:00+02:00",
      parameters: { order_simulation: { pricing: { slippage_points: 1, commission_r_per_contract: 0.1 } } },
    }));

    assert.equal(result.order_simulator_version, "1.0.0");
    assert.equal(result.order_simulation_policy.slippage_points, 1);
    assert.equal(result.metrics.trade_count, 1);
    assert.equal(result.metrics.total_r, 1.5143);
    assert.equal(result.positions[0].gross_r, 1.7143);
    assert.equal(result.positions[0].execution_cost_r, 0.2);
  });

  it("scores a valid long stop loss as negative signed R", () => {
    const result = runCanonicalSimulationV1(simulationInput({
      rows: stopLossRows(),
      cutoff: "2026-06-11T10:10:00+02:00",
    }));

    assert.equal(result.status, "COMPLETED");
    assert.equal(result.metrics.trade_count, 1);
    assert.equal(result.metrics.total_r, -1);
    assert.equal(result.positions[0].exit_reason, "STOP_LOSS");
    assert.equal(result.positions[0].r_result, -1);
    assert.equal(result.positions[0].gross_r, -1);
  });

  it("rejects a market entry fill that violates signed stop geometry", () => {
    const result = runCanonicalSimulationV1(simulationInput({
      artifact: compiledArtifact({
        orderType: "MARKET",
        runtime: runtimeBindings({ invalidation_level: 80 }),
      }),
      rows: invalidMarketEntryRows(),
      cutoff: "2026-06-11T10:10:00+02:00",
    }));

    assert.equal(result.status, "COMPLETED");
    assert.equal(result.metrics.trade_count, 0);
    assert.equal(result.positions.length, 0);
    assert.equal(result.events.some((event) => event.type === "POSITION_OPENED"), false);
    assert.ok(result.events.some((event) => event.type === "ORDER_REJECTED" && event.payload.reason === "ENTRY_STOP_GEOMETRY_INVALID"));
  });

  it("can suppress per-row condition telemetry while keeping lifecycle events", () => {
    const result = runCanonicalSimulationV1(simulationInput({
      rows: winningRows(),
      cutoff: "2026-06-11T10:10:00+02:00",
      parameters: {
        simulation_telemetry: { record_condition_evaluations: false },
      },
    }));

    assert.equal(result.status, "COMPLETED");
    assert.equal(result.events.some((event) => event.type === "CONDITIONS_EVALUATED"), false);
    assert.ok(result.events.some((event) => event.type === "SETUP_TRIGGERED"));
    assert.ok(result.events.some((event) => event.type === "ORDER_FILLED"));
    assert.ok(result.events.some((event) => event.type === "POSITION_CLOSED"));
  });

  it("does not terminally invalidate a breakout-retest before the breakout sequence starts", () => {
    const result = runCanonicalSimulationV1(simulationInput({
      rows: [
        row("2026-06-11T10:00:00+02:00", { high: 100, low: 94, close: 96 }),
        ...winningRows(),
      ],
      cutoff: "2026-06-11T10:10:00+02:00",
    }));

    assert.equal(result.status, "COMPLETED");
    assert.equal(result.metrics.trade_count, 1);
    assert.equal(result.events.some((event) => event.type === "SETUP_INVALIDATED"), false);
    assert.ok(result.events.some((event) => event.type === "SETUP_TRIGGERED"));
  });
});

function simulationInput({ rows = winningRows(), cutoff = "2026-06-11T10:10:00+02:00", dataset = null, parameters = null, artifact = null } = {}) {
  const compiled = artifact || compiledArtifact();
  return {
    run_id: "canonical_sim_run_1",
    strategy_version_id: versionId,
    compiled_artifact: compiled,
    dataset: dataset || {
      dataset_id: "dataset_2026_06_11_mnq_m1",
      status: "READY",
      sealed: true,
      dataset_hash: `sha256:${hash(canonicalJson(rows))}`,
      cutoff_paris: cutoff,
      rows,
    },
    parameters: parameters || { pricing_model: "closed_m1_no_intrabar_fill_v1" },
    reproducibility_seed: "seed-td2-301",
    cutoff_paris: cutoff,
    run_started_at_utc: "2026-08-09T08:30:00.000Z",
  };
}

function compiledArtifact({ orderType = "LIMIT", runtime = runtimeBindings() } = {}) {
  const dsl = {
    schema_version: STRATEGY_DSL_SCHEMA_VERSION_V1,
    pattern: STRATEGY_PATTERN_BREAKOUT_RETEST_V1,
    setup_templates: [{
      template_id: "mnq_long_breakout_retest",
      direction: "long",
      instrument: "MNQ",
      timeframe: "M1",
      entry_mode: "RETEST_ZONE_AFTER_CONFIRMATION",
      order_type: orderType,
      rank: 1,
      status: "ARMED_CONDITIONAL",
      tolerance_points: 1,
      max_bars: 12,
      rr_minimum: 2,
      risk_pct: 0.25,
    }],
    metadata: { compiler_target: "deterministic_execution_plan_v1_4" },
  };
  const result = compileStrategyVersionToDeterministicPlanV1({
    strategy_definition: definition(),
    strategy_version: version(dsl),
    dsl_source: dsl,
    runtime_bindings: runtime,
    scope: { strategy_id: "breakout-retest-mnq", session: "ny_open", trading_date: "2026-06-11", cutoff_paris: "2026-06-11T10:00:00+02:00" },
    source_mode: "PAPER",
  });
  assert.equal(result.ok, true);
  return result.compiled_artifact;
}

function definition() {
  return {
    strategy_definition_id: definitionId,
    external_key: "breakout-retest-mnq",
    name: "Breakout Retest MNQ",
    owner: "strategy-lab",
    asset_class: "FUTURES",
    default_instruments: ["MNQ"],
    tags: ["simulation"],
    metadata: {},
    created_at: "2026-08-07T09:00:00.000Z",
  };
}

function version(dsl) {
  const source = canonicalJson(dsl);
  return {
    strategy_version_id: versionId,
    strategy_definition_id: definitionId,
    version_label: "1.0.0",
    status: "PUBLISHED",
    dsl_source_hash: `sha256:${hash(source)}`,
    compiled_artifact_ref: "artifact://strategy/breakout-retest-mnq/1.0.0",
    compiled_artifact_hash: null,
    validated_metrics_ref: metricsRef,
    runtime_contract_bundle_version: "engine=5.4.0,catalog=v1-2",
    created_at: "2026-08-07T09:10:00.000Z",
    published_at: "2026-08-07T10:00:00.000Z",
    metadata: {},
  };
}

function runtimeBindings(setupOverrides = {}) {
  return {
    valid_from_paris: "2026-06-11T10:00:00+02:00",
    expires_at_paris: "2026-06-11T10:30:00+02:00",
    setups: [{
      template_id: "mnq_long_breakout_retest",
      setup_id: "strategy_setup_mnq_long_100",
      break_level: 100,
      retest_level: 100,
      entry_zone: { lower: 100, upper: 101 },
      stop_loss: 95,
      take_profit_1: 115,
      invalidation_level: 95,
      ...setupOverrides,
    }],
  };
}

function winningRows() {
  return [
    row("2026-06-11T10:01:00+02:00", { high: 102, low: 99, close: 101 }),
    row("2026-06-11T10:02:00+02:00", { high: 102, low: 99.5, close: 100.5 }),
    row("2026-06-11T10:03:00+02:00", { high: 102, low: 100.5, close: 101 }),
    row("2026-06-11T10:04:00+02:00", { high: 116, low: 101, close: 115 }),
  ];
}

function stopLossRows() {
  return [
    row("2026-06-11T10:01:00+02:00", { high: 102, low: 99, close: 101 }),
    row("2026-06-11T10:02:00+02:00", { high: 102, low: 99.5, close: 100.5 }),
    row("2026-06-11T10:03:00+02:00", { high: 102, low: 100.5, close: 101 }),
    row("2026-06-11T10:04:00+02:00", { open: 101, high: 102, low: 100.5, close: 101 }),
    row("2026-06-11T10:05:00+02:00", { open: 101, high: 101, low: 94, close: 95 }),
  ];
}

function invalidMarketEntryRows() {
  return [
    row("2026-06-11T10:01:00+02:00", { high: 102, low: 99, close: 101 }),
    row("2026-06-11T10:02:00+02:00", { open: 94, high: 102, low: 94, close: 100.5 }),
    row("2026-06-11T10:03:00+02:00", { open: 94, high: 102, low: 94, close: 101 }),
    row("2026-06-11T10:04:00+02:00", { open: 94, high: 102, low: 94, close: 101 }),
  ];
}

function row(timestamp, { open = 100, high, low, close }) {
  return {
    timestamp_paris: timestamp,
    instrument: "MNQ",
    timeframe: "M1",
    open,
    high,
    low,
    close,
    closed: true,
  };
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
