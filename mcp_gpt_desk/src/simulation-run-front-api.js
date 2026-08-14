import {
  buildSimulationRunComparison,
  normalizeSimulationRunArtifact,
  normalizeSimulationRunSummary,
  simulationRunMatchesReplay,
} from "./simulation-run-front-projection.js";

export function createSimulationRunFrontApi({ host, clock }) {
  return {
    listSimulationRuns: (filters = {}) => listSimulationRuns({ host, clock, filters }),
    getSimulationRun: (simulationRunId) => getSimulationRun({ host, simulationRunId }),
    getSimulationRunArtifacts: (simulationRunId, filters = {}) => getSimulationRunArtifacts({ host, simulationRunId, filters }),
    compareSimulationRuns: (ids = []) => compareSimulationRuns({ host, ids }),
    findSimulationEvidenceForReplay: (replayRun = {}) => findSimulationEvidenceForReplay({ host, replayRun }),
  };
}

async function listSimulationRuns({ host, clock, filters }) {
  const registry = host?.simulationRuns;
  if (!registry) return unavailableList(clock, filters);
  try {
    const runs = await registry.listRuns(simulationRunFilters(filters));
    return contract("DeskSimulationRunList", {
      generatedAt: clock.now().utc,
      available: true,
      filters: normalized(filters),
      count: runs.length,
      items: runs.map(normalizeSimulationRunSummary),
    });
  } catch (error) {
    if (registryUnavailable(error)) return unavailableList(clock, filters);
    throw error;
  }
}

async function getSimulationRun({ host, simulationRunId }) {
  const registry = requireRegistry(host);
  const [run, artifacts] = await Promise.all([
    registry.getRun(simulationRunId),
    registry.listArtifacts({ simulationRunId, limit: 100 }),
  ]);
  return contract("DeskSimulationRunDetail", {
    run: normalizeSimulationRunSummary(run),
    artifactCount: artifacts.length,
    artifacts: artifacts.map(normalizeSimulationRunArtifact),
  });
}

async function getSimulationRunArtifacts({ host, simulationRunId, filters }) {
  const artifacts = await requireRegistry(host).listArtifacts({
    ...simulationRunFilters(filters),
    simulationRunId,
  });
  return contract("DeskSimulationRunArtifactList", {
    simulationRunId,
    count: artifacts.length,
    items: artifacts.map(normalizeSimulationRunArtifact),
  });
}

async function compareSimulationRuns({ host, ids }) {
  const registry = requireRegistry(host);
  const unique = [...new Set(ids.filter(Boolean))].slice(0, 8);
  const runs = await Promise.all(unique.map((id) => registry.getRun(id)));
  const artifactEntries = await Promise.all(unique.map(async (id) => [id, await registry.listArtifacts({ simulationRunId: id, limit: 100 })]));
  const proofEntries = await Promise.all(unique.slice(1).map(async (id) => [id, await registry.compareRunReproducibility({ baselineRunId: unique[0], candidateRunId: id })]));
  return contract("DeskSimulationRunComparison", buildSimulationRunComparison({
    ids: unique,
    runs,
    artifactsByRun: Object.fromEntries(artifactEntries),
    proofsByRun: Object.fromEntries(proofEntries),
  }));
}

async function findSimulationEvidenceForReplay({ host, replayRun }) {
  const registry = host?.simulationRuns;
  if (!registry) return replayEvidence(false);
  try {
    const runs = (await registry.listRuns({ limit: 500 })).filter((run) => simulationRunMatchesReplay(run, replayRun)).slice(0, 4);
    const artifacts = await Promise.all(runs.map(async (run) => [run.simulation_run_id, await registry.listArtifacts({ simulationRunId: run.simulation_run_id, limit: 100 })]));
    return replayEvidence(true, runs, Object.fromEntries(artifacts));
  } catch (error) {
    if (registryUnavailable(error)) return replayEvidence(false);
    throw error;
  }
}

function requireRegistry(host) {
  if (!host?.simulationRuns) throw serviceError("SIMULATION_RUN_REGISTRY_UNAVAILABLE", "Simulation Run Registry indisponible.", 503);
  return host.simulationRuns;
}

function unavailableList(clock, filters = {}) {
  return contract("DeskSimulationRunList", {
    generatedAt: clock.now().utc,
    available: false,
    reason: "SIMULATION_RUN_REGISTRY_UNAVAILABLE",
    filters: normalized(filters),
    count: 0,
    items: [],
  });
}

function replayEvidence(available, runs = [], artifactsByRun = {}) {
  return {
    available,
    count: runs.length,
    primarySimulationRunId: runs[0]?.simulation_run_id || null,
    runs: runs.map(normalizeSimulationRunSummary),
    artifacts: runs.flatMap((run) => (artifactsByRun[run.simulation_run_id] || []).map(normalizeSimulationRunArtifact)),
  };
}

function simulationRunFilters(filters = {}) {
  return {
    simulationRunId: filters.simulationRunId || filters.simulation_run_id || null,
    strategyVersionId: filters.strategyVersionId || filters.strategy_version_id || null,
    datasetId: filters.datasetId || filters.dataset_id || null,
    status: filters.status || null,
    artifactKind: filters.artifactKind || filters.artifact_kind || null,
    sort: filters.sort || filters.orderBy || filters.order_by || "created_desc",
    limit: bounded(filters.limit, 100, 500),
  };
}

function normalized(filters = {}) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== null && value !== undefined && value !== ""));
}

function registryUnavailable(error) {
  return error?.code === "SIMULATION_RUN_REGISTRY_UNAVAILABLE";
}

function bounded(value, fallback = 100, max = 500) {
  const parsed = Number(value);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? Math.trunc(parsed) : fallback, max));
}

function contract(name, payload) {
  return { contract: name, schemaVersion: "1.0.0", ...payload };
}

function serviceError(code, message, statusCode) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}
