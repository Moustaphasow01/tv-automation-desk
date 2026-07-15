import { createHash } from "node:crypto";

export const DESK_SCOPE_SCHEMA_VERSION = "1.0.0";
export const DESK_TIMEZONE = "Europe/Paris";
export const DESK_EXECUTION_MODES = Object.freeze(["live", "paper", "replay", "backtest"]);

export const DESK_STRATEGY_REGISTRY = Object.freeze({
  ny_open_1530: Object.freeze({
    strategy_id: "ny_open_1530",
    session: "ny_open",
    cutoff_time_paris: "15:30:00",
  }),
  asia_open: Object.freeze({
    strategy_id: "asia_open",
    session: "asia_open",
    cutoff_time_paris: "00:15:00",
  }),
});

export class DeskScopeError extends Error {
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = "DeskScopeError";
    this.code = code;
    this.details = details;
  }
}

export function canonicalJson(value) {
  return JSON.stringify(sortCanonical(value));
}

export function canonicalSha256(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function defaultCutoffParis(strategyId, tradingDate) {
  const strategy = strategyDefinition(strategyId);
  assertDate(tradingDate, "trading_date");
  const utcProbe = Date.parse(`${tradingDate}T12:00:00Z`);
  const offset = parisOffset(new Date(utcProbe));
  return `${tradingDate}T${strategy.cutoff_time_paris}${offset}`;
}

export function createDeskExecutionScope(input = {}, options = {}) {
  const strategyId = requiredString(input.strategy_id, "strategy_id");
  const strategy = strategyDefinition(strategyId);
  const session = requiredString(input.session, "session");
  const mode = requiredString(input.mode, "mode");
  const tradingDate = requiredString(input.trading_date, "trading_date");
  const timezone = requiredString(input.timezone, "timezone");
  const cutoffParis = requiredString(input.cutoff_paris, "cutoff_paris");
  const cutoffUtcInput = requiredString(input.cutoff_utc, "cutoff_utc");

  if (strategy.session !== session) {
    throw new DeskScopeError(
      "STRATEGY_SESSION_MISMATCH",
      `Strategy ${strategyId} belongs to ${strategy.session}, not ${session}.`,
      { strategy_id: strategyId, expected_session: strategy.session, actual_session: session },
    );
  }
  if (!DESK_EXECUTION_MODES.includes(mode)) {
    throw new DeskScopeError("INVALID_SCOPE", `Unsupported execution mode: ${mode}.`, { field: "mode", value: mode });
  }
  assertDate(tradingDate, "trading_date");
  if (timezone !== DESK_TIMEZONE) {
    throw new DeskScopeError("TIMEZONE_INVALID", `Timezone must be ${DESK_TIMEZONE}.`, { timezone });
  }

  const cutoffParisMs = parseIso(cutoffParis, "cutoff_paris");
  const cutoffUtcMs = parseIso(cutoffUtcInput, "cutoff_utc");
  if (cutoffParisMs !== cutoffUtcMs) {
    throw new DeskScopeError("INVALID_SCOPE", "cutoff_paris and cutoff_utc do not identify the same instant.", {
      cutoff_paris: cutoffParis,
      cutoff_utc: cutoffUtcInput,
    });
  }
  if (!hasParisOffset(cutoffParis, cutoffParisMs)) {
    throw new DeskScopeError("TIMEZONE_INVALID", "cutoff_paris does not use the Europe/Paris offset for that instant.", {
      cutoff_paris: cutoffParis,
      expected_offset: parisOffset(new Date(cutoffParisMs)),
    });
  }

  const backtestId = optionalString(input.backtest_id);
  const runId = optionalString(input.run_id);
  const packId = optionalString(input.pack_id);
  const packBuildId = optionalString(input.pack_build_id);
  if (["replay", "backtest"].includes(mode)) {
    requireReplayField(backtestId, "backtest_id");
    requireReplayField(packId, "pack_id");
    requireReplayField(packBuildId, "pack_build_id");
  } else if (backtestId && options.allowLiveBacktestId !== true) {
    throw new DeskScopeError("INVALID_SCOPE", `backtest_id is forbidden in ${mode} mode.`, { mode, backtest_id: backtestId });
  }
  if (options.requirePack === true) {
    requiredString(packId, "pack_id");
  }
  if (options.requirePackBuild === true) {
    requiredString(packBuildId, "pack_build_id");
  }
  if (options.requireRun === true) {
    requiredString(runId, "run_id");
  }

  const scope = stripUndefined({
    scope_schema_version: DESK_SCOPE_SCHEMA_VERSION,
    strategy_id: strategyId,
    session,
    mode,
    trading_date: tradingDate,
    timezone,
    cutoff_paris: cutoffParis,
    cutoff_utc: new Date(cutoffUtcMs).toISOString(),
    run_id: runId || null,
    backtest_id: backtestId || null,
    pack_id: packId || null,
    pack_build_id: packBuildId || null,
  });
  return Object.freeze({ ...scope, scope_hash: canonicalSha256(scope) });
}

export function assertSameExecutionScope(parent, child, options = {}) {
  const parentScope = scopeWithoutHash(parent);
  const childScope = scopeWithoutHash(child);
  const fields = options.fields || [
    "strategy_id",
    "session",
    "mode",
    "trading_date",
    "timezone",
    "cutoff_paris",
    "cutoff_utc",
    "run_id",
    "backtest_id",
    "pack_id",
    "pack_build_id",
  ];
  const mismatches = fields
    .filter((field) => normalizeNullable(parentScope[field]) !== normalizeNullable(childScope[field]))
    .map((field) => ({ field, parent: parentScope[field] ?? null, child: childScope[field] ?? null }));
  if (mismatches.length) {
    throw new DeskScopeError("CROSS_SCOPE_REFERENCE", "Linked documents do not share the same execution scope.", { mismatches });
  }
  return true;
}

export function strategyDefinition(strategyId) {
  const strategy = DESK_STRATEGY_REGISTRY[strategyId];
  if (!strategy) {
    throw new DeskScopeError("INVALID_SCOPE", `Unknown strategy_id: ${strategyId}.`, { strategy_id: strategyId });
  }
  return strategy;
}

function scopeWithoutHash(value = {}) {
  const scope = value.resolved_scope || value.scope || value;
  return Object.fromEntries(Object.entries(scope || {}).filter(([key]) => key !== "scope_hash"));
}

function requiredString(value, field) {
  const text = optionalString(value);
  if (!text) {
    throw new DeskScopeError("SCOPE_REQUIRED", `${field} is required.`, { field });
  }
  return text;
}

function optionalString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function requireReplayField(value, field) {
  if (!value) {
    throw new DeskScopeError("SCOPE_REQUIRED", `${field} is required for replay/backtest.`, { field });
  }
}

function assertDate(value, field) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new DeskScopeError("INVALID_SCOPE", `${field} must be an ISO date.`, { field, value });
  }
}

