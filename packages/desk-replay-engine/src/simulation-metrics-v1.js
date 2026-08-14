export const SIMULATION_METRIC_SCHEMA_VERSION_V1 = "canonical_simulation_metrics_v1";
export const SIMULATION_METRIC_DEFINITION_ID_V2 = "desk_simulation_metrics_core_v2";
export const SIMULATION_METRIC_VERSION_V2 = "2.0.0";

export function buildVersionedSimulationMetricsV1(positions = [], context = {}) {
  const rows = normalizeRows(context.rows);
  const enriched = normalizePositions(positions).map((position) => enrichPositionExcursions(position, rows));
  const closed = enriched.filter((position) => position.status === "CLOSED");
  const results = closed.map((position) => number(position.r_result)).filter((value) => value !== null);
  const equity = cumulative(results);
  const segmentations = buildSegmentations(closed);
  return {
    schema_version: SIMULATION_METRIC_SCHEMA_VERSION_V1,
    metric_definition_id: SIMULATION_METRIC_DEFINITION_ID_V2,
    metric_version: SIMULATION_METRIC_VERSION_V2,
    trade_count: closed.length,
    open_position_count: enriched.filter((position) => position.status === "OPEN").length,
    total_r: round(sum(results)),
    gross_r: round(sum(closed.map((position) => number(position.gross_r)).filter((value) => value !== null))),
    execution_cost_r: round(sum(closed.map((position) => number(position.execution_cost_r)).filter((value) => value !== null))),
    win_count: results.filter((value) => value > 0).length,
    loss_count: results.filter((value) => value < 0).length,
    win_rate: ratio(results.filter((value) => value > 0).length, closed.length),
    profit_factor: profitFactor(results),
    expectancy_r: average(results),
    average_win_r: average(results.filter((value) => value > 0)),
    average_loss_r: average(results.filter((value) => value < 0)),
    max_drawdown_r: maxDrawdown(equity),
    sharpe_r: sharpe(results),
    sortino_r: sortino(results),
    calmar_r: calmar(sum(results), maxDrawdown(equity)),
    mae_r: excursionMetric(enriched, "mae_r", "average"),
    mfe_r: excursionMetric(enriched, "mfe_r", "average"),
    max_adverse_excursion_r: excursionMetric(enriched, "mae_r", "min"),
    max_favorable_excursion_r: excursionMetric(enriched, "mfe_r", "max"),
    exposure: exposure(enriched, rows),
    segmentations,
    final_equity_r: round(sum(results)),
  };
}

export function metricSegmentSummaryV1(positions = []) {
  const closed = normalizePositions(positions).filter((position) => position.status === "CLOSED");
  const results = closed.map((position) => number(position.r_result)).filter((value) => value !== null);
  return {
    trade_count: closed.length,
    total_r: round(sum(results)),
    win_rate: ratio(results.filter((value) => value > 0).length, closed.length),
    profit_factor: profitFactor(results),
    max_drawdown_r: maxDrawdown(cumulative(results)),
    expectancy_r: average(results),
  };
}

function buildSegmentations(positions) {
  return {
    by_instrument: mapSegments(positions, (position) => position.instrument || "UNKNOWN"),
    by_direction: mapSegments(positions, (position) => position.direction || "unknown"),
    by_session: mapSegments(positions, (position) => position.session || inferSession(position.entry_time)),
    by_date: mapSegments(positions, (position) => datePart(position.entry_time)),
    by_exit_reason: mapSegments(positions, (position) => position.exit_reason || position.status || "UNKNOWN"),
  };
}

function mapSegments(positions, selector) {
  const buckets = new Map();
  for (const position of positions) {
    const key = String(selector(position) || "UNKNOWN");
    buckets.set(key, [...(buckets.get(key) || []), position]);
  }
  return Object.fromEntries([...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, items]) => [key, metricSegmentSummaryV1(items)]));
}

