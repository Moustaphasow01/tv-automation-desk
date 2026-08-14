import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  runCanonicalSimulationV1,
} from "@tv-automation/desk-replay-engine";
import {
  buildResearchStrategyIterationPlan,
} from "../src/research/research-strategy-iteration-runner.js";
import {
  strategyIterationVersionLabel,
} from "../src/research/research-strategy-iteration-materializer.js";
import {
  researchStrategyIterationGeneratorSlug,
} from "../src/research/research-strategy-iteration-common.js";

describe("research strategy iteration runner", () => {
  it("plans bounded deterministic variants from a rejected candidate", () => {
    const plan = buildResearchStrategyIterationPlan({
      task: taskFixture(),
      payload: taskFixture().payload,
      sourceCandidate: candidateFixture(),
      context: contextFixture(),
      nowUtc: "2026-08-13T08:00:00.000Z",
    });

    assert.equal(plan.schema_version, "research_strategy_iteration_runner_v1");
    assert.equal(plan.iteration_index, 1);
    assert.equal(plan.variants.length, 4);
    assert.equal(new Set(plan.variants.map((variant) => variant.research_candidate_id)).size, 4);
    assert.ok(plan.variants.every((variant) => variant.strategy_definition_id === candidateFixture().strategy_definition_id));
    assert.deepEqual(plan.variants.map((variant) => variant.variant_label), [
      "balanced",
      "wide-retest",
      "quick-retest",
      "deep-retest",
    ]);
    assert.ok(plan.variants.every((variant) => variant.variant_id.includes(researchStrategyIterationGeneratorSlug())));
    assert.ok(plan.variants.every((variant) => variant.levels.long.entry_zone.lower < variant.levels.long.entry_zone.upper));
    assert.ok(plan.variants.every((variant) => variant.levels.short.entry_zone.lower < variant.levels.short.entry_zone.upper));
    assert.ok(plan.variants.every((variant) => rr(variant.levels.long) >= 2));
    assert.ok(plan.variants.every((variant) => rr(variant.levels.short) >= 2));
    assert.ok(plan.variants.every((variant) => variant.runtime_setups.length >= 8));
    assert.ok(plan.variants.every((variant) => variant.runtime_setups.some((setup) => setup.valid_from_paris)));
  });

  it("caps generated variants to the strategy compiler portfolio limit", () => {
    const plan = buildResearchStrategyIterationPlan({
      task: taskFixture(),
      payload: { ...taskFixture().payload, max_variants: 9, iteration_index: 3 },
      sourceCandidate: candidateFixture(),
      context: contextFixture(),
      nowUtc: "2026-08-13T08:00:00.000Z",
    });

    assert.equal(plan.iteration_index, 3);
    assert.equal(plan.variants.length, 5);
  });

  it("keeps generated timestamps and variant identities stable across task retries", () => {
    const task = taskFixture();
    const first = buildResearchStrategyIterationPlan({
      task,
      payload: task.payload,
      sourceCandidate: candidateFixture(),
      context: contextFixture(),
      nowUtc: "2026-08-13T08:00:00.000Z",
    });
    const retry = buildResearchStrategyIterationPlan({
      task,
      payload: task.payload,
      sourceCandidate: candidateFixture(),
      context: contextFixture(),
      nowUtc: "2026-08-13T09:15:00.000Z",
    });

    assert.equal(first.generated_at_utc, task.created_at_utc);
    assert.equal(retry.generated_at_utc, task.created_at_utc);
    assert.deepEqual(first.variants.map((variant) => variant.variant_id), retry.variants.map((variant) => variant.variant_id));
    assert.deepEqual(first.variants.map((variant) => variant.created_at_utc), retry.variants.map((variant) => variant.created_at_utc));
  });

  it("separates branch identities and semver labels for same iteration variants from different source candidates", () => {
    const sourceA = candidateFixture();
    const sourceB = {
      ...candidateFixture(),
      research_candidate_id: "11111111-2222-4333-8444-555555555555",
    };
    const first = buildResearchStrategyIterationPlan({
      task: taskFixture(),
      payload: taskFixture().payload,
      sourceCandidate: sourceA,
      context: contextFixture(),
      nowUtc: "2026-08-13T08:00:00.000Z",
    });
    const second = buildResearchStrategyIterationPlan({
      task: taskFixture(),
      payload: { ...taskFixture().payload, research_candidate_id: sourceB.research_candidate_id },
      sourceCandidate: sourceB,
      context: contextFixture(),
      nowUtc: "2026-08-13T08:00:00.000Z",
    });

    assert.equal(first.variants[0].strategy_definition_id, second.variants[0].strategy_definition_id);
    assert.notEqual(first.variants[0].variant_id, second.variants[0].variant_id);
    assert.notEqual(first.variants[0].strategy_version_id, second.variants[0].strategy_version_id);
    assert.match(strategyIterationVersionLabel(first.variants[0]), /^1\.1\.0\+[0-9a-f]{12}$/);
    assert.notEqual(strategyIterationVersionLabel(first.variants[0]), strategyIterationVersionLabel(second.variants[0]));
  });

  it("produces executable variant geometry for the canonical simulator", () => {
    const context = tradableContextFixture();
    const plan = buildResearchStrategyIterationPlan({
      task: taskFixture(),
      payload: taskFixture().payload,
      sourceCandidate: candidateFixture(),
      context,
      nowUtc: "2026-08-13T08:00:00.000Z",
    });
    const variant = plan.variants[0];
    const simulation = runCanonicalSimulationV1({
      run_id: "research-iteration-test-run",
      strategy_version_id: variant.strategy_version_id,
      deterministic_execution_plan: deterministicPlanFromVariant(variant, context),
      dataset: simulationDataset(context),
      rows: context.rows,
      parameters: {
        order_simulation_policy: {
          ambiguous_intrabar_policy: "CONSERVATIVE_STOP",
          spread_points: 0,
          slippage_points: 0,
          commission_r_per_contract: 0,
        },
      },
      cutoff_paris: "2026-06-01T06:00:00+02:00",
      run_started_at_utc: "2026-06-01T00:00:00.000Z",
    });

    assert.equal(simulation.status, "COMPLETED");
    assert.equal(simulation.metrics.trade_count, 1);
    assert.ok(simulation.metrics.total_r > 0);
  });
});

