import { grainChicagoDate, isGrainsRth } from "./us-grains-data-quality.js";

const PRICE_FIELDS = ["open", "high", "low", "close"];

export function auditMarketDataLatency(input = {}) {
  const candles = Array.isArray(input.candles) ? input.candles : [];
  const signals = Array.isArray(input.signals) ? input.signals : [];
  if (Number.isFinite(input.tickTolerance) && input.tickTolerance < 0) throw new Error("tick_tolerance_must_be_non_negative");
  const tolerance = Number.isFinite(input.tickTolerance) ? input.tickTolerance : 0;
  const normalized = [];
  const ignored = [];
  for (const [index, row] of candles.entries()) {
    const result = normalizeCandle(row);
    if (result.row) normalized.push(result.row); else ignored.push({ index, reason: result.reason });
  }
  return {
    schema_version: "market_data_latency_audit_v1", input_hash: input.inputHash || null, as_of_utc: input.asOfUtc || null,
    input_rows: { candle_count: candles.length, accepted_candle_count: normalized.length, ignored_candle_count: ignored.length, ignored: ignored.slice(0, 100) },
    arrival_provenance: { status: "UNKNOWN", reason: "ledger_has_no_immutable_source_arrival_receipt" },
    latency_by_date_instrument_timeframe: aggregateLatency(normalized), signal_cohort: auditSignalCohort(signals, normalized),
    m1_m5_rth: auditRth(normalized, tolerance),
    method: { close_offset_minutes: "timeframe duration added to timestamp_utc", signal_linkage: "exact feed_id + source_data_cutoff_utc timestamp; no nearest-time matching", rth: "isGrainsRth(timestamp_utc), Chicago trading date, exact expected timestamps", ohlc_tolerance: tolerance },
  };
}

function normalizeCandle(row) {
  const feedId = String(row?.feed_id || "");
  const timeframe = feedId.endsWith("__1") ? "1" : feedId.endsWith("__5") ? "5" : null;
  const instrument = feedId.includes("ZC1!") ? "ZC" : feedId.includes("ZW1!") ? "ZW" : null;
  const timestamp = validDate(row?.timestamp_utc);
  if (!timeframe || !instrument || !timestamp) return { reason: "unsupported_feed_or_invalid_timestamp" };
  const invalidField = firstInvalidNumericField(row);
  if (invalidField) return { reason: `invalid_${invalidField}` };
  const numeric = Object.fromEntries([...PRICE_FIELDS, "volume"].map((field) => [field, Number(row[field])]));
  return { row: { ...row, ...numeric, feedId, timeframe, instrument, timestamp, date: grainChicagoDate(timestamp) } };
}

function firstInvalidNumericField(row) {
  return [...PRICE_FIELDS, "volume"].find((field) => {
    const value = row?.[field];
    return value === null || value === undefined || value === "" || !Number.isFinite(Number(value));
  }) || null;
}

function aggregateLatency(rows) {
  const groups = groupBy(rows, (row) => `${row.date}|${row.instrument}|${row.timeframe}`);
  return [...groups.values()].sort(keySort).map((group) => {
    const delays = group.rows.map(delayMinutes).filter(Number.isFinite).sort((a, b) => a - b);
    const first = group.rows[0];
    return { date: first.date, instrument: first.instrument, timeframe: first.timeframe, sample_count: delays.length, p50_minutes: percentile(delays, 0.5), p95_minutes: percentile(delays, 0.95), max_minutes: delays.at(-1) ?? null, updated_since_first_insert_count: group.rows.filter(changedAfterImport).length, missing_import_timestamp_count: group.rows.filter((row) => !validDate(row.imported_at)).length, unknown_arrival_count: group.rows.length };
  });
}

function auditSignalCohort(signals, candles) {
  const byKey = groupBy(candles, (row) => `${row.feedId}|${row.timestamp}`);
  const rows = signals.map((signal) => analyzeSignal(signal, byKey));
  const delays = rows.map((row) => row.close_to_import_minutes).filter(Number.isFinite).sort((a, b) => a - b);
  return { sample_count: delays.length, p50_minutes: percentile(delays, 0.5), p95_minutes: percentile(delays, 0.95), max_minutes: delays.at(-1) ?? null, rows };
}

