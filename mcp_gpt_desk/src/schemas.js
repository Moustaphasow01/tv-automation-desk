import { z } from "zod";
import { enums } from "@tv-automation/desk-contracts";
import { evaluateAntiLookahead } from "@tv-automation/desk-domain";
export {
  claimNextLiveSchema,
  completeLiveSchema,
  failLiveSchema,
  heartbeatLiveSchema,
} from "./live-cursor-schemas.js";
export {
  claimNextReplaySchema,
  completeReplaySchema,
  failReplaySchema,
  heartbeatReplaySchema,
} from "./work-lifecycle-schemas.js";
export {
  claimNextDeskWorkSchema,
  completeDeskWorkSchema,
  failDeskWorkSchema,
  heartbeatDeskWorkSchema,
} from "./unified-work-schemas.js";

export const SESSION_VALUES = enums.SESSION_VALUES;
export const DECISION_SESSIONS = enums.DECISION_SESSIONS;
export const VNEXT_SESSIONS = enums.VNEXT_SESSIONS;
export const DESK_INSTRUMENTS = enums.DESK_INSTRUMENTS;
export const TRADE_INSTRUMENTS = enums.TRADE_INSTRUMENTS;
export const THESIS_STATUSES = enums.THESIS_STATUSES;
export const ANALYSIS_TYPES = enums.ANALYSIS_TYPES;
export const DATASETS = enums.DATASETS;

export const FRONT_STATE_MODES = ["live", "paper"];
export const JOB_TYPES = [
  "MASTER_ANALYSIS",
  "HOURLY_MONITOR",
  "M15_MONITOR_PREP",
  "MANUAL_MONITOR",
  "ORCHESTRATED_REPLAY",
  "REPLAY_MASTER_PREP",
  "REPLAY_MONITOR_PREP",
  "REPLAY_MONITOR_APPLY",
  "REPLAN",
  "FEATURE_ENGINE",
  "BACKTEST_RUN",
  "BACKTEST_STEP",
  "SIMULATE_TRADE",
  "AUDIT_CHECK",
];
export const JOB_STATUSES = [
  "QUEUED",
  "LOCKED",
  "COLLECTING_RAW",
  "COMPUTING_FEATURES",
  "BUILDING_BUNDLE",
  "READY",
  "DEGRADED",
  "STALE",
  "PREPARING_DATA",
  "READY_FOR_GPT",
  "RUNNING_GPT",
  "SAVING_RESULT",
  "DONE",
  "FAILED",
  "CANCELLED",
  "REQUIRES_MANUAL_RUN",
];

export const ORCHESTRATED_REPLAY_STATUSES = [
  "CREATED",
  "MASTER_DATA_PREPARING",
  "MASTER_DATA_READY",
  "WAITING_GPT_MASTER",
  "MASTER_RUNNING_MANUAL",
  "MASTER_SAVED",
  "MASTER_MATERIALIZED",
  "READY_FOR_NEXT_MONITOR",
  "ADVANCING_CLOCK",
  "MONITOR_DATA_PREPARING",
  "MONITOR_DATA_READY",
  "WAITING_GPT_MONITOR",
  "MONITOR_RUNNING_MANUAL",
  "MONITOR_SAVED",
  "MONITOR_APPLIED",
  "SIMULATION_UPDATED",
  "WAITING_NEXT_STEP",
  "REPLAN_REQUIRED",
  "DAY_END",
  "FAILED",
  "CANCELLED",
];

const levelRangeSchema = z.object({
  from: z.number(),
  to: z.number(),
});

const targetLevelSchema = z.union([z.number(), levelRangeSchema]);

const auditMacroActualSchema = z.object({
  event: z.string().min(1),
  importance: z.enum(["low", "medium", "high"]).optional(),
  scheduled_at_paris: z.string().optional(),
  published_at_paris: z.string().optional(),
}).strict();

const antiLookaheadIssueMap = {
  missing_or_invalid_decision_timestamp: {
    path: ["decision_timestamp_paris"],
    message: "decision_audit_invalid_timestamp",
  },
  missing_or_invalid_cutoff: {
    path: ["data_cutoff_paris"],
    message: "decision_audit_invalid_timestamp",
  },
  missing_or_invalid_available_data_until: {
    path: ["available_data_until"],
    message: "decision_audit_invalid_timestamp",
  },
  future_data_used: {
    path: ["future_data_used"],
    message: "decision_audit_future_data_used",
  },
  entry_sl_tp_not_frozen: {
    path: ["entry_sl_tp_frozen"],
    message: "decision_audit_entry_sl_tp_not_frozen",
  },
  data_after_cutoff: {
    path: ["available_data_until"],
    message: "decision_audit_available_data_after_cutoff",
  },
  cutoff_after_decision_timestamp: {
    path: ["data_cutoff_paris"],
    message: "decision_audit_cutoff_after_decision_timestamp",
  },
};

