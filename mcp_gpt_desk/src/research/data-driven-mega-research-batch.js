import { createHash } from "node:crypto";
import {
  canonicalJson,
  canonicalSha256,
  STRATEGY_DSL_SCHEMA_VERSION_V1,
  STRATEGY_PATTERN_BREAKOUT_RETEST_V1,
} from "@tv-automation/desk-domain";
import { runCanonicalSimulationV1 } from "@tv-automation/desk-replay-engine";
import { toParisIso } from "@tv-automation/desk-time";
import { createResearchExperimentRegistryService } from "../research-experiment-registry-service.js";
import { enqueueResearchAgentTask } from "./research-agent-task-queue.js";
import {
  DATA_DRIVEN_FAMILY_SET_V1,
  DATA_DRIVEN_STRATEGY_FAMILIES,
  dataDrivenAnchorForFamily,
  dataDrivenParameterCombination,
  getDataDrivenStrategyFamilies,
  normalizeDataDrivenFamilySet,
} from "./data-driven-strategy-family-catalog.js";
import {
  buildExperiment,
  buildVariantSeed,
  compileVersion,
  enqueueReviewTask,
  registerCandidateAndEvaluation,
  registerDefinition,
  registerFamilyHypotheses,
  registerSimulation,
  registerVersion,
  runSimulation,
} from "./data-driven-mega-research-registration.js";
import {
  buildDataDrivenMegaResearchPlan,
  processVariantsWithConcurrency,
} from "./data-driven-mega-research-plan.js";

export { buildDataDrivenMegaResearchPlan } from "./data-driven-mega-research-plan.js";

export const DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION = "data_driven_mega_research_batch_v1";
export { DATA_DRIVEN_STRATEGY_FAMILIES } from "./data-driven-strategy-family-catalog.js";

const DEFAULT_SCOPE = Object.freeze({
  batch_id: "mega-1000-mnq-m5",
  symbol_code: "MNQ1!",
  instrument: "MNQ",
  timeframe: "5",
  start_utc: "2026-06-01T00:00:00.000Z",
  end_utc: "2026-08-17T00:00:00.000Z",
  dataset_key: "data-driven-mega.mnq.m5.2026-06-01_2026-08-17",
  count: 1_000,
  family_set: DATA_DRIVEN_FAMILY_SET_V1,
  setups_per_variant: 5,
});

