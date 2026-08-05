import assert from "node:assert/strict";
import test from "node:test";
import {
  INTERMARKET_ALIGNMENT_VERSION_V1,
  PREDICATE_STATES_V1,
  evaluateDeterministicConditionSetV1,
  evaluateDeterministicPredicateV1,
  evaluateOpportunitySeekingControlledV1,
} from "../index.js";

function condition(overrides = {}) {
  return {
    condition_id: "condition_1",
    predicate_type: "PRICE_RELATION",
    role: "ACTIVATION",
    effect: "REQUIRE_TRUE",
    instrument: "MNQ",
    timeframe: "M1",
    operator: "CLOSE_ABOVE",
    parameters: { threshold: 100 },
    importance: "MANDATORY",
    required_for_trigger: true,
    memory_policy: "LATEST_ONLY",
    weight: 0,
    ...overrides,
  };
}

function row(timestamp, overrides = {}) {
  return {
    instrument: "MNQ",
    timeframe: "M1",
    timestamp_paris: timestamp,
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    closed: true,
    ...overrides,
  };
}

test("nested RSI and VWAP values are canonical numeric inputs", () => {
  const rsi = evaluateDeterministicPredicateV1({
    condition: condition({
      predicate_type: "RSI_THRESHOLD",
      parameters: { threshold: 55, indicator_period: 14 },
    }),
    rows: [row("2026-07-30T09:01:00+02:00", { studies: { RSI_14: { value: 60 } } })],
    nowParis: "2026-07-30T09:01:00+02:00",
  });
  const vwap = evaluateDeterministicPredicateV1({
    condition: condition({
      predicate_type: "VWAP_RELATION",
      parameters: { reference_code: "SESSION_VWAP" },
    }),
    rows: [row("2026-07-30T09:01:00+02:00", {
      close: 102,
      indicators: { SESSION_VWAP: { value: 101 } },
    })],
    nowParis: "2026-07-30T09:01:00+02:00",
  });
  assert.equal(rsi.state, PREDICATE_STATES_V1.SATISFIED);
  assert.equal(vwap.state, PREDICATE_STATES_V1.SATISFIED);
});

test("missing required indicator numbers stay UNKNOWN rather than known PENDING", () => {
  const rsi = evaluateDeterministicPredicateV1({
    condition: condition({
      predicate_type: "RSI_THRESHOLD",
      parameters: { threshold: 55, indicator_period: 14 },
    }),
    rows: [row("2026-07-30T09:01:00+02:00")],
    nowParis: "2026-07-30T09:01:00+02:00",
  });
  assert.equal(rsi.state, PREDICATE_STATES_V1.UNKNOWN);
  assert.equal(rsi.reason, "RSI_VALUE_MISSING");
});

test("Paris HH:mm windows are anchored to trading_date and cross midnight deterministically", () => {
  const timeCondition = condition({
    predicate_type: "TIME_WINDOW",
    operator: "WITHIN_WINDOW",
    parameters: { window_start_paris: "22:00", window_end_paris: "02:00" },
  });
  const within = evaluateDeterministicPredicateV1({
    condition: timeCondition,
    tradingDate: "2026-07-30",
    rows: [row("2026-07-31T01:00:00+02:00")],
    nowParis: "2026-07-31T01:00:00+02:00",
  });
  const outside = evaluateDeterministicPredicateV1({
    condition: timeCondition,
    tradingDate: "2026-07-30",
    rows: [row("2026-07-31T03:00:00+02:00")],
    nowParis: "2026-07-31T03:00:00+02:00",
  });
  assert.equal(within.state, PREDICATE_STATES_V1.SATISFIED);
  assert.equal(outside.state, PREDICATE_STATES_V1.PENDING);
});

