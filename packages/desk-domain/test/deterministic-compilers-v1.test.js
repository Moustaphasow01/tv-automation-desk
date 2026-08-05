import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DETERMINISTIC_PREDICATE_CAPABILITIES_V1,
  DETERMINISTIC_COMPILER_VERSION_V1,
  HARD_GATE_ENFORCEMENT_PHASES_V5,
  HARD_GATE_CODES_V5,
  MASTER_PLAN_SCHEMA_VERSION_V1,
  MONITOR_COMMAND_SCHEMA_VERSION_V1,
  OPPORTUNITY_SEEKING_CONTROLLED,
  OPPORTUNITY_POLICY_EVALUATION_SCHEMA_VERSION_V1,
  OPPORTUNITY_POLICY_VERSION_V1,
  POSITION_EVENTS_V1,
  PREDICATE_STATES_V1,
  PREDICATE_TYPES_V1,
  SOFT_GATE_CODES_V5,
  compileMasterPlanV1,
  compileMonitorCommandV1,
  evaluateDeterministicConditionSetV1,
  evaluateDeterministicPredicateV1,
  evaluateOpportunitySeekingControlledV1,
  transitionPositionStateV1,
  transitionSetupStateV1,
} from "../index.js";

function canonicalSetup(overrides = {}) {
  return {
    setup_id: "mnq_break_retest_short",
    status: "executable",
    instrument: "MNQ",
    direction: "short",
    entry_mode: "RETEST_ZONE_AFTER_CONFIRMATION",
    order_type: "LIMIT",
    entry_zone: { from: 100, to: 101 },
    stop_loss: 103,
    take_profits: [{ name: "TP1", target: 94 }],
    rr_minimum: 2,
    risk_pct: 0.25,
    valid_from_paris: "2026-06-11T09:00:00+02:00",
    expires_at_paris: "2026-06-11T12:00:00+02:00",
    conditions: [
      {
        condition_id: "mnq_break",
        predicate_type: "BREAKOUT_CLOSE",
        role: "ACTIVATION",
        effect: "REQUIRE_TRUE",
        instrument: "MNQ",
        timeframe: "M1",
        operator: "CLOSE_BELOW",
        threshold: 100,
        importance: "MANDATORY",
        required_for_trigger: true,
        memory_policy: "LATCH_UNTIL_TRIGGER",
      },
      {
        condition_id: "mes_confirm",
        predicate_type: "PRICE_RELATION",
        role: "CONFIRMATION",
        effect: "REQUIRE_TRUE",
        instrument: "MES",
        timeframe: "M1",
        operator: "CLOSE_BELOW",
        threshold: 6000,
        importance: "PRIMARY",
        required_for_trigger: false,
        memory_policy: "LATEST_ONLY",
      },
    ],
    management_policy: { break_even_at_r: 0.7, tp1_close_fraction: 0.5 },
    ...overrides,
  };
}

function canonicalMaster(overrides = {}) {
  return {
    contract_name: "DeskMasterAnalysisContract",
    schema_version: "5.4.0",
    analysis_id: "master_2026_06_11_0900",
    timestamp_paris: "2026-06-11T09:00:00+02:00",
    trading_date: "2026-06-11",
    session: "full_day",
    plan_id: "plan_2026_06_11",
    gates: canonicalGates(),
    active_thesis: {
      thesis_id: "thesis_2026_06_11",
      plan_id: "plan_2026_06_11",
      status: "THESIS_CONDITIONAL",
      instrument: "MNQ",
      direction: "short",
      valid_from: "2026-06-11T09:00:00+02:00",
      valid_until: "2026-06-11T12:00:00+02:00",
    },
    setups: [canonicalSetup()],
    ...overrides,
  };
}

function canonicalGates() {
  return HARD_GATE_CODES_V5.map((code) => ({
    code,
    state: "PASS",
    classification: "HARD",
    enforcement_phase: HARD_GATE_ENFORCEMENT_PHASES_V5[code],
    pass_semantics: "FAILURE_ABSENT",
  }));
}

function canonicalMonitorDataQuality() {
  return {
    hard_gate_states: canonicalGates(),
    soft_gate_states: [],
  };
}

function masterOptions(sourceMode) {
  return {
    sourceMode,
    scope: {
      mode: sourceMode,
      strategy_id: "full_day_v5",
      session: "full_day",
      trading_date: "2026-06-11",
      timezone: "Europe/Paris",
      cutoff_paris: "2026-06-11T09:00:00+02:00",
      pack_id: "pack_2026_06_11",
      pack_build_id: "packbuild_2026_06_11",
    },
  };
}

function closedRow(timestamp, values = {}) {
  return {
    timestamp_paris: timestamp,
    instrument: "MNQ",
    timeframe: "M1",
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    closed: true,
    ...values,
  };
}

