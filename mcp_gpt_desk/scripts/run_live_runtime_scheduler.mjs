#!/usr/bin/env node
import process from "node:process";
import { createDeskStoreFromEnv } from "../src/store.js";
import { floorParisCheckpoint, liveRunId } from "../src/live-scope.js";
import { parisMarketSessionState } from "../src/market-session-state.js";
import {
  DETERMINISTIC_ENGINE_CADENCE_MINUTES,
  DETERMINISTIC_ENGINE_CADENCE_SECONDS,
  GPT_MONITOR_CADENCE_MINUTES,
  GPT_MONITOR_CADENCE_SECONDS,
  GPT_MONITOR_CADENCE_VALUE,
  criticalEngineEvents,
} from "../src/desk-monitor-cadence.js";

const pollMs = boundedNumber(process.env.DESK_LIVE_SCHEDULER_POLL_MS, 15_000, 5_000, 60_000);
const packRetryMs = boundedNumber(process.env.DESK_LIVE_PACK_RETRY_MS, 30_000, 5_000, 300_000);
const cursorReconcileMs = boundedNumber(process.env.DESK_LIVE_CURSOR_RECONCILE_MS, 60_000, 15_000, 300_000);
const macroRefreshMs = boundedNumber(process.env.DESK_MACRO_CALENDAR_REFRESH_MS, 2 * 60_000, 60_000, 6 * 60 * 60_000);
const macroCalendarEnabled = process.env.DESK_MACRO_CALENDAR_ENABLED !== "false";
const newsRefreshMs = boundedNumber(process.env.DESK_NEWS_REFRESH_MS, 15 * 60_000, 60_000, 6 * 60 * 60_000);
const newsEnabled = process.env.DESK_NEWS_ENABLED !== "false";
const store = createDeskStoreFromEnv();
const instanceId = String(process.env.DESK_SERVICE_INSTANCE_ID || `live-runtime-${process.pid}`);
const releaseVersion = String(process.env.DESK_RELEASE_VERSION || "unversioned");
let stopped = false;
let lockClient = null;
let lastEngineM1Key = "";
let lastGptMonitorKey = "";
let lastGptMonitorAttemptKey = "";
let lastGptMonitorAttemptAt = 0;
let lastPrewarmKey = "";
let lastPrewarmOutcome = null;
let lastCursorDate = "";
let lastCursorReconcileAt = 0;
let lastMacroRefreshAt = 0;
let lastMacroOutcome = null;
let lastNewsRefreshAt = 0;
let lastNewsOutcome = null;

process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });

try {
  await store.persistence.initialized;
  lockClient = await store.persistence.pool.connect();
  const lock = await lockClient.query("SELECT pg_try_advisory_lock(hashtext($1)) AS acquired", ["desk:live-runtime-scheduler"]);
  if (!lock.rows[0]?.acquired) throw new Error("LIVE_RUNTIME_SCHEDULER_ALREADY_RUNNING");
  await heartbeat("starting", { poll_ms: pollMs });

  while (!stopped) {
    const tickStarted = Date.now();
    try {
      const outcome = await runDueWork(new Date());
      const macroWarning = macroCalendarWarnsOnly(outcome.macro_calendar);
      const newsDegraded = outcome.news
        && !["READY", "DISABLED"].includes(outcome.news.status);
      // Macro/news are context enrichments. Provider throttling or partial
      // coverage must remain visible to the analyst and operator, but it must
      // not take the live scheduler out of service while canonical MNQ/MES
      // data, packs and deterministic engine state are ready.
      await heartbeat(outcome.data_state === "data_not_ready" ? "degraded" : "healthy", {
        last_engine_key: lastEngineM1Key || null,
        last_gpt_key: lastGptMonitorKey || null,
        engine_cadence_seconds: DETERMINISTIC_ENGINE_CADENCE_SECONDS,
        gpt_cadence_seconds: GPT_MONITOR_CADENCE_SECONDS,
        engine_late_after_seconds: 120,
        data_state: outcome.data_state,
        data_blocker: outcome.data_blocker || null,
        trading_date: outcome.trading_date,
        live_cursors: outcome.live_cursors || null,
        live_prewarm: outcome.live_prewarm || null,
        macro_calendar: outcome.macro_calendar || null,
        news: outcome.news || null,
        optional_dependency_warnings: [
          ...(macroWarning ? ["macro_calendar_provider_degraded_cached_coverage_ready"] : []),
          ...(newsDegraded ? ["news_provider_degraded"] : []),
        ],
        cycle_ms: Date.now() - tickStarted,
      });
    } catch (error) {
      log("live_runtime_cycle_failed", { error: error.message || String(error) });
      await heartbeat("degraded", { error: error.message || String(error) }).catch(() => undefined);
    }
    await delay(pollMs);
  }
} finally {
  await heartbeat("stopping", {}).catch(() => undefined);
  if (lockClient) {
    await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", ["desk:live-runtime-scheduler"]).catch(() => undefined);
    lockClient.release();
  }
  await store.persistence.close?.();
}