function addAntiLookaheadIssue(ctx, { path, message }) {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function addAntiLookaheadIssues(audit, ctx) {
  const result = evaluateAntiLookahead({ decisionAudit: audit });
  if (result.ok) return;

  for (const reason of result.reasons) {
    if (reason === "macro_actual_after_cutoff" || reason === "macro_actual_invalid_publish_time") continue;
    const issue = antiLookaheadIssueMap[reason];
    if (issue) addAntiLookaheadIssue(ctx, issue);
  }

  for (const violation of result.evidence.macro_actual_violations || []) {
    addAntiLookaheadIssue(ctx, {
      path: ["macro_actuals_visible", violation.index, "published_at_paris"],
      message: violation.reason === "macro_actual_after_cutoff"
        ? "decision_audit_visible_macro_after_cutoff"
        : "decision_audit_invalid_timestamp",
    });
  }
}

export const decisionAuditSchema = z.object({
  contract_name: z.literal("DeskDecisionAuditContract").default("DeskDecisionAuditContract"),
  schema_version: z.literal("1.0.0").default("1.0.0"),
  timezone: z.literal("Europe/Paris").default("Europe/Paris"),
  decision_timestamp_paris: z.string().min(1),
  data_cutoff_paris: z.string().min(1),
  available_data_until: z.string().min(1),
  future_data_used: z.boolean(),
  entry_sl_tp_frozen: z.boolean(),
  datasets_used: z.array(z.string().min(1)).min(1),
  macro_actuals_visible: z.array(auditMacroActualSchema),
  macro_actuals_blocked: z.array(auditMacroActualSchema),
  source_pack_id: z.string().min(1),
  simulation_id: z.string().nullable().optional(),
  mission_id: z.string().nullable().optional(),
  decision_id: z.string().min(1).optional(),
  thesis_id: z.string().min(1).optional(),
  decision_timestamp_utc: z.string().optional(),
  data_cutoff_utc: z.string().optional(),
  available_data_until_utc: z.string().optional(),
  entry_sl_tp_frozen_at_paris: z.string().optional(),
  notes: z.string().optional(),
}).strict().superRefine(addAntiLookaheadIssues);

const setupTypeSchema = z.enum([
  "buy_limit_pullback",
  "sell_limit_pullback",
  "buy_stop_breakout",
  "sell_stop_breakdown",
  "sell_stop_breakdown_retest",
  "buy_stop_breakout_retest",
  "wait",
  "wait_only",
  "no_trade",
  "management_only",
]);

export const setupSchema = z.object({
  setup_id: z.string().min(1),
  label: z.string().min(1),
  rank: z.number().int().min(1).optional(),
  priority: z.number().int().min(1).optional(),
  instrument: z.enum(["MNQ", "NQ", "MES", "ES", "WAIT"]),
  decision: z.enum(["prendre", "ne_pas_prendre", "wait", "gestion_seule"]).default("prendre"),
  direction: z.enum(["long", "short", "neutral", "wait"]),
  setup_type: setupTypeSchema,
  order_type: z.enum([
    "buy_limit",
    "sell_limit",
    "buy_stop",
    "sell_stop",
    "sell_stop_or_retest",
    "buy_stop_or_retest",
    "market",
    "conditional",
    "wait",
    "cancel",
  ]).optional(),
  status: z.enum(["active", "secondary", "inactive", "cancelled", "wait", "management_only"]).optional(),
  entry_zone: levelRangeSchema.optional(),
  entry_trigger: z.union([z.string(), z.record(z.any())]).optional(),
  stop_loss: z.number().optional(),
  take_profits: z.array(z.object({
    name: z.string().min(1),
    target: targetLevelSchema,
    condition: z.string().optional(),
    action: z.string().optional(),
  })).default([]),
  extension_target: targetLevelSchema.optional(),
  invalidation: z.union([z.string().min(1), z.record(z.any())]),
  risk_pct: z.number().min(0).max(10),
  confidence_pct: z.number().min(0).max(100),
  rr_minimum: z.number().min(0).optional(),
  reason: z.string().min(1),
  conditions: z.array(z.string()).default([]),
  management_rules: z.array(z.string()).default([]),
  management: z.record(z.any()).optional(),
  executable: z.boolean().default(false),
}).passthrough();

export const decisionSchema = z.object({
  decision_id: z.string().min(3).optional(),
  pack_id: z.string().min(3).optional(),
  report_id: z.string().min(3).optional(),
  analysis_id: z.string().min(3).optional(),
  created_at: z.string().optional(),
  session: z.enum(DECISION_SESSIONS),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.literal("Europe/Paris").default("Europe/Paris"),
  instrument: z.enum(["MNQ", "NQ", "MES", "ES", "WAIT"]),
  asset_class: z.literal("futures").default("futures"),
  decision: z.enum(["prendre", "ne_pas_prendre", "wait", "gestion_seule"]),
  direction: z.enum(["long", "short", "neutral", "wait"]),
  setup_id: z.string().min(1).optional(),
  setup_type: setupTypeSchema,
  order_type: z.string().optional(),
  confidence_pct: z.number().min(0).max(100),
  risk_pct: z.number().min(0).max(10),
  rr_minimum: z.number().min(0),
  entry_zone: z.object({ from: z.number(), to: z.number() }).optional(),
  entry_trigger: z.string().optional(),
  stop_loss: z.number().optional(),
  take_profits: z.object({
    tp1: targetLevelSchema.optional(),
    tp2: targetLevelSchema.optional(),
    tp3: targetLevelSchema.optional(),
  }).optional(),
  extension_target: targetLevelSchema.optional(),
  invalidation: z.string().min(1),
  action_now: z.string().optional(),
  no_trade_condition: z.string().optional(),
  management_rules: z.array(z.string()).default([]),
  time_rules: z.object({
    earliest_entry_time: z.string().optional(),
    latest_entry_time: z.string().optional(),
    reduce_before: z.string().optional(),
    flatten_before: z.string().optional(),
  }).default({}),
  macro_bias: z.string().default("unknown"),
  technical_bias: z.string().default("unknown"),
  cross_asset_bias: z.string().default("unknown"),
  reason_summary: z.string().min(1),
  detailed_reason: z.string().optional(),
  status: z.enum([
    "draft",
    "active",
    "triggered",
    "cancelled",
    "tp1_hit",
    "tp2_hit",
    "tp3_hit",
    "stopped",
    "expired",
    "archived",
  ]).default("draft"),
  decision_audit: decisionAuditSchema,
}).passthrough();

export const analysisSchema = z.object({
  schema_version: z.enum(["1.0.0", "1.1.0"]),
  contract_name: z.literal("DeskFuturesAnalysisContract"),
  analysis_id: z.string().min(3),
  created_at_paris: z.string().min(1),
  mode: z.enum(["live", "backtest", "replay", "paper"]).default("live"),
  analysis_type: z.enum(ANALYSIS_TYPES),
  pack_id: z.string().min(3),
  report_id: z.string().min(3).optional(),
  decision_id: z.string().min(3).optional(),
  created_at: z.string().optional(),
  session: z.enum(DECISION_SESSIONS),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.literal("Europe/Paris").default("Europe/Paris"),
  title: z.string().min(3),
  status: z.enum(["draft", "generated", "ready", "sent", "archived"]).default("ready"),
  scope: z.record(z.any()),
  source_pack: z.record(z.any()),
  executive_summary: z.object({
    summary: z.string().min(1),
    final_decision: z.enum(["prendre", "ne_pas_prendre", "wait", "gestion_seule"]),
    final_instrument: z.enum(["MNQ", "NQ", "MES", "ES", "WAIT"]),
    final_direction: z.enum(["long", "short", "neutral", "wait"]),
    primary_setup_id: z.string().min(1).optional(),
  }).passthrough(),
  context: z.record(z.any()),
  market_funnel: z.record(z.any()),
  levels: z.record(z.any()),
  strategic_brief: z.record(z.any()),
  decision_gates: z.record(z.any()),
  summary: z.string().min(1).optional(),
  primary_setup_id: z.string().min(1).optional(),
  final_decision: z.enum(["prendre", "ne_pas_prendre", "wait", "gestion_seule"]).optional(),
  final_instrument: z.enum(["MNQ", "NQ", "MES", "ES", "WAIT"]).optional(),
  final_direction: z.enum(["long", "short", "neutral", "wait"]).optional(),
  setups: z.array(setupSchema).min(1),
  executable_decision: decisionSchema,
  session_matrix: z.array(z.record(z.any())).min(1),
  authorized_windows_summary: z.array(z.record(z.any())).min(1),
  update_agenda: z.array(z.record(z.any())).min(1),
  risk_management: z.record(z.any()),
  monitoring_rules: z.record(z.any()),
  final_sections: z.object({
    decision_executable: z.string().min(1),
    regle_finale: z.string().min(1),
  }).passthrough(),
  markdown: z.string().optional(),
}).passthrough().transform((analysis) => ({
  ...analysis,
  summary: analysis.summary || analysis.executive_summary.summary,
  primary_setup_id: analysis.primary_setup_id || analysis.executive_summary.primary_setup_id,
  final_decision: analysis.final_decision || analysis.executive_summary.final_decision,
  final_instrument: analysis.final_instrument || analysis.executive_summary.final_instrument,
  final_direction: analysis.final_direction || analysis.executive_summary.final_direction,
}));

export const reportSchema = z.object({
  report_id: z.string().min(3).optional(),
  pack_id: z.string().min(3).optional(),
  decision_id: z.string().min(3).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  session: z.enum(DECISION_SESSIONS),
  timezone: z.literal("Europe/Paris").default("Europe/Paris"),
  title: z.string().min(3),
  markdown: z.string().min(1),
  summary: z.string().optional(),
  sections: z.record(z.any()).optional(),
  status: z.enum(["generated", "sent", "archived"]).default("generated"),
});

export const decisionStatusSchema = z.object({
  decision_id: z.string().min(3),
  status: decisionSchema.shape.status,
  note: z.string().optional(),
  updated_by: z.string().default("user"),
});

export const contractNameSchema = z.enum(["DeskMasterAnalysisContract", "DeskHourlyThesisMonitorContract", "DeskFrontProjectionContract"]);

export const contractSchema = z.object({
  contract_id: z.string().min(3).optional(),
  contract_name: contractNameSchema,
  schema_version: z.string().min(1),
  status: z.enum(["draft", "active", "archived"]).default("active"),
  content_markdown: z.string().min(1),
  schema_json: z.record(z.any()).default({}),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  hash: z.string().optional(),
  is_active: z.boolean().default(false),
  replaced_by: z.string().nullable().optional(),
  force: z.boolean().default(false),
}).passthrough();

const operationalStrategySchema = z.enum(["ny_open_1530", "asia_open"]);
const operationalSessionSchema = z.enum(["asia_open", "ny_open"]);
const liveOperationalScopeShape = {
  strategy_id: operationalStrategySchema,
  session: operationalSessionSchema,
  mode: z.enum(["live", "paper"]),
  trading_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  run_id: z.string().min(3),
  as_of_utc: z.string().datetime({ offset: true }),
  timezone: z.literal("Europe/Paris").default("Europe/Paris"),
};

function requireRegisteredStrategySession(value, ctx) {
  const expected = value.strategy_id === "ny_open_1530" ? "ny_open" : "asia_open";
  if (value.session !== expected) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["session"], message: "STRATEGY_SESSION_MISMATCH" });
  }
}

