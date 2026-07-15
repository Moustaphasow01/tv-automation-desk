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
      version: "1.1.0",
      description: "Presentation API for the React Desk Futures front. Reads prioritize canonical backend state; authenticated operator writes are confirmed, revisioned, idempotent and audited.",
    },
    servers: [{ url: "/api/v1" }],
    tags: [
      { name: "Desk Front", description: "Scoped read models for the new React front" },
      { name: "Desk Operator", description: "Authenticated, audited Desk-state commands; never broker order execution" },
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
      required: ["time", "title", "source", "impact", "scheduledAt", "date", "currency", "importance", "previous", "forecast", "actual", "isNext"],
      properties: { time: { type: "string" }, title: { type: "string" }, source: { type: "string" }, impact: { type: "string" }, scheduledAt: { type: "string" }, date: { type: "string" }, currency: { type: "string" }, importance: { type: "string" }, previous: { type: "string" }, forecast: { type: "string" }, actual: { type: "string" }, isNext: { type: "boolean" } },
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
    NewsDigestResource: resourceSchema("DeskFrontNewsDigestResource", { news: { type: "object", required: ["digestUpdatedAt", "digest", "headlines"], properties: { digestUpdatedAt: { type: "string" }, digest: { type: "string" }, headlines: headlineArray } } }),
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