function parseIso(value, field) {
  if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) {
    throw new DeskScopeError("TIMEZONE_INVALID", `${field} must include an explicit UTC offset.`, { field, value });
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new DeskScopeError("INVALID_SCOPE", `${field} must be a valid ISO timestamp.`, { field, value });
  }
  return parsed;
}

function hasParisOffset(value, epochMs) {
  const match = String(value).match(/([+-]\d{2}:?\d{2})$/);
  if (!match) return false;
  const actual = match[1].includes(":") ? match[1] : `${match[1].slice(0, 3)}:${match[1].slice(3)}`;
  return actual === parisOffset(new Date(epochMs));
}

function parisOffset(date) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: DESK_TIMEZONE,
    timeZoneName: "shortOffset",
  }).formatToParts(date);
  const value = parts.find((part) => part.type === "timeZoneName")?.value || "";
  const match = value.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!match) {
    throw new DeskScopeError("TIMEZONE_INVALID", `Unable to resolve ${DESK_TIMEZONE} offset.`, { value });
  }
  return `${match[1]}${match[2].padStart(2, "0")}:${(match[3] || "00").padStart(2, "0")}`;
}

function sortCanonical(value) {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, sortCanonical(value[key])]),
  );
}

function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function normalizeNullable(value) {
  return value === undefined ? null : value;
}