const manualMonitorBundleShape = {
  ...liveOperationalScopeShape,
  bundle_id: z.string().min(3).optional(),
  timestamp_paris: z.string().optional(),
  cadence: z.enum(["15m", "M15"]).default("15m"),
  master_id: z.string().min(3),
  pack_id: z.string().min(3).optional(),
  thesis_id: z.string().min(3),
  include_raw_refs: z.boolean().default(true),
};

export const manualMonitorBundleRequestSchema = z.object(manualMonitorBundleShape).superRefine(requireRegisteredStrategySession);

export const prepareM15MonitorBundleJobSchema = z.object({
  ...manualMonitorBundleShape,
  save: z.boolean().default(true),
  lock_ttl_seconds: z.number().int().min(30).max(1800).default(180),
  force_rebuild: z.boolean().default(false),
  enqueue_agent_work: z.boolean().default(true),
}).superRefine(requireRegisteredStrategySession);

const masterCutoffBundleShape = {
  ...liveOperationalScopeShape,
  cutoff_paris: z.string().min(1).optional(),
  instruments: z.array(z.enum(["MNQ", "MES", "NQ", "ES"])).min(1).max(4).default(["MNQ", "MES", "NQ", "ES"]),
  include_raw_refs: z.boolean().default(true),
};

export const masterCutoffBundleRequestSchema = z.object(masterCutoffBundleShape).superRefine(requireRegisteredStrategySession);

export const prepareMasterCutoffBundleJobSchema = z.object({
  ...masterCutoffBundleShape,
  save: z.boolean().default(true),
  lock_ttl_seconds: z.number().int().min(30).max(1800).default(180),
  force_rebuild: z.boolean().default(false),
  enqueue_agent_work: z.boolean().default(true),
}).superRefine(requireRegisteredStrategySession);

