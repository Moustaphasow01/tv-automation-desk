import { z } from "zod";
import { getToolInputSchema } from "@tv-automation/desk-contracts";
import { createDeskExecutionScope } from "@tv-automation/desk-domain";
import { toParisIso } from "@tv-automation/desk-time";
import {
  DATASETS,
  DESK_INSTRUMENTS,
  TRADE_INSTRUMENTS,
  archiveExpiredThesesSchema,
  activeThesisSchema,
  activeThesisUpdateSchema,
  analysisSchema,
  auditStateRequestSchema,
  cancelBacktestRunSchema,
  cancelDeskJobSchema,
  claimNextDeskWorkSchema,
  claimNextLiveWorkSchema,
  claimNextLiveSchema,
  claimNextReplayWorkSchema,
  claimNextReplaySchema,
  completeDeskWorkSchema,
  completeLiveSchema,
  completeReplaySchema,
  contextTransmissionSchema,
  contractActivationSchema,
  contractListSchema,
  contractLookupSchema,
  contractSchema,
  advanceReplayClockSchema,
  applyReplayMonitorResultSchema,
  createBacktestRunSchema,
  createDeskJobSchema,
  createOrchestratedReplayDaySchema,
  decisionSchema,
  decisionStatusSchema,
  deskWorkItemReadSchema,
  driveReplayAutomationSchema,
  failDeskWorkSchema,
  failLiveSchema,
  failReplaySchema,
  frontMasterStateRequestSchema,
  frontMonitorStateRequestSchema,
  getBacktestRunSchema,
  getDeskJobSchema,
  getMasterCutoffBundleSchema,
  getReplayBundleSchema,
  getReplayBundleManifestSchema,
  getReplayBundleSectionSchema,
  getReplaySnapshotSchema,
  getReplayTimelineSchema,
  hourlyMonitorSchema,
  heartbeatDeskWorkSchema,
  heartbeatLiveSchema,
  heartbeatReplaySchema,
  listBacktestRunsSchema,
  listDeskJobsSchema,
  liveTimelineEventDetailRequestSchema,
  liveDeskStateRequestSchema,
  manualMonitorBundleRequestSchema,
  manualMonitorSchema,
  markNyOpenStrategyEventSchema,
  masterAnalysisSchema,
  masterCutoffBundleRequestSchema,
  monitorAlertSchema,
  nyOpenStrategyStateRequestSchema,
  positionManagementSchema,
  peekNextDeskWorkSchema,
  prepareNyOpenMasterBundleSchema,
  prepareDueLiveMasterBundleSchema,
  prepareDueLiveMonitorBundleSchema,
  prepareM15MonitorBundleJobSchema,
  prepareMasterCutoffBundleJobSchema,
  prepareReplayMasterBundleSchema,
  prepareReplayMonitorBundleSchema,
  recomputeStrategyPerformanceSchema,
  replayMonitorBundlesSchema,
  replayStateRequestSchema,
  reportSchema,
  runBacktestUntilDoneSchema,
  runFeatureEngineSchema,
  runNextBacktestStepSchema,
  saveReplayMasterAnalysisSchema,
  saveReplayMonitorSchema,
  setReplayAutomationSchema,
  setReplayAutopilotWindowSchema,
  simulateReplayIntervalSchema,
  startOrResumeReplayAutopilotSchema,
  strategyCalendarRequestSchema,
  strategyDayDetailRequestSchema,
  strategyPerformanceRequestSchema,
  updateDeskJobStatusSchema,
  upsertReplayAutopilotConfigSchema,
} from "./schemas.js";
import { prepareDueLiveMasterBundle, prepareDueLiveMonitorBundle } from "./live-orchestration.js";
import { assertAnalysisGatesPass } from "./domain_gates.js";
import { assertAnalysisRiskPass } from "./domain_risk.js";
import { assertAnalysisSetupPass } from "./domain_setup.js";
import { assertActiveThesisSavePass, assertActiveThesisUpdatePass } from "./domain_thesis_state.js";
import { publicError, resultTransportMetrics, toolResult } from "./result.js";
import { projectActiveContracts } from "./replay-bundle-view.js";
import {
  LIVE_BUNDLE_SECTIONS,
  liveBundleReceiptText,
  liveClaimReceiptText,
} from "./live-bundle-view.js";
import { createAgentRuntimeAdminToolDefinitions } from "./agent-runtime-admin-tools.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const executionModeSchema = z.enum(["live", "paper", "replay", "backtest"]);
const activeContractsReadSchema = z.object({
  view: z.enum(["summary", "full"]).default("full"),
}).strict();
const activeContractsReadInputSchema = {
  type: "object",
  properties: {
    view: { type: "string", enum: ["summary", "full"], default: "full" },
  },
  additionalProperties: false,
};
const getDeskPackV2Schema = z.object({
  pack_id: z.string().min(3),
  pack_build_id: z.string().min(3).optional(),
  mode: executionModeSchema.default("live"),
  include_draft: z.boolean().default(false),
}).superRefine((value, ctx) => {
  if (["replay", "backtest"].includes(value.mode) && !value.pack_build_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pack_build_id"], message: "SCOPE_REQUIRED:pack_build_id" });
  }
});
const getDatasetV2Schema = z.object({
  pack_id: z.string().min(3),
  pack_build_id: z.string().min(3),
  dataset: z.enum(DATASETS),
  as_of_utc: z.string().datetime({ offset: true }),
  mode: executionModeSchema.default("replay"),
  format: z.enum(["json", "csv"]).default("json"),
  max_rows: z.number().int().min(1).max(5000).default(1000),
  row_order: z.enum(["oldest_first", "latest_first"]).default("oldest_first"),
});
const operationalScopeFields = {
  strategy_id: z.enum(["ny_open_1530", "asia_open"]),
  session: z.enum(["asia_open", "ny_open"]),
  mode: executionModeSchema,
  trading_date: dateSchema,
  run_id: z.string().min(3),
  backtest_id: z.string().min(3).optional(),
  as_of_utc: z.string().datetime({ offset: true }),
};
const operationalScopeJson = {
  strategy_id: { type: "string", enum: ["ny_open_1530", "asia_open"] },
  session: { type: "string", enum: ["asia_open", "ny_open"] },
  mode: { type: "string", enum: ["live", "paper", "replay", "backtest"] },
  trading_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
  run_id: { type: "string", minLength: 3 },
  backtest_id: { type: "string", minLength: 3 },
  as_of_utc: { type: "string", format: "date-time" },
};
const operationalScopeRequired = ["strategy_id", "session", "mode", "trading_date", "run_id", "as_of_utc"];
const liveOperationalScopeJson = {
  strategy_id: operationalScopeJson.strategy_id,
  session: operationalScopeJson.session,
  mode: { type: "string", enum: ["live", "paper"] },
  trading_date: operationalScopeJson.trading_date,
  run_id: operationalScopeJson.run_id,
  as_of_utc: operationalScopeJson.as_of_utc,
  timezone: { type: "string", const: "Europe/Paris", default: "Europe/Paris" },
};
const liveWriterScopeFields = {
  strategy_id: z.enum(["ny_open_1530", "asia_open"]),
  session: z.enum(["asia_open", "ny_open"]),
  mode: z.enum(["live", "paper"]),
  trading_date: dateSchema,
  run_id: z.string().min(3),
  as_of_utc: z.string().datetime({ offset: true }),
  timezone: z.literal("Europe/Paris"),
};
const liveWriterScopeSchema = z.object(liveWriterScopeFields).superRefine(requireBacktestForReplay);
const liveWriterRequired = [...operationalScopeRequired, "timezone"];
function requireBacktestForReplay(value, ctx) {
  const expectedSession = value.strategy_id === "ny_open_1530" ? "ny_open" : "asia_open";
  if (value.session !== expectedSession) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["session"], message: "STRATEGY_SESSION_MISMATCH" });
  }
  if (["replay", "backtest"].includes(value.mode) && !value.backtest_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["backtest_id"], message: "SCOPE_REQUIRED:backtest_id" });
  }
  if (!["replay", "backtest"].includes(value.mode) && value.backtest_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["backtest_id"], message: "INVALID_SCOPE:backtest_id" });
  }
}
const manualMonitorBundleInputSchema = {
  type: "object",
  properties: {
    ...liveOperationalScopeJson,
    bundle_id: { type: "string", minLength: 3 },
    timestamp_paris: { type: "string" },
    cadence: { type: "string", enum: ["5m", "M5", "15m", "M15"], default: "15m" },
    master_id: { type: "string", minLength: 3 },
    pack_id: { type: "string" },
    thesis_id: { type: "string", minLength: 3 },
    include_raw_refs: { type: "boolean", default: true },
    view: { type: "string", enum: ["compact", "full"] },
    include_sections: { type: "array", items: { type: "string", enum: LIVE_BUNDLE_SECTIONS }, maxItems: 12 },
    exclude_sections: { type: "array", items: { type: "string", enum: LIVE_BUNDLE_SECTIONS }, maxItems: 12 },
    snapshot_windows: { type: "array", items: { type: "string", enum: ["15m", "1h", "4h"] }, maxItems: 3 },
    snapshot_instruments: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 30 },
    max_response_bytes: { type: "integer", minimum: 16000, maximum: 512000 },
  },
  required: [...operationalScopeRequired, "master_id", "thesis_id"],
  additionalProperties: false,
};
const prepareM15MonitorBundleInputSchema = {
  ...manualMonitorBundleInputSchema,
  properties: {
    ...manualMonitorBundleInputSchema.properties,
    save: { type: "boolean", default: true },
    lock_ttl_seconds: { type: "number", default: 180 },
    force_rebuild: { type: "boolean", default: false },
    enqueue_agent_work: { type: "boolean", default: true },
  },
};
const masterCutoffBundleInputSchema = {
  type: "object",
  properties: {
    ...liveOperationalScopeJson,
    cutoff_paris: { type: "string" },
    instruments: { type: "array", items: { type: "string", enum: ["MNQ", "MES", "NQ", "ES"] } },
    include_raw_refs: { type: "boolean", default: true },
    view: { type: "string", enum: ["compact", "full"] },
    include_sections: { type: "array", items: { type: "string", enum: LIVE_BUNDLE_SECTIONS }, maxItems: 12 },
    exclude_sections: { type: "array", items: { type: "string", enum: LIVE_BUNDLE_SECTIONS }, maxItems: 12 },
    snapshot_windows: { type: "array", items: { type: "string", enum: ["15m", "1h", "4h"] }, maxItems: 3 },
    snapshot_instruments: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 30 },
    max_response_bytes: { type: "integer", minimum: 16000, maximum: 512000 },
  },
  required: operationalScopeRequired,
  additionalProperties: false,
};
const prepareMasterCutoffBundleInputSchema = {
  ...masterCutoffBundleInputSchema,
  properties: {
    ...masterCutoffBundleInputSchema.properties,
    save: { type: "boolean", default: true },
    lock_ttl_seconds: { type: "number", default: 180 },
    force_rebuild: { type: "boolean", default: false },
    enqueue_agent_work: { type: "boolean", default: true },
  },
};
const getMasterCutoffBundleInputSchema = {
  type: "object",
  properties: {
    bundle_id: { type: "string" },
    ...masterCutoffBundleInputSchema.properties,
  },
  required: operationalScopeRequired,
  additionalProperties: false,
};
const replayMonitorBundlesInputSchema = {
  type: "object",
  properties: {
    session: { type: "string", enum: ["asia_open", "london_session", "ny_open", "work_forward"], default: "asia_open" },
    mode: { type: "string", enum: ["replay", "backtest"], default: "replay" },
    date: { type: "string" },
    timestamps_paris: { type: "array", items: { type: "string" } },
    cadence: { type: "string", enum: ["5m", "M5", "15m", "M15"], default: "15m" },
    analysis_id: { type: "string" },
    pack_id: { type: "string" },
    thesis_id: { type: "string" },
    save: { type: "boolean", default: true },
  },
  required: ["timestamps_paris"],
  additionalProperties: false,
};
const saveManualMonitorV1InputSchema = {
  type: "object",
  properties: {
    monitor_id: { type: "string" },
    contract_name: { type: "string", const: "DeskHourlyThesisMonitorContract" },
    schema_version: { type: "string", const: "1.0.0" },
    contract_hash: { type: "string", minLength: 1 },
    bundle_id: { type: "string" },
    linked_active_thesis_id: { type: "string" },
    linked_master_analysis_id: { type: "string" },
    pack_id: { type: "string" },
    session: { type: "string", enum: ["asia_open", "london_session", "ny_open", "work_forward"], default: "asia_open" },
    timestamp_paris: { type: "string" },
    cadence: { type: "string", enum: ["5m", "M5", "15m", "M15"], default: "5m" },
    mode: { type: "string", enum: ["live", "paper", "replay", "backtest"], default: "live" },
    status: { type: "string" },
    monitor_decision: { type: "object" },
    thesis_update: { type: "object" },
    context_transmission: { type: "object" },
    alert: { type: "object" },
    raw_chatgpt_output: {},
    operator_notes: { type: "string" },
    front_projection: {
      type: "object",
      properties: {
        contractName: { type: "string", const: "DeskFrontProjectionContract" },
        schemaVersion: { type: "string", const: "1.0.0" },
        source: { type: "object" },
      },
      required: ["contractName", "schemaVersion", "source"],
      additionalProperties: true,
    },
  },
  required: ["contract_name", "schema_version", "contract_hash", "timestamp_paris"],
  additionalProperties: true,
};

