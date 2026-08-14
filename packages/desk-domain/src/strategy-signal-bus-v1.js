import { canonicalSha256 } from "./execution-scope.js";

export const STRATEGY_SIGNAL_SCHEMA_VERSION_V1 = "strategy_signal_v1";
export const STRATEGY_SIGNAL_DIRECTIONS_V1 = Object.freeze(["LONG", "SHORT", "FLAT"]);
export const STRATEGY_SIGNAL_EXECUTION_MODES_V1 = Object.freeze(["SHADOW", "PAPER", "LIVE"]);

export function normalizeStrategySignalV1(input = {}) {
  const issues = [];
  const generatedAt = iso(firstDefined(input.generated_at_utc, input.generated_at, input.generatedAt));
  const expiresAt = iso(firstDefined(input.expires_at_utc, input.expires_at, input.expiresAt));
  const signal = {
    schema_version: STRATEGY_SIGNAL_SCHEMA_VERSION_V1,
    signal_id: requiredText(firstDefined(input.signal_id, input.id), "signal_id", issues),
    strategy_instance_id: requiredText(firstDefined(input.strategy_instance_id, input.strategyInstanceId), "strategy_instance_id", issues),
    strategy_version_id: optionalText(firstDefined(input.strategy_version_id, input.strategyVersionId)),
    instrument: requiredText(input.instrument, "instrument", issues).toUpperCase(),
    direction: enumValue(input.direction, STRATEGY_SIGNAL_DIRECTIONS_V1, "direction", issues),
    confidence: numberOrNull(input.confidence),
    execution_mode_origin: enumValue(firstDefined(input.execution_mode_origin, input.executionModeOrigin), STRATEGY_SIGNAL_EXECUTION_MODES_V1, "execution_mode_origin", issues),
    generated_at_utc: generatedAt || issueValue("generated_at_utc", issues),
    expires_at_utc: expiresAt || issueValue("expires_at_utc", issues),
    correlation_id: requiredText(firstDefined(input.correlation_id, input.correlationId), "correlation_id", issues),
    payload: object(input.payload),
  };
  if (generatedAt && expiresAt && Date.parse(expiresAt) <= Date.parse(generatedAt)) {
    issues.push(issue("STRATEGY_SIGNAL_EXPIRY_NOT_AFTER_GENERATION", "expires_at_utc"));
  }
  const dedupeKey = optionalText(firstDefined(input.dedupe_key, input.dedupeKey)) || signalDedupeKey(signal);
  return {
    ok: issues.length === 0,
    reasons: issues.map((item) => item.code),
    issues,
    signal,
    outbox: { dedupe_key: dedupeKey, payload_hash: `sha256:${canonicalSha256(signal)}` },
  };
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

export function strategySignalEnvelopeV1(signal = {}) {
  return {
    schema_version: "desk_event_envelope_v1",
    type: "signal.emitted",
    id: signal.signal_id || null,
    occurred_at_utc: signal.generated_at_utc || null,
    aggregate_type: "strategy_signal",
    aggregate_id: signal.signal_id || null,
    payload: { ...signal },
  };
}

function signalDedupeKey(signal) {
  return `strategy_signal:${canonicalSha256({
    strategy_instance_id: signal.strategy_instance_id,
    instrument: signal.instrument,
    direction: signal.direction,
    generated_at_utc: signal.generated_at_utc,
    correlation_id: signal.correlation_id,
  })}`;
}

function enumValue(value, allowed, path, issues) {
  const normalized = String(value || "").toUpperCase();
  if (allowed.includes(normalized)) return normalized;
  issues.push(issue("STRATEGY_SIGNAL_ENUM_INVALID", path, { value }));
  return normalized || null;
}

function requiredText(value, path, issues) {
  const normalized = optionalText(value);
  if (normalized) return normalized;
  issues.push(issue("STRATEGY_SIGNAL_REQUIRED", path));
  return "";
}

function optionalText(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function issueValue(path, issues) {
  issues.push(issue("STRATEGY_SIGNAL_REQUIRED", path));
  return "";
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function iso(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function issue(code, path, extra = {}) {
  return { code, path, ...extra };
}
