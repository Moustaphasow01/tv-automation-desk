import {
  replayUsGrainsStrategySuiteV2,
  usGrainsSessionCloseUtc,
} from "./us-grains-strategy-suite.js";
import { simulateGrainSignalTheoreticalOutcome } from "./us-grains-theoretical-replay.js";

export const US_GRAINS_CONTEXT_THEORETICAL_REPLAY_VERSION =
  "us_grains_context_theoretical_replay_v1";
export const CONTEXT_ONLY_HUMAN_GATE =
  "CONTEXT_ONLY_NOT_PORTFOLIO_RISK_HUMAN_GATE";

export function replayUsGrainsContextTheoretical({
  rowsBySymbol = {},
  agriEvents = [],
  instruments,
  startDate,
  endDate,
  asOfUtc,
  policy,
} = {}) {
  const suite = replayUsGrainsStrategySuiteV2({
    rowsBySymbol,
    agriEvents,
    instruments,
    startDate,
    endDate,
    asOfUtc,
  });
  const outcomes = suite.accepted_signals.map((signal) =>
    simulateGrainSignalTheoreticalOutcome({
      signal,
      executionRows: executionRowsFor({
        rowsBySymbol,
        instrument: signal.instrument,
      }),
      asOfUtc,
      sessionCloseUtc: usGrainsSessionCloseUtc(signal.generated_at_utc),
      policy,
    }),
  );
  return {
    schema_version: US_GRAINS_CONTEXT_THEORETICAL_REPLAY_VERSION,
    report_title: CONTEXT_ONLY_HUMAN_GATE,
    replay_status: CONTEXT_ONLY_HUMAN_GATE,
    simulation_constraints: {
      portfolio_risk_evaluated: false,
      cooldown_applied: false,
      netting_applied: false,
      tradable: false,
      human_gate_required: true,
    },
    context: {
      source_suite_simulation_status: suite.simulation_status,
      raw_signal_count: suite.raw_signal_count,
      context_accepted_count: suite.context_accepted_count,
      context_rejected_count: suite.context_rejected_count,
      context_wait_count: suite.context_wait_count,
      simulated_signal_count: outcomes.length,
    },
    raw_signals: suite.raw_signals,
    context_decisions: suite.context_decisions,
    accepted_signals: suite.accepted_signals,
    theoretical_outcomes: outcomes,
    outcome_counts: outcomeCounts(outcomes),
    closed_r: {
      interpretation: "THEORETICAL_CLOSED_OUTCOMES_NOT_TRADABLE",
      ...closedRAggregate(outcomes),
    },
    skipped_days: suite.skipped_days,
  };
}

function executionRowsFor({ rowsBySymbol, instrument }) {
  const expected = `${String(instrument || "").toUpperCase()}1!:1`;
  return Object.entries(rowsBySymbol || {})
    .filter(([symbol]) => String(symbol).toUpperCase() === expected)
    .flatMap(([, rows]) => (Array.isArray(rows) ? rows : []));
}

function outcomeCounts(outcomes) {
  const result = {
    total: outcomes.length,
    closed: 0,
    open: 0,
    unknown: 0,
    expired_no_fill: 0,
  };
  for (const outcome of outcomes) {
    if (["TARGET_HIT", "STOP_HIT"].includes(outcome.status)) result.closed += 1;
    else if (outcome.status === "OPEN") result.open += 1;
    else if (outcome.status === "EXPIRED_NO_FILL") result.expired_no_fill += 1;
    else result.unknown += 1;
  }
  return result;
}

function closedRAggregate(outcomes) {
  const closed = outcomes.filter((outcome) =>
    ["TARGET_HIT", "STOP_HIT"].includes(outcome.status),
  );
  const values = closed
    .map((outcome) => outcome.r_result)
    .filter(Number.isFinite);
  if (!values.length)
    return {
      status: closed.length ? "CLOSED_R_UNAVAILABLE" : "NONE_CLOSED_OUTCOMES",
      closed_count: closed.length,
      r_result_count: 0,
      total_r: null,
      average_r: null,
    };
  const total = round(values.reduce((sum, value) => sum + value, 0));
  return {
    status: "OBSERVED_CLOSED_OUTCOMES_ONLY",
    closed_count: closed.length,
    r_result_count: values.length,
    total_r: total,
    average_r: round(total / values.length),
  };
}

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}