export const prepareDueLiveMasterBundleSchema = z.object({
  workflow: z.enum(["asia_open", "london_0800", "london_1130", "ny_open", "postevent_2030"]),
  trading_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cutoff_paris: z.string().optional(),
  as_of_utc: z.string().datetime({ offset: true }).optional(),
  run_id: z.string().min(3).optional(),
  mode: z.enum(["live", "paper"]).default("live"),
  instruments: z.array(z.enum(["MNQ", "MES", "NQ", "ES"])).min(1).max(4).default(["MNQ", "MES", "NQ", "ES"]),
  include_raw_refs: z.boolean().default(true),
  save: z.boolean().default(true),
  lock_ttl_seconds: z.number().int().min(30).max(1800).default(180),
  force_rebuild: z.boolean().default(false),
  enqueue_agent_work: z.boolean().default(true),
});

export const prepareDueLiveMonitorBundleSchema = z.object({
  session: z.enum(["asia_open", "ny_open"]),
  trading_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timestamp_paris: z.string().optional(),
  as_of_utc: z.string().datetime({ offset: true }).optional(),
  run_id: z.string().min(3).optional(),
  mode: z.enum(["live", "paper"]).default("live"),
  include_raw_refs: z.boolean().default(true),
  save: z.boolean().default(true),
  lock_ttl_seconds: z.number().int().min(30).max(1800).default(180),
  force_rebuild: z.boolean().default(false),
  enqueue_agent_work: z.boolean().default(true),
});

export const getMasterCutoffBundleSchema = z.object({
  ...masterCutoffBundleShape,
  bundle_id: z.string().min(3).optional(),
}).superRefine(requireRegisteredStrategySession);

export const replayMonitorBundlesSchema = z.object({
  session: z.enum(["asia_open", "london_session", "ny_open", "work_forward"]).default("asia_open"),
  mode: z.enum(["replay", "backtest"]).default("replay"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timestamps_paris: z.array(z.string().min(1)).min(1).max(96),
  cadence: z.enum(["15m", "M15"]).default("15m"),
  analysis_id: z.string().min(3).optional(),
  pack_id: z.string().min(3).optional(),
  thesis_id: z.string().min(3).optional(),
  save: z.boolean().default(true),
});

const manualMonitorStatusSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toUpperCase();
  return normalized === "READY" ? "SAVED" : normalized;
}, z.enum(["DRAFT", "SAVED", "REVIEWED", "ACTION_REQUIRED", "ARCHIVED"]));

const frontProjectionRecordSchema = z.record(z.any());

export const frontProjectionSchema = z.object({
  contractName: z.literal("DeskFrontProjectionContract"),
  schemaVersion: z.literal("1.0.0"),
  source: z.object({
    sourceType: z.enum(["MASTER", "MONITOR"]),
    sourceId: z.string().min(3),
    masterId: z.string().min(3),
    monitorId: z.string().min(3).nullable(),
    thesisId: z.string().min(3),
    strategyId: z.enum(["asia_open", "ny_open_1530"]),
    session: z.enum(["asia_open", "ny_open"]),
    mode: z.enum(["live", "paper"]),
    tradingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    runId: z.string().min(3),
    timestampParis: z.string().min(1),
    asOfUtc: z.string().datetime({ offset: true }),
    sequence: z.number().int().min(1),
    revision: z.number().int().min(1),
  }).strict(),
  status: z.object({
    deskStatus: z.string().min(1),
    decision: z.string().min(1),
    actionCode: z.string().min(1),
    alertLevel: z.enum(["info", "watch", "warning", "action", "critical", "positive"]),
    thesisStatus: z.string().min(1),
    setupStatus: z.string().min(1),
    positionStatus: z.string().min(1),
    confidencePct: z.number().min(0).max(100),
    healthScore: z.number().min(0).max(100),
    riskPct: z.number().min(0).max(100),
  }).strict(),
  briefs: z.object({
    headline: z.string(),
    oneLiner: z.string(),
    marketBrief: z.string(),
    thesisBrief: z.string(),
    deltaBrief: z.string(),
    whyNow: z.string(),
    actionNow: z.string(),
    nextFocus: z.string(),
  }).strict(),
  latestChange: z.object({
    stateTransition: z.object({ from: z.string(), to: z.string() }).strict(),
    scoreTransition: z.object({
      from: z.number().min(0).max(100),
      to: z.number().min(0).max(100),
      delta: z.number().min(-100).max(100),
    }).strict(),
    validatedElements: z.array(z.string()),
    weakenedElements: z.array(z.string()),
    invalidatedElements: z.array(z.string()),
  }).strict(),
  expectedVsRealized: z.array(z.object({
    label: z.string(),
    expected: z.string(),
    realized: z.string(),
    verdict: z.string(),
    impact: z.string(),
  }).strict()),
  conditions: z.object({
    go: z.array(frontProjectionRecordSchema),
    invalidations: z.array(frontProjectionRecordSchema),
  }).strict(),
  setup: frontProjectionRecordSchema,
  position: frontProjectionRecordSchema,
  marketContext: frontProjectionRecordSchema,
  timelineEvent: frontProjectionRecordSchema,
  drilldownRefs: z.record(z.string().nullable()),
}).strict().superRefine((projection, ctx) => {
  if (projection.source.sourceType === "MASTER" && projection.source.monitorId !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["source", "monitorId"], message: "FRONT_PROJECTION_MASTER_MONITOR_ID_FORBIDDEN" });
  }
  if (projection.source.sourceType === "MONITOR" && projection.source.monitorId === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["source", "monitorId"], message: "FRONT_PROJECTION_MONITOR_ID_REQUIRED" });
  }
  const score = projection.latestChange.scoreTransition;
  if (Math.abs((score.to - score.from) - score.delta) > 0.000001) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["latestChange", "scoreTransition", "delta"], message: "FRONT_PROJECTION_SCORE_DELTA_MISMATCH" });
  }
});

