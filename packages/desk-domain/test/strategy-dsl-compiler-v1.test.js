import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  STRATEGY_COMPILED_ARTIFACT_SCHEMA_VERSION_V1,
  STRATEGY_DSL_COMPILER_VERSION_V1,
  STRATEGY_DSL_SCHEMA_VERSION_V1,
  STRATEGY_PATTERN_BREAKOUT_RETEST_V1,
  canonicalJson,
  compileStrategyVersionToDeterministicPlanV1,
  parseStrategyDslSourceV1,
} from "../index.js";

const STRATEGY_DEFINITION_ID = "8f14e45f-ceea-467e-add4-8c1f9f0d2a1b";
const STRATEGY_VERSION_ID = "3b2f1a90-6e3d-4b8e-9d1a-2f6c8e0a9b11";
const METRICS_REF = "6c1a3e00-1111-4a2b-9c3d-abcdef012345";
const DSL_EXAMPLE_URL = new URL("../../desk-contracts/examples/strategy-breakout-retest-dsl-v1.example.json", import.meta.url);
const RUNTIME_BINDINGS_EXAMPLE_URL = new URL("../../desk-contracts/examples/strategy-breakout-retest-runtime-bindings.example.json", import.meta.url);

function sha256Text(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function definition(overrides = {}) {
  return {
    strategy_definition_id: STRATEGY_DEFINITION_ID,
    external_key: "breakout-retest-mnq",
    name: "Breakout Retest MNQ",
    description: "Breakout/retest déterministe sur MNQ.",
    owner: "operator@desk",
    asset_class: "FUTURES",
    default_instruments: ["MNQ", "MES"],
    tags: ["strategy-kernel", "breakout-retest"],
    created_at: "2026-08-07T09:00:00.000Z",
    metadata: { desk: "preprod" },
    ...overrides,
  };
}

function breakoutRetestDsl(overrides = {}) {
  return {
    schema_version: STRATEGY_DSL_SCHEMA_VERSION_V1,
    pattern: STRATEGY_PATTERN_BREAKOUT_RETEST_V1,
    setup_templates: [
      {
        template_id: "mnq_long_breakout_retest",
        direction: "long",
        instrument: "MNQ",
        timeframe: "M1",
        entry_mode: "RETEST_ZONE_AFTER_CONFIRMATION",
        order_type: "LIMIT",
        rank: 1,
        status: "ARMED_CONDITIONAL",
        tolerance_points: 1,
        max_bars: 12,
        rr_minimum: 2,
        risk_pct: 0.25,
        break_even_at_r: 0.7,
        tp1_close_fraction: 0.5,
      },
    ],
    metadata: {
      compiler_target: "deterministic_execution_plan_v1_4",
    },
    ...overrides,
  };
}

function version(dsl, overrides = {}) {
  const dslSource = canonicalJson(dsl);
  return {
    strategy_version_id: STRATEGY_VERSION_ID,
    strategy_definition_id: STRATEGY_DEFINITION_ID,
    version_label: "1.0.0",
    status: "PUBLISHED",
    dsl_source: dslSource,
    dsl_source_hash: sha256Text(dslSource),
    compiled_artifact_ref: "artifact://strategy/breakout-retest-mnq/1.0.0",
    compiled_artifact_hash: null,
    validated_metrics_ref: METRICS_REF,
    runtime_contract_bundle_version: "engine=5.4.0,catalog=v1-2",
    created_at: "2026-08-07T09:10:00.000Z",
    published_at: "2026-08-07T10:00:00.000Z",
    metadata: { compiler: STRATEGY_DSL_COMPILER_VERSION_V1 },
    ...overrides,
  };
}

function runtimeBindings(overrides = {}) {
  return {
    plan_id: "strategy_plan__breakout_retest_mnq__2026_06_11_1530",
    thesis_id: "strategy_thesis__breakout_retest_mnq__2026_06_11_1530",
    analysis_id: "strategy_analysis__breakout_retest_mnq__2026_06_11_1530",
    decision_id: "strategy_decision__breakout_retest_mnq__2026_06_11_1530",
    setup_id_prefix: "strategy_setup",
    valid_from_paris: "2026-06-11T15:30:00+02:00",
    expires_at_paris: "2026-06-11T16:15:00+02:00",
    setups: [
      {
        template_id: "mnq_long_breakout_retest",
        setup_id: "strategy_setup__mnq_long_breakout_retest__2026_06_11_1530",
        break_level: 22000,
        retest_level: 22002,
        entry_zone: { lower: 22000.5, upper: 22004.5 },
        stop_loss: 21980,
        take_profit_1: 22060,
        invalidation_level: 21980,
      },
    ],
    ...overrides,
  };
}

function scope(overrides = {}) {
  return {
    strategy_id: "breakout-retest-mnq",
    session: "ny_open",
    trading_date: "2026-06-11",
    timezone: "Europe/Paris",
    cutoff_paris: "2026-06-11T15:30:00+02:00",
    pack_id: "pack_2026_06_11_1530",
    pack_build_id: "packbuild_2026_06_11_1530",
    ...overrides,
  };
}

describe("Strategy DSL compiler V1", () => {
  it("compiles BREAKOUT_RETEST into the existing deterministic execution plan shape", () => {
    const dsl = breakoutRetestDsl();
    const result = compileStrategyVersionToDeterministicPlanV1({
      strategy_definition: definition(),
      strategy_version: version(dsl),
      runtime_bindings: runtimeBindings(),
      scope: scope(),
      source_mode: "PAPER",
    });

    assert.equal(result.ok, true);
    assert.equal(result.compiler_version, STRATEGY_DSL_COMPILER_VERSION_V1);
    assert.equal(result.compiled_artifact.schema_version, STRATEGY_COMPILED_ARTIFACT_SCHEMA_VERSION_V1);
    assert.match(result.compiled_artifact.compiled_artifact_hash, /^sha256:[a-f0-9]{64}$/);

    const plan = result.deterministic_execution_plan;
    assert.equal(plan.schema_version, "deterministic_execution_plan_v1_4");
    assert.equal(plan.compiler_version, "1.4.0");
    assert.equal(plan.valid, true);
    assert.equal(plan.disposition, "SETUP_CONDITIONAL");
    assert.equal(plan.transport_context.source_mode, "PAPER");
    assert.equal(plan.ranked_setups.length, 1);

    const [setup] = plan.ranked_setups;
    assert.equal(setup.compile_status, "COMPILED");
    assert.equal(setup.status, "ARMED_CONDITIONAL");
    assert.equal(setup.instrument, "MNQ");
    assert.equal(setup.direction, "long");
    assert.equal(setup.entry_mode, "RETEST_ZONE_AFTER_CONFIRMATION");
    assert.equal(setup.trigger_policy.backend_can_trigger, true);
    assert.equal(setup.geometry_evaluation.valid, true);
    assert.ok(setup.geometry_evaluation.effective_rr >= 2);

    const byPredicate = new Map(setup.conditions.map((condition) => [condition.predicate_type, condition]));
    assert.equal(byPredicate.get("BREAK_RETEST_SEQUENCE").required_for_trigger, true);
    assert.equal(byPredicate.get("BREAK_RETEST_SEQUENCE").operator, "CLOSE_ABOVE");
    assert.equal(byPredicate.get("ZONE_TOUCH").operator, "TOUCH_BELOW");
    assert.equal(byPredicate.get("ZONE_TOUCH").required_for_trigger, false);
    assert.equal(byPredicate.get("ZONE_TOUCH").atomic_component, true);
    assert.equal(byPredicate.get("ZONE_TOUCH").subsumed_by_condition_id, byPredicate.get("BREAK_RETEST_SEQUENCE").condition_id);
    assert.equal(byPredicate.get("REJECTION_PATTERN").operator, "REJECT_SUPPORT");
    assert.equal(byPredicate.get("REJECTION_PATTERN").required_for_trigger, false);
    assert.equal(byPredicate.get("REJECTION_PATTERN").atomic_component, true);
    assert.equal(byPredicate.get("REJECTION_PATTERN").subsumed_by_condition_id, byPredicate.get("BREAK_RETEST_SEQUENCE").condition_id);
    assert.equal(byPredicate.get("PRICE_RELATION").effect, "BLOCK_IF_TRUE");
  });

  it("does not score rejection confirmation when the breakout retest sequence does not require it", () => {
    const dsl = breakoutRetestDsl({
      setup_templates: [{
        ...breakoutRetestDsl().setup_templates[0],
        require_rejection_confirmation: false,
      }],
    });
    const result = compileStrategyVersionToDeterministicPlanV1({
      strategy_definition: definition(),
      strategy_version: version(dsl),
      runtime_bindings: runtimeBindings(),
      scope: scope(),
      source_mode: "PAPER",
    });

    assert.equal(result.ok, true);
    const setup = result.deterministic_execution_plan.ranked_setups[0];
    const sequence = setup.conditions.find((condition) => condition.predicate_type === "BREAK_RETEST_SEQUENCE");
    const rejection = setup.conditions.find((condition) => condition.predicate_type === "REJECTION_PATTERN");
    assert.equal(sequence.parameters.require_rejection_confirmation, false);
    assert.equal(rejection.importance, "ADVISORY");
    assert.equal(rejection.weight, 0);
    assert.equal(rejection.required_for_trigger, false);
    assert.equal(rejection.sequence, null);
  });

  it("rejects a Strategy Version without a parseable DSL source", () => {
    const result = compileStrategyVersionToDeterministicPlanV1({
      strategy_definition: definition(),
      strategy_version: version(breakoutRetestDsl(), {
        dsl_source: "strategy breakout_retest_mnq { legacy syntax }",
      }),
      runtime_bindings: runtimeBindings(),
      scope: scope(),
    });

    assert.equal(result.ok, false);
    assert.ok(result.reasons.includes("STRATEGY_DSL_PARSE_FAILED"));
    assert.equal(result.deterministic_execution_plan, null);
    assert.equal(result.compiled_artifact, null);
  });

  it("compiles multiple runtime bindings for the same template into distinct executable setups", () => {
    const dsl = breakoutRetestDsl();
    const bindings = runtimeBindings({
      setups: [
        runtimeBindings().setups[0],
        {
          ...runtimeBindings().setups[0],
          setup_id: "strategy_setup__mnq_long_breakout_retest__2026_06_12_1530",
          trading_date: "2026-06-12",
          valid_from_paris: "2026-06-12T15:30:00+02:00",
          expires_at_paris: "2026-06-12T16:15:00+02:00",
          break_level: 22100,
          retest_level: 22102,
          entry_zone: { lower: 22100.5, upper: 22104.5 },
          stop_loss: 22080,
          take_profit_1: 22160,
          invalidation_level: 22080,
        },
      ],
    });
    const result = compileStrategyVersionToDeterministicPlanV1({
      strategy_definition: definition(),
      strategy_version: version(dsl),
      runtime_bindings: bindings,
      scope: scope(),
      source_mode: "PAPER",
    });

    assert.equal(result.ok, true);
    assert.equal(result.deterministic_execution_plan.ranked_setups.length, 2);
    assert.deepEqual(result.deterministic_execution_plan.ranked_setups.map((setup) => setup.setup_id), [
      "strategy_setup__mnq_long_breakout_retest__2026_06_11_1530",
      "strategy_setup__mnq_long_breakout_retest__2026_06_12_1530",
    ]);
  });

  it("rejects source hash drift before compiling any runtime artifact", () => {
    const dsl = breakoutRetestDsl();
    const result = compileStrategyVersionToDeterministicPlanV1({
      strategy_definition: definition(),
      strategy_version: version(dsl, {
        dsl_source_hash: sha256Text(canonicalJson({ ...dsl, pattern: "OTHER" })),
      }),
      runtime_bindings: runtimeBindings(),
      scope: scope(),
    });

    assert.equal(result.ok, false);
    assert.ok(result.reasons.includes("STRATEGY_HASH_MISMATCH"));
    assert.ok(result.reasons.includes("STRATEGY_DSL_SOURCE_HASH_MISMATCH"));
    assert.equal(result.deterministic_execution_plan, null);
  });

  it("rejects incomplete runtime bindings instead of fabricating executable prices", () => {
    const dsl = breakoutRetestDsl();
    const result = compileStrategyVersionToDeterministicPlanV1({
      strategy_definition: definition(),
      strategy_version: version(dsl),
      runtime_bindings: runtimeBindings({ setups: [{ template_id: "mnq_long_breakout_retest" }] }),
      scope: scope(),
    });

    assert.equal(result.ok, false);
    assert.ok(result.reasons.includes("STRATEGY_RUNTIME_BINDING_PRICE_REQUIRED"));
    assert.ok(result.reasons.includes("STRATEGY_RUNTIME_BINDING_ENTRY_ZONE_REQUIRED"));
    assert.equal(result.deterministic_execution_plan, null);
    assert.equal(result.compiled_artifact, null);
  });

  it("keeps parser behavior explicit for object and JSON string DSL sources", () => {
    const dsl = breakoutRetestDsl();
    assert.deepEqual(parseStrategyDslSourceV1(dsl), dsl);
    assert.deepEqual(parseStrategyDslSourceV1(canonicalJson(dsl)), dsl);
  });

  it("keeps the published BREAKOUT_RETEST examples compilable", async () => {
    const dsl = JSON.parse(await readFile(DSL_EXAMPLE_URL, "utf8"));
    const bindings = JSON.parse(await readFile(RUNTIME_BINDINGS_EXAMPLE_URL, "utf8"));
    const result = compileStrategyVersionToDeterministicPlanV1({
      strategy_definition: definition(),
      strategy_version: version(dsl),
      runtime_bindings: bindings,
      scope: scope(),
      source_mode: "PAPER",
    });

    assert.equal(result.ok, true);
    assert.equal(result.deterministic_execution_plan.valid, true);
    assert.equal(result.deterministic_execution_plan.ranked_setups[0].conditions[0].predicate_type, "BREAK_RETEST_SEQUENCE");
  });
});
