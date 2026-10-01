import { batchDays, requireFact, STAGES } from "./batch-contract.js";

export function premarketPeriod({ scope, startDate, endDate, requestedConcurrency = 1 }) {
  requireFact(Number.isInteger(requestedConcurrency) && requestedConcurrency >= 1 && requestedConcurrency <= 3, "CAPTURE_CONCURRENCY_INVALID");
  const calendar = batchDays({ ...scope, from: startDate, to: endDate });
  const days = calendar.filter(day => ![0, 6].includes(new Date(`${day.date}T00:00:00Z`).getUTCDay()));
  return { days, skipped_dates: calendar.filter(day => !days.includes(day)).map(day => day.date),
    start_date: startDate, end_date: endDate, requested_concurrency: requestedConcurrency,
    concurrency: 1, concurrency_reason: "SINGLE_TRADINGVIEW_SESSION" };
}

export function hasPremarket(row) {
  return row?.capture_count === 8 && !!row.manifest_sha256
    && STAGES.indexOf(row.checkpoint) >= STAGES.indexOf("PREMARKET_READY");
}

export function projectPreparationDay(row, queue = {}) {
  const replay = queue.replay?.has(row.day) ? "REPLAY_QUEUED"
    : ["REPLAYING", "CAPTURING_RESULTS", "COMPLETED"].includes(row.state) ? row.state : "NOT_REQUESTED";
  return { date: row.day, state: row.state, checkpoint: row.checkpoint, capture_count: row.capture_count,
    manifest_sha256: row.manifest_sha256, plan_sha256: row.plan_sha256, replay_status: replay,
    queue_status: queue.capture?.has(row.day) ? "QUEUED_OR_RUNNING" : "NOT_QUEUED",
    error: row.error ? { code: row.error.code } : null, updated_at: row.updated_at };
}

export function preparationCounts(rows) {
  const ready = rows.filter(hasPremarket).length;
  const failed = rows.filter(row => !hasPremarket(row) && row.state.startsWith("FAILED")).length;
  return { total_days: rows.length, ready, failed, queued: rows.length - ready - failed,
    completed: rows.filter(row => row.state === "COMPLETED").length,
    premarket_ready: rows.filter(row => row.state === "PREMARKET_READY").length,
    next_waiting_scenario: rows.find(row => hasPremarket(row) && !row.plan_sha256)?.day ?? null };
}

export function preparationStatus({ rows, commandStatus }) {
  const counts = preparationCounts(rows);
  if (counts.ready === counts.total_days) return "COMPLETED";
  if (commandStatus !== "COMPLETED") return "RUNNING";
  return counts.ready > 0 ? "PARTIAL" : "FAILED";
}

export function preparationFilters(filters) {
  const { batch_id, month, start_date, end_date } = filters;
  requireFact(Object.keys(filters).every(key => ["batch_id", "month", "start_date", "end_date"].includes(key)), "BATCH_FILTER_INVALID");
  const selectors = [batch_id, month, start_date || end_date].filter(Boolean);
  requireFact(selectors.length <= 1 && !!start_date === !!end_date, "BATCH_FILTER_INVALID");
  if (month) requireFact(/^2026-(07|08)$/.test(month), "MONTH_INVALID");
  if (batch_id) requireFact(/^premarket-[a-f0-9]{40}$/.test(batch_id), "BATCH_ID_INVALID");
  return { batchId: batch_id, startDate: start_date || (month ? `${month}-01` : "2026-07-01"),
    endDate: end_date || (month === "2026-07" ? "2026-07-31" : "2026-08-31") };
}
