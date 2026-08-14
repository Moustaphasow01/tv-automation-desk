import assert from "node:assert/strict";
import test from "node:test";
import {
  handleFrontOperations,
  isFrontOperationsMethodAllowed,
  isFrontOperationsPath,
  isFrontOperationsWriteRequest,
} from "../src/front-operations-api.js";

test("operations router recognizes deep read and protected write routes", () => {
  assert.equal(isFrontOperationsPath("/api/v1/operations/summary"), true);
  assert.equal(isFrontOperationsPath("/api/v1/workflows/replay%3Arun-1/events"), true);
  assert.equal(isFrontOperationsPath("/api/v1/replays/run-1/days/2026-07-16"), true);
  assert.equal(isFrontOperationsPath("/api/v1/replays/run-1/sessions/run-2"), true);
  assert.equal(isFrontOperationsPath("/api/v1/simulation-runs"), true);
  assert.equal(isFrontOperationsPath("/api/v1/simulation-runs/compare"), true);
  assert.equal(isFrontOperationsPath("/api/v1/simulation-runs/11111111-1111-4111-8111-111111111111"), true);
  assert.equal(isFrontOperationsPath("/api/v1/simulation-runs/11111111-1111-4111-8111-111111111111/artifacts"), true);
  assert.equal(isFrontOperationsPath("/api/v1/history/sessions/2026-07-16%3Aasia_open"), true);
  assert.equal(isFrontOperationsPath("/api/v1/observability/overview"), true);
  assert.equal(isFrontOperationsPath("/api/v1/observability/policy"), true);
  assert.equal(isFrontOperationsPath("/api/v1/ai/runtime-settings"), true);
  assert.equal(isFrontOperationsPath("/api/v1/agent-runtime/overview"), true);
  assert.equal(isFrontOperationsPath("/api/v1/agent-runtime/tasks"), true);
  assert.equal(isFrontOperationsPath("/api/v1/agent-runtime/pools"), true);
  assert.equal(isFrontOperationsPath("/api/v1/agent-runtime/scheduler-plan"), true);
  assert.equal(isFrontOperationsPath("/api/v1/agent-runtime/metrics"), true);
  assert.equal(isFrontOperationsPath("/api/v1/agent-runtime/dead-letters"), true);
  assert.equal(isFrontOperationsPath("/api/v1/agent-runtime/dead-letters/66666666-6666-4666-8666-666666666666/requeue"), true);
  assert.equal(isFrontOperationsPath("/api/v1/agent-runtime/tasks/44444444-4444-4444-8444-444444444444/cancel"), true);
  assert.equal(isFrontOperationsPath("/api/v1/observability/incidents/evaluate"), true);
  assert.equal(isFrontOperationsPath("/api/v1/notifications"), true);
  assert.equal(isFrontOperationsPath("/api/v1/notifications/sync"), true);
  assert.equal(isFrontOperationsPath("/api/v1/notifications/notification%3Aabc/actions"), true);
  assert.equal(isFrontOperationsPath("/api/v1/telegram"), true);
  assert.equal(isFrontOperationsPath("/api/v1/telegram/actions"), true);
  assert.equal(isFrontOperationsPath("/api/v1/strategy-v2/overview"), true);
  assert.equal(isFrontOperationsPath("/api/v1/strategy-v2/definitions"), true);
  assert.equal(isFrontOperationsPath("/api/v1/strategy-v2/definitions/11111111-1111-4111-8111-111111111111"), true);
  assert.equal(isFrontOperationsPath("/api/v1/strategy-v2/versions"), true);
  assert.equal(isFrontOperationsPath("/api/v1/strategy-v2/versions/22222222-2222-4222-8222-222222222222/actions"), true);
  assert.equal(isFrontOperationsPath("/api/v1/strategy-v2/instances"), true);
  assert.equal(isFrontOperationsPath("/api/v1/strategy-v2/instances/33333333-3333-4333-8333-333333333333/actions"), true);
  assert.equal(isFrontOperationsPath("/api/v1/strategy-v2/signals"), true);
  assert.equal(isFrontOperationsPath("/api/v1/strategy-v2/signals/44444444-4444-4444-8444-444444444444/actions"), true);
  assert.equal(isFrontOperationsPath("/api/v1/strategy-v2/audit"), true);
  assert.equal(isFrontOperationsPath("/api/v1/prompt-registry/overview"), true);
  assert.equal(isFrontOperationsPath("/api/v1/portfolio-risk/overview"), true);
  assert.equal(isFrontOperationsPath("/api/v1/ai-context/overview"), true);
  assert.equal(isFrontOperationsPath("/api/v1/data-foundation/overview"), true);
  assert.equal(isFrontOperationsPath("/api/v1/data-foundation/sources"), true);
  assert.equal(isFrontOperationsPath("/api/v1/data-foundation/ingestion-batches"), true);
  assert.equal(isFrontOperationsPath("/api/v1/data-foundation/datasets"), true);
  assert.equal(isFrontOperationsPath("/api/v1/data-foundation/features"), true);
  assert.equal(isFrontOperationsPath("/api/v1/data-foundation/feature-computations"), true);
  assert.equal(isFrontOperationsPath("/api/v1/data-foundation/market-data-profiles"), true);
  assert.equal(isFrontOperationsPath("/api/v1/data-foundation/storage-objects"), true);
  assert.equal(isFrontOperationsPath("/api/v1/data-foundation/hot-series-windows"), true);
  assert.equal(isFrontOperationsPath("/api/v1/data-foundation/feature-values"), true);
  assert.equal(isFrontOperationsPath("/api/v1/runbooks"), true);
  assert.equal(isFrontOperationsPath("/api/v1/runbooks/runbook%3Aabc"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/observability/policy", "POST"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/ai/runtime-settings", "POST"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/agent-runtime/overview", "POST"), false);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/agent-runtime/dead-letters/66666666-6666-4666-8666-666666666666/requeue", "POST"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/agent-runtime/tasks/44444444-4444-4444-8444-444444444444/cancel", "POST"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/observability/incidents/evaluate", "POST"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/notifications/sync", "POST"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/notifications/notification%3Aabc/actions", "POST"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/telegram/actions", "POST"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/strategy-v2/overview", "POST"), false);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/strategy-v2/definitions", "POST"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/strategy-v2/versions/22222222-2222-4222-8222-222222222222/actions", "POST"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/strategy-v2/signals", "POST"), false);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/strategy-v2/signals/44444444-4444-4444-8444-444444444444/actions", "POST"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/strategy-v2/audit", "POST"), false);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/telegram", "POST"), false);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/telegram/actions", "GET"), false);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/strategy-v2/overview", "GET"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/strategy-v2/overview", "POST"), false);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/strategy-v2/definitions", "GET"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/strategy-v2/definitions", "POST"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/strategy-v2/definitions/11111111-1111-4111-8111-111111111111", "POST"), false);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/strategy-v2/versions/22222222-2222-4222-8222-222222222222/actions", "POST"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/strategy-v2/signals", "GET"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/strategy-v2/signals", "POST"), false);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/strategy-v2/signals/44444444-4444-4444-8444-444444444444/actions", "POST"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/strategy-v2/audit", "GET"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/strategy-v2/audit", "POST"), false);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/prompt-registry/overview", "GET"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/prompt-registry/overview", "POST"), false);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/portfolio-risk/overview", "GET"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/portfolio-risk/overview", "POST"), false);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/ai-context/overview", "GET"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/ai-context/overview", "POST"), false);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/prompt-registry/overview", "POST"), false);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/portfolio-risk/overview", "POST"), false);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/ai-context/overview", "POST"), false);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/data-foundation/sources", "POST"), false);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/data-foundation/sources", "GET"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/data-foundation/sources", "POST"), false);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/observability/policy", "POST"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/ai/runtime-settings", "GET"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/ai/runtime-settings", "POST"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/agent-runtime/tasks", "GET"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/agent-runtime/tasks", "POST"), false);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/agent-runtime/dead-letters/66666666-6666-4666-8666-666666666666/requeue", "GET"), false);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/agent-runtime/dead-letters/66666666-6666-4666-8666-666666666666/requeue", "POST"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/observability/incidents/evaluate", "GET"), false);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/notifications/sync", "GET"), false);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/workflows/run-1/actions", "POST"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/simulation-runs", "POST"), false);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/simulation-runs/compare", "GET"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/simulation-runs/compare", "POST"), false);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/workflows/run-1/actions", "GET"), false);
});

