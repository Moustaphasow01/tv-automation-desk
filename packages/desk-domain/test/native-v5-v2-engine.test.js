import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HARD_GATE_CODES_V5,
  HARD_GATE_ENFORCEMENT_PHASES_V5,
  PREDICATE_STATES_V1,
  SOFT_GATE_CODES_V5,
  compileMasterPlanV1,
  compileMonitorCommandV1,
  evaluateDeterministicConditionSetV1,
  evaluateDeterministicPredicateV1,
  evaluateOpportunitySeekingControlledV1,
  transitionSetupStateV1,
} from "../index.js";

const enumCatalog = JSON.parse(readFileSync(
  new URL("../../desk-contracts/enums/enums.json", import.meta.url),
  "utf8",
));

function nativeCondition(overrides = {}) {
  return {
    condition_id: "condition_1",
    label: "Structured condition",
    predicate_type: "PRICE_RELATION",
    role: "ACTIVATION",
    effect: "REQUIRE_TRUE",
    instrument: "MNQ",
    timeframe: "M1",
    operator: "CLOSE_ABOVE",
    parameters: { threshold: 101 },
    importance: "MANDATORY",
    required_for_trigger: true,
    memory_policy: "LATCH_UNTIL_TRIGGER",
    weight: 0,
    sequence: 1,
    temporal_rule: { mode: "LATEST_CLOSED", count: null },
    evidence_refs: ["MNQ_M1"],
    ...overrides,
  };
}

function nativeSetup(overrides = {}) {
  return {
    setup_id: "native_mnq_long",
    rank: 1,
    requested_state: "ARMED_CONDITIONAL",
    pattern: "BREAKOUT_RETEST",
    instrument: "MNQ",
    direction: "long",
    order_type: "LIMIT",
    entry_mode: "RETEST_ZONE_AFTER_CONFIRMATION",
    entry: { zone_lower: 100, zone_upper: 101 },
    stop: { type: "STRUCTURAL", price: 98 },
    targets: [{
      target_id: "tp1",
      price: 107.6,
      action: "PARTIAL_CLOSE",
      close_fraction: 0.5,
    }],
    rr_expected: 2.2,
    conditions: [
      nativeCondition({
        condition_id: "breakout",
        predicate_type: "BREAKOUT_CLOSE",
        operator: "CLOSE_ABOVE",
        parameters: { threshold: 101 },
        sequence: 1,
        temporal_rule: { mode: "ANY_SINCE_ARM", count: null },
      }),
      nativeCondition({
        condition_id: "break_retest",
        predicate_type: "BREAK_RETEST_SEQUENCE",
        operator: "REJECT_SUPPORT",
        parameters: {
          break_condition_id: "breakout",
          retest_level: 101,
          tolerance_points: 0.25,
          max_bars: 3,
          require_rejection_confirmation: true,
        },
        sequence: 2,
        temporal_rule: { mode: "ANY_SINCE_ARM", count: null },
      }),
    ],
    management: { break_even_at_r: 0.7, tp1_close_fraction: 0.5 },
    validity: {
      valid_from_paris: "2026-06-11T09:00:00+02:00",
      expires_at_paris: "2026-06-11T12:00:00+02:00",
    },
    rationale: "Breakout then deterministic retest.",
    evidence_refs: ["MNQ_M1"],
    ...overrides,
  };
}

function gates({ failedHard = null, unknownSoft = "CONTEXTUAL_DATA_GAP" } = {}) {
  return {
    hard: HARD_GATE_CODES_V5.map((code) => ({
      code,
      state: code === failedHard ? "FAIL" : "PASS",
      reason: code === failedHard ? "test failure" : null,
      evidence_refs: [],
    })),
    soft: SOFT_GATE_CODES_V5.map((code) => ({
      code,
      state: code === unknownSoft ? "UNKNOWN" : "PASS",
      reason: code === unknownSoft ? "context unavailable" : null,
      evidence_refs: [],
    })),
  };
}

function nativeMaster(overrides = {}) {
  const scope = {
    mode: "REPLAY",
    trading_date: "2026-06-11",
    session: "full_day",
    run_id: "replay_2026_06_11",
    cutoff_paris: "2026-06-11T09:00:00+02:00",
    timezone: "Europe/Paris",
  };
  return {
    contract: { name: "DeskMasterAnalysisContract", version: "5.4.0" },
    source: {
      master_analysis_id: "master_native_2026_06_11_0900",
      bundle_id: "bundle_native_0900",
      pack_id: "pack_native_0900",
      pack_build_id: "packbuild_native_0900",
    },
    scope,
    active_thesis: {
      thesis_id: "thesis_native",
      plan_id: "plan_native",
      primary_setup_id: "native_mnq_long",
      state: "ACTIVE",
      instrument: "MNQ",
      direction: "long",
      valid_from_paris: "2026-06-11T09:00:00+02:00",
      valid_until_paris: "2026-06-11T12:00:00+02:00",
      requires_replan_after_paris: "2026-06-11T12:00:00+02:00",
    },
    execution_plan: {
      contract: { name: "DeskExecutionPlanContract", version: "1.4.0" },
      plan_id: "plan_native",
      profile: "OPPORTUNITY_SEEKING_CONTROLLED",
      catalog_id: "condition_catalog_v1_2",
      source: {
        master_analysis_id: "master_native_2026_06_11_0900",
        bundle_id: "bundle_native_0900",
        pack_id: "pack_native_0900",
        pack_build_id: "packbuild_native_0900",
      },
      scope,
      disposition: "SETUP_READY",
      primary_setup_id: "native_mnq_long",
      execution_authority: "BACKEND_ONLY",
      validity: {
        valid_from_paris: "2026-06-11T09:00:00+02:00",
        expires_at_paris: "2026-06-11T12:00:00+02:00",
      },
      gates: gates(),
      risk: {
        capital_basis: "NET_EQUITY",
        risk_pct_requested: 0.25,
        min_rr: 2,
        min_weighted_confirmation_ratio: 0.55,
      },
      setups: [nativeSetup()],
      no_setup_proof: null,
      monitoring: {
        engine_cadence: "M1",
        gpt_cadence: "M5",
        next_checkpoint_paris: "2026-06-11T09:05:00+02:00",
        watch_condition_ids: ["breakout", "break_retest"],
      },
    },
    ...overrides,
  };
}

