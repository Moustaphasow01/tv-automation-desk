export function isFrontSimulationRunPath(pathname) {
  return pathname === "/api/v1/simulation-runs" ||
    pathname === "/api/v1/simulation-runs/compare" ||
    /^\/api\/v1\/simulation-runs\/[^/]+(?:\/artifacts)?$/.test(pathname);
}

export function frontSimulationRunMethodAllowed(pathname, method) {
  return isFrontSimulationRunPath(pathname) ? method === "GET" : null;
}

export async function handleFrontSimulationRuns(store, { pathname, query = {} }) {
  if (!isFrontSimulationRunPath(pathname)) return { handled: false };
  if (pathname === "/api/v1/simulation-runs") return handled(store.operations.listSimulationRuns(filters(query)));
  if (pathname === "/api/v1/simulation-runs/compare") return handled(store.operations.compareSimulationRuns(listQuery(query.ids || query.id)));

  const match = pathname.match(/^\/api\/v1\/simulation-runs\/([^/]+)(?:\/(artifacts))?$/);
  const runId = decodeURIComponent(match[1]);
  const result = match[2] === "artifacts"
    ? store.operations.getSimulationRunArtifacts(runId, filters(query))
    : store.operations.getSimulationRun(runId);
  return handled(result);
}

function handled(result) {
  return { handled: true, result };
}

function filters(query = {}) {
  return {
    status: query.status || null,
    runId: query.run_id || query.runId || null,
    strategyId: query.strategy_id || query.strategyId || null,
    strategyVersionId: query.strategy_version_id || query.strategyVersionId || null,
    datasetId: query.dataset_id || query.datasetId || null,
    simulationRunId: query.simulation_run_id || query.simulationRunId || null,
    artifactKind: query.artifact_kind || query.artifactKind || null,
    sort: query.sort || query.order_by || query.orderBy || "created_desc",
    limit: query.limit ? Number(query.limit) : undefined,
  };
}

function listQuery(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}