export async function bootstrapDataDrivenMegaResearchBatch({ store, input = {}, actor = {} } = {}) {
  assertStore(store);
  const scope = normalizeScope(input);
  const operationTime = operationTimestamp(store);
  const maxConcurrency = boundedInteger(input.max_concurrency || input.maxConcurrency, 1, 1, 12);
  const rows = await loadMarketRows(store.persistence.pool, scope);
  assertResearchCoverage(rows, scope);
  const dataset = buildDataset(scope, rows);
  await upsertDataset(store.persistence.pool, dataset);

  const tradingDays = buildTradingDays(rows);
  const familySpecs = getDataDrivenStrategyFamilies(scope.family_set);
  const experimentIds = stableExperimentIds(scope);
  const registry = store.researchRegistry || createResearchExperimentRegistryService({ persistence: store.persistence, clock: store.clock });
  const command = commandContext(actor, input, experimentIds);
  await registry.registerExperiment(buildExperiment({ scope, dataset, ids: experimentIds, timestamp: operationTime }), command);
  const hypotheses = await registerFamilyHypotheses({ registry, scope, ids: experimentIds, familySpecs, timestamp: operationTime, command });
  const variants = buildDataDrivenMegaResearchPlan({ scope, dataset, tradingDays, count: scope.count });

  const counters = {
    requested: scope.count,
    generated: variants.length,
    definitions_created: 0,
    versions_created: 0,
    compiled: 0,
    simulations_recorded: 0,
    candidates_recorded: 0,
    validation_reports_recorded: 0,
    agent_tasks_created: 0,
    agent_tasks_existing: 0,
    failed: 0,
  };
  const byFamily = new Map();
  const best = [];
  const failures = [];

  await processVariantsWithConcurrency(variants, maxConcurrency, async (variant) => {
    try {
      const familyIds = hypotheses.get(variant.family_id);
      const ids = stableVariantIds(scope, variant);
      const seed = buildVariantSeed({ scope, dataset, tradingDays, variant, ids, familyIds, timestamp: operationTime });
      const definition = await registerDefinition(store, seed, command);
      if (definition.status === "CREATED") counters.definitions_created += 1;
      const version = await registerVersion(store, seed, command);
      if (version.status === "CREATED") counters.versions_created += 1;
      const compilation = await compileVersion(store, seed, command);
      counters.compiled += 1;
      const simulation = runSimulation(seed, dataset, rows, compilation);
      const registered = await registerSimulation(store, seed, dataset, simulation, compilation, command);
      counters.simulations_recorded += 1;
      const research = await registerCandidateAndEvaluation({ registry, seed, registered, simulation, command });
      counters.candidates_recorded += 1;
      counters.validation_reports_recorded += 1;
      const task = await enqueueReviewTask(store.persistence.pool, { seed, dataset, registered, research, operationTime });
      if (task.status === "CREATED") counters.agent_tasks_created += 1;
      if (task.status === "EXISTING") counters.agent_tasks_existing += 1;
      recordFamily(byFamily, variant, simulation.metrics || {});
      pushBest(best, seed, simulation.metrics || {}, registered.run);
    } catch (error) {
      counters.failed += 1;
      if (failures.length < 25) {
        failures.push({
          family_id: variant.family_id,
          variant_index: variant.variant_index,
          code: error?.code || "ERROR",
          message: error?.message || String(error),
          details: error?.details || null,
        });
      }
    }
  });

  store.researchRegistry = registry;
  return {
    status: counters.failed === 0 ? "READY" : "PARTIAL",
    schema_version: DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION,
    generated_at_utc: new Date().toISOString(),
    scope,
    dataset: datasetSummary(dataset, rows),
    diversity: {
      family_set: scope.family_set,
      family_count: familySpecs.length,
      families: [...byFamily.values()].sort((left, right) => left.family_id.localeCompare(right.family_id)),
    },
    counters,
    processing: {
      max_concurrency: maxConcurrency,
    },
    top_initial_results: best.sort((left, right) => right.total_r - left.total_r).slice(0, 20),
    failures,
    safety: {
      broker_execution_enabled: false,
      broker_commands_created: 0,
      lane: "research",
      execution_mode: "SHADOW",
    },
  };
}