test("operations router delegates Prompt Registry overview as read-only", async () => {
  const calls = [];
  const store = {
    async getPromptRegistryOverview() {
      calls.push(["overview"]);
      return { contract: "DeskPromptRegistryOverviewV1" };
    },
  };

  const result = await handleFrontOperations(store, {
    pathname: "/api/v1/prompt-registry/overview",
    method: "GET",
  });

  assert.deepEqual(calls, [["overview"]]);
  assert.equal(result.contract, "DeskPromptRegistryOverviewV1");
});

test("operations router delegates Portfolio Risk overview as read-only", async () => {
  const calls = [];
  const store = {
    clock: { now: () => ({ utc: "2026-08-09T08:00:00.000Z" }) },
    async getExecutionOverview(input) { calls.push(["execution", input]); return { safety: {}, accounts: [], accountSnapshots: [], policies: [], contracts: [], trades: [], intents: [], orders: [], locks: [], reconciliations: [], adapterParityRuns: [] }; },
    async getStrategyV2Overview(input) { calls.push(["strategy", input]); return { instances: [] }; },
    async getOperationsPerformance(input) { calls.push(["performance", input]); return { items: [] }; },
  };

  const result = await handleFrontOperations(store, {
    pathname: "/api/v1/portfolio-risk/overview",
    method: "GET",
    query: { limit: "50" },
  });

  assert.equal(result.contract, "DeskPortfolioRiskOverview");
  assert.deepEqual(calls.map(([name]) => name), ["execution", "strategy", "performance"]);
  assert.equal(calls[0][1].limit, 50);
});

test("operations router delegates AI Context overview as read-only", async () => {
  const calls = [];
  const store = {
    clock: { now: () => ({ utc: "2026-08-10T08:00:00.000Z" }) },
    async listAgentRuntimeTasks(input) { calls.push(["tasks", input]); return { ok: true, items: [] }; },
    async listAgentRuntimeMetrics(input) { calls.push(["metrics", input]); return { ok: true, items: [] }; },
    async listAgentRuntimeDeadLetters(input) { calls.push(["deadLetters", input]); return { ok: true, items: [] }; },
  };

  const result = await handleFrontOperations(store, {
    pathname: "/api/v1/ai-context/overview",
    method: "GET",
    query: { limit: "25" },
  });

  assert.equal(result.contract, "DeskAiContextOverview");
  assert.deepEqual(calls.map(([name]) => name), ["tasks", "metrics", "deadLetters"]);
  assert.equal(calls[0][1].limit, 25);
});

