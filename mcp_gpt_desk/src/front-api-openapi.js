import { researchOpenApiPaths } from "./front-api-openapi-research.js";
export const FRONT_OPENAPI_PATH = "/api/v1/openapi.json";

const jsonContent = (schema) => ({
  "application/json": { schema },
});

const response = (schemaRef, description = "Successful response") => ({
  description,
  headers: {
    ETag: { $ref: "#/components/headers/ETag" },
    "Cache-Control": { $ref: "#/components/headers/CacheControl" },
  },
  content: jsonContent({ $ref: schemaRef }),
});

const errorResponses = {
  "400": { description: "Invalid path or query", content: jsonContent({ $ref: "#/components/schemas/Error" }) },
  "401": { description: "Authentication failed", content: jsonContent({ $ref: "#/components/schemas/Error" }) },
  "403": { description: "Operator scope or role forbidden", content: jsonContent({ $ref: "#/components/schemas/Error" }) },
  "404": { description: "Scoped resource not found", content: jsonContent({ $ref: "#/components/schemas/Error" }) },
  "500": { description: "Backend read failed", content: jsonContent({ $ref: "#/components/schemas/Error" }) },
};

const scopeParameters = [
  { $ref: "#/components/parameters/Session" },
  { $ref: "#/components/parameters/TradingDate" },
  { $ref: "#/components/parameters/StrategyId" },
  { $ref: "#/components/parameters/Mode" },
];

const getOperation = ({ operationId, summary, schemaRef, parameters = scopeParameters, cache = true }) => ({
  operationId,
  summary,
  tags: ["Desk Front"],
  parameters,
  responses: {
    "200": cache ? response(schemaRef) : {
      description: "Successful response",
      content: jsonContent({ $ref: schemaRef }),
    },
    ...(cache ? { "304": { description: "Resource unchanged; reuse the cached representation" } } : {}),
    ...errorResponses,
  },
});

const operationsGet = (operationId, summary, parameters = []) => getOperation({
  operationId,
  summary,
  schemaRef: "#/components/schemas/OperationsEnvelope",
  parameters,
  cache: false,
});

const dataFoundationParameters = [{ name: "audience", in: "query", required: false, schema: { type: "string", enum: ["front", "simulation", "agent", "operator"], default: "front" } }, { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 500 } }];

const dataFoundationGet = (operationId, summary, parameters = []) => ({
  operationId,
  summary,
  tags: ["Desk Data Foundation"],
  parameters: [...dataFoundationParameters, ...parameters],
  responses: {
    "200": { description: "Data Foundation controlled read model", content: jsonContent({ $ref: "#/components/schemas/DataFoundationEnvelope" }) },
    ...errorResponses,
  },
});

const operationsPost = (operationId, summary, parameters = []) => ({
  operationId,
  summary,
  tags: ["Desk Operations"],
  parameters,
  security: [{ BearerAuth: [] }, { DeskApiKey: [] }],
  requestBody: { required: true, content: jsonContent({ $ref: "#/components/schemas/OperationsCommandInput" }) },
  responses: {
    "200": { description: "Mutation appliquée ou rejouée idempotemment", content: jsonContent({ $ref: "#/components/schemas/OperationsEnvelope" }) },
    "400": errorResponses["400"], "401": errorResponses["401"], "403": errorResponses["403"],
    "404": errorResponses["404"],
    "409": { description: "Revision, capability or idempotency conflict", content: jsonContent({ $ref: "#/components/schemas/Error" }) },
    "500": errorResponses["500"],
  },
});

const executionPost = (operationId, summary, schema = "ExecutionActionInput") => ({
  operationId,
  summary,
  tags: ["Desk Execution"],
  security: [{ BearerAuth: [] }, { DeskApiKey: [] }],
  requestBody: { required: true, content: jsonContent({ $ref: `#/components/schemas/${schema}` }) },
  responses: {
    "200": { description: "Execution gateway response", content: jsonContent({ $ref: "#/components/schemas/OperationsEnvelope" }) },
    "400": errorResponses["400"], "401": errorResponses["401"], "403": errorResponses["403"], "404": errorResponses["404"],
    "409": { description: "Safety, approval, lease or reconciliation conflict", content: jsonContent({ $ref: "#/components/schemas/Error" }) },
    "500": errorResponses["500"],
  },
});

const resourceSchema = (contract, properties, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  required: ["contract", "schemaVersion", "scope", "warnings", ...required],
  properties: {
    contract: { const: contract },
    schemaVersion: { const: "1.0.0" },
    scope: { $ref: "#/components/schemas/ResourceScope" },
    warnings: { type: "array", items: { type: "string" } },
    ...properties,
  },
});

const entityResourceSchema = (contract, property, entitySchema) => resourceSchema(contract, {
  [property]: { $ref: entitySchema },
});