describe("OPPORTUNITY_SEEKING_CONTROLLED", () => {
  it("pins the V1.1 compiler and canonical artifact versions", () => {
    assert.equal(DETERMINISTIC_COMPILER_VERSION_V1, "1.4.0");
    assert.equal(MASTER_PLAN_SCHEMA_VERSION_V1, "deterministic_execution_plan_v1_4");
    assert.equal(MONITOR_COMMAND_SCHEMA_VERSION_V1, "desk_monitor_command_v1_4");
  });

  it("freezes the strategy threshold while retaining broker risk and RR hard gates", () => {
    assert.equal(OPPORTUNITY_SEEKING_CONTROLLED.weighted_confirmation_threshold, 0.55);
    assert.equal(OPPORTUNITY_POLICY_VERSION_V1, "1.2.0");
    assert.equal(OPPORTUNITY_POLICY_EVALUATION_SCHEMA_VERSION_V1, "opportunity_policy_evaluation_v1_2");
    assert.equal(OPPORTUNITY_SEEKING_CONTROLLED.policy_version, "1.2.0");
    assert.equal(OPPORTUNITY_SEEKING_CONTROLLED.max_risk_pct, 0.25);
    assert.equal(OPPORTUNITY_SEEKING_CONTROLLED.min_rr, 2);
    assert.equal(OPPORTUNITY_SEEKING_CONTROLLED.gpt_may_trigger, false);
  });

  it("keeps explicit hard risk gates blocking and contextual gaps soft", () => {
    const result = evaluateOpportunitySeekingControlledV1({
      setup: canonicalSetup(),
      conditionEvaluation: {
        required_failed: 0,
        required_unknown: 0,
        required_pending: 0,
        hard_blockers_active: 0,
        scored_confirmation_count: 1,
        weighted_confirmation_score: 0.8,
        soft_unknown_condition_ids: ["dxy_context"],
      },
      gates: [
        { code: "DXY_DATA_MISSING", failed: true, contextual: true },
        { code: "ANTI_LOOKAHEAD_FAILED", failed: true },
      ],
    });

    assert.equal(result.eligible, false);
    assert.ok(result.hard_failures.some((entry) => entry.code === "ANTI_LOOKAHEAD_FAILED"));
    assert.ok(result.soft_gaps.some((entry) => entry.code === "CONTEXTUAL_DATA_GAP"));
    assert.ok(result.soft_gaps.some((entry) => entry.code === "CONTEXTUAL_DATA_GAP"));
  });

  it("does not let an unknown contextual confirmation dilute a known passing primary signal", () => {
    const result = evaluateOpportunitySeekingControlledV1({
      setup: canonicalSetup(),
      conditionEvaluation: {
        required_failed: 0,
        required_unknown: 0,
        required_pending: 0,
        required_not_started: 0,
        hard_blockers_active: 0,
        hard_blockers_unknown: 0,
        scored_confirmation_count: 1,
        configured_confirmation_count: 2,
        weighted_confirmation_score: 0.5,
        weighted_known_confirmation_score: 1,
        primary_confirmation_total: 1,
        primary_confirmation_known: 1,
        soft_unknown_condition_ids: ["gc_context"],
        sequence_valid: true,
      },
      phase: "ENTRY_TRIGGER",
      nowParis: "2026-06-11T09:30:00+02:00",
    });

    assert.equal(result.eligible, true);
    assert.equal(result.trigger_eligible, true);
    assert.equal(result.weighted_known_confirmation_score, 1);
    assert.ok(result.soft_gaps.some((entry) => entry.code === "CONTEXTUAL_DATA_GAP"));
  });

  it("rejects a zero-risk executable setup at BROKER_SUBMIT", () => {
    const result = evaluateOpportunitySeekingControlledV1({
      setup: canonicalSetup({ risk_pct: 0 }),
      conditionEvaluation: {},
      phase: "BROKER_SUBMIT",
    });
    assert.equal(result.eligible, false);
    assert.equal(result.geometry.valid, false);
    assert.ok(result.hard_failures.some((entry) => entry.code === "BROKER_SAFETY_FAILED"));
  });

  it("validates a zone at the same conservative boundary used for execution", () => {
    const short = evaluateOpportunitySeekingControlledV1({
      setup: canonicalSetup({
        entry_zone: { from: 100, to: 101 },
        stop_loss: 103,
        take_profits: [{ target: 95 }],
      }),
      conditionEvaluation: {},
      phase: "SETUP_ARM",
    });
    const long = evaluateOpportunitySeekingControlledV1({
      setup: canonicalSetup({
        direction: "long",
        entry_zone: { from: 100, to: 101 },
        stop_loss: 98,
        take_profits: [{ target: 106 }],
      }),
      conditionEvaluation: {},
      phase: "SETUP_ARM",
    });

    assert.equal(short.geometry.entry_price, 100);
    assert.equal(short.geometry.computed_rr, 1.6667);
    assert.equal(short.eligible, false);
    assert.equal(long.geometry.entry_price, 101);
    assert.equal(long.geometry.computed_rr, 1.6667);
    assert.equal(long.eligible, false);
  });

  it("enforces RR at SETUP_ARM and the 0.25 risk cap at BROKER_SUBMIT", () => {
    const setup = canonicalSetup({
      risk_pct: 0.26,
      entry_zone: { from: 100, to: 100 },
      stop_loss: 102,
      take_profits: [{ target: 98 }],
    });
    const arm = evaluateOpportunitySeekingControlledV1({
      setup,
      conditionEvaluation: {},
      phase: "SETUP_ARM",
    });
    const broker = evaluateOpportunitySeekingControlledV1({
      setup,
      conditionEvaluation: {},
      phase: "BROKER_SUBMIT",
    });
    assert.equal(arm.eligible, false);
    assert.ok(arm.hard_failures.some((entry) => entry.code === "RR_BELOW_MINIMUM"));
    assert.ok(arm.deferred_hard_gates.some((entry) => entry.code === "BROKER_SAFETY_FAILED"));
    assert.equal(broker.eligible, false);
    assert.ok(broker.hard_failures.some((entry) => entry.code === "BROKER_SAFETY_FAILED"));
    assert.ok(broker.hard_failures.some((entry) => entry.code === "RR_BELOW_MINIMUM"));
  });
});