export const manualMonitorSchema = z.object({
  monitor_id: z.string().min(3).optional(),
  contract_name: z.literal("DeskHourlyThesisMonitorContract"),
  schema_version: z.literal("1.0.0"),
  contract_hash: z.string().min(1),
  bundle_id: z.string().min(3).optional(),
  linked_active_thesis_id: z.string().min(3).optional(),
  linked_master_analysis_id: z.string().min(3).optional(),
  analysis_id: z.string().min(3).optional(),
  pack_id: z.string().min(3).optional(),
  session: z.enum(["asia_open", "london_session", "ny_open", "work_forward"]).default("asia_open"),
  timestamp_paris: z.string().min(1),
  cadence: z.enum(["15m", "M15"]).default("15m"),
  mode: z.enum(["live", "paper", "replay", "backtest"]).default("live"),
  status: manualMonitorStatusSchema.default("SAVED"),
  monitor_decision: z.record(z.any()).default({}),
  thesis_update: z.record(z.any()).optional(),
  context_transmission: z.record(z.any()).optional(),
  alert: z.record(z.any()).optional(),
  raw_chatgpt_output: z.union([z.string(), z.record(z.any())]).optional(),
  operator_notes: z.string().optional(),
  front_projection: frontProjectionSchema.optional(),
  work_item_id: z.string().min(3).optional(),
  worker_id: z.string().min(3).optional(),
  lease_token: z.string().min(8).optional(),
}).passthrough();

export const createOrchestratedReplayDaySchema = z.object({
  backtest_id: z.string().min(3),
  replay_run_id: z.string().min(3).optional(),
  strategy_id: z.enum(["ny_open_1530", "asia_open"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  trading_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  session: z.enum(["asia_open", "ny_open"]),
  pack_id: z.string().min(3),
  pack_build_id: z.string().min(3),
  cutoff_paris: z.string().min(1),
  cutoff_utc: z.string().datetime({ offset: true }),
  start_time: z.string().min(1),
  end_time: z.string().min(1),
  cadence: z.enum(["15m", "M15", "30m", "60m", "1h"]).default("15m"),
  timezone: z.literal("Europe/Paris").default("Europe/Paris"),
  initial_cutoff: z.string().min(1).optional(),
  idempotency_key: z.string().min(3),
  instruments: z.array(z.enum(["MNQ", "MES", "NQ", "ES"])).min(1).max(4).default(["MNQ", "MES", "NQ", "ES"]),
  risk_model: z.string().default("0.5pct_fixed"),
  automation_enabled: z.boolean().default(true),
  automation_mode: z.literal("gpt_scheduled_task").default("gpt_scheduled_task"),
}).passthrough();

export const upsertReplayAutopilotConfigSchema = z.object({
  config_id: z.string().min(3).optional(),
  enabled: z.boolean().default(true),
  status: z.enum(["READY", "PAUSED", "ARCHIVED"]).default("READY"),
  backtest_id: z.string().min(3).optional(),
  strategy_id: z.enum(["ny_open_1530", "asia_open"]).optional(),
  trading_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  session: z.enum(["asia_open", "ny_open"]),
  pack_id: z.string().min(3),
  pack_build_id: z.string().min(3),
  cutoff_paris: z.string().min(1).optional(),
  cutoff_utc: z.string().datetime({ offset: true }).optional(),
  initial_cutoff: z.string().min(1).optional(),
  start_time: z.string().min(1),
  end_time: z.string().min(1),
  cadence: z.enum(["15m", "M15", "30m", "60m", "1h"]).default("60m"),
  timezone: z.literal("Europe/Paris").default("Europe/Paris"),
  instruments: z.array(z.enum(["MNQ", "MES", "NQ", "ES"])).min(1).max(4).default(["MNQ", "MES", "NQ", "ES"]),
  risk_model: z.string().default("0.5pct_fixed"),
  notes: z.string().max(2000).optional(),
}).passthrough();

export const startOrResumeReplayAutopilotSchema = z.object({
  config_id: z.string().min(3).optional(),
  trading_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  session: z.enum(["asia_open", "ny_open"]).optional(),
  mode: z.enum(["latest_ready_config"]).optional(),
  worker_id: z.string().min(3).max(120).default("gpt-replay-autopilot"),
  max_transitions: z.number().int().min(1).max(12).default(6),
  recover_failed: z.boolean().default(true),
}).strict().superRefine((value, ctx) => {
  if (value.config_id || value.mode === "latest_ready_config") return;
  if (value.trading_date && value.session) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["config_id"],
    message: "CONFIG_SELECTOR_REQUIRED: provide config_id, mode=latest_ready_config, or trading_date+session",
  });
});

const replayRefSchema = z.object({
  backtest_id: z.string().min(3),
  step_id: z.string().min(3),
}).passthrough();

const replayMutationRefSchema = replayRefSchema.extend({
  expected_revision: z.number().int().min(0),
  idempotency_key: z.string().min(3),
});

export const prepareReplayMasterBundleSchema = replayMutationRefSchema.extend({
  include_raw_refs: z.boolean().default(true),
  force_rebuild: z.boolean().default(false),
});

const replayBundleSectionSchema = z.enum([
  "contract",
  "save_target",
  "quality",
  "pack",
  "dataset_integrity",
  "macro_calendar",
  "news_digest",
  "rolling_snapshots",
  "replan_context",
  "replay_lineage",
  "raw_refs",
  "instructions",
]);

const replayBundleReadOptions = {
  bundle_type: z.enum(["master", "monitor"]).optional(),
  view: z.enum(["compact", "manifest", "full"]).default("compact"),
  include_sections: z.array(replayBundleSectionSchema).max(12).optional(),
  exclude_sections: z.array(replayBundleSectionSchema).max(12).optional(),
  snapshot_windows: z.array(z.enum(["15m", "1h", "4h"])).max(3).optional(),
  instruments: z.array(z.string().min(1)).max(30).optional(),
  include_raw_refs: z.boolean().default(false),
  max_response_bytes: z.number().int().min(16000).max(512000).optional(),
};

export const getReplayBundleSchema = replayRefSchema.extend(replayBundleReadOptions).superRefine((value, ctx) => {
  const excluded = new Set(value.exclude_sections || []);
  for (const section of value.include_sections || []) {
    if (excluded.has(section)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["exclude_sections"], message: `SECTION_INCLUDE_EXCLUDE_CONFLICT:${section}` });
    }
  }
});

export const getReplayBundleManifestSchema = replayRefSchema.extend({
  bundle_type: z.enum(["master", "monitor"]),
  max_response_bytes: z.number().int().min(16000).max(512000).optional(),
});