function rr(levels) {
  const entry = levels.direction === "short" ? levels.entry_zone.lower : levels.entry_zone.upper;
  const risk = Math.abs(entry - levels.stop_loss);
  const reward = Math.abs(levels.take_profit_1 - entry);
  return reward / risk;
}

function deterministicPlanFromVariant(variant, context) {
  return {
    valid: true,
    strategy_version_id: variant.strategy_version_id,
    ranked_setups: [setupFromLevels(variant, context.scope.instrument, variant.levels.long)],
  };
}

function setupFromLevels(variant, instrument, levels) {
  const setupId = `test_setup_${variant.variant_label}_${levels.direction}`;
  return {
    setup_id: setupId,
    compile_status: "COMPILED",
    rank: 1,
    instrument,
    timeframe: "M5",
    direction: levels.direction,
    status: "ARMED_CONDITIONAL",
    order_type: levels.order_type,
    entry_mode: "RETEST_ZONE_AFTER_CONFIRMATION",
    entry_zone: levels.entry_zone,
    stop_loss: levels.stop_loss,
    take_profit_1: levels.take_profit_1,
    rr_minimum: levels.rr_minimum,
    risk_pct: 0.25,
    valid_from_paris: "2026-06-01T02:00:00+02:00",
    expires_at_paris: "2026-06-01T06:00:00+02:00",
    conditions: [
      {
        condition_id: `${setupId}__break_retest_sequence`,
        predicate_type: "BREAK_RETEST_SEQUENCE",
        role: "ACTIVATION",
        effect: "REQUIRE_TRUE",
        instrument,
        timeframe: "M5",
        operator: "CLOSE_ABOVE",
        threshold: levels.break_level,
        break_threshold: levels.break_level,
        parameters: {
          break_condition_id: `${setupId}__break_close`,
          break_threshold: levels.break_level,
          retest_level: levels.retest_level,
          tolerance_points: levels.tolerance_points,
          max_bars: levels.max_bars,
          require_rejection_confirmation: false,
        },
        importance: "MANDATORY",
        required_for_trigger: true,
        memory_policy: "LATCH_UNTIL_TRIGGER",
      },
      {
        condition_id: `${setupId}__invalidation`,
        predicate_type: "PRICE_RELATION",
        role: "INVALIDATION",
        effect: "BLOCK_IF_TRUE",
        instrument,
        timeframe: "M5",
        operator: "CLOSE_BELOW",
        threshold: levels.invalidation_level,
        parameters: { threshold: levels.invalidation_level },
        importance: "HARD_BLOCKER",
        required_for_trigger: false,
        memory_policy: "INVALIDATE_TERMINAL",
      },
    ],
  };
}