test("operations router delegates Agent Runtime cockpit routes", async () => {
  const calls = [];
  const store = {
    async getAgentRuntimeOverview(input) { calls.push(["overview", input]); return { ok: true, schema: "agent_runtime_admin_overview_v1" }; },
    async listAgentRuntimeTasks(input) { calls.push(["tasks", input]); return { ok: true, items: [] }; },
    async getAgentRuntimePoolOverview(input) { calls.push(["pools", input]); return { ok: true, pools: [] }; },
    async getAgentRuntimeSchedulerPlan(input) { calls.push(["scheduler", input]); return { ok: true, plan: { selected_tasks: [] } }; },
    async listAgentRuntimeMetrics(input) { calls.push(["metrics", input]); return { ok: true, items: [] }; },
    async listAgentRuntimeDeadLetters(input) { calls.push(["deadLetters", input]); return { ok: true, items: [] }; },
    async requeueAgentRuntimeDeadLetter(input) { calls.push(["requeue", input]); return { ok: true, action: "REQUEUE_DEAD_LETTER" }; },
    async cancelAgentRuntimeTask(input) { calls.push(["cancel", input]); return { ok: true, action: "CANCEL_TASK" }; },
  };

  await handleFrontOperations(store, { pathname: "/api/v1/agent-runtime/overview", method: "GET", query: { lane: "live", limit: "25" } });
  await handleFrontOperations(store, { pathname: "/api/v1/agent-runtime/tasks", method: "GET", query: { status: "READY", mission_id: "22222222-2222-4222-8222-222222222222" } });
  await handleFrontOperations(store, { pathname: "/api/v1/agent-runtime/pools", method: "GET", query: { metrics_window_minutes: "120" } });
  await handleFrontOperations(store, { pathname: "/api/v1/agent-runtime/scheduler-plan", method: "GET", query: { task_key_prefix: "live.", limit: "10" } });
  await handleFrontOperations(store, { pathname: "/api/v1/agent-runtime/metrics", method: "GET", query: { outcome: "COMPLETED", task_id: "44444444-4444-4444-8444-444444444444" } });
  await handleFrontOperations(store, { pathname: "/api/v1/agent-runtime/dead-letters", method: "GET", query: { status: "OPEN" } });
  await handleFrontOperations(store, {
    pathname: "/api/v1/agent-runtime/dead-letters/66666666-6666-4666-8666-666666666666/requeue",
    method: "POST",
    body: { operator_id: "operator-01", reason: "operator verified recovery", idempotency_key: "requeue-66666666" },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/agent-runtime/tasks/44444444-4444-4444-8444-444444444444/cancel",
    method: "POST",
    body: { operator_id: "operator-01", reason: "operator cancels stale task", idempotency_key: "cancel-44444444" },
  });

  assert.deepEqual(calls.map(([name]) => name), ["overview", "tasks", "pools", "scheduler", "metrics", "deadLetters", "requeue", "cancel"]);
  assert.equal(calls[0][1].lane, "live");
  assert.equal(calls[0][1].limit, 25);
  assert.equal(calls[1][1].status, "READY");
  assert.equal(calls[1][1].mission_id, "22222222-2222-4222-8222-222222222222");
  assert.equal(calls[2][1].metrics_window_minutes, 120);
  assert.equal(calls[3][1].task_key_prefix, "live.");
  assert.equal(calls[4][1].task_id, "44444444-4444-4444-8444-444444444444");
  assert.equal(calls[5][1].status, "OPEN");
  assert.equal(calls[6][1].input.dead_letter_id, "66666666-6666-4666-8666-666666666666");
  assert.equal(calls[7][1].input.task_id, "44444444-4444-4444-8444-444444444444");
});

test("operations router delegates Simulation Run read-only routes", async () => {
  const calls = [];
  const store = {
    operations: {
      async listSimulationRuns(input) { calls.push(["list", input]); return { contract: "DeskSimulationRunList" }; },
      async compareSimulationRuns(ids) { calls.push(["compare", ids]); return { contract: "DeskSimulationRunComparison" }; },
      async getSimulationRun(id) { calls.push(["get", id]); return { contract: "DeskSimulationRunDetail" }; },
      async getSimulationRunArtifacts(id, input) { calls.push(["artifacts", id, input]); return { contract: "DeskSimulationRunArtifactList" }; },
    },
  };

  await handleFrontOperations(store, {
    pathname: "/api/v1/simulation-runs",
    method: "GET",
    query: { strategy_version_id: "strategy-v1", dataset_id: "dataset-1", status: "COMPLETED", sort: "performance_desc", limit: "25" },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/simulation-runs/compare",
    method: "GET",
    query: { ids: "sim-a,sim-b" },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/simulation-runs/sim-a",
    method: "GET",
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/simulation-runs/sim-a/artifacts",
    method: "GET",
    query: { artifact_kind: "METRICS" },
  });

  assert.equal(calls[0][0], "list");
  assert.equal(calls[0][1].strategyVersionId, "strategy-v1");
  assert.equal(calls[0][1].datasetId, "dataset-1");
  assert.equal(calls[0][1].sort, "performance_desc");
  assert.equal(calls[0][1].limit, 25);
  assert.deepEqual(calls[1], ["compare", ["sim-a", "sim-b"]]);
  assert.deepEqual(calls[2], ["get", "sim-a"]);
  assert.equal(calls[3][0], "artifacts");
  assert.equal(calls[3][1], "sim-a");
  assert.equal(calls[3][2].artifactKind, "METRICS");
});