function normalizeScope(input = {}) {
  const start = iso(input.start_utc || input.startUtc, DEFAULT_SCOPE.start_utc);
  const end = iso(input.end_utc || input.endUtc, DEFAULT_SCOPE.end_utc);
  const instrument = text(input.instrument, DEFAULT_SCOPE.instrument).toUpperCase();
  const timeframe = text(input.timeframe, DEFAULT_SCOPE.timeframe);
  const batch = safeKey(text(input.batch_id || input.batchId, DEFAULT_SCOPE.batch_id));
  const familySet = normalizeDataDrivenFamilySet(input.family_set || input.familySet || DEFAULT_SCOPE.family_set);
  return {
    batch_id: batch,
    symbol_code: text(input.symbol_code || input.symbolCode, DEFAULT_SCOPE.symbol_code),
    instrument,
    timeframe,
    start_utc: start,
    end_utc: end,
    dataset_key: safeKey(text(input.dataset_key || input.datasetKey, `${batch}.${instrument.toLowerCase()}.m${timeframe}.${start.slice(0, 10)}_${end.slice(0, 10)}`)),
    count: boundedInteger(input.count, DEFAULT_SCOPE.count, 1, 10_000),
    family_set: familySet,
    setups_per_variant: boundedInteger(
      input.setups_per_variant || input.setupsPerVariant,
      DEFAULT_SCOPE.setups_per_variant,
      1,
      5,
    ),
  };
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

function assertResearchCoverage(rows, scope) {
  const rangeDays = (Date.parse(scope.end_utc) - Date.parse(scope.start_utc)) / 86_400_000;
  const tradingDays = new Set(rows.map((row) => row.trading_date).filter(Boolean)).size;
  if (rangeDays < 30 || tradingDays < 15 || rows.length < 1_000) {
    throw coded("DATA_DRIVEN_RESEARCH_COVERAGE_INSUFFICIENT", "Cumulative market dataset is not sufficient for mega research batch.", {
      range_days: rangeDays,
      trading_days: tradingDays,
      rows: rows.length,
      scope,
    });
  }
}

function buildDataset(scope, rows) {
  const contentHash = hashValue({ scope, row_count: rows.length, first: rows[0], last: rows.at(-1) });
  const buildHash = hashValue({ bootstrap: DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION, scope });
  return {
    dataset_id: uuidFromValue({ kind: "dataset", key: scope.dataset_key }),
    dataset_key: scope.dataset_key,
    name: `Data-driven mega research ${scope.instrument} M${scope.timeframe}`,
    status: "READY",
    time_range_start_utc: scope.start_utc,
    time_range_end_utc: scope.end_utc,
    cutoff_utc: scope.end_utc,
    cutoff_paris: toParisIso(Date.parse(scope.end_utc)),
    schema_version: "market_candle_dataset_v1",
    source_batch_count: 1,
    content_hash: contentHash,
    provenance_hash: hashValue({ source: "market_candles", content_hash: contentHash }),
    build_parameters_hash: buildHash,
    metadata: {
      instrument: scope.instrument,
      symbol_code: scope.symbol_code,
      timeframe: `M${scope.timeframe}`,
      rows: rows.length,
      generator: DATA_DRIVEN_MEGA_RESEARCH_BATCH_VERSION,
      family_set: scope.family_set,
      setups_per_variant: scope.setups_per_variant,
    },
  };
}

async function upsertDataset(pool, dataset) {
  await pool.query(
    `INSERT INTO datasets (
       dataset_id, dataset_key, name, status, time_range_start_utc, time_range_end_utc,
       cutoff_utc, cutoff_paris, schema_version, source_batch_count, content_hash,
       provenance_hash, build_parameters_hash, metadata, created_at_utc, updated_at_utc
     ) VALUES ($1,$2,$3,$4::dataset_status,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$15)
     ON CONFLICT (dataset_id) DO UPDATE SET
       dataset_key = EXCLUDED.dataset_key, name = EXCLUDED.name, status = EXCLUDED.status,
       time_range_start_utc = EXCLUDED.time_range_start_utc, time_range_end_utc = EXCLUDED.time_range_end_utc,
       cutoff_utc = EXCLUDED.cutoff_utc, cutoff_paris = EXCLUDED.cutoff_paris,
       schema_version = EXCLUDED.schema_version, source_batch_count = EXCLUDED.source_batch_count,
       content_hash = EXCLUDED.content_hash, provenance_hash = EXCLUDED.provenance_hash,
       build_parameters_hash = EXCLUDED.build_parameters_hash, metadata = EXCLUDED.metadata,
       updated_at_utc = EXCLUDED.updated_at_utc`,
    [
      dataset.dataset_id, dataset.dataset_key, dataset.name, dataset.status, dataset.time_range_start_utc,
      dataset.time_range_end_utc, dataset.cutoff_utc, dataset.cutoff_paris, dataset.schema_version,
      dataset.source_batch_count, dataset.content_hash, dataset.provenance_hash,
      dataset.build_parameters_hash, JSON.stringify(dataset.metadata), dataset.cutoff_utc,
    ],
  );
}

function buildTradingDays(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row.trading_date || row.time.slice(0, 10);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const days = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([trading_date, dayRows]) => summarizeDay(trading_date, dayRows));
  const ranges = days.map((day) => day.range).sort((a, b) => a - b);
  const p35 = percentile(ranges, 0.35) || 0;
  const highs = days.map((day) => day.high).sort((a, b) => a - b);
  const lows = days.map((day) => day.low).sort((a, b) => a - b);
  for (let index = 0; index < days.length; index += 1) {
    days[index].previous = days[index - 1] || null;
    days[index].dataset_stats = {
      range_p35: p35,
      range_p35_high: percentile(highs, 0.65) || days[index].high,
      range_p35_low: percentile(lows, 0.35) || days[index].low,
    };
  }
  return days;
}

