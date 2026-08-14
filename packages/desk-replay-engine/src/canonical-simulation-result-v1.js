import { canonicalSha256 } from "@tv-automation/desk-domain";
import { buildVersionedSimulationMetricsV1 } from "./simulation-metrics-v1.js";

export function buildMetrics(positions, context = {}) {
  return buildVersionedSimulationMetricsV1(positions, context);
}

export function finalizeResult(result) {
  const metricsHash = `sha256:${canonicalSha256(result.metrics || {})}`;
  const withoutHashes = { ...result, metrics_hash: metricsHash };
  return Object.freeze({
    ...withoutHashes,
    metrics_hash: metricsHash,
    content_hash: `sha256:${canonicalSha256(withoutHashes)}`,
  });
}

export function event(type, payload) {
  return { event_id: `evt_${type.toLowerCase()}_${canonicalSha256(payload).slice(0, 12)}`, type, payload };
}

export function positionEventProjection(position) {
  return {
    position_id: position.position_id,
    setup_id: position.setup_id,
    instrument: position.instrument,
    direction: position.direction,
    status: position.status,
    entry_price: position.entry_price,
    exit_price: position.exit_price ?? null,
    r_result: position.r_result ?? null,
    unrealized_r: position.unrealized_r ?? null,
  };
}

export function emptyMetrics() {
  return {
    schema_version: "canonical_simulation_metrics_v1",
    metric_version: "1.0.0",
    trade_count: 0,
    open_position_count: 0,
    total_r: 0,
    win_count: 0,
    loss_count: 0,
    win_rate: 0,
    max_drawdown_r: 0,
    final_equity_r: 0,
  };
}

export function parseTime(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

export function firstText(values) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

export function firstFiniteNumber(values) {
  for (const value of values) {
    const normalized = number(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

export function fallbackSimulationRunId(strategyVersionId, datasetId, parameters, reproducibilitySeed) {
  const fingerprint = canonicalSha256({
    strategy_version_id: strategyVersionId,
    dataset_id: datasetId,
    parameters,
    reproducibility_seed: reproducibilitySeed,
  }).slice(0, 16);
  return `sim_${fingerprint}`;
}

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function winRate(closedPositions) {
  if (closedPositions.length === 0) return 0;
  const wins = closedPositions.filter((position) => Number(position.r_result || 0) > 0).length;
  return round(wins / closedPositions.length, 4);
}

function maxDrawdown(values) {
  let peak = 0;
  let drawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    drawdown = Math.min(drawdown, round(value - peak, 4));
  }
  return drawdown;
}