test("operations router delegates Data Foundation read-only API with controlled filters", async () => {
  const calls = [];
  const store = {
    async getDataFoundationOverview(input) { calls.push(["overview", input]); return { contract: "DeskDataFoundationOverviewV1" }; },
    async listDataFoundationSources(input) { calls.push(["sources", input]); return { contract: "DeskDataSourceListV1" }; },
    async listDataFoundationIngestionBatches(input) { calls.push(["batches", input]); return { contract: "DeskIngestionBatchListV1" }; },
    async listDataFoundationDatasets(input) { calls.push(["datasets", input]); return { contract: "DeskDatasetListV1" }; },
    async listDataFoundationFeatures(input) { calls.push(["features", input]); return { contract: "DeskFeatureDefinitionListV1" }; },
    async listDataFoundationFeatureComputations(input) { calls.push(["computations", input]); return { contract: "DeskFeatureComputationRunListV1" }; },
    async listDataFoundationMarketDataProfiles(input) { calls.push(["marketProfiles", input]); return { contract: "DeskMarketDataCapabilityProfileListV1" }; },
    async listDataFoundationStorageObjects(input) { calls.push(["storageObjects", input]); return { contract: "DeskMarketDataStorageObjectListV1" }; },
    async listDataFoundationHotSeriesWindows(input) { calls.push(["hotWindows", input]); return { contract: "DeskMarketDataHotSeriesWindowListV1" }; },
    async listDataFoundationFeatureValues(input) { calls.push(["values", input]); return { contract: "DeskFeatureValueListV1" }; },
  };

  await handleFrontOperations(store, {
    pathname: "/api/v1/data-foundation/overview",
    method: "GET",
    query: { audience: "agent", limit: "25" },
    actor: { kind: "rest_read" },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/data-foundation/sources",
    method: "GET",
    query: { kind: "market_ohlcv", provider: "tradingview", environment: "preprod" },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/data-foundation/ingestion-batches",
    method: "GET",
    query: { source_key: "tradingview.mnq.m1", status: "COMPLETED" },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/data-foundation/datasets",
    method: "GET",
    query: { dataset_key: "mnq-2026-06-11-cutoff", status: "READY" },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/data-foundation/features",
    method: "GET",
    query: { category: "volatility" },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/data-foundation/feature-computations",
    method: "GET",
    query: { feature_key: "atr_14", dataset_key: "mnq-2026-06-11-cutoff" },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/data-foundation/market-data-profiles",
    method: "GET",
    query: {
      source_key: "prod__tradingview__MNQ1!__1",
      instrument_code: "MNQ1!",
      timeframe: "1",
      status: "partial",
      blocking_classification: "non_blocking",
      limit: "50",
    },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/data-foundation/storage-objects",
    method: "GET",
    query: {
      instrument_code: "MNQ1!",
      storage_tier: "hot_and_cold",
      storage_format: "parquet",
      status: "active",
    },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/data-foundation/hot-series-windows",
    method: "GET",
    query: {
      source_key: "prod__tradingview__MNQ1!__1",
      timeframe: "1",
      status: "planned",
    },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/data-foundation/feature-values",
    method: "GET",
    query: {
      feature_key: "atr_14",
      dataset_key: "mnq-2026-06-11-cutoff",
      entity_key: "MNQ",
      timeframe: "M15",
      from_utc: "2026-06-11T07:00:00.000Z",
      to_utc: "2026-06-11T21:00:00.000Z",
      limit: "500",
    },
  });

  assert.equal(calls[0][0], "overview");
  assert.equal(calls[0][1].audience, "agent");
  assert.equal(calls[0][1].limit, 25);
  assert.equal(calls[0][1].actor.kind, "rest_read");
  assert.equal(calls[1][1].kind, "market_ohlcv");
  assert.equal(calls[1][1].provider, "tradingview");
  assert.equal(calls[2][1].source_key, "tradingview.mnq.m1");
  assert.equal(calls[3][1].dataset_key, "mnq-2026-06-11-cutoff");
  assert.equal(calls[4][1].category, "volatility");
  assert.equal(calls[5][1].feature_key, "atr_14");
  assert.equal(calls[6][0], "marketProfiles");
  assert.equal(calls[6][1].source_key, "prod__tradingview__MNQ1!__1");
  assert.equal(calls[6][1].blocking_classification, "non_blocking");
  assert.equal(calls[6][1].limit, 50);
  assert.equal(calls[7][0], "storageObjects");
  assert.equal(calls[7][1].storage_tier, "hot_and_cold");
  assert.equal(calls[7][1].storage_format, "parquet");
  assert.equal(calls[8][0], "hotWindows");
  assert.equal(calls[8][1].status, "planned");
  assert.equal(calls[9][1].timeframe, "M15");
});

