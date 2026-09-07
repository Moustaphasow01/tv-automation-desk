import { canonicalSha256 } from "@tv-automation/desk-domain";
import { SystemClock } from "@tv-automation/desk-time";

const MISSION_ID = "f23b52e4-1955-4c8a-b8c7-216dd65e2c40";
const MARKET_CONTEXT_UNIVERSE = "US_GRAINS_CBOT";
const MARKET_CONTEXT_TASK_TYPE = "LIVE_US_GRAINS_MARKET_CONTEXT_REFRESH";
const MARKET_CONTEXT_TIME_CONTRACT_VERSION = "us_grains_market_context_time_v2";
const MARKET_CONTEXT_SUPERSEDED_CODE = "SUPERSEDED_BY_NEWER_MARKET_CONTEXT_TASK";
const REQUIRED_FEEDS = Object.freeze([
  ["ZC", "1", "prod__tradingview__ZC1!__1"],
  ["ZC", "5", "prod__tradingview__ZC1!__5"],
  ["ZW", "1", "prod__tradingview__ZW1!__1"],
  ["ZW", "5", "prod__tradingview__ZW1!__5"],
]);

export const MARKET_CONTEXT_SUPERSEDE_READY_SQL = `
WITH stale_dispatches AS (
  SELECT d.dispatch_id, d.agent_task_id, d.source_data_cutoff_utc
  FROM market_context_task_dispatches d
  JOIN agent_tasks t ON t.agent_task_id = d.agent_task_id
  WHERE d.universe = $4
    AND t.task_type = $5
    AND t.lane = 'live'
    AND t.status = 'READY'
    AND d.agent_task_id IS NOT NULL
    AND d.source_data_cutoff_utc <= $1::timestamptz
    AND COALESCE(d.not_before_utc, d.created_at_utc) <= $1::timestamptz
    AND COALESCE(t.not_before_utc, t.created_at_utc) <= $1::timestamptz
    AND d.created_at_utc <= $1::timestamptz
    AND t.created_at_utc <= $1::timestamptz
    AND ($2::uuid IS NULL OR t.agent_task_id <> $2::uuid)
),
cancelled_tasks AS (
  UPDATE agent_tasks t
     SET status = 'CANCELLED',
         last_error = jsonb_build_object(
           'code', $3::text,
           'superseded_by_task_id', $2::text,
           'superseded_analysis_as_of_utc', $1::text,
           'cancelled_at_utc', now()
         ),
         lease_token = NULL,
         lease_expires_at_utc = NULL,
         updated_at_utc = now(),
         revision = revision + 1
    FROM stale_dispatches s
   WHERE t.agent_task_id = s.agent_task_id
   RETURNING t.agent_task_id, s.dispatch_id, s.source_data_cutoff_utc
)
UPDATE market_context_task_dispatches d
   SET status = 'SKIPPED',
       updated_at_utc = now(),
       metadata = d.metadata || jsonb_build_object(
         'superseded_reason', $3::text,
         'superseded_by_task_id', $2::text,
         'superseded_at_utc', now()
       )
  FROM cancelled_tasks c
 WHERE d.dispatch_id = c.dispatch_id
 RETURNING c.agent_task_id, d.dispatch_id, c.source_data_cutoff_utc;
`;

export class MarketContextTaskScheduler {
  constructor({ store, clock = store?.clock || new SystemClock() } = {}) {
    this.store = store;
    this.pool = store?.persistence?.pool;
    this.clock = clock;
  }

