import { requireFact } from "./batch-contract.js";

export const UNSCORABLE_MARKET_GAP = "UNSCORABLE_MARKET_GAP";
export const SESSION_COVERAGE_PATH = "evidence/market-session-exhausted.json";

/** Coverage proof only: no candle synthesis, session-clock mutation or ENGINE metrics. */
export function proveMarketSessionExhaustion({ day, meta, details }) {
  const gap = details?.native_gap, scope = details?.tv_replay_state?.immutable_scope;
  const end = `${day.date}T20:00:00+02:00`, last = details?.observed_bar_close;
  requireFact(details?.stage === "REPLAYING" && details.timeframe === "15"
    && gap?.source === "TradingView native bars() consecutive indices", "MARKET_GAP_NATIVE_PROOF_REQUIRED");
  assertCoverageScope({ day, meta, scope, end });
  assertNativeGapEndpoints({ details, day, end });
  return { market_session_exhausted: true, last_native_bar_close: last,
    next_native_bar_open: gap.next_native_bar_open, market_gap_start: last,
    market_gap_end: new Date(end).toISOString(), session_end: end,
    proof_source: gap.source, native_gap: gap, immutable_scope: scope };
}

function assertCoverageScope({ day, meta, scope, end }) {
  requireFact(scope, "MARKET_GAP_SCOPE_MISMATCH");
  const matches = [scope.date === day.date, scope.symbol === day.symbol,
    scope.plan_sha256 === meta.plan_sha256, scope.manifest_sha256 === meta.premarket_manifest_sha256,
    scope.engine_version === day.engine_version, scope.book_mode === day.book_mode,
    scope.cutoff === new Date(day.cutoff).toISOString(), scope.session_end === new Date(end).toISOString(),
    scope.execution_timeframe === "15m"];
  requireFact(matches.every(Boolean), "MARKET_GAP_SCOPE_MISMATCH");
}

function assertNativeGapEndpoints({ details, day, end }) {
  const gap = details.native_gap, previous = Date.parse(gap.previous_confirmed_bar);
  const next = Date.parse(gap.next_native_bar_open), last = Date.parse(details.observed_bar_close);
  const proved = [Number.isFinite(previous), Number.isFinite(next),
    details.observed_bar_open === gap.previous_confirmed_bar,
    Date.parse(details.last_confirmed_bar_time) === previous, last === previous + 900000,
    Date.parse(gap.expected_next_bar_open) === last, last >= Date.parse(day.cutoff), last < Date.parse(end),
    next >= Date.parse(end), next > last];
  requireFact(proved.every(Boolean), "MARKET_SESSION_NOT_EXHAUSTED");
}

/** Read frozen GAP records without interpreting scenarios or changing the parser. */
export function frozenPlanHasMatchingGap(planText, coverage) {
  return planText.split(";").some(record => {
    const fields = record.split("|").map(value => value.trim());
    if (fields[0] !== "GAP" || fields.length !== 6) return false;
    const start = Date.parse(`${fields[1]}T${fields[2]}:00+02:00`);
    const end = Date.parse(`${fields[3]}T${fields[4]}:00+02:00`);
    return start <= Date.parse(coverage.market_gap_start) && end >= Date.parse(coverage.market_gap_end);
  });
}

export function unscorableSessionReceipt({ day, meta, coverage, completedAt }) {
  return { schema_version: "oos-session-coverage/1", ...day,
    plan_sha256: meta.plan_sha256, premarket_manifest_sha256: meta.premarket_manifest_sha256,
    result_classification: UNSCORABLE_MARKET_GAP, reason: "UNDECLARED_MARKET_SESSION_GAP",
    scorable: false, frozen_plan: true, replay_attempted: true, frozen_plan_has_matching_gap: false,
    recalculated: false, source: "NATIVE_MARKET_SESSION_COVERAGE", completed_at: completedAt, ...coverage };
}

export function isUnscorableMarketGap(row) {
  return (row?.run_meta?.result_classification ?? row?.result_classification) === UNSCORABLE_MARKET_GAP;
}

export function projectSessionCoverage(row) {
  if (row.state !== "COMPLETED" || !row.plan_sha256 || !isUnscorableMarketGap(row)) return {};
  const meta = row.run_meta ?? row;
  return { result_classification: meta.result_classification, scorable: false,
    frozen_plan: !!row.plan_sha256, replay_attempted: true, market_session_exhausted: true,
    reason: meta.reason, last_native_bar_close: meta.last_native_bar_close,
    next_native_bar_open: meta.next_native_bar_open, market_gap_start: meta.market_gap_start,
    market_gap_end: meta.market_gap_end, recalculated: false };
}