test("operations router delegates Research Lab read-only API with controlled filters", async () => {
  const calls = [];
  const store = {
    async getResearchLabOverview(input) { calls.push(["overview", input]); return { contract: "DeskResearchLabOverviewV1" }; },
    async listResearchExperiments(input) { calls.push(["experiments", input]); return { contract: "DeskResearchExperimentListV1" }; },
    async getResearchExperiment(input) { calls.push(["experiment", input]); return { contract: "DeskResearchExperimentDetailV1" }; },
    async listResearchCandidates(input) { calls.push(["candidates", input]); return { contract: "DeskResearchCandidateListV1" }; },
    async getResearchCandidate(input) { calls.push(["candidate", input]); return { contract: "DeskResearchCandidateDetailV1" }; },
    async listResearchEvaluationReports(input) { calls.push(["reports", input]); return { contract: "DeskResearchEvaluationReportListV1" }; },
  };

  await handleFrontOperations(store, {
    pathname: "/api/v1/research/overview",
    method: "GET",
    query: { audience: "operator", limit: "25" },
    actor: { kind: "rest_read" },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/research/experiments",
    method: "GET",
    query: { status: "ACTIVE", owner: "research" },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/research/experiments/exp-1",
    method: "GET",
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/research/candidates",
    method: "GET",
    query: { research_experiment_id: "exp-1", status: "UNDER_REVIEW" },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/research/candidates/candidate-1",
    method: "GET",
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/research/evaluation-reports",
    method: "GET",
    query: { research_candidate_id: "candidate-1", verdict: "PASS", report_kind: "ROBUSTNESS" },
  });

  assert.equal(calls[0][0], "overview");
  assert.equal(calls[0][1].audience, "operator");
  assert.equal(calls[0][1].limit, 25);
  assert.equal(calls[0][1].actor.kind, "rest_read");
  assert.deepEqual(calls[1], ["experiments", { audience: "front", actor: {}, researchExperimentId: null, researchHypothesisId: null, researchCandidateId: null, status: "ACTIVE", verdict: null, reportKind: null, owner: "research", limit: undefined }]);
  assert.deepEqual(calls[2], ["experiment", { research_experiment_id: "exp-1" }]);
  assert.equal(calls[3][1].researchExperimentId, "exp-1");
  assert.deepEqual(calls[4], ["candidate", { research_candidate_id: "candidate-1" }]);
  assert.equal(calls[5][1].researchCandidateId, "candidate-1");
  assert.equal(calls[5][1].reportKind, "ROBUSTNESS");
});