export const getReplayBundleSectionSchema = replayRefSchema.extend({
  bundle_type: z.enum(["master", "monitor"]),
  section: replayBundleSectionSchema,
  snapshot_windows: z.array(z.enum(["15m", "1h", "4h"])).max(3).optional(),
  instruments: z.array(z.string().min(1)).max(30).optional(),
  include_raw_refs: z.boolean().default(false),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(500).default(100),
  max_response_bytes: z.number().int().min(16000).max(512000).optional(),
});

export const getReplaySnapshotSchema = replayRefSchema.extend({
  bundle_type: z.enum(["master", "monitor"]),
  window: z.enum(["15m", "1h", "4h"]),
  instruments: z.array(z.string().min(1)).max(30).optional(),
  include_raw_refs: z.boolean().default(false),
  max_response_bytes: z.number().int().min(16000).max(512000).optional(),
});

export const saveReplayMasterAnalysisSchema = replayMutationRefSchema.extend({
  contract_name: z.literal("DeskMasterAnalysisContract"),
  schema_version: z.literal("4.0.0"),
  contract_hash: z.string().min(1),
  analysis_id: z.string().min(3),
  pack_build_id: z.string().min(3),
  monitor_ready_master: z.record(z.any()).optional(),
  full_analysis: z.record(z.any()).default({}),
  active_thesis: z.record(z.any()).optional(),
  setups: z.array(z.record(z.any())).default([]),
  context_transmission: z.record(z.any()).optional(),
  executable_decision: z.record(z.any()).optional(),
  final_sections: z.record(z.any()).optional(),
  raw_chatgpt_output: z.union([z.string(), z.record(z.any())]).optional(),
  work_item_id: z.string().min(3).optional(),
  worker_id: z.string().min(3).optional(),
  lease_token: z.string().min(8).optional(),
}).passthrough();

export const advanceReplayClockSchema = z.object({
  backtest_id: z.string().min(3),
  expected_revision: z.number().int().min(0),
  idempotency_key: z.string().min(3),
  minutes: z.number().int().min(1).max(240).default(15),
  force: z.boolean().default(false),
}).passthrough();

export const prepareReplayMonitorBundleSchema = replayMutationRefSchema.extend({
  timestamp_paris: z.string().optional(),
  include_raw_refs: z.boolean().default(true),
  force_rebuild: z.boolean().default(false),
});

export const saveReplayMonitorSchema = replayMutationRefSchema.extend({
  monitor_id: z.string().min(3),
  master_id: z.string().min(3),
  thesis_id: z.string().min(3),
  sequence: z.number().int().min(1),
  scheduled_for_utc: z.string().datetime({ offset: true }),
  as_of_utc: z.string().datetime({ offset: true }),
  pack_build_id: z.string().min(3),
  contract_name: z.literal("DeskHourlyThesisMonitorContract"),
  schema_version: z.literal("1.0.0"),
  contract_hash: z.string().min(1),
  timestamp_paris: z.string().optional(),
  cadence: z.enum(["15m", "M15", "30m", "60m", "1h"]).default("15m"),
  manual_triggered: z.boolean().default(true),
  triggered_by: z.string().default("user_chatgpt"),
  monitor_decision: z.record(z.any()).default({}),
  thesis_update: z.record(z.any()).optional(),
  thesis_health_score: z.union([z.number(), z.record(z.any())]).optional(),
  expected_vs_realized: z.record(z.any()).optional(),
  macro_update: z.record(z.any()).optional(),
  cross_asset_delta: z.record(z.any()).optional(),
  technical_delta: z.record(z.any()).optional(),
  wait_to_go_check: z.record(z.any()).optional(),
  invalidation_check: z.record(z.any()).optional(),
  weak_signals: z.array(z.union([z.string(), z.record(z.any())])).default([]),
  scenario_transformation_check: z.record(z.any()).optional(),
  position_check: z.record(z.any()).optional(),
  setup_transition: z.record(z.any()).optional(),
  setup_candidate: z.record(z.any()).optional(),
  armed_setup: z.record(z.any()).optional(),
  setup_state: z.record(z.any()).optional(),
  setup_transitions: z.array(z.record(z.any())).optional(),
  setup_candidates: z.array(z.record(z.any())).optional(),
  replay_cadence_recommendation: z.record(z.any()).optional(),
  next_checkpoints: z.array(z.union([z.string(), z.record(z.any())])).optional(),
  monitor_context_transmission: z.record(z.any()).optional(),
  final_sections: z.record(z.any()).optional(),
  raw_chatgpt_output: z.union([z.string(), z.record(z.any())]).optional(),
  work_item_id: z.string().min(3).optional(),
  worker_id: z.string().min(3).optional(),
  lease_token: z.string().min(8).optional(),
}).passthrough();

export const deskWorkItemReadSchema = z.object({
  work_item_id: z.string().min(3),
}).strict();

export const peekNextDeskWorkSchema = z.object({
  workflows: z.array(z.enum(["REPLAY_MASTER", "REPLAY_MONITOR"])).min(1).max(2).default(["REPLAY_MASTER", "REPLAY_MONITOR"]),
  backtest_id: z.string().min(3).optional(),
  automation_scope: z.literal("replay").optional(),
  trading_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  session: z.enum(["asia_open", "ny_open"]).optional(),
  limit: z.number().int().min(1).max(50).default(10),
  include_terminal: z.boolean().default(false),
}).strict();

export const setReplayAutomationSchema = z.object({
  backtest_id: z.string().min(3),
  enabled: z.boolean(),
  reason: z.string().max(500).optional(),
}).strict();

export const driveReplayAutomationSchema = z.object({
  backtest_id: z.string().min(3),
  max_transitions: z.number().int().min(1).max(12).default(8),
}).strict();

export const applyReplayMonitorResultSchema = replayMutationRefSchema;

export const simulateReplayIntervalSchema = z.object({
  backtest_id: z.string().min(3),
  step_id: z.string().min(3),
  expected_revision: z.number().int().min(0),
  idempotency_key: z.string().min(3),
  from_timestamp: z.string().optional(),
  to_timestamp: z.string().optional(),
}).passthrough();

export const getReplayTimelineSchema = z.object({
  backtest_id: z.string().min(3),
  limit: z.number().int().min(1).max(500).default(200),
});

export const contractLookupSchema = z.object({
  contract_name: contractNameSchema,
  schema_version: z.string().min(1),
});

