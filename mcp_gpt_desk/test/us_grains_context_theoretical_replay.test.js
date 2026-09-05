import assert from "node:assert/strict";
import test from "node:test";
import { grainsCalendarFixture } from "./support/grains-calendar-fixture.js";

import { replayUsGrainsStrategySuiteV2 } from "../src/us-grains-strategy-suite.js";
import {
  CONTEXT_ONLY_HUMAN_GATE,
  replayUsGrainsContextTheoretical,
} from "../src/us-grains-context-theoretical-replay.js";

test("contextual replay preserves raw/context detection while consuming the causal adapter for one shared entry and exit", () => {
  const input = causalInput();
  const suite = replayUsGrainsStrategySuiteV2(input);
  const signal = suite.accepted_signals[0];
  assert.ok(signal, "fixture must produce a context-accepted signal");
  const executionRows = outcomeRows(signal);
  const withOutcome = replayUsGrainsContextTheoretical({
    ...input,
    rowsBySymbol: {
      ...input.rowsBySymbol,
      [`${signal.instrument}1!:1`]: [
        ...input.rowsBySymbol[`${signal.instrument}1!:1`],
        ...executionRows,
      ],
    },
    asOfUtc: "2026-07-07T18:20:00.000Z",
  });
  const withFutureExecution = replayUsGrainsContextTheoretical({
    ...input,
    rowsBySymbol: {
      ...input.rowsBySymbol,
      [`${signal.instrument}1!:1`]: [
        ...input.rowsBySymbol[`${signal.instrument}1!:1`],
        ...executionRows,
        m1("2026-07-08T13:30:00.000Z", 500, 501, 499),
      ],
    },
    asOfUtc: "2026-07-07T18:20:00.000Z",
  });
  const result = outcomeFor(withOutcome, signal.signal_id);

  assert.equal(withOutcome.report_title, CONTEXT_ONLY_HUMAN_GATE);
  assert.equal(withOutcome.context.source_suite_simulation_status, "NOT_RUN");
  assert.equal(withOutcome.simulation_constraints.tradable, false);
  assert.equal(withOutcome.simulation_constraints.netting_applied, false);
  assert.equal(
    withOutcome.context.simulated_signal_count,
    suite.context_accepted_count,
  );
  assert.deepEqual(withOutcome.raw_signals, suite.raw_signals);
  assert.deepEqual(withOutcome.context_decisions, suite.context_decisions);
  assert.equal(result.status, "TARGET_HIT");
  assert.equal(result.filled_at_utc, signal.generated_at_utc);
  assert.equal(result.closed_at_utc, plusMinutes(signal.generated_at_utc, 1));
  assert.deepEqual(withFutureExecution.raw_signals, withOutcome.raw_signals);
  assert.deepEqual(
    withFutureExecution.context_decisions,
    withOutcome.context_decisions,
  );
  assert.deepEqual(outcomeFor(withFutureExecution, signal.signal_id), result);
});

test("contextual replay reports no closed R as null, never as a tradable zero", () => {
  const report = replayUsGrainsContextTheoretical({
    ...causalInput(),
    asOfUtc: "2026-07-07T18:20:00.000Z",
  });

  assert.ok(report.context.context_accepted_count > 0);
  assert.equal(report.closed_r.total_r, null);
  assert.equal(report.closed_r.average_r, null);
  assert.equal(
    report.closed_r.interpretation,
    "THEORETICAL_CLOSED_OUTCOMES_NOT_TRADABLE",
  );
  assert.notEqual(report.closed_r.status, "OBSERVED_CLOSED_OUTCOMES_ONLY");
  assert.equal(report.simulation_constraints.portfolio_risk_evaluated, false);
  assert.equal(report.simulation_constraints.human_gate_required, true);
});

function outcomeFor(report, signalId) {
  return report.theoretical_outcomes.find(
    (outcome) => outcome.signal_id === signalId,
  );
}

function outcomeRows(signal) {
  const plan = signal.proposed_trade_plan;
  const entry = plan.entry.calculation_price;
  const target = plan.targets[0].price;
  const isLong = signal.direction === "LONG";
  return [
    isLong
      ? m1(signal.generated_at_utc, entry + 0.25, entry + 0.5, entry - 0.25)
      : m1(signal.generated_at_utc, entry - 0.25, entry + 0.25, entry - 0.5),
    isLong
      ? m1(plusMinutes(signal.generated_at_utc, 1), entry, target + 0.25, entry)
      : m1(
          plusMinutes(signal.generated_at_utc, 1),
          entry,
          entry,
          target - 0.25,
        ),
  ];
}

function causalInput(extra = {}) {
  const prior = m5Day(
    "2026-07-06T13:30:00.000Z",
    Array.from({ length: 58 }, () => 99),
  );
  const current = m5Day(
    "2026-07-07T13:30:00.000Z",
    Array.from({ length: 20 }, (_, index) => 100 + index * 0.5),
  );
  return {
    instruments: ["ZW"],
    agriCalendarCoverage: [grainsCalendarFixture()],
    rowsBySymbol: {
      "ZW1!:5": [...prior, ...current],
      "ZW1!:1": warmupM1Prefix(),
    },
    ...extra,
  };
}

function warmupM1Prefix() {
  return Array.from({ length: 65 }, (_, index) =>
    m1(plusMinutes("2026-07-07T13:30:00.000Z", index), 100, 100.5, 99.5),
  );
}

function m5Day(startUtc, prices) {
  return prices.map((price, index) =>
    m1(plusMinutes(startUtc, index * 5), price, price + 0.75, price - 0.25),
  );
}

function m1(timestampUtc, open, high, low) {
  return {
    timestamp_utc: timestampUtc,
    timeframe: "1",
    is_closed: true,
    open,
    high,
    low,
    close: open,
    volume: 10,
  };
}

function plusMinutes(timestampUtc, minutes) {
  return new Date(Date.parse(timestampUtc) + minutes * 60_000).toISOString();
}
