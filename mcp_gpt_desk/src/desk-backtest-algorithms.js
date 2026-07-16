import { SystemClock } from "@tv-automation/desk-time";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { stableVNextId } from "./desk-ids.js";
import { publicReplayError, roundNumber } from "./desk-market-feature-algorithms.js";
import { sanitizeId } from "./desk-replay-orchestration-algorithms.js";
import { hasReplayGeometry } from "./desk-strategy-audit-algorithms.js";

const COLLECTIONS = DESK_COLLECTIONS;

export function selectBacktestCandidateSetups(docs, {
  date_from,
  date_to,
  session = "asia_open",
  instrument_mode = "auto",
  limit = 200,
} = {}) {
  const instrumentFilter = instrument_mode && instrument_mode !== "auto" ? instrument_mode : null;
  return (docs || [])
    .filter((setup) => !date_from || String(setup.date || "") >= date_from)
    .filter((setup) => !date_to || String(setup.date || "") <= date_to)
    .filter((setup) => !session || setup.session === session)
    .filter((setup) => !instrumentFilter || setup.instrument === instrumentFilter)
    .filter((setup) => setup.replayable === true || hasReplayGeometry(setup))
    .filter((setup) => setup.instrument !== "WAIT" && setup.direction !== "wait")
    .sort((left, right) => {
      const leftDate = String(left.date || left.saved_at || left.created_at || "");
      const rightDate = String(right.date || right.saved_at || right.created_at || "");
      if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
      return Number(left.priority || 999) - Number(right.priority || 999);
    })
    .slice(0, Math.max(1, Math.min(Number(limit) || 200, 500)));
}