  async runCycle({ now_utc: requestedNowUtc = null, trigger = "CADENCE" } = {}) {
    const nowUtc = requestedNowUtc || this.clock.now().utc;
    if (!this.pool) return { status: "UNAVAILABLE" };
    const health = await this.store.health();
    const session = canonicalSession(health, nowUtc);
    const cadenceMinutes = session.marketState === "OPEN" ? 30 : 60;
    const cutoffBucket = floorUtc(nowUtc, cadenceMinutes);
    const sourceStates = await this.#refreshFeedCoverage(nowUtc, session);
    const bundle = await this.#buildBundle({ nowUtc, session, sourceStates });
    const eventReasons = detectMarketContextEventReasons(bundle);
    const triggerType = eventReasons.length ? "EVENT" : trigger;
    const reasonHash = canonicalSha256({ triggerType, eventReasons, cutoffBucket,
      timeContractVersion: MARKET_CONTEXT_TIME_CONTRACT_VERSION,
      session: session.marketSession, sourceStates: sourceStates.map(sourceSignature) }).slice(0, 24);
    const existing = await this.pool.query(`SELECT * FROM market_context_task_dispatches
      WHERE universe=$1 AND source_data_cutoff_utc=$2 AND reason_hash=$3`, [MARKET_CONTEXT_UNIVERSE, cutoffBucket, reasonHash]);
    if (existing.rows[0]) {
      const superseded = await this.#supersedeReadyContextTasks({ analysisAsOfUtc: nowUtc, keepTaskId: existing.rows[0].agent_task_id });
      return { status: "DEDUPED", dispatch_id: existing.rows[0].dispatch_id, task_id: existing.rows[0].agent_task_id, superseded_task_count: superseded.length };
    }
    const ids = stableIds({ cutoffBucket, reasonHash });
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO agent_tasks (
        agent_task_id, agent_mission_id, task_key, task_type, lane, status, priority,
        payload, idempotency_key, max_attempts, not_before_utc, correlation_id, metadata
      ) VALUES ($1,$2,$3,$9,'live','READY',30,$4::jsonb,$5,3,$6,$7,$8::jsonb)
      ON CONFLICT (agent_task_id) DO NOTHING`, [
        ids.taskId, MISSION_ID, ids.taskKey, JSON.stringify({ schema_version: "us_grains_market_context_task_v1", trigger: triggerType, trigger_reasons: eventReasons, reason_hash: reasonHash, bundle }),
        `idem-${ids.taskId}`, nowUtc, ids.correlationId, JSON.stringify({ universe: "US_GRAINS_CBOT", authority: "ADVISORY_ONLY",
          time_contract_version: bundle.timeContractVersion, analysis_as_of_utc: bundle.analysisAsOfUtc,
          market_data_cutoff_utc: bundle.marketDataCutoffUtc,
          trigger_reasons: eventReasons }),
        MARKET_CONTEXT_TASK_TYPE,
      ]);
      await client.query(`INSERT INTO market_context_task_dispatches (
        dispatch_id, universe, source_data_cutoff_utc, reason_hash, trigger_type,
        status, agent_task_id, not_before_utc, metadata
      ) VALUES ($1,$8,$2,$3,$4,'ENQUEUED',$5,$6,$7::jsonb)`, [
        ids.dispatchId, cutoffBucket, reasonHash, triggerType, ids.taskId, nowUtc,
        JSON.stringify({ cadence_minutes: cadenceMinutes, market_session: session.marketSession,
          time_contract_version: bundle.timeContractVersion, analysis_as_of_utc: bundle.analysisAsOfUtc,
          market_data_cutoff_utc: bundle.marketDataCutoffUtc,
          trigger_reasons: eventReasons }),
        MARKET_CONTEXT_UNIVERSE,
      ]);
      const superseded = await this.#supersedeReadyContextTasks({ client, analysisAsOfUtc: nowUtc, keepTaskId: ids.taskId });
      await client.query("SELECT pg_notify('desk_agent_runtime_ready', $1)", [JSON.stringify({ schema: "desk_agent_runtime_ready_v1", lane: "live", status: "READY" })]);
      await client.query("COMMIT");
      return { status: "ENQUEUED", ...ids, trigger: triggerType, trigger_reasons: eventReasons,
        analysis_as_of_utc: bundle.analysisAsOfUtc, source_data_cutoff_utc: bundle.cutoff,
        market_data_cutoff_utc: bundle.marketDataCutoffUtc,
        source_states: sourceStates, superseded_task_count: superseded.length };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async #supersedeReadyContextTasks({ client = this.pool, analysisAsOfUtc, keepTaskId }) {
    const result = await client.query(MARKET_CONTEXT_SUPERSEDE_READY_SQL, [
      analysisAsOfUtc,
      keepTaskId,
      MARKET_CONTEXT_SUPERSEDED_CODE,
      MARKET_CONTEXT_UNIVERSE,
      MARKET_CONTEXT_TASK_TYPE,
    ]);
    return result.rows;
  }

  async #refreshFeedCoverage(nowUtc, session) {
    const states = [];
    for (const [instrument, timeframe, feedId] of REQUIRED_FEEDS) {
      const eligibleBarOpenUtc = eligibleBarOpenCutoffUtc(nowUtc, timeframe);
      const result = await this.pool.query(`SELECT min(timestamp_utc) AS coverage_start,
        max(timestamp_utc) AS coverage_end,
        (max(timestamp_utc) AT TIME ZONE 'America/Chicago')::date::text AS latest_market_date,
        count(*)::int AS row_count
        FROM market_candles WHERE feed_id=$1 AND is_closed=true AND timestamp_utc <= $2`,
      [feedId, eligibleBarOpenUtc]);
      const row = result.rows[0] || {};
      const available = Boolean(row.coverage_start && row.coverage_end);
      const coverageEnd = available ? barCloseUtc(row.coverage_end, timeframe) : null;
      const ageMs = available ? Math.max(0, Date.parse(nowUtc) - Date.parse(coverageEnd)) : Number.POSITIVE_INFINITY;
      const freshnessMs = marketContextFreshnessThresholdMs({ timeframe, readinessPolicy: session.freshnessPolicy });
      const freshness = marketBarCoverageAssessment({ available, ageMs, freshnessMs,
        timeframe, coverageEnd, latestMarketDate: row.latest_market_date,
        lastExpectedMarketDate: session.lastExpectedMarketDate,
        lastExpectedCoreClosesUtc: session.lastExpectedCoreClosesUtc });
      const state = await this.store.marketContext.upsertSourceCoverage({
        sourceId: `${instrument}_${timeframe}`, sourceType: "OHLCV", status: !available ? "UNAVAILABLE" : freshness.stale ? "STALE" : "AVAILABLE",
        requiredFor: ["MARKET_CONTEXT_SNAPSHOT", "CONTEXT_PREFILTER"], dataCutoff: coverageEnd || nowUtc,
        coverageStart: row.coverage_start, coverageEnd, asOf: nowUtc,
        lastSuccessfulAt: coverageEnd, provider: "TRADINGVIEW_WEBHOOK", datasetVersion: "market_candles_v1",
        missingness: available ? 0 : 1,
        reasonCodes: marketBarReasonCodes({ available, stale: freshness.stale,
          expectedMarketDateMismatch: freshness.expectedMarketDateMismatch,
          expectedMarketCloseMismatch: freshness.expectedMarketCloseMismatch, marketState: session.marketState }),
        metadata: { feed_id: feedId, row_count: Number(row.row_count || 0), age_ms: Number.isFinite(ageMs) ? ageMs : null,
          freshness_threshold_ms: freshnessMs, latest_market_date: row.latest_market_date || null,
          last_expected_market_date: session.lastExpectedMarketDate,
          last_expected_core_close_utc: freshness.lastExpectedCloseUtc,
          latest_bar_open_utc: isoOrNull(row.coverage_end), latest_bar_close_utc: coverageEnd },
      });
      states.push(state);
    }
    const agri = await this.store.marketContext.current("US_GRAINS_CBOT", nowUtc).then((value) => value.sourceStates.find((item) => item.sourceId === "market_agri_events"));
    states.push(agri || await this.store.marketContext.upsertSourceCoverage({
      sourceId: "market_agri_events", sourceType: "AGRI_EVENT_CALENDAR", status: "UNKNOWN_COVERAGE",
      requiredFor: ["MARKET_CONTEXT_SNAPSHOT", "CONTEXT_PREFILTER"], dataCutoff: nowUtc,
      asOf: nowUtc, provider: null, reasonCodes: ["IMPORT_MANIFEST_NOT_PUBLISHED"], missingness: 1,
    }));
    states.push(await this.store.marketContext.upsertSourceCoverage({
      sourceId: "canonical_grains_session", sourceType: "MARKET_SESSION", status: session.marketState === "UNKNOWN" ? "UNAVAILABLE" : "AVAILABLE",
      requiredFor: ["MARKET_CONTEXT_SNAPSHOT", "LIVE_FOCUS"], dataCutoff: nowUtc,
      coverageStart: `${session.marketDate || nowUtc.slice(0, 10)}T00:00:00Z`, coverageEnd: nowUtc,
      asOf: nowUtc, lastSuccessfulAt: nowUtc, provider: "DATA_READINESS",
      datasetVersion: "cbot_us_grains_rth_v1", missingness: session.marketState === "UNKNOWN" ? 1 : 0,
      reasonCodes: [session.marketSession],
    }));
    states.push(await this.store.marketContext.upsertSourceCoverage({
      sourceId: "weather_crop_context", sourceType: "WEATHER", status: "OPTIONAL_UNAVAILABLE",
      requiredFor: [], dataCutoff: nowUtc,
      asOf: nowUtc, provider: null, datasetVersion: "weather_context_contract_v1", missingness: 1,
      reasonCodes: ["WEATHER_NOT_IMPLEMENTED", "OPTIONAL_FOR_CURRENT_FAMILIES"],
    }));
    return states;
  }

  async #buildBundle({ nowUtc, session, sourceStates }) {
    const latestCutoffs = sourceStates.filter((source) => source.sourceType === "OHLCV" && source.coverageEnd).map((source) => Date.parse(source.coverageEnd));
    const marketDataCutoffUtc = latestCutoffs.length ? new Date(Math.min(...latestCutoffs)).toISOString() : nowUtc;
    const series = {};
    for (const [instrument, timeframe, feedId] of REQUIRED_FEEDS) {
      const barOpenCutoffUtc = eligibleBarOpenCutoffUtc(marketDataCutoffUtc, timeframe);
      const result = await this.pool.query(`SELECT timestamp_utc, open, high, low, close, volume
        FROM market_candles WHERE feed_id=$1 AND is_closed=true AND timestamp_utc <= $2
        ORDER BY timestamp_utc DESC LIMIT 120`, [feedId, barOpenCutoffUtc]);
      series[`${instrument}:${timeframe}`] = summarizeSeries(result.rows.reverse(), timeframe);
    }
    const calendar = await this.store.marketContext.calendarAt(nowUtc);
    const bundleSources = [
      ...sourceStates.filter((source) => source.sourceId !== "market_agri_events"),
      calendar.sourceState,
    ];
    const recent = await Promise.all([
      safeRows(this.pool, `SELECT strategy_instance_id, status, instrument, timeframe, source_data_cutoff_utc,
        signal_id, reason_codes FROM strategy_runtime_evaluations ORDER BY completed_at_utc DESC LIMIT 80`),
      safeRows(this.pool, `SELECT signal_id, strategy_instance_id, instrument, direction, confidence,
        generated_at_utc, expires_at_utc, setup, reason_codes FROM strategy_signal_outbox
        WHERE source_class IN ('LIVE','SHADOW') ORDER BY generated_at_utc DESC LIMIT 40`),
      safeRows(this.pool, `SELECT incident_id, severity, status, title, updated_at_utc
        FROM operations_incidents WHERE status NOT IN ('RESOLVED','CLOSED') ORDER BY updated_at_utc DESC LIMIT 20`),
    ]);
    const previous = await this.store.marketContext.current("US_GRAINS_CBOT", nowUtc);
    return {
      schemaVersion: "us_grains_market_context_bundle_v1",
      timeContractVersion: MARKET_CONTEXT_TIME_CONTRACT_VERSION,
      universe: "US_GRAINS_CBOT",
      analysisAsOfUtc: nowUtc,
      marketDataCutoffUtc,
      sourceDataCutoff: nowUtc,
      cutoff: nowUtc,
      canonicalMarketSession: session,
      series,
      agriEventManifest: calendar.sourceState,
      coveredAgriEvents: calendar.events,
      recentEvaluations: recent[0],
      recentSignals: recent[1],
      activeIncidents: recent[2],
      previousSnapshot: previous.snapshot,
      previousBrief: previous.brief,
      sourceStates: bundleSources,
      authority: { execution: false, risk: false, humanGate: false, provider: false },
    };
  }
}

function canonicalSession(health, nowUtc) {
  const source = health?.data_readiness?.market_session || {};
  const state = normalizedMarketState(source.state);
  return {
    marketState: state,
    marketSession: source.active_session || source.session || "CBOT_GRAINS_UNKNOWN",
    exchangeTimezone: source.timezone || "America/Chicago",
    marketDate: source.trading_date || null,
    sessionStart: source.session_start_utc || null,
    sessionEnd: source.session_end_utc || null,
    nextEligibleAt: source.next_eligible_at_utc || null,
    lastExpectedMarketDate: source.last_expected_market_date || null,
    lastExpectedCoreClosesUtc: source.last_expected_core_close_utc_by_timeframe || null,
    asOf: source.as_of_utc || nowUtc,
    freshnessPolicy: health?.data_readiness?.freshness_policy || null,
    source: "data_readiness.market_session",
  };
}

function normalizedMarketState(value) {
  const state = String(value || "UNKNOWN").toUpperCase();
  return ["OPEN", "PREOPEN", "POSTCLOSE", "CLOSED", "BREAK", "HOLIDAY"].includes(state) ? state : "UNKNOWN";
}

function summarizeSeries(rows, timeframe) {
  if (!rows.length) return { availability: "UNAVAILABLE", asOf: null, bars: [] };
  const normalized = rows.map((row) => ({ timestamp: new Date(row.timestamp_utc).toISOString(),
    closedAt: barCloseUtc(row.timestamp_utc, timeframe), open: Number(row.open), high: Number(row.high),
    low: Number(row.low), close: Number(row.close), volume: row.volume === null ? null : Number(row.volume) }));
  const first = normalized[0], last = normalized.at(-1);
  const returns = first.close ? (last.close - first.close) / first.close : null;
  return { availability: "AVAILABLE", asOf: last.closedAt, lastBarOpenedAt: last.timestamp,
    lastBarClosedAt: last.closedAt, barCount: normalized.length, return: returns,
    high: Math.max(...normalized.map((row) => row.high)), low: Math.min(...normalized.map((row) => row.low)),
    latest: last, bars: normalized.slice(-30) };
}

async function safeRows(pool, sql, params) { try { return (await pool.query(sql, params)).rows; } catch { return []; } }
function floorUtc(value, minutes) { const date = new Date(value); date.setUTCSeconds(0, 0); date.setUTCMinutes(Math.floor(date.getUTCMinutes() / minutes) * minutes); return date.toISOString(); }
function sourceSignature(source) { return marketContextSourceReasonSignature(source); }
export function marketContextSourceReasonSignature(source) { return { sourceId: source.sourceId, status: source.status, datasetVersion: source.datasetVersion }; }
export function marketContextFreshnessThresholdMs({ timeframe, readinessPolicy = null } = {}) {
  const fallbackMs = String(timeframe) === "1" ? 150_000 : 420_000;
  const readinessMs = Number(readinessPolicy?.max_age_seconds) * 1000;
  return Number.isFinite(readinessMs) && readinessMs > 0 ? Math.max(fallbackMs, readinessMs) : fallbackMs;
}
export function detectMarketContextEventReasons(bundle) {
  const reasons = [];
  const previous = bundle.previousSnapshot;
  if (previous?.marketSession && previous.marketSession !== bundle.canonicalMarketSession.marketSession) reasons.push("SESSION_TRANSITION");
  const priorSources = new Map((previous?.sourceStates || []).map((source) => [source.sourceId, source.status]));
  for (const source of bundle.sourceStates) {
    const prior = priorSources.get(source.sourceId);
    if (prior && prior !== source.status) reasons.push(`SOURCE_${source.sourceId}_${prior}_TO_${source.status}`);
  }
  for (const [key, series] of Object.entries(bundle.series)) {
    if (Math.abs(Number(series.return || 0)) >= 0.0075) reasons.push(`VOLATILITY_SHOCK_${key.replace(":", "_")}`);
    if (structureBreak(series.bars)) reasons.push(`STRUCTURE_BREAK_${key.replace(":", "_")}`);
  }
  const cutoff = Date.parse(bundle.analysisAsOfUtc || bundle.cutoff);
  if (bundle.coveredAgriEvents.some((event) => ["HIGH", "CRITICAL"].includes(event.importance) && Math.abs(Date.parse(event.event_timestamp_utc) - cutoff) <= 15 * 60_000)) reasons.push("HIGH_AGRI_EVENT_NEARBY");
  return [...new Set(reasons)].sort();
}
function structureBreak(bars = []) { if (bars.length < 4) return false; const prior = bars.slice(0, -1), latest = bars.at(-1); return latest.close > Math.max(...prior.map((bar) => bar.high)) || latest.close < Math.min(...prior.map((bar) => bar.low)); }
export function eligibleBarOpenCutoffUtc(value, timeframe) {
  const instant = timestampMs(value);
  const minutes = Number(timeframe);
  if (!Number.isFinite(instant) || !Number.isFinite(minutes) || minutes <= 0) return null;
  return new Date(instant - minutes * 60_000).toISOString();
}
export function barCloseUtc(value, timeframe) {
  const open = timestampMs(value);
  const minutes = Number(timeframe);
  if (!Number.isFinite(open) || !Number.isFinite(minutes) || minutes <= 0) return null;
  return new Date(open + minutes * 60_000).toISOString();
}
export function marketBarCoverageAssessment({ available, ageMs, freshnessMs, timeframe, coverageEnd,
  latestMarketDate, lastExpectedMarketDate, lastExpectedCoreClosesUtc }) {
  const expectedMarketDateMismatch = Boolean(available && lastExpectedMarketDate
    && String(latestMarketDate || "") !== String(lastExpectedMarketDate));
  const lastExpectedCloseUtc = isoOrNull(lastExpectedCoreClosesUtc?.[String(timeframe)]);
  const expectedMarketCloseMismatch = Boolean(available && lastExpectedCloseUtc
    && isoOrNull(coverageEnd) !== lastExpectedCloseUtc);
  const stale = Boolean(available && (expectedMarketDateMismatch || expectedMarketCloseMismatch || ageMs > freshnessMs));
  return { stale, expectedMarketDateMismatch, expectedMarketCloseMismatch, lastExpectedCloseUtc };
}
function marketBarReasonCodes({ available, stale, expectedMarketDateMismatch, expectedMarketCloseMismatch, marketState }) {
  if (!available) return ["NO_CLOSED_BARS"];
  if (expectedMarketDateMismatch) return ["CLOSED_BARS_NOT_FROM_LAST_EXPECTED_MARKET_DATE"];
  if (expectedMarketCloseMismatch) return ["CLOSED_BARS_NOT_AT_LAST_EXPECTED_SESSION_CLOSE"];
  if (stale && marketState === "OPEN") return ["CLOSED_BARS_STALE_DURING_ACTIVE_SESSION"];
  if (stale) return ["CLOSED_BARS_STALE_FOR_MARKET_SESSION"];
  if (marketState !== "OPEN") return ["CLOSED_BARS_LAST_KNOWN_MARKET_NOT_OPEN"];
  return ["CLOSED_BARS_AVAILABLE"];
}
function isoOrNull(value) { const parsed = timestampMs(value); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function timestampMs(value) { return value instanceof Date ? value.getTime() : Date.parse(value || ""); }
function stableIds(input) { const hash = canonicalSha256(input); const taskId = uuidFromHash(hash); return { taskId, taskKey: `us-grains-market-context:${input.cutoffBucket}:${input.reasonHash}`, dispatchId: `context-dispatch-${hash.slice(0, 24)}`, correlationId: `corr-context-${hash.slice(0, 24)}` }; }
function uuidFromHash(hash) { const value = hash.replace(/^sha256:/, "").padEnd(32, "0"); const variant = ((Number.parseInt(value[16] || "8", 16) & 3) | 8).toString(16); return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-${variant}${value.slice(17, 20)}-${value.slice(20, 32)}`; }