function summarizeDay(trading_date, rows) {
  const sorted = [...rows].sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
  const high = Math.max(...sorted.map((row) => row.high));
  const low = Math.min(...sorted.map((row) => row.low));
  const typicalVolume = sorted.reduce((sum, row) => sum + Math.max(1, row.volume || 1), 0);
  const vwap = sorted.reduce((sum, row) => sum + ((row.high + row.low + row.close) / 3) * Math.max(1, row.volume || 1), 0) / typicalVolume;
  const opening = (bars) => rangeSummary(sorted.slice(0, Math.max(1, bars)));
  return {
    trading_date,
    rows: sorted,
    first_time: sorted[0]?.time,
    last_time: sorted.at(-1)?.time,
    open: sorted[0]?.open,
    high,
    low,
    close: sorted.at(-1)?.close,
    range: high - low,
    vwap: roundPrice(vwap),
    opening,
    asia: rangeSummary(sessionRows(sorted, "09:15", "14:45")),
    nyOpening: rangeSummary(sessionRows(sorted, "15:30", "17:00")),
  };
}

function rangeSummary(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { high: null, low: null, open: null, close: null };
  return {
    high: Math.max(...rows.map((row) => row.high)),
    low: Math.min(...rows.map((row) => row.low)),
    open: rows[0]?.open ?? null,
    close: rows.at(-1)?.close ?? null,
  };
}

function sessionRows(rows, fromHm, toHm) {
  return rows.filter((row) => {
    const hm = String(row.time || "").slice(11, 16);
    return hm >= fromHm && hm <= toHm;
  });
}

function stableExperimentIds(scope) {
  return {
    experimentId: uuidFromValue({ kind: "research_experiment", batch_id: scope.batch_id, dataset_key: scope.dataset_key }),
  };
}

function stableVariantIds(scope, variant) {
  const key = `${scope.batch_id}:${scope.dataset_key}:${variant.family_id}:${variant.variant_index}`;
  return {
    definitionId: uuidFromValue({ kind: "strategy_definition", family: variant.strategy_external_key }),
    versionId: uuidFromValue({ kind: "strategy_version", key }),
    instanceId: uuidFromValue({ kind: "strategy_instance", key, mode: "shadow" }),
    simulationRunId: uuidFromValue({ kind: "simulation_run", key }),
    candidateId: uuidFromValue({ kind: "research_candidate", key }),
    reportId: uuidFromValue({ kind: "research_evaluation_report", key, report_kind: "VALIDATION" }),
    missionId: uuidFromValue({ kind: "agent_mission", key }),
    taskId: uuidFromValue({ kind: "agent_task", key }),
  };
}

function compileScope(seed) {
  return {
    trading_date: seed.scope.start_utc.slice(0, 10),
    session: "mega_data_driven_research",
    cutoff_utc: seed.dataset.cutoff_utc,
    cutoff_paris: seed.dataset.cutoff_paris,
    strategy_id: seed.variant.strategy_external_key,
    pack_id: seed.dataset.dataset_key,
    pack_build_id: seed.dataset.dataset_id,
  };
}