function simulationDataset(context) {
  return {
    dataset_id: context.dataset.dataset_id,
    dataset_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sealed: true,
    cutoff_paris: "2026-06-01T06:00:00+02:00",
    sealed_at_utc: "2026-06-01T04:00:00.000Z",
    rows: context.rows,
  };
}

function taskFixture() {
  return {
    task_id: "33f2c5f1-9f1e-4ad3-a25c-9c98a54ba541",
    task_type: "RESEARCH_STRATEGY_ITERATION",
    lane: "research",
    created_at_utc: "2026-08-13T07:59:00.000Z",
    payload: {
      dataset_id: "df0770d1-9143-40e1-98fc-67583258ba74",
      dataset_key: "demo-paper.mnq.m5.2026-06-01_2026-07-01",
      simulation_run_id: "0df112b0-745e-4cdb-af78-8ad7b2c77473",
      research_candidate_id: "88450ab3-3f90-4878-9659-8b4e968413ee",
      metrics: { total_r: 0, trade_count: 0, max_drawdown_r: 0 },
    },
  };
}

function candidateFixture() {
  return {
    research_experiment_id: "b81f380c-eaad-4def-91b3-e576c55a38c6",
    research_hypothesis_id: "a49fd68e-bcb7-49ac-b1c8-1dc42c7436aa",
    research_candidate_id: "88450ab3-3f90-4878-9659-8b4e968413ee",
    strategy_definition_id: "4b22bd26-ddb2-483b-ae04-95de4990b1bb",
  };
}

function contextFixture() {
  return {
    dataset: {
      dataset_id: "df0770d1-9143-40e1-98fc-67583258ba74",
      dataset_key: "demo-paper.mnq.m5.2026-06-01_2026-07-01",
    },
    scope: {
      instrument: "MNQ",
      dataset_key: "demo-paper.mnq.m5.2026-06-01_2026-07-01",
    },
    rows: rows(),
  };
}

function tradableContextFixture() {
  return {
    ...contextFixture(),
    rows: tradableRows(),
  };
}

function rows() {
  const result = [];
  for (let day = 1; day <= 6; day += 1) {
    for (let candle = 0; candle < 40; candle += 1) {
      const base = 28_000 + day * 20 + candle * 0.5;
      result.push({
        trading_date: `2026-06-${String(day).padStart(2, "0")}`,
        time: `2026-06-${String(day).padStart(2, "0")}T09:${String(candle).padStart(2, "0")}:00+02:00`,
        high: base + 5,
        low: base - 5,
      });
    }
  }
  return result;
}

function tradableRows() {
  const result = [];
  for (let candle = 0; candle < 36; candle += 1) {
    result.push(candleRow({
      minute: candle * 5,
      open: 95,
      high: 100,
      low: 90,
      close: 96,
    }));
  }
  result.push(candleRow({ minute: 180, open: 99, high: 106, low: 98, close: 104 }));
  result.push(candleRow({ minute: 185, open: 104, high: 105, low: 99, close: 101 }));
  result.push(candleRow({ minute: 190, open: 102, high: 111, low: 101, close: 110 }));
  result.push(candleRow({ minute: 195, open: 110, high: 150, low: 109, close: 145 }));
  return result;
}

function candleRow({ minute, open, high, low, close }) {
  const timestamp = new Date(Date.UTC(2026, 5, 1, 0, minute, 0));
  return {
    instrument: "MNQ",
    symbol: "MNQ1!",
    timeframe: "M5",
    trading_date: "2026-06-01",
    time: timestamp.toISOString().replace(".000Z", "+02:00"),
    timestamp_utc: timestamp.toISOString(),
    open,
    high,
    low,
    close,
    volume: 1000,
    is_closed: true,
  };
}