function marketRow(timestamp, overrides = {}) {
  return {
    timestamp_paris: timestamp,
    symbol: "CME_MINI:MNQ1!",
    interval: "1",
    open: 101,
    high: 102,
    low: 100.8,
    close: 101.5,
    closed: true,
    ...overrides,
  };
}

function nativeMonitor(command, overrides = {}) {
  return {
    contract: { name: "DeskHourlyThesisMonitorContract", version: "2.4.0" },
    source: {
      monitor_id: "monitor_native_0905",
      bundle_id: "monitor_bundle_0905",
      pack_id: "pack_native_0905",
      pack_build_id: "packbuild_native_0905",
    },
    scope: {
      mode: "LIVE",
      trading_date: "2026-06-11",
      session: "full_day",
      run_id: "live_2026_06_11",
      cutoff_paris: "2026-06-11T09:05:00+02:00",
      timezone: "Europe/Paris",
    },
    links: {
      master_analysis_id: "master_native_2026_06_11_0900",
      plan_id: "plan_native",
      active_thesis_id: "thesis_native",
      previous_monitor_id: null,
      setup_id: "native_mnq_long",
      position_id: "position_native",
    },
    checkpoint: {
      checkpoint_paris: "2026-06-11T09:05:00+02:00",
      gpt_cadence: "M5",
      engine_cadence: "M1",
      window_start_paris: "2026-06-11T09:00:00+02:00",
      window_end_paris: "2026-06-11T09:05:00+02:00",
    },
    command,
    active_thesis_update: {
      thesis_id: "thesis_native",
      state: "ACTIVE",
      health_score: 80,
      summary: "Thesis remains valid.",
      valid_until_paris: "2026-06-11T12:00:00+02:00",
      requires_replan_after_paris: "2026-06-11T12:00:00+02:00",
    },
    data_quality: {
      state: "OK",
      hard_gate_states: gates({ unknownSoft: null }).hard,
      soft_gate_states: gates().soft,
    },
    alert: null,
    ...overrides,
  };
}

function commandEnvelope(overrides = {}) {
  return {
    contract: { name: "DeskMonitorCommandContract", version: "1.4.0" },
    profile: "OPPORTUNITY_SEEKING_CONTROLLED",
    catalog_id: "condition_catalog_v1_2",
    command_id: "command_native_0905",
    expected_revision: 1,
    created_at_paris: "2026-06-11T09:05:00+02:00",
    plan_id: "plan_native",
    monitor_id: "monitor_native_0905",
    scope: {
      mode: "LIVE",
      trading_date: "2026-06-11",
      session: "full_day",
      run_id: "live_2026_06_11",
      cutoff_paris: "2026-06-11T09:05:00+02:00",
      timezone: "Europe/Paris",
    },
    requested_action: "APPLY_ORTHOGONAL_COMMANDS",
    setup_transition: null,
    transformation: null,
    replan_request: null,
    management_request: null,
    ...overrides,
  };
}

function pinnedPlan({ mode = "LIVE", riskPct = 0.25, runId = "live_2026_06_11" } = {}) {
  return {
    plan_id: "plan_native",
    scope: {
      mode,
      trading_date: "2026-06-11",
      session: "full_day",
      run_id: runId,
      cutoff_paris: "2026-06-11T09:00:00+02:00",
      timezone: "Europe/Paris",
    },
    risk: {
      capital_basis: "NET_EQUITY",
      risk_pct_requested: riskPct,
      min_rr: 2,
      min_weighted_confirmation_ratio: 0.55,
    },
  };
}