async function runDueWork(now) {
  const marketSession = parisMarketSessionState(now);
  const [macroCalendar, news] = await Promise.all([
    refreshMacroCalendarIfDue(now, marketSession.trading_date),
    refreshNewsIfDue(now),
  ]);
  if (marketSession.market_closed) {
    return {
      data_state: "market_closed",
      data_blocker: null,
      trading_date: marketSession.trading_date,
      macro_calendar: macroCalendar,
      news,
    };
  }
  const nowMs = now.getTime();
  const engineTimestampParis = floorParisCheckpoint(
    nowMs,
    DETERMINISTIC_ENGINE_CADENCE_MINUTES,
  );
  const gptCheckpointParis = floorParisCheckpoint(nowMs, GPT_MONITOR_CADENCE_MINUTES);
  const session = inferSession(engineTimestampParis);
  const tradingDate = engineTimestampParis.slice(0, 10);
  const strategyId = session === "ny_open" ? "ny_open_1530" : "asia_open";
  const engineM1Key = `${session}:${engineTimestampParis}`;
  const gptMonitorKey = `${session}:${gptCheckpointParis}`;
  let dataBlocker = null;
  let liveCursors = null;

  if (tradingDate !== lastCursorDate) {
    liveCursors = await store.ensureLiveDailyCursors({ trading_date: tradingDate });
    lastCursorDate = tradingDate;
    log("live_daily_cursors_ready", {
      trading_date: tradingDate,
      created: liveCursors.created,
      cursors: liveCursors.cursors.map((cursor) => cursor.cursor_id),
    });
  }

  if (nowMs - lastCursorReconcileAt >= cursorReconcileMs) {
    const reconciliation = await store.reconcileLiveCursors();
    lastCursorReconcileAt = nowMs;
    liveCursors = {
      ...(liveCursors || {}),
      reconciled: reconciliation.reconciled,
    };
  }

  const packAttemptDue = gptMonitorKey !== lastGptMonitorKey
    && (gptMonitorKey !== lastGptMonitorAttemptKey
      || nowMs - lastGptMonitorAttemptAt >= packRetryMs);
  if (packAttemptDue) {
    lastGptMonitorAttemptKey = gptMonitorKey;
    lastGptMonitorAttemptAt = nowMs;
    try {
      const prewarm = await store.prewarmNextLiveWork({ trading_date: tradingDate });
      lastPrewarmOutcome = projectPrewarmOutcome(prewarm);
      log("live_work_prewarm", {
        session,
        trading_date: tradingDate,
        checkpoint_paris: gptCheckpointParis,
        ...lastPrewarmOutcome,
      });
      if (prewarm.status === "PREWARM_DATA_NOT_READY") {
        dataBlocker = prewarm.error?.code
          || prewarm.data_quality?.blocker_code
          || prewarm.reason
          || "LIVE_PACK_DATA_NOT_READY";
      } else {
        // A non-due checkpoint (for example 00:00 before the 00:15 Master) is
        // healthy idle time, not a data outage. The live cursor owns the actual
        // due/claim rules; the scheduler only materializes the next eligible
        // work item.
        lastGptMonitorKey = gptMonitorKey;
        lastPrewarmKey = gptMonitorKey;
      }
    } catch (error) {
      if (!isDataNotReady(error)) throw error;
      dataBlocker = error.code || String(error.message || error).split(":")[0];
      lastPrewarmOutcome = {
        status: "PREWARM_DATA_NOT_READY",
        workflow: null,
        checkpoint: gptCheckpointParis,
        target_checkpoint: gptCheckpointParis,
        bundle_id: null,
        reason: dataBlocker,
      };
      log("live_work_prewarm_data_not_ready", { session, trading_date: tradingDate, checkpoint_paris: gptCheckpointParis, cadence: GPT_MONITOR_CADENCE_VALUE, code: dataBlocker });
    }
  } else if (gptMonitorKey !== lastGptMonitorKey) {
    dataBlocker = "LIVE_PACK_RETRY_WAIT";
  }

  if (engineM1Key !== lastEngineM1Key) {
    const result = await store.reconcileLivePaperExecution({
      strategy_id: strategyId,
      trading_date: tradingDate,
      session,
      run_id: liveRunId(tradingDate, session),
      mode: "live",
      timestamp_paris: engineTimestampParis,
      as_of_utc: new Date(engineTimestampParis).toISOString(),
    });
    log("live_paper_tick", {
      session,
      trading_date: tradingDate,
      timestamp_paris: engineTimestampParis,
      cadence: "1m",
      status: result.status,
    });
    const criticalEvents = criticalEngineEvents(result.events);
    if (criticalEvents.length > 0) {
      const eventTypes = [...new Set(criticalEvents.map((event) => event.event_type))];
      const armed = await store.armLiveEventMonitor({
        trading_date: tradingDate,
        checkpoint: engineTimestampParis,
        reason: "CRITICAL_ENGINE_EVENT",
        event_types: eventTypes,
      });
      log("live_event_monitor_arm", {
        session,
        trading_date: tradingDate,
        checkpoint_paris: engineTimestampParis,
        event_types: eventTypes,
        status: armed.status,
      });
      if (armed.status === "EVENT_MONITOR_ARMED") {
        const pack = await store.buildAndPublishLiveRollingPack({
          date: tradingDate,
          session,
          checkpoint_paris: engineTimestampParis,
        });
        const prewarm = await store.prewarmNextLiveWork({ trading_date: tradingDate });
        lastPrewarmOutcome = {
          status: prewarm.status,
          workflow: prewarm.workflow || null,
          checkpoint: prewarm.checkpoint || null,
          target_checkpoint: prewarm.target_checkpoint || null,
          bundle_id: prewarm.bundle_id || null,
          reason: prewarm.reason || null,
          trigger: "critical_engine_event",
          pack_build_id: pack?.pack_build_id || null,
        };
      }
    }
    lastEngineM1Key = engineM1Key;
  }
  return {
    data_state: dataBlocker ? "data_not_ready" : "ready",
    data_blocker: dataBlocker,
    trading_date: tradingDate,
    live_cursors: liveCursors,
    live_prewarm: lastPrewarmOutcome,
    macro_calendar: macroCalendar,
    news,
  };
}