export const contractListSchema = z.object({
  contract_name: contractNameSchema,
});

export const contractActivationSchema = z.object({
  contract_name: contractNameSchema,
  schema_version: z.string().min(1),
});

export const liveDeskStateRequestSchema = z.object(liveOperationalScopeShape).superRefine(requireRegisteredStrategySession);

export const frontMasterStateRequestSchema = z.object({
  ...liveOperationalScopeShape,
  cutoff_paris: z.string().optional(),
}).superRefine(requireRegisteredStrategySession);

export const frontMonitorStateRequestSchema = z.object({
  ...liveOperationalScopeShape,
  master_id: z.string().min(3),
  thesis_id: z.string().min(3),
  timestamp_paris: z.string().optional(),
}).superRefine(requireRegisteredStrategySession);

export const replayStateRequestSchema = z.object({
  backtest_id: z.string().min(3),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  session: z.enum(VNEXT_SESSIONS).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const createBacktestRunSchema = z.object({
  backtest_id: z.string().min(3).optional(),
  label: z.string().optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  session: z.enum(VNEXT_SESSIONS).default("asia_open"),
  instrument_mode: z.enum(["auto", "MNQ", "MES", "NQ", "ES"]).default("auto"),
  master_contract: z.string().default("4.0.0"),
  monitor_contract: z.string().default("1.0.0"),
  monitor_cadence: z.string().default("1h"),
  mode: z.enum(["backforward_strict", "setup_replay"]).default("backforward_strict"),
  risk_model: z.string().default("0.5pct_fixed"),
  limit: z.number().int().min(1).max(500).default(200),
});

export const getBacktestRunSchema = z.object({
  backtest_id: z.string().min(3),
});

export const listBacktestRunsSchema = z.object({
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  session: z.enum(VNEXT_SESSIONS).optional(),
  status: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(50),
});

export const runNextBacktestStepSchema = z.object({
  backtest_id: z.string().min(3),
  write_result: z.boolean().default(true),
});

export const runBacktestUntilDoneSchema = z.object({
  backtest_id: z.string().min(3),
  max_steps: z.number().int().min(1).max(500).default(100),
  write_result: z.boolean().default(true),
});

export const cancelBacktestRunSchema = z.object({
  backtest_id: z.string().min(3),
  reason: z.string().optional(),
});

export const runFeatureEngineSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  session: z.enum(VNEXT_SESSIONS).default("asia_open"),
  cutoff_paris: z.string().optional(),
  timezone: z.literal("Europe/Paris").default("Europe/Paris"),
  instruments: z.array(z.enum(["MNQ", "MES", "NQ", "ES"])).min(1).max(4).default(["MNQ", "MES"]),
  save: z.boolean().default(true),
});

export const auditStateRequestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  session: z.enum(VNEXT_SESSIONS).default("asia_open"),
  timezone: z.literal("Europe/Paris").default("Europe/Paris"),
});

export const nyOpenStrategyStateRequestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timezone: z.literal("Europe/Paris").default("Europe/Paris"),
  pricing_mode: z.enum(["conservative", "middle", "optimistic"]).default("conservative"),
});

export const prepareNyOpenMasterBundleSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cutoff_paris: z.string().optional(),
  save: z.boolean().default(true),
  force_rebuild: z.boolean().default(false),
});

export const strategyPerformanceRequestSchema = z.object({
  strategy_id: z.string().min(1).optional(),
  aggregate_across_strategies: z.boolean().default(false),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  pricing_mode: z.enum(["conservative", "middle", "optimistic"]).default("conservative"),
  instrument: z.enum(["MNQ", "MES", "NQ", "ES", "all"]).default("all"),
  direction: z.enum(["long", "short", "all"]).default("all"),
  setup_type: z.string().optional(),
  only_triggered_setups: z.boolean().default(false),
  only_closed_trades: z.boolean().default(false),
}).superRefine((value, ctx) => {
  if (!value.strategy_id && value.aggregate_across_strategies !== true) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["strategy_id"], message: "SCOPE_REQUIRED:strategy_id" });
  }
  if (value.strategy_id && value.aggregate_across_strategies === true) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["aggregate_across_strategies"], message: "INVALID_SCOPE:choose_strategy_or_aggregate" });
  }
});

export const strategyCalendarRequestSchema = z.object({
  strategy_id: z.string().min(1),
  pricing_mode: z.enum(["conservative", "middle", "optimistic"]).default("conservative"),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});

