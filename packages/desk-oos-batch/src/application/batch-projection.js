import { isUnscorableMarketGap, projectSessionCoverage } from "../domain/market-session-exhaustion.js";

const METRICS = ["net_r", "net_usd", "fills", "wins", "losses", "mfe_p", "mfe_n", "mae", "duration",
  "time_to_mfe", "giveback", "rearm", "fallback_1m", "fallback_15m", "event_count", "dropped_events"];
const ACTIONS = { COMPLETED: [], FAILED_PLAN_VALIDATION: ["new-plan"], FAILED_TECHNICAL: ["retry"],
  NEW: ["capture"], CAPTURING: ["capture"], PREMARKET_READY: ["scenario"], WAITING_SCENARIO: ["scenario"],
  PLAN_RECEIVED: ["scenario"], VALIDATING_PLAN: ["scenario"] };
export function projectDay(row) {
  const actions = [...(ACTIONS[row.state] ?? ["replay"])];
  return { ...row, ...(isUnscorableMarketGap(row) ? { audit: null } : {}), ...projectSessionCoverage(row), allowed_actions: actions, metrics: Object.fromEntries(METRICS.map(key =>
    [key, !isUnscorableMarketGap(row) && typeof row.audit?.[key] === "number" && Number.isFinite(row.audit[key]) ? row.audit[key] : null])) };
}

export function aggregateBatch(rows) {
  const completed = rows.filter(row => row.state === "COMPLETED" && !isUnscorableMarketGap(row)
    && row.sample_purpose !== "TECHNICAL_SMOKE").map(projectDay);
  const metrics = Object.fromEntries(METRICS.map(key => {
    const values = completed.map(row => row.metrics[key]).filter(value => value !== null).sort((a, b) => a - b);
    const sum = values.reduce((total, value) => total + value, 0), middle = Math.floor(values.length / 2);
    return [key, { observed_days: values.length, total_days: completed.length,
      sum: values.length ? sum : null, mean: values.length ? sum / values.length : null,
      median: values.length ? (values[middle] + values[Math.floor((values.length - 1) / 2)]) / 2 : null }];
  }));
  return { days: rows.length, completed: rows.filter(row => row.state === "COMPLETED").length,
    statistical_days: completed.length,
    UNSCORABLE_MARKET_GAP_DAYS: rows.filter(row => row.state === "COMPLETED" && isUnscorableMarketGap(row)).length,
    technical_smoke_days: rows.filter(row => row.sample_purpose === "TECHNICAL_SMOKE").length, metrics };
}