const nativeMonitorOutputJsonSchema = {
  type: "object",
  description: "Unmodified DeskHourlyThesisMonitorContract 2.4.0 source document. Full normative validation occurs at the save boundary.",
  properties: {
    contract: {
      type: "object",
      properties: { name: { const: "DeskHourlyThesisMonitorContract" }, version: { const: "2.4.0" } },
      required: ["name", "version"],
      additionalProperties: false,
    },
    command: { type: "object", description: "Native DeskMonitorCommandContract 1.4.0 GPT intent." },
  },
  required: ["contract", "command"],
  additionalProperties: true,
};
const saveManualMonitorV2InputSchema = {
  type: "object",
  properties: {
    monitor_id: { type: "string", minLength: 3 },
    contract_name: { type: "string", const: "DeskHourlyThesisMonitorContract" },
    schema_version: { type: "string", const: "2.4.0" },
    contract_hash: { type: "string", minLength: 1 },
    bundle_id: { type: "string", minLength: 3 },
    pack_id: { type: "string", minLength: 3 },
    timestamp_paris: { type: "string", format: "date-time" },
    cadence: { type: "string", enum: ["15m", "M15"], default: "M15" },
    status: { type: "string" },
    monitor_output: nativeMonitorOutputJsonSchema,
    raw_chatgpt_output: {},
    operator_notes: { type: "string" },
  },
  required: ["monitor_id", "contract_name", "schema_version", "contract_hash", "timestamp_paris", "monitor_output"],
  additionalProperties: true,
};
function saveManualMonitorVersionedInputSchema() {
  return augmentLiveWriterInputSchema(saveManualMonitorV2InputSchema, deskWorkLeaseJson);
}

const nativeMasterOutputJsonSchema = {
  type: "object",
  description: "Unmodified DeskMasterAnalysisContract 5.4.0 source document. Full normative validation occurs at the save boundary.",
  properties: {
    contract: {
      type: "object",
      properties: { name: { const: "DeskMasterAnalysisContract" }, version: { const: "5.4.0" } },
      required: ["name", "version"],
      additionalProperties: false,
    },
    execution_plan: { type: "object", description: "Native DeskExecutionPlanContract 1.4.0 GPT proposal." },
  },
  required: ["contract", "execution_plan"],
  additionalProperties: true,
};
const saveMasterAnalysisV5InputSchema = {
  type: "object",
  properties: {
    analysis_id: { type: "string", minLength: 3 },
    contract_name: { type: "string", const: "DeskMasterAnalysisContract" },
    schema_version: { type: "string", const: "5.4.0" },
    contract_hash: { type: "string", minLength: 1 },
    pack_id: { type: "string", minLength: 3 },
    date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    session: { type: "string", enum: ["asia_open", "london_session", "ny_open", "work_forward", "post_event_replan"] },
    status: { type: "string", enum: ["ready", "archived"], default: "ready" },
    created_at_paris: { type: "string", format: "date-time" },
    analysis_output: nativeMasterOutputJsonSchema,
    raw_chatgpt_output: {},
  },
  required: ["analysis_id", "contract_name", "schema_version", "contract_hash", "pack_id", "date", "session", "created_at_paris", "analysis_output"],
  additionalProperties: true,
};
function saveMasterAnalysisVersionedInputSchema() {
  return augmentLiveWriterInputSchema(saveMasterAnalysisV5InputSchema, deskWorkLeaseJson);
}
const orchestratedReplayRefInputSchema = {
  type: "object",
  properties: {
    backtest_id: { type: "string" },
    step_id: { type: "string" },
  },
  required: ["backtest_id", "step_id"],
  additionalProperties: true,
};
const replayBundleSections = [
  "contract",
  "save_target",
  "quality",
  "pack",
  "dataset_integrity",
  "macro_calendar",
  "news_digest",
  "market_availability",
  "rolling_snapshots",
  "replan_context",
  "replay_lineage",
  "raw_refs",
  "instructions",
];
const replayLineageComponents = [
  "replay_master_analysis",
  "replay_active_thesis",
  "replay_setups",
  "previous_replay_monitor",
  "replay_position",
];
const replayBundleReadInputSchema = {
  ...orchestratedReplayRefInputSchema,
  properties: {
    ...orchestratedReplayRefInputSchema.properties,
    bundle_type: { type: "string", enum: ["master", "monitor"] },
    view: { type: "string", enum: ["compact", "manifest", "full"], default: "compact" },
    include_sections: { type: "array", items: { type: "string", enum: replayBundleSections }, maxItems: replayBundleSections.length },
    exclude_sections: { type: "array", items: { type: "string", enum: replayBundleSections }, maxItems: replayBundleSections.length },
    snapshot_windows: { type: "array", items: { type: "string", enum: ["15m", "1h", "4h"] }, maxItems: 3 },
    instruments: { type: "array", items: { type: "string" }, maxItems: 30 },
    include_raw_refs: { type: "boolean", default: false },
    max_response_bytes: { type: "integer", minimum: 16000, maximum: 512000 },
  },
};
const replayBundleManifestInputSchema = {
  ...orchestratedReplayRefInputSchema,
  properties: {
    ...orchestratedReplayRefInputSchema.properties,
    bundle_type: { type: "string", enum: ["master", "monitor"] },
    max_response_bytes: { type: "integer", minimum: 16000, maximum: 512000 },
  },
  required: ["backtest_id", "step_id", "bundle_type"],
};
const replayBundleSectionInputSchema = {
  ...replayBundleManifestInputSchema,
  properties: {
    ...replayBundleManifestInputSchema.properties,
    section: { type: "string", enum: replayBundleSections },
    component: { type: "string", enum: replayLineageComponents },
    field: { type: "string", minLength: 1, maxLength: 160 },
    snapshot_windows: { type: "array", items: { type: "string", enum: ["15m", "1h", "4h"] }, maxItems: 3 },
    instruments: { type: "array", items: { type: "string" }, maxItems: 30 },
    include_raw_refs: { type: "boolean", default: false },
    offset: { type: "integer", minimum: 0, default: 0 },
    limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
  },
  required: ["backtest_id", "step_id", "bundle_type", "section"],
};
const replaySnapshotInputSchema = {
  ...replayBundleManifestInputSchema,
  properties: {
    ...replayBundleManifestInputSchema.properties,
    window: { type: "string", enum: ["15m", "1h", "4h"] },
    instruments: { type: "array", items: { type: "string" }, maxItems: 30 },
    include_raw_refs: { type: "boolean", default: false },
  },
  required: ["backtest_id", "step_id", "bundle_type", "window"],
};
const orchestratedReplayMutationRefInputSchema = {
  ...orchestratedReplayRefInputSchema,
  properties: {
    ...orchestratedReplayRefInputSchema.properties,
    expected_revision: { type: "integer", minimum: 0 },
    idempotency_key: { type: "string", minLength: 3 },
  },
  required: ["backtest_id", "step_id", "expected_revision", "idempotency_key"],
};
const createOrchestratedReplayDayInputSchema = {
  type: "object",
  properties: {
    backtest_id: { type: "string" },
    replay_run_id: { type: "string" },
    strategy_id: { type: "string", enum: ["ny_open_1530", "asia_open"] },
    date: { type: "string" },
    trading_date: { type: "string" },
    session: { type: "string", enum: ["asia_open", "ny_open"] },
    pack_id: { type: "string" },
    pack_build_id: { type: "string" },
    cutoff_paris: { type: "string" },
    cutoff_utc: { type: "string" },
    start_time: { type: "string" },
    end_time: { type: "string" },
    cadence: { type: "string", enum: ["5m", "M5", "15m", "M15", "30m", "60m", "1h"], default: "15m" },
    timezone: { type: "string", const: "Europe/Paris", default: "Europe/Paris" },
    initial_cutoff: { type: "string" },
    instruments: { type: "array", items: { type: "string", enum: ["MNQ", "MES", "NQ", "ES"] } },
    risk_model: { type: "string" },
    idempotency_key: { type: "string", minLength: 3 },
  },
  required: ["backtest_id", "strategy_id", "date", "session", "pack_id", "pack_build_id", "cutoff_paris", "cutoff_utc", "start_time", "end_time", "idempotency_key"],
  additionalProperties: true,
};
const prepareReplayMasterBundleInputSchema = {
  ...orchestratedReplayMutationRefInputSchema,
  properties: {
    ...orchestratedReplayMutationRefInputSchema.properties,
    include_raw_refs: { type: "boolean", default: true },
    force_rebuild: { type: "boolean", default: false },
  },
};
const saveReplayMasterAnalysisV4InputSchema = {
  ...orchestratedReplayMutationRefInputSchema,
  properties: {
    ...orchestratedReplayMutationRefInputSchema.properties,
    contract_name: { type: "string", const: "DeskMasterAnalysisContract" },
    schema_version: { type: "string", const: "4.0.0" },
    contract_hash: { type: "string", minLength: 1 },
    analysis_id: { type: "string" },
    pack_build_id: { type: "string" },
    monitor_ready_master: { type: "object" },
    full_analysis: { type: "object" },
    active_thesis: { type: "object" },
    setups: { type: "array", items: { type: "object" } },
    context_transmission: { type: "object" },
    executable_decision: { type: "object" },
    final_sections: { type: "object" },
    raw_chatgpt_output: {},
  },
  required: ["backtest_id", "step_id", "expected_revision", "idempotency_key", "contract_name", "schema_version", "contract_hash", "analysis_id", "pack_build_id"],
};

const saveReplayMasterAnalysisV5InputSchema = {
  ...orchestratedReplayMutationRefInputSchema,
  properties: {
    ...orchestratedReplayMutationRefInputSchema.properties,
    contract_name: { type: "string", const: "DeskMasterAnalysisContract" },
    schema_version: { type: "string", const: "5.4.0" },
    contract_hash: { type: "string", minLength: 1 },
    analysis_id: { type: "string", minLength: 3 },
    pack_build_id: { type: "string", minLength: 3 },
    analysis_output: nativeMasterOutputJsonSchema,
    raw_chatgpt_output: {},
    work_item_id: { type: "string", minLength: 3 },
    worker_id: { type: "string", minLength: 3 },
    lease_token: { type: "string", minLength: 8 },
  },
  required: ["backtest_id", "step_id", "expected_revision", "idempotency_key", "contract_name", "schema_version", "contract_hash", "analysis_id", "pack_build_id", "analysis_output"],
};
const saveReplayMasterAnalysisInputSchema = {
  ...saveReplayMasterAnalysisV5InputSchema,
};
const advanceReplayClockInputSchema = {
  type: "object",
  properties: {
    backtest_id: { type: "string" },
    expected_revision: { type: "integer", minimum: 0 },
    idempotency_key: { type: "string", minLength: 3 },
    minutes: { type: "number", default: 15 },
    force: { type: "boolean", default: false },
  },
  required: ["backtest_id", "expected_revision", "idempotency_key"],
  additionalProperties: true,
};
const prepareReplayMonitorBundleInputSchema = {
  ...orchestratedReplayMutationRefInputSchema,
  properties: {
    ...orchestratedReplayMutationRefInputSchema.properties,
    timestamp_paris: { type: "string" },
    include_raw_refs: { type: "boolean", default: true },
    force_rebuild: { type: "boolean", default: false },
  },
};
const saveReplayMonitorV1InputSchema = {
  ...orchestratedReplayMutationRefInputSchema,
  properties: {
    ...orchestratedReplayMutationRefInputSchema.properties,
    monitor_id: { type: "string" },
    master_id: { type: "string" },
    thesis_id: { type: "string" },
    sequence: { type: "integer", minimum: 1 },
    scheduled_for_utc: { type: "string" },
    as_of_utc: { type: "string" },
    pack_build_id: { type: "string" },
    contract_name: { type: "string", const: "DeskHourlyThesisMonitorContract" },
    schema_version: { type: "string", const: "1.0.0" },
    contract_hash: { type: "string", minLength: 1 },
    timestamp_paris: { type: "string" },
    cadence: { type: "string", enum: ["5m", "M5", "15m", "M15", "30m", "60m", "1h"], default: "5m" },
    manual_triggered: { type: "boolean", default: true },
    triggered_by: { type: "string", default: "user_chatgpt" },
    monitor_decision: { type: "object" },
    thesis_update: { type: "object" },
    thesis_health_score: {},
    expected_vs_realized: { type: "object" },
    macro_update: { type: "object" },
    cross_asset_delta: { type: "object" },
    technical_delta: { type: "object" },
    wait_to_go_check: { type: "object" },
    invalidation_check: { type: "object" },
    weak_signals: { type: "array" },
    scenario_transformation_check: { type: "object" },
    position_check: { type: "object" },
    setup_transition: { type: "object" },
    setup_candidate: { type: "object" },
    armed_setup: { type: "object" },
    setup_state: { type: "object" },
    setup_transitions: { type: "array", items: { type: "object" } },
    setup_candidates: { type: "array", items: { type: "object" } },
    replay_cadence_recommendation: { type: "object" },
    next_checkpoints: { type: "array", items: {} },
    monitor_context_transmission: { type: "object" },
    final_sections: { type: "object" },
    raw_chatgpt_output: {},
  },
  required: ["backtest_id", "step_id", "expected_revision", "idempotency_key", "monitor_id", "master_id", "thesis_id", "sequence", "scheduled_for_utc", "as_of_utc", "pack_build_id", "contract_name", "schema_version", "contract_hash"],
};