export const strategyDayDetailRequestSchema = z.object({
  strategy_id: z.string().min(1),
  pricing_mode: z.enum(["conservative", "middle", "optimistic"]).default("conservative"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const liveTimelineEventDetailRequestSchema = z.object({
  strategy_id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  event_id: z.string().min(3).max(500),
});

export const recomputeStrategyPerformanceSchema = z.object({
  strategy_id: z.string().default("ny_open_1530"),
  pricing_mode: z.enum(["conservative", "middle", "optimistic"]).default("conservative"),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const markNyOpenStrategyEventSchema = z.object({
  strategy_id: z.string().default("ny_open_1530"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  action: z.enum(["mark_setup_triggered", "mark_tp1", "mark_tp2", "mark_tp3", "mark_stopped", "mark_expired", "mark_cancelled", "replay_strict_setup"]),
  setup_id: z.string().optional(),
  trade_id: z.string().optional(),
  reason: z.string().optional(),
  performed_by: z.string().default("dashboard_operator"),
}).passthrough();

export const archiveExpiredThesesSchema = z.object({
  session: z.enum(VNEXT_SESSIONS).optional(),
  dry_run: z.boolean().default(false),
});

export const createDeskJobSchema = z.object({
  job_id: z.string().min(3).optional(),
  job_type: z.enum(JOB_TYPES),
  status: z.enum(JOB_STATUSES).default("QUEUED"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  session: z.enum(VNEXT_SESSIONS).default("asia_open"),
  mode: z.enum(["live", "paper", "replay", "backtest"]).default("live"),
  pack_id: z.string().optional(),
  bundle_id: z.string().optional(),
  contract_name: z.string().optional(),
  schema_version: z.string().optional(),
  contract_hash: z.string().optional(),
  result_ref: z.union([z.record(z.any()), z.string(), z.null()]).optional(),
  error: z.union([z.record(z.any()), z.string(), z.null()]).optional(),
  metadata: z.record(z.any()).default({}),
}).passthrough();

export const getDeskJobSchema = z.object({
  job_id: z.string().min(3),
});

export const listDeskJobsSchema = z.object({
  job_type: z.string().optional(),
  status: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  session: z.enum(VNEXT_SESSIONS).optional(),
  mode: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(50),
});

export const updateDeskJobStatusSchema = z.object({
  job_id: z.string().min(3),
  status: z.enum(JOB_STATUSES),
  result_ref: z.union([z.record(z.any()), z.string(), z.null()]).optional(),
  error: z.union([z.record(z.any()), z.string(), z.null()]).optional(),
  metadata: z.record(z.any()).optional(),
}).passthrough();

export const cancelDeskJobSchema = z.object({
  job_id: z.string().min(3),
  reason: z.string().optional(),
});

export const masterAnalysisSchema = z.object({
  analysis_id: z.string().min(3).optional(),
  contract_name: z.literal("DeskMasterAnalysisContract"),
  schema_version: z.literal("4.0.0"),
  contract_hash: z.string().min(1),
  pack_id: z.string().min(3),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  session: z.enum(VNEXT_SESSIONS),
  active_thesis_id: z.string().min(3).optional(),
  report_id: z.string().min(3).optional(),
  decision_id: z.string().min(3).optional(),
  status: z.enum(["ready", "archived"]).default("ready"),
  created_at_paris: z.string().min(1),
  full_analysis: z.record(z.any()),
  context_transmission: z.record(z.any()).optional(),
  decision_journal: z.record(z.any()).optional(),
  front_projection: frontProjectionSchema.optional(),
  work_item_id: z.string().min(3).optional(),
  worker_id: z.string().min(3).optional(),
  lease_token: z.string().min(8).optional(),
}).passthrough();

export const activeThesisSchema = z.object({
  thesis_id: z.string().min(3).optional(),
  linked_master_analysis_id: z.string().min(3),
  status: z.enum(THESIS_STATUSES),
  instrument: z.enum(DESK_INSTRUMENTS),
  direction: z.enum(["long", "short", "neutral", "wait"]),
  dominant_scenario: z.string().min(1),
  secondary_scenario: z.string().optional(),
  confidence_pct: z.number().min(0).max(100),
  health_score: z.number().min(0).max(100),
  valid_from: z.string().min(1),
  valid_until: z.string().optional(),
  setup_expiry_time: z.string().optional(),
  requires_replan_after: z.string().optional(),
  key_levels: z.array(z.any()).default([]),
  wait_to_go_conditions: z.array(z.any()).default([]),
  invalidation_conditions: z.array(z.any()).default([]),
  expected_path: z.record(z.any()).default({}),
  failure_path: z.record(z.any()).default({}),
  scenario_transformation_map: z.array(z.any()).default([]),
  monitoring_playbook: z.array(z.any()).default([]),
  last_monitor_id: z.string().optional(),
}).passthrough();

export const activeThesisUpdateSchema = z.object({
  thesis_id: z.string().min(3),
  status: z.enum(THESIS_STATUSES).optional(),
  health_score: z.number().min(0).max(100).optional(),
  confidence_pct: z.number().min(0).max(100).optional(),
  last_monitor_id: z.string().optional(),
  dominant_scenario: z.string().optional(),
  secondary_scenario: z.string().optional(),
  notes: z.string().optional(),
}).passthrough();

export const hourlyMonitorSchema = z.object({
  monitor_id: z.string().min(3).optional(),
  contract_name: z.literal("DeskHourlyThesisMonitorContract"),
  schema_version: z.literal("1.0.0"),
  contract_hash: z.string().min(1),
  timestamp_paris: z.string().min(1),
  linked_master_analysis_id: z.string().min(3),
  linked_active_thesis_id: z.string().min(3),
  linked_previous_monitor_id: z.string().optional(),
  monitor_decision: z.record(z.any()),
  thesis_health_score: z.record(z.any()),
  expected_vs_realized: z.array(z.any()).default([]),
  macro_update: z.record(z.any()).default({}),
  cross_asset_delta: z.record(z.any()).default({}),
  technical_delta: z.record(z.any()).default({}),
  wait_to_go_check: z.array(z.any()).default([]),
  invalidation_check: z.array(z.any()).default([]),
  weak_signals: z.array(z.any()).default([]),
  monitor_context_transmission: z.record(z.any()).default({}),
  front_projection: frontProjectionSchema.optional(),
}).passthrough();

export const monitorAlertSchema = z.object({
  alert_id: z.string().min(3).optional(),
  timestamp_paris: z.string().optional(),
  alert_level: z.enum(["info", "watch", "warning", "action", "critical"]),
  title: z.string().min(1),
  message: z.string().min(1),
  linked_monitor_id: z.string().optional(),
  linked_thesis_id: z.string().optional(),
  action_required: z.string().optional(),
  send_to_telegram: z.boolean().default(false),
}).passthrough();

export const contextTransmissionSchema = z.object({
  context_id: z.string().min(3).optional(),
  linked_analysis_id: z.string().optional(),
  linked_monitor_id: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  session: z.string().optional(),
}).passthrough();

export const positionManagementSchema = z.object({
  position_id: z.string().min(3).optional(),
  instrument: z.enum(TRADE_INSTRUMENTS).optional(),
  direction: z.enum(["long", "short"]).optional(),
  entry_price: z.number().optional(),
  stop_loss: z.number().optional(),
  take_profits: z.array(z.any()).default([]),
  risk_pct: z.number().min(0).max(10).optional(),
  status: z.enum(["active", "protected", "partial_taken", "closed", "cancelled"]).optional(),
  linked_thesis_id: z.string().optional(),
  linked_decision_id: z.string().optional(),
  management_action: z.enum(["create", "update", "break_even", "partial", "reduce", "exit", "cancel"]).default("update"),
  notes: z.string().optional(),
}).passthrough();


export function stableId(prefix, date = new Date()) {
  const stamp = date.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${prefix}_${stamp}`;
}
