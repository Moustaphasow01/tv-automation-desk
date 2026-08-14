import { canonicalSha256 } from "./execution-scope.js";
import { normalizeStrategySignalV1 } from "./strategy-signal-bus-v1.js";

export const STRATEGY_SHADOW_PARITY_SCHEMA_VERSION_V1 = "strategy_shadow_parity_report_v1";
export const STRATEGY_SHADOW_PARITY_STATUSES_V1 = Object.freeze([
  "PARITY_OK",
  "PARITY_MISMATCH",
  "PARITY_INVALID",
]);
export const STRATEGY_SHADOW_PARITY_OUTPUT_KINDS_V1 = Object.freeze(["SIGNAL", "NO_OP"]);

export function buildStrategyShadowParityReportV1(input = {}) {
  const issues = [];
  const simulation = normalizeParityOutput(input.simulation_output || input.simulation_signal, "simulation_output", issues);
  const shadow = normalizeParityOutput(input.shadow_output || input.shadow_signal, "shadow_output", issues);
  const comparison = compareParityOutputs(simulation, shadow);
  const status = parityStatus(issues, comparison);
  const report = {
    schema_version: STRATEGY_SHADOW_PARITY_SCHEMA_VERSION_V1,
    scenario_id: text(input.scenario_id || input.scenarioId) || "strategy-shadow-parity-fixture",
    strategy_version_id: text(input.strategy_version_id || input.strategyVersionId) || simulation.strategy_version_id || shadow.strategy_version_id,
    dataset_id: text(input.dataset_id || input.datasetId) || null,
    generated_at_utc: iso(input.generated_at_utc || input.generatedAtUtc || new Date().toISOString()),
    status,
    ok: status === "PARITY_OK",
    simulation,
    shadow,
    comparison,
    issues,
  };
  return Object.freeze({ ...report, report_hash: `sha256:${canonicalSha256(report)}` });
}

function normalizeParityOutput(raw = {}, path, issues) {
  const kind = outputKind(raw);
  if (kind === "SIGNAL") return normalizeSignalOutput(raw.signal || raw, path, issues);
  if (kind === "NO_OP") return normalizeNoopOutput(raw, path, issues);
  issues.push(issue("STRATEGY_SHADOW_PARITY_KIND_INVALID", path, { kind }));
  return { kind, reason: "INVALID_KIND", semantic_hash: null, payload_hash: null };
}

function normalizeSignalOutput(raw, path, issues) {
  const normalized = normalizeStrategySignalV1(raw || {});
  if (!normalized.ok) {
    for (const item of normalized.issues) issues.push(issue(item.code, `${path}.${item.path}`, item));
  }
  const signal = normalized.signal;
  return {
    kind: "SIGNAL",
    signal,
    strategy_version_id: signal.strategy_version_id || null,
    semantic_hash: `sha256:${canonicalSha256(semanticSignal(signal))}`,
    payload_hash: normalized.outbox.payload_hash,
    dedupe_key: normalized.outbox.dedupe_key,
  };
}

function normalizeNoopOutput(raw, path, issues) {
  const reason = text(raw.reason || raw.no_op_reason || raw.noOpReason);
  if (!reason) issues.push(issue("STRATEGY_SHADOW_PARITY_NOOP_REASON_REQUIRED", `${path}.reason`));
  return {
    kind: "NO_OP",
    reason: reason || "UNKNOWN",
    strategy_version_id: text(raw.strategy_version_id || raw.strategyVersionId) || null,
    semantic_hash: `sha256:${canonicalSha256({ kind: "NO_OP", reason: reason || "UNKNOWN" })}`,
    payload_hash: null,
    dedupe_key: null,
  };
}

function compareParityOutputs(simulation, shadow) {
  const field_diffs = fieldDiffs(simulation, shadow);
  const semantic_hash_match = simulation.semantic_hash === shadow.semantic_hash;
  const payload_hash_match = simulation.payload_hash === shadow.payload_hash;
  return {
    kind_match: simulation.kind === shadow.kind,
    semantic_hash_match,
    payload_hash_match,
    field_diffs,
    mismatch_count: field_diffs.length + (semantic_hash_match ? 0 : 1),
  };
}

function fieldDiffs(simulation, shadow) {
  if (simulation.kind !== shadow.kind) return [diff("kind", simulation.kind, shadow.kind)];
  if (simulation.kind === "NO_OP") return simulation.reason === shadow.reason ? [] : [diff("reason", simulation.reason, shadow.reason)];
  return signalFields()
    .map((field) => diff(field, simulation.signal?.[field], shadow.signal?.[field]))
    .filter((item) => item.simulation !== item.shadow);
}

function signalFields() {
  return [
    "strategy_instance_id",
    "strategy_version_id",
    "instrument",
    "direction",
    "confidence",
    "execution_mode_origin",
    "generated_at_utc",
    "expires_at_utc",
    "correlation_id",
  ];
}

function semanticSignal(signal = {}) {
  return {
    ...Object.fromEntries(signalFields().map((field) => [field, signal[field] ?? null])),
    payload: signal.payload || {},
  };
}

function parityStatus(issues, comparison) {
  if (issues.length) return "PARITY_INVALID";
  return comparison.mismatch_count === 0 ? "PARITY_OK" : "PARITY_MISMATCH";
}

function outputKind(raw = {}) {
  return String(raw.kind || (raw.signal || raw.signal_id || raw.id ? "SIGNAL" : "NO_OP")).toUpperCase();
}

function diff(field, simulation, shadow) {
  return { field, simulation: simulation ?? null, shadow: shadow ?? null };
}

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function iso(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function issue(code, path, extra = {}) {
  return { code, path, ...extra };
}
