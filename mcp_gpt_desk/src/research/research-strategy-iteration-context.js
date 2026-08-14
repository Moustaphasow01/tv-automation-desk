import { toParisIso } from "@tv-automation/desk-time";
import {
  coded,
  iso,
  number,
  object,
  requiredText,
  text,
  timeframeValue,
} from "./research-strategy-iteration-common.js";

export async function loadResearchStrategyIterationContext(store, payload) {
  const dataset = await loadDataset(store.persistence.pool, payload);
  const scope = datasetScope(dataset, payload);
  const rows = await loadMarketRows(store.persistence.pool, scope);
  if (rows.length === 0) throw coded("RESEARCH_ITERATION_DATASET_ROWS_REQUIRED", "Dataset market rows are required.", false);
  return { dataset, scope, rows };
}

function datasetScope(dataset, payload) {
  return {
    symbol_code: text(dataset.metadata?.symbol_code || payload.symbol_code, "MNQ1!"),
    instrument: text(dataset.metadata?.instrument || payload.instrument, "MNQ").toUpperCase(),
    timeframe: timeframeValue(dataset.metadata?.timeframe || payload.timeframe),
    start_utc: iso(dataset.time_range_start_utc || payload.start_utc),
    end_utc: iso(dataset.time_range_end_utc || payload.end_utc),
    dataset_key: requiredText(dataset.dataset_key || payload.dataset_key, "dataset_key"),
  };
}

async function loadDataset(pool, payload) {
  const datasetId = text(payload.dataset_id);
  const datasetKey = text(payload.dataset_key);
  const result = await pool.query(
    `SELECT *
       FROM datasets
      WHERE ($1::uuid IS NOT NULL AND dataset_id = $1::uuid)
         OR ($2::text IS NOT NULL AND dataset_key = $2)
      ORDER BY updated_at_utc DESC
      LIMIT 1`,
    [datasetId || null, datasetKey || null],
  );
  const dataset = result.rows[0];
  if (!dataset) throw coded("RESEARCH_ITERATION_DATASET_NOT_FOUND", "Research dataset not found.", false);
  return normalizeDataset(dataset);
}

async function loadMarketRows(pool, scope) {
  const result = await pool.query(
    `SELECT timestamp_utc, timestamp_paris, trading_date, open, high, low, close, volume, is_closed
       FROM market_candles
      WHERE symbol_code = $1
        AND timeframe = $2
        AND timestamp_utc >= $3::timestamptz
        AND timestamp_utc < $4::timestamptz
        AND is_closed = true
      ORDER BY timestamp_utc ASC`,
    [scope.symbol_code, scope.timeframe, scope.start_utc, scope.end_utc],
  );
  return result.rows.map((row) => marketRow(row, scope));
}

function normalizeDataset(row) {
  return {
    dataset_id: String(row.dataset_id),
    dataset_key: row.dataset_key,
    name: row.name,
    status: row.status,
    time_range_start_utc: iso(row.time_range_start_utc),
    time_range_end_utc: iso(row.time_range_end_utc),
    cutoff_utc: iso(row.cutoff_utc || row.time_range_end_utc),
    cutoff_paris: row.cutoff_paris || toParisIso(Date.parse(row.cutoff_utc || row.time_range_end_utc)),
    schema_version: row.schema_version,
    content_hash: row.content_hash,
    provenance_hash: row.provenance_hash,
    build_parameters_hash: row.build_parameters_hash,
    metadata: object(row.metadata),
  };
}

function marketRow(row, scope) {
  return {
    instrument: scope.instrument,
    symbol: scope.symbol_code,
    timeframe: "M5",
    trading_date: row.trading_date,
    time: typeof row.timestamp_paris === "string" ? row.timestamp_paris : toParisIso(Date.parse(row.timestamp_utc)),
    timestamp_utc: iso(row.timestamp_utc),
    timestamp_paris: typeof row.timestamp_paris === "string" ? row.timestamp_paris : null,
    open: number(row.open),
    high: number(row.high),
    low: number(row.low),
    close: number(row.close),
    volume: number(row.volume),
    is_closed: row.is_closed === true,
  };
}