async function refreshMacroCalendarIfDue(now, anchorDate) {
  if (!macroCalendarEnabled) return { status: "DISABLED" };
  const nowMs = now.getTime();
  if (lastMacroOutcome && nowMs - lastMacroRefreshAt < macroRefreshMs) return lastMacroOutcome;
  lastMacroRefreshAt = nowMs;
  try {
    const refreshed = await store.refreshMacroCalendar({
      anchor_date: anchorDate,
      requested_by: "live_runtime_scheduler",
    });
    lastMacroOutcome = {
      status: refreshed.status,
      fetched_at_utc: refreshed.fetched_at_utc || null,
      events_received: refreshed.events_received ?? null,
      events_written: refreshed.events_written ?? 0,
      next_trading_date: refreshed.coverage?.trading_window?.next_trading_date || null,
      next_trading_date_ready: refreshed.coverage?.next_trading_date_ready ?? false,
      missing_required_dates: refreshed.coverage?.missing_required_dates || [],
      error: refreshed.error || null,
    };
    log("macro_calendar_refreshed", lastMacroOutcome);
  } catch (error) {
    lastMacroOutcome = {
      status: "FETCH_FAILED",
      fetched_at_utc: null,
      events_received: null,
      events_written: 0,
      next_trading_date: null,
      next_trading_date_ready: false,
      missing_required_dates: [],
      error: error.message || String(error),
    };
    log("macro_calendar_refresh_failed", lastMacroOutcome);
  }
  return lastMacroOutcome;
}