test("operations router validates and delegates Strategy v2 REST routes", async () => {
  const calls = [];
  const store = {
    async listStrategyV2Definitions(input) { calls.push(["listDefinitions", input]); return { contract: "DeskStrategyDefinitionListV2" }; },
    async getStrategyV2Definition(input) { calls.push(["getDefinition", input]); return { contract: "DeskStrategyDefinitionV2" }; },
    async createStrategyV2Definition(input) { calls.push(["createDefinition", input]); return { contract: "DeskStrategyDefinitionCommandResultV2" }; },
    async listStrategyV2Versions(input) { calls.push(["listVersions", input]); return { contract: "DeskStrategyVersionListV2" }; },
    async getStrategyV2Version(input) { calls.push(["getVersion", input]); return { contract: "DeskStrategyVersionV2" }; },
    async createStrategyV2Version(input) { calls.push(["createVersion", input]); return { contract: "DeskStrategyVersionCommandResultV2" }; },
    async executeStrategyV2VersionAction(input) { calls.push(["versionAction", input]); return { contract: "DeskStrategyVersionCommandResultV2" }; },
    async listStrategyV2Instances(input) { calls.push(["listInstances", input]); return { contract: "DeskStrategyInstanceListV2" }; },
    async getStrategyV2Instance(input) { calls.push(["getInstance", input]); return { contract: "DeskStrategyInstanceV2" }; },
    async createStrategyV2Instance(input) { calls.push(["createInstance", input]); return { contract: "DeskStrategyInstanceCommandResultV2" }; },
    async executeStrategyV2InstanceAction(input) { calls.push(["instanceAction", input]); return { contract: "DeskStrategyInstanceCommandResultV2" }; },
    async pollStrategyV2Signals(input) { calls.push(["signals", input]); return { contract: "DeskStrategySignalPollResultV2" }; },
    async consumeStrategyV2Signal(input) { calls.push(["signalAction", input]); return { contract: "DeskStrategySignalConsumeResultV2" }; },
    async listStrategyV2AuditEvents(input) { calls.push(["audit", input]); return { contract: "DeskStrategyKernelAuditEventListV2" }; },
    async getStrategyV2Overview(input) { calls.push(["overview", input]); return { contract: "DeskStrategyV2Overview" }; },
  };

  await handleFrontOperations(store, {
    pathname: "/api/v1/strategy-v2/overview",
    method: "GET",
    query: { limit: "40" },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/strategy-v2/definitions",
    method: "GET",
    query: { limit: "25" },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/strategy-v2/definitions/11111111-1111-4111-8111-111111111111",
    method: "GET",
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/strategy-v2/definitions",
    method: "POST",
    actor: { kind: "operator", email: "operator@desk.local" },
    body: definitionBody(),
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/strategy-v2/versions",
    method: "GET",
    query: { strategy_definition_id: "11111111-1111-4111-8111-111111111111", status: "DRAFT" },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/strategy-v2/versions",
    method: "POST",
    actor: { kind: "operator" },
    body: versionBody(),
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/strategy-v2/versions/22222222-2222-4222-8222-222222222222/actions",
    method: "POST",
    actor: { kind: "operator" },
    body: {
      action: "transition_status",
      nextStatus: "IN_SIMULATION",
      idempotencyKey: "strategy-version-transition-1",
      reason: "Start simulation",
    },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/strategy-v2/instances",
    method: "GET",
    query: { strategy_version_id: "22222222-2222-4222-8222-222222222222", execution_mode: "SHADOW" },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/strategy-v2/instances",
    method: "POST",
    actor: { kind: "operator" },
    body: instanceBody(),
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/strategy-v2/instances/33333333-3333-4333-8333-333333333333/actions",
    method: "POST",
    actor: { kind: "operator" },
    body: {
      action: "transition",
      nextExecutionMode: "PAPER",
      accountScope: "ninjatrader_sim101_local",
      idempotencyKey: "strategy-instance-transition-1",
      reason: "Paper dry-run",
    },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/strategy-v2/signals",
    method: "GET",
    query: { limit: "15", execution_mode: "PAPER", instrument: "MNQ" },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/strategy-v2/signals/44444444-4444-4444-8444-444444444444/actions",
    method: "POST",
    actor: { kind: "operator" },
    body: {
      action: "consume",
      consumerId: "front-transition-panel",
      idempotencyKey: "strategy-signal-consume-1",
      reason: "Operator acknowledged signal",
    },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/strategy-v2/audit",
    method: "GET",
    query: { aggregate_type: "strategy_version", aggregate_id: "22222222-2222-4222-8222-222222222222" },
  });

  assert.equal(calls[0][0], "overview");
  assert.equal(calls[0][1].limit, 40);
  assert.equal(calls[1][0], "listDefinitions");
  assert.equal(calls[1][1].limit, 25);
  assert.deepEqual(calls[2][1], { strategy_definition_id: "11111111-1111-4111-8111-111111111111" });
  assert.equal(calls[3][1].input.external_key, "breakout-retest-mnq");
  assert.equal(calls[3][1].actor.email, "operator@desk.local");
  assert.equal(calls[4][1].strategy_definition_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(calls[6][1].strategy_version_id, "22222222-2222-4222-8222-222222222222");
  assert.equal(calls[6][1].input.nextStatus, "IN_SIMULATION");
  assert.equal(calls[7][1].execution_mode, "SHADOW");
  assert.equal(calls[9][1].input.accountScope, "ninjatrader_sim101_local");
  assert.equal(calls[10][0], "signals");
  assert.equal(calls[10][1].instrument, "MNQ");
  assert.equal(calls[11][1].signal_outbox_id, "44444444-4444-4444-8444-444444444444");
  assert.equal(calls[11][1].input.consumerId, "front-transition-panel");
  assert.equal(calls[12][1].aggregate_type, "strategy_version");

  await assert.rejects(
    handleFrontOperations(store, {
      pathname: "/api/v1/strategy-v2/versions/22222222-2222-4222-8222-222222222222/actions",
      method: "POST",
      body: { action: "transition_status", nextStatus: "PUBLISHED", reason: "missing idempotency" },
    }),
    (error) => error.code === "INVALID_STRATEGY_VERSION_ACTION",
  );
});

test("operations router accepts Strategy v2 DSL compilation action", async () => {
  const calls = [];
  const store = {
    async executeStrategyV2VersionAction(input) {
      calls.push(input);
      return { contract: "DeskStrategyVersionCompilationResultV2" };
    },
  };

  const result = await handleFrontOperations(store, {
    pathname: "/api/v1/strategy-v2/versions/22222222-2222-4222-8222-222222222222/actions",
    method: "POST",
    actor: { kind: "operator" },
    body: {
      action: "compile_dsl",
      dslSource: { schema_version: "strategy_dsl_v1", pattern: "BREAKOUT_RETEST", setup_templates: [] },
      runtimeBindings: { valid_from_paris: "2026-06-11T15:30:00+02:00", expires_at_paris: "2026-06-11T16:15:00+02:00" },
      scope: { session: "ny_open", trading_date: "2026-06-11" },
      sourceMode: "PAPER",
      idempotencyKey: "strategy-version-compile-1",
      reason: "Compile DSL",
    },
  });

  assert.equal(result.contract, "DeskStrategyVersionCompilationResultV2");
  assert.equal(calls[0].strategy_version_id, "22222222-2222-4222-8222-222222222222");
  assert.equal(calls[0].input.action, "compile_dsl");
  assert.equal(calls[0].input.sourceMode, "PAPER");
});

test("operations router validates and delegates Codex runtime settings", async () => {
  const calls = [];
  const store = {
    async getOperationsAiRuntimeSettings() {
      return { contract: "DeskAiRuntimeSettings", settings: { reasoningEffort: "xhigh" } };
    },
    async executeOperationsAiRuntimeSettingsAction(input) {
      calls.push(input);
      return { contract: "DeskOperationsCommandResult" };
    },
  };

  const current = await handleFrontOperations(store, {
    pathname: "/api/v1/ai/runtime-settings",
    method: "GET",
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/ai/runtime-settings",
    method: "POST",
    actor: { kind: "operator" },
    body: {
      action: "update_reasoning_effort",
      expectedRevision: 0,
      reasoningEffort: "xhigh",
      idempotencyKey: "codex-effort-1",
      confirmationPhrase: "CONFIRM_UPDATE_REASONING_EFFORT",
      reason: "Renforcer les analyses",
    },
  });

  assert.equal(current.settings.reasoningEffort, "xhigh");
  assert.equal(calls[0].input.reasoningEffort, "xhigh");
  assert.equal(calls[0].actor.kind, "operator");
});

test("operations router validates and delegates Telegram controls", async () => {
  const calls = [];
  const store = {
    async getTelegramStatus() { return { contract: "DeskTelegramStatus" }; },
    async executeTelegramAction(input) { calls.push(input); return { ok: true }; },
  };
  const status = await handleFrontOperations(store, {
    pathname: "/api/v1/telegram",
    method: "GET",
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/telegram/actions",
    method: "POST",
    actor: { kind: "operator" },
    body: {
      action: "configure",
      expectedRevision: 0,
      enabled: true,
      adminEnabled: true,
      tradingEnabled: true,
      commandsEnabled: true,
      idempotencyKey: "telegram-config-1",
      confirmationPhrase: "CONFIRM_TELEGRAM_CONFIGURATION",
      reason: "Activer les deux canaux",
    },
  });
  assert.equal(status.contract, "DeskTelegramStatus");
  assert.equal(calls[0].input.enabled, true);
  assert.equal(calls[0].actor.kind, "operator");
  await assert.rejects(
    handleFrontOperations(store, {
      pathname: "/api/v1/telegram/actions",
      method: "POST",
      body: {
        action: "test",
        profile: "admin",
        idempotencyKey: "telegram-test-1",
        confirmationPhrase: "WRONG",
        reason: "Tester",
      },
    }),
    (error) => error.code === "INVALID_TELEGRAM_ACTION",
  );
});

test("operations router delegates normalized workflow IDs and filters", async () => {
  const calls = [];
  const store = {
    async listOperationsWorkflows(input) { calls.push(input); return { ok: true }; },
    async getOperationsWorkflow({ workflow_id }) { return { workflow: { id: workflow_id }, steps: [], events: [] }; },
  };
  await handleFrontOperations(store, { pathname: "/api/v1/workflows", method: "GET", query: { status: "running", strategy_id: "asia_open", limit: "25" } });
  const detail = await handleFrontOperations(store, { pathname: "/api/v1/workflows/replay%3Arun-1", method: "GET" });
  assert.deepEqual(calls[0], {
    kind: null,
    scope: null,
    workflow: null,
    worker: null,
    model: null,
    provider: null,
    status: "running",
    level: null,
    session: null,
    strategyId: "asia_open",
    strategyVersionId: null,
    datasetId: null,
    simulationRunId: null,
    artifactKind: null,
    versionScope: null,
    instrument: null,
    direction: null,
    date: null,
    from: null,
    to: null,
    runId: null,
    process: null,
    incident: null,
    runbook: null,
    target: null,
    q: null,
    limit: 25,
  });
  assert.equal(detail.workflow.id, "replay:run-1");
});

test("operations router delegates notification listing, sync and actions", async () => {
  const calls = [];
  const store = {
    async listOperationsNotifications(input) { calls.push(["list", input]); return { contract: "DeskNotificationList" }; },
    async syncOperationsNotifications(input) { calls.push(["sync", input]); return { contract: "DeskNotificationSync" }; },
    async executeOperationsNotificationAction(input) { calls.push(["action", input]); return { contract: "DeskOperationsCommandResult" }; },
  };
  const list = await handleFrontOperations(store, {
    pathname: "/api/v1/notifications",
    method: "GET",
    query: { status: "active", level: "page", q: "lease" },
  });
  const sync = await handleFrontOperations(store, {
    pathname: "/api/v1/notifications/sync",
    method: "POST",
    body: { autoClear: false, reason: "sync ciblée" },
    actor: { kind: "test" },
  });
  const action = await handleFrontOperations(store, {
    pathname: "/api/v1/notifications/notification%3An1/actions",
    method: "POST",
    body: { action: "mark_read", expectedRevision: 1, idempotencyKey: "notif-read-1", confirmationPhrase: "CONFIRM_MARK_READ", reason: "vu" },
    actor: { kind: "operator" },
  });
  assert.equal(list.contract, "DeskNotificationList");
  assert.equal(sync.contract, "DeskNotificationSync");
  assert.equal(action.contract, "DeskOperationsCommandResult");
  assert.equal(calls[0][1].level, "page");
  assert.equal(calls[1][1].input.autoClear, false);
  assert.deepEqual(calls[2][1].notification_id, "notification:n1");
  assert.equal(calls[2][1].actor.kind, "operator");

  await assert.rejects(
    handleFrontOperations(store, { pathname: "/api/v1/notifications/sync", method: "POST", body: { reason: "no" } }),
    (error) => error.code === "INVALID_NOTIFICATION_SYNC",
  );
});

test("operations router delegates runbooks list and detail", async () => {
  const calls = [];
  const store = {
    async listOperationsRunbooks(input) { calls.push(["list", input]); return { contract: "DeskRunbookList" }; },
    async getOperationsRunbook(input) { calls.push(["detail", input]); return { contract: "DeskRunbookDetail" }; },
  };
  const list = await handleFrontOperations(store, {
    pathname: "/api/v1/runbooks",
    method: "GET",
    query: { kind: "lease_expired", status: "action_required", q: "lease" },
  });
  const detail = await handleFrontOperations(store, {
    pathname: "/api/v1/runbooks/runbook%3Aabc",
    method: "GET",
  });
  assert.equal(list.contract, "DeskRunbookList");
  assert.equal(detail.contract, "DeskRunbookDetail");
  assert.equal(calls[0][1].kind, "lease_expired");
  assert.equal(calls[0][1].status, "action_required");
  assert.deepEqual(calls[1][1], { runbook_id: "runbook:abc" });
});

test("operations router delegates observability dimensions", async () => {
  const calls = [];
  const store = {
    async getOperationsObservability(input) { calls.push(input); return { contract: "DeskObservabilityOverview" }; },
  };
  const result = await handleFrontOperations(store, {
    pathname: "/api/v1/observability/overview",
    method: "GET",
    query: { scope: "replay", worker: "worker-a", model: "gpt-5", provider: "openai" },
  });
  assert.equal(result.contract, "DeskObservabilityOverview");
  assert.equal(calls[0].scope, "replay");
  assert.equal(calls[0].worker, "worker-a");
  assert.equal(calls[0].model, "gpt-5");
  assert.equal(calls[0].provider, "openai");
});

test("operations router validates and delegates observability policy updates", async () => {
  const calls = [];
  const store = {
    async executeOperationsObservabilityPolicyAction(input) { calls.push(input); return { contract: "DeskOperationsCommandResult" }; },
  };
  const body = {
    action: "update",
    expectedRevision: 0,
    idempotencyKey: "guardrail-policy-v1",
    confirmationPhrase: "CONFIRM_UPDATE",
    reason: "Configurer les garde-fous",
    policy: { dailyCostBudgetUsd: 1.5 },
  };
  const result = await handleFrontOperations(store, {
    pathname: "/api/v1/observability/policy",
    method: "POST",
    body,
    actor: { kind: "test" },
  });
  assert.equal(result.contract, "DeskOperationsCommandResult");
  assert.equal(calls[0].input.policy.dailyCostBudgetUsd, 1.5);
  await assert.rejects(
    handleFrontOperations(store, {
      pathname: "/api/v1/observability/policy",
      method: "POST",
      body: { ...body, confirmationPhrase: "WRONG" },
    }),
    (error) => error.code === "INVALID_OBSERVABILITY_POLICY",
  );
});

test("operations router delegates observability incident evaluation", async () => {
  const calls = [];
  const store = {
    async evaluateOperationsObservabilityIncidents(input) { calls.push(input); return { contract: "DeskObservabilityIncidentSync" }; },
  };
  const result = await handleFrontOperations(store, {
    pathname: "/api/v1/observability/incidents/evaluate",
    method: "POST",
    body: { autoResolve: false, reason: "Matérialiser les incidents" },
    actor: { kind: "test" },
  });
  assert.equal(result.contract, "DeskObservabilityIncidentSync");
  assert.equal(calls[0].input.autoResolve, false);
  assert.equal(calls[0].actor.kind, "test");
  await assert.rejects(
    handleFrontOperations(store, {
      pathname: "/api/v1/observability/incidents/evaluate",
      method: "POST",
      body: { reason: "no" },
    }),
    (error) => error.code === "INVALID_OBSERVABILITY_INCIDENT_EVALUATION",
  );
});

test("operations router delegates a decoded history session ID", async () => {
  const calls = [];
  const store = {
    async getOperationsHistorySession(input) { calls.push(input); return { contract: "DeskHistorySessionDetail" }; },
  };
  const result = await handleFrontOperations(store, {
    pathname: "/api/v1/history/sessions/2026-07-16%3Aasia_open",
    method: "GET",
  });
  assert.equal(result.contract, "DeskHistorySessionDetail");
  assert.deepEqual(calls, [{ session_id: "2026-07-16:asia_open" }]);
});

test("replay creation rejects incomplete input before reaching the store", async () => {
  const store = { async createOrchestratedReplayDay() { throw new Error("must_not_be_called"); } };
  await assert.rejects(
    handleFrontOperations(store, { pathname: "/api/v1/replays", method: "POST", body: { backtest_id: "run-1" } }),
    (error) => error.code === "INVALID_REPLAY_CREATE_INPUT" && error.statusCode === 400,
  );
});

test("replay creation delegates a Paris timezone by default", async () => {
  const calls = [];
  const store = {
    async createOrchestratedReplayDay(input) {
      calls.push(input);
      return { ok: true, backtest_id: input.backtest_id };
    },
  };
  const result = await handleFrontOperations(store, {
    pathname: "/api/v1/replays",
    method: "POST",
    body: {
      backtest_id: "run-1",
      strategy_id: "asia_open",
      trading_date: "2026-07-06",
      session: "asia_open",
      pack_id: "pack-1",
      pack_build_id: "pack-build-1",
      start_time: "2026-07-06T02:00:00+02:00",
      end_time: "2026-07-06T03:00:00+02:00",
      cadence: "15m",
      automation_enabled: false,
      idempotency_key: "replay-create-v1",
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].timezone, "Europe/Paris");
  assert.equal(calls[0].cutoff_paris, "2026-07-06T02:00:00+02:00");
});

function definitionBody() {
  return {
    strategy_definition_id: "11111111-1111-4111-8111-111111111111",
    external_key: "breakout-retest-mnq",
    name: "Breakout Retest MNQ",
    owner: "strategy-lab",
    asset_class: "futures",
    default_instruments: ["MNQ", "MES"],
    tags: ["breakout", "retest"],
    metadata: { source: "front-api-test" },
    idempotencyKey: "strategy-definition-create-1",
    reason: "Create definition",
  };
}

function versionBody() {
  return {
    strategy_version_id: "22222222-2222-4222-8222-222222222222",
    strategy_definition_id: "11111111-1111-4111-8111-111111111111",
    version_label: "1.0.0",
    status: "DRAFT",
    dsl_source_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    compiled_artifact_ref: "artifact://strategy/breakout-retest/1.0.0",
    compiled_artifact_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    runtime_contract_bundle_version: "runtime-bundle-v1",
    metadata: { compiler: "desk-deterministic-v1" },
    idempotencyKey: "strategy-version-create-1",
    reason: "Create version",
  };
}

function instanceBody() {
  return {
    strategy_instance_id: "33333333-3333-4333-8333-333333333333",
    strategy_version_id: "22222222-2222-4222-8222-222222222222",
    runtime_state: "CREATED",
    execution_mode: "SHADOW",
    instrument_scope: ["MNQ"],
    session_scope: ["ny_open"],
    triple_lock_validated: false,
    metadata: { lane: "shadow" },
    idempotencyKey: "strategy-instance-create-1",
    reason: "Create instance",
  };
}