const saveReplayMonitorV2InputSchema = {
  ...orchestratedReplayMutationRefInputSchema,
  properties: {
    ...orchestratedReplayMutationRefInputSchema.properties,
    monitor_id: { type: "string", minLength: 3 },
    master_id: { type: "string", minLength: 3 },
    thesis_id: { type: "string", minLength: 3 },
    sequence: { type: "integer", minimum: 1 },
    scheduled_for_utc: { type: "string", format: "date-time" },
    as_of_utc: { type: "string", format: "date-time" },
    pack_build_id: { type: "string", minLength: 3 },
    contract_name: { type: "string", const: "DeskHourlyThesisMonitorContract" },
    schema_version: { type: "string", const: "2.4.0" },
    contract_hash: { type: "string", minLength: 1 },
    timestamp_paris: { type: "string", format: "date-time" },
    cadence: { type: "string", enum: ["15m", "M15"], default: "M15" },
    manual_triggered: { type: "boolean", default: true },
    triggered_by: { type: "string", default: "gpt_worker" },
    monitor_output: nativeMonitorOutputJsonSchema,
    raw_chatgpt_output: {},
    work_item_id: { type: "string", minLength: 3 },
    worker_id: { type: "string", minLength: 3 },
    lease_token: { type: "string", minLength: 8 },
  },
  required: ["backtest_id", "step_id", "expected_revision", "idempotency_key", "monitor_id", "master_id", "thesis_id", "sequence", "scheduled_for_utc", "as_of_utc", "pack_build_id", "contract_name", "schema_version", "contract_hash", "monitor_output"],
};
const saveReplayMonitorInputSchema = {
  ...saveReplayMonitorV2InputSchema,
};
const simulateReplayIntervalInputSchema = {
  type: "object",
  properties: {
    backtest_id: { type: "string" },
    step_id: { type: "string" },
    expected_revision: { type: "integer", minimum: 0 },
    idempotency_key: { type: "string", minLength: 3 },
    from_timestamp: { type: "string" },
    to_timestamp: { type: "string" },
  },
  required: ["backtest_id", "step_id", "expected_revision", "idempotency_key"],
  additionalProperties: true,
};
const getReplayTimelineInputSchema = {
  type: "object",
  properties: {
    backtest_id: { type: "string" },
    limit: { type: "number", default: 200 },
  },
  required: ["backtest_id"],
  additionalProperties: false,
};
const deskWorkerIdJson = { type: "string", minLength: 3, maxLength: 120 };
const deskWorkLeaseJson = {
  work_item_id: { type: "string", minLength: 3 },
  worker_id: deskWorkerIdJson,
  lease_token: { type: "string", minLength: 8 },
};
const liveCursorLeaseJson = {
  worker_id: deskWorkerIdJson,
  cursor_id: { type: "string", minLength: 3 },
  checkpoint: { type: "string", format: "date-time" },
  lease_token: { type: "string", minLength: 8 },
};
const gptTelemetryJson = {
  type: "object",
  properties: {
    provider: { type: "string", minLength: 1, maxLength: 80 },
    model: { type: "string", minLength: 1, maxLength: 160 },
    request_id: { type: "string", minLength: 1, maxLength: 240 },
    input_tokens: { type: "integer", minimum: 0 },
    output_tokens: { type: "integer", minimum: 0 },
    total_tokens: { type: "integer", minimum: 0 },
    cached_input_tokens: { type: "integer", minimum: 0 },
    reasoning_tokens: { type: "integer", minimum: 0 },
    cost_usd: { type: "number", minimum: 0 },
    api_latency_ms: { type: "integer", minimum: 0 },
    started_at_utc: { type: "string", format: "date-time" },
    completed_at_utc: { type: "string", format: "date-time" },
  },
  minProperties: 1,
  additionalProperties: false,
};
const unifiedDeskWorkflowsJson = {
  type: "array",
  items: { type: "string", enum: ["LIVE_MASTER", "LIVE_M15_MONITOR", "REPLAY_MASTER", "REPLAY_MONITOR"] },
  minItems: 1,
  maxItems: 4,
  default: ["LIVE_MASTER", "LIVE_M15_MONITOR", "REPLAY_MASTER", "REPLAY_MONITOR"],
};
const replayOnlyWorkflowsJson = {
  type: "array",
  items: { type: "string", enum: ["REPLAY_MASTER", "REPLAY_MONITOR"] },
  minItems: 1,
  maxItems: 2,
  default: ["REPLAY_MASTER", "REPLAY_MONITOR"],
};
export function createDeskToolRegistry(store) {
  return [
    ...createAgentRuntimeAdminToolDefinitions(store).map((definition) => createTool(store, definition)),
    createTool(store, {
      name: "desk_ping",
      title: "Desk ping",
      description: "Test de connexion entre ChatGPT et le serveur MCP local du Desk. Retourne OK si le serveur est accessible.",
      annotations: { readOnlyHint: true },
      requiredScopes: [],
      validator: z.object({}).strict(),
      inputSchema: getToolInputSchema("desk_ping"),
      textResult: "OK",
      handler: () => ({
        ok: true,
        message: "OK",
        server: "tv-automation-desk-mcp",
        version: "0.1.1",
      }),
    }),
    createTool(store, {
      name: "get_active_contracts",
      title: "Get active Master and Monitor contracts",
      description: "Mandatory first vNext tool. Use view=summary for the contract handshake; read only the relevant full contract afterward when its methodology is needed.",
      annotations: { readOnlyHint: true },
      validator: activeContractsReadSchema,
      inputSchema: activeContractsReadInputSchema,
      handler: async (args) => projectActiveContracts(await store.getActiveContracts(), args),
    }),
    createTool(store, {
      name: "get_contract",
      title: "Get a desk contract version",
      description: "Returns one stored desk contract by name and schema version.",
      annotations: { readOnlyHint: true },
      validator: contractLookupSchema,
      inputSchema: getToolInputSchema("get_contract"),
      handler: (args) => store.getContract(args),
    }),
    createTool(store, {
      name: "list_contract_versions",
      title: "List desk contract versions",
      description: "Lists available versions for a desk contract.",
      annotations: { readOnlyHint: true },
      validator: contractListSchema,
      inputSchema: getToolInputSchema("list_contract_versions"),
      handler: (args) => store.listContractVersions(args),
    }),
    createTool(store, {
      name: "get_latest_asia_open_pack",
      title: "Get latest Asia Open pack",
      description: "Returns the latest ready Asia Open desk pack for a Paris trading date. V4 workers validate the active contract before analysis.",
      annotations: { readOnlyHint: true },
      validator: z.object({
        date: dateSchema.optional(),
        timezone: z.literal("Europe/Paris").default("Europe/Paris"),
      }),
      inputSchema: getToolInputSchema("get_latest_asia_open_pack"),
      handler: (args) => store.getLatestAsiaOpenPack(args),
    }),
    createTool(store, {
      name: "list_available_exports",
      title: "List available desk packs",
      description: "Lists available desk packs before selecting a replay or Asia Open pack.",
      annotations: { readOnlyHint: true },
      validator: z.object({
        date_from: dateSchema.optional(),
        date_to: dateSchema.optional(),
        session: z.enum(["asia_open", "asia_to_london", "ny_open", "custom"]).default("asia_open"),
        status: z.enum(["ready", "draft", "any"]).default("ready"),
        limit: z.number().int().min(1).max(500).default(100),
      }),
      inputSchema: getToolInputSchema("list_available_exports"),
      handler: (args) => store.listDeskPacks(args),
    }),
    createTool(store, {
      name: "get_desk_pack",
      title: "Get desk pack",
      description: "Returns metadata, summary, immutable dataset refs and quality for one desk pack.",
      annotations: { readOnlyHint: true },
      validator: getDeskPackV2Schema,
      inputSchema: {
        type: "object",
        properties: {
          pack_id: { type: "string", minLength: 3 },
          pack_build_id: { type: "string", minLength: 3 },
          mode: { type: "string", enum: ["live", "paper", "replay", "backtest"], default: "live" },
          include_draft: { type: "boolean", default: false },
        },
        required: ["pack_id"],
        additionalProperties: false,
      },
      handler: (args) => store.getDeskPack(args),
    }),
    createTool(store, {
      name: "get_desk_setups",
      title: "Get saved desk setups",
      description: "Returns structured setups materialized by save_desk_analysis for replay, lifecycle tracking, and front display without parsing the full analysis JSON.",
      annotations: { readOnlyHint: true },
      validator: z.object({
        pack_id: z.string().min(3).optional(),
        analysis_id: z.string().min(3).optional(),
        decision_id: z.string().min(3).optional(),
        status: z.string().default("any"),
        primary_only: z.boolean().default(false),
        limit: z.number().int().min(1).max(500).default(50),
      }).refine((value) => value.pack_id || value.analysis_id || value.decision_id, {
        message: "pack_id, analysis_id or decision_id is required",
      }),
      inputSchema: getToolInputSchema("get_desk_setups"),
      handler: (args) => store.getDeskSetups(args),
    }),
    createTool(store, {
      name: "replay_desk_setups",
      title: "Replay saved desk setups",
      description: "Replays materialized desk setups against M5 market candles, then stores deterministic replay_status and replay_result on each setup for front/backtest display.",
      annotations: { readOnlyHint: false },
      validator: z.object({
        setup_record_id: z.string().min(3).optional(),
        pack_id: z.string().min(3).optional(),
        analysis_id: z.string().min(3).optional(),
        decision_id: z.string().min(3).optional(),
        primary_only: z.boolean().default(false),
        write_result: z.boolean().default(true),
        timeframe: z.enum(["M5"]).default("M5"),
        replay_from: z.string().optional(),
        replay_to: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }).refine((value) => value.setup_record_id || value.pack_id || value.analysis_id || value.decision_id, {
        message: "setup_record_id, pack_id, analysis_id or decision_id is required",
      }),
      inputSchema: getToolInputSchema("replay_desk_setups"),
      handler: () => {
        throw codedToolError("READ_ONLY_REPLAY_FORBIDDEN", "replay_desk_setups is read-only history and cannot write new replay results.");
      },
    }),
    createTool(store, {
      name: "get_dataset",
      title: "Get dataset",
      description: "Use this when ChatGPT needs one pack dataset as structured JSON rows or trimmed CSV text.",
      annotations: { readOnlyHint: true },
      validator: getDatasetV2Schema,
      inputSchema: {
        type: "object",
        properties: {
          pack_id: { type: "string", minLength: 3 },
          pack_build_id: { type: "string", minLength: 3 },
          dataset: { type: "string", enum: DATASETS },
          as_of_utc: { type: "string", format: "date-time" },
          mode: { type: "string", enum: ["live", "paper", "replay", "backtest"], default: "replay" },
          format: { type: "string", enum: ["json", "csv"], default: "json" },
          max_rows: { type: "integer", minimum: 1, maximum: 5000, default: 1000 },
          row_order: {
            type: "string",
            enum: ["oldest_first", "latest_first"],
            default: "oldest_first",
          },
        },
        required: ["pack_id", "pack_build_id", "dataset", "as_of_utc"],
        additionalProperties: false,
      },
      handler: (args) => store.getDataset(args),
    }),
    createTool(store, {
      name: "get_market_levels",
      title: "Get market levels",
      description: "Use this when ChatGPT needs precomputed MNQ or MES key levels and indicator context from a desk pack.",
      annotations: { readOnlyHint: true },
      validator: z.object({
        pack_id: z.string().min(3),
        instrument: z.enum(["MNQ", "MES", "NQ", "ES"]),
      }),
      inputSchema: getToolInputSchema("get_market_levels"),
      handler: (args) => store.getMarketLevels(args),
    }),
    createTool(store, {
      name: "get_macro_calendar",
      title: "Get macro calendar",
      description: "Use this when ChatGPT needs Paris-time macro events relevant to a desk session.",
      annotations: { readOnlyHint: true },
      validator: z.object({
        date: dateSchema.optional(),
        pack_id: z.string().optional(),
        pack_build_id: z.string().optional(),
        as_of_utc: z.string().datetime({ offset: true }).optional(),
        mode: executionModeSchema.default("live"),
        timezone: z.literal("Europe/Paris").default("Europe/Paris"),
        importance_min: z.enum(["low", "medium", "high"]).default("medium"),
      }).superRefine(requirePinnedPackForReplay),
      inputSchema: {
        type: "object",
        properties: {
          date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          pack_id: { type: "string" },
          pack_build_id: { type: "string" },
          as_of_utc: { type: "string", format: "date-time" },
          mode: { type: "string", enum: ["live", "paper", "replay", "backtest"], default: "live" },
          timezone: { type: "string", const: "Europe/Paris", default: "Europe/Paris" },
          importance_min: { type: "string", enum: ["low", "medium", "high"], default: "medium" },
        },
        additionalProperties: false,
      },
      handler: (args) => store.getMacroCalendar(args),
    }),
    createTool(store, {
      name: "get_news_digest",
      title: "Get news digest",
      description: "Use this when ChatGPT needs macro, Fed, earnings, or geopolitical headlines for a desk session.",
      annotations: { readOnlyHint: true },
      validator: z.object({
        date: dateSchema.optional(),
        pack_id: z.string().optional(),
        pack_build_id: z.string().optional(),
        as_of_utc: z.string().datetime({ offset: true }).optional(),
        mode: executionModeSchema.default("live"),
        session: z.enum(["asia_open", "asia_to_london", "ny_open"]).default("asia_open"),
      }).superRefine(requirePinnedPackForReplay),
      inputSchema: {
        type: "object",
        properties: {
          date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          pack_id: { type: "string" },
          pack_build_id: { type: "string" },
          as_of_utc: { type: "string", format: "date-time" },
          mode: { type: "string", enum: ["live", "paper", "replay", "backtest"], default: "live" },
          session: { type: "string", enum: ["asia_open", "asia_to_london", "ny_open"], default: "asia_open" },
        },
        additionalProperties: false,
      },
      handler: (args) => store.getNewsDigest(args),
    }),
    createTool(store, {
      name: "get_master_analysis_bundle",
      title: "Get Master Analysis context bundle",
      description: "Returns the pinned pack, active Master V5 contract, Execution Plan V1, Execution Policy V4, condition catalog, macro/news and prior context required for a native deterministic Master analysis.",
      annotations: { readOnlyHint: true },
      validator: masterCutoffBundleRequestSchema,
      inputSchema: masterCutoffBundleInputSchema,
      handler: (args) => store.getMasterAnalysisBundle(args),
    }),
    createTool(store, {
      name: "prepare_master_cutoff_bundle_job",
      title: "Prepare Master cutoff bundle job",
      description: "Builds and stores a cutoff-scoped Master data bundle without creating setups, decisions, or calling OpenAI.",
      annotations: { readOnlyHint: false },
      validator: prepareMasterCutoffBundleJobSchema,
      inputSchema: prepareMasterCutoffBundleInputSchema,
      handler: (args) => store.prepareMasterCutoffBundleJob(args),
    }),
    createTool(store, {
      name: "prepare_due_live_master_bundle_job",
      title: "Prepare due live Master bundle",
      description: "Scheduler-safe live entry point. Derives the exact strategy, session, Paris trading date, deterministic run_id and cutoff scope for a registered Master workflow, then prepares the strict Master bundle.",
      annotations: { readOnlyHint: false },
      validator: prepareDueLiveMasterBundleSchema,
      inputSchema: {
        type: "object",
        properties: {
          workflow: { type: "string", enum: ["asia_open", "london_0800", "london_1130", "ny_open", "postevent_2030"] },
          trading_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          cutoff_paris: { type: "string" },
          as_of_utc: { type: "string", format: "date-time" },
          run_id: { type: "string", minLength: 3 },
          mode: { type: "string", enum: ["live", "paper"], default: "live" },
          instruments: { type: "array", items: { type: "string", enum: ["MNQ", "MES", "NQ", "ES"] }, default: ["MNQ", "MES", "NQ", "ES"] },
          include_raw_refs: { type: "boolean", default: true },
          save: { type: "boolean", default: true },
          lock_ttl_seconds: { type: "integer", minimum: 30, maximum: 1800, default: 180 },
          force_rebuild: { type: "boolean", default: false },
          enqueue_agent_work: { type: "boolean", default: true },
        },
        required: ["workflow"],
        additionalProperties: false,
      },
      handler: (args) => prepareDueLiveMasterBundle(store, args),
    }),
    createTool(store, {
      name: "get_master_cutoff_bundle",
      title: "Get Master cutoff bundle",
      description: "Reads a stored cutoff-scoped Master data bundle. It never falls back silently to another session or cutoff.",
      annotations: { readOnlyHint: true },
      validator: getMasterCutoffBundleSchema,
      inputSchema: getMasterCutoffBundleInputSchema,
      handler: (args) => store.getMasterCutoffBundle(args),
      textResult: liveBundleReceiptText,
    }),
    createTool(store, {
      name: "get_monitor_context_bundle",
      title: "Get hourly monitor context bundle",
      description: "Returns monitor context for one exact live/paper run; replay callers must use get_replay_monitor_bundle.",
      annotations: { readOnlyHint: true },
      validator: manualMonitorBundleRequestSchema,
      inputSchema: manualMonitorBundleInputSchema,
      handler: (args) => store.getMonitorContextBundle(args),
    }),
    createTool(store, {
      name: "get_manual_monitor_bundle",
      title: "Get GPT M15 monitor bundle",
      description: "Returns the scheduled GPT M15 or critical-event monitor bundle with structural H4/H1/M15 context and deterministic M1 lifecycle events. The backend prepares data only.",
      annotations: { readOnlyHint: true },
      validator: manualMonitorBundleRequestSchema,
      inputSchema: manualMonitorBundleInputSchema,
      handler: (args) => store.getManualMonitorBundle(args),
      textResult: liveBundleReceiptText,
    }),
    createTool(store, {
      name: "prepare_m15_monitor_bundle_job",
      title: "Prepare idempotent GPT M15 monitor job",
      description: "Creates or reuses an idempotent scheduled GPT M15 or critical-event preparation job, stores the monitor bundle, structural snapshots and data-quality audit.",
      annotations: { readOnlyHint: false },
      validator: prepareM15MonitorBundleJobSchema,
      inputSchema: prepareM15MonitorBundleInputSchema,
      handler: (args) => store.prepareM15MonitorBundleJob(args),
    }),
    createTool(store, {
      name: "prepare_due_live_m15_bundle_job",
      title: "Prepare due live GPT M15 bundle",
      description: "Scheduler-safe GPT M15 and critical-event entry point. Resolves the deterministic live run, latest exact-scope Master and its active thesis, then prepares the strict monitor bundle. Missing context returns a successful skipped result.",
      annotations: { readOnlyHint: false },
      validator: prepareDueLiveMonitorBundleSchema,
      inputSchema: {
        type: "object",
        properties: {
          session: { type: "string", enum: ["asia_open", "ny_open"] },
          trading_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          timestamp_paris: { type: "string" },
          as_of_utc: { type: "string", format: "date-time" },
          run_id: { type: "string", minLength: 3 },
          mode: { type: "string", enum: ["live", "paper"], default: "live" },
          include_raw_refs: { type: "boolean", default: true },
          save: { type: "boolean", default: true },
          lock_ttl_seconds: { type: "integer", minimum: 30, maximum: 1800, default: 180 },
          force_rebuild: { type: "boolean", default: false },
          enqueue_agent_work: { type: "boolean", default: true },
        },
        required: ["session"],
        additionalProperties: false,
      },
      handler: (args) => prepareDueLiveMonitorBundle(store, args),
    }),
    createTool(store, {
      name: "prepare_replay_monitor_bundles",
      title: "Prepare replay GPT monitor bundles",
      description: "Prepares GPT monitor bundles at the replay run cadence (M15 for new runs) without making automated decisions.",
      annotations: { readOnlyHint: false },
      validator: replayMonitorBundlesSchema,
      inputSchema: replayMonitorBundlesInputSchema,
      handler: (args) => store.prepareReplayMonitorBundles(args),
    }),
    createTool(store, {
      name: "get_live_desk_state",
      title: "Get Live Desk front-ready state",
      description: "Returns one aggregated backend state for the future Live Desk front: contracts, pack, active thesis, monitor, jobs, alerts, levels, conditions, readiness, and action/status derived from stored backend data.",
      annotations: { readOnlyHint: true },
      validator: liveDeskStateRequestSchema,
      inputSchema: {
        type: "object",
        properties: liveOperationalScopeJson,
        required: operationalScopeRequired,
        additionalProperties: false,
      },
      handler: (args) => store.getLiveDeskState(args),
    }),
    createTool(store, {
      name: "get_front_master_state",
      title: "Get Master front-ready state",
      description: "Returns the aggregated backend state required by the future Master screen without requiring front-side business logic reconstruction.",
      annotations: { readOnlyHint: true },
      validator: frontMasterStateRequestSchema,
      inputSchema: {
        type: "object",
        properties: {
          ...liveOperationalScopeJson,
          cutoff_paris: { type: "string" },
        },
        required: operationalScopeRequired,
        additionalProperties: false,
      },
      handler: (args) => store.getFrontMasterState(args),
    }),
    createTool(store, {
      name: "get_front_monitor_state",
      title: "Get Monitor front-ready state",
      description: "Returns the aggregated backend state required by the future Monitor screen for an active thesis.",
      annotations: { readOnlyHint: true },
      validator: frontMonitorStateRequestSchema,
      inputSchema: {
        type: "object",
        properties: {
          ...liveOperationalScopeJson,
          master_id: { type: "string", minLength: 3 },
          thesis_id: { type: "string", minLength: 3 },
          timestamp_paris: { type: "string" },
        },
        required: [...operationalScopeRequired, "master_id", "thesis_id"],
        additionalProperties: false,
      },
      handler: (args) => store.getFrontMonitorState(args),
    }),
    createTool(store, {
      name: "get_replay_state",
      title: "Get Replay front-ready state",
      description: "Returns replay/backtest runs, selected timeline, simulated trades, and summary stats for the future Replay screen.",
      annotations: { readOnlyHint: true },
      validator: replayStateRequestSchema,
      inputSchema: {
        type: "object",
        properties: {
          backtest_id: { type: "string", minLength: 3 },
          date_from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          date_to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          session: { type: "string", enum: ["asia_open", "london_session", "ny_open", "work_forward"] },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        },
        required: ["backtest_id"],
        additionalProperties: false,
      },
      handler: (args) => store.getReplayState(args),
    }),
    createTool(store, {
      name: "get_nyopen_strategy_state",
      title: "Get NY Open Strategy state",
      description: "Returns the NY Open 15:30 strategy dashboard state: pack, saved Master, thesis, recommended setup, active position, performance and warnings. It never invents a Master.",
      annotations: { readOnlyHint: true },
      validator: nyOpenStrategyStateRequestSchema,
      inputSchema: {
        type: "object",
        properties: {
          date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          timezone: { type: "string", const: "Europe/Paris", default: "Europe/Paris" },
          pricing_mode: { type: "string", enum: ["conservative", "middle", "optimistic"], default: "conservative" },
        },
        additionalProperties: false,
      },
      handler: (args) => store.getNyOpenStrategyState(args),
    }),
    createTool(store, {
      name: "prepare_nyopen_master_bundle",
      title: "Prepare NY Open 15:30 Master bundle",
      description: "Prepares or verifies the NY Open 15:30 cutoff bundle without calling OpenAI or creating an analysis.",
      annotations: { readOnlyHint: false },
      validator: prepareNyOpenMasterBundleSchema,
      inputSchema: {
        type: "object",
        properties: {
          date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          cutoff_paris: { type: "string" },
          save: { type: "boolean", default: true },
          force_rebuild: { type: "boolean", default: false },
        },
        required: ["date"],
        additionalProperties: false,
      },
      handler: (args) => store.prepareNyOpenMasterBundle(args),
    }),
    createTool(store, {
      name: "get_strategy_performance",
      title: "Get strategy performance",
      description: "Returns closed-trade performance, equity curve and drawdown for a strategy.",
      annotations: { readOnlyHint: true },
      validator: strategyPerformanceRequestSchema,
      inputSchema: {
        type: "object",
        properties: {
          strategy_id: { type: "string" },
          aggregate_across_strategies: { type: "boolean", default: false },
          from_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          to_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          pricing_mode: { type: "string", enum: ["conservative", "middle", "optimistic"], default: "conservative" },
          instrument: { type: "string", enum: ["MNQ", "MES", "NQ", "ES", "all"], default: "all" },
          direction: { type: "string", enum: ["long", "short", "all"], default: "all" },
          setup_type: { type: "string" },
          only_triggered_setups: { type: "boolean", default: false },
          only_closed_trades: { type: "boolean", default: false },
        },
        anyOf: [
          { required: ["strategy_id"] },
          { properties: { aggregate_across_strategies: { const: true } }, required: ["aggregate_across_strategies"] },
        ],
        additionalProperties: false,
      },
      handler: (args) => store.getStrategyPerformance(args),
    }),
    createTool(store, {
      name: "get_strategy_calendar",
      title: "Get strategy calendar",
      description: "Returns a month calendar with per-day strategy status and performance.",
      annotations: { readOnlyHint: true },
      validator: strategyCalendarRequestSchema,
      inputSchema: {
        type: "object",
        properties: {
          strategy_id: { type: "string" },
          pricing_mode: { type: "string", enum: ["conservative", "middle", "optimistic"], default: "conservative" },
          year: { type: "number" },
          month: { type: "number" },
        },
        required: ["strategy_id", "year", "month"],
        additionalProperties: false,
      },
      handler: (args) => store.getStrategyCalendar(args),
    }),
    createTool(store, {
      name: "get_strategy_day_detail",
      title: "Get strategy day detail",
      description: "Returns Master, thesis, setups, monitors, trades, performance and timeline for one strategy day.",
      annotations: { readOnlyHint: true },
      validator: strategyDayDetailRequestSchema,
      inputSchema: {
        type: "object",
        properties: {
          strategy_id: { type: "string" },
          pricing_mode: { type: "string", enum: ["conservative", "middle", "optimistic"], default: "conservative" },
          date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        },
        required: ["strategy_id", "date"],
        additionalProperties: false,
      },
      handler: (args) => store.getStrategyDayDetail(args),
    }),
    createTool(store, {
      name: "get_live_timeline_event_detail",
      title: "Get one live cockpit timeline event",
      description: "Returns a human-readable historical checkpoint brief with before, observed, deduction, decision and next-step sections.",
      annotations: { readOnlyHint: true },
      validator: liveTimelineEventDetailRequestSchema,
      inputSchema: {
        type: "object",
        properties: {
          strategy_id: { type: "string", minLength: 1 },
          date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          event_id: { type: "string", minLength: 3, maxLength: 500 },
        },
        required: ["strategy_id", "date", "event_id"],
        additionalProperties: false,
      },
      handler: (args) => store.getLiveTimelineEventDetail(args),
    }),
    createTool(store, {
      name: "recompute_strategy_performance",
      title: "Recompute strategy performance",
      description: "Recomputes daily performance, equity curve, global stats and drawdown from executed strategy trades.",
      annotations: { readOnlyHint: false },
      validator: recomputeStrategyPerformanceSchema,
      inputSchema: {
        type: "object",
        properties: {
          strategy_id: { type: "string", default: "ny_open_1530" },
          pricing_mode: { type: "string", enum: ["conservative", "middle", "optimistic"], default: "conservative" },
          from_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          to_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        },
        additionalProperties: false,
      },
      handler: (args) => store.recomputeStrategyPerformance(args),
    }),
    createTool(store, {
      name: "mark_nyopen_strategy_event",
      title: "Mark NY Open strategy event",
      description: "Applies an audited manual status transition for a NY Open setup or executed trade.",
      annotations: { readOnlyHint: false },
      validator: markNyOpenStrategyEventSchema,
      inputSchema: {
        type: "object",
        properties: {
          strategy_id: { type: "string", default: "ny_open_1530" },
          date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          action: { type: "string", enum: ["mark_setup_triggered", "mark_tp1", "mark_tp2", "mark_tp3", "mark_stopped", "mark_expired", "mark_cancelled", "replay_strict_setup"] },
          setup_id: { type: "string" },
          trade_id: { type: "string" },
          reason: { type: "string" },
          performed_by: { type: "string", default: "dashboard_operator" },
        },
        required: ["action"],
        additionalProperties: true,
      },
      handler: (args) => store.markNyOpenStrategyEvent(args),
    }),
    createTool(store, {
      name: "claim_next_live_work",
      title: "Claim next LIVE Desk work",
      description: "Use this when a scheduled LIVE GPT worker needs its next analytical task. It creates only a short-lived, reversible lease inside the private Desk, never places broker orders, never publishes externally, never deletes analysis, and never falls back to REPLAY.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      validator: claimNextLiveWorkSchema,
      inputSchema: {
        type: "object",
        properties: {
          worker_id: deskWorkerIdJson,
          session: { type: "string", enum: ["asia_open", "ny_open"] },
          trading_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          lease_seconds: { type: "integer", minimum: 120, maximum: 840, default: 660 },
          retry_attempts: { type: "integer", minimum: 1, maximum: 3, default: 3 },
          retry_delay_seconds: { type: "integer", minimum: 30, maximum: 60, default: 60 },
        },
        required: ["worker_id"],
        additionalProperties: false,
      },
      handler: (args) => store.claimNextLiveWork(args),
      textResult: liveClaimReceiptText,
    }),
    createTool(store, {
      name: "claim_next_replay_work",
      title: "Claim next REPLAY Desk work",
      description: "Dedicated REPLAY lane. Claims only the next sequential REPLAY Master/Monitor work item and never inspects or falls back to LIVE.",
      annotations: { readOnlyHint: false },
      validator: claimNextReplayWorkSchema,
      inputSchema: {
        type: "object",
        properties: {
          worker_id: deskWorkerIdJson,
          backtest_id: { type: "string", minLength: 3 },
          lease_seconds: { type: "integer", minimum: 120, maximum: 1800, default: 720 },
        },
        required: ["worker_id"],
        additionalProperties: false,
      },
      handler: (args) => store.claimNextReplayWork(args),
    }),
    createTool(store, {
      name: "claim_next_desk_work",
      title: "Claim next automated Desk work",
      description: "Compatibility facade. New scheduled workers must use claim_next_live_work or claim_next_replay_work so the two lanes cannot consume each other.",
      annotations: { readOnlyHint: false },
      validator: claimNextDeskWorkSchema,
      inputSchema: {
        type: "object",
        properties: {
          worker_id: deskWorkerIdJson,
          workflows: unifiedDeskWorkflowsJson,
          session: { type: "string", enum: ["asia_open", "ny_open"] },
          trading_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          backtest_id: { type: "string", minLength: 3 },
          lease_seconds: { type: "integer", minimum: 120, maximum: 1800, default: 660 },
        },
        required: ["worker_id"],
        additionalProperties: false,
      },
      handler: (args) => store.claimNextDeskWork(args),
    }),
    createTool(store, {
      name: "claim_next_live",
      title: "Claim next LIVE Desk checkpoint",
      description: "Atomically claims the current desired-state LIVE Master, scheduled GPT M15 Monitor or critical-event Monitor checkpoint with strict roll-forward freshness.",
      annotations: { readOnlyHint: false },
      validator: claimNextLiveSchema,
      inputSchema: {
        type: "object",
        properties: {
          worker_id: deskWorkerIdJson,
          session: { type: "string", enum: ["asia_open", "ny_open"] },
          trading_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          lease_seconds: { type: "integer", minimum: 120, maximum: 840, default: 660 },
        },
        required: ["worker_id", "session", "trading_date"],
        additionalProperties: false,
      },
      handler: (args) => store.claimNextLive(args),
    }),
    createTool(store, {
      name: "heartbeat_live",
      title: "Extend a LIVE cursor lease",
      description: "Extends a LIVE cursor lease transactionally without exceeding the fixed hard cap.",
      annotations: { readOnlyHint: false },
      validator: heartbeatLiveSchema,
      inputSchema: {
        type: "object",
        properties: liveCursorLeaseJson,
        required: ["worker_id", "cursor_id", "checkpoint", "lease_token"],
        additionalProperties: false,
      },
      handler: (args) => store.heartbeatLive(args),
    }),
    createTool(store, {
      name: "complete_live",
      title: "Complete LIVE cursor work",
      description: "Verifies the materialized LIVE output and completes the leased cursor checkpoint transactionally.",
      annotations: { readOnlyHint: false },
      validator: completeLiveSchema,
      inputSchema: {
        type: "object",
        properties: { ...liveCursorLeaseJson, telemetry: gptTelemetryJson },
        required: ["worker_id", "cursor_id", "checkpoint", "lease_token"],
        additionalProperties: false,
      },
      handler: (args) => store.completeLive(args),
    }),
    createTool(store, {
      name: "fail_live",
      title: "Fail LIVE cursor work",
      description: "Records a LIVE failure transactionally, scheduling bounded roll-forward retry or a dead-letter.",
      annotations: { readOnlyHint: false },
      validator: failLiveSchema,
      inputSchema: {
        type: "object",
        properties: {
          ...liveCursorLeaseJson,
          error_code: { type: "string", minLength: 1 },
          error_message: { type: "string", minLength: 1 },
          error_class: { type: "string", enum: ["transient", "deterministic"] },
        },
        required: ["worker_id", "cursor_id", "checkpoint", "lease_token", "error_code", "error_message", "error_class"],
        additionalProperties: false,
      },
      handler: (args) => store.failLive(args),
    }),
    createTool(store, {
      name: "claim_next_replay",
      title: "Claim next REPLAY Desk step",
      description: "Claims the next sequential REPLAY Master or Monitor work item without changing replay semantics.",
      annotations: { readOnlyHint: false },
      validator: claimNextReplaySchema,
      inputSchema: {
        type: "object",
        properties: {
          worker_id: deskWorkerIdJson,
          backtest_id: { type: "string", minLength: 3 },
          workflows: replayOnlyWorkflowsJson,
          lease_seconds: { type: "integer", minimum: 120, maximum: 1800, default: 720 },
        },
        required: ["worker_id"],
        additionalProperties: false,
      },
      handler: (args) => store.claimNextReplay(args),
    }),
    createTool(store, {
      name: "heartbeat_replay",
      title: "Extend a REPLAY work lease",
      description: "Extends the existing REPLAY work-item lease without changing replay behavior.",
      annotations: { readOnlyHint: false },
      validator: heartbeatReplaySchema,
      inputSchema: {
        type: "object",
        properties: { ...deskWorkLeaseJson, lease_seconds: { type: "integer", minimum: 120, maximum: 1800, default: 720 } },
        required: ["work_item_id", "worker_id", "lease_token"],
        additionalProperties: false,
      },
      handler: (args) => store.heartbeatReplay(args),
    }),
    createTool(store, {
      name: "complete_replay",
      title: "Complete REPLAY work",
      description: "Completes the existing sequential REPLAY work item without changing its semantics.",
      annotations: { readOnlyHint: false },
      validator: completeReplaySchema,
      inputSchema: {
        type: "object",
        properties: { ...deskWorkLeaseJson, output_ref: { type: "object" }, telemetry: gptTelemetryJson },
        required: ["work_item_id", "worker_id", "lease_token"],
        additionalProperties: false,
      },
      handler: (args) => store.completeReplay(args),
    }),
    createTool(store, {
      name: "fail_replay",
      title: "Fail REPLAY work",
      description: "Records failure on the existing REPLAY work item without changing its retry semantics.",
      annotations: { readOnlyHint: false },
      validator: failReplaySchema,
      inputSchema: {
        type: "object",
        properties: {
          ...deskWorkLeaseJson,
          error_code: { type: "string", minLength: 2, maxLength: 120 },
          error_message: { type: "string", minLength: 1, maxLength: 2000 },
          retryable: { type: "boolean", default: true },
        },
        required: ["work_item_id", "worker_id", "lease_token", "error_code", "error_message"],
        additionalProperties: false,
      },
      handler: (args) => store.failReplay(args),
    }),
    createTool(store, {
      name: "get_desk_work_item",
      title: "Get one automated Desk work item",
      description: "Reads one exact Desk work item for audit or recovery without changing its lease.",
      annotations: { readOnlyHint: true },
      validator: deskWorkItemReadSchema,
      inputSchema: {
        type: "object",
        properties: { work_item_id: { type: "string", minLength: 3 } },
        required: ["work_item_id"],
        additionalProperties: false,
      },
      handler: (args) => store.getDeskWorkItem(args),
    }),
    createTool(store, {
      name: "peek_next_desk_work",
      title: "Peek automated Desk queue",
      description: "Shows eligible REPLAY work items for the cockpit without claiming them.",
      annotations: { readOnlyHint: true },
      validator: peekNextDeskWorkSchema,
      inputSchema: {
        type: "object",
        properties: {
          workflows: replayOnlyWorkflowsJson,
          backtest_id: { type: "string", minLength: 3 },
          automation_scope: { type: "string", enum: ["replay"] },
          trading_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          session: { type: "string", enum: ["asia_open", "ny_open"] },
          limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
          include_terminal: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
      handler: (args) => store.peekNextDeskWork(args),
    }),
    createTool(store, {
      name: "heartbeat_desk_work",
      title: "Extend a Desk work lease",
      description: "Unified lifecycle entry point. Extends a LIVE cursor lease or a REPLAY work-item lease from its claim handle.",
      annotations: { readOnlyHint: false },
      validator: heartbeatDeskWorkSchema,
      inputSchema: {
        type: "object",
        properties: {
          ...deskWorkLeaseJson,
          cursor_id: { type: "string", minLength: 3 },
          checkpoint: { type: "string", format: "date-time" },
          lease_seconds: { type: "integer", minimum: 120, maximum: 1800, default: 720 },
        },
        required: ["worker_id", "lease_token"],
        oneOf: [{ required: ["cursor_id", "checkpoint"] }, { required: ["work_item_id"] }],
        additionalProperties: false,
      },
      handler: (args) => args.cursor_id ? store.heartbeatLive(args) : store.heartbeatReplay(args),
    }),
    createTool(store, {
      name: "complete_desk_work",
      title: "Complete automated Desk work",
      description: "Unified lifecycle entry point. Verifies the materialized output and completes either LIVE cursor work or sequential REPLAY work.",
      annotations: { readOnlyHint: false },
      validator: completeDeskWorkSchema,
      inputSchema: {
        type: "object",
        properties: {
          ...deskWorkLeaseJson,
          cursor_id: { type: "string", minLength: 3 },
          checkpoint: { type: "string", format: "date-time" },
          output_ref: { type: "object" },
          telemetry: gptTelemetryJson,
        },
        required: ["worker_id", "lease_token"],
        oneOf: [{ required: ["cursor_id", "checkpoint"] }, { required: ["work_item_id"] }],
        additionalProperties: false,
      },
      handler: (args) => args.cursor_id ? store.completeLive(args) : store.completeReplay(args),
    }),
    createTool(store, {
      name: "fail_desk_work",
      title: "Fail automated Desk work",
      description: "Unified lifecycle entry point. Records a structured LIVE or REPLAY failure with the matching bounded retry policy.",
      annotations: { readOnlyHint: false },
      validator: failDeskWorkSchema,
      inputSchema: {
        type: "object",
        properties: {
          ...deskWorkLeaseJson,
          cursor_id: { type: "string", minLength: 3 },
          checkpoint: { type: "string", format: "date-time" },
          error_code: { type: "string", minLength: 2, maxLength: 120 },
          error_message: { type: "string", minLength: 1, maxLength: 2000 },
          error_class: { type: "string", enum: ["transient", "deterministic"] },
          retryable: { type: "boolean", default: true },
        },
        required: ["worker_id", "lease_token", "error_code", "error_message"],
        oneOf: [{ required: ["cursor_id", "checkpoint"] }, { required: ["work_item_id"] }],
        additionalProperties: false,
      },
      handler: (args) => args.cursor_id
        ? store.failLive({
          ...args,
          error_class: args.error_class || (args.retryable === false ? "deterministic" : "transient"),
        })
        : store.failReplay(args),
    }),
    createTool(store, {
      name: "upsert_replay_autopilot_config",
      title: "Create or update replay autopilot config",
      description: "Creates the operator-approved replay-day config used by GPT scheduled autopilot workers. It does not start analysis by itself.",
      annotations: { readOnlyHint: false },
      validator: upsertReplayAutopilotConfigSchema,
      inputSchema: {
        type: "object",
        properties: {
          config_id: { type: "string", minLength: 3 },
          enabled: { type: "boolean", default: true },
          status: { type: "string", enum: ["READY", "PAUSED", "ARCHIVED"], default: "READY" },
          backtest_id: { type: "string", minLength: 3 },
          strategy_id: { type: "string", enum: ["ny_open_1530", "asia_open"] },
          trading_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          session: { type: "string", enum: ["asia_open", "ny_open"] },
          pack_id: { type: "string", minLength: 3 },
          pack_build_id: { type: "string", minLength: 3 },
          cutoff_paris: { type: "string" },
          cutoff_utc: { type: "string", format: "date-time" },
          initial_cutoff: { type: "string" },
          start_time: { type: "string" },
          end_time: { type: "string" },
          cadence: { type: "string", enum: ["5m", "M5", "15m", "M15", "30m", "60m", "1h"], default: "15m" },
          timezone: { type: "string", const: "Europe/Paris", default: "Europe/Paris" },
          instruments: { type: "array", items: { type: "string", enum: ["MNQ", "MES", "NQ", "ES"] }, minItems: 1, maxItems: 4 },
          risk_model: { type: "string", default: "0.25pct_net_equity" },
          worker_group: { type: "string", minLength: 1, maxLength: 120, default: "default" },
          priority: { type: "integer", minimum: 1, maximum: 999, default: 100 },
          max_transitions: { type: "integer", minimum: 1, maximum: 12, default: 6 },
          notes: { type: "string", maxLength: 2000 },
        },
        required: ["trading_date", "session", "pack_id", "pack_build_id", "start_time", "end_time"],
        additionalProperties: true,
      },
      handler: (args) => store.upsertReplayAutopilotConfig(args),
    }),
    createTool(store, {
      name: "set_replay_autopilot_window",
      title: "Activate a replay autopilot date window",
      description: "Activates replay autopilot configs inside a date window for a worker group and optionally pauses configs outside the window.",
      annotations: { readOnlyHint: false },
      validator: setReplayAutopilotWindowSchema,
      inputSchema: {
        type: "object",
        properties: {
          worker_group: { type: "string", minLength: 1, maxLength: 120, default: "default" },
          session: { type: "string", enum: ["asia_open", "ny_open"] },
          date_from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          date_to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          pause_outside_window: { type: "boolean", default: true },
          include_archived: { type: "boolean", default: false },
          set_priority_by_date: { type: "boolean", default: true },
          priority_base: { type: "integer", minimum: 1, maximum: 999, default: 10 },
          priority_step: { type: "integer", minimum: 1, maximum: 100, default: 10 },
          dry_run: { type: "boolean", default: false },
          reason: { type: "string", maxLength: 1000 },
        },
        required: ["date_from", "date_to"],
        additionalProperties: false,
      },
      handler: (args) => store.setReplayAutopilotWindow(args),
    }),
    createTool(store, {
      name: "start_or_resume_replay_autopilot",
      title: "Start or resume GPT replay autopilot",
      description: "Idempotently creates/resumes the configured replay, drives deterministic backend transitions until the next GPT work item, and returns the work state. It never saves GPT analysis.",
      annotations: { readOnlyHint: false },
      validator: startOrResumeReplayAutopilotSchema,
      inputSchema: {
        type: "object",
        properties: {
          config_id: { type: "string", minLength: 3 },
          trading_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          session: { type: "string", enum: ["asia_open", "ny_open"] },
          mode: { type: "string", enum: ["latest_ready_config", "next_ready_config"] },
          worker_group: { type: "string", minLength: 1, maxLength: 120 },
          worker_id: deskWorkerIdJson,
          max_transitions: { type: "integer", minimum: 1, maximum: 12, default: 6 },
          recover_failed: { type: "boolean", default: true },
        },
        additionalProperties: false,
      },
      handler: (args) => store.startOrResumeReplayAutopilot(args),
    }),
    createTool(store, {
      name: "set_replay_automation",
      title: "Enable or pause replay automation",
      description: "Enables or pauses scheduled GPT automation for one replay without changing its analytical revision.",
      annotations: { readOnlyHint: false },
      validator: setReplayAutomationSchema,
      inputSchema: {
        type: "object",
        properties: {
          backtest_id: { type: "string", minLength: 3 },
          enabled: { type: "boolean" },
          reason: { type: "string", maxLength: 500 },
        },
        required: ["backtest_id", "enabled"],
        additionalProperties: false,
      },
      handler: (args) => store.setReplayAutomation(args),
    }),
    createTool(store, {
      name: "drive_replay_automation",
      title: "Drive deterministic replay transitions",
      description: "Runs only deterministic replay transitions such as prepare, advance, simulate and apply until the next GPT decision or terminal state.",
      annotations: { readOnlyHint: false },
      validator: driveReplayAutomationSchema,
      inputSchema: {
        type: "object",
        properties: {
          backtest_id: { type: "string", minLength: 3 },
          max_transitions: { type: "integer", minimum: 1, maximum: 12, default: 8 },
        },
        required: ["backtest_id"],
        additionalProperties: false,
      },
      handler: (args) => store.driveReplayAutomation(args),
    }),
    createTool(store, {
      name: "create_orchestrated_replay_day",
      title: "Create orchestrated GPT-in-the-loop replay day",
      description: "Starts an empty replay run scoped by backtest_id from an immutable source pack covering the full replay range. It creates no initial setups and waits for GPT to produce the Master at the replay cutoff.",
      annotations: { readOnlyHint: false },
      validator: createOrchestratedReplayDaySchema,
      inputSchema: createOrchestratedReplayDayInputSchema,
      handler: (args) => store.createOrchestratedReplayDay(args),
    }),
    createTool(store, {
      name: "prepare_replay_master_bundle",
      title: "Prepare replay Master bundle",
      description: "Builds a cutoff-scoped Master bundle for one orchestrated replay step without creating setups or decisions.",
      annotations: { readOnlyHint: false },
      validator: prepareReplayMasterBundleSchema,
      inputSchema: prepareReplayMasterBundleInputSchema,
      handler: (args) => store.prepareReplayMasterBundle(args),
    }),
    createTool(store, {
      name: "get_replay_master_bundle",
      title: "Get replay Master bundle",
      description: "Reads a replay-scoped Master bundle. Defaults to a lossless-access compact analytical view with a hash manifest; use deep replay tools for selected details.",
      annotations: { readOnlyHint: true },
      validator: getReplayBundleSchema,
      inputSchema: replayBundleReadInputSchema,
      handler: (args) => store.getReplayMasterBundle(args),
    }),
    createTool(store, {
      name: "save_replay_master_analysis",
      title: "Save replay Master V5.4 source",
      description: "Persists a native, unflattened Master V5.4 document in analysis_output, scoped by backtest, work item and lease. Historical versions are read-only.",
      annotations: { readOnlyHint: false },
      validator: saveReplayMasterAnalysisSchema,
      inputSchema: saveReplayMasterAnalysisInputSchema,
      handler: (args) => store.saveReplayMasterAnalysis(args),
    }),
    createTool(store, {
      name: "advance_replay_clock",
      title: "Advance orchestrated replay clock",
      description: "Advances the replay clock and creates the next monitor step only after the replay Master has been saved.",
      annotations: { readOnlyHint: false },
      validator: advanceReplayClockSchema,
      inputSchema: advanceReplayClockInputSchema,
      handler: (args) => store.advanceReplayClock(args),
    }),
    createTool(store, {
      name: "prepare_replay_monitor_bundle",
      title: "Prepare replay Monitor bundle",
      description: "Builds a monitor bundle from replay-scoped Master, thesis, setups, monitor and position data for one backtest_id.",
      annotations: { readOnlyHint: false },
      validator: prepareReplayMonitorBundleSchema,
      inputSchema: prepareReplayMonitorBundleInputSchema,
      handler: (args) => store.prepareReplayMonitorBundle(args),
    }),
    createTool(store, {
      name: "get_replay_monitor_bundle",
      title: "Get replay Monitor bundle",
      description: "Reads a replay-scoped Monitor bundle. Defaults to a compact analytical view with exact lineage, save target and section hashes.",
      annotations: { readOnlyHint: true },
      validator: getReplayBundleSchema,
      inputSchema: replayBundleReadInputSchema,
      handler: (args) => store.getReplayMonitorBundle(args),
    }),
    createTool(store, {
      name: "get_replay_bundle_manifest",
      title: "Get replay bundle manifest",
      description: "Returns replay-scoped section sizes, SHA-256 hashes and exact deep-read calls without loading the section payloads.",
      annotations: { readOnlyHint: true },
      validator: getReplayBundleManifestSchema,
      inputSchema: replayBundleManifestInputSchema,
      handler: (args) => store.getReplayBundleManifest(args),
    }),
    createTool(store, {
      name: "get_replay_bundle_section",
      title: "Get one replay bundle section",
      description: "Reads one exact section from the prepared bundle scoped by backtest_id, step_id and bundle_type, with pagination and a response budget.",
      annotations: { readOnlyHint: true },
      validator: getReplayBundleSectionSchema,
      inputSchema: replayBundleSectionInputSchema,
      handler: (args) => store.getReplayBundleSection(args),
    }),
    createTool(store, {
      name: "get_replay_snapshot",
      title: "Get replay rolling snapshot",
      description: "Reads one cutoff-scoped 15m, 1h or 4h replay snapshot and optionally filters its instruments without accessing live data.",
      annotations: { readOnlyHint: true },
      validator: getReplaySnapshotSchema,
      inputSchema: replaySnapshotInputSchema,
      handler: (args) => store.getReplaySnapshot(args),
    }),
    createTool(store, {
      name: "save_replay_monitor",
      title: "Save replay Monitor V2.4 source",
      description: "Persists a native, unflattened Monitor V2.4 document in monitor_output with its command, scoped by backtest, work item and lease. Historical versions are read-only.",
      annotations: { readOnlyHint: false },
      validator: saveReplayMonitorSchema,
      inputSchema: saveReplayMonitorInputSchema,
      handler: (args) => store.saveReplayMonitor(args),
    }),
    createTool(store, {
      name: "apply_replay_monitor_result",
      title: "Apply replay Monitor result",
      description: "Applies an already-saved replay monitor decision to replay-scoped thesis and simulated position state.",
      annotations: { readOnlyHint: false },
      validator: applyReplayMonitorResultSchema,
      inputSchema: orchestratedReplayMutationRefInputSchema,
      handler: (args) => store.applyReplayMonitorResult(args),
    }),
    createTool(store, {
      name: "simulate_replay_interval",
      title: "Simulate replay interval",
      description: "Simulates only the current replay interval up to to_timestamp and never beyond the step cutoff.",
      annotations: { readOnlyHint: false },
      validator: simulateReplayIntervalSchema,
      inputSchema: simulateReplayIntervalInputSchema,
      handler: (args) => store.simulateReplayInterval(args),
    }),
    createTool(store, {
      name: "get_replay_timeline",
      title: "Get orchestrated replay timeline",
      description: "Returns replay-scoped timeline events for one backtest_id.",
      annotations: { readOnlyHint: true },
      validator: getReplayTimelineSchema,
      inputSchema: getReplayTimelineInputSchema,
      handler: (args) => store.getReplayTimeline(args),
    }),
    createTool(store, {
      name: "create_backtest_run",
      title: "Create backtest run",
      description: "Creates a traceable backend backtest run and SIMULATE_TRADE steps from materialized desk_setups. It does not auto-run GPT.",
      annotations: { readOnlyHint: false },
      validator: createBacktestRunSchema,
      inputSchema: getToolInputSchema("create_backtest_run"),
      handler: (args) => store.createBacktestRun(args),
    }),
    createTool(store, {
      name: "get_backtest_run",
      title: "Get backtest run",
      description: "Reads one desk backtest run.",
      annotations: { readOnlyHint: true },
      validator: getBacktestRunSchema,
      inputSchema: getToolInputSchema("get_backtest_run"),
      handler: (args) => store.getBacktestRun(args),
    }),
    createTool(store, {
      name: "list_backtest_runs",
      title: "List backtest runs",
      description: "Lists desk backtest runs for replay state and audit.",
      annotations: { readOnlyHint: true },
      validator: listBacktestRunsSchema,
      inputSchema: getToolInputSchema("list_backtest_runs"),
      handler: (args) => store.listBacktestRuns(args),
    }),
    createTool(store, {
      name: "run_next_backtest_step",
      title: "Run next backtest step",
      description: "Runs the next queued backtest step and persists simulated trade/result evidence.",
      annotations: { readOnlyHint: false },
      validator: runNextBacktestStepSchema,
      inputSchema: getToolInputSchema("run_next_backtest_step"),
      handler: (args) => store.runNextBacktestStep(args),
    }),
    createTool(store, {
      name: "run_backtest_until_done",
      title: "Run backtest until done",
      description: "Runs queued backtest steps up to max_steps and finalizes result statistics.",
      annotations: { readOnlyHint: false },
      validator: runBacktestUntilDoneSchema,
      inputSchema: getToolInputSchema("run_backtest_until_done"),
      handler: (args) => store.runBacktestUntilDone(args),
    }),
    createTool(store, {
      name: "cancel_backtest_run",
      title: "Cancel backtest run",
      description: "Cancels a queued/running backtest run.",
      annotations: { readOnlyHint: false },
      validator: cancelBacktestRunSchema,
      inputSchema: getToolInputSchema("cancel_backtest_run"),
      handler: (args) => store.cancelBacktestRun(args),
    }),
    createTool(store, {
      name: "get_backtest_results",
      title: "Get backtest results",
      description: "Returns summary results and simulated trades for one backtest run.",
      annotations: { readOnlyHint: true },
      validator: getBacktestRunSchema,
      inputSchema: getToolInputSchema("get_backtest_results"),
      handler: (args) => store.getBacktestResults(args),
    }),
    createTool(store, {
      name: "get_backtest_timeline",
      title: "Get backtest timeline",
      description: "Returns persisted backtest steps for one run.",
      annotations: { readOnlyHint: true },
      validator: getBacktestRunSchema,
      inputSchema: getToolInputSchema("get_backtest_timeline"),
      handler: (args) => store.getBacktestTimeline(args),
    }),
    createTool(store, {
      name: "get_audit_state",
      title: "Get Audit front-ready state",
      description: "Returns contracts, data quality, deterministic feature state, jobs, raw refs, anti-lookahead status, and backend errors for the future Audit screen.",
      annotations: { readOnlyHint: true },
      validator: auditStateRequestSchema,
      inputSchema: getToolInputSchema("get_audit_state"),
      handler: (args) => store.getAuditState(args),
    }),
    createTool(store, {
      name: "run_feature_engine",
      title: "Run deterministic desk Feature Engine",
      description: "Computes deterministic level maps, technical events, session snapshots, condition status, and compatibility cross-asset summaries with raw refs and cutoff evidence. Autopilot V4 consumes cross-asset context directly from immutable packs and bundles. It never decides direction or risk.",
      annotations: { readOnlyHint: false },
      validator: runFeatureEngineSchema,
      inputSchema: getToolInputSchema("run_feature_engine"),
      handler: (args) => store.runFeatureEngine(args),
    }),
    createTool(store, {
      name: "get_active_thesis",
      title: "Get active thesis",
      description: "Returns the active thesis only inside one explicit execution scope.",
      annotations: { readOnlyHint: true },
      validator: z.object({
        ...operationalScopeFields,
        instrument: z.enum(DESK_INSTRUMENTS).optional(),
        master_id: z.string().min(3),
        status: z.enum(["active", "any"]).default("active"),
      }).superRefine(requireBacktestForReplay),
      inputSchema: {
        type: "object",
        properties: {
          ...operationalScopeJson,
          instrument: { type: "string", enum: DESK_INSTRUMENTS },
          master_id: { type: "string", minLength: 3 },
          status: { type: "string", enum: ["active", "any"], default: "active" },
        },
        required: [...operationalScopeRequired, "master_id"],
        additionalProperties: false,
      },
      handler: (args) => store.getActiveThesis(args),
    }),
    createTool(store, {
      name: "archive_expired_theses",
      title: "Archive expired active theses",
      description: "Marks active theses with valid_until older than now as EXPIRED so front-ready states never expose them as active.",
      annotations: { readOnlyHint: false },
      validator: archiveExpiredThesesSchema,
      inputSchema: getToolInputSchema("archive_expired_theses"),
      handler: (args) => store.archiveExpiredTheses(args),
    }),
    createTool(store, {
      name: "get_latest_master_analysis",
      title: "Get latest Master Analysis",
      description: "Returns the newest Master analysis at or before as_of_utc inside one explicit execution scope.",
      annotations: { readOnlyHint: true },
      validator: z.object({
        ...operationalScopeFields,
        instrument: z.enum(DESK_INSTRUMENTS).optional(),
      }).superRefine(requireBacktestForReplay),
      inputSchema: {
        type: "object",
        properties: {
          ...operationalScopeJson,
          instrument: { type: "string", enum: DESK_INSTRUMENTS },
        },
        required: operationalScopeRequired,
        additionalProperties: false,
      },
      handler: (args) => store.getLatestMasterAnalysis(args),
    }),
    createTool(store, {
      name: "get_latest_hourly_monitor",
      title: "Get latest hourly monitor",
      description: "Returns hourly monitors linked to one thesis and one explicit execution scope.",
      annotations: { readOnlyHint: true },
      validator: z.object({
        ...operationalScopeFields,
        thesis_id: z.string().min(3),
        master_id: z.string().min(3),
        limit: z.number().int().min(1).max(50).default(1),
      }).superRefine(requireBacktestForReplay),
      inputSchema: {
        type: "object",
        properties: {
          ...operationalScopeJson,
          thesis_id: { type: "string", minLength: 3 },
          master_id: { type: "string", minLength: 3 },
          limit: { type: "integer", minimum: 1, maximum: 50, default: 1 },
        },
        required: [...operationalScopeRequired, "thesis_id", "master_id"],
        additionalProperties: false,
      },
      handler: (args) => store.getLatestHourlyMonitor(args),
    }),
    createTool(store, {
      name: "get_level_map",
      title: "Get deterministic level map",
      description: "Returns deterministic support/resistance level maps once LevelMapEngine has populated desk_level_maps.",
      annotations: { readOnlyHint: true },
      validator: z.object({
        date: dateSchema,
        session: z.enum(["asia_open", "london_session", "ny_open", "work_forward"]).default("asia_open"),
        instrument: z.enum(TRADE_INSTRUMENTS),
      }),
      inputSchema: getToolInputSchema("get_level_map"),
      handler: (args) => store.getLevelMap(args),
    }),
    createTool(store, {
      name: "get_technical_events",
      title: "Get deterministic technical events",
      description: "Returns objective events such as breakout, rejection, sweep, reclaim once TechnicalEventEngine has populated desk_technical_events.",
      annotations: { readOnlyHint: true },
      validator: z.object({
        date: dateSchema,
        session: z.enum(["asia_open", "london_session", "ny_open", "work_forward"]).default("asia_open"),
        instrument: z.enum(TRADE_INSTRUMENTS),
        from: z.string().optional(),
        to: z.string().optional(),
        event_type: z.string().optional(),
      }),
      inputSchema: getToolInputSchema("get_technical_events"),
      handler: (args) => store.getTechnicalEvents(args),
    }),
    createTool(store, {
      name: "get_condition_status",
      title: "Get deterministic thesis condition status",
      description: "Returns objective WAIT->GO and invalidation status once ConditionEngine has populated desk_condition_status.",
      annotations: { readOnlyHint: true },
      validator: z.object({
        thesis_id: z.string().min(3),
        timestamp_paris: z.string().optional(),
      }),
      inputSchema: getToolInputSchema("get_condition_status"),
      handler: (args) => store.getConditionStatus(args),
    }),
    createTool(store, {
      name: "get_raw_window",
      title: "Get raw OHLC window for feature audit",
      description: "Returns a cutoff-bounded OHLC window; replay reads only the immutable pack build pinned to its run.",
      annotations: { readOnlyHint: true },
      validator: z.object({
        ...operationalScopeFields,
        timezone: z.literal("Europe/Paris").default("Europe/Paris"),
        pack_id: z.string().min(3),
        pack_build_id: z.string().min(3).optional(),
        instrument: z.enum(["MNQ", "MES", "NQ", "ES", "DXY", "VIX", "US10Y", "US02Y", "GC", "CL"]),
        timeframe: z.enum(["M5", "M15", "H1", "H4"]),
        from: z.string().datetime({ offset: true }),
        to: z.string().datetime({ offset: true }),
        max_rows: z.number().int().min(1).max(500).default(500),
      }).superRefine((value, ctx) => {
        requireBacktestForReplay(value, ctx);
        if (["replay", "backtest"].includes(value.mode) && !value.pack_build_id) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pack_build_id"], message: "SCOPE_REQUIRED:pack_build_id" });
        }
      }),
      inputSchema: {
        type: "object",
        properties: {
          ...operationalScopeJson,
          timezone: { type: "string", const: "Europe/Paris", default: "Europe/Paris" },
          pack_id: { type: "string", minLength: 3 },
          pack_build_id: { type: "string", minLength: 3 },
          instrument: { type: "string", enum: ["MNQ", "MES", "NQ", "ES", "DXY", "VIX", "US10Y", "US02Y", "GC", "CL"] },
          timeframe: { type: "string", enum: ["M5", "M15", "H1", "H4"] },
          from: { type: "string", format: "date-time" },
          to: { type: "string", format: "date-time" },
          max_rows: { type: "integer", minimum: 1, maximum: 500, default: 500 },
        },
        required: [...operationalScopeRequired, "pack_id", "instrument", "timeframe", "from", "to"],
        additionalProperties: false,
      },
      handler: (args) => store.getRawWindow(args),
    }),
    createTool(store, {
      name: "create_desk_job",
      title: "Create desk workflow job",
      description: "Creates a traceable desk workflow job for Master, Monitor, feature engine, replay/backtest, or audit workflows.",
      annotations: { readOnlyHint: false },
      validator: createDeskJobSchema,
      inputSchema: getToolInputSchema("create_desk_job"),
      handler: (args) => store.createDeskJob(args),
    }),
    createTool(store, {
      name: "get_desk_job",
      title: "Get desk workflow job",
      description: "Reads one desk workflow job by id.",
      annotations: { readOnlyHint: true },
      validator: getDeskJobSchema,
      inputSchema: getToolInputSchema("get_desk_job"),
      handler: (args) => store.getDeskJob(args),
    }),
    createTool(store, {
      name: "list_desk_jobs",
      title: "List desk workflow jobs",
      description: "Lists traceable desk workflow jobs for front workflow panels and audit.",
      annotations: { readOnlyHint: true },
      validator: listDeskJobsSchema,
      inputSchema: getToolInputSchema("list_desk_jobs"),
      handler: (args) => store.listDeskJobs(args),
    }),
    createTool(store, {
      name: "update_desk_job_status",
      title: "Update desk workflow job status",
      description: "Updates status/result/error metadata on a desk workflow job.",
      annotations: { readOnlyHint: false },
      validator: updateDeskJobStatusSchema,
      inputSchema: getToolInputSchema("update_desk_job_status"),
      handler: (args) => store.updateDeskJobStatus(args),
    }),
    createTool(store, {
      name: "cancel_desk_job",
      title: "Cancel desk workflow job",
      description: "Cancels a desk workflow job while preserving traceability for the future front and audit.",
      annotations: { readOnlyHint: false },
      validator: cancelDeskJobSchema,
      inputSchema: getToolInputSchema("cancel_desk_job"),
      handler: (args) => store.cancelDeskJob(args),
    }),
    createTool(store, {
      name: "save_contract",
      title: "Save desk contract",
      description: "Adds a versioned desk contract. Contracts are immutable by convention; create a new version for changes.",
      annotations: { readOnlyHint: false },
      validator: contractSchema,
      inputSchema: getToolInputSchema("save_contract"),
      handler: (args) => store.saveContract(args),
    }),
    createTool(store, {
      name: "activate_contract_version",
      title: "Activate desk contract version",
      description: "Activates a specific contract version and updates desk_contract_registry/active_contracts.",
      annotations: { readOnlyHint: false },
      validator: contractActivationSchema,
      inputSchema: getToolInputSchema("activate_contract_version"),
      handler: (args) => store.activateContractVersion(args),
    }),
    createTool(store, {
      name: "archive_contract_version",
      title: "Archive desk contract version",
      description: "Archives an older contract version without deleting it.",
      annotations: { readOnlyHint: false },
      validator: contractActivationSchema,
      inputSchema: getToolInputSchema("archive_contract_version"),
      handler: (args) => store.archiveContractVersion(args),
    }),
    createTool(store, {
      name: "save_desk_decision",
      title: "Save desk decision",
      description: "Use this only after the final desk decision is structured and the user/workflow allows writing it to the Desk database.",
      annotations: { readOnlyHint: false },
      validator: decisionSchema.and(liveWriterScopeSchema),
      inputSchema: liveWriterInputSchema("save_desk_decision"),
      handler: (args) => guardedLiveWrite(store, "save_desk_decision", args, () => store.saveDeskDecision(args)),
    }),
    createTool(store, {
      name: "save_desk_analysis",
      title: "Save desk analysis",
      description: "Use this at the end of a ChatGPT desk analysis to persist all candidate setups and the executable primary decision for replay and lifecycle tracking.",
      annotations: { readOnlyHint: false },
      validator: analysisSchema.and(liveWriterScopeSchema),
      inputSchema: liveWriterInputSchema("save_desk_analysis"),
      handler: (args) => {
        assertLiveWriterPayload("save_desk_analysis", args);
        assertAnalysisGatesPass(args);
        assertAnalysisSetupPass(args);
        assertAnalysisRiskPass(args);
        return store.saveDeskAnalysis(args);
      },
    }),
    createTool(store, {
      name: "save_desk_report",
      title: "Save desk report",
      description: "Use this to persist the final Markdown desk report that explains a ChatGPT-generated decision.",
      annotations: { readOnlyHint: false },
      validator: reportSchema,
      inputSchema: getToolInputSchema("save_desk_report"),
      handler: (args) => store.saveDeskReport(args),
    }),
    createTool(store, {
      name: "save_master_analysis",
      title: "Save Master Analysis V5.4 source",
      description: "Persists a native Master V5.4 source document in analysis_output without flattening it; work-item lease fields remain in the MCP envelope. Historical versions are read-only.",
      annotations: { readOnlyHint: false },
      validator: masterAnalysisSchema.and(liveWriterScopeSchema),
      inputSchema: saveMasterAnalysisVersionedInputSchema(),
      handler: (args) => guardedLiveWrite(store, "save_master_analysis", args, () => store.saveMasterAnalysis(args)),
    }),
    createTool(store, {
      name: "save_active_thesis",
      title: "Save active thesis",
      description: "Creates or replaces the living thesis produced by a Master Analysis.",
      annotations: { readOnlyHint: false },
      validator: activeThesisSchema.and(liveWriterScopeSchema),
      inputSchema: liveWriterInputSchema("save_active_thesis"),
      handler: async (args) => {
        assertLiveWriterPayload("save_active_thesis", args);
        assertActiveThesisSavePass(args);
        await assertLiveMasterParent(store, args, args.linked_master_analysis_id);
        return store.saveActiveThesis(args);
      },
    }),
    createTool(store, {
      name: "update_active_thesis",
      title: "Update active thesis",
      description: "Updates thesis status, health score, confidence, scenario, and latest monitor reference.",
      annotations: { readOnlyHint: false },
      validator: activeThesisUpdateSchema.and(liveWriterScopeSchema).and(z.object({ master_id: z.string().min(3) })),
      inputSchema: liveWriterInputSchema("update_active_thesis", { master_id: { type: "string", minLength: 3 } }, ["master_id"]),
      handler: async (args) => {
        assertLiveWriterPayload("update_active_thesis", args);
        const existing = await findActiveThesisById(store, args);
        assertActiveThesisUpdatePass(args, existing);
        return store.updateActiveThesis(args);
      },
    }),
    createTool(store, {
      name: "save_hourly_monitor",
      title: "Legacy hourly monitor writer disabled",
      description: "Historical DeskHourlyThesisMonitorContract documents remain readable, but legacy writers are disabled after the V5.4 cutover.",
      annotations: { readOnlyHint: false },
      validator: hourlyMonitorSchema.and(liveWriterScopeSchema),
      inputSchema: liveWriterInputSchema("save_hourly_monitor"),
      handler: async () => {
        throw codedToolError(
          "LEGACY_CONTRACT_WRITE_FORBIDDEN",
          "DeskHourlyThesisMonitorContract v1.0.0 is historical and cannot be produced by a new LIVE run.",
        );
      },
    }),
    createTool(store, {
      name: "save_manual_monitor",
      title: "Save GPT Monitor V2.4",
      description: "Persists a native Monitor V2.4 source document in monitor_output, retaining its native command and the MCP work-item lease envelope. Historical versions are read-only.",
      annotations: { readOnlyHint: false },
      validator: manualMonitorSchema.and(liveWriterScopeSchema),
      inputSchema: saveManualMonitorVersionedInputSchema(),
      handler: async (args) => {
        if (["replay", "backtest"].includes(args.mode)) {
          throw codedToolError("READ_ONLY_REPLAY_FORBIDDEN", "Use save_replay_monitor for replay/backtest writes.");
        }
        return guardedLiveWrite(store, "save_manual_monitor", args, async () => {
          if (args.linked_active_thesis_id || args.linked_master_analysis_id) {
            await assertLiveThesisParent(store, args, args.linked_active_thesis_id, args.linked_master_analysis_id);
          }
          return store.saveManualMonitor(args);
        });
      },
    }),
    createTool(store, {
      name: "save_monitor_alert",
      title: "Save monitor alert",
      description: "Persists an actionable alert created by an hourly monitor.",
      annotations: { readOnlyHint: false },
      validator: monitorAlertSchema.and(liveWriterScopeSchema),
      inputSchema: liveWriterInputSchema("save_monitor_alert"),
      handler: (args) => guardedLiveWrite(store, "save_monitor_alert", args, () => store.saveMonitorAlert(args)),
    }),
    createTool(store, {
      name: "save_context_transmission",
      title: "Save Master context transmission",
      description: "Persists the context transmitted from a Master Analysis to later monitors or sessions.",
      annotations: { readOnlyHint: false },
      validator: contextTransmissionSchema.and(liveWriterScopeSchema),
      inputSchema: liveWriterInputSchema("save_context_transmission"),
      handler: (args) => guardedLiveWrite(store, "save_context_transmission", args, () => store.saveContextTransmission(args)),
    }),
    createTool(store, {
      name: "save_monitor_context_transmission",
      title: "Save monitor context transmission",
      description: "Persists context transmitted from one monitor to the next monitor.",
      annotations: { readOnlyHint: false },
      validator: contextTransmissionSchema.and(liveWriterScopeSchema),
      inputSchema: liveWriterInputSchema("save_monitor_context_transmission"),
      handler: (args) => guardedLiveWrite(store, "save_monitor_context_transmission", args, () => store.saveMonitorContextTransmission(args)),
    }),
    createTool(store, {
      name: "update_position_management",
      title: "Update position management",
      description: "Creates or updates a position management record when monitor asks for BE, partial, reduction, exit, or cancellation.",
      annotations: { readOnlyHint: false },
      validator: positionManagementSchema.and(liveWriterScopeSchema),
      inputSchema: liveWriterInputSchema("update_position_management"),
      handler: (args) => guardedLiveWrite(store, "update_position_management", args, () => store.updatePositionManagement(args)),
    }),
    createTool(store, {
      name: "update_desk_decision_status",
      title: "Update desk decision status",
      description: "Use this after manual execution/review to mark a decision active, triggered, TP hit, stopped, expired, or archived.",
      annotations: { readOnlyHint: false },
      validator: decisionStatusSchema,
      inputSchema: getToolInputSchema("update_desk_decision_status"),
      handler: (args) => store.updateDeskDecisionStatus(args),
    }),
  ];
}

export function listDeskTools(tools) {
  return tools.map(({ call, validator, requiredScopes, ...definition }) => definition);
}

export async function callDeskTool(tools, name, args) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Tool ${name} not found`);
  }
  return tool.call(args || {});
}

export function getToolRequiredScopes(tools, name) {
  const tool = tools.find((candidate) => candidate.name === name);
  return tool?.requiredScopes || [];
}

function createTool(store, { validator, handler, textResult, ...definition }) {
  const readOnlyHint = definition.annotations?.readOnlyHint !== false;
  const annotations = {
    ...definition.annotations,
    readOnlyHint,
    destructiveHint: definition.annotations?.destructiveHint === true,
    openWorldHint: definition.annotations?.openWorldHint === true,
  };
  const requiredScopes = definition.requiredScopes ||
    (readOnlyHint ? ["desk.read"] : ["desk.write"]);
  return {
    ...definition,
    annotations,
    outputSchema: definition.outputSchema || { type: "object", additionalProperties: true },
    requiredScopes,
    securitySchemes: definition.securitySchemes || [{ type: "oauth2", scopes: requiredScopes }],
    validator,
    async call(rawArgs) {
      const started = Date.now();
      try {
        const args = validator.parse(rawArgs || {});
        const data = await handler(args);
        const text = typeof textResult === "function" ? textResult(data, args) : textResult;
        const transport = resultTransportMetrics(data, text ?? null);
        await safeLog(store, {
          tool_name: definition.name,
          status: "success",
          latency_ms: Date.now() - started,
          pack_id: args?.pack_id || data?.pack_id || null,
          decision_id: args?.decision_id || data?.decision_id || null,
          response_structured_bytes: transport.structured_bytes,
          response_content_bytes: transport.content_bytes,
          response_total_bytes: transport.total_payload_bytes,
          response_budget_bytes: Number(process.env.DESK_MCP_REPLAY_RESPONSE_BUDGET_BYTES || 180000),
          response_budget_exceeded: transport.structured_bytes > Number(process.env.DESK_MCP_REPLAY_RESPONSE_BUDGET_BYTES || 180000),
        });
        return toolResult(data, false, { "desk/transport": transport }, text);
      } catch (error) {
        const message = publicError(error);
        await safeLog(store, {
          tool_name: definition.name,
          status: "error",
          latency_ms: Date.now() - started,
          pack_id: rawArgs?.pack_id || null,
          decision_id: rawArgs?.decision_id || null,
          error: message,
        });
        return toolResult({
          ok: false,
          error: message,
          ...(error?.code ? { code: error.code } : {}),
          ...(error?.details && typeof error.details === "object" ? { details: error.details } : {}),
        }, true);
      }
    },
  };
}

function requirePinnedPackForReplay(value, ctx) {
  if (!["replay", "backtest"].includes(value.mode)) return;
  for (const field of ["pack_id", "pack_build_id", "as_of_utc"]) {
    if (!value[field]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `SCOPE_REQUIRED:${field}` });
    }
  }
}

function liveWriterInputSchema(toolName, extraProperties = {}, extraRequired = []) {
  return augmentLiveWriterInputSchema(getToolInputSchema(toolName), extraProperties, extraRequired);
}

function augmentLiveWriterInputSchema(baseSchema, extraProperties = {}, extraRequired = []) {
  const base = baseSchema || { type: "object", properties: {}, required: [] };
  const required = uniqueStrings([
    ...(Array.isArray(base.required) ? base.required : []),
    ...liveWriterRequired,
    ...extraRequired,
  ]);
  return {
    ...base,
    type: "object",
    properties: {
      ...(base.properties || {}),
      ...liveOperationalScopeJson,
      ...extraProperties,
    },
    required,
    additionalProperties: base.additionalProperties ?? false,
  };
}

function guardedLiveWrite(_store, toolName, args, writer) {
  assertLiveWriterPayload(toolName, args);
  return writer();
}

function assertLiveWriterPayload(toolName, args = {}) {
  if (["replay", "backtest"].includes(args.mode)) {
    throw codedToolError("REPLAY_WRITER_REQUIRED", `${toolName} cannot write replay/backtest data; use the replay-scoped writer.`);
  }
  const missing = ["strategy_id", "session", "mode", "trading_date", "run_id", "as_of_utc", "timezone"]
    .filter((field) => args[field] === undefined || args[field] === null || args[field] === "");
  if (missing.length) {
    throw codedToolError("SCOPE_REQUIRED", `${toolName} requires a complete live execution scope.`, { missing });
  }
  if (!["live", "paper"].includes(args.mode)) {
    throw codedToolError("INVALID_SCOPE", `${toolName} only accepts live or paper writes.`, { mode: args.mode });
  }
  if (args.backtest_id) {
    throw codedToolError("INVALID_SCOPE", `${toolName} cannot carry a backtest_id in live/paper mode.`, {
      backtest_id: args.backtest_id,
    });
  }
  const asOfMs = Date.parse(args.as_of_utc);
  if (!Number.isFinite(asOfMs)) {
    throw codedToolError("INVALID_SCOPE", `${toolName} requires a valid as_of_utc timestamp.`, {
      as_of_utc: args.as_of_utc,
    });
  }
  const explicitCutoffParis = args.cutoff_paris || args.timestamp_paris || args.created_at_paris || null;
  const cutoffParis = explicitCutoffParis || toParisIso(asOfMs);
  const cutoffMs = Date.parse(cutoffParis);
  if (!Number.isFinite(cutoffMs)) {
    throw codedToolError("TIMEZONE_INVALID", `${toolName} requires a Paris timestamp with an explicit offset.`, {
      cutoff_paris: cutoffParis,
    });
  }
  if (explicitCutoffParis && cutoffMs !== asOfMs) {
    throw codedToolError("INVALID_SCOPE", `${toolName} timestamp and as_of_utc must identify the same instant.`, {
      cutoff_paris: explicitCutoffParis,
      as_of_utc: args.as_of_utc,
    });
  }
  const scope = createDeskExecutionScope({
    strategy_id: args.strategy_id,
    session: args.session,
    mode: args.mode,
    trading_date: args.trading_date,
    timezone: args.timezone,
    cutoff_paris: cutoffParis,
    cutoff_utc: new Date(asOfMs).toISOString(),
    run_id: args.run_id,
  }, { requireRun: true });
  Object.assign(args, {
    date: args.date || args.trading_date,
    trading_date: args.trading_date,
    as_of_utc: new Date(asOfMs).toISOString(),
    cutoff_paris: scope.cutoff_paris,
    cutoff_utc: scope.cutoff_utc,
    resolved_scope: scope,
    scope_hash: scope.scope_hash,
  });
  return scope;
}

function codedToolError(code, message, details = {}) {
  const error = new Error(`${code}:${message}`);
  error.code = code;
  error.details = details;
  return error;
}

function featureFlagEnabled(name) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] || "").trim().toLowerCase());
}

async function assertLiveMasterParent(store, args, masterId = args.linked_master_analysis_id || args.master_id) {
  if (!masterId) {
    throw codedToolError("SCOPE_REQUIRED", "A linked Master id is required for this write.", { field: "master_id" });
  }
  const result = await store.getLatestMasterAnalysis({
    strategy_id: args.strategy_id,
    session: args.session,
    mode: args.mode,
    trading_date: args.trading_date,
    run_id: args.run_id,
    as_of_utc: args.as_of_utc,
    master_id: masterId,
  });
  if (!result.analysis || result.analysis.analysis_id !== masterId) {
    throw codedToolError("MASTER_SCOPE_MISMATCH", "Linked Master was not found in the exact live scope.", {
      master_id: masterId,
      resolved_scope: args.resolved_scope || null,
    });
  }
  return result.analysis;
}

async function assertLiveThesisParent(store, args, thesisId = args.linked_active_thesis_id || args.thesis_id, masterId = args.linked_master_analysis_id || args.master_id) {
  await assertLiveMasterParent(store, args, masterId);
  if (!thesisId) {
    throw codedToolError("SCOPE_REQUIRED", "A linked thesis id is required for this write.", { field: "thesis_id" });
  }
  const result = await store.getActiveThesis({
    strategy_id: args.strategy_id,
    session: args.session,
    mode: args.mode,
    trading_date: args.trading_date,
    run_id: args.run_id,
    as_of_utc: args.as_of_utc,
    master_id: masterId,
    status: "any",
  });
  const thesis = (result.theses || []).find((candidate) => candidate.thesis_id === thesisId) || null;
  if (!thesis) {
    throw codedToolError("THESIS_SCOPE_MISMATCH", "Linked thesis was not found in the exact live scope.", {
      thesis_id: thesisId,
      master_id: masterId,
      resolved_scope: args.resolved_scope || null,
    });
  }
  return thesis;
}

async function findActiveThesisById(store, args) {
  return assertLiveThesisParent(store, args, args.thesis_id, args.master_id || args.linked_master_analysis_id);
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.length > 0)));
}

async function safeLog(store, log) {
  try {
    await store.logTool(log);
  } catch {
    // Observability cannot be allowed to break tool calls.
  }
}