function analyzeSignal(signal, byKey) {
  const instrument = String(signal?.instrument || "").toUpperCase();
  const cutoff = validDate(signal?.source_data_cutoff_utc);
  const feedId = instrument ? `prod__tradingview__${instrument}1!__5` : null;
  const matches = exactMatches(byKey, feedId, cutoff);
  const status = matchStatus(matches.length);
  const matched = matches.length === 1 ? matches[0] : null;
  const close = matched ? Date.parse(matched.timestamp) + 300000 : null;
  const created = validDate(signal?.created_at_utc);
  const published = validDate(signal?.published_at_utc);
  const timings = signalTimings(close, created, published);
  return {
    ...signalAuditIdentity(signal), instrument: instrument || null,
    source_data_cutoff_utc: cutoff, feed_id: feedId,
    linkage_method: "exact_feed_id_and_source_data_cutoff_utc", status,
    close_to_import_minutes: matched ? delayMinutes(matched) : null, ...timings,
  };
}

function signalAuditIdentity(signal) {
  return {
    signal_id: signal?.signal_id || null,
    created_at_utc: signal?.created_at_utc || null,
    published_at_utc: signal?.published_at_utc || null,
  };
}

function exactMatches(byKey, feedId, cutoff) {
  return cutoff && feedId ? byKey.get(`${feedId}|${cutoff}`)?.rows || [] : [];
}

function matchStatus(count) {
  if (count === 1) return "MATCHED_EXACT";
  if (count > 1) return "AMBIGUOUS_DUPLICATE";
  return "UNMATCHED_EXACT_CUTOFF";
}

function signalTimings(close, created, published) {
  const closeToCreated = differenceMinutes(close, created);
  const closeToPublished = differenceMinutes(close, published);
  const createdToPublished = differenceMinutes(created && Date.parse(created), published);
  return {
    close_to_created_minutes: closeToCreated,
    close_to_published_minutes: closeToPublished,
    created_to_published_minutes: createdToPublished,
    timing_anomalies: timingAnomalies(closeToCreated, closeToPublished, createdToPublished),
  };
}

function timingAnomalies(closeToCreated, closeToPublished, createdToPublished) {
  const anomalies = [];
  if (closeToCreated !== null && closeToCreated < 0) anomalies.push("CREATED_BEFORE_M5_CLOSE");
  if (closeToPublished !== null && closeToPublished < 0) anomalies.push("PUBLISHED_BEFORE_M5_CLOSE");
  if (createdToPublished !== null && createdToPublished < 0) anomalies.push("PUBLISHED_BEFORE_CREATED");
  return anomalies;
}

function auditRth(rows, tolerance) {
  const groups = groupBy(rows.filter((row) => isGrainsRth(row.timestamp)), (row) => `${row.date}|${row.instrument}`);
  return [...groups.values()].sort(keySort).map((group) => {
    const m1 = group.rows.filter((row) => row.timeframe === "1"); const m5 = group.rows.filter((row) => row.timeframe === "5");
    const date = group.rows[0].date;
    const m1ByTimestamp = groupBy(m1, (row) => row.timestamp); const m5ByTimestamp = groupBy(m5, (row) => row.timestamp);
    const m1Expected = expectedTimestamps(date, 1); const m1Missing = m1Expected.filter((timestamp) => !m1ByTimestamp.has(timestamp));
    const m1Duplicates = [...m1ByTimestamp.values()].filter((group) => group.rows.length > 1);
    const windows = expectedTimestamps(date, 5).map((timestamp) => compareM5Window(timestamp, m5ByTimestamp, m1ByTimestamp, tolerance));
    const first = group.rows[0];
    return { date: first.date, instrument: first.instrument, m1: { expected_count: m1Expected.length, observed_unique_count: m1ByTimestamp.size, missing_count: m1Missing.length, duplicate_count: m1Duplicates.length, conflicting_duplicate_count: m1Duplicates.filter((group) => hasConflict(group.rows, tolerance)).length }, m5: { expected_count: windows.length, windows, counts: countStatuses(windows) }, boundary_partial_m5_distinct_from_missing: true, ohlc_tolerance: tolerance };
  });
}

