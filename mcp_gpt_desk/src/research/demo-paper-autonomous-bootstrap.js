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
import {
  buildBootstrapResultPayload,
  buildResearchCandidate,
  buildResearchEvaluation,
  buildResearchExperiment,
  buildResearchHypothesis,
} from "./demo-paper-autonomous-records.js";
import {
  enqueueResearchAgentTask,
} from "./research-agent-task-queue.js";

const DEFAULT_SCOPE = Object.freeze({
  strategy_id: "demo-paper.mnq.opening-range-breakout-retest",
  symbol_code: "MNQ1!",
  instrument: "MNQ",
  timeframe: "5",
  start_utc: "2026-06-01T00:00:00.000Z",
  end_utc: "2026-07-01T00:00:00.000Z",
  dataset_key: "demo-paper.mnq.m5.2026-06-01_2026-07-01",
});

export async function bootstrapDemoPaperAutonomousResearch({ store, input = {}, actor = {} } = {}) {
  assertStore(store);
  const scope = normalizeScope(input);
  const operationTime = operationTimestamp(store);
  const rows = await loadMarketRows(store.persistence.pool, scope);
  assertOneMonthCoverage(rows, scope);
  const dataset = buildDataset(scope, rows);
  await upsertDataset(store.persistence.pool, dataset);
  const ids = stableIds(scope);
  let seed = buildStrategySeed(scope, rows, dataset, ids);
  const command = commandContext(actor, input, ids);
  const definition = await registerDefinition(store, seed, command);
  seed = withCanonicalIds(seed, { definitionId: definition.definition.strategy_definition_id });
  const version = await registerVersion(store, seed, command);
  seed = withCanonicalIds(seed, { versionId: version.version.strategy_version_id });
  const compilation = await compileVersion(store, seed, command);
  const simulation = runSimulation(seed, dataset, rows, compilation, ids);
  const registered = await registerSimulation(store, seed, dataset, simulation, compilation, seed.ids, command);
  const research = input.certification_replay === true
    ? await loadExistingResearchRefs(store.persistence.pool, seed.ids.versionId)
    : await registerResearch(store, seed, registered.run, simulation, seed.ids, command);
  const instance = await registerInstance(store, seed, registered.run, research, seed.ids, command);
  const agentTask = input.certification_replay === true
    ? null
    : await upsertResearchAgentTask(store.persistence.pool, { seed, dataset, registered, research, ids: seed.ids, operationTime });
  return buildBootstrapResultPayload({ scope, rows, dataset, definition, version, compilation, simulation, registered, research, instance, agentTask });
}

async function loadExistingResearchRefs(pool, strategyVersionId) {
  const result = await pool.query(`SELECT c.research_experiment_id, c.research_candidate_id
    FROM strategy_versions target
    JOIN strategy_versions reviewed ON reviewed.dsl_source_hash=target.dsl_source_hash
    JOIN research_candidates c ON c.strategy_version_id=reviewed.strategy_version_id
    WHERE target.strategy_version_id=$1
    ORDER BY c.created_at_utc ASC LIMIT 1`, [strategyVersionId]);
  const row = result.rows[0];
  if (!row) throw coded("CERTIFICATION_RESEARCH_LINEAGE_MISSING", "Certification replay requires an existing reviewed research candidate.", { strategy_version_id: strategyVersionId });
  const report = await pool.query(`SELECT research_evaluation_report_id FROM research_evaluation_reports
    WHERE research_candidate_id=$1 ORDER BY created_at_utc DESC LIMIT 1`, [row.research_candidate_id]);
  return {
    experiment_id: row.research_experiment_id,
    candidate_id: row.research_candidate_id,
    report_id: report.rows[0]?.research_evaluation_report_id || null,
    source: "EXISTING_RESEARCH_LINEAGE",
  };
}