function simulationDataset(dataset, rows) {
  return {
    ...dataset,
    dataset_hash: dataset.content_hash,
    sealed: true,
    sealed_at_utc: dataset.cutoff_utc,
    time_range: {
      from_utc: dataset.time_range_start_utc,
      to_utc: dataset.time_range_end_utc,
      to_paris: dataset.cutoff_paris,
    },
    rows,
  };
}

function simulationParameters() {
  return {
    simulation_policy: { position_at_cutoff: "MARK_TO_MARKET_CLOSE" },
    order_simulation_policy: {
      ambiguous_intrabar_policy: "CONSERVATIVE_STOP",
      spread_points: 0.25,
      slippage_points: 0.25,
      commission_r_per_contract: 0.01,
    },
    validation_scope: "mega_data_driven_research",
  };
}

function datasetSummary(dataset, rows) {
  return {
    dataset_id: dataset.dataset_id,
    dataset_key: dataset.dataset_key,
    rows: rows.length,
    trading_days: new Set(rows.map((row) => row.trading_date)).size,
    start_utc: dataset.time_range_start_utc,
    end_utc: dataset.time_range_end_utc,
    content_hash: dataset.content_hash,
  };
}

function recordFamily(byFamily, variant, metrics) {
  const existing = byFamily.get(variant.family_id) || {
    family_id: variant.family_id,
    family_label: variant.family_label,
    count: 0,
    best_total_r: -Infinity,
    pass_count: 0,
  };
  existing.count += 1;
  existing.best_total_r = Math.max(existing.best_total_r, number(metrics.total_r));
  if (evaluationVerdict(metrics) === "PASS") existing.pass_count += 1;
  byFamily.set(variant.family_id, existing);
}

function pushBest(best, seed, metrics, run) {
  best.push({
    candidate_id: seed.ids.candidateId,
    strategy_version_id: seed.ids.versionId,
    simulation_run_id: run.simulation_run_id,
    family_set: seed.scope.family_set,
    family_id: seed.variant.family_id,
    variant_index: seed.variant.variant_index,
    total_r: number(metrics.total_r),
    trade_count: number(metrics.trade_count),
    win_rate: number(metrics.win_rate),
    max_drawdown_r: number(metrics.max_drawdown_r),
    verdict: evaluationVerdict(metrics),
  });
  best.sort((left, right) => right.total_r - left.total_r);
  if (best.length > 50) best.length = 50;
}

function evaluationVerdict(metrics) {
  if (number(metrics.trade_count) < 2) return "NEEDS_REVIEW";
  if (number(metrics.total_r) <= 0 || number(metrics.max_drawdown_r) < -8) return "FAIL";
  return "PASS";
}

function evaluationReasons(metrics) {
  const reasons = [];
  if (number(metrics.trade_count) < 2) reasons.push("INSUFFICIENT_TRADE_SAMPLE");
  if (number(metrics.total_r) <= 0) reasons.push("NON_POSITIVE_TOTAL_R");
  if (number(metrics.max_drawdown_r) < -8) reasons.push("DRAWDOWN_BELOW_RESEARCH_FLOOR");
  if (!reasons.length) reasons.push("BASELINE_BACKTEST_ACCEPTABLE");
  return reasons;
}

function evaluationScore(metrics, verdict) {
  const total = Math.max(-12, Math.min(20, number(metrics.total_r)));
  const tradeCount = Math.min(20, Math.max(0, number(metrics.trade_count)));
  const drawdown = Math.max(0, 1 - Math.abs(number(metrics.max_drawdown_r)) / 10);
  const raw = verdict === "PASS"
    ? 0.62 + Math.min(0.18, total / 80) + Math.min(0.08, tradeCount / 250) + drawdown * 0.12
    : 0.18 + Math.min(0.24, Math.max(0, total + 6) / 50) + Math.min(0.16, tradeCount / 100) + drawdown * 0.18;
  return Math.max(0.01, Math.min(0.99, Math.round(raw * 10_000) / 10_000));
}

