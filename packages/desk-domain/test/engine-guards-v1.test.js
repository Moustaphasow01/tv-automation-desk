import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HARD_GATE_CODES_V5,
  HARD_GATE_ENFORCEMENT_PHASES_V5,
  OPPORTUNITY_EVALUATION_PHASES_V1,
  PREDICATE_STATES_V1,
  compileMasterPlanV1,
  evaluateDeterministicConditionSetV1,
  evaluateOpportunitySeekingControlledV1,
  setupConditionInstrumentsV1,
} from "../index.js";

function executableSetup(overrides = {}) {
  return {
    setup_id: "mnq_event_setup",
    status: "ARMED_CONDITIONAL",
    instrument: "MNQ",
    direction: "long",
    entry_price: 100,
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    stop_loss: 98,
    take_profit_1: 104,
    risk_pct: 0.25,
    valid_from_paris: "2026-06-11T09:00:00+02:00",
    expires_at_paris: "2026-06-11T12:00:00+02:00",
    conditions: [{
      condition_id: "activation",
      predicate_type: "PRICE_RELATION",
      role: "ACTIVATION",
      effect: "REQUIRE_TRUE",
      instrument: "MNQ",
      timeframe: "M1",
      operator: "CLOSE_ABOVE",
      threshold: 99,
      importance: "MANDATORY",
      required_for_trigger: true,
    }],
    ...overrides,
  };
}

function closedRow({
  instrument = "MNQ",
  timeframe = "M1",
  close = 100,
  timestamp = "2026-06-11T09:01:00+02:00",
} = {}) {
  return {
    instrument,
    timeframe,
    timestamp_paris: timestamp,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    closed: true,
  };
}

describe("Engine data and coverage guards", () => {
  it("loads the setup instrument and every secondary reference_instrument", () => {
    const instruments = setupConditionInstrumentsV1({
      instrument: "MNQ1!",
      conditions: [{
        predicate_type: "INTERMARKET_CONFIRMATION",
        instrument: "MNQ",
        parameters: { reference_instrument: "CME_MINI:MES1!" },
      }],
      invalidation_conditions: [{
        instrument: "VIX",
        parameters: { reference_instrument: "ES1!" },
      }],
    });
    assert.deepEqual(instruments, ["MNQ", "MES", "VIX", "ES"]);
  });

  it("fails closed when mandatory M1 data is absent and never falls back to M5", () => {
    const setup = executableSetup();
    const evaluation = evaluateDeterministicConditionSetV1({
      setup,
      conditions: setup.conditions,
      rowsByInstrument: {
        MNQ: [closedRow({ timeframe: "M5", close: 101 })],
      },
      nowParis: "2026-06-11T09:01:30+02:00",
    });
    assert.equal(evaluation.results[0].state, PREDICATE_STATES_V1.UNKNOWN);
    assert.equal(evaluation.required_unknown, 1);
    const policy = evaluateOpportunitySeekingControlledV1({
      setup,
      conditionEvaluation: evaluation,
      phase: "ENTRY_TRIGGER",
      nowParis: "2026-06-11T09:01:30+02:00",
    });
    assert.equal(policy.eligible, false);
    assert.equal(policy.trigger_eligible, false);
    assert.ok(
      policy.hard_failures.some((entry) => entry.code === "MANDATORY_INDICATOR_MISSING"),
    );
  });

  it("does not score one known secondary as 1.0 while PRIMARY is UNKNOWN", () => {
    const setup = executableSetup({
      conditions: [
        executableSetup().conditions[0],
        {
          condition_id: "mes_primary",
          predicate_type: "PRICE_RELATION",
          role: "CONFIRMATION",
          effect: "REQUIRE_TRUE",
          instrument: "MES",
          timeframe: "M1",
          operator: "CLOSE_ABOVE",
          threshold: 6000,
          importance: "PRIMARY",
          required_for_trigger: false,
          weight: 2,
        },
        {
          condition_id: "mnq_secondary",
          predicate_type: "PRICE_RELATION",
          role: "CONFIRMATION",
          effect: "REQUIRE_TRUE",
          instrument: "MNQ",
          timeframe: "M1",
          operator: "CLOSE_ABOVE",
          threshold: 99,
          importance: "SECONDARY",
          required_for_trigger: false,
          weight: 1,
        },
      ],
    });
    const evaluation = evaluateDeterministicConditionSetV1({
      setup,
      conditions: setup.conditions,
      rowsByInstrument: {
        MNQ: [closedRow({ close: 101 })],
      },
      nowParis: "2026-06-11T09:01:30+02:00",
    });
    assert.equal(evaluation.weighted_confirmation_score, 0.3333);
    assert.equal(evaluation.weighted_known_confirmation_score, 1);
    assert.equal(evaluation.primary_confirmation_known, 0);

    const policy = evaluateOpportunitySeekingControlledV1({
      setup,
      conditionEvaluation: evaluation,
      phase: "ENTRY_TRIGGER",
      nowParis: "2026-06-11T09:01:30+02:00",
    });
    assert.equal(policy.eligible, true);
    assert.equal(policy.trigger_eligible, false);
    assert.equal(policy.primary_confirmation_coverage_ready, false);
    assert.ok(policy.soft_gaps.some((entry) => entry.code === "CONTEXTUAL_DATA_GAP"));
  });
});