function normalizeScope(input = {}) {
  return {
    strategy_id: text(input.strategy_id || input.strategyId, DEFAULT_SCOPE.strategy_id),
    symbol_code: text(input.symbol_code || input.symbolCode, DEFAULT_SCOPE.symbol_code),
    instrument: text(input.instrument, DEFAULT_SCOPE.instrument).toUpperCase(),
    timeframe: text(input.timeframe, DEFAULT_SCOPE.timeframe),
    start_utc: iso(input.start_utc || input.startUtc, DEFAULT_SCOPE.start_utc),
    end_utc: iso(input.end_utc || input.endUtc, DEFAULT_SCOPE.end_utc),
    dataset_key: text(input.dataset_key || input.datasetKey, DEFAULT_SCOPE.dataset_key),
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

function assertOneMonthCoverage(rows, scope) {
  const rangeDays = (Date.parse(scope.end_utc) - Date.parse(scope.start_utc)) / 86_400_000;
  const tradingDays = new Set(rows.map((row) => row.trading_date).filter(Boolean)).size;
  if (rangeDays < 30 || tradingDays < 15 || rows.length < 1_000) {
    throw coded("DEMO_PAPER_DATASET_COVERAGE_INSUFFICIENT", "One-month cumulative market dataset is not available.", {
      range_days: rangeDays,
      trading_days: tradingDays,
      rows: rows.length,
      scope,
    });
  }
}

function buildDataset(scope, rows) {
  const contentHash = hashValue({ scope, row_count: rows.length, first: rows[0], last: rows.at(-1) });
  const buildHash = hashValue({ bootstrap: "demo_paper_autonomous_research_v1", scope });
  return {
    dataset_id: uuidFromValue({ kind: "dataset", key: scope.dataset_key }),
    dataset_key: scope.dataset_key,
    name: "Demo Paper MNQ M5 — one-month cumulative seed",
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
    metadata: { instrument: scope.instrument, symbol_code: scope.symbol_code, timeframe: "M5", rows: rows.length },
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

function stableIds(scope) {
  const key = `${scope.strategy_id}:${scope.dataset_key}`;
  return {
    definitionId: uuidFromValue({ key: scope.strategy_id, kind: "strategy_definition" }),
    versionId: uuidFromValue({ key, kind: "strategy_version", version: versionLabel(scope) }),
    instanceId: uuidFromValue({ key, kind: "strategy_instance", mode: "shadow" }),
    simulationRunId: uuidFromValue({ key, kind: "simulation_run" }),
    experimentId: uuidFromValue({ key, kind: "research_experiment" }),
    hypothesisId: uuidFromValue({ key, kind: "research_hypothesis" }),
    candidateId: uuidFromValue({ key, kind: "research_candidate" }),
    reportId: uuidFromValue({ key, kind: "research_evaluation_report" }),
    missionId: uuidFromValue({ key, kind: "agent_mission" }),
    taskId: uuidFromValue({ key, kind: "agent_task" }),
  };
}

function buildStrategySeed(scope, rows, dataset, ids) {
  const range = openingRange(rows);
  const timestamp = dataset.cutoff_utc;
  const dsl = strategyDsl(scope);
  return {
    scope, ids, dataset, range, timestamp, dsl, dslText: canonicalJson(dsl), version_label: versionLabel(scope),
    runtimeBindings: runtimeBindings(scope, dataset, range, ids),
    parameters: simulationParameters(),
  };
}

function strategyDsl(scope) {
  const base = { instrument: scope.instrument, timeframe: "M5", rr_minimum: 1.6, risk_pct: 0.25, order_type: "LIMIT" };
  return {
    schema_version: STRATEGY_DSL_SCHEMA_VERSION_V1,
    pattern: STRATEGY_PATTERN_BREAKOUT_RETEST_V1,
    setup_templates: [
      { ...base, template_id: "mnq_long_opening_range_retest", direction: "long", rank: 1, tolerance_points: 4, max_bars: 48, require_rejection_confirmation: false },
      { ...base, template_id: "mnq_short_opening_range_retest", direction: "short", rank: 2, tolerance_points: 4, max_bars: 48, require_rejection_confirmation: false },
    ],
  };
}

function runtimeBindings(scope, dataset, range, ids) {
  return {
    valid_from_paris: toParisIso(Date.parse(scope.start_utc)),
    expires_at_paris: dataset.cutoff_paris,
    cutoff_paris: dataset.cutoff_paris,
    pack_id: dataset.dataset_key,
    pack_build_id: dataset.dataset_id,
    plan_id: `plan__${ids.versionId}`,
    session: "demo_paper_research",
    trading_date: scope.start_utc.slice(0, 10),
    setup_id_prefix: "demo_paper_setup",
    setups: [longBinding(scope, range), shortBinding(scope, range)],
  };
}

function longBinding(scope, range) {
  const entryBoundary = roundPrice(range.high + 2);
  const stopLoss = roundPrice(range.high - 20);
  const riskPoints = Math.abs(entryBoundary - stopLoss);
  return {
    template_id: "mnq_long_opening_range_retest",
    instrument: scope.instrument,
    break_level: range.high,
    retest_level: range.high,
    entry_zone: { lower: roundPrice(range.high - 2), upper: entryBoundary },
    stop_loss: stopLoss,
    take_profit_1: roundPrice(entryBoundary + riskPoints * 2.2),
    invalidation_level: roundPrice(range.low - 8),
  };
}

function shortBinding(scope, range) {
  const entryBoundary = roundPrice(range.low - 2);
  const stopLoss = roundPrice(range.low + 20);
  const riskPoints = Math.abs(stopLoss - entryBoundary);
  return {
    template_id: "mnq_short_opening_range_retest",
    instrument: scope.instrument,
    break_level: range.low,
    retest_level: range.low,
    entry_zone: { lower: entryBoundary, upper: roundPrice(range.low + 2) },
    stop_loss: stopLoss,
    take_profit_1: roundPrice(entryBoundary - riskPoints * 2.2),
    invalidation_level: roundPrice(range.high + 8),
  };
}

async function registerDefinition(store, seed, command) {
  const existing = await store.strategyKernel.getDefinitionByExternalKey?.(seed.scope.strategy_id);
  if (existing) return { status: "EXISTING_BY_EXTERNAL_KEY", definition: existing, audit: null };
  return store.strategyKernel.registerDefinition({
    strategy_definition_id: seed.ids.definitionId,
    external_key: seed.scope.strategy_id,
    name: "Demo Paper MNQ Opening Range Breakout Retest",
    description: "Baseline déterministe pour valider la chaîne research/backtest sur un mois de données réelles.",
    owner: "desk-research",
    asset_class: "FUTURES",
    default_instruments: [seed.scope.instrument],
    tags: ["demo-paper", "research-seed", "breakout-retest"],
    metadata: { dataset_key: seed.dataset.dataset_key, generated_by: "demo_paper_autonomous_bootstrap_v1" },
    created_at: seed.timestamp,
    updated_at: seed.timestamp,
  }, command);
}

async function registerVersion(store, seed, command) {
  const existing = (await store.strategyKernel.listVersions({ strategyDefinitionId: seed.ids.definitionId, limit: 500 }))
    .find((item) => item.version_label === seed.version_label);
  if (existing) return { status: "EXISTING_BY_VERSION_LABEL", version: existing, audit: null };
  return store.strategyKernel.registerVersion({
    strategy_version_id: seed.ids.versionId,
    strategy_definition_id: seed.ids.definitionId,
    version_label: seed.version_label,
    status: "VALIDATED",
    dsl_source_hash: sha256Text(seed.dslText),
    compiled_artifact_ref: `strategy://demo-paper/${seed.ids.versionId}/compiled-artifact`,
    compiled_artifact_hash: null,
    validated_metrics_ref: seed.ids.simulationRunId,
    runtime_contract_bundle_version: "deterministic_execution_plan_v1_4",
    metadata: { dsl_source: seed.dsl, validation_scope: "one_month_cumulative_demo_paper" },
    created_at: seed.timestamp,
    updated_at: seed.timestamp,
  }, command);
}

async function compileVersion(store, seed, command) {
  const result = await store.strategyKernel.compileVersion({
    strategy_version_id: seed.ids.versionId,
    dsl_source: seed.dslText,
    runtime_bindings: seed.runtimeBindings,
    scope: compileScope(seed),
    source_mode: "PAPER",
  }, command);
  if (result.status !== "COMPILED") throw coded("DEMO_PAPER_STRATEGY_COMPILE_REJECTED", "Strategy seed cannot compile.", { reasons: result.compilation?.reasons });
  return result;
}

function runSimulation(seed, dataset, rows, compilation) {
  return runCanonicalSimulationV1({
    run_id: `demo-paper-research-${seed.scope.instrument.toLowerCase()}-m5-20260601-20260701`,
    strategy_version_id: seed.ids.versionId,
    compiled_artifact: compilation.compilation.compiled_artifact,
    dataset: simulationDataset(dataset, rows),
    rows,
    parameters: seed.parameters,
    reproducibility_seed: "demo-paper-autonomous-bootstrap-v1",
    cutoff_utc: dataset.cutoff_utc,
    cutoff_paris: dataset.cutoff_paris,
    run_started_at_utc: dataset.time_range_start_utc,
  });
}

async function registerSimulation(store, seed, dataset, simulation, compilation, ids, command) {
  return store.simulationRuns.recordSimulationResult({
    simulation_run_id: ids.simulationRunId,
    strategy_version_id: seed.ids.versionId,
    dataset_id: dataset.dataset_id,
    compiled_artifact_hash: compilation.compilation.evidence.compiled_artifact_hash,
    result: simulation,
    metadata: {
      source: "demo_paper_autonomous_bootstrap_v1",
      dataset_key: dataset.dataset_key,
      total_rows: simulation?.data_quality?.consumed_rows || 0,
      metrics: simulation.metrics || {},
    },
    created_at_utc: seed.timestamp,
  }, command);
}

async function registerResearch(store, seed, run, simulation, ids, command) {
  const registry = store.researchRegistry || createResearchExperimentRegistryService({ persistence: store.persistence, clock: store.clock });
  const metrics = simulation.metrics || {};
  await registry.registerExperiment(buildResearchExperiment(seed, ids), command);
  await registry.registerHypothesis(buildResearchHypothesis(seed, ids), command);
  await ensureResearchCandidate(registry, seed, ids, command);
  const report = await registry.recordEvaluationReport(buildResearchEvaluation(seed, ids, run, metrics), command);
  store.researchRegistry = registry;
  return { experiment_id: ids.experimentId, hypothesis_id: ids.hypothesisId, candidate_id: ids.candidateId, report_id: ids.reportId, report };
}

async function ensureResearchCandidate(registry, seed, ids, command) {
  try {
    return await registry.getCandidate(ids.candidateId);
  } catch (error) {
    if (error?.code !== "RESEARCH_CANDIDATE_NOT_FOUND") throw error;
  }
  return registry.registerCandidate(buildResearchCandidate(seed, ids), command);
}

async function registerInstance(store, seed, run, research, ids, command) {
  return store.strategyKernel.registerInstance({
    strategy_instance_id: ids.instanceId,
    strategy_version_id: seed.ids.versionId,
    runtime_state: "RUNNING",
    execution_mode: "SHADOW",
    account_scope: null,
    instrument_scope: [seed.scope.instrument],
    session_scope: ["research"],
    risk_budget_ref: null,
    triple_lock_validated: false,
    last_heartbeat_at: seed.timestamp,
    started_at: seed.timestamp,
    metadata: { simulation_run_id: run.simulation_run_id, research_candidate_id: research.candidate_id, mode: "demo-paper-shadow" },
    created_at: seed.timestamp,
    updated_at: seed.timestamp,
  }, command);
}

async function upsertResearchAgentTask(pool, { seed, dataset, registered, research, ids, operationTime }) {
  return enqueueResearchAgentTask(pool, {
    mission: reviewMission({ seed, registered, ids, operationTime }),
    task: reviewTask({ seed, dataset, registered, research, ids, operationTime }),
  });
}

function reviewMission({ seed, registered, ids, operationTime }) {
  return {
    agent_mission_id: ids.missionId,
    mission_key: `research-demo-paper-${seed.dataset.dataset_key}`,
    mission_type: "RESEARCH_STRATEGY_VALIDATION",
    lane: "research",
    objective: "Relire le backtest canonique 1 mois et décider si la stratégie seed mérite une itération ou une promotion.",
    context_ref: `research://${ids.experimentId}`,
    correlation_id: `corr_demo_paper_${ids.simulationRunId}`,
    priority: 40,
    model_policy: { model: "codex", reasoning_effort: "xhigh", routing_profile: "research-review" },
    metadata: { simulation_run_id: registered.run.simulation_run_id, strategy_version_id: seed.ids.versionId },
    created_at_utc: operationTime,
  };
}

function reviewTask({ seed, dataset, registered, research, ids, operationTime }) {
  return {
    agent_task_id: ids.taskId,
    agent_mission_id: ids.missionId,
    task_key: `research-review-${seed.dataset.dataset_key}`,
    task_type: "RESEARCH_BACKTEST_REVIEW",
    lane: "research",
    input_ref: `simulation-run://${registered.run.simulation_run_id}`,
    priority: 40,
    payload: taskPayload({ seed, dataset, registered, research }),
    idempotency_key: `idem_research_review_${ids.taskId}`,
    max_attempts: 3,
    not_before_utc: operationTime,
    correlation_id: `corr_demo_paper_${ids.simulationRunId}`,
    metadata: { source: "demo_paper_autonomous_bootstrap_v1" },
    created_at_utc: operationTime,
  };
}

function taskPayload({ seed, dataset, registered, research }) {
  return {
    dataset_id: dataset.dataset_id,
    dataset_key: dataset.dataset_key,
    strategy_version_id: seed.ids.versionId,
    simulation_run_id: registered.run.simulation_run_id,
    research_candidate_id: research.candidate_id,
    required_decision: "REVIEW_OR_ITERATE",
    metrics: registered.run.metadata?.metrics || {},
  };
}

function compileScope(seed) {
  return {
    trading_date: seed.scope.start_utc.slice(0, 10),
    session: "demo_paper_research",
    cutoff_utc: seed.dataset.cutoff_utc,
    cutoff_paris: seed.dataset.cutoff_paris,
    strategy_id: seed.scope.strategy_id,
    pack_id: seed.dataset.dataset_key,
    pack_build_id: seed.dataset.dataset_id,
  };
}

function withCanonicalIds(seed, overrides = {}) {
  return {
    ...seed,
    ids: {
      ...seed.ids,
      ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value)),
    },
  };
}

function versionLabel(scope) {
  return `1.0.0+${canonicalSha256({ strategy_id: scope.strategy_id, dataset_key: scope.dataset_key }).slice(0, 12)}`;
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
    simulation_policy: {
      position_at_cutoff: "MARK_TO_MARKET_CLOSE",
    },
    order_simulation_policy: {
      ambiguous_intrabar_policy: "CONSERVATIVE_STOP",
      spread_points: 0.25,
      slippage_points: 0.25,
      commission_r_per_contract: 0.01,
    },
    validation_scope: "one_month_cumulative_demo_paper",
  };
}

function openingRange(rows) {
  const sample = rows.slice(0, 36);
  return {
    high: roundPrice(Math.max(...sample.map((row) => row.high))),
    low: roundPrice(Math.min(...sample.map((row) => row.low))),
  };
}

function marketRow(row, scope) {
  return {
    instrument: scope.instrument,
    symbol: scope.symbol_code,
    timeframe: "M5",
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
    idempotency_key: text(input.idempotency_key || input.idempotencyKey, `idem_demo_paper_bootstrap_${ids.simulationRunId}`),
    correlation_id: text(input.correlation_id || input.correlationId, `corr_demo_paper_${ids.simulationRunId}`),
    actor: actor?.email || actor?.uid || actor?.kind || "demo_paper_bootstrap",
    reason: text(input.reason, "Bootstrap autonomous demo-paper research pipeline."),
  };
}

function operationTimestamp(store) {
  const now = store?.clock && typeof store.clock.now === "function" ? store.clock.now() : null;
  if (now?.utc) return new Date(now.utc).toISOString();
  return new Date().toISOString();
}

function assertStore(store) {
  if (!store?.persistence?.pool) throw coded("DEMO_PAPER_POSTGRES_REQUIRED", "PostgreSQL-backed store is required.");
  if (!store.strategyKernel) throw coded("DEMO_PAPER_STRATEGY_KERNEL_REQUIRED", "Strategy Kernel service is required.");
  if (!store.simulationRuns) throw coded("DEMO_PAPER_SIMULATION_REGISTRY_REQUIRED", "Simulation Run service is required.");
}

function hashValue(value) { return `sha256:${canonicalSha256(value)}`; }
function sha256Text(value) { return `sha256:${createHash("sha256").update(String(value ?? "")).digest("hex")}`; }
function roundPrice(value) { return Math.round(Number(value) * 4) / 4; }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function text(value, fallback = "") { const normalized = String(value ?? "").trim(); return normalized || fallback; }
function iso(value, fallback = null) { const parsed = Date.parse(value || fallback || ""); if (!Number.isFinite(parsed)) throw coded("DEMO_PAPER_INVALID_TIMESTAMP", "Invalid timestamp.", { value }); return new Date(parsed).toISOString(); }
function uuidFromValue(value) { return uuidFromHash(canonicalSha256(value)); }

function uuidFromHash(hash) {
  const clean = String(hash || "").replace(/^sha256:/, "").padEnd(32, "0");
  const variant = ((Number.parseInt(clean[16] || "8", 16) & 0x3) | 0x8).toString(16);
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-4${clean.slice(13, 16)}-${variant}${clean.slice(17, 20)}-${clean.slice(20, 32)}`;
}

function coded(code, message, details = {}) {
  return Object.assign(new Error(message || code), { code, details, retryable: false });
}