export function frontApiOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Desk Futures Front BFF",
      version: "1.2.0",
      description: "Presentation API for the React Desk Futures front. Reads prioritize canonical backend state; authenticated operator writes are confirmed, revisioned, idempotent and audited.",
    },
    servers: [{ url: "/api/v1" }],
    tags: [
      { name: "Desk Front", description: "Scoped read models for the new React front" },
      { name: "Desk Operator", description: "Authenticated, audited Desk-state commands; never broker order execution" },
      { name: "Desk Operations", description: "Global workflows, replays, GPT processes, incidents, history and strategy versions" },
      { name: "Desk Data Foundation", description: "Controlled read API for data sources, datasets, feature definitions and point-in-time feature values" },
      { name: "Desk Execution", description: "Fail-closed NinjaTrader Sim101 gateway. Never exposed as a GPT/MCP order tool." },
    ],
    security: [{ BearerAuth: [] }, { DeskApiKey: [] }, {}],
    paths: {
      "/openapi.json": {
        get: getOperation({ operationId: "getFrontOpenApi", summary: "Get the BFF OpenAPI document", schemaRef: "#/components/schemas/OpenApiDocument", parameters: [] }),
      },
      "/live-desk/current": {
        get: getOperation({ operationId: "getLiveDeskCurrent", summary: "Get the complete first-render Desk session", schemaRef: "#/components/schemas/DeskSession", cache: false }),
      },
      "/sessions": {
        get: getOperation({ operationId: "listDeskSessions", summary: "List Asia and NY session summaries", schemaRef: "#/components/schemas/SessionSummaryList", parameters: [], cache: false }),
      },
      "/sessions/{strategyId}/{date}/overview": {
        get: getOperation({
          operationId: "getSessionOverview",
          summary: "Get a scoped session overview",
          schemaRef: "#/components/schemas/SessionOverviewResource",
          parameters: [{ $ref: "#/components/parameters/StrategyIdPath" }, { $ref: "#/components/parameters/DatePath" }, { $ref: "#/components/parameters/Session" }, { $ref: "#/components/parameters/Mode" }],
        }),
      },
      "/sessions/{strategyId}/{date}/timeline": {
        get: getOperation({
          operationId: "getSessionTimeline",
          summary: "Get the materialized decision timeline",
          schemaRef: "#/components/schemas/TimelineResource",
          parameters: [{ $ref: "#/components/parameters/StrategyIdPath" }, { $ref: "#/components/parameters/DatePath" }, { $ref: "#/components/parameters/Session" }, { $ref: "#/components/parameters/Mode" }],
        }),
      },
      "/masters/{masterId}": {
        get: getOperation({ operationId: "getMaster", summary: "Get the current scoped Master projection", schemaRef: "#/components/schemas/MasterResource", parameters: [{ $ref: "#/components/parameters/MasterId" }, ...scopeParameters] }),
      },
      "/monitors/{monitorId}": {
        get: getOperation({ operationId: "getMonitor", summary: "Get one current scoped Monitor projection", schemaRef: "#/components/schemas/MonitorResource", parameters: [{ $ref: "#/components/parameters/MonitorId" }, ...scopeParameters] }),
      },
      "/theses/{thesisId}": {
        get: getOperation({ operationId: "getThesis", summary: "Get the current scoped thesis projection", schemaRef: "#/components/schemas/ThesisResource", parameters: [{ $ref: "#/components/parameters/ThesisId" }, ...scopeParameters] }),
      },
      "/theses/{thesisId}/conditions": {
        get: getOperation({ operationId: "getThesisConditions", summary: "Get the latest GO and invalidation conditions", schemaRef: "#/components/schemas/ConditionsResource", parameters: [{ $ref: "#/components/parameters/ThesisId" }, ...scopeParameters] }),
      },
      "/setups/{setupId}": {
        get: getOperation({ operationId: "getSetup", summary: "Get the current scoped setup projection", schemaRef: "#/components/schemas/SetupResource", parameters: [{ $ref: "#/components/parameters/SetupId" }, ...scopeParameters] }),
      },
      "/positions/current": {
        get: getOperation({ operationId: "getCurrentPosition", summary: "Get the canonical execution position", schemaRef: "#/components/schemas/PositionResource" }),
      },
      "/market/snapshot": {
        get: getOperation({ operationId: "getMarketSnapshot", summary: "Get the latest scoped market snapshot", schemaRef: "#/components/schemas/MarketResource" }),
      },
      "/macro/calendar": {
        get: getOperation({ operationId: "getMacroCalendar", summary: "Get the cutoff-safe macro calendar", schemaRef: "#/components/schemas/MacroResource" }),
      },
      "/news/headlines": {
        get: getOperation({ operationId: "getNewsHeadlines", summary: "Get cutoff-safe news headlines", schemaRef: "#/components/schemas/NewsHeadlinesResource" }),
      },
      "/news/digest": {
        get: getOperation({ operationId: "getNewsDigest", summary: "Get the cutoff-safe news digest", schemaRef: "#/components/schemas/NewsDigestResource" }),
      },
      "/desk/activity": {
        get: getOperation({ operationId: "getDeskActivity", summary: "Get recent Desk worker activity", schemaRef: "#/components/schemas/ActivityResource" }),
      },
      "/alerts": {
        get: getOperation({ operationId: "getAlerts", summary: "Get recent scoped alerts", schemaRef: "#/components/schemas/AlertsResource" }),
      },
      "/audit": {
        get: getOperation({ operationId: "getAudit", summary: "Get data-quality and contract audit state", schemaRef: "#/components/schemas/AuditResource" }),
      },
      "/performance/calendar": {
        get: getOperation({
          operationId: "getPerformanceCalendar",
          summary: "Get monthly strategy performance in R",
          schemaRef: "#/components/schemas/PerformanceCalendarResource",
          parameters: [
            ...scopeParameters,
            { name: "year", in: "query", required: true, schema: { type: "integer", minimum: 2020, maximum: 2100 } },
            { name: "month", in: "query", required: true, schema: { type: "integer", minimum: 1, maximum: 12 } },
            { name: "pricing_mode", in: "query", schema: { type: "string", enum: ["conservative", "middle", "optimistic"] } },
          ],
        }),
      },
      "/performance/day": {
        get: getOperation({
          operationId: "getPerformanceDay",
          summary: "Get one strategy day performance detail",
          schemaRef: "#/components/schemas/PerformanceDayResource",
          parameters: [
            ...scopeParameters,
            { name: "date", in: "query", required: true, schema: { type: "string", format: "date" } },
            { name: "pricing_mode", in: "query", schema: { type: "string", enum: ["conservative", "middle", "optimistic"] } },
          ],
        }),
      },
      "/operator/state": {
        get: getOperation({ operationId: "getOperatorState", summary: "Get the current operator revision and allowed canonical actions", schemaRef: "#/components/schemas/OperatorState", cache: false }),
      },
      "/operator/commands": {
        post: {
          operationId: "executeOperatorCommand",
          summary: "Apply one confirmed, revisioned and idempotent Desk command",
          description: "Mutates Desk canonical tracking state and writes command/event/audit records atomically. It never submits a broker order.",
          tags: ["Desk Operator"],
          security: [{ BearerAuth: [] }, { DeskApiKey: [] }],
          requestBody: { required: true, content: jsonContent({ $ref: "#/components/schemas/OperatorCommandInput" }) },
          responses: {
            "200": { description: "Command applied, or the identical command replayed idempotently", content: jsonContent({ $ref: "#/components/schemas/OperatorCommandResult" }) },
            "400": errorResponses["400"],
            "401": errorResponses["401"],
            "403": errorResponses["403"],
            "409": { description: "Revision, target, capability, or idempotency conflict", content: jsonContent({ $ref: "#/components/schemas/Error" }) },
            "500": { description: "Transactional command persistence failed", content: jsonContent({ $ref: "#/components/schemas/Error" }) },
          },
        },
      },
      "/operations/summary": { get: operationsGet("getOperationsSummary", "Get the global workflow cockpit summary") },
      "/workflows": { get: operationsGet("listOperationsWorkflows", "List normalized automated workflows") },
      "/workflows/{workflowId}": { get: operationsGet("getOperationsWorkflow", "Get workflow state, steps and events", [{ $ref: "#/components/parameters/WorkflowId" }]) },
      "/workflows/{workflowId}/steps": { get: operationsGet("getOperationsWorkflowSteps", "List workflow steps", [{ $ref: "#/components/parameters/WorkflowId" }]) },
      "/workflows/{workflowId}/events": { get: operationsGet("getOperationsWorkflowEvents", "List workflow events", [{ $ref: "#/components/parameters/WorkflowId" }]) },
      "/workflows/{workflowId}/actions": { post: operationsPost("executeOperationsWorkflowAction", "Retry, resume, pause or cancel a workflow", [{ $ref: "#/components/parameters/WorkflowId" }]) },
      "/replays": {
        get: operationsGet("listOperationsReplays", "List replay days and executions"),
        post: {
          operationId: "createOperationsReplay",
          summary: "Create and start a canonical orchestrated replay day",
          tags: ["Desk Operations"],
          security: [{ BearerAuth: [] }, { DeskApiKey: [] }],
          requestBody: { required: true, content: jsonContent({ $ref: "#/components/schemas/ReplayCreateInput" }) },
          responses: { "200": { description: "Replay created", content: jsonContent({ $ref: "#/components/schemas/OperationsEnvelope" }) }, ...errorResponses },
        },
      },
      "/replays/{runId}": { get: operationsGet("getOperationsReplay", "Get a replay run with GPT and timeline projections", [{ $ref: "#/components/parameters/RunId" }]) },
      "/replays/{runId}/days": { get: operationsGet("getOperationsReplayDays", "List the days related to a replay", [{ $ref: "#/components/parameters/RunId" }]) },
      "/replays/{runId}/days/{date}": { get: operationsGet("getOperationsReplayDay", "Get all session executions, variants and attempts for a day", [{ $ref: "#/components/parameters/RunId" }, { $ref: "#/components/parameters/DatePath" }]) },
      "/replays/{runId}/sessions/{sessionExecutionId}": { get: operationsGet("getOperationsReplaySession", "Get one materialized replay session execution", [{ $ref: "#/components/parameters/RunId" }, { $ref: "#/components/parameters/SessionExecutionId" }]) },
      "/replays/{runId}/timeline": { get: operationsGet("getOperationsReplayTimeline", "Get synchronized replay decision layers", [{ $ref: "#/components/parameters/RunId" }]) },
      "/replays/{runId}/price-series": { get: operationsGet("getOperationsReplayPriceSeries", "Get replay OHLC price series", [{ $ref: "#/components/parameters/RunId" }]) },
      "/gpt-processes": { get: operationsGet("listOperationsGptProcesses", "List GPT work processes") },
      "/gpt-processes/{processId}": { get: operationsGet("getOperationsGptProcess", "Inspect a GPT process, bundle and conclusion", [{ $ref: "#/components/parameters/ProcessId" }]) },
      "/observability/overview": { get: operationsGet("getOperationsObservability", "Inspect GPT queue, leases, latency, tokens and measured costs") },
      "/observability/policy": {
        get: operationsGet("getOperationsObservabilityPolicy", "Read persisted GPT SLA and measured-cost guardrails"),
        post: {
          operationId: "updateOperationsObservabilityPolicy",
          summary: "Update revisioned GPT SLA and measured-cost guardrails",
          tags: ["Desk Operations"],
          security: [{ BearerAuth: [] }, { DeskApiKey: [] }],
          requestBody: { required: true, content: jsonContent({ $ref: "#/components/schemas/ObservabilityPolicyActionInput" }) },
          responses: {
            "200": { description: "Guardrail policy updated", content: jsonContent({ $ref: "#/components/schemas/OperationsEnvelope" }) },
            "400": errorResponses["400"], "401": errorResponses["401"], "403": errorResponses["403"],
            "409": { description: "Revision or idempotency conflict", content: jsonContent({ $ref: "#/components/schemas/Error" }) },
            "500": errorResponses["500"],
          },
        },
      },
      "/observability/incidents/evaluate": {
        post: {
          operationId: "evaluateOperationsObservabilityIncidents",
          summary: "Materialize current observability guardrail signals as persistent incidents",
          tags: ["Desk Operations"],
          security: [{ BearerAuth: [] }, { DeskApiKey: [] }],
          requestBody: { required: false, content: jsonContent({ $ref: "#/components/schemas/ObservabilityIncidentEvaluateInput" }) },
          responses: {
            "200": { description: "Guardrail incidents synchronized", content: jsonContent({ $ref: "#/components/schemas/OperationsEnvelope" }) },
            "400": errorResponses["400"], "401": errorResponses["401"], "403": errorResponses["403"], "500": errorResponses["500"],
          },
        },
      },
      "/performance/overview": { get: operationsGet("getOperationsPerformance", "Get performance totals and breakdowns") },
      "/replays/compare": { get: operationsGet("compareOperationsReplays", "Compare replay executions") }, "/simulation-runs": { get: operationsGet("listSimulationRuns", "List canonical simulation registry runs") }, "/simulation-runs/compare": { get: operationsGet("compareSimulationRuns", "Compare canonical simulation run proofs") },
      "/simulation-runs/{simulationRunId}": { get: operationsGet("getSimulationRun", "Get a canonical simulation run and artifacts", [{ name: "simulationRunId", in: "path", required: true, schema: { type: "string" } }]) }, "/simulation-runs/{simulationRunId}/artifacts": { get: operationsGet("getSimulationRunArtifacts", "List artifacts for a canonical simulation run", [{ name: "simulationRunId", in: "path", required: true, schema: { type: "string" } }]) }, "/incidents": { get: operationsGet("listOperationsIncidents", "List alert, guardrail, error and data-quality incidents") },
      "/incidents/{incidentId}/actions": { post: operationsPost("executeOperationsIncidentAction", "Acknowledge, assign, snooze, resolve or reopen an incident", [{ name: "incidentId", in: "path", required: true, schema: { type: "string" } }]) },
      "/notifications": { get: operationsGet("listOperationsNotifications", "List local incident notification outbox entries") },
      "/notifications/sync": {
        post: {
          operationId: "syncOperationsNotifications",
          summary: "Reconcile local notifications from active incidents",
          tags: ["Desk Operations"],
          security: [{ BearerAuth: [] }, { DeskApiKey: [] }],
          requestBody: { required: false, content: jsonContent({ $ref: "#/components/schemas/NotificationSyncInput" }) },
          responses: {
            "200": { description: "Notifications synchronized", content: jsonContent({ $ref: "#/components/schemas/OperationsEnvelope" }) },
            "400": errorResponses["400"], "401": errorResponses["401"], "403": errorResponses["403"], "500": errorResponses["500"],
          },
        },
      },
      "/notifications/{notificationId}/actions": {
        post: {
          operationId: "executeOperationsNotificationAction",
          summary: "Mark a local notification as read or dismissed",
          tags: ["Desk Operations"],
          security: [{ BearerAuth: [] }, { DeskApiKey: [] }],
          parameters: [{ name: "notificationId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: jsonContent({ $ref: "#/components/schemas/NotificationActionInput" }) },
          responses: {
            "200": { description: "Notification command applied or replayed idempotently", content: jsonContent({ $ref: "#/components/schemas/OperationsEnvelope" }) },
            "400": errorResponses["400"], "401": errorResponses["401"], "403": errorResponses["403"],
            "409": { description: "Revision or idempotency conflict", content: jsonContent({ $ref: "#/components/schemas/Error" }) },
            "500": errorResponses["500"],
          },
        },
      },
      "/runbooks": { get: operationsGet("listOperationsRunbooks", "List generated operator runbooks from active incidents, notifications and workflows") },
      "/runbooks/{runbookId}": { get: operationsGet("getOperationsRunbook", "Get one generated operator runbook with steps and links", [{ name: "runbookId", in: "path", required: true, schema: { type: "string" } }]) },
      "/history/sessions": { get: operationsGet("getOperationsHistory", "Get consolidated session history") },
      "/history/sessions/{sessionId}": { get: operationsGet("getOperationsHistorySession", "Get one consolidated historical session", [{ name: "sessionId", in: "path", required: true, schema: { type: "string" } }]) },
      "/strategies": { get: operationsGet("listOperationsStrategies", "List strategy configuration and version state") },
      "/strategies/{strategyId}/versions/compare": { get: operationsGet("compareOperationsStrategyVersions", "Compare two strategy versions") },
      "/strategy-v2/overview": { get: operationsGet("getStrategyV2Overview", "Get Strategy Kernel operator overview") },
      "/strategy-v2/definitions": {
        get: operationsGet("listStrategyV2Definitions", "List Strategy Kernel definitions"),
        post: operationsPost("createStrategyV2Definition", "Create a Strategy Kernel definition"),
      },
      "/strategy-v2/definitions/{strategyDefinitionId}": {
        get: operationsGet("getStrategyV2Definition", "Get one Strategy Kernel definition", [{ name: "strategyDefinitionId", in: "path", required: true, schema: { type: "string", format: "uuid" } }]),
      },
      "/strategy-v2/versions": {
        get: operationsGet("listStrategyV2Versions", "List Strategy Kernel versions"),
        post: operationsPost("createStrategyV2Version", "Create a Strategy Kernel version"),
      },
      "/strategy-v2/versions/{strategyVersionId}": {
        get: operationsGet("getStrategyV2Version", "Get one Strategy Kernel version", [{ name: "strategyVersionId", in: "path", required: true, schema: { type: "string", format: "uuid" } }]),
      },
      "/strategy-v2/versions/{strategyVersionId}/actions": {
        post: operationsPost("executeStrategyV2VersionAction", "Transition or compile a Strategy Kernel version", [{ name: "strategyVersionId", in: "path", required: true, schema: { type: "string", format: "uuid" } }]),
      },
      "/strategy-v2/instances": {
        get: operationsGet("listStrategyV2Instances", "List Strategy Kernel runtime instances"),
        post: operationsPost("createStrategyV2Instance", "Create a Strategy Kernel runtime instance"),
      },
      "/strategy-v2/instances/{strategyInstanceId}": {
        get: operationsGet("getStrategyV2Instance", "Get one Strategy Kernel runtime instance", [{ name: "strategyInstanceId", in: "path", required: true, schema: { type: "string", format: "uuid" } }]),
      },
      "/strategy-v2/instances/{strategyInstanceId}/actions": {
        post: operationsPost("executeStrategyV2InstanceAction", "Transition a Strategy Kernel runtime instance", [{ name: "strategyInstanceId", in: "path", required: true, schema: { type: "string", format: "uuid" } }]),
      },
      "/strategy-v2/signals": { get: operationsGet("pollStrategyV2Signals", "List pending Strategy Signal Bus outbox items for the transitional operator front") },
      "/strategy-v2/signals/{signalOutboxId}/actions": { post: operationsPost("consumeStrategyV2Signal", "Mark one Strategy Signal Bus outbox item as consumed", [{ name: "signalOutboxId", in: "path", required: true, schema: { type: "string", format: "uuid" } }]) }, "/strategy-v2/audit": { get: operationsGet("listStrategyV2AuditEvents", "List Strategy Kernel audit events") },
      "/portfolio-risk/overview": { get: operationsGet("getPortfolioRiskOverview", "Read Portfolio Risk cockpit projection from execution, strategy and performance sources") }, "/ai-context/overview": { get: operationsGet("getAiContextOverview", "Read AI Context gate decisions, fallbacks and source controls from agent-runtime sources") }, ...researchOpenApiPaths({ errorResponses, jsonContent }),
      "/data-foundation/overview": { get: dataFoundationGet("getDataFoundationOverview", "Read Data Foundation catalog, counts and recent controlled resources") },
      "/data-foundation/sources": {
        get: dataFoundationGet("listDataFoundationSources", "List governed upstream data sources", [
          { name: "status", in: "query", schema: { type: "string", enum: ["ACTIVE", "DEPRECATED"] } },
          { name: "kind", in: "query", schema: { type: "string", enum: ["MARKET_OHLCV", "MARKET_TICK", "MACRO_CALENDAR", "NEWS", "BROKER_EXECUTION", "ALTERNATIVE", "MANUAL"] } },
          { name: "provider", in: "query", schema: { type: "string" } },
          { name: "environment", in: "query", schema: { type: "string" } },
        ]),
      },
      "/data-foundation/ingestion-batches": {
        get: dataFoundationGet("listDataFoundationIngestionBatches", "List ingestion batches with their governed source", [
          { name: "status", in: "query", schema: { type: "string", enum: ["RUNNING", "COMPLETED", "FAILED"] } },
          { name: "data_source_id", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "source_key", in: "query", schema: { type: "string" } },
        ]),
      },
      "/data-foundation/datasets": {
        get: dataFoundationGet("listDataFoundationDatasets", "List sealed datasets and source lineage", [
          { name: "status", in: "query", schema: { type: "string", enum: ["BUILDING", "READY", "ARCHIVED"] } },
          { name: "dataset_id", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "dataset_key", in: "query", schema: { type: "string" } },
        ]),
      },
      "/data-foundation/features": {
        get: dataFoundationGet("listDataFoundationFeatures", "List feature definitions and versions", [
          { name: "status", in: "query", schema: { type: "string", enum: ["ACTIVE", "DEPRECATED"] } },
          { name: "category", in: "query", schema: { type: "string" } },
        ]),
      },
      "/data-foundation/feature-computations": {
        get: dataFoundationGet("listDataFoundationFeatureComputations", "List reproducible feature computation runs", [
          { name: "status", in: "query", schema: { type: "string", enum: ["RUNNING", "COMPLETED", "FAILED"] } },
          { name: "dataset_key", in: "query", schema: { type: "string" } },
          { name: "feature_key", in: "query", schema: { type: "string" } },
        ]),
      },
      "/data-foundation/market-data-profiles": {
        get: dataFoundationGet("listDataFoundationMarketDataProfiles", "List measured market data capabilities, missing microstructure and storage recommendations", [
          { name: "source_key", in: "query", schema: { type: "string" } },
          { name: "instrument_code", in: "query", schema: { type: "string" } },
          { name: "timeframe", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["MEASURED", "PARTIAL", "MISSING", "UNAVAILABLE"] } },
          { name: "blocking_classification", in: "query", schema: { type: "string", enum: ["BLOCKING", "NON_BLOCKING", "UNKNOWN"] } },
        ]),
      },
      "/data-foundation/storage-objects": {
        get: dataFoundationGet("listDataFoundationStorageObjects", "List governed cold/raw market data storage objects and their dataset lineage", [
          { name: "source_key", in: "query", schema: { type: "string" } },
          { name: "instrument_code", in: "query", schema: { type: "string" } },
          { name: "timeframe", in: "query", schema: { type: "string" } },
          { name: "storage_tier", in: "query", schema: { type: "string", enum: ["HOT_SERIES", "COLD_PARQUET", "RAW_ARCHIVE", "HOT_AND_COLD", "IGNORE"] } },
          { name: "storage_format", in: "query", schema: { type: "string", enum: ["POSTGRES_SERIES", "PARQUET", "JSONL", "CSV"] } },
          { name: "status", in: "query", schema: { type: "string", enum: ["PLANNED", "ACTIVE", "ARCHIVED", "MISSING", "FAILED"] } },
        ]),
      },
      "/data-foundation/hot-series-windows": {
        get: dataFoundationGet("listDataFoundationHotSeriesWindows", "List hot PostgreSQL market series windows backed by raw/cold lineage", [
          { name: "source_key", in: "query", schema: { type: "string" } },
          { name: "instrument_code", in: "query", schema: { type: "string" } },
          { name: "timeframe", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["PLANNED", "ACTIVE", "ARCHIVED", "MISSING", "FAILED"] } },
        ]),
      },
      "/data-foundation/feature-values": {
        get: dataFoundationGet("listDataFoundationFeatureValues", "Read point-in-time feature values with dataset and feature version provenance", [
          { name: "dataset_key", in: "query", schema: { type: "string" } },
          { name: "feature_key", in: "query", schema: { type: "string" } },
          { name: "entity_key", in: "query", schema: { type: "string" } },
          { name: "instrument_code", in: "query", schema: { type: "string" } },
          { name: "timeframe", in: "query", schema: { type: "string" } },
          { name: "from_utc", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "to_utc", in: "query", schema: { type: "string", format: "date-time" } },
        ]),
      },
      "/execution/overview": { get: operationsGet("getExecutionOverview", "Read broker safety, decisions, approvals, orders and reconciliation state") },
      "/execution/intents/{intentId}": { get: operationsGet("getExecutionIntent", "Read one execution intent and its audit chain", [{ name: "intentId", in: "path", required: true, schema: { type: "string" } }]) },
      "/execution/actions": { post: executionPost("executeBrokerAction", "Materialize, risk-check, approve, reject or kill-switch a Sim101 intent") },
      "/execution/bridge/heartbeat": { post: executionPost("recordBrokerHeartbeat", "Publish the local NinjaTrader bridge health", "BridgeHeartbeatInput") },
      "/execution/bridge/claim": { post: executionPost("claimBrokerExecution", "Lease one approved outbox item", "BridgeClaimInput") },
      "/execution/bridge/complete": { post: executionPost("completeBrokerExecution", "Complete one leased outbox item", "BridgeCompleteInput") },
      "/execution/bridge/events": { post: executionPost("recordBrokerOrderEvent", "Persist a NinjaTrader order update", "BridgeEventInput") },
      "/execution/bridge/reconcile": { post: executionPost("reconcileBrokerExecution", "Reconcile NinjaTrader and PostgreSQL snapshots", "BridgeReconcileInput") },
      "/execution/addon/heartbeat": { post: executionPost("recordNinjaAddonHeartbeat", "Publish a signed NinjaTrader AddOn heartbeat", "AddonHeartbeatInput") },
      "/execution/addon/claim": { post: executionPost("claimNinjaAddonExecution", "Lease one approved command to the signed AddOn", "AddonClaimInput") },
      "/execution/addon/complete": { post: executionPost("completeNinjaAddonExecution", "Complete one AddOn command lease", "BridgeCompleteInput") },
      "/execution/addon/events": { post: executionPost("recordNinjaAddonEvents", "Persist a signed AddOn event batch", "AddonEventsInput") },
      "/execution/addon/snapshot": { post: executionPost("recordNinjaAddonSnapshot", "Persist a signed AddOn account snapshot and ATI parity", "AddonSnapshotInput") },
      "/events": { get: { operationId: "streamOperationsEvents", summary: "Stream operations snapshot changes with Last-Event-ID/cursor resume", tags: ["Desk Operations"], responses: { "200": { description: "Server-sent events stream with typed front_events_v1 envelopes", content: { "text/event-stream": { schema: { type: "string" } } } }, ...errorResponses } } },
    },
    components: {
      securitySchemes: {
        BearerAuth: { type: "http", scheme: "bearer" },
        DeskApiKey: { type: "apiKey", in: "header", name: "X-Desk-Api-Key" },
      },
      headers: {
        ETag: { description: "Weak validator for conditional GET", schema: { type: "string" } },
        CacheControl: { description: "Private browser-cache policy", schema: { type: "string" } },
      },
      parameters: {
        Session: { name: "session", in: "query", required: false, schema: { type: "string", enum: ["asia_open", "ny_open"], default: "asia_open" } },
        TradingDate: { name: "trading_date", in: "query", required: false, schema: { type: "string", format: "date" } },
        StrategyId: { name: "strategy_id", in: "query", required: false, schema: { type: "string" } },
        Mode: { name: "mode", in: "query", required: false, schema: { type: "string", enum: ["live", "paper"], default: "live" } },
        StrategyIdPath: { name: "strategyId", in: "path", required: true, schema: { type: "string", pattern: "^[A-Za-z0-9_.:-]{1,200}$" } },
        DatePath: { name: "date", in: "path", required: true, schema: { type: "string", format: "date" } },
        MasterId: { name: "masterId", in: "path", required: true, schema: { $ref: "#/components/schemas/EntityId" } },
        MonitorId: { name: "monitorId", in: "path", required: true, schema: { $ref: "#/components/schemas/EntityId" } },
        ThesisId: { name: "thesisId", in: "path", required: true, schema: { $ref: "#/components/schemas/EntityId" } },
        SetupId: { name: "setupId", in: "path", required: true, schema: { $ref: "#/components/schemas/EntityId" } },
        WorkflowId: { name: "workflowId", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 300 } },
        RunId: { name: "runId", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 300 } },
        SessionExecutionId: { name: "sessionExecutionId", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 300 } },
        ProcessId: { name: "processId", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 300 } },
      },
      schemas: frontOpenApiSchemas(),
    },
  };
}