export function buildBacktestRunDoc(args, setups, tick) {
  const backtest_id = args.backtest_id || stableVNextId("backtest", `${args.date_from}_${args.date_to}`, `${args.session || "asia_open"}_${tick.utc}`);
  return {
    backtest_id,
    label: args.label || `${args.date_from} -> ${args.date_to} ${args.session || "asia_open"}`,
    date_from: args.date_from,
    date_to: args.date_to,
    session: args.session || "asia_open",
    instrument_mode: args.instrument_mode || "auto",
    master_contract: args.master_contract || "4.0.0",
    monitor_contract: args.monitor_contract || "1.0.0",
    monitor_cadence: args.monitor_cadence || "1h",
    mode: args.mode || "backforward_strict",
    risk_model: args.risk_model || "0.5pct_fixed",
    status: setups.length ? "QUEUED" : "DONE",
    steps_total: setups.length,
    steps_done: 0,
    trades_count: 0,
    source_collection: COLLECTIONS.deskSetups,
    source_setup_ids: setups.map((setup) => setup.setup_record_id),
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function buildBacktestStepDoc(run, setup, index, tick) {
  const step_id = `${run.backtest_id}_step_${String(index + 1).padStart(4, "0")}_${sanitizeId(setup.setup_record_id)}`;
  return {
    step_id,
    backtest_id: run.backtest_id,
    sequence: index + 1,
    status: "QUEUED",
    job_type: "SIMULATE_TRADE",
    task_type: "SIMULATE_TRADE",
    date: setup.date || null,
    session: setup.session || run.session,
    instrument: setup.instrument || null,
    direction: setup.direction || null,
    source_setup_id: setup.setup_record_id,
    source_setup_ref: { collection: COLLECTIONS.deskSetups, document_id: setup.setup_record_id },
    input_ref: { collection: COLLECTIONS.deskSetups, document_id: setup.setup_record_id },
    output_ref: null,
    pack_id: setup.pack_id || null,
    analysis_id: setup.analysis_id || null,
    decision_id: setup.decision_id || null,
    timestamp_paris: setup.created_at_paris || setup.saved_at_paris || tick.paris,
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function markBacktestStepRunning(step, tick) {
  return {
    ...step,
    status: "RUNNING",
    started_at: tick.utc,
    started_at_utc: tick.utc,
    started_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function markBacktestStepDone(step, { output_ref, replay }, tick) {
  return {
    ...step,
    status: "DONE",
    output_ref,
    replay_status: replay?.replay_status || null,
    r_result: replay?.r_result ?? null,
    completed_at: tick.utc,
    completed_at_utc: tick.utc,
    completed_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function markBacktestStepFailed(step, error, tick) {
  return {
    ...step,
    status: "FAILED",
    error: publicReplayError(error),
    completed_at: tick.utc,
    completed_at_utc: tick.utc,
    completed_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function simulatedTradeFromReplay({ replay, run, step, setup, tick }) {
  const trade_id = `${run.backtest_id}_${sanitizeId(step.source_setup_id)}_${sanitizeId(replay.replay_id || replay.content_hash || tick.utc)}`;
  return {
    trade_id,
    backtest_id: run.backtest_id,
    step_id: step.step_id,
    setup_record_id: setup.setup_record_id,
    setup_id: setup.setup_id || null,
    analysis_id: setup.analysis_id || null,
    decision_id: setup.decision_id || null,
    pack_id: setup.pack_id || null,
    date: setup.date || step.date || null,
    session: setup.session || run.session,
    instrument: setup.instrument || replay.instrument || null,
    direction: setup.direction || replay.direction || null,
    status: replayOutcomeToTradeOutcome(replay),
    replay_status: replay.replay_status || null,
    outcome: replay.outcome || null,
    outcome_status: replay.outcome_status || null,
    r_result: Number.isFinite(Number(replay.r_result)) ? roundNumber(Number(replay.r_result), 4) : null,
    max_favorable_r: Number.isFinite(Number(replay.max_favorable_r)) ? roundNumber(Number(replay.max_favorable_r), 4) : null,
    entry_price: replay.entry?.price ?? replay.plan?.entry_price ?? null,
    entry_time: replay.entry?.time ?? null,
    exit_price: replay.exit?.price ?? replay.evidence?.exit_price ?? null,
    exit_time: replay.exit?.time ?? replay.evidence?.exit_timestamp ?? null,
    reason: replay.reason || null,
    content_hash: replay.content_hash || null,
    replay,
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function replayOutcomeToTradeOutcome(replay) {
  const status = String(replay?.replay_status || "");
  if (status === "win") return "WIN";
  if (status === "loss") return "LOSS";
  if (status === "no_fill") return "NO_FILL";
  if (status === "wait") return "WAIT";
  if (["no_data", "not_replayable", "rejected", "review_required"].includes(status)) return "REVIEW";
  return "OPEN_OR_EXPIRED";
}

export function updateBacktestProgress(run, steps, trades, tick) {
  const steps_done = (steps || []).filter((step) => ["DONE", "FAILED"].includes(step.status)).length;
  const hasFailed = (steps || []).some((step) => step.status === "FAILED");
  const allDone = Number(run.steps_total || 0) > 0 && steps_done >= Number(run.steps_total || 0);
  const summary = allDone || hasFailed ? summarizeBacktestTrades(trades, { backtest_id: run.backtest_id, tick }) : run.summary || null;
  return {
    ...run,
    status: hasFailed ? "FAILED" : allDone ? "DONE" : "RUNNING",
    steps_done,
    trades_count: (trades || []).length,
    summary,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function finalizeBacktestRun(run, steps, trades, tick) {
  const summary = summarizeBacktestTrades(trades, { backtest_id: run.backtest_id, tick });
  return {
    ...run,
    status: (steps || []).some((step) => step.status === "FAILED") ? "FAILED" : "DONE",
    steps_done: (steps || []).filter((step) => ["DONE", "FAILED"].includes(step.status)).length,
    trades_count: (trades || []).length,
    summary,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
    completed_at: tick.utc,
    completed_at_utc: tick.utc,
    completed_at_paris: tick.paris,
  };
}

export function summarizeBacktestTrades(trades, { backtest_id, tick } = {}) {
  const list = trades || [];
  const numericResults = list.map((trade) => Number(trade.r_result)).filter(Number.isFinite);
  const total_r = roundNumber(numericResults.reduce((sum, value) => sum + value, 0), 4);
  const wins = list.filter((trade) => Number(trade.r_result) > 0).length;
  const losses = list.filter((trade) => Number(trade.r_result) < 0).length;
  const no_fills = list.filter((trade) => trade.status === "NO_FILL" || trade.replay_status === "no_fill").length;
  const inferredBacktestId = backtest_id || list[0]?.backtest_id || null;
  const updated = tick || new SystemClock().now();
  return {
    result_id: inferredBacktestId ? `${inferredBacktestId}_summary` : null,
    backtest_id: inferredBacktestId,
    trades: list.length,
    wins,
    losses,
    no_fills,
    total_r,
    avg_r: numericResults.length ? roundNumber(total_r / numericResults.length, 4) : 0,
    win_rate: list.length ? roundNumber(wins / list.length, 4) : null,
    summary_stats: {
      total_r,
      trades: list.length,
      win_rate: list.length ? roundNumber(wins / list.length, 4) : null,
    },
    updated_at: updated.utc,
    updated_at_utc: updated.utc,
    updated_at_paris: updated.paris,
  };
}

export function selectBacktests(docs, { date_from, date_to, session, status, limit = 50 } = {}) {
  const backtests = (docs || [])
    .filter((run) => !date_from || String(run.date_to || run.date_from || "") >= date_from)
    .filter((run) => !date_to || String(run.date_from || run.date_to || "") <= date_to)
    .filter((run) => !session || run.session === session)
    .filter((run) => !status || run.status === status)
    .sort((left, right) => String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || "")))
    .slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)));
  return { ok: true, count: backtests.length, backtests };
}

export function selectBacktest(backtests, backtestId) {
  if (backtestId) {
    return (backtests || []).find((run) => run.backtest_id === backtestId) || null;
  }
  return (backtests || [])[0] || null;
}

export function selectSimulatedTrades(docs, backtestId) {
  return (docs || [])
    .filter((trade) => trade.backtest_id === backtestId)
    .sort((left, right) => String(left.trigger_time || left.created_at || "").localeCompare(String(right.trigger_time || right.created_at || "")));
}

export function selectBacktestResults(docs, backtestId) {
  return (docs || [])
    .filter((result) => result.backtest_id === backtestId)
    .sort((left, right) => String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || "")));
}

export function summarizeReplayState(backtest, trades, results) {
  const latestResult = results[0] || null;
  if (latestResult?.summary_stats) {
    return latestResult.summary_stats;
  }
  const totalR = (trades || []).reduce((sum, trade) => sum + (Number(trade.r_result) || 0), 0);
  const wins = (trades || []).filter((trade) => Number(trade.r_result) > 0).length;
  return {
    total_r: backtest?.result?.total_r ?? backtest?.summary?.total_r ?? totalR,
    trades: backtest?.result?.trades ?? trades.length,
    win_rate: trades.length ? wins / trades.length : backtest?.result?.win_rate ?? null,
  };
}