test("intermarket alignment is derived from closed reference M1 direction with lineage", () => {
  const evaluation = evaluateDeterministicConditionSetV1({
    setup: { instrument: "MNQ", direction: "long", trading_date: "2026-07-30" },
    conditions: [condition({
      condition_id: "mes_alignment",
      predicate_type: "INTERMARKET_CONFIRMATION",
      role: "CONFIRMATION",
      effect: "REQUIRE_TRUE",
      importance: "PRIMARY",
      required_for_trigger: false,
      weight: 2,
      parameters: { reference_instrument: "MES" },
      operator: "ALIGNS_WITH",
    })],
    rowsByInstrument: {
      MES: [
        row("2026-07-30T09:00:00+02:00", { instrument: "MES", close: 7000 }),
        row("2026-07-30T09:01:00+02:00", { instrument: "MES", close: 7001 }),
      ],
    },
    nowParis: "2026-07-30T09:01:00+02:00",
  });
  assert.equal(evaluation.results[0].state, PREDICATE_STATES_V1.SATISFIED);
  assert.equal(
    evaluation.results[0].evidence.alignment_lineage.version,
    INTERMARKET_ALIGNMENT_VERSION_V1,
  );
  assert.equal(evaluation.results[0].evidence.alignment_lineage.source, "REFERENCE_M1_CLOSED_CLOSE_DIRECTION");
});

test("insufficient reference M1 history leaves intermarket UNKNOWN", () => {
  const result = evaluateDeterministicPredicateV1({
    condition: condition({
      predicate_type: "INTERMARKET_CONFIRMATION",
      parameters: { reference_instrument: "MES" },
      operator: "ALIGNS_WITH",
      direction: "long",
    }),
    rows: [row("2026-07-30T09:01:00+02:00", { instrument: "MES", close: 7001 })],
    nowParis: "2026-07-30T09:01:00+02:00",
  });
  assert.equal(result.state, PREDICATE_STATES_V1.UNKNOWN);
  assert.equal(result.reason, "INTERMARKET_M1_ALIGNMENT_UNAVAILABLE");
});

test("EVENT_BLACKOUT never treats market candles as an exact clear event window", () => {
  const eventCondition = condition({
    condition_id: "cpi_block",
    predicate_type: "EVENT_BLACKOUT",
    role: "VETO",
    effect: "BLOCK_IF_TRUE",
    importance: "HARD_BLOCKER",
    required_for_trigger: false,
    operator: "EVENT_ACTIVE",
    parameters: { event_window_ref: "cpi_window" },
  });
  const evaluation = evaluateDeterministicConditionSetV1({
    setup: { instrument: "MNQ", direction: "long", trading_date: "2026-07-30" },
    conditions: [eventCondition],
    rowsByInstrument: { MNQ: [row("2026-07-30T09:00:00+02:00")] },
    nowParis: "2026-07-30T09:00:00+02:00",
  });
  const opportunity = evaluateOpportunitySeekingControlledV1({
    setup: {
      status: "ARMED_CONDITIONAL",
      direction: "long",
      entry_zone: { low: 100, high: 101 },
      stop_loss: 98,
      take_profit_1: 107,
      rr_expected: 2,
      risk_pct: 0.25,
    },
    conditionEvaluation: evaluation,
    phase: "ENTRY_TRIGGER",
    nowParis: "2026-07-30T09:00:00+02:00",
  });
  assert.equal(evaluation.hard_blockers_unknown, 1);
  assert.equal(opportunity.trigger_eligible, false);
  assert.equal(
    opportunity.hard_failures.some((failure) => failure.code === "CANONICAL_TRIGGER_DATA_MISSING"),
    true,
  );
});

test("EVENT_CLEAR uses only the exact reserved macro window", () => {
  const result = evaluateDeterministicPredicateV1({
    condition: condition({
      predicate_type: "EVENT_BLACKOUT",
      operator: "EVENT_CLEAR",
      parameters: { event_window_ref: "cpi_window" },
    }),
    rows: [{
      event_id: "cpi_window",
      window_start_paris: "2026-07-30T08:55:00+02:00",
      window_end_paris: "2026-07-30T09:05:00+02:00",
      timestamp_paris: "2026-07-30T09:00:00+02:00",
    }],
    nowParis: "2026-07-30T09:10:00+02:00",
  });
  assert.equal(result.state, PREDICATE_STATES_V1.SATISFIED);
  assert.equal(result.evidence.event_window_ref, "cpi_window");
});
