import { canonicalSha256 } from "./execution-scope.js";
import { normalizeProposedTradePlanV1 } from "./trade-plan-economics-v1.js";

export const STRATEGY_SIGNAL_SCHEMA_VERSION_V1 = "strategy_signal_v1";
export const STRATEGY_SIGNAL_DIRECTIONS_V1 = Object.freeze(["LONG", "SHORT", "FLAT"]);
export const STRATEGY_SIGNAL_EXECUTION_MODES_V1 = Object.freeze(["SHADOW", "PAPER", "LIVE"]);

export function normalizeStrategySignalV1(input = {}) {
  const issues = [];
  const generatedAt = iso(firstDefined(input.generated_at_utc, input.generated_at, input.generatedAt));
  const expiresAt = iso(firstDefined(input.expires_at_utc, input.expires_at, input.expiresAt));
  const tradePlanInput = firstDefined(input.proposed_trade_plan, input.proposedTradePlan, input.trade_plan, input.tradePlan, input.payload?.proposed_trade_plan, input.payload?.proposedTradePlan);
  const tradePlan = tradePlanInput ? normalizeProposedTradePlanV1({
    ...object(tradePlanInput),
    instrument: firstDefined(input.instrument, object(tradePlanInput).instrument),
    direction: firstDefined(input.direction, object(tradePlanInput).direction),
    source_data_cutoff_utc: firstDefined(input.source_data_cutoff_utc, input.sourceDataCutoff, input.cutoff_at_utc, input.cutoffAtUtc, object(tradePlanInput).source_data_cutoff_utc),
  }) : null;
  const signal = {
    schema_version: STRATEGY_SIGNAL_SCHEMA_VERSION_V1,
    signal_id: requiredText(firstDefined(input.signal_id, input.id), "signal_id", issues),
    strategy_definition_id: optionalText(firstDefined(input.strategy_definition_id, input.strategyDefinitionId)),
    strategy_instance_id: requiredText(firstDefined(input.strategy_instance_id, input.strategyInstanceId), "strategy_instance_id", issues),
    strategy_version_id: optionalText(firstDefined(input.strategy_version_id, input.strategyVersionId)),
    instrument: requiredText(input.instrument, "instrument", issues).toUpperCase(),
    direction: enumValue(input.direction, STRATEGY_SIGNAL_DIRECTIONS_V1, "direction", issues),
    proposed_size: positiveNumberOrNull(firstDefined(
      input.proposed_size,
      input.proposedSize,
      input.size,
      input.quantity,
      input.contracts,
      input.payload?.proposed_size,
      input.payload?.proposedSize,
      input.payload?.size,
      input.payload?.quantity,
      input.payload?.contracts,
    )),
    confidence: numberOrNull(input.confidence),
    timeframe: optionalText(firstDefined(input.timeframe, input.time_frame, input.timeFrame)),
    session: optionalText(input.session),
    source_data_cutoff_utc: iso(firstDefined(input.source_data_cutoff_utc, input.sourceDataCutoff, input.cutoff_at_utc, input.cutoffAtUtc)),
    execution_mode_origin: enumValue(firstDefined(input.execution_mode_origin, input.executionModeOrigin), STRATEGY_SIGNAL_EXECUTION_MODES_V1, "execution_mode_origin", issues),
    generated_at_utc: generatedAt || issueValue("generated_at_utc", issues),
    expires_at_utc: expiresAt || issueValue("expires_at_utc", issues),
    correlation_id: requiredText(firstDefined(input.correlation_id, input.correlationId), "correlation_id", issues),
    setup: object(firstDefined(input.setup, input.payload?.setup)),
    predicates: array(firstDefined(input.predicates, input.payload?.predicates)),
    evidence: array(firstDefined(input.evidence, input.features, input.payload?.evidence, input.payload?.features)),
    reason_codes: array(firstDefined(input.reason_codes, input.reasonCodes, input.payload?.reason_codes)).map(String),
    signal_quality: object(firstDefined(input.signal_quality, input.signalQuality, input.payload?.signal_quality)),
    proposed_trade_plan: tradePlan?.proposed_trade_plan || null,
    trade_plan_economics: tradePlan?.economics || null,
    availability: tradePlan ? tradePlan.proposed_trade_plan.availability : "PARTIAL",
    payload: object(input.payload),
  };
  if (tradePlan?.issues?.length) signal.reason_codes = unique([...signal.reason_codes, ...tradePlan.issues.map((item) => item.code)]);
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

function positiveNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function array(value) {
  return Array.isArray(value) ? value : [];
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

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}
