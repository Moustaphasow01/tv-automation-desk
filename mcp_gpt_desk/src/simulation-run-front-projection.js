export function normalizeSimulationRunSummary(run = {}) {
  const rawStatus = valueOr(run.status, "UNKNOWN");
  return {
    id: run.simulation_run_id,
    simulationRunId: run.simulation_run_id,
    sourceRunId: optional(run.source_run_id),
    status: String(rawStatus).toLowerCase(),
    rawStatus,
    strategyVersionId: optional(run.strategy_version_id),
    datasetId: optional(run.dataset_id),
    parametersHash: optional(run.parameters_hash),
    reproducibilitySeed: optional(run.reproducibility_seed),
    simulationEngine: optional(run.simulation_engine),
    simulationEngineVersion: optional(run.simulation_engine_version),
    resultSchemaVersion: optional(run.result_schema_version),
    cutoff: optional(run.cutoff),
    datasetHash: optional(run.dataset_hash),
    compiledArtifactHash: optional(run.compiled_artifact_hash),
    resultHash: optional(run.result_hash),
    metricsHash: optional(run.metrics_hash),
    resultRef: optional(run.result_ref),
    metricsRef: optional(run.metrics_ref),
    startedAt: optional(run.started_at_utc),
    completedAt: optional(run.completed_at_utc),
    createdAt: optional(run.created_at_utc),
    updatedAt: optional(run.updated_at_utc),
    failure: simulationRunFailure(run),
    metadata: plain(run.metadata),
  };
}

export function normalizeSimulationRunArtifact(artifact = {}) {
  return {
    id: artifact.simulation_run_artifact_id,
    simulationRunId: artifact.simulation_run_id,
    artifactKind: artifact.artifact_kind,
    schemaVersion: artifact.schema_version,
    contentHash: artifact.content_hash,
    storageRef: artifact.storage_ref,
    createdAt: artifact.created_at_utc || null,
    payloadSummary: summarizeArtifactPayload(artifact.payload),
    payload: artifact.payload || {},
  };
}

export function buildSimulationRunComparison({ ids = [], runs = [], artifactsByRun = {}, proofsByRun = {} } = {}) {
  const rows = runs.map((run, index) => buildSimulationRunComparisonRow({
    run,
    artifacts: artifactsByRun[run.simulation_run_id] || [],
    proof: proofsByRun[run.simulation_run_id] || null,
    baseline: index === 0,
  }));
  return {
    ids,
    baselineRunId: rows[0]?.id || null,
    summary: simulationRunComparisonSummary(rows),
    items: rows,
    dimensions: ["reproducibility", "datasetHash", "engineVersion", "metricsHash", "resultHash", "artifacts"],
  };
}

export function simulationRunMatchesReplay(run = {}, replay = {}) {
  const replayId = replay.backtest_id || replay.replay_run_id || replay.run_id || replay.sourceId || replay.id;
  if (!replayId) return false;
  const metadata = plain(run.metadata);
  return [
    run.source_run_id,
    metadata.backtest_id,
    metadata.replay_run_id,
    metadata.run_id,
    metadata.workflow_id,
  ].filter(Boolean).includes(replayId);
}

function buildSimulationRunComparisonRow({ run, artifacts = [], proof = null, baseline = false }) {
  const summary = normalizeSimulationRunSummary(run);
  const normalizedArtifacts = artifacts.map(normalizeSimulationRunArtifact);
  return {
    id: summary.id,
    baseline,
    run: summary,
    proof,
    reproducible: baseline ? true : proof?.ok === true,
    reasons: baseline ? [] : proof?.reasons || ["PROOF_MISSING"],
    artifactCount: normalizedArtifacts.length,
    artifactKinds: [...new Set(normalizedArtifacts.map((item) => item.artifactKind).filter(Boolean))].sort(),
    artifacts: normalizedArtifacts,
  };
}

function simulationRunComparisonSummary(rows = []) {
  return {
    count: rows.length,
    baselineRunId: rows[0]?.id || null,
    reproducible: rows.filter((row) => row.reproducible).length,
    nonReproducible: rows.filter((row) => !row.reproducible).length,
    artifactCount: rows.reduce((sum, row) => sum + row.artifactCount, 0),
    reasons: [...new Set(rows.flatMap((row) => row.reasons || []))].sort(),
  };
}

function summarizeArtifactPayload(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { type: typeof payload };
  const metrics = plain(payload.metrics);
  const summary = plain(payload.summary);
  return {
    keys: Object.keys(payload).sort().slice(0, 20),
    itemCount: arrayCount(payload.items),
    status: firstPresent(payload.status, summary.status),
    totalR: firstNumber(metrics.total_r, payload.total_r, payload.total_R),
    tradeCount: firstNumber(metrics.trade_count, payload.trade_count),
  };
}

function simulationRunFailure(run = {}) {
  const code = optional(run.failure_code);
  const message = optional(run.failure_message);
  if (code === null && message === null) return null;
  return { code, message };
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function arrayCount(value) {
  if (!Array.isArray(value)) return null;
  return value.length;
}

function firstPresent(...values) {
  for (const value of values) {
    const normalized = optional(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

function valueOr(value, fallback) {
  const normalized = optional(value);
  if (normalized === null) return fallback;
  return normalized;
}

function optional(value) {
  if (value === null || value === undefined || value === "") return null;
  return value;
}

function plain(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
