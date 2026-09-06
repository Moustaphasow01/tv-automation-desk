import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Aggregate only canonical replay outcomes; never re-simulate a fill or a Risk decision.
export function compareGrainsRiskReplays(baseline, candidate) {
  const rawIds = artifact => artifact.report.ledger.signals.map(row => row.signal_id).sort();
  return {
    schema_version: "grains_risk_replay_comparison_v1",
    input_identical: baseline.input.sha256 === candidate.input.sha256,
    code_identical: JSON.stringify(baseline.code_hashes) === JSON.stringify(candidate.code_hashes),
    raw_signal_ids_identical: JSON.stringify(rawIds(baseline)) === JSON.stringify(rawIds(candidate)),
    raw_signal_payloads_identical: Boolean(baseline.replay_bootstrap.detected_signals_sha256)
      && baseline.replay_bootstrap.detected_signals_sha256 === candidate.replay_bootstrap.detected_signals_sha256,
    baseline: summarize(baseline), candidate: summarize(candidate),
    authority: "CANONICAL_LOCAL_SHADOW_THEORY_NOT_BROKER_PNL",
    limitations: ["Official calendar reconstructed, not proof of historical VPS receipt",
      "UTC reporting periods", "Closed R are summed trade R, not return on account capital",
      "Stop-risk caps are not guaranteed physical losses after gaps, slippage and costs"],
  };
}

function summarize(artifact) {
  const ledger = artifact.report.ledger;
  const outcomes = ledger.outcomes.filter(row => row.status === "final")
    .sort((a, b) => `${a.finalized_at_utc}:${a.trade_id}`.localeCompare(`${b.finalized_at_utc}:${b.trade_id}`));
  const rejected = ledger.portfolio.flatMap(run => run.payload.allocation_plan?.rejected_signals || []);
  const approved = ledger.risk.filter(row => ["PASS", "REDUCE"].includes(row.status));
  return {
    policy: artifact.source_provenance.runtime_policy, raw_signals: ledger.signals.length,
    context: count(ledger.context, row => row.decision),
    portfolio_rejected_signals: new Set(rejected.map(row => row.signal_id)).size,
    portfolio_reasons: count(rejected.flatMap(row => row.issues || []), row => row.code),
    risk_decisions: ledger.risk.length, risk_approved: approved.length,
    risk_rejected: ledger.risk.filter(row => row.status === "BLOCK").length,
    risk_reasons: count(ledger.risk.flatMap(row => row.payload.reason_codes || []), row => row),
    targets: ledger.targets.length, order_intents: ledger.intents.length, human_gates: ledger.human_gates.length,
    qualified_signal_count: new Set(ledger.targets.flatMap(row => row.lineage.strategy_signal_ids || [])).size,
    theoretical_trades: ledger.trades.length, final_outcomes: outcomes.length,
    theoretical_events: count(ledger.theoretical_events, row => row.event_type),
    open_trades_at_cutoff: ledger.trades.filter(row => row.status !== "closed").length,
    closed_r: sum(outcomes, "result_r"), closed_net_pnl: sum(outcomes, "net_realized_pnl"),
    fees: sum(outcomes, "total_fees"), max_closed_drawdown_r: drawdown(outcomes, "result_r"),
    max_closed_drawdown_monetary: drawdown(outcomes, "net_realized_pnl"),
    provider_commands: artifact.report.provider_commands,
    days: summarizeDays(ledger, outcomes),
    risk_sizing: approved.map(row => ({ risk_decision_id: row.risk_decision_id, instrument: row.payload.instrument,
      requested_size: row.payload.requested_size, approved_size: row.payload.approved_size,
      sizing: row.payload.sizing, authorized: row.payload.authorized })),
  };
}

function summarizeDays(ledger, outcomes) {
  const dates = [...new Set(ledger.signals.map(row => row.generated_at_utc.slice(0, 10)))].sort();
  const dateForSignal = new Map(ledger.signals.map(row => [row.signal_id, row.generated_at_utc.slice(0, 10)]));
  return dates.map(date => ({
    date, raw_signals: ledger.signals.filter(row => dateForSignal.get(row.signal_id) === date).length,
    context: count(ledger.context.filter(row => dateForSignal.get(row.signal_id) === date), row => row.decision),
    order_intents: ledger.intents.filter(row => row.payload.requested_at_utc?.startsWith(date)).length,
    trades_opened: ledger.trades.filter(row => row.opened_at?.startsWith(date)).length,
    final_outcomes: outcomes.filter(row => row.finalized_at_utc.startsWith(date)).length,
    closed_r: sum(outcomes.filter(row => row.finalized_at_utc.startsWith(date)), "result_r"),
    closed_net_pnl: sum(outcomes.filter(row => row.finalized_at_utc.startsWith(date)), "net_realized_pnl"),
    events: count(ledger.theoretical_events.filter(row => row.event_at_utc.startsWith(date)), row => row.event_type),
  }));
}

function count(rows, key) {
  return rows.reduce((result, row) => { const name = key(row); result[name] = (result[name] || 0) + 1; return result; }, {});
}
function numeric(value) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) throw new Error("CANONICAL_OUTCOME_NUMBER_UNAVAILABLE");
  return Number(value);
}
function sum(rows, key) { return round(rows.reduce((total, row) => total + numeric(row[key]), 0)); }
function drawdown(rows, key) {
  let equity = 0, peak = 0, maximum = 0;
  for (const row of rows) { equity += numeric(row[key]); peak = Math.max(peak, equity); maximum = Math.max(maximum, peak - equity); }
  return round(maximum);
}
function round(value) { return Math.round(value * 10000) / 10000; }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [baselinePath, candidatePath, outputPath] = process.argv.slice(2);
  if (!baselinePath || !candidatePath || !outputPath) throw new Error("BASELINE_CANDIDATE_OUTPUT_PATHS_REQUIRED");
  if ([baselinePath, candidatePath].some(path => resolve(path) === resolve(outputPath))) throw new Error("OUTPUT_MUST_NOT_OVERWRITE_REPLAY");
  const [baseline, candidate] = await Promise.all([baselinePath, candidatePath].map(async path => JSON.parse(await readFile(path, "utf8"))));
  const result = compareGrainsRiskReplays(baseline, candidate);
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: outputPath, comparable: result.input_identical && result.code_identical && result.raw_signal_payloads_identical })}\n`);
}