function enrichPositionExcursions(position, rows) {
  const suppliedMae = number(position.mae_r);
  const suppliedMfe = number(position.mfe_r);
  const excursion = computeExcursion(position, rows);
  return {
    ...position,
    mae_r: suppliedMae === null ? excursion.mae_r : suppliedMae,
    mfe_r: suppliedMfe === null ? excursion.mfe_r : suppliedMfe,
    exposure_bars: number(position.exposure_bars) === null ? excursion.exposure_bars : number(position.exposure_bars),
  };
}

function computeExcursion(position, rows) {
  const scoped = positionRows(position, rows);
  const entry = number(position.entry_price);
  const risk = number(position.risk_points);
  if (entry === null || risk === null || risk === 0 || scoped.length === 0) return { mae_r: null, mfe_r: null, exposure_bars: scoped.length };
  const direction = String(position.direction || "long").toLowerCase();
  const favorable = scoped.map((row) => direction === "short" ? entry - number(row.low) : number(row.high) - entry).filter(finite);
  const adverse = scoped.map((row) => direction === "short" ? number(row.high) - entry : entry - number(row.low)).filter(finite);
  return { mae_r: round(-Math.max(0, ...adverse) / risk), mfe_r: round(Math.max(0, ...favorable) / risk), exposure_bars: scoped.length };
}

function positionRows(position, rows) {
  const from = time(position.entry_time);
  const to = time(position.exit_time || position.mark_time);
  return rows.filter((row) => sameInstrument(row, position) && inRange(time(row.time), from, to));
}

function exposure(positions, rows) {
  const bars = sum(positions.map((position) => number(position.exposure_bars)).filter((value) => value !== null));
  return { bars, ratio: ratio(bars, rows.length) };
}

function normalizeRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({ ...row, time: row.time || row.timestamp_paris || row.timestamp }));
}

function normalizePositions(positions) {
  return (Array.isArray(positions) ? positions : []).map((position) => ({ ...position, status: String(position.status || "UNKNOWN").toUpperCase() }));
}

function cumulative(values) {
  let cursor = 0;
  return values.map((value) => {
    cursor = round(cursor + value);
    return cursor;
  });
}

function profitFactor(values) {
  const wins = sum(values.filter((value) => value > 0));
  const losses = Math.abs(sum(values.filter((value) => value < 0)));
  if (losses === 0) return wins > 0 ? null : 0;
  return round(wins / losses);
}

function sharpe(values) {
  const deviation = standardDeviation(values);
  if (values.length < 2 || deviation === 0) return null;
  return round((average(values) / deviation) * Math.sqrt(values.length));
}

function sortino(values) {
  const downside = standardDeviation(values.filter((value) => value < 0));
  if (values.length < 2 || downside === 0) return null;
  return round((average(values) / downside) * Math.sqrt(values.length));
}

function calmar(totalR, drawdownR) {
  if (drawdownR >= 0) return null;
  return round(totalR / Math.abs(drawdownR));
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const avg = average(values);
  return Math.sqrt(sum(values.map((value) => (value - avg) ** 2)) / (values.length - 1));
}

function maxDrawdown(values) {
  let peak = 0;
  let drawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    drawdown = Math.min(drawdown, round(value - peak));
  }
  return drawdown;
}

function excursionMetric(positions, field, mode) {
  const values = positions.map((position) => number(position[field])).filter((value) => value !== null);
  if (!values.length) return null;
  if (mode === "min") return round(Math.min(...values));
  if (mode === "max") return round(Math.max(...values));
  return average(values);
}

function average(values) {
  if (!values.length) return null;
  return round(sum(values) / values.length);
}

function ratio(value, total) {
  if (!total) return 0;
  return round(value / total);
}

function sameInstrument(row, position) {
  return !position.instrument || !row.instrument || row.instrument === position.instrument;
}

function inRange(value, from, to) {
  if (value === null || from === null) return false;
  if (to === null) return value >= from;
  return value >= from && value <= to;
}

function inferSession(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "unknown";
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  if (minutes >= 13 * 60 + 30 && minutes <= 20 * 60) return "ny_open";
  if (minutes >= 7 * 60 && minutes < 13 * 60 + 30) return "asia_open";
  return "off_session";
}

function datePart(value) {
  return String(value || "unknown").slice(0, 10) || "unknown";
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finite(value) {
  return Number.isFinite(value);
}

function time(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}
