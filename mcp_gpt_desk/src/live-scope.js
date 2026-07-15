import { toParisIso } from "@tv-automation/desk-time";

const LIVE_MASTER_WORKFLOW_CONFIG = Object.freeze({
  asia_open: { strategy_id: "asia_open", session: "asia_open", cutoff_time: "00:15:00" },
  london_0800: { strategy_id: "asia_open", session: "asia_open", cutoff_time: "08:00:00" },
  london_1130: { strategy_id: "asia_open", session: "asia_open", cutoff_time: "11:30:00" },
  ny_open: { strategy_id: "ny_open_1530", session: "ny_open", cutoff_time: "15:30:00" },
  postevent_2030: { strategy_id: "ny_open_1530", session: "ny_open", cutoff_time: "20:30:00" },
});

const LIVE_MONITOR_WINDOWS = Object.freeze({
  asia_open: { from: "00:30", to: "14:45" },
  ny_open: { from: "15:45", to: "21:45" },
});

const LIVE_MONITOR_SETTLEMENT_LAG_MS = 2 * 60 * 1000;

export const LIVE_MASTER_WORKFLOWS = Object.freeze(Object.keys(LIVE_MASTER_WORKFLOW_CONFIG));

export function resolveLiveMasterJobInput(args = {}, now = Date.now()) {
  const workflow = String(args.workflow || canonicalMasterWorkflow(args.session) || "");
  const config = LIVE_MASTER_WORKFLOW_CONFIG[workflow];
  if (!config) throw new Error(`LIVE_MASTER_WORKFLOW_UNSUPPORTED:${workflow || "missing"}`);

  const nowMs = instantMs(now);
  const tradingDate = args.trading_date || parisDate(nowMs);
  const cutoffParis = normalizeParisInstant(
    args.cutoff_paris || parisWallTimeIso(tradingDate, config.cutoff_time),
  );
  const asOfUtc = normalizeUtc(args.as_of_utc || cutoffParis);
  assertSameInstant(cutoffParis, asOfUtc, "cutoff_paris", "as_of_utc");

  return {
    strategy_id: config.strategy_id,
    session: config.session,
    mode: args.mode || "live",
    trading_date: tradingDate,
    run_id: args.run_id || liveRunId(tradingDate, config.session),
    as_of_utc: asOfUtc,
    timezone: "Europe/Paris",
    cutoff_paris: cutoffParis,
    instruments: args.instruments || ["MNQ", "MES", "NQ", "ES"],
    include_raw_refs: args.include_raw_refs !== false,
    save: args.save !== false,
    lock_ttl_seconds: args.lock_ttl_seconds || 180,
    force_rebuild: args.force_rebuild === true,
    enqueue_agent_work: args.enqueue_agent_work !== false,
  };
}

export function resolveLiveMonitorJobInput(args = {}, now = Date.now()) {
  const nowMs = instantMs(now);
  const session = canonicalLiveSession(args.session);
  if (!session) throw new Error(`LIVE_MONITOR_SESSION_UNSUPPORTED:${args.session || "missing"}`);
  const timestampParis = normalizeParisInstant(args.timestamp_paris || floorParisCheckpoint(nowMs, 15));
  const tradingDate = args.trading_date || timestampParis.slice(0, 10);
  const asOfUtc = normalizeUtc(args.as_of_utc || timestampParis);
  assertSameInstant(timestampParis, asOfUtc, "timestamp_paris", "as_of_utc");

  return {
    strategy_id: session === "ny_open" ? "ny_open_1530" : "asia_open",
    session,
    mode: args.mode || "live",
    trading_date: tradingDate,
    run_id: args.run_id || liveRunId(tradingDate, session),
    as_of_utc: asOfUtc,
    timezone: "Europe/Paris",
    timestamp_paris: timestampParis,
    cadence: "15m",
    include_raw_refs: args.include_raw_refs !== false,
    save: args.save !== false,
    lock_ttl_seconds: args.lock_ttl_seconds || 180,
    force_rebuild: args.force_rebuild === true,
    enqueue_agent_work: args.enqueue_agent_work !== false,
  };
}

export function liveOperationalSelector(scope) {
  return {
    strategy_id: scope.strategy_id,
    session: scope.session,
    mode: scope.mode,
    trading_date: scope.trading_date,
    run_id: scope.run_id,
    as_of_utc: scope.as_of_utc,
  };
}

export function isLiveMonitorCheckpointInWindow(session, timestampParis) {
  const window = LIVE_MONITOR_WINDOWS[canonicalLiveSession(session)];
  if (!window) return false;
  const time = String(timestampParis || "").slice(11, 16);
  return time >= window.from && time <= window.to;
}

export function liveRunId(tradingDate, session) {
  return `front_live_${tradingDate}_${canonicalLiveSession(session) || session}`;
}

export function floorParisCheckpoint(now = Date.now(), cadenceMinutes = 15) {
  const paris = toParisIso(instantMs(now));
  const match = paris.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):\d{2}(?:\.\d+)?([+-]\d{2}:\d{2})$/);
  if (!match) throw new Error(`PARIS_TIMESTAMP_INVALID:${paris}`);
  const minute = Math.floor(Number(match[3]) / cadenceMinutes) * cadenceMinutes;
  return `${match[1]}T${match[2]}:${String(minute).padStart(2, "0")}:00${match[4]}`;
}