describe("Frozen strategy policy and gate catalog", () => {
  it("matches the exact enum catalog without additions or omissions", () => {
    assert.deepEqual(HARD_GATE_CODES_V5, enumCatalog.HARD_GATE_CODES_V5);
    assert.deepEqual(SOFT_GATE_CODES_V5, enumCatalog.SOFT_GATE_CODES_V5);
    assert.equal(HARD_GATE_CODES_V5.length, 12);
    assert.equal(SOFT_GATE_CODES_V5.length, 10);
  });

  it("keeps every hard gate strict while contextual gaps remain soft", () => {
    for (const code of HARD_GATE_CODES_V5) {
      const result = evaluateOpportunitySeekingControlledV1({
        setup: {
          status: "ARMED_CONDITIONAL",
          direction: "long",
          entry_price: 100,
          stop_loss: 98,
          take_profit_1: 104,
          risk_pct: 0.25,
        },
        conditionEvaluation: {},
        gates: [{ code, state: "FAIL" }],
        phase: HARD_GATE_ENFORCEMENT_PHASES_V5[code],
      });
      assert.equal(result.eligible, false, `${code} must block`);
      assert.ok(result.hard_failures.some((entry) => entry.code === code));
    }

    const soft = evaluateOpportunitySeekingControlledV1({
      setup: {
        status: "ARMED_CONDITIONAL",
        direction: "long",
        entry_price: 100,
        stop_loss: 98,
        take_profit_1: 104,
        risk_pct: 0.25,
      },
      conditionEvaluation: {},
      gates: [{ code: "CONTEXTUAL_DATA_GAP", state: "UNKNOWN" }],
    });
    assert.equal(soft.eligible, true);
    assert.ok(soft.soft_gaps.some((entry) => entry.code === "CONTEXTUAL_DATA_GAP"));
  });
});

describe("Native Master V5 / Plan V1 compiler and M1 trigger path", () => {
  it("compiles nested JSON, preserves typed parameters, evaluates the retest, then lets only ENGINE trigger", () => {
    const rawJson = JSON.stringify(nativeMaster());
    const plan = compileMasterPlanV1(JSON.parse(rawJson));
    assert.equal(plan.valid, true);
    assert.equal(plan.plan_id, "plan_native");
    assert.equal(plan.source_reference.contract_version, "5.4.0");
    assert.equal(plan.source_reference.analysis_id, "master_native_2026_06_11_0900");
    assert.equal(plan.analytical_scope.pack_build_id, "packbuild_native_0900");
    assert.equal(plan.ranked_setups.length, 1);

    const setup = plan.ranked_setups[0];
    assert.equal(setup.compile_status, "COMPILED");
    assert.equal(setup.status, "ARMED_CONDITIONAL");
    assert.equal(setup.trigger_policy.backend_can_trigger, true);
    assert.deepEqual(setup.entry_zone, { lower: 100, upper: 101 });
    assert.equal(setup.geometry_evaluation.entry_price, 101);
    assert.equal(setup.geometry_evaluation.computed_rr, 2.2);
    assert.equal(setup.conditions[1].parameters.break_condition_id, "breakout");
    assert.equal(setup.conditions[1].parameters.retest_level, 101);
    assert.equal(setup.conditions[1].parameters.require_rejection_confirmation, true);
    assert.ok(
      setup.gate_evaluation.soft_gaps
        .some((entry) => entry.code === "CONTEXTUAL_DATA_GAP"),
    );

    const conditionEvaluation = evaluateDeterministicConditionSetV1({
      setup,
      conditions: setup.conditions,
      nowParis: "2026-06-11T09:02:30+02:00",
      rows: [
        marketRow("2026-06-11T09:01:00+02:00", {
          low: 101.2,
          high: 102.4,
          close: 102,
        }),
        marketRow("2026-06-11T09:02:00+02:00", {
          low: 100.9,
          high: 101.8,
          close: 101.4,
        }),
      ],
    });
    assert.equal(conditionEvaluation.required_total, 2);
    assert.equal(conditionEvaluation.required_satisfied, 2);
    assert.equal(conditionEvaluation.results[1].state, PREDICATE_STATES_V1.SATISFIED);
    assert.equal(conditionEvaluation.results[1].evidence.break_threshold, 101);
    assert.equal(conditionEvaluation.results[1].evidence.retest_level, 101);

    const policy = evaluateOpportunitySeekingControlledV1({
      setup,
      conditionEvaluation,
      gates: [{ code: "CONTEXTUAL_DATA_GAP", state: "UNKNOWN" }],
      nowParis: "2026-06-11T09:02:30+02:00",
    });
    assert.equal(policy.eligible, true);

    const gptAttempt = transitionSetupStateV1({
      currentState: setup.status,
      command: "ENGINE_TRIGGER",
      authority: "GPT",
    });
    assert.equal(gptAttempt.accepted, false);

    const nextM1 = transitionSetupStateV1({
      currentState: setup.status,
      command: "ENGINE_TRIGGER",
      authority: "ENGINE",
    });
    assert.equal(nextM1.accepted, true);
    assert.equal(nextM1.next_state, "TRIGGERED");
  });

  it("keeps the canonical decision hash identical across LIVE and REPLAY transport", () => {
    const replay = nativeMaster();
    const live = nativeMaster({
      scope: { ...nativeMaster().scope, mode: "LIVE" },
      execution_plan: {
        ...nativeMaster().execution_plan,
        scope: { ...nativeMaster().execution_plan.scope, mode: "LIVE" },
      },
    });
    const replayPlan = compileMasterPlanV1(replay);
    const livePlan = compileMasterPlanV1(live);
    assert.equal(replayPlan.canonical_hash, livePlan.canonical_hash);
    assert.equal(replayPlan.transport_context.source_mode, "REPLAY");
    assert.equal(livePlan.transport_context.source_mode, "LIVE");
  });
});

