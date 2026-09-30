const METRICS = ["net_r", "net_usd", "fills", "wins", "losses", "mfe_p", "mfe_n", "mae", "duration",
  "time_to_mfe", "giveback", "rearm", "fallback_1m", "fallback_15m", "event_count", "dropped_events"];
export function projectDay(row) {
  const actions = row.state === "COMPLETED" ? [] : row.state === "FAILED_PLAN_VALIDATION" ? ["new-plan"]
    : row.state === "FAILED_TECHNICAL" ? ["retry"] : row.state === "NEW" || row.state === "CAPTURING" ? ["capture"]
      : ["PREMARKET_READY", "WAITING_SCENARIO", "PLAN_RECEIVED", "VALIDATING_PLAN"].includes(row.state) ? ["scenario"] : ["replay"];
  return { ...row, allowed_actions: actions, metrics: Object.fromEntries(METRICS.map(key =>
    [key, typeof row.audit?.[key] === "number" && Number.isFinite(row.audit[key]) ? row.audit[key] : null])) };
}

export function aggregateBatch(rows) {
  const completed = rows.filter(row => row.state === "COMPLETED" && row.sample_purpose !== "TECHNICAL_SMOKE").map(projectDay);
  const metrics = Object.fromEntries(METRICS.map(key => {
    const values = completed.map(row => row.metrics[key]).filter(value => value !== null).sort((a, b) => a - b);
    const sum = values.reduce((total, value) => total + value, 0), middle = Math.floor(values.length / 2);
    return [key, { observed_days: values.length, total_days: completed.length,
      sum: values.length ? sum : null, mean: values.length ? sum / values.length : null,
      median: values.length ? (values[middle] + values[Math.floor((values.length - 1) / 2)]) / 2 : null }];
  }));
  return { days: rows.length, completed: rows.filter(row => row.state === "COMPLETED").length,
    statistical_days: completed.length, technical_smoke_days: rows.filter(row => row.sample_purpose === "TECHNICAL_SMOKE").length, metrics };
}