export function buildLiveMonitorCatchupPlan({
  session,
  tradingDate,
  masterCutoffParis,
  masterMaterializedAtParis,
  cadenceMinutes = 15,
  settlementLagMs = LIVE_MONITOR_SETTLEMENT_LAG_MS,
} = {}) {
  const cutoffMs = instantMs(masterCutoffParis);
  const materializedMs = instantMs(masterMaterializedAtParis);
  const checkpointParis = floorParisCheckpoint(materializedMs - settlementLagMs, cadenceMinutes);
  const checkpointMs = instantMs(checkpointParis);
  const expectedTradingDate = tradingDate || String(masterCutoffParis || "").slice(0, 10);
  const base = {
    catchup_mode: true,
    master_cutoff_paris: toParisIso(cutoffMs).replace(/\.\d{3}/, ""),
    master_materialized_at_paris: toParisIso(materializedMs).replace(/\.\d{3}/, ""),
    monitor_checkpoint_paris: checkpointParis,
    cadence: `${cadenceMinutes}m`,
    data_settlement_lag_seconds: Math.round(settlementLagMs / 1000),
    skipped_checkpoints: [],
    skipped_checkpoint_count: 0,
  };

  if (checkpointParis.slice(0, 10) !== expectedTradingDate) {
    return { ...base, required: false, skipped_reason: "trading_day_elapsed" };
  }
  if (checkpointMs <= cutoffMs) {
    return { ...base, required: false, skipped_reason: "no_closed_monitor_checkpoint_after_master" };
  }
  if (!isLiveMonitorCheckpointInWindow(session, checkpointParis)) {
    return { ...base, required: false, skipped_reason: "outside_live_monitor_window" };
  }

  const firstCheckpointMs = instantMs(floorParisCheckpoint(cutoffMs, cadenceMinutes)) + cadenceMinutes * 60 * 1000;
  const skipped = [];
  for (let cursor = firstCheckpointMs; cursor < checkpointMs && skipped.length < 96; cursor += cadenceMinutes * 60 * 1000) {
    const candidate = toParisIso(cursor).replace(/\.\d{3}/, "");
    if (candidate.slice(0, 10) === expectedTradingDate && isLiveMonitorCheckpointInWindow(session, candidate)) skipped.push(candidate);
  }
  return {
    ...base,
    required: true,
    skipped_checkpoints: skipped,
    skipped_checkpoint_count: skipped.length,
    analysis_window: {
      from_paris: toParisIso(cutoffMs).replace(/\.\d{3}/, ""),
      to_paris: checkpointParis,
    },
  };
}

export function parisWallTimeIso(date, time) {
  const [year, month, day] = String(date).split("-").map(Number);
  const [hour, minute, second = 0] = String(time).split(":").map(Number);
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) {
    throw new Error(`PARIS_WALL_TIME_INVALID:${date}T${time}`);
  }
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let epochMs = desiredAsUtc;
  for (let index = 0; index < 3; index += 1) {
    const parts = parisCalendarParts(epochMs);
    const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    epochMs += desiredAsUtc - representedAsUtc;
  }
  const offset = toParisIso(epochMs).slice(-6);
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}${offset}`;
}

function canonicalMasterWorkflow(session) {
  if (session === "asia_open") return "asia_open";
  if (session === "london_session") return "london_0800";
  if (session === "ny_open") return "ny_open";
  if (session === "post_event_replan" || session === "work_forward") return "postevent_2030";
  return null;
}

function canonicalLiveSession(session) {
  if (["asia_open", "london_session"].includes(session)) return "asia_open";
  if (["ny_open", "post_event_replan", "work_forward"].includes(session)) return "ny_open";
  return null;
}

function normalizeParisInstant(value) {
  const text = String(value || "").trim();
  const epochMs = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)
    ? Date.parse(text)
    : Date.parse(parisWallTimeIso(text.slice(0, 10), text.slice(11, 19) || "00:00:00"));
  if (!Number.isFinite(epochMs)) throw new Error(`PARIS_TIMESTAMP_INVALID:${text}`);
  return toParisIso(epochMs).replace(/\.\d{3}/, "");
}

function normalizeUtc(value) {
  const epochMs = Date.parse(String(value || ""));
  if (!Number.isFinite(epochMs)) throw new Error(`UTC_TIMESTAMP_INVALID:${value}`);
  return new Date(epochMs).toISOString();
}

function assertSameInstant(left, right, leftName, rightName) {
  if (Date.parse(left) !== Date.parse(right)) {
    throw new Error(`LIVE_SCOPE_INSTANT_MISMATCH:${leftName}:${rightName}`);
  }
}

function parisDate(epochMs) {
  return toParisIso(epochMs).slice(0, 10);
}

function parisCalendarParts(epochMs) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochMs)).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return values;
}

function instantMs(value) {
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new Error(`INSTANT_INVALID:${value}`);
  return parsed;
}