describe("Every catalog predicate is structurally satisfiable", () => {
  const cases = [
    {
      name: "PRICE_RELATION",
      condition: nativeCondition(),
      positive: [marketRow("2026-06-11T09:01:00+02:00", { close: 102 })],
      negative: [marketRow("2026-06-11T09:01:00+02:00", { close: 100 })],
    },
    {
      name: "PRICE_CROSS",
      condition: nativeCondition({
        predicate_type: "PRICE_CROSS",
        operator: "CROSS_ABOVE",
      }),
      positive: [
        marketRow("2026-06-11T09:00:00+02:00", { close: 100 }),
        marketRow("2026-06-11T09:01:00+02:00", { close: 102 }),
      ],
      negative: [
        marketRow("2026-06-11T09:00:00+02:00", { close: 99 }),
        marketRow("2026-06-11T09:01:00+02:00", { close: 100 }),
      ],
    },
    {
      name: "ZONE_TOUCH",
      condition: nativeCondition({
        predicate_type: "ZONE_TOUCH",
        operator: "TOUCH_ABOVE",
        parameters: { zone_lower: 100, zone_upper: 101 },
      }),
      positive: [marketRow("2026-06-11T09:01:00+02:00", { low: 100.5, high: 102 })],
      negative: [marketRow("2026-06-11T09:01:00+02:00", { low: 102, high: 103 })],
    },
    {
      name: "BREAKOUT_CLOSE",
      condition: nativeCondition({
        predicate_type: "BREAKOUT_CLOSE",
        parameters: { threshold: 101 },
      }),
      positive: [marketRow("2026-06-11T09:01:00+02:00", { close: 102 })],
      negative: [marketRow("2026-06-11T09:01:00+02:00", { close: 100 })],
    },
    {
      name: "BREAK_RETEST_SEQUENCE",
      condition: nativeCondition({
        predicate_type: "BREAK_RETEST_SEQUENCE",
        operator: "REJECT_SUPPORT",
        parameters: {
          break_condition_id: "breakout",
          retest_level: 101,
          tolerance_points: 0.25,
          max_bars: 3,
          require_rejection_confirmation: true,
        },
      }),
      positive: [
        marketRow("2026-06-11T09:00:00+02:00", { low: 101.2, close: 102 }),
        marketRow("2026-06-11T09:01:00+02:00", { low: 100.9, close: 101.4 }),
      ],
      negative: [
        marketRow("2026-06-11T09:00:00+02:00", { low: 101.2, close: 102 }),
        marketRow("2026-06-11T09:01:00+02:00", { low: 101.6, close: 102 }),
      ],
    },
    {
      name: "REJECTION_PATTERN",
      condition: nativeCondition({
        predicate_type: "REJECTION_PATTERN",
        operator: "REJECT_RESISTANCE",
        parameters: { threshold: 101, tolerance_points: 0.1 },
      }),
      positive: [marketRow("2026-06-11T09:01:00+02:00", { high: 101.5, close: 100.8 })],
      negative: [marketRow("2026-06-11T09:01:00+02:00", { high: 100.5, close: 100.4 })],
    },
    {
      name: "VWAP_RELATION",
      condition: nativeCondition({
        predicate_type: "VWAP_RELATION",
        parameters: { reference_code: "SESSION_VWAP" },
      }),
      positive: [marketRow("2026-06-11T09:01:00+02:00", {
        close: 102,
        session_vwap: 101,
      })],
      negative: [marketRow("2026-06-11T09:01:00+02:00", {
        close: 100,
        session_vwap: 101,
      })],
    },
    {
      name: "RSI_THRESHOLD",
      condition: nativeCondition({
        predicate_type: "RSI_THRESHOLD",
        parameters: { threshold: 55, indicator_period: 14 },
      }),
      positive: [marketRow("2026-06-11T09:01:00+02:00", { rsi_14: 60 })],
      negative: [marketRow("2026-06-11T09:01:00+02:00", { rsi_14: 45 })],
    },
    {
      name: "TIME_WINDOW",
      condition: nativeCondition({
        predicate_type: "TIME_WINDOW",
        operator: "WITHIN_WINDOW",
        parameters: {
          window_start_paris: "2026-06-11T09:00:00+02:00",
          window_end_paris: "2026-06-11T09:30:00+02:00",
        },
      }),
      positive: [marketRow("2026-06-11T09:15:00+02:00")],
      negative: [marketRow("2026-06-11T09:45:00+02:00")],
    },
    {
      name: "INTERMARKET_CONFIRMATION",
      condition: nativeCondition({
        predicate_type: "INTERMARKET_CONFIRMATION",
        operator: "ALIGNS_WITH",
        parameters: { reference_instrument: "MES" },
      }),
      positive: [marketRow("2026-06-11T09:01:00+02:00", {
        symbol: "CME_MINI:MES1!",
        aligned: true,
      })],
      negative: [marketRow("2026-06-11T09:01:00+02:00", {
        symbol: "CME_MINI:MES1!",
        aligned: false,
      })],
    },
    {
      name: "EVENT_BLACKOUT",
      nowParis: "2026-06-11T09:00:00+02:00",
      negativeNowParis: "2026-06-11T09:10:00+02:00",
      condition: nativeCondition({
        predicate_type: "EVENT_BLACKOUT",
        operator: "EVENT_ACTIVE",
        parameters: { event_window_ref: "cpi_window" },
      }),
      positive: [{
        event_window_id: "cpi_window",
        timestamp_paris: "2026-06-11T09:00:00+02:00",
        window_start_paris: "2026-06-11T08:55:00+02:00",
        window_end_paris: "2026-06-11T09:05:00+02:00",
      }],
      negative: [{
        event_window_id: "cpi_window",
        timestamp_paris: "2026-06-11T09:00:00+02:00",
        window_start_paris: "2026-06-11T08:55:00+02:00",
        window_end_paris: "2026-06-11T09:05:00+02:00",
      }],
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} has deterministic positive and negative paths`, () => {
      const positive = evaluateDeterministicPredicateV1({
        condition: testCase.condition,
        rows: testCase.positive,
        nowParis: testCase.nowParis,
      });
      const negative = evaluateDeterministicPredicateV1({
        condition: testCase.condition,
        rows: testCase.negative,
        nowParis: testCase.negativeNowParis || testCase.nowParis,
      });
      assert.equal(positive.state, PREDICATE_STATES_V1.SATISFIED);
      assert.equal(negative.state, PREDICATE_STATES_V1.PENDING);
    });
  }
});

describe("Native Monitor V2 command adapter", () => {
  it("compiles ARM, thesis, replan and management as independent requests", () => {
    const command = commandEnvelope({
      transformation: {
        command: "MAINTAIN",
        target_state: "ACTIVE",
        reason: "Thesis remains valid.",
        payload: { summary: "Valid.", health_score: 80 },
      },
      setup_transition: {
        command: "ARM",
        setup_id: "native_mnq_long",
        replaces_setup_id: null,
        reason: "Conditions are structured.",
        setup: nativeSetup(),
      },
      replan_request: {
        command: "REQUEST",
        reason: "Prepare next scenario.",
        requested_at_paris: "2026-06-11T09:05:00+02:00",
        dedupe_key: "replan_native",
      },
      management_request: {
        type: "MOVE_STOP_BE",
        position_id: "position_native",
        reduce_fraction: null,
        requested_stop: 101,
        reason: "Protect the position.",
        authority: "GPT_REQUEST_ONLY",
      },
    });
    const compiled = compileMonitorCommandV1(nativeMonitor(command), {
      currentState: {
        thesis: { state: "ACTIVE" },
        pinned_plan: pinnedPlan(),
        setup: { state: "PRE_ARMED", setup_id: "native_mnq_long", risk_pct: 0.25 },
        position: { state: "PROTECTED", position_id: "position_native" },
        replan: { state: "IDLE" },
      },
    });
    assert.equal(compiled.valid, true);
    assert.equal(compiled.plan_id, "plan_native");
    assert.equal(compiled.source_reference.contract_version, "2.4.0");
    assert.equal(compiled.source_reference.monitor_id, "monitor_native_0905");
    assert.equal(compiled.thesis_command.type, "MAINTAIN");
    assert.equal(compiled.setup_command.type, "ARM");
    assert.equal(compiled.setup_command.setup.compile_status, "COMPILED", JSON.stringify(compiled, null, 2));
    assert.equal(compiled.position_request.type, "MOVE_STOP_BE");
    assert.equal(compiled.position_request.requested_stop, 101);
    assert.equal(compiled.position_request.authority, "GPT_REQUEST_ONLY");
    assert.equal(compiled.replan_request.type, "REQUEST");
    assert.equal(compiled.transitions.setup.next_state, "ARMED_CONDITIONAL");
  });

  it("compiles CANCEL without inventing another machine command", () => {
    const compiled = compileMonitorCommandV1(nativeMonitor(commandEnvelope({
      setup_transition: {
        command: "CANCEL",
        setup_id: "native_mnq_long",
        replaces_setup_id: null,
        reason: "Setup invalidated.",
        setup: null,
      },
    })), {
      currentState: {
        thesis: { state: "ACTIVE" },
        setup: { state: "ARMED_CONDITIONAL", setup_id: "native_mnq_long", risk_pct: 0.25 },
        replan: { state: "IDLE" },
      },
    });
    assert.equal(compiled.valid, true, JSON.stringify(compiled, null, 2));
    assert.equal(compiled.setup_command.type, "CANCEL");
    assert.equal(compiled.thesis_command.type, "NOOP");
    assert.equal(compiled.position_request.type, "NONE");
    assert.equal(compiled.replan_request.type, "NOOP");
    assert.equal(compiled.transitions.setup.next_state, "CANCELLED");
  });

  it("compiles a transformation as SUPERSEDE + REPLACE + REQUEST", () => {
    const replacement = nativeSetup({
      setup_id: "native_mnq_long_v2",
      replaces_setup_id: "native_mnq_long",
    });
    const compiled = compileMonitorCommandV1(nativeMonitor(commandEnvelope({
      transformation: {
        command: "SUPERSEDE",
        target_state: "SUPERSEDED",
        reason: "Scenario transformed.",
        payload: { summary: "Replacement.", health_score: 60 },
      },
      setup_transition: {
        command: "REPLACE",
        setup_id: "native_mnq_long_v2",
        replaces_setup_id: "native_mnq_long",
        reason: "Atomic replacement.",
        setup: replacement,
      },
      replan_request: {
        command: "REQUEST",
        reason: "Replan replacement.",
        requested_at_paris: "2026-06-11T09:05:00+02:00",
        dedupe_key: "replace_native",
      },
    })), {
      currentState: {
        thesis: { state: "ACTIVE" },
        pinned_plan: pinnedPlan(),
        setup: { state: "ARMED_CONDITIONAL", setup_id: "native_mnq_long", risk_pct: 0.25 },
        replan: { state: "IDLE" },
      },
    });
    assert.equal(compiled.valid, true);
    assert.equal(compiled.thesis_command.type, "SUPERSEDE");
    assert.equal(compiled.setup_command.type, "REPLACE");
    assert.equal(compiled.setup_command.setup.setup_id, "native_mnq_long_v2");
    assert.equal(compiled.replan_request.type, "REQUEST");
    assert.equal(compiled.transitions.thesis.next_state, "SUPERSEDED");
    assert.equal(compiled.transitions.setup.next_state, "REPLACED");
  });

  it("keeps a native NO_ACTION entirely inert", () => {
    const command = commandEnvelope({
      requested_action: "NO_ACTION",
      setup_transition: null,
      transformation: null,
      replan_request: null,
      management_request: null,
    });
    const compiled = compileMonitorCommandV1(nativeMonitor(command), {
      currentState: {
        thesis: { state: "ACTIVE" },
        setup: { state: "ARMED_CONDITIONAL", setup_id: "native_mnq_long", risk_pct: 0.25 },
        replan: { state: "IDLE" },
      },
    });
    assert.equal(compiled.valid, true);
    assert.equal(compiled.thesis_command.type, "NOOP");
    assert.equal(compiled.setup_command.type, "NOOP");
    assert.equal(compiled.position_request.type, "NONE");
    assert.equal(compiled.replan_request.type, "NOOP");
    assert.equal(compiled.transitions.setup.next_state, "ARMED_CONDITIONAL");
  });

  for (const riskPct of [0.25, 0.1]) {
    for (const setupCommand of ["UPSERT_CANDIDATE", "PRE_ARM", "ARM"]) {
      it("inherits " + riskPct + "% pinned Master risk for WAIT_NO_SETUP -> " + setupCommand, () => {
        const requestedState = {
          UPSERT_CANDIDATE: "SETUP_CANDIDATE",
          PRE_ARM: "PRE_ARMED",
          ARM: "ARMED_CONDITIONAL",
        }[setupCommand];
        const monitor = nativeMonitor(commandEnvelope({
          setup_transition: {
            command: setupCommand,
            setup_id: "monitor_discovered_setup",
            replaces_setup_id: null,
            reason: "Opportunity discovered after a valid WAIT_NO_SETUP Master.",
            setup: nativeSetup({
              setup_id: "monitor_discovered_setup",
              requested_state: requestedState,
            }),
          },
        }));
        const compiled = compileMonitorCommandV1(monitor, {
          currentState: {
            thesis: {
              state: "WAIT_MONITORED",
              thesis_id: "thesis_native",
              plan_id: "plan_native",
            },
            pinned_plan: pinnedPlan({ riskPct }),
            setup: null,
            position: { state: "NONE" },
            replan: { state: "IDLE" },
          },
        });
        assert.equal(compiled.valid, true, JSON.stringify(compiled.diagnostics, null, 2));
        assert.equal(compiled.setup_command.setup.risk_pct, riskPct);
        assert.equal(compiled.setup_command.setup.compile_status, "COMPILED");
      });
    }
  }

  it("fails closed when a Monitor creates a setup without pinned Master risk", () => {
    const monitor = nativeMonitor(commandEnvelope({
      setup_transition: {
        command: "UPSERT_CANDIDATE",
        setup_id: "monitor_missing_risk",
        replaces_setup_id: null,
        reason: "Missing pinned plan must block.",
        setup: nativeSetup({
          setup_id: "monitor_missing_risk",
          requested_state: "SETUP_CANDIDATE",
        }),
      },
    }));
    const compiled = compileMonitorCommandV1(monitor, {
      currentState: {
        thesis: { state: "WAIT_MONITORED", plan_id: "plan_native" },
        setup: null,
        replan: { state: "IDLE" },
      },
    });
    assert.equal(compiled.valid, false);
    assert.ok(compiled.diagnostics.errors.some((entry) => (
      entry.code === "PINNED_PLAN_RISK_MISSING"
    )));
    assert.equal(compiled.setup_command.setup.risk_pct, null);
  });

  it("fails closed on malformed risk or a mismatched pinned plan identity/scope", () => {
    const monitor = nativeMonitor(commandEnvelope({
      setup_transition: {
        command: "PRE_ARM",
        setup_id: "strict_pinned_setup",
        replaces_setup_id: null,
        reason: "Pinned plan validation is strict.",
        setup: nativeSetup({
          setup_id: "strict_pinned_setup",
          requested_state: "PRE_ARMED",
        }),
      },
    }));
    const validPinned = pinnedPlan();
    const cases = [
      {
        pinned: {
          ...validPinned,
          risk: { ...validPinned.risk, risk_pct_requested: "0.1" },
        },
        code: "PINNED_PLAN_RISK_INVALID",
      },
      {
        pinned: { ...validPinned, plan_id: "other_plan" },
        code: "PINNED_PLAN_ID_MISMATCH",
      },
      {
        pinned: {
          ...validPinned,
          scope: { ...validPinned.scope, session: "other_session" },
        },
        code: "PINNED_PLAN_SCOPE_MISMATCH",
      },
    ];
    for (const testCase of cases) {
      const compiled = compileMonitorCommandV1(monitor, {
        currentState: {
          thesis: { state: "WAIT_MONITORED", plan_id: "plan_native" },
          pinned_plan: testCase.pinned,
          setup: null,
          replan: { state: "IDLE" },
        },
      });
      assert.equal(compiled.valid, false);
      assert.ok(compiled.diagnostics.errors.some((entry) => (
        entry.code === testCase.code
      )), testCase.code);
    }
  });

  it("rejects a Monitor risk escalation and applies only the lower pinned plan risk", () => {
    const monitor = nativeMonitor(commandEnvelope({
      setup_transition: {
        command: "ARM",
        setup_id: "native_mnq_long",
        replaces_setup_id: null,
        reason: "Monitor is not risk authority.",
        setup: nativeSetup({ risk_pct: 0.25 }),
      },
    }));
    const compiled = compileMonitorCommandV1(monitor, {
      currentState: {
        thesis: { state: "ACTIVE", plan_id: "plan_native" },
        pinned_plan: pinnedPlan({ riskPct: 0.1 }),
        setup: { state: "PRE_ARMED", setup_id: "native_mnq_long", risk_pct: 0.25 },
        replan: { state: "IDLE" },
      },
    });
    assert.equal(compiled.valid, false);
    assert.equal(compiled.setup_command.setup.risk_pct, 0.1);
    assert.ok(compiled.diagnostics.errors.some((entry) => (
      entry.code === "MONITOR_RISK_OVERRIDE_FORBIDDEN"
    )));
  });

  it("keeps the Monitor decision hash identical across LIVE and REPLAY with pinned plan risk", () => {
    const command = commandEnvelope({
      setup_transition: {
        command: "UPSERT_CANDIDATE",
        setup_id: "parity_setup",
        replaces_setup_id: null,
        reason: "Transport-independent Monitor decision.",
        setup: nativeSetup({
          setup_id: "parity_setup",
          requested_state: "SETUP_CANDIDATE",
        }),
      },
    });
    const liveRaw = nativeMonitor(command);
    const replayRaw = nativeMonitor({
      ...command,
      scope: { ...command.scope, mode: "REPLAY" },
    }, {
      scope: { ...liveRaw.scope, mode: "REPLAY" },
    });
    const commonState = {
      thesis: { state: "WAIT_MONITORED", thesis_id: "thesis_native", plan_id: "plan_native" },
      setup: null,
      replan: { state: "IDLE" },
    };
    const live = compileMonitorCommandV1(liveRaw, {
      currentState: { ...commonState, pinned_plan: pinnedPlan() },
    });
    const replay = compileMonitorCommandV1(replayRaw, {
      currentState: {
        ...commonState,
        pinned_plan: pinnedPlan({ mode: "REPLAY" }),
      },
    });
    assert.equal(live.valid, true, JSON.stringify(live.diagnostics, null, 2));
    assert.equal(replay.valid, true, JSON.stringify(replay.diagnostics, null, 2));
    assert.equal(live.canonical_hash, replay.canonical_hash);
  });
});


describe("Canonical gates, opportunity isolation and target round-trip", () => {
  it("persists future hard gates and blocks them only at their enforcement phase", () => {
    const raw = nativeMaster();
    raw.execution_plan.gates = gates({ failedHard: "MAJOR_EVENT_ENTRY_BLOCK", unknownSoft: null });
    const plan = compileMasterPlanV1(raw);
    assert.equal(plan.valid, true, JSON.stringify(plan.diagnostics, null, 2));
    const gate = plan.gates.find((item) => item.code === "MAJOR_EVENT_ENTRY_BLOCK");
    assert.deepEqual(gate, {
      code: "MAJOR_EVENT_ENTRY_BLOCK",
      state: "FAIL",
      classification: "HARD",
      enforcement_phase: "ENTRY_TRIGGER",
      effect: "BLOCK_ON_FAIL_OR_UNKNOWN_AT_PHASE",
      source: "MASTER_EXECUTION_PLAN",
      reason: "test failure",
      evidence_refs: [],
      pass_semantics: "FAILURE_ABSENT",
    });
    const setup = plan.ranked_setups[0];
    assert.deepEqual(setup.gates, plan.gates);
    assert.equal(setup.gate_evaluation.eligible, true);
    assert.ok(setup.gate_evaluation.deferred_hard_gates.some((item) => (
      item.code === "MAJOR_EVENT_ENTRY_BLOCK"
    )));
    const entry = evaluateOpportunitySeekingControlledV1({
      setup,
      conditionEvaluation: {},
      gates: setup.gates,
      phase: "ENTRY_TRIGGER",
    });
    assert.equal(entry.eligible, false);
    assert.ok(entry.hard_failures.some((item) => item.code === "MAJOR_EVENT_ENTRY_BLOCK"));
  });

  it("blocks SETUP_ARM without deleting the candidate and rejects PLAN_COMPILE atomically", () => {
    const armRaw = nativeMaster();
    armRaw.execution_plan.gates = gates({ failedHard: "GEOMETRY_INVALID", unknownSoft: null });
    const armPlan = compileMasterPlanV1(armRaw);
    assert.equal(armPlan.valid, true, JSON.stringify(armPlan.diagnostics, null, 2));
    assert.equal(armPlan.ranked_setups[0].compile_status, "COMPILED");
    assert.equal(armPlan.ranked_setups[0].status, "PRE_ARMED");
    assert.equal(armPlan.ranked_setups[0].arm_gate_evaluation.eligible, false);

    const planRaw = nativeMaster();
    planRaw.execution_plan.gates = gates({ failedHard: "ANTI_LOOKAHEAD_FAILED", unknownSoft: null });
    const blockedPlan = compileMasterPlanV1(planRaw);
    assert.equal(blockedPlan.valid, false);
    assert.ok(blockedPlan.diagnostics.errors.some((item) => item.code === "PLAN_HARD_GATE_BLOCKED"));
  });

  it("keeps a valid primary when a secondary setup is locally non-compilable", () => {
    const raw = nativeMaster();
    const secondary = nativeSetup({
      setup_id: "native_secondary_rejected",
      rank: 2,
      conditions: [nativeCondition({
        condition_id: "secondary_context_only",
        role: "CONFIRMATION",
        importance: "SECONDARY",
        required_for_trigger: false,
        weight: 1,
      })],
    });
    raw.execution_plan.setups.push(secondary);
    const plan = compileMasterPlanV1(raw);
    assert.equal(plan.valid, true, JSON.stringify(plan.diagnostics, null, 2));
    assert.equal(plan.ranked_setups[0].setup_id, "native_mnq_long");
    assert.equal(plan.ranked_setups[0].compile_status, "COMPILED");
    assert.equal(plan.ranked_setups[1].compile_status, "REJECTED");
    assert.ok(plan.ranked_setups[1].compilation_diagnostics.errors.some((item) => (
      item.code === "STRUCTURED_ACTIVATION_CONDITION_MISSING"
    )));
    assert.ok(plan.diagnostics.warnings.some((item) => (
      item.code === "SECONDARY_SETUP_REJECTED"
        && item.evidence.setup_id === "native_secondary_rejected"
    )));
  });

  it("preserves every ordered target and management field while retaining TP1 compatibility", () => {
    const raw = nativeMaster();
    raw.execution_plan.setups[0].targets = [
      { target_id: "tp1", price: 104, action: "PARTIAL_CLOSE", close_fraction: 0.25 },
      { target_id: "be", price: 105, action: "MOVE_STOP_BE", close_fraction: 0 },
      { target_id: "runner", price: 108, action: "RUNNER", close_fraction: 0.75 },
    ];
    raw.execution_plan.setups[0].management = {
      break_even_at_r: 0.7,
      tp1_close_fraction: 0.25,
    };
    const plan = compileMasterPlanV1(raw);
    assert.equal(plan.valid, true, JSON.stringify(plan.diagnostics, null, 2));
    const setup = plan.ranked_setups[0];
    assert.equal(setup.take_profit_1, 104);
    assert.deepEqual(setup.targets, raw.execution_plan.setups[0].targets);
    assert.deepEqual(setup.management_policy, {
      break_even_at_r: 0.7,
      tp1_close_fraction: 0.25,
    });
  });

  it("compiles Monitor data-quality gates and preserves an UNKNOWN entry veto on NO_ACTION", () => {
    const command = commandEnvelope({
      requested_action: "NO_ACTION",
      setup_transition: null,
      transformation: null,
      replan_request: null,
      management_request: null,
    });
    const monitor = nativeMonitor(command, {
      data_quality: {
        status: "DEGRADED",
        hard_gate_states: gates({ failedHard: null, unknownSoft: null }).hard.map((gate) => (
          gate.code === "MAJOR_EVENT_ENTRY_BLOCK"
            ? { ...gate, state: "UNKNOWN", reason: "calendar state pending" }
            : gate
        )),
        soft_gate_states: [],
        notes: ["calendar pending"],
      },
    });
    const compiled = compileMonitorCommandV1(monitor, {
      currentState: {
        thesis: { state: "ACTIVE" },
        setup: nativeSetup(),
        replan: { state: "IDLE" },
      },
    });
    assert.equal(compiled.valid, true, JSON.stringify(compiled.diagnostics, null, 2));
    assert.equal(compiled.transitions.setup.command, "NOOP");
    const gate = compiled.gates.find((item) => item.code === "MAJOR_EVENT_ENTRY_BLOCK");
    assert.equal(gate.state, "UNKNOWN");
    assert.equal(gate.source, "MONITOR_DATA_QUALITY");
    const entry = evaluateOpportunitySeekingControlledV1({
      setup: nativeSetup(),
      conditionEvaluation: {},
      gates: compiled.gates,
      phase: "ENTRY_TRIGGER",
    });
    assert.equal(entry.eligible, false);
  });
});