function frontOpenApiSchemas() {
  const stringArray = { type: "array", items: { type: "string" } };
  const levelArray = { type: "array", items: { $ref: "#/components/schemas/Level" } };
  const headlineArray = { type: "array", items: { $ref: "#/components/schemas/Headline" } };
  const operatorCommandEnum = ["cancel_setup", "confirm_trigger", "move_break_even", "take_partial", "exit_position", "request_replan"];
  return {
    OpenApiDocument: { type: "object", required: ["openapi", "info", "paths"], additionalProperties: true },
    Error: { type: "object", required: ["ok", "error"], properties: { ok: { const: false }, error: { type: "string" }, code: { type: "string" } }, additionalProperties: false },
    OperationsEnvelope: { type: "object", required: ["contract", "schemaVersion"], properties: { contract: { type: "string" }, schemaVersion: { const: "1.0.0" } }, additionalProperties: true },
    DataFoundationEnvelope: {
      type: "object",
      additionalProperties: true,
      required: ["contract", "schemaVersion", "generated_at_utc", "audience", "source"],
      properties: {
        contract: { type: "string", pattern: "^Desk(Data|Feature|Ingestion|Market)" },
        schemaVersion: { const: "data_foundation_rest_v1" },
        generated_at_utc: { type: "string", format: "date-time" },
        audience: { type: "string", enum: ["front", "simulation", "agent", "operator"] },
        count: { type: "integer", minimum: 0 },
        source: {
          type: "object",
          additionalProperties: true,
          required: ["canonical", "storage", "direct_table_access"],
          properties: {
            canonical: { const: "data_foundation_v1" },
            storage: { const: "postgres" },
            direct_table_access: { const: false },
          },
        },
      },
    },
    OperationsCommandInput: {
      type: "object", additionalProperties: false,
      required: ["action", "expectedRevision", "idempotencyKey", "confirmationPhrase", "reason"],
      properties: {
        action: { type: "string", enum: ["retry", "resume", "pause", "cancel", "acknowledge", "assign", "snooze", "resolve", "reopen"] },
        expectedRevision: { type: "integer", minimum: 0 },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
        confirmationPhrase: { type: "string", pattern: "^CONFIRM_[A-Z_]+$" },
        reason: { type: "string", minLength: 3, maxLength: 500 },
        snoozedUntilUtc: { type: "string", format: "date-time" },
        owner: { type: "string", maxLength: 200 },
      },
    },
    ReplayCreateInput: {
      type: "object", additionalProperties: false,
      required: ["backtest_id", "strategy_id", "trading_date", "session", "pack_id", "pack_build_id", "start_time", "end_time", "idempotency_key"],
      properties: {
        backtest_id: { type: "string", minLength: 3 }, strategy_id: { type: "string", minLength: 2 },
        trading_date: { type: "string", format: "date" }, date: { type: "string", format: "date" },
        session: { type: "string", enum: ["asia_open", "ny_open"] }, pack_id: { type: "string" }, pack_build_id: { type: "string" },
        start_time: { type: "string" }, end_time: { type: "string" }, cutoff_paris: { type: "string" },
        cadence: { type: "string", enum: ["5m", "15m", "30m", "60m"] }, automation_enabled: { type: "boolean" },
        idempotency_key: { type: "string", minLength: 8, maxLength: 200 },
      },
    },
    ObservabilityPolicyActionInput: {
      type: "object", additionalProperties: false,
      required: ["action", "expectedRevision", "idempotencyKey", "confirmationPhrase", "reason", "policy"],
      properties: {
        action: { const: "update" },
        expectedRevision: { type: "integer", minimum: 0 },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
        confirmationPhrase: { const: "CONFIRM_UPDATE" },
        reason: { type: "string", minLength: 3, maxLength: 500 },
        policy: {
          type: "object", additionalProperties: false, minProperties: 1,
          properties: {
            enabled: { type: "boolean" },
            queueWarningMs: { type: "integer", minimum: 60_000, maximum: 86_400_000 },
            executionWarningMs: { type: "integer", minimum: 60_000, maximum: 86_400_000 },
            leaseExpiringMs: { type: "integer", minimum: 30_000, maximum: 1_800_000 },
            telemetryCoverageWarningPct: { type: "integer", minimum: 0, maximum: 100 },
            costCoverageMinimumPct: { type: "integer", minimum: 0, maximum: 100 },
            failureRateWarningPct: { type: "integer", minimum: 0, maximum: 100 },
            dailyCostBudgetUsd: { type: ["number", "null"], minimum: 0, maximum: 1_000_000 },
            monthlyCostBudgetUsd: { type: ["number", "null"], minimum: 0, maximum: 1_000_000 },
          },
        },
      },
    },
    ObservabilityIncidentEvaluateInput: {
      type: "object",
      additionalProperties: false,
      properties: {
        autoResolve: { type: "boolean", default: true },
        syncNotifications: { type: "boolean", default: true },
        reason: { type: "string", minLength: 3, maxLength: 500 },
      },
    },
    NotificationSyncInput: {
      type: "object",
      additionalProperties: false,
      properties: {
        autoClear: { type: "boolean", default: true },
        limit: { type: "integer", minimum: 1, maximum: 1000 },
        reason: { type: "string", minLength: 3, maxLength: 500 },
      },
    },
    NotificationActionInput: {
      type: "object",
      additionalProperties: false,
      required: ["action", "expectedRevision", "idempotencyKey", "confirmationPhrase", "reason"],
      properties: {
        action: { type: "string", enum: ["mark_read", "dismiss"] },
        expectedRevision: { type: "integer", minimum: 0 },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
        confirmationPhrase: { type: "string", enum: ["CONFIRM_MARK_READ", "CONFIRM_DISMISS"] },
        reason: { type: "string", minLength: 3, maxLength: 500 },
      },
    },
    ExecutionActionInput: {
      type: "object", additionalProperties: true, required: ["action"],
      properties: { action: { type: "string", enum: ["materialize", "materialize_management", "evaluate", "configure_sizing", "configure_execution_mode", "configure_ninjatrader_startup", "approve", "reject", "approve_management", "reject_management", "kill_switch"] } },
    },
    BridgeHeartbeatInput: {
      type: "object", additionalProperties: false,
      required: ["bridgeId", "mode", "ninjaConnected", "atiEnabled", "accountName"],
      properties: { bridgeId: { type: "string" }, mode: { type: "string" }, ninjaConnected: { type: "boolean" }, atiEnabled: { type: "boolean" }, accountName: { type: "string", pattern: "^Sim[0-9]*$" } },
    },
    BridgeClaimInput: { type: "object", additionalProperties: false, required: ["bridgeId", "accountName"], properties: { bridgeId: { type: "string" }, accountName: { type: "string", pattern: "^Sim[0-9]*$" }, leaseSeconds: { type: "integer", minimum: 5, maximum: 120 } } },
    BridgeCompleteInput: { type: "object", additionalProperties: true, required: ["bridgeId", "outboxId", "leaseToken", "status"], properties: { bridgeId: { type: "string" }, outboxId: { type: "string" }, leaseToken: { type: "string", format: "uuid" }, workType: { type: "string", enum: ["entry", "management"], default: "entry" }, status: { type: "string", enum: ["rendered", "delivered", "acknowledged", "failed"] } } },
    BridgeEventInput: { type: "object", additionalProperties: false, required: ["update"], properties: { intentId: { type: "string" }, managementIntentId: { type: "string" }, managementOrderRef: { type: "boolean" }, brokerOrderId: { type: "string" }, externalEventKey: { type: "string" }, update: { type: "object", additionalProperties: true } } },
    BridgeReconcileInput: {
      type: "object", additionalProperties: false, required: ["brokerSnapshot"],
      properties: {
        bridgeId: { type: "string" },
        brokerAccountId: { type: "string" },
        reconciliationMode: { type: "string", enum: ["disabled", "alert_only", "blocking"], default: "alert_only" },
        triggeredBy: { type: "string", enum: ["manual", "scheduled", "operator", "bridge", "addon"], default: "bridge" },
        operatorConfirmation: { type: "string" },
        brokerSnapshot: { type: "object", additionalProperties: true },
      },
    },
    AddonHeartbeatInput: { type: "object", additionalProperties: false, required: ["bridgeId", "ninjaConnected", "commandEnabled", "accountName"], properties: { bridgeId: { type: "string" }, brokerAccountId: { type: "string" }, mode: { const: "sim101_addon_approved_only" }, ninjaConnected: { type: "boolean" }, commandEnabled: { type: "boolean" }, accountName: { type: "string", pattern: "^Sim[0-9]*$" }, protocolVersion: { const: "desk_ninja_addon_v1" }, capabilities: { type: "object", additionalProperties: true } } },
    AddonClaimInput: { type: "object", additionalProperties: false, required: ["bridgeId", "accountName"], properties: { bridgeId: { type: "string" }, brokerAccountId: { type: "string" }, accountName: { type: "string", pattern: "^Sim[0-9]*$" }, leaseSeconds: { type: "integer", minimum: 5, maximum: 120 } } },
    AddonEventsInput: { type: "object", additionalProperties: false, required: ["bridgeId", "events"], properties: { bridgeId: { type: "string" }, brokerAccountId: { type: "string" }, events: { type: "array", minItems: 1, maxItems: 200, items: { type: "object", additionalProperties: true } } } },
    AddonSnapshotInput: {
      type: "object", additionalProperties: false, required: ["bridgeId", "snapshot"],
      properties: {
        bridgeId: { type: "string" },
        brokerAccountId: { type: "string" },
        reconcile: { type: "boolean", default: false },
        lockOnDivergence: { type: "boolean", default: false },
        reconciliationMode: { type: "string", enum: ["disabled", "alert_only", "blocking"] },
        triggeredBy: { type: "string", enum: ["manual", "scheduled", "operator", "bridge", "addon"], default: "addon" },
        operatorConfirmation: { type: "string" },
        snapshot: { type: "object", additionalProperties: true },
      },
    },
    EntityId: { type: "string", minLength: 1, maxLength: 200, pattern: "^[A-Za-z0-9_.:-]+$" },
    ResourceScope: {
      type: "object", additionalProperties: false, required: ["strategyId", "session", "tradingDate", "mode"],
      properties: { strategyId: { type: "string" }, session: { type: "string", enum: ["asia_open", "ny_open"] }, tradingDate: { type: "string", format: "date" }, mode: { type: "string", enum: ["live", "paper"] } },
    },
    DeskSession: { type: "object", required: ["id", "strategyId", "date", "status", "master", "thesis", "setup", "position", "timeline"], additionalProperties: true },
    SessionSummary: { type: "object", required: ["id", "label", "status", "decision", "health"], additionalProperties: true },
    SessionSummaryList: { type: "array", items: { $ref: "#/components/schemas/SessionSummary" } },
    Master: {
      type: "object", additionalProperties: false, required: ["id", "decision", "instrument", "direction", "confidence", "summary", "sections"],
      properties: { id: { type: "string" }, createdAt: { type: "string" }, decision: { type: "string" }, instrument: { type: "string" }, direction: { type: "string" }, confidence: { type: "number" }, summary: { type: "string" }, regime: { type: "string" }, macroThesis: { type: "string" }, assetSelection: { type: "string" }, expectedPath: stringArray, failurePath: stringArray, monitoringPlaybook: stringArray, sections: { type: "array", items: { type: "object", required: ["title", "content"], properties: { title: { type: "string" }, content: { type: "string" } } } } },
    },
    Condition: { type: "object", required: ["label", "status", "proof", "impact", "deterministic"], properties: { label: { type: "string" }, status: { type: "string" }, proof: { type: "string" }, impact: { type: "string" }, deterministic: { type: "boolean" } }, additionalProperties: false },
    Monitor: { type: "object", required: ["id", "time", "sequence", "decision", "summary", "goConditions", "invalidationConditions"], additionalProperties: true },
    Thesis: { type: "object", required: ["id", "instrument", "direction", "status", "confidence", "health"], additionalProperties: true },
    Setup: { type: "object", required: ["id", "instrument", "direction", "status", "entryFrom", "entryTo", "stop"], additionalProperties: true },
    Position: { type: "object", required: ["active", "status", "instrument", "direction", "entry", "current"], additionalProperties: true },
    Level: { type: "object", required: ["price", "role", "state"], properties: { price: { type: "string" }, role: { type: "string" }, state: { type: "string" } }, additionalProperties: false },
    TimelineEvent: { type: "object", required: ["time", "type", "title", "status", "detail", "severity", "summary", "sourceType"], additionalProperties: false, properties: { time: { type: "string" }, type: { type: "string" }, title: { type: "string" }, status: { type: "string" }, detail: { type: "string" }, severity: { type: "string" }, summary: { type: "string" }, sourceType: { type: "string" } } },
    MarketItem: {
      type: "object", additionalProperties: false,
      required: ["symbol", "price", "change", "trend", "note", "ohlc", "marketDate", "asOf", "source", "rsi", "atr", "seriesTimeframe", "series"],
      properties: {
        symbol: { type: "string" }, price: { type: "string" }, change: { type: "string" }, trend: { type: "string", enum: ["up", "down", "flat"] }, note: { type: "string" },
        ohlc: { type: "object", additionalProperties: false, required: ["open", "high", "low", "close"], properties: { open: { type: "string" }, high: { type: "string" }, low: { type: "string" }, close: { type: "string" } } },
        marketDate: { type: "string" }, asOf: { type: "string" }, source: { type: "string" }, rsi: { type: "string" }, atr: { type: "string" }, seriesTimeframe: { type: "string" },
        series: { type: "array", items: { type: "object", additionalProperties: false, required: ["time", "open", "high", "low", "close"], properties: { time: { type: "string" }, open: { type: ["number", "null"] }, high: { type: ["number", "null"] }, low: { type: ["number", "null"] }, close: { type: "number" } } } },
      },
    },
    MacroEvent: {
      type: "object", additionalProperties: false,
      required: ["time", "title", "importance", "impactText", "scheduledAt", "date", "currency", "previous", "forecast", "actual", "isNext"],
      properties: { time: { type: "string" }, title: { type: "string" }, importance: { type: "string" }, impactText: { type: "string" }, scheduledAt: { type: "string" }, date: { type: "string" }, currency: { type: "string" }, previous: { type: "string" }, forecast: { type: "string" }, actual: { type: "string" }, isNext: { type: "boolean" } },
    },
    Headline: {
      type: "object", additionalProperties: false,
      required: ["time", "title", "source", "impact", "scheduledAt", "date", "currency", "importance", "previous", "forecast", "actual", "isNext", "url", "provider", "publishedAt", "assets", "topics"],
      properties: { time: { type: "string" }, title: { type: "string" }, source: { type: "string" }, impact: { type: "string" }, scheduledAt: { type: "string" }, date: { type: "string" }, currency: { type: "string" }, importance: { type: "string" }, previous: { type: "string" }, forecast: { type: "string" }, actual: { type: "string" }, isNext: { type: "boolean" }, url: { type: "string" }, provider: { type: "string" }, publishedAt: { type: "string" }, assets: stringArray, topics: stringArray },
    },
    SessionOverviewResource: resourceSchema("DeskFrontSessionOverviewResource", { overview: { type: "object", additionalProperties: true } }),
    TimelineResource: resourceSchema("DeskFrontTimelineResource", { timeline: { type: "array", items: { $ref: "#/components/schemas/TimelineEvent" } } }),
    MasterResource: entityResourceSchema("DeskFrontMasterResource", "master", "#/components/schemas/Master"),
    MonitorResource: entityResourceSchema("DeskFrontMonitorResource", "monitor", "#/components/schemas/Monitor"),
    ThesisResource: resourceSchema("DeskFrontThesisResource", { thesis: { $ref: "#/components/schemas/Thesis" }, levels: levelArray }),
    ConditionsResource: resourceSchema("DeskFrontThesisConditionsResource", { thesisId: { type: "string" }, monitorId: { type: ["string", "null"] }, go: { type: "array", items: { $ref: "#/components/schemas/Condition" } }, invalidations: { type: "array", items: { $ref: "#/components/schemas/Condition" } } }),
    SetupResource: resourceSchema("DeskFrontSetupResource", { setup: { $ref: "#/components/schemas/Setup" }, position: { $ref: "#/components/schemas/Position" }, levels: levelArray }),
    PositionResource: entityResourceSchema("DeskFrontPositionResource", "position", "#/components/schemas/Position"),
    MarketResource: resourceSchema("DeskFrontMarketResource", { lastDataAt: { type: "string" }, market: { type: "array", items: { $ref: "#/components/schemas/MarketItem" } }, marketBrief: { type: "object", additionalProperties: true }, crossAssetBrief: { type: "object", additionalProperties: true }, levels: levelArray }),
    MacroResource: resourceSchema("DeskFrontMacroResource", { nextMacro: { type: "string" }, nearEvent: { type: "boolean" }, macro: { type: "array", items: { $ref: "#/components/schemas/MacroEvent" } } }),
    NewsHeadlinesResource: resourceSchema("DeskFrontNewsHeadlinesResource", { headlines: headlineArray }),
    NewsDigestResource: resourceSchema("DeskFrontNewsDigestResource", { news: { type: "object", required: ["digestUpdatedAt", "digest", "headlines", "status", "provider", "freshness"], properties: { digestUpdatedAt: { type: "string" }, digest: { type: "string" }, headlines: headlineArray, status: { type: "string" }, provider: { type: "string" }, freshness: { type: "object", required: ["status", "ageMinutes"], properties: { status: { type: "string" }, ageMinutes: { type: ["number", "null"] } }, additionalProperties: false } } } }),
    ActivityResource: resourceSchema("DeskFrontActivityResource", { automation: { type: "object", additionalProperties: true }, activity: { type: "array", items: { type: "object", additionalProperties: true } } }),
    AlertsResource: resourceSchema("DeskFrontAlertsResource", { alerts: { type: "array", items: { type: "object", additionalProperties: true } } }),
    AuditResource: resourceSchema("DeskFrontAuditResource", { dataQuality: { type: "object", additionalProperties: true }, audit: { type: "object", additionalProperties: true } }),
    PerformanceCalendarResource: resourceSchema("DeskFrontPerformanceCalendarResource", { calendar: { type: "object", additionalProperties: true } }),
    PerformanceDayResource: resourceSchema("DeskFrontPerformanceDayResource", { day: { type: "object", additionalProperties: true } }),
    OperatorCapability: {
      type: "object", additionalProperties: false,
      required: ["command", "enabled", "reason", "targetId", "confirmationPhrase", "dangerLevel"],
      properties: {
        command: { type: "string", enum: operatorCommandEnum },
        enabled: { type: "boolean" },
        reason: { type: ["string", "null"] },
        targetId: { type: ["string", "null"] },
        confirmationPhrase: { type: "string" },
        dangerLevel: { type: "string", enum: ["medium", "high", "critical"] },
      },
    },
    OperatorState: {
      type: "object", additionalProperties: false,
      required: ["contract", "schemaVersion", "scope", "revision", "setup", "position", "thesis", "allowedCommands", "brokerExecution"],
      properties: {
        contract: { const: "DeskFrontOperatorState" },
        schemaVersion: { const: "1.0.0" },
        scope: { $ref: "#/components/schemas/ResourceScope" },
        revision: { type: "integer", minimum: 0 },
        setup: { type: ["object", "null"], additionalProperties: true },
        position: { type: ["object", "null"], additionalProperties: true },
        thesis: { type: ["object", "null"], additionalProperties: true },
        allowedCommands: { type: "array", items: { $ref: "#/components/schemas/OperatorCapability" } },
        brokerExecution: { const: false },
      },
    },
    OperatorCommandInput: {
      type: "object", additionalProperties: false,
      required: ["command", "session", "strategyId", "tradingDate", "mode", "expectedRevision", "idempotencyKey", "confirmationPhrase", "reason"],
      properties: {
        command: { type: "string", enum: operatorCommandEnum },
        session: { type: "string", enum: ["asia_open", "ny_open"] },
        strategyId: { type: "string" },
        tradingDate: { type: "string", format: "date" },
        mode: { type: "string", enum: ["live", "paper"] },
        expectedRevision: { type: "integer", minimum: 0 },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
        confirmationPhrase: { type: "string" },
        targetId: { $ref: "#/components/schemas/EntityId" },
        reason: { type: "string", minLength: 3, maxLength: 500 },
        partialFraction: { type: "number", exclusiveMinimum: 0, maximum: 1 },
      },
    },
    OperatorCommandResult: {
      type: "object", additionalProperties: false,
      required: ["contract", "schemaVersion", "ok", "idempotent", "command", "operatorState", "session"],
      properties: {
        contract: { const: "DeskFrontOperatorCommandResult" },
        schemaVersion: { const: "1.0.0" },
        ok: { const: true },
        idempotent: { type: "boolean" },
        command: { type: "object", additionalProperties: true },
        operatorState: { $ref: "#/components/schemas/OperatorState" },
        session: { $ref: "#/components/schemas/DeskSession" },
      },
    },
  };
}