function compareM5Window(timestamp, m5ByTimestamp, m1ByTimestamp, tolerance) {
  const m5Rows = m5ByTimestamp.get(timestamp)?.rows || [];
  if (localMinute(timestamp) === 800) return { timestamp_utc: timestamp, status: "BOUNDARY_PARTIAL_M5", m1_count: 0, volume_mismatch: false };
  if (m5Rows.length > 1) return { timestamp_utc: timestamp, status: "AMBIGUOUS_DUPLICATE", m1_count: 0, volume_mismatch: false };
  const m1Timestamps = Array.from({ length: 5 }, (_, index) => new Date(Date.parse(timestamp) + index * 60000).toISOString());
  const m1Rows = m1Timestamps.flatMap((key) => m1ByTimestamp.get(key)?.rows || []);
  const hasDuplicate = m1Rows.some((row) => m1ByTimestamp.get(row.timestamp).rows.length > 1);
  if (hasDuplicate) return { timestamp_utc: timestamp, status: "AMBIGUOUS_DUPLICATE", m1_count: m1Rows.length, volume_mismatch: false };
  if (m1Rows.length !== 5) return { timestamp_utc: timestamp, status: "INCOMPLETE_M1", m1_count: m1Rows.length, volume_mismatch: false };
  if (m5Rows.length !== 1) return { timestamp_utc: timestamp, status: "INCOMPLETE_M5", m1_count: 5, volume_mismatch: false };
  const aggregate = { open: m1Rows[0].open, high: Math.max(...m1Rows.map((row) => row.high)), low: Math.min(...m1Rows.map((row) => row.low)), close: m1Rows.at(-1).close, volume: m1Rows.reduce((sum, row) => sum + row.volume, 0) };
  const priceMismatch = PRICE_FIELDS.some((field) => Math.abs(aggregate[field] - Number(m5Rows[0][field])) > tolerance);
  const volumeMismatch = aggregate.volume !== Number(m5Rows[0].volume);
  return { timestamp_utc: timestamp, status: priceMismatch ? "OHLC_MISMATCH" : "COMPLETE_MATCH", m1_count: 5, volume_mismatch: volumeMismatch, aggregate, m5: { open: m5Rows[0].open, high: m5Rows[0].high, low: m5Rows[0].low, close: m5Rows[0].close, volume: m5Rows[0].volume } };
}

function expectedTimestamps(date, step) { const start = chicagoLocalToUtc(date, 510); const end = chicagoLocalToUtc(date, 800); const values = []; for (let time = start; time <= end; time += step * 60000) values.push(new Date(time).toISOString()); return values; }
function chicagoLocalToUtc(date, minute) { let value = Date.parse(`${date}T14:00:00.000Z`); for (let i = 0; i < 3; i += 1) value += (minute - localMinute(new Date(value).toISOString())) * 60000; return value; }
function localMinute(timestamp) { const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(timestamp)); return Number(parts.find((part) => part.type === "hour").value) * 60 + Number(parts.find((part) => part.type === "minute").value); }
function hasConflict(rows, tolerance) { const first = rows[0]; return rows.slice(1).some((row) => [...PRICE_FIELDS, "volume"].some((field) => Math.abs(Number(row[field]) - Number(first[field])) > tolerance)); }
function delayMinutes(row) { const imported = validDate(row.imported_at); return imported ? (Date.parse(imported) - Date.parse(row.timestamp) - Number(row.timeframe) * 60000) / 60000 : null; }
function changedAfterImport(row) { const imported = validDate(row.imported_at); const updated = validDate(row.updated_at); return imported && updated && Date.parse(updated) > Date.parse(imported); }
function differenceMinutes(startMs, endIso) { return startMs !== null && endIso ? (Date.parse(endIso) - startMs) / 60000 : null; }
function validDate(value) { const parsed = value ? new Date(value) : null; return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null; }
function percentile(values, fraction) { if (!values.length) return null; return values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))]; }
function groupBy(rows, keyFn) { const groups = new Map(); for (const row of rows) { const key = keyFn(row); const group = groups.get(key) || { rows: [] }; group.rows.push(row); groups.set(key, group); } return groups; }
function countStatuses(windows) { return windows.reduce((result, window) => { result[window.status] = (result[window.status] || 0) + 1; return result; }, {}); }
function keySort(left, right) { const leftRow = left.rows[0] || left; const rightRow = right.rows[0] || right; return `${leftRow.date}|${leftRow.instrument}`.localeCompare(`${rightRow.date}|${rightRow.instrument}`); }