describe("Hard gates are strict at their owning phase", () => {
  it("uses the normative phase order and exact V5 ownership table", () => {
    assert.deepEqual(OPPORTUNITY_EVALUATION_PHASES_V1, [
      "PLAN_COMPILE",
      "SETUP_ARM",
      "ENTRY_TRIGGER",
      "BROKER_SUBMIT",
    ]);
    assert.deepEqual(Object.keys(HARD_GATE_ENFORCEMENT_PHASES_V5), HARD_GATE_CODES_V5);

    const setup = executableSetup();
    for (const code of HARD_GATE_CODES_V5) {
      const owningPhase = HARD_GATE_ENFORCEMENT_PHASES_V5[code];
      const owningIndex = OPPORTUNITY_EVALUATION_PHASES_V1.indexOf(owningPhase);
      for (const [phaseIndex, phase] of OPPORTUNITY_EVALUATION_PHASES_V1.entries()) {
        const result = evaluateOpportunitySeekingControlledV1({
          setup,
          conditionEvaluation: {},
          gates: [{ code, state: "FAIL" }],
          phase,
        });
        assert.equal(result.evaluation_phase, phase);
        const shouldEnforce = phaseIndex >= owningIndex;
        assert.equal(
          result.hard_failures.some((entry) => entry.code === code),
          shouldEnforce,
          `${code} at ${phase}`,
        );
        assert.equal(
          result.deferred_hard_gates.some((entry) => entry.code === code),
          !shouldEnforce,
          `${code} deferred at ${phase}`,
        );
      }
    }
  });

  it("normalizes COMPILE and TRIGGER only as legacy boundary aliases", () => {
    const setup = executableSetup();
    const compile = evaluateOpportunitySeekingControlledV1({
      setup,
      gates: [{ code: "GEOMETRY_INVALID", state: "FAIL" }],
      phase: "COMPILE",
    });
    const trigger = evaluateOpportunitySeekingControlledV1({
      setup,
      gates: [{ code: "BROKER_SAFETY_FAILED", state: "FAIL" }],
      phase: "TRIGGER",
    });
    assert.equal(compile.evaluation_phase, "PLAN_COMPILE");
    assert.equal(trigger.evaluation_phase, "ENTRY_TRIGGER");
    assert.ok(compile.deferred_hard_gates.some((entry) => entry.code === "GEOMETRY_INVALID"));
    assert.ok(trigger.deferred_hard_gates.some((entry) => entry.code === "BROKER_SAFETY_FAILED"));
  });

  it("keeps invalid geometry compiled as a candidate but refuses SETUP_ARM", () => {
    const master = {
      contract_name: "DeskMasterAnalysisContract",
      schema_version: "5.0.0-legacy-shape",
      analysis_id: "master_geometry_phase",
      plan_id: "plan_geometry_phase",
      timestamp_paris: "2026-06-11T09:00:00+02:00",
      active_thesis: {
        thesis_id: "thesis_geometry_phase",
        plan_id: "plan_geometry_phase",
        status: "THESIS_CONDITIONAL",
        instrument: "MNQ",
        direction: "long",
      },
      gates: HARD_GATE_CODES_V5.map((code) => ({ code, state: "PASS" })),
      setups: [executableSetup({ stop_loss: 99, take_profit_1: 101 })],
    };
    const compiled = compileMasterPlanV1(master, {
      sourceMode: "REPLAY",
      scope: {
        mode: "REPLAY",
        trading_date: "2026-06-11",
        session: "full_day",
        cutoff_paris: "2026-06-11T09:00:00+02:00",
        timezone: "Europe/Paris",
      },
    });
    const setup = compiled.ranked_setups[0];
    assert.equal(compiled.valid, true);
    assert.equal(setup.compile_status, "COMPILED");
    assert.equal(setup.status, "PRE_ARMED");
    assert.equal(setup.trigger_policy.backend_can_trigger, false);
    assert.equal(setup.gate_evaluation.evaluation_phase, "PLAN_COMPILE");
    assert.ok(setup.gate_evaluation.deferred_hard_gates.some(
      (entry) => entry.code === "RR_BELOW_MINIMUM",
    ));

    const arm = evaluateOpportunitySeekingControlledV1({
      setup,
      conditionEvaluation: {},
      phase: "SETUP_ARM",
    });
    assert.equal(arm.eligible, false);
    assert.ok(arm.hard_failures.some((entry) => entry.code === "RR_BELOW_MINIMUM"));
  });

  it("compiles and arms a protected setup during blackout, then blocks only at entry", () => {
    const master = {
      contract_name: "DeskMasterAnalysisContract",
      schema_version: "5.0.0-legacy-shape",
      analysis_id: "master_blackout",
      timestamp_paris: "2026-06-11T09:00:00+02:00",
      active_thesis: {
        thesis_id: "thesis_blackout",
        status: "THESIS_CONDITIONAL",
        instrument: "MNQ",
        direction: "long",
      },
      decision_gates: [{
        code: "MAJOR_EVENT_ENTRY_BLOCK",
        state: "FAIL",
        evidence: { event_window_ref: "cpi_window" },
      }],
      setups: [executableSetup()],
    };
    const compiled = compileMasterPlanV1(master, {
      sourceMode: "LIVE",
      scope: {
        mode: "LIVE",
        trading_date: "2026-06-11",
        session: "full_day",
        cutoff_paris: "2026-06-11T09:00:00+02:00",
        timezone: "Europe/Paris",
      },
    });
    const setup = compiled.ranked_setups[0];
    assert.equal(setup.compile_status, "COMPILED");
    assert.equal(setup.status, "ARMED_CONDITIONAL");
    assert.equal(setup.trigger_policy.backend_can_trigger, true);
    assert.equal(setup.gate_evaluation.evaluation_phase, "PLAN_COMPILE");
    assert.ok(
      setup.gate_evaluation.deferred_hard_gates
        .some((entry) => entry.code === "MAJOR_EVENT_ENTRY_BLOCK"),
    );

    const blocked = evaluateOpportunitySeekingControlledV1({
      setup,
      conditionEvaluation: {},
      gates: [{ code: "MAJOR_EVENT_ENTRY_BLOCK", state: "FAIL" }],
      phase: "ENTRY_TRIGGER",
    });
    assert.equal(blocked.trigger_eligible, false);
    assert.ok(
      blocked.hard_failures.some((entry) => entry.code === "MAJOR_EVENT_ENTRY_BLOCK"),
    );

    const cleared = evaluateOpportunitySeekingControlledV1({
      setup,
      conditionEvaluation: {},
      gates: [{ code: "MAJOR_EVENT_ENTRY_BLOCK", state: "PASS" }],
      phase: "ENTRY_TRIGGER",
    });
    assert.equal(cleared.trigger_eligible, true);
  });

  it("defers broker safety until BROKER_SUBMIT and blocks there", () => {
    const setup = executableSetup();
    const gate = [{ code: "BROKER_SAFETY_FAILED", state: "FAIL" }];
    const compile = evaluateOpportunitySeekingControlledV1({
      setup,
      conditionEvaluation: {},
      gates: gate,
      phase: "PLAN_COMPILE",
    });
    const trigger = evaluateOpportunitySeekingControlledV1({
      setup,
      conditionEvaluation: {},
      gates: gate,
      phase: "ENTRY_TRIGGER",
    });
    const broker = evaluateOpportunitySeekingControlledV1({
      setup,
      conditionEvaluation: {},
      gates: gate,
      phase: "BROKER_SUBMIT",
    });
    assert.equal(compile.eligible, true);
    assert.equal(trigger.trigger_eligible, true);
    assert.ok(
      trigger.deferred_hard_gates.some((entry) => entry.code === "BROKER_SAFETY_FAILED"),
    );
    assert.equal(broker.eligible, false);
    assert.ok(
      broker.hard_failures.some((entry) => entry.code === "BROKER_SAFETY_FAILED"),
    );
  });
});