describe("Separate state machines", () => {
  it("forbids GPT from producing TRIGGERED", () => {
    const rejected = transitionSetupStateV1({
      currentState: "ARMED_CONDITIONAL",
      command: "ENGINE_TRIGGER",
      authority: "GPT",
    });
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.reason, "ENGINE_AUTHORITY_REQUIRED");

    const accepted = transitionSetupStateV1({
      currentState: "ARMED_CONDITIONAL",
      command: "ENGINE_TRIGGER",
      authority: "ENGINE",
    });
    assert.equal(accepted.accepted, true);
    assert.equal(accepted.next_state, "TRIGGERED");
  });

  it("requires engine authority for broker fill state", () => {
    const rejected = transitionPositionStateV1({
      currentState: "PENDING_SUBMISSION",
      event: POSITION_EVENTS_V1.FILL_CONFIRMED,
      authority: "GPT",
    });
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.reason, "ENGINE_AUTHORITY_REQUIRED");
  });
});

describe("Deterministic predicate registry", () => {
  it("canonicalizes incompatible blocker memory policies at the runtime boundary", () => {
    const base = {
      condition_id: "memory_guard",
      predicate_type: "PRICE_RELATION",
      effect: "BLOCK_IF_TRUE",
      instrument: "MNQ",
      timeframe: "M1",
      operator: "CLOSE_ABOVE",
      threshold: 200,
      importance: "HARD_BLOCKER",
      required_for_trigger: false,
    };
    const veto = evaluateDeterministicPredicateV1({
      condition: { ...base, role: "VETO", memory_policy: "INVALIDATE_TERMINAL" },
      rows: [closedRow("2026-06-11T09:00:00+02:00")],
    });
    const invalidation = evaluateDeterministicPredicateV1({
      condition: { ...base, role: "INVALIDATION", memory_policy: "LATCH_UNTIL_TRIGGER" },
      rows: [closedRow("2026-06-11T09:00:00+02:00")],
    });
    assert.equal(veto.memory_policy, "LATEST_ONLY");
    assert.equal(invalidation.memory_policy, "INVALIDATE_TERMINAL");
  });

  it("exposes all eleven frozen predicate families and their capabilities", () => {
    assert.deepEqual(PREDICATE_TYPES_V1, [
      "PRICE_RELATION",
      "PRICE_CROSS",
      "ZONE_TOUCH",
      "BREAKOUT_CLOSE",
      "BREAK_RETEST_SEQUENCE",
      "REJECTION_PATTERN",
      "VWAP_RELATION",
      "RSI_THRESHOLD",
      "TIME_WINDOW",
      "INTERMARKET_CONFIRMATION",
      "EVENT_BLACKOUT",
    ]);
    assert.equal(DETERMINISTIC_PREDICATE_CAPABILITIES_V1.BREAK_RETEST_SEQUENCE.stateful, true);
    assert.ok(
      DETERMINISTIC_PREDICATE_CAPABILITIES_V1.BREAK_RETEST_SEQUENCE.required_inputs
        .includes("break_condition_id"),
    );
  });

  it("ignores a retest before the break and satisfies only after a closed rejection", () => {
    const condition = {
      condition_id: "break_retest",
      predicate_type: "BREAK_RETEST_SEQUENCE",
      break_condition_id: "breakout_close",
      instrument: "MNQ",
      timeframe: "M1",
      direction: "long",
      operator: "CLOSE_ABOVE",
      threshold: 101,
      tolerance_points: 0,
      max_bars: 3,
      role: "ACTIVATION",
      importance: "MANDATORY",
      required_for_trigger: true,
      memory_policy: "LATCH_UNTIL_TRIGGER",
    };
    const result = evaluateDeterministicPredicateV1({
      condition,
      rows: [
        closedRow("2026-06-11T09:00:00+02:00", { low: 100.8, high: 101.2, close: 101 }),
        closedRow("2026-06-11T09:01:00+02:00", { low: 101.2, high: 102.5, close: 102 }),
        closedRow("2026-06-11T09:02:00+02:00", { low: 100.9, high: 102, close: 101.5 }),
      ],
    });

    assert.equal(result.state, PREDICATE_STATES_V1.SATISFIED);
    assert.equal(result.machine_state, "SATISFIED");
    assert.equal(result.break_at_paris, "2026-06-11T09:01:00+02:00");
    assert.equal(result.retest_at_paris, "2026-06-11T09:02:00+02:00");
    assert.equal(result.observed_at_paris, "2026-06-11T09:02:00+02:00");
    assert.equal(result.evidence.rejection_confirmed_on_closed_bar, true);
  });

  it("persists break state across calls and fails after max_bars", () => {
    const condition = {
      condition_id: "break_retest",
      predicate_type: "BREAK_RETEST_SEQUENCE",
      break_condition_id: "breakout_close",
      instrument: "MNQ",
      timeframe: "M1",
      direction: "long",
      operator: "CLOSE_ABOVE",
      threshold: 101,
      max_bars: 1,
      role: "ACTIVATION",
      importance: "MANDATORY",
      required_for_trigger: true,
    };
    const first = evaluateDeterministicPredicateV1({
      condition,
      rows: [closedRow("2026-06-11T09:01:00+02:00", { low: 101.2, high: 102.5, close: 102 })],
    });
    assert.equal(first.state, PREDICATE_STATES_V1.PENDING);
    assert.equal(first.machine_state, "WAITING_RETEST");

    const second = evaluateDeterministicPredicateV1({
      condition,
      previousState: first,
      rows: [
        closedRow("2026-06-11T09:02:00+02:00", { low: 101.4, high: 102.2, close: 102 }),
        closedRow("2026-06-11T09:03:00+02:00", { low: 101.3, high: 102.4, close: 102.1 }),
      ],
    });
    assert.equal(second.state, PREDICATE_STATES_V1.FAILED);
    assert.equal(second.machine_state, "FAILED_MAX_BARS");
  });

  it("processes cumulative break-retest rows causally and ignores a pre-break retest", () => {
    const condition = {
      condition_id: "causal_break_retest",
      predicate_type: "BREAK_RETEST_SEQUENCE",
      break_condition_id: "causal_break",
      instrument: "MNQ",
      timeframe: "M1",
      direction: "long",
      operator: "CLOSE_ABOVE",
      threshold: 101,
      tolerance_points: 0,
      max_bars: 4,
      role: "ACTIVATION",
      importance: "MANDATORY",
      required_for_trigger: true,
      memory_policy: "LATCH_UNTIL_TRIGGER",
    };
    const oldRetest = closedRow("2026-06-11T09:00:00+02:00", { low: 100.8, high: 101.2, close: 101 });
    const breakRow = closedRow("2026-06-11T09:01:00+02:00", { low: 101.2, high: 102.5, close: 102 });
    const postBreakNoTouch = closedRow("2026-06-11T09:02:00+02:00", { low: 101.3, high: 102.4, close: 102.1 });
    const causalRetest = closedRow("2026-06-11T09:03:00+02:00", { low: 100.9, high: 102, close: 101.5 });

    const afterBreak = evaluateDeterministicPredicateV1({
      condition,
      rows: [oldRetest, breakRow],
    });
    const afterOneNewBar = evaluateDeterministicPredicateV1({
      condition,
      previousState: afterBreak,
      rows: [oldRetest, breakRow, postBreakNoTouch],
    });
    const repeatedCumulativeRows = evaluateDeterministicPredicateV1({
      condition,
      previousState: afterOneNewBar,
      rows: [oldRetest, breakRow, postBreakNoTouch],
    });
    const satisfied = evaluateDeterministicPredicateV1({
      condition,
      previousState: repeatedCumulativeRows,
      rows: [oldRetest, breakRow, postBreakNoTouch, causalRetest],
    });

    assert.equal(afterBreak.break_at_paris, "2026-06-11T09:01:00+02:00");
    assert.equal(afterBreak.retest_at_paris, null);
    assert.equal(afterOneNewBar.bars_since_break, 1);
    assert.equal(repeatedCumulativeRows.bars_since_break, 1);
    assert.equal(repeatedCumulativeRows.state, PREDICATE_STATES_V1.PENDING);
    assert.equal(satisfied.state, PREDICATE_STATES_V1.SATISFIED);
    assert.equal(satisfied.retest_at_paris, "2026-06-11T09:03:00+02:00");
    assert.ok(Date.parse(satisfied.retest_at_paris) > Date.parse(satisfied.break_at_paris));
    assert.equal(satisfied.bars_since_break, 2);
  });

  it("does not advance the causal cursor past an open partial candle", () => {
    const condition = {
      condition_id: "closed_only_break_retest",
      predicate_type: "BREAK_RETEST_SEQUENCE",
      break_condition_id: "closed_only_break",
      instrument: "MNQ",
      timeframe: "M1",
      direction: "long",
      operator: "CLOSE_ABOVE",
      threshold: 101,
      max_bars: 2,
      role: "ACTIVATION",
      importance: "MANDATORY",
      required_for_trigger: true,
    };
    const breakRow = closedRow("2026-06-11T09:01:00+02:00", { low: 101.2, high: 102.5, close: 102 });
    const partialRetest = closedRow("2026-06-11T09:02:00+02:00", {
      low: 100.9,
      high: 102,
      close: 101.5,
      closed: false,
    });
    const settledRetest = { ...partialRetest, closed: true };

    const afterBreak = evaluateDeterministicPredicateV1({ condition, rows: [breakRow] });
    const afterPartial = evaluateDeterministicPredicateV1({
      condition,
      previousState: afterBreak,
      rows: [breakRow, partialRetest],
    });
    const afterSettlement = evaluateDeterministicPredicateV1({
      condition,
      previousState: afterPartial,
      rows: [breakRow, partialRetest, settledRetest],
    });

    assert.equal(afterPartial.state, PREDICATE_STATES_V1.PENDING);
    assert.equal(afterPartial.bars_since_break, 0);
    assert.equal(afterPartial.last_evaluated_at_paris, "2026-06-11T09:01:00+02:00");
    assert.equal(afterSettlement.state, PREDICATE_STATES_V1.SATISFIED);
    assert.equal(afterSettlement.retest_at_paris, "2026-06-11T09:02:00+02:00");
    assert.equal(afterSettlement.bars_since_break, 1);
  });

  it("counts max_bars once per new cumulative candle and keeps terminal failure idempotent", () => {
    const condition = {
      condition_id: "bounded_break_retest",
      predicate_type: "BREAK_RETEST_SEQUENCE",
      break_condition_id: "bounded_break",
      instrument: "MNQ",
      timeframe: "M1",
      direction: "long",
      operator: "CLOSE_ABOVE",
      threshold: 101,
      max_bars: 1,
      role: "ACTIVATION",
      importance: "MANDATORY",
      required_for_trigger: true,
    };
    const breakRow = closedRow("2026-06-11T09:01:00+02:00", { low: 101.2, high: 102.5, close: 102 });
    const firstNoTouch = closedRow("2026-06-11T09:02:00+02:00", { low: 101.3, high: 102.2, close: 102 });
    const secondNoTouch = closedRow("2026-06-11T09:03:00+02:00", { low: 101.4, high: 102.4, close: 102.1 });

    const afterBreak = evaluateDeterministicPredicateV1({ condition, rows: [breakRow] });
    const first = evaluateDeterministicPredicateV1({
      condition,
      previousState: afterBreak,
      rows: [breakRow, firstNoTouch],
    });
    const repeated = evaluateDeterministicPredicateV1({
      condition,
      previousState: first,
      rows: [breakRow, firstNoTouch],
    });
    const failed = evaluateDeterministicPredicateV1({
      condition,
      previousState: repeated,
      rows: [breakRow, firstNoTouch, secondNoTouch],
    });
    const failedRepeated = evaluateDeterministicPredicateV1({
      condition,
      previousState: failed,
      rows: [breakRow, firstNoTouch, secondNoTouch],
    });

    assert.equal(first.bars_since_break, 1);
    assert.equal(repeated.bars_since_break, 1);
    assert.equal(repeated.state, PREDICATE_STATES_V1.PENDING);
    assert.equal(failed.state, PREDICATE_STATES_V1.FAILED);
    assert.equal(failed.bars_since_break, 2);
    assert.equal(failedRepeated.state, PREDICATE_STATES_V1.FAILED);
    assert.equal(failedRepeated.bars_since_break, 2);
  });

  it("latches a prior structural confirmation across later intervals", () => {
    const condition = {
      condition_id: "break",
      predicate_type: "BREAKOUT_CLOSE",
      instrument: "MNQ",
      timeframe: "M1",
      operator: "CLOSE_ABOVE",
      threshold: 101,
      role: "ACTIVATION",
      importance: "MANDATORY",
      required_for_trigger: true,
      memory_policy: "LATCH_UNTIL_TRIGGER",
      temporal_rule: { mode: "ANY_SINCE_ARM" },
    };
    const first = evaluateDeterministicPredicateV1({
      condition,
      rows: [closedRow("2026-06-11T09:01:00+02:00", { close: 102 })],
    });
    const second = evaluateDeterministicPredicateV1({
      condition,
      previousState: first,
      rows: [closedRow("2026-06-11T09:02:00+02:00", { close: 100 })],
    });
    assert.equal(first.state, PREDICATE_STATES_V1.SATISFIED);
    assert.equal(second.state, PREDICATE_STATES_V1.SATISFIED);
    assert.equal(second.reason, "SATISFACTION_LATCHED");
  });

  it("never falls back to MNQ rows for a missing GC condition", () => {
    const result = evaluateDeterministicConditionSetV1({
      setup: { instrument: "MNQ" },
      conditions: [{
        condition_id: "gc_confirm",
        predicate_type: "PRICE_RELATION",
        instrument: "GC",
        timeframe: "M1",
        operator: "CLOSE_ABOVE",
        threshold: 2500,
        importance: "SECONDARY",
        required_for_trigger: false,
      }],
      rowsByInstrument: {
        MNQ: [closedRow("2026-06-11T09:00:00+02:00", { close: 30000 })],
      },
    });
    assert.equal(result.results[0].state, PREDICATE_STATES_V1.UNKNOWN);
    assert.deepEqual(result.soft_unknown_condition_ids, ["gc_confirm"]);
    assert.equal(result.weighted_confirmation_score, 0);
    assert.equal(result.weighted_known_confirmation_score, null);
  });

  it("requires structural activation, scores only known primary/secondary, and excludes optional evidence", () => {
    const rowsByInstrument = {
      MNQ: [closedRow("2026-06-11T09:00:00+02:00", { close: 102 })],
      MES: [{
        ...closedRow("2026-06-11T09:00:00+02:00", { instrument: "MES", close: 6002 }),
      }],
    };
    const result = evaluateDeterministicConditionSetV1({
      setup: { instrument: "MNQ" },
      rowsByInstrument,
      conditions: [
        {
          condition_id: "activation",
          predicate_type: "BREAKOUT_CLOSE",
          instrument: "MNQ",
          timeframe: "M1",
          operator: "CLOSE_ABOVE",
          threshold: 101,
          role: "ACTIVATION",
          importance: "MANDATORY",
          required_for_trigger: true,
        },
        {
          condition_id: "primary",
          predicate_type: "PRICE_RELATION",
          instrument: "MES",
          timeframe: "M1",
          operator: "CLOSE_ABOVE",
          threshold: 6000,
          role: "CONFIRMATION",
          importance: "PRIMARY",
          weight: 2,
        },
        {
          condition_id: "secondary",
          predicate_type: "PRICE_RELATION",
          instrument: "MES",
          timeframe: "M1",
          operator: "CLOSE_BELOW",
          threshold: 5990,
          role: "CONFIRMATION",
          importance: "SECONDARY",
          weight: 1,
        },
        {
          condition_id: "optional",
          predicate_type: "PRICE_RELATION",
          instrument: "MNQ",
          timeframe: "M1",
          operator: "CLOSE_ABOVE",
          threshold: 100,
          role: "CONFIRMATION",
          importance: "OPTIONAL",
          weight: 100,
        },
      ],
    });
    assert.equal(result.required_satisfied, 1);
    assert.equal(result.required_pending, 0);
    assert.equal(result.weighted_confirmation_score, 0.6667);
    assert.equal(result.score_weight_total, 3);
  });
});