async function refreshNewsIfDue(now) {
  if (!newsEnabled) return { status: "DISABLED" };
  const nowMs = now.getTime();
  if (lastNewsOutcome && nowMs - lastNewsRefreshAt < newsRefreshMs) return lastNewsOutcome;
  lastNewsRefreshAt = nowMs;
  try {
    const refreshed = await store.refreshNews({
      requested_by: "live_runtime_scheduler",
    });
    lastNewsOutcome = {
      status: refreshed.status,
      fetched_at_utc: refreshed.fetched_at_utc || null,
      received_count: refreshed.received_count ?? null,
      normalized_count: refreshed.normalized_count ?? null,
      inserted_count: refreshed.inserted_count ?? 0,
      updated_count: refreshed.updated_count ?? 0,
      discarded_count: refreshed.discarded_count ?? 0,
      error: refreshed.error || null,
    };
    log("news_refreshed", lastNewsOutcome);
  } catch (error) {
    lastNewsOutcome = {
      status: "FETCH_FAILED",
      fetched_at_utc: null,
      received_count: null,
      normalized_count: null,
      inserted_count: 0,
      updated_count: 0,
      discarded_count: 0,
      error: error.message || String(error),
    };
    log("news_refresh_failed", lastNewsOutcome);
  }
  return lastNewsOutcome;
}

async function heartbeat(status, details) {
  await store.persistence.pool.query(
    `INSERT INTO desk_service_heartbeats (
       service_id, service_kind, instance_id, release_version, status, details,
       started_at_utc, heartbeat_at_utc, updated_at_utc
     ) VALUES ($1, 'live_runtime_scheduler', $2, $3, $4, $5::jsonb, now(), now(), now())
     ON CONFLICT (service_id) DO UPDATE
       SET instance_id = EXCLUDED.instance_id,
           release_version = EXCLUDED.release_version,
           status = EXCLUDED.status,
           details = EXCLUDED.details,
           heartbeat_at_utc = now(),
           updated_at_utc = now()`,
    ["live_runtime_scheduler", instanceId, releaseVersion, status, JSON.stringify(details || {})],
  );
}

function inferSession(timestampParis) {
  return timestampParis.slice(11, 16) >= "15:30" ? "ny_open" : "asia_open";
}

function isDataNotReady(error) {
  return [
    "LOCAL_PACK_CORE_DATASET_MISSING",
    "LOCAL_PACK_CORE_DATASET_STALE",
    "LIVE_ROLLING_PACK_COVERAGE_INSUFFICIENT",
  ].includes(error?.code || String(error?.message || error).split(":")[0]);
}

function macroCalendarWarnsOnly(macroCalendar) {
  if (!macroCalendar || ["READY", "DISABLED"].includes(macroCalendar.status)) return false;
  return true;
}

function projectPrewarmOutcome(prewarm = {}) {
  return {
    status: prewarm.status || null,
    workflow: prewarm.workflow || null,
    checkpoint: prewarm.checkpoint || null,
    target_checkpoint: prewarm.target_checkpoint || null,
    bundle_id: prewarm.bundle_id || null,
    reason: prewarm.reason || prewarm.error?.code || null,
  };
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.floor(number))) : fallback;
}

function log(event, details) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...details }));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