function noveltyScore(variant) {
  return Math.min(0.97, 0.55 + variant.family_index * 0.01 + (variant.variant_index % 17) * 0.01);
}

function marketRow(row, scope) {
  return {
    instrument: scope.instrument,
    symbol: scope.symbol_code,
    timeframe: `M${scope.timeframe}`,
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

function commandContext(actor, input, ids) {
  return {
    idempotency_key: text(input.idempotency_key || input.idempotencyKey, `idem_mega_research_${ids.experimentId}`),
    correlation_id: text(input.correlation_id || input.correlationId, `corr_mega_research_${ids.experimentId}`),
    actor: actor?.email || actor?.uid || actor?.kind || "mega_research_bootstrap",
    reason: text(input.reason, "Bootstrap data-driven mega research batch."),
  };
}

function operationTimestamp(store) {
  const now = store?.clock && typeof store.clock.now === "function" ? store.clock.now() : null;
  if (now?.utc) return new Date(now.utc).toISOString();
  return new Date().toISOString();
}

function boundedInteger(value, fallback, min = 0, max = 1_000) {
  const parsed = Math.trunc(Number(value));
  const selected = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(selected, max));
}

function percentile(sortedValues, ratio) {
  const values = (sortedValues || []).filter((value) => Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
  if (!values.length) return null;
  const index = Math.max(0, Math.min(values.length - 1, Math.floor((values.length - 1) * ratio)));
  return values[index];
}

function variantCandidateKey(scope, familySpec, variantIndex) {
  return safeKey(`mega:${scope.batch_id}:${familySpec.family_id}:v${String(variantIndex).padStart(3, "0")}`);
}

function versionLabel({ familyIndex, familyVariantIndex, scope, familySpec, parameters, dataset }) {
  return [
    `1.${familyIndex + 1}.${familyVariantIndex + 1}`,
    canonicalSha256({ scope, family_id: familySpec.family_id, parameters, dataset_key: dataset.dataset_key }).slice(0, 12),
  ].join("+");
}

function safeKey(value) {
  const normalized = String(value || "key")
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "");
  const bounded = normalized.slice(0, 180).replace(/[^a-z0-9]+$/, "");
  return bounded || "key";
}

function hashValue(value) { return `sha256:${canonicalSha256(value)}`; }
function sha256Text(value) { return `sha256:${createHash("sha256").update(String(value ?? "")).digest("hex")}`; }
function roundPrice(value) { return Math.round(Number(value) * 4) / 4; }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function text(value, fallback = "") { const normalized = String(value ?? "").trim(); return normalized || fallback; }
function iso(value, fallback = null) { const parsed = Date.parse(value || fallback || ""); if (!Number.isFinite(parsed)) throw coded("MEGA_RESEARCH_INVALID_TIMESTAMP", "Invalid timestamp.", { value }); return new Date(parsed).toISOString(); }
function uuidFromValue(value) { return uuidFromHash(canonicalSha256(value)); }

function uuidFromHash(hash) {
  const clean = String(hash || "").replace(/^sha256:/, "").padEnd(32, "0");
  const variant = ((Number.parseInt(clean[16] || "8", 16) & 0x3) | 0x8).toString(16);
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-4${clean.slice(13, 16)}-${variant}${clean.slice(17, 20)}-${clean.slice(20, 32)}`;
}

function assertStore(store) {
  if (!store?.persistence?.pool) throw coded("MEGA_RESEARCH_POSTGRES_REQUIRED", "PostgreSQL-backed store is required.");
  if (!store.strategyKernel) throw coded("MEGA_RESEARCH_STRATEGY_KERNEL_REQUIRED", "Strategy Kernel service is required.");
  if (!store.simulationRuns) throw coded("MEGA_RESEARCH_SIMULATION_REGISTRY_REQUIRED", "Simulation Run service is required.");
}

function coded(code, message, details = {}) {
  return Object.assign(new Error(message || code), { code, details, retryable: false });
}