describe("Pure Master and Monitor compilers", () => {
  it("compiles multiple ranked conditional setups and freezes the policy threshold", () => {
    const master = canonicalMaster({
      setups: [
        canonicalSetup({ setup_id: "rank_2", priority: 2 }),
        canonicalSetup({ setup_id: "rank_1", priority: 1, trigger_policy: { min_score: 70 } }),
      ],
    });
    const result = compileMasterPlanV1(master, masterOptions("replay"));
    assert.equal(result.valid, true);
    assert.deepEqual(result.ranked_setups.map((setup) => setup.setup_id), ["rank_1", "rank_2"]);
    assert.equal(result.ranked_setups[0].status, "ARMED_CONDITIONAL");
    assert.equal(result.ranked_setups[0].trigger_policy.min_score, 0.55);
    assert.equal(result.ranked_setups[0].trigger_policy.backend_can_trigger, true);
    assert.ok(
      result.diagnostics.normalizations.some((entry) => entry.code === "GPT_MIN_SCORE_OVERRIDDEN_BY_POLICY"),
    );
  });

  it("accepts up to five distinct candidates and rejects a sixth", () => {
    const five = Array.from({ length: 5 }, (_, index) => canonicalSetup({
      setup_id: `candidate_${index + 1}`,
      priority: index + 1,
    }));
    const accepted = compileMasterPlanV1(
      canonicalMaster({ setups: five }),
      masterOptions("replay"),
    );
    const rejected = compileMasterPlanV1(
      canonicalMaster({
        setups: [
          ...five,
          canonicalSetup({ setup_id: "candidate_6", priority: 6 }),
        ],
      }),
      masterOptions("replay"),
    );

    assert.equal(accepted.ranked_setups.length, 5);
    assert.equal(accepted.valid, true);
    assert.equal(rejected.valid, false);
    assert.ok(rejected.diagnostics.errors.some(
      (entry) => entry.code === "MASTER_SETUP_PORTFOLIO_LIMIT_EXCEEDED",
    ));
  });

  it("subsumes duplicate zone and rejection blockers into an atomic break-retest sequence", () => {
    const conditions = [
      {
        condition_id: "break",
        predicate_type: "BREAKOUT_CLOSE",
        role: "ACTIVATION",
        effect: "REQUIRE_TRUE",
        instrument: "MNQ",
        timeframe: "M1",
        operator: "CLOSE_ABOVE",
        threshold: 28470,
        importance: "MANDATORY",
        required_for_trigger: true,
        memory_policy: "LATCH_UNTIL_TRIGGER",
      },
      {
        condition_id: "break_retest",
        predicate_type: "BREAK_RETEST_SEQUENCE",
        role: "ACTIVATION",
        effect: "REQUIRE_TRUE",
        instrument: "MNQ",
        timeframe: "M1",
        operator: "CLOSE_ABOVE",
        threshold: 28470,
        importance: "MANDATORY",
        required_for_trigger: true,
        memory_policy: "LATCH_UNTIL_TRIGGER",
        parameters: {
          break_condition_id: "break",
          retest_level: 28470,
          tolerance_points: 8,
          max_bars: 30,
          require_rejection_confirmation: true,
        },
      },
      {
        condition_id: "zone_touch",
        predicate_type: "ZONE_TOUCH",
        role: "CONFIRMATION",
        effect: "REQUIRE_TRUE",
        instrument: "MNQ",
        timeframe: "M1",
        operator: "TOUCH_BELOW",
        threshold: 28470,
        importance: "MANDATORY",
        required_for_trigger: true,
        memory_policy: "LATEST_ONLY",
        parameters: { zone_lower: 28462, zone_upper: 28472 },
      },
      {
        condition_id: "rejection",
        predicate_type: "REJECTION_PATTERN",
        role: "CONFIRMATION",
        effect: "REQUIRE_TRUE",
        instrument: "MNQ",
        timeframe: "M1",
        operator: "REJECT_SUPPORT",
        threshold: 28470,
        importance: "MANDATORY",
        required_for_trigger: true,
        memory_policy: "LATEST_ONLY",
        parameters: { threshold: 28470, tolerance_points: 8 },
      },
    ];
    const result = compileMasterPlanV1(canonicalMaster({
      setups: [canonicalSetup({
        entry_zone: { from: 28462, to: 28472 },
        stop_loss: 28392,
        take_profits: [{ name: "TP1", target: 28632 }],
        conditions,
      })],
    }), masterOptions("replay"));
    const compiled = result.ranked_setups[0].conditions;

    for (const conditionId of ["zone_touch", "rejection"]) {
      const component = compiled.find((condition) => condition.condition_id === conditionId);
      assert.equal(component.required_for_trigger, false);
      assert.equal(component.atomic_component, true);
      assert.equal(component.subsumed_by_condition_id, "break_retest");
      assert.equal(component.importance, "ADVISORY");
    }
  });

  it("subsumes a duplicate price threshold already carried by an atomic break-retest sequence", () => {
    const conditions = [
      {
        condition_id: "break_retest",
        predicate_type: "BREAK_RETEST_SEQUENCE",
        role: "ACTIVATION",
        effect: "REQUIRE_TRUE",
        instrument: "MNQ",
        timeframe: "M5",
        operator: "BREAK_RETEST_LONG",
        importance: "MANDATORY",
        required_for_trigger: true,
        memory_policy: "LATCH_UNTIL_TRIGGER",
        parameters: {
          break_condition_id: "break_level",
          retest_level: 28470,
          tolerance_points: 8,
          max_bars: 6,
          require_rejection_confirmation: true,
        },
      },
      {
        condition_id: "duplicate_close_above",
        predicate_type: "PRICE_RELATION",
        role: "CONFIRMATION",
        effect: "REQUIRE_TRUE",
        instrument: "MNQ",
        timeframe: "M5",
        operator: "CLOSE_ABOVE",
        threshold: 28470,
        importance: "MANDATORY",
        required_for_trigger: true,
        memory_policy: "LATCH_UNTIL_TRIGGER",
        parameters: { threshold: 28470 },
      },
    ];
    const result = compileMasterPlanV1(canonicalMaster({
      setups: [canonicalSetup({ conditions })],
    }), masterOptions("replay"));
    const duplicate = result.ranked_setups[0].conditions.find(
      (condition) => condition.condition_id === "duplicate_close_above",
    );
    assert.equal(duplicate.required_for_trigger, false);
    assert.equal(duplicate.importance, "ADVISORY");
    assert.equal(duplicate.atomic_component, true);
    assert.equal(duplicate.subsumed_by_condition_id, "break_retest");
  });

  it("compiles every compatible entry/order pair without changing its transport semantics", () => {
    const scenarios = [
      { entry_mode: "NEXT_BAR_MARKET_AFTER_CONFIRMATION", order_type: "MARKET" },
      { entry_mode: "LIMIT_TOUCH", order_type: "LIMIT" },
      { entry_mode: "STOP_CROSS", order_type: "STOP" },
      { entry_mode: "STOP_CROSS", order_type: "STOP_LIMIT", entry_stop_price: 100, entry_limit_price: 99.75 },
      { entry_mode: "RETEST_ZONE_AFTER_CONFIRMATION", order_type: "MARKET" },
      { entry_mode: "RETEST_ZONE_AFTER_CONFIRMATION", order_type: "LIMIT" },
    ];
    for (const scenario of scenarios) {
      const result = compileMasterPlanV1(canonicalMaster({ setups: [canonicalSetup(scenario)] }), masterOptions("replay"));
      const setup = result.ranked_setups[0];
      assert.equal(result.valid, true, JSON.stringify(setup.compilation_diagnostics));
      assert.equal(setup.compile_status, "COMPILED");
      assert.equal(setup.entry_mode, scenario.entry_mode);
      assert.equal(setup.order_type, scenario.order_type);
    }
  });

  it("rejects missing, incompatible and incomplete entry/order semantics", () => {
    const failures = [
      { overrides: { order_type: null }, code: "ORDER_TYPE_REQUIRED" },
      { overrides: { entry_mode: "NEXT_BAR_MARKET_AFTER_CONFIRMATION", order_type: "LIMIT" }, code: "ENTRY_MODE_ORDER_TYPE_INCOMPATIBLE" },
      { overrides: { entry_mode: "STOP_CROSS", order_type: "STOP_LIMIT" }, code: "STOP_LIMIT_PARAMETERS_INCOMPLETE" },
    ];
    for (const failure of failures) {
      const result = compileMasterPlanV1(canonicalMaster({ setups: [canonicalSetup(failure.overrides)] }), masterOptions("replay"));
      const setup = result.ranked_setups[0];
      assert.equal(setup.compile_status, "REJECTED");
      assert.ok(setup.compilation_diagnostics.errors.some((entry) => entry.code === failure.code));
    }
  });


  it("normalizes contradictory hard blockers without creating an impossible required condition", () => {
    const invalidation = {
      condition_id: "veto",
      predicate_type: "PRICE_RELATION",
      instrument: "MNQ",
      timeframe: "M1",
      operator: "CLOSE_ABOVE",
      threshold: 103,
      importance: "HARD_BLOCKER",
      required_for_trigger: true,
    };
    const result = compileMasterPlanV1(canonicalMaster({
      setups: [canonicalSetup({ conditions: [...canonicalSetup().conditions, invalidation] })],
    }), masterOptions("replay"));
    const veto = result.ranked_setups[0].conditions.find((condition) => condition.condition_id === "veto");
    assert.equal(veto.effect, "BLOCK_IF_TRUE");
    assert.equal(veto.required_for_trigger, false);
    assert.equal(veto.weight, 0);
    assert.equal(veto.memory_policy, "LATEST_ONLY");
  });

  it("canonicalizes explicit incompatible blocker memory policies during V5 compilation", () => {
    const baseBlocker = {
      predicate_type: "PRICE_RELATION",
      effect: "BLOCK_IF_TRUE",
      instrument: "MNQ",
      timeframe: "M1",
      operator: "CLOSE_ABOVE",
      threshold: 103,
      importance: "HARD_BLOCKER",
      required_for_trigger: false,
    };
    const result = compileMasterPlanV1(canonicalMaster({
      setups: [canonicalSetup({
        conditions: [
          ...canonicalSetup().conditions,
          { ...baseBlocker, condition_id: "temporary_veto", role: "VETO", memory_policy: "INVALIDATE_TERMINAL" },
          { ...baseBlocker, condition_id: "structural_invalidation", role: "INVALIDATION", memory_policy: "LATCH_UNTIL_TRIGGER" },
        ],
      })],
    }), masterOptions("replay"));
    const conditions = result.ranked_setups[0].conditions;
    assert.equal(conditions.find((entry) => entry.condition_id === "temporary_veto").memory_policy, "LATEST_ONLY");
    assert.equal(conditions.find((entry) => entry.condition_id === "structural_invalidation").memory_policy, "INVALIDATE_TERMINAL");
  });

  it("requires structured no-opportunity proof when no setup is compiled", () => {
    const invalid = compileMasterPlanV1(canonicalMaster({ setups: [] }), masterOptions("replay"));
    assert.equal(invalid.valid, false);
    assert.equal(invalid.opportunity_diagnostic, "INVALID_NO_EXECUTABLE_SETUP");

    const valid = compileMasterPlanV1(canonicalMaster({
      setups: [],
      no_setup_proof: {
        best_long: { candidate: "long rejected" },
        best_short: { candidate: "short rejected" },
        blocking_reasons: ["RR below 2"],
        wait_to_go_conditions: ["new structure"],
        revalidation_triggers: ["next M5 close"],
      },
    }), masterOptions("replay"));
    assert.equal(valid.valid, true);
    assert.equal(valid.opportunity_diagnostic, "VALID_NO_OPPORTUNITY_PROOF");
  });

  it("maps legacy TRIGGER_GO to ARM_SETUP and never to an engine trigger", () => {
    const setup = canonicalSetup({ status: "TRIGGERED" });
    const result = compileMonitorCommandV1({
      contract_name: "DeskHourlyThesisMonitorContract",
      schema_version: "2.4.0",
      monitor_id: "monitor_0915",
      plan_id: "plan_2026_06_11",
      data_quality: canonicalMonitorDataQuality(),
      timestamp_paris: "2026-06-11T09:15:00+02:00",
      monitor_decision: {
        decision: "TRIGGER_GO",
        reason_summary: "Conditions analytiques réunies",
      },
      setup_update: setup,
      active_thesis_update: { status: "THESIS_ACTIVE" },
    }, {
      ...masterOptions("live"),
      currentState: {
        thesis: { status: "ACTIVE" },
        setup: {
          setup_id: setup.setup_id,
          status: "PRE_ARMED",
          valid_from_paris: "2026-06-11T09:00:00+02:00",
        },
        position: { status: "NONE" },
        replan: { state: "IDLE" },
      },
    });

    assert.equal(result.valid, true);
    assert.equal(result.source_action, "TRIGGER_GO");
    assert.equal(result.canonical_action, "ARM_SETUP");
    assert.equal(result.setup_command.type, "ARM");
    assert.equal(result.transitions.setup.next_state, "ARMED_CONDITIONAL");
    assert.equal(result.setup_command.setup.status, "ARMED_CONDITIONAL");
    assert.equal(result.setup_command.setup.valid_from_paris, "2026-06-11T09:00:00+02:00");
    assert.notEqual(result.setup_command.type, "ENGINE_TRIGGER");
  });

  it("rejects conflicting action aliases instead of guessing", () => {
    const result = compileMonitorCommandV1({
      monitor_id: "monitor_conflict",
      monitor_decision: { action: "ARM_SETUP", decision: "EXIT_POSITION" },
    }, {
      currentState: {
        thesis: { status: "ACTIVE" },
        setup: { status: "PRE_ARMED" },
        replan: { state: "IDLE" },
      },
    });
    assert.equal(result.valid, false);
    assert.equal(result.canonical_action, "NO_ACTION");
    assert.ok(result.diagnostics.errors.some((entry) => entry.code === "CONFLICTING_ACTION_ALIASES"));
  });

  it("maps current_score and keeps position actions as requests only", () => {
    const result = compileMonitorCommandV1({
      monitor_id: "monitor_partial",
      plan_id: "plan_2026_06_11",
      data_quality: canonicalMonitorDataQuality(),
      monitor_decision: { decision: "TAKE_PARTIAL" },
      thesis_health_score: { previous_score: 72, current_score: 68, delta: -4 },
      active_thesis_update: { status: "THESIS_WEAKENED" },
      position_check: { position_id: "position_1", partial_fraction: 0.5 },
    }, {
      currentState: {
        thesis: { status: "WEAKENED" },
        setup: { status: "TRIGGERED" },
        position: { status: "OPEN", position_id: "position_1" },
        replan: { state: "IDLE" },
      },
    });
    assert.equal(result.valid, true);
    assert.equal(result.thesis_command.payload.health_score, 68);
    assert.equal(result.position_request.type, "TAKE_PARTIAL");
    assert.equal(result.position_request.authority, "GPT_REQUEST_ONLY");
  });

  it("produces identical canonical hashes for LIVE and Replay transport", () => {
    const rawMaster = canonicalMaster();
    const live = compileMasterPlanV1(rawMaster, masterOptions("live"));
    const replay = compileMasterPlanV1(rawMaster, masterOptions("replay"));
    assert.equal(live.canonical_hash, replay.canonical_hash);
    assert.equal(live.transport_context.source_mode, "LIVE");
    assert.equal(replay.transport_context.source_mode, "REPLAY");

    const rawMonitor = {
      monitor_id: "monitor_0930",
      plan_id: "plan_2026_06_11",
      data_quality: canonicalMonitorDataQuality(),
      timestamp_paris: "2026-06-11T09:30:00+02:00",
      monitor_decision: { decision: "MAINTAIN_THESIS" },
      active_thesis_update: { status: "THESIS_ACTIVE" },
    };
    const currentState = {
      thesis: { status: "ACTIVE" },
      setup: { status: "PRE_ARMED" },
      position: { status: "NONE" },
      replan: { state: "IDLE" },
    };
    const liveMonitor = compileMonitorCommandV1(rawMonitor, {
      ...masterOptions("live"),
      currentState,
    });
    const replayMonitor = compileMonitorCommandV1(rawMonitor, {
      ...masterOptions("replay"),
      currentState,
    });
    assert.equal(liveMonitor.canonical_hash, replayMonitor.canonical_hash);
  });
});
