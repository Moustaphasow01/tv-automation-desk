import { createHash } from "node:crypto";
import { DATASETS } from "./schemas.js";
import { SystemClock } from "@tv-automation/desk-time";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import {
  DAILY_RUN_SCOPE,
  dailyRunPhaseAt,
  dailyRunStrategyAt,
} from "./daily-run-model.js";
import {
  PREDICATE_EVENT_ROWS_INSTRUMENT_V1,
  createDeskExecutionScope,
  evaluatePositionRequestEligibility,
  setupConditionInstrumentsV1,
} from "@tv-automation/desk-domain";
import {
  canonicalizeReplayBundle,
  replayTransportContract,
} from "./replay-bundle-view.js";
import {
  buildReplayContinuityState,
  buildReplayEventCheckpoints,
  buildReplayPositionFromTriggeredSetup,
  canonicalReplaySetupConditionSource,
  evaluateReplaySetupConditions,
  evaluateReplayPositionOnRows,
  evaluateReplaySetupOnRows,
  normalizeReplayEntryMode,
  normalizeReplaySetupConditions,
  normalizeReplaySetupStatus,
  normalizeReplayTriggerScore,
  projectReplayActiveThesis,
  projectReplaySetupLifecycleAt,
  recommendReplayCadenceMinutes,
  selectActiveReplaySetups,
  selectOpenReplayPosition,
} from "./replay-continuity.js";
import {
  assertRuntimeContractMatrix,
  compactContract,
  contractContext,
  contractHandshake,
  contractHash,
  contractSavePayload,
} from "./desk-contract-service.js";
import { stableVNextId } from "./desk-ids.js";
import {
  compactPack,
  replaySourceCoverage,
} from "./desk-pack-service.js";
import { deskError } from "./desk-errors.js";
import { normalizeUtcIso } from "./desk-time-utils.js";
import {
  finalizeDeskDataQuality,
  normalizeDeskInstrumentScopes,
} from "./data-availability-policy.js";
import {
  assertReplaySourceCoverage,
  assertRunPackScope,
  compactTimestamp,
  dedupeBy,
  maxBy,
  numeric,
  offsetIso,
  parisOffsetForDate,
  rawWindowQuality,
  roundNumber,
} from "./desk-market-feature-algorithms.js";
import {
  deriveActiveThesisFromMaster,
  firstArray,
  hasReplayGeometry,
  stripUndefined,
} from "./desk-strategy-audit-algorithms.js";
import {
  applyPartialExitAtPrice,
  finalizePositionAtPrice,
  markPositionAtPrice,
} from "./position-continuity-engine.js";
import {
  ACTIVE_STRATEGY_RUNTIME_VERSIONS,
  assertActiveStrategyContractContext,
  assertActiveStrategyRuntimePins,
  assertActiveStrategySaveTarget,
} from "./strategy-runtime-versioning.js";
import { deriveCanonicalTimeframeFromClosedM1 } from "./canonical-market-resampler.js";

const COLLECTIONS = DESK_COLLECTIONS;

export function deskEnvironment() {
  return process.env.DESK_ENVIRONMENT || process.env.ENVIRONMENT || "prod";
}

export function pinReplaySources(run, pack, contracts, creationHash, tick) {
  assertActiveStrategyRuntimePins(run, { operation: "pin_replay_sources" });
  assertRuntimeContractMatrix(contracts, { operation: "pin_replay_sources" });
  if (!contracts?.master_contract || !contracts?.monitor_contract) {
    throw deskError("CONTRACT_MISMATCH", "Both active Master and Monitor contracts must be pinned when the replay is created.");
  }
  const sourceCoverage = replaySourceCoverage(pack);
  return {
    ...run,
    creation_request_hash: creationHash,
    source_manifest_hash: pack.source_manifest_hash || pack.manifest?.source_manifest_hash,
    pinned_contracts: {
      master_contract: compactContract(contracts.master_contract),
      monitor_contract: compactContract(contracts.monitor_contract),
      execution_policy_contract: compactContract(contracts.execution_policy_contract),
      execution_plan_contract: compactContract(contracts.execution_plan_contract),
      monitor_command_contract: compactContract(contracts.monitor_command_contract),
      condition_catalog_contract: compactContract(contracts.condition_catalog_contract),
    },
    contract_snapshot_ref: {
      master: contracts.master_contract.contract_id || null,
      monitor: contracts.monitor_contract.contract_id || null,
      execution_policy: contracts.execution_policy_contract.contract_id || null,
      execution_plan: contracts.execution_plan_contract.contract_id || null,
      monitor_command: contracts.monitor_command_contract.contract_id || null,
      condition_catalog: contracts.condition_catalog_contract.contract_id || null,
      pinned_at_utc: tick.utc,
    },
    source_pack_purpose: sourceCoverage.pack_purpose,
    source_coverage: sourceCoverage,
    sources_pinned: true,
  };
}

export function replayCreationResult(run, step, extra = {}) {
  return {
    ok: true,
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id,
    strategy_id: run.strategy_id,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    source_manifest_hash: run.source_manifest_hash,
    scope_hash: run.scope_hash,
    resolved_scope: run.resolved_scope,
    status: run.status,
    revision: Number(run.revision || 0),
    current_step_id: step?.step_id || run.current_step_id || null,
    current_replay_time: run.current_replay_time,
    setup_count: Number(run.setup_count || 0),
    replay_run: run,
    step: step || null,
    next_action: nextReplayAction(run.status),
    ...extra,
  };
}

export function buildOrchestratedReplayRunDoc(args, tick) {
  assertActiveStrategyRuntimePins(args, {
    operation: "create_orchestrated_replay",
    allowMissing: true,
  });
  const date = args.trading_date || args.date || args.date_from;
  const session = args.session;
  const strategy_id = args.strategy_id;
  const cutoff = normalizeReplayTimestamp(args.cutoff_paris || args.initial_cutoff || args.start_time, date);
  const cutoffUtc = args.cutoff_utc || normalizeUtcIso(cutoff);
  const endTime = normalizeReplayTimestamp(args.end_time, date);
  const backtest_id = args.backtest_id;
  const timezone = args.timezone || "Europe/Paris";
  const instrumentScopes = normalizeDeskInstrumentScopes(args);
  const scope = createDeskExecutionScope({
    strategy_id,
    session,
    mode: "replay",
    trading_date: date,
    timezone,
    cutoff_paris: cutoff,
    cutoff_utc: cutoffUtc,
    run_id: args.run_id || backtest_id,
    backtest_id,
    pack_id: args.pack_id,
    pack_build_id: args.pack_build_id,
  });
  return {
    replay_schema_version: "2.0.0",
    replay_execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
    position_engine_version: "3.0.0",
    condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
    execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
    monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
    condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
    deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
    strategy_profile: args.strategy_profile || "OPPORTUNITY_SEEKING_CONTROLLED",
    strategy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.strategy_version,
    autopilot_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.autopilot_version,
    backtest_id,
    replay_run_id: args.replay_run_id || backtest_id,
    run_id: args.run_id || backtest_id,
    strategy_id,
    trading_date: date,
    date,
    date_from: date,
    date_to: date,
    session,
    run_scope: args.run_scope || "session",
    phases: args.phases || [],
    current_phase: args.run_scope === DAILY_RUN_SCOPE ? dailyRunPhaseAt(cutoff) : session,
    phase_master_ids: {},
    pending_replan_reason: null,
    execution_id: args.execution_id || null,
    run_family_id: args.run_family_id || null,
    run_number: Number(args.run_number || 1),
    aggregate_role: args.aggregate_role || "primary",
    aggregate_eligible: args.aggregate_eligible !== false,
    result_eligible: false,
    result_certification_status: "PENDING",
    risk_policy: {
      max_daily_loss_r: Number(args.risk_policy?.max_daily_loss_r ?? 3),
      max_consecutive_losses: Number(args.risk_policy?.max_consecutive_losses ?? 3),
      cooldown_after_loss_minutes: Number(args.risk_policy?.cooldown_after_loss_minutes ?? 30),
      min_replan_interval_minutes: Number(args.risk_policy?.min_replan_interval_minutes ?? 60),
    },
    mode: "replay",
    replay_mode: "orchestrated_gpt_in_the_loop",
    automation_enabled: args.automation_enabled !== false,
    automation_mode: args.automation_mode || "gpt_scheduled_task",
    automation_status: args.automation_enabled === false ? "paused" : "running",
    allowed_agent_workflows: ["REPLAY_MASTER", "REPLAY_MONITOR"],
    current_work_item_id: null,
    last_completed_work_item_id: null,
    last_automation_error: null,
    cadence: normalizeMonitorCadence(args.cadence),
    monitor_cadence: normalizeMonitorCadence(args.cadence),
    timezone,
    cutoff_paris: scope.cutoff_paris,
    cutoff_utc: scope.cutoff_utc,
    pack_id: scope.pack_id,
    pack_build_id: scope.pack_build_id,
    resolved_scope: scope,
    scope_hash: scope.scope_hash,
    start_time: cutoff,
    end_time: endTime,
    initial_cutoff: cutoff,
    current_replay_time: cutoff,
    status: "MASTER_DATA_PREPARING",
    revision: 0,
    lease_owner: null,
    lease_expires_at: null,
    next_action: "prepare_replay_master_bundle",
    current_step_id: null,
    linked_master_analysis_id: null,
    active_replay_thesis_id: null,
    setup_count: 0,
    steps_total: 0,
    steps_done: 0,
    instruments: instrumentScopes.instruments,
    trading_instruments: instrumentScopes.trading_instruments,
    context_instruments: instrumentScopes.context_instruments,
    risk_model: args.risk_model || "0.25pct_net_equity",
    source_collection: COLLECTIONS.deskReplaySetups,
    source_setup_ids: [],
    gpt_in_the_loop: true,
    automatic_openai_api_decision: false,
    creation_idempotency_key: args.idempotency_key,
    creation_request_hash: hashObject(sourceHashPayload(args)),
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function normalizeReplayTimestamp(value, date) {
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text;
  if (/^\d{2}:\d{2}/.test(text)) return `${date}T${text.length === 5 ? `${text}:00` : text}${parisOffsetForDate(date)}`;
  return text;
}

export function buildReplayStepDoc(run, { sequence, step_type, status, timestamp_paris, previous_step_id } = {}, tick) {
  const resolvedTimestamp = timestamp_paris || run.current_replay_time;
  const phase = run.run_scope === DAILY_RUN_SCOPE ? dailyRunPhaseAt(resolvedTimestamp) : run.session;
  const step_id = `${run.backtest_id}__step__${String(sequence).padStart(4, "0")}__${String(step_type || "STEP").toLowerCase()}__${compactTimestamp(timestamp_paris || run.current_replay_time)}`;
  return {
    step_id,
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    trading_date: run.trading_date || run.date,
    resolved_scope: run.resolved_scope,
    scope_hash: run.scope_hash,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    sequence,
    step_type,
    task_type: step_type,
    job_type: step_type === "MASTER" ? "REPLAY_MASTER_PREP" : "REPLAY_MONITOR_PREP",
    status,
    mode: "replay",
    session: run.session,
    run_scope: run.run_scope || "session",
    phase,
    phase_strategy_id: run.run_scope === DAILY_RUN_SCOPE ? dailyRunStrategyAt(resolvedTimestamp) : run.strategy_id,
    date: run.date,
    timestamp_paris: timestamp_paris || run.current_replay_time,
    cutoff_paris: timestamp_paris || run.current_replay_time,
    as_of_utc: normalizeUtcIso(timestamp_paris || run.current_replay_time),
    previous_step_id: previous_step_id || null,
    previous_timestamp_paris: previous_step_id ? run.current_replay_time : null,
    anti_lookahead_compliant: false,
    validation_result: "pending",
    bundle_id: null,
    bundle_ref: null,
    input_ref: null,
    output_ref: null,
    raw_refs: [],
    source_hash: null,
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function patchReplayRun(run, patch, tick) {
  return {
    ...run,
    ...patch,
    next_action: nextReplayAction(patch.status || run.status),
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function patchReplayStep(step, patch, tick) {
  return {
    ...step,
    ...patch,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function resolveReplayStep(steps, run, stepId, expectedType) {
  const step = stepId
    ? (steps || []).find((item) => item.step_id === stepId)
    : (steps || []).find((item) => item.step_id === run.current_step_id) || (steps || []).at(-1);
  if (!step) throw new Error("replay_step_not_found");
  if (expectedType && step.step_type !== expectedType) {
    throw new Error(`replay_step_type_mismatch:${step.step_type || "unknown"}`);
  }
  return step;
}

export function resolveReplayMasterPreparation(steps, run, stepId, tick) {
  if (run.status !== "REPLAN_REQUIRED") {
    return {
      step: resolveReplayStep(steps, run, stepId, "MASTER"),
      is_replan: false,
      source_step: null,
    };
  }

  const sourceStep = stepId
    ? (steps || []).find((item) => item.step_id === stepId)
    : (steps || []).find((item) => item.step_id === run.current_step_id) || (steps || []).at(-1);
  if (!sourceStep) throw new Error("replay_replan_source_step_not_found");
  const sequence = Math.max(0, ...(steps || []).map((item) => Number(item.sequence) || 0)) + 1;
  const step = buildReplayStepDoc(run, {
    sequence,
    step_type: "MASTER",
    status: "MASTER_DATA_PREPARING",
    timestamp_paris: run.current_replay_time,
    previous_step_id: sourceStep.step_id,
  }, tick);
  return {
    step: {
      ...step,
      is_replan: true,
      replan_source_step_id: sourceStep.step_id,
      previous_master_analysis_id: run.linked_master_analysis_id || null,
    },
    is_replan: true,
    source_step: sourceStep,
  };
}

export function buildReplayReplanContext(run, preparation, docs = {}) {
  return {
    requested: true,
    reason: run.pending_replan_reason || docs.monitor?.monitor_decision?.action || docs.monitor?.monitor_decision?.decision || "REPLAN_REQUIRED",
    requested_at_paris: run.current_replay_time,
    source_step_id: preparation.source_step?.step_id || run.current_step_id || null,
    previous_master_analysis: docs.master || null,
    previous_active_thesis: docs.thesis || null,
    previous_setups: docs.setups || [],
    triggering_monitor: docs.monitor || null,
    current_position: docs.position || null,
    phase: preparation.step?.phase || run.current_phase || run.session,
  };
}

export function replayTimelineEvent(run, step, event, tick) {
  const event_id = scopedReplayChildId(run, "event", `${String(step?.sequence || 0).padStart(4, "0")}_${event.event_type}_${tick.utc}`);
  return {
    event_id,
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    trading_date: run.trading_date || run.date,
    resolved_scope: run.resolved_scope,
    scope_hash: run.scope_hash,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    step_id: step?.step_id || null,
    sequence: step?.sequence || null,
    mode: "replay",
    session: run.session,
    timestamp_paris: step?.timestamp_paris || run.current_replay_time || tick.paris,
    cutoff_paris: step?.cutoff_paris || step?.timestamp_paris || run.current_replay_time || tick.paris,
    time: step?.timestamp_paris || run.current_replay_time || tick.paris,
    phase: event.phase || event.event_type,
    run_phase: step?.phase || run.current_phase || run.session,
    action: event.action || event.event_type,
    event_type: event.event_type,
    event_rank: replayEventRank(event.event_type),
    status: event.status || run.status,
    note: event.note || "",
    ref: event.ref || null,
    anti_lookahead_compliant: event.anti_lookahead_compliant === true,
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
  };
}

export function nextReplayAction(status) {
  const map = {
    CREATED: "prepare_replay_master_bundle",
    MASTER_DATA_PREPARING: "prepare_replay_master_bundle",
    MASTER_DATA_READY: "copy_master_prompt_for_chatgpt",
    WAITING_GPT_MASTER: "copy_master_prompt_then_gpt_reads_bundle_and_saves_replay_master_analysis",
    MASTER_RUNNING_MANUAL: "save_replay_master_analysis",
    MASTER_SAVED: "materialize_replay_master",
    MASTER_MATERIALIZED: "advance_replay_clock",
    READY_FOR_NEXT_MONITOR: "advance_replay_clock",
    ADVANCING_CLOCK: "prepare_replay_monitor_bundle",
    MONITOR_DATA_PREPARING: "prepare_replay_monitor_bundle",
    MONITOR_DATA_READY: "copy_monitor_prompt_for_chatgpt",
    WAITING_GPT_MONITOR: "copy_monitor_prompt_then_gpt_reads_bundle_and_saves_replay_monitor",
    MONITOR_RUNNING_MANUAL: "save_replay_monitor",
    MONITOR_SAVED: "apply_replay_monitor_result",
    MONITOR_APPLIED: "apply_replay_monitor_result",
    SIMULATION_UPDATED: "advance_replay_clock",
    WAITING_NEXT_STEP: "advance_replay_clock",
    REPLAN_REQUIRED: "prepare_replay_master_bundle",
    WORK_FAILED_REQUIRES_OPERATOR: "inspect_failed_work_item_then_retry_or_cancel",
    DAY_END: "review_replay_report",
    COMPLETED: "review_replay_report",
    FAILED: "inspect_replay_error",
    CANCELLED: "start_new_replay",
  };
  return map[status] || "refresh_replay_state";
}

export function replayEventRank(eventType) {
  const ranks = {
    RUN_CREATED: 10,
    MASTER_BUNDLE_READY: 20,
    GPT_MASTER_SAVED: 30,
    CLOCK_ADVANCED: 40,
    MONITOR_BUNDLE_READY: 50,
    GPT_MONITOR_SAVED: 60,
    MONITOR_RESULT_APPLIED: 70,
    INTERVAL_SIMULATED: 80,
    REPLAY_CANCELLED: 90,
  };
  return ranks[eventType] || 999;
}

export async function buildReplayMasterBundle(store, run, step, args = {}, clock = new SystemClock(), replanContext = null) {
  assertActiveStrategyRuntimePins(run, { operation: "build_replay_master_bundle" });
  const tick = clock.now();
  const cutoff = step.cutoff_paris || step.timestamp_paris || run.current_replay_time;
  const date = run.date || String(cutoff).slice(0, 10);
  const session = run.session;
  const contracts = run.pinned_contracts || await store.getActiveContracts();
  const contract_context = contractContext(contracts, "master", { tick, pinnedForReplay: true, backtestId: run.backtest_id });
  assertActiveStrategyContractContext(contract_context, {
    workflow: "REPLAY_MASTER",
    operation: "build_replay_master_bundle",
  });
  const asOfUtc = normalizeUtcIso(cutoff);
  const pack = await store.getDeskPack({
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    mode: "replay",
  });
  const sourceCoverage = assertReplaySourceCoverage(run, pack, cutoff);
  const rolling = await buildPinnedReplaySnapshots(store, run, pack, cutoff, args.include_raw_refs !== false);
  const macro = pack.datasets?.macro_calendar
    ? await store.getMacroCalendar({ pack_id: run.pack_id, pack_build_id: run.pack_build_id, date, as_of_utc: asOfUtc, mode: "replay" })
    : { events: [], warning: "macro_calendar_not_available" };
  const news = pack.datasets?.news_digest
    ? await store.getNewsDigest({ pack_id: run.pack_id, pack_build_id: run.pack_build_id, date, session, as_of_utc: asOfUtc, mode: "replay" })
    : { items: [], warning: "news_digest_not_available" };
  const visibleMacro = macro.events || [];
  const visibleNews = news.items || [];
  const bundleId = replayBundleId(run, step, "master");
  const analysisId = scopedReplayChildId(run, "master", step.step_id);
  const planId = stableVNextId("plan", analysisId, "execution_plan_v1_2");
  const thesisId = stableVNextId("thesis", analysisId, "primary");
  const setupIdCandidates = [1, 2, 3, 4, 5].map((rank) => stableVNextId("setup", planId, `candidate_${rank}`));
    const base = {
    ok: true,
    bundle_id: bundleId,
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    trading_date: run.trading_date || run.date,
    resolved_scope: run.resolved_scope,
    scope_hash: run.scope_hash,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    source_manifest_hash: pack.source_manifest_hash || pack.manifest?.source_manifest_hash,
    step_id: step.step_id,
    replay_time: cutoff,
    timestamp_paris: cutoff,
    cutoff_paris: cutoff,
    mode: "replay",
    bundle_type: "master",
    session,
    run_scope: run.run_scope || "session",
    phase: step.phase || run.current_phase || session,
    phase_strategy_id: step.phase_strategy_id || run.strategy_id,
    phases: run.phases || [],
    date,
    timezone: run.timezone || "Europe/Paris",
    contract_name: "DeskReplayMasterBundleTransport",
    schema_version: "2.0.0",
    transport_contract: replayTransportContract("master"),
    contract_context,
    contract_output_identity: {
      analysis_id: analysisId,
      plan_id: planId,
      thesis_id: thesisId,
      setup_id_candidates: setupIdCandidates,
      authority: "BACKEND_PINNED",
    },
    contract_handshake: contractHandshake("replay_master", contract_context, {
      saveTool: "save_replay_master_analysis",
      backtestId: run.backtest_id,
    }),
    contracts: {
      master: contracts?.master_contract ? compactContract(contracts.master_contract) : null,
      monitor: contracts?.monitor_contract ? compactContract(contracts.monitor_contract) : null,
    },
    is_replan: Boolean(replanContext),
    replan_context: replanContext,
    previous_replay_master_analysis: replanContext?.previous_master_analysis || null,
    previous_replay_active_thesis: replanContext?.previous_active_thesis || null,
    previous_replay_setups: replanContext?.previous_setups || [],
    triggering_replay_monitor: replanContext?.triggering_monitor || null,
    replay_position: replanContext?.current_position || null,
    pack: compactPack(pack),
    data: {
      pack: compactPack(pack),
      dataset_integrity: rolling.integrity,
      macro_calendar: { ...macro, events: visibleMacro },
      news_digest: { ...news, items: visibleNews },
      market_availability: rolling.market_availability,
      rolling_snapshots: rolling.snapshots,
      rolling_15m_snapshot: rolling.snapshots["15m"] || null,
      rolling_1h_snapshot: rolling.snapshots["1h"] || null,
      rolling_4h_snapshot: rolling.snapshots["4h"] || null,
    },
    data_quality: replayBundleQuality({ pack, rolling, macro: visibleMacro, news: visibleNews, sourceCoverage }),
    anti_lookahead_policy: buildAntiLookaheadPolicy({
      cutoff,
      rolling,
      macro: visibleMacro,
      news: visibleNews,
    }),
    raw_refs: args.include_raw_refs === false ? [] : rolling.raw_refs,
    chatgpt_replay_instructions: {
      required_mode: replanContext ? "manual_gpt_master_replan_replay" : "manual_gpt_master_replay",
      save_tool: "save_replay_master_analysis",
      required_payload_keys: String(contract_context.schema_version) === ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract
        ? ["backtest_id", "step_id", "expected_revision", "idempotency_key", "pack_build_id", "contract_name", "schema_version", "contract_hash", "analysis_id", "analysis_output"]
        : ["backtest_id", "step_id", "expected_revision", "idempotency_key", "pack_build_id", "contract_name", "schema_version", "contract_hash", "analysis_id", "full_analysis", "active_thesis", "setups"],
      contract_handshake: contractHandshake("replay_master", contract_context, {
        saveTool: "save_replay_master_analysis",
        backtestId: run.backtest_id,
      }),
      decision_boundary: replanContext
        ? "Backend prepared a new cutoff-scoped Master step. GPT must replan this backtest_id from the prior Master, thesis, triggering Monitor, current position, and newly visible data."
        : "Backend prepares data only. GPT creates the Master inside this backtest_id.",
      execution_plan_rule: "Master V5.4 proposes zero to five distinct ranked candidates in Execution Plan V1.4. Executable logic uses only Catalog V1.2 enums and typed parameters; prose is audit-only. The backend compiles and hashes it; GPT cannot size contracts, trigger, fill or create a position.",
      opportunity_profile: "OPPORTUNITY_SEEKING_CONTROLLED: up to 3 ranked candidates, contextual score 0.55, requested risk >0 and <=0.25 percent of NET_EQUITY, mandatory stop and RR>=2; optional contextual gaps are soft.",
      risk_rounding_rule: "The broker alone computes integer contracts with ceil rounding and blocks submission beyond max_rounding_excess_pct.",
      soft_effect_rule: "REQUIRE_CONFIRMATION requires an explicit Catalog V1.2 condition. REDUCE_RISK requires a lower execution_plan.risk.risk_pct_requested before compilation; otherwise it remains advisory, never an implicit veto.",
      gate_phase_rule: "Hard gates block only at their phase. Required EVENT_BLACKOUT without decidable evidence remains UNKNOWN and blocks ENTRY_TRIGGER only.",
      memory_rule: "Temporary VETO conditions use LATEST_ONLY, clear when false and require fresh closed-M1 confirmation; only explicit structural INVALIDATION uses INVALIDATE_TERMINAL. BLOCK_IF_TRUE can never use LATCH_UNTIL_TRIGGER.",
      cadence_causality_rule: "Scheduled GPT analysis runs on M15 while the same LIVE/REPLAY deterministic engine replays every closed M1; critical lifecycle events remain explicit. Confirmation cannot fill same-bar and reacquisition must be re-evaluated.",
    },
    save_target: {
      tool: "save_replay_master_analysis",
      collection: COLLECTIONS.deskReplayMasterAnalyses,
      suggested_payload: {
        backtest_id: run.backtest_id,
        step_id: step.step_id,
        expected_revision: Number(run.revision || 0) + 1,
        idempotency_key: `save-master:${run.backtest_id}:${step.step_id}`,
        analysis_id: analysisId,
        plan_id: planId,
        thesis_id: thesisId,
        setup_id_candidates: setupIdCandidates,
        bundle_id: bundleId,
        pack_id: run.pack_id,
        trading_date: run.trading_date || run.date,
        session: run.session,
        replay_run_id: run.replay_run_id || run.backtest_id,
        timezone: run.timezone || "Europe/Paris",
        cutoff_paris: cutoff,
        pack_build_id: run.pack_build_id,
        ...replayStrategyArtifactVersions(run),
        position_engine_version: run.position_engine_version || "3.0.0",
        ...contractSavePayload(contract_context),
        mode: "replay",
      },
    },
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
  };
  return canonicalizeReplayBundle({ ...base, source_hash: hashObject(sourceHashPayload(base)) });
}

export async function buildReplayMonitorBundle(store, run, step, replayDocs, args = {}, clock = new SystemClock()) {
  assertActiveStrategyRuntimePins(run, { operation: "build_replay_monitor_bundle" });
  const tick = clock.now();
  const checkpoint = args.timestamp_paris || step.timestamp_paris || run.current_replay_time;
  const date = run.date || String(checkpoint).slice(0, 10);
  const session = run.session;
  const contracts = run.pinned_contracts || await store.getActiveContracts();
  const contract_context = contractContext(contracts, "monitor", { tick, pinnedForReplay: true, backtestId: run.backtest_id });
  assertActiveStrategyContractContext(contract_context, {
    workflow: "REPLAY_MONITOR",
    operation: "build_replay_monitor_bundle",
  });
  const master = replayDocs.master || null;
  const thesis = projectReplayActiveThesis(replayDocs.thesis || null, replayDocs.monitors || []);
  const setups = replayDocs.setups || [];
  const previousMonitor = (replayDocs.monitors || []).find((monitor) => monitor.step_id !== step.step_id) || null;
  const position = (replayDocs.positions || [])[0] || null;
  const bundleId = replayBundleId(run, step, "monitor");
  const monitorId = scopedReplayChildId(run, "monitor", step.step_id);
  const commandId = stableVNextId("monitor_command", monitorId, "v1_2");
  const commandExpectedRevision = Number(run.revision || 0) + 1;
  const planId = thesis?.plan_id
    || master?.analysis_output?.execution_plan?.plan_id
    || master?.deterministic_execution_plan?.plan_id
    || null;
  const existingSetupIds = setups
    .map((setup) => setup.setup_id || setup.setup_record_id)
    .filter(Boolean);
  const setupIdCandidates = [1, 2, 3, 4, 5].map((rank) => stableVNextId(
    "setup",
    planId || master?.analysis_id || run.backtest_id,
    `monitor_${step.sequence || 0}_${rank}`,
  ));
  const replayContinuity = buildReplayContinuityState({
    run,
    currentStep: step,
    activeThesis: thesis,
    setups,
    positions: replayDocs.positions || [],
    monitors: replayDocs.monitors || [],
  });
  const cadenceRecommendation = recommendReplayCadenceMinutes({
    run,
    activeThesis: thesis,
    setups,
    positions: replayDocs.positions || [],
    monitors: replayDocs.monitors || [],
  });
  const eventCheckpoints = buildReplayEventCheckpoints({
    activeThesis: thesis,
    latestMonitor: previousMonitor,
    run,
  });
  assertReplayLineage(run, { master, thesis, monitors: replayDocs.monitors || [], positions: replayDocs.positions || [] });
  const pack = await store.getDeskPack({
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    mode: "replay",
  });
  const sourceCoverage = assertReplaySourceCoverage(run, pack, checkpoint);
  const rolling = await buildPinnedReplaySnapshots(store, run, pack, checkpoint, args.include_raw_refs !== false);
    const base = {
    ok: true,
    bundle_id: bundleId,
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    trading_date: run.trading_date || run.date,
    resolved_scope: run.resolved_scope,
    scope_hash: run.scope_hash,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    source_manifest_hash: pack.source_manifest_hash || pack.manifest?.source_manifest_hash,
    step_id: step.step_id,
    timestamp_paris: checkpoint,
    cutoff_paris: checkpoint,
    cadence: run.cadence || "15m",
    mode: "replay",
    bundle_type: "monitor",
    contract_name: "DeskReplayMonitorBundleTransport",
    schema_version: "2.0.0",
    transport_contract: replayTransportContract("monitor"),
    session,
    run_scope: run.run_scope || "session",
    phase: step.phase || run.current_phase || session,
    phase_strategy_id: step.phase_strategy_id || run.strategy_id,
    phases: run.phases || [],
    date,
    timezone: run.timezone || "Europe/Paris",
    contract_context,
    contract_output_identity: {
      monitor_id: monitorId,
      command_id: commandId,
      expected_revision: commandExpectedRevision,
      plan_id: planId,
      thesis_id: thesis?.thesis_id || null,
      existing_setup_ids: existingSetupIds,
      setup_id_candidates: setupIdCandidates,
      authority: "BACKEND_PINNED",
    },
    contract_handshake: contractHandshake("replay_monitor", contract_context, {
      saveTool: "save_replay_monitor",
      backtestId: run.backtest_id,
    }),
    contracts: {
      master: contracts?.master_contract ? compactContract(contracts.master_contract) : null,
      monitor: contracts?.monitor_contract ? compactContract(contracts.monitor_contract) : null,
    },
    replay_master_analysis: master,
    replay_active_thesis: thesis,
    replay_setups: setups,
    replay_continuity: replayContinuity,
    active_setup: replayContinuity.active_setup,
    armed_setup: replayContinuity.armed_setup,
    recommended_replay_cadence: cadenceRecommendation,
    event_checkpoints: eventCheckpoints,
    previous_replay_monitor: previousMonitor,
    replay_position: position,
    rolling_snapshots: rolling.snapshots,
    market_availability: rolling.market_availability,
    rolling_15m_snapshot: rolling.snapshots["15m"] || null,
    rolling_1h_snapshot: rolling.snapshots["1h"] || null,
    rolling_4h_snapshot: rolling.snapshots["4h"] || null,
    dataset_integrity: rolling.integrity,
    macro_horizon: null,
    cross_asset_delta: null,
    level_test_events: [],
    technical_events: [],
    condition_status: null,
    data_quality: replayBundleQuality({ pack, rolling, thesis, master, sourceCoverage }),
    anti_lookahead_policy: buildAntiLookaheadPolicy({ cutoff: checkpoint, rolling }),
    raw_refs: args.include_raw_refs === false ? [] : rolling.raw_refs,
    chatgpt_replay_instructions: {
      required_mode: "manual_gpt_monitor_replay",
      save_tool: "save_replay_monitor",
      required_payload_keys: String(contract_context.schema_version) === ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract
        ? ["backtest_id", "step_id", "expected_revision", "idempotency_key", "monitor_id", "master_id", "thesis_id", "sequence", "scheduled_for_utc", "as_of_utc", "pack_build_id", "contract_name", "schema_version", "contract_hash", "monitor_output"]
        : ["backtest_id", "step_id", "expected_revision", "idempotency_key", "monitor_id", "master_id", "thesis_id", "sequence", "scheduled_for_utc", "as_of_utc", "pack_build_id", "contract_name", "schema_version", "contract_hash", "monitor_decision"],
      setup_continuity_contract: {
        note: "Monitor V2.4 emits one structured Monitor Command V1.4. Separate thesis, setup, position and replan intentions; use only Condition Catalog V1.2 enums and typed parameters. Prose is never executable.",
        backend_between_monitors: "The same LIVE/REPLAY deterministic engine evaluates structured conditions and position lifecycle on every closed M1 candle between scheduled GPT M15 checkpoints and explicit critical checkpoints. Confirmation cannot fill same-bar and reacquisition is re-evaluated.",
        opportunity_profile: "OPPORTUNITY_SEEKING_CONTROLLED preserves up to 3 ranked plan candidates with contextual score 0.55; optional missing context remains soft.",
        risk_rule: "Requested risk stays <=0.25 percent NET_EQUITY, stop mandatory, RR>=2. Broker-only integer ceil sizing is bounded by max_rounding_excess_pct.",
        soft_effect_rule: "REQUIRE_CONFIRMATION requires a Catalog V1.2 condition. REDUCE_RISK requires a replan with lower requested risk; without it the soft effect remains advisory.",
        event_gate_rule: "Required EVENT_BLACKOUT without decidable data remains UNKNOWN and blocks ENTRY_TRIGGER only.",
        memory_rule: "Temporary VETO=LATEST_ONLY then fresh M1 confirmation after clearing; structural INVALIDATION=INVALIDATE_TERMINAL; no BLOCK_IF_TRUE latch.",
        cas_rule: "Copy command_id, plan_id, monitor_id and expected_revision exactly; expected_revision is strict compare-and-swap.",
      },
      contract_handshake: contractHandshake("replay_monitor", contract_context, {
        saveTool: "save_replay_monitor",
        backtestId: run.backtest_id,
      }),
      decision_boundary: "GPT can only update this replay run; live thesis/monitors are not inputs.",
    },
    save_target: {
      tool: "save_replay_monitor",
      collection: COLLECTIONS.deskReplayMonitors,
      suggested_payload: {
        backtest_id: run.backtest_id,
        step_id: step.step_id,
        expected_revision: Number(run.revision || 0) + 1,
        idempotency_key: `save-monitor:${run.backtest_id}:${step.step_id}`,
        monitor_id: monitorId,
        command_id: commandId,
        plan_id: planId,
        existing_setup_ids: existingSetupIds,
        setup_id_candidates: setupIdCandidates,
        bundle_id: bundleId,
        pack_id: run.pack_id,
        trading_date: run.trading_date || run.date,
        session: run.session,
        replay_run_id: run.replay_run_id || run.backtest_id,
        timezone: run.timezone || "Europe/Paris",
        cutoff_paris: checkpoint,
        master_id: master?.analysis_id || null,
        thesis_id: thesis?.thesis_id || null,
        sequence: step.sequence,
        scheduled_for_utc: normalizeUtcIso(checkpoint),
        as_of_utc: normalizeUtcIso(checkpoint),
        pack_build_id: run.pack_build_id,
        ...replayStrategyArtifactVersions(run),
        position_engine_version: run.position_engine_version || "3.0.0",
        ...contractSavePayload(contract_context),
        timestamp_paris: checkpoint,
        cadence: run.cadence || "15m",
        manual_triggered: true,
        triggered_by: "user_chatgpt",
      },
    },
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
  };
  return canonicalizeReplayBundle({ ...base, source_hash: hashObject(sourceHashPayload(base)) });
}

function replayStrategyArtifactVersions(run = {}) {
  assertActiveStrategyRuntimePins(run, { operation: "build_replay_save_target" });
  return {
    replay_execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
    execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
    monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
    condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
    deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
    condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
  };
}

export function replayBundleId(run, step, type) {
  return scopedReplayChildId(run, "bundle", `${step.step_id}_${type}`);
}

export function scopedReplayChildId(run, type, value) {
  const existing = String(value || "").trim();
  if (existing.startsWith(`${run.backtest_id}__`)) return existing;
  return `${run.backtest_id}__${sanitizeId(type)}__${sanitizeId(existing || type)}`;
}

export function buildAntiLookaheadPolicy({ cutoff, rolling, macro = [], news = [] }) {
  const maxPrice = maxRollingTimestamp(rolling);
  return {
    cutoff_paris: cutoff,
    max_price_timestamp_used: maxPrice || null,
    max_macro_timestamp_used: maxTimestamp(macro, ["published_at_paris", "timestamp_paris", "time_paris", "scheduled_at_paris"]),
    max_news_timestamp_used: maxTimestamp(news, ["published_at_paris", "timestamp_paris", "created_at_paris", "time_paris"]),
    actual_j_jplus1_hidden: true,
    actual_j_jplus1_visibility_rule: "actuals_visible_when_published_lte_cutoff_else_hidden",
    macro_actuals_visible_until_cutoff: true,
    macro_actuals_after_cutoff_hidden: true,
    future_prices_used: Boolean(maxPrice && Date.parse(maxPrice) > Date.parse(cutoff)),
    future_news_used: false,
    compliant: !(maxPrice && Date.parse(maxPrice) > Date.parse(cutoff)),
  };
}

export function maxRollingTimestamp(rolling) {
  const values = [];
  for (const snapshot of Object.values(rolling?.snapshots || {})) {
    for (const instrument of Object.values(snapshot?.instruments || {})) {
      if (instrument?.last_timestamp_paris) values.push(instrument.last_timestamp_paris);
    }
  }
  return values.sort().at(-1) || null;
}

export function maxTimestamp(items, keys) {
  return (items || [])
    .map((item) => keys.map((key) => item?.[key]).find(Boolean))
    .filter(Boolean)
    .sort()
    .at(-1) || null;
}

export function replayBundleQuality({ pack, rolling, thesis, master, macro, news, sourceCoverage }) {
  const missing = [];
  const warnings = [];
  const stale = [];
  const informational = [];
  if (!pack) missing.push("desk_pack");
  if (thesis === null) missing.push("replay_active_thesis");
  if (master === null) missing.push("replay_master_analysis");
  if (Array.isArray(macro) && !macro.length) warnings.push("macro_calendar_empty_or_hidden_by_cutoff");
  if (Array.isArray(news) && !news.length) warnings.push("news_digest_empty_or_hidden_by_cutoff");
  for (const [window, snapshot] of Object.entries(rolling?.snapshots || {})) {
    if (snapshot?.data_quality?.missing_instruments?.length) {
      warnings.push(`rolling_${window}_missing:${snapshot.data_quality.missing_instruments.join(",")}`);
    }
    if (snapshot?.data_quality?.closed_instruments?.length) {
      informational.push(`rolling_${window}_market_closed:${snapshot.data_quality.closed_instruments.join(",")}`);
    }
    if (snapshot?.data_quality?.stale_context_instruments?.length) {
      stale.push(...snapshot.data_quality.stale_context_instruments.map((instrument) => `${window}:${instrument}`));
    }
  }
  const criticalMissing = (rolling?.snapshots?.["15m"]?.data_quality?.missing_instruments || [])
    .filter((instrument) => ["MNQ", "MES"].includes(instrument));
  if (criticalMissing.length) missing.push(`rolling_15m_critical_market_missing:${criticalMissing.join(",")}`);
  const integrityEntries = Object.values(rolling?.integrity || {});
  const integrityValid = integrityEntries.length > 0 && integrityEntries.every((item) => item?.valid === true);
  if (!integrityValid) missing.push("dataset_integrity");
  return finalizeDeskDataQuality({
    blockers: missing,
    missing,
    stale,
    warnings,
    informational,
    antiLookaheadCompliant: integrityValid,
    sourceCoverage: sourceCoverage || (pack ? replaySourceCoverage(pack) : null),
  });
}

export function assertReplayBundleExecutable(bundle) {
  if (bundle?.anti_lookahead_policy?.compliant !== true || bundle?.data_quality?.execution_allowed !== true) {
    throw deskError("PACK_BUILD_NOT_READY", "Replay bundle failed integrity or anti-lookahead validation.", {
      bundle_id: bundle?.bundle_id || null,
      data_quality: bundle?.data_quality || null,
      anti_lookahead_policy: bundle?.anti_lookahead_policy || null,
    });
  }
  const workflow = bundle?.bundle_type === "master" ? "REPLAY_MASTER" : "REPLAY_MONITOR";
  assertActiveStrategyContractContext(bundle?.contract_context, {
    workflow,
    operation: "assert_replay_bundle_executable",
  });
  assertActiveStrategySaveTarget(bundle?.save_target?.suggested_payload, {
    workflow,
    mode: "replay",
    operation: "assert_replay_bundle_executable",
  });
  return true;
}

export function assertReplayContractSave(run, args, type, step) {
  assertActiveStrategyRuntimePins(run, { operation: `save_replay_${type}` });
  assertActiveStrategySaveTarget(args, {
    workflow: type === "monitor" ? "REPLAY_MONITOR" : "REPLAY_MASTER",
    mode: "replay",
    operation: `save_replay_${type}`,
  });
  const expected = type === "monitor" ? run.pinned_contracts?.monitor_contract : run.pinned_contracts?.master_contract;
  if (!expected) throw deskError("CONTRACT_MISMATCH", `Pinned ${type} contract is missing from the replay run.`);
  const mismatches = [];
  for (const [field, actual, wanted] of [
    ["contract_name", args.contract_name, expected.contract_name],
    ["schema_version", args.schema_version, expected.schema_version],
    ["contract_hash", args.contract_hash, contractHash(expected)],
  ]) {
    if (actual !== wanted) mismatches.push({ field, expected: wanted || null, actual: actual || null });
  }
  if (args.pack_build_id && args.pack_build_id !== run.pack_build_id) {
    mismatches.push({ field: "pack_build_id", expected: run.pack_build_id, actual: args.pack_build_id });
  }
  if (mismatches.length) {
    throw deskError("CONTRACT_MISMATCH", "Save payload does not match the replay-pinned contract or pack build.", { mismatches });
  }
  const explicitId = type === "monitor" ? args.monitor_id : args.analysis_id;
  if (!explicitId || !String(explicitId).startsWith(`${run.backtest_id}__`)) {
    throw deskError("CROSS_SCOPE_REFERENCE", `${type}_id must be explicitly prefixed by backtest_id.`, {
      backtest_id: run.backtest_id,
      id: explicitId || null,
    });
  }
  if (type === "monitor") {
    if (args.master_id !== run.linked_master_analysis_id || args.thesis_id !== run.active_replay_thesis_id) {
      throw deskError("CROSS_SCOPE_REFERENCE", "Monitor parent IDs do not match the replay run.", {
        expected_master_id: run.linked_master_analysis_id || null,
        actual_master_id: args.master_id || null,
        expected_thesis_id: run.active_replay_thesis_id || null,
        actual_thesis_id: args.thesis_id || null,
      });
    }
    const stepAsOfUtc = normalizeUtcIso(step.cutoff_paris || step.timestamp_paris);
    if (Number(args.sequence) !== Number(step.sequence) || normalizeUtcIso(args.as_of_utc) !== stepAsOfUtc || normalizeUtcIso(args.scheduled_for_utc) !== stepAsOfUtc) {
      throw deskError("CLOCK_REGRESSION_FORBIDDEN", "Monitor sequence and timestamps must match the current replay step.", {
        expected_sequence: step.sequence,
        actual_sequence: args.sequence,
        expected_as_of_utc: stepAsOfUtc,
        actual_as_of_utc: args.as_of_utc,
        scheduled_for_utc: args.scheduled_for_utc,
      });
    }
  }
  return true;
}

export function normalizeReplayMasterAnalysis(args, run, step, tick) {
  const analysis_id = args.analysis_id;
  const full = {
    ...(args.full_analysis || {}),
    setups: firstArray(args.setups, args.full_analysis?.setups, args.full_analysis?.candidate_setups, args.full_analysis?.setup_candidates),
    no_setup_proof: args.no_setup_proof
      || args.full_analysis?.no_setup_proof
      || args.executable_decision?.no_setup_proof
      || null,
  };
  return {
    ...args,
    analysis_id,
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    trading_date: run.trading_date || run.date,
    resolved_scope: run.resolved_scope,
    scope_hash: run.scope_hash,
    step_id: step.step_id,
    mode: "replay",
    session: run.session,
    date: run.date,
    timestamp_paris: step.timestamp_paris,
    cutoff_paris: step.cutoff_paris || step.timestamp_paris,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    source_manifest_hash: run.source_manifest_hash,
    full_analysis: full,
    active_thesis: args.active_thesis || full.active_thesis || null,
    setups: full.setups || [],
    anti_lookahead_compliant: true,
    source_hash: hashObject(sourceHashPayload({ ...args, backtest_id: run.backtest_id, step_id: step.step_id })),
    saved_at: tick.utc,
    saved_at_utc: tick.utc,
    saved_at_paris: tick.paris,
    created_at: args.created_at ?? tick.utc,
    created_at_utc: args.created_at_utc ?? tick.utc,
    created_at_paris: args.created_at_paris ?? step.timestamp_paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function buildReplaySetupDocs(master, run, step, tick) {
  return buildMasterSetupDocs(master, { analysis_id: master.analysis_id }, tick).map((setup) => {
    const conditions = normalizeReplaySetupConditions(canonicalReplaySetupConditionSource(setup));
    const entryGeometry = canonicalSetupEntryGeometry(setup);
    const geometryReady = Boolean(
      ["long", "short"].includes(String(setup.direction || "").toLowerCase())
      && entryGeometry.execution_price !== null
      && finiteNumber(setup.stop_loss ?? setup.stop) !== null
      && finiteNumber(setup.take_profit_1 ?? setup.tp1 ?? setup.targets?.[0] ?? setup.take_profits?.[0]?.target) !== null,
    );
    const sourceStatus = String(setup.status || setup.lifecycle_status || setup.setup_status || "").toUpperCase();
    const explicitlyArmed = ["ACTIVE", "EXECUTABLE", "ARMED", "ARMED_CONDITIONAL"].includes(sourceStatus)
      || setup.executable === true;
    const status = explicitlyArmed
      ? geometryReady && conditions.length
        ? "ARMED_CONDITIONAL"
        : "PRE_ARMED"
      : normalizeReplaySetupStatus(sourceStatus);
    const backendCanTrigger = status === "ARMED_CONDITIONAL"
      && geometryReady
      && conditions.length > 0
      && setup.backend_can_trigger !== false;
    const triggerPolicy = {
      ...(setup.trigger_policy || {}),
      min_score: normalizeReplayTriggerScore(setup.trigger_policy?.min_score, 0.65),
      allow_entry_only: false,
      allow_same_bar_entry: false,
      backend_can_trigger: backendCanTrigger,
    };
    return {
      ...setup,
      setup_record_id: scopedReplayChildId(run, "setup", setup.setup_id || setup.setup_record_id),
      backtest_id: run.backtest_id,
      replay_run_id: run.replay_run_id || run.backtest_id,
      strategy_id: run.strategy_id,
      trading_date: run.trading_date || run.date,
      resolved_scope: run.resolved_scope,
      scope_hash: run.scope_hash,
      pack_id: run.pack_id,
      pack_build_id: run.pack_build_id,
      source_manifest_hash: run.source_manifest_hash,
      step_id: step.step_id,
      mode: "replay",
      status,
      lifecycle_status: status,
      setup_status: status,
      entry_mode: normalizeReplayEntryMode(setup.entry_mode, setup),
      conditions,
      trigger_policy: triggerPolicy,
      management_policy: {
        ...(setup.management_policy || setup.management || {}),
        break_even_at_r: finiteNumber(
          setup.management_policy?.break_even_at_r
            ?? setup.management?.break_even_at_r,
        ) ?? 0.7,
      },
      condition_summary: evaluateReplaySetupConditions(conditions, triggerPolicy),
      backend_can_trigger: backendCanTrigger,
      execution_geometry_ready: geometryReady,
      source_analysis_collection: COLLECTIONS.deskReplayMasterAnalyses,
      source_collection: COLLECTIONS.deskReplaySetups,
      anti_lookahead_compliant: true,
    };
  });
}

export function normalizeReplayActiveThesis(thesis, master, run, step, tick) {
  if (!thesis) return null;
  const thesis_id = scopedReplayChildId(run, "thesis", thesis.thesis_id || master.analysis_id);
  return {
    ...thesis,
    thesis_id,
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    trading_date: run.trading_date || run.date,
    resolved_scope: run.resolved_scope,
    scope_hash: run.scope_hash,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    source_manifest_hash: run.source_manifest_hash,
    step_id: step.step_id,
    mode: "replay",
    session: run.session,
    date: run.date,
    timezone: run.timezone || "Europe/Paris",
    linked_master_analysis_id: master.analysis_id,
    status: thesis.status || "WAIT_MONITORED",
    anti_lookahead_compliant: true,
    created_at: thesis.created_at ?? tick.utc,
    created_at_utc: thesis.created_at_utc ?? tick.utc,
    created_at_paris: thesis.created_at_paris ?? step.timestamp_paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function normalizeReplayContextTransmission(context, run, step, links, tick) {
  const context_id = scopedReplayChildId(run, "context", context.context_id || `${step.step_id}_${links.linked_analysis_id || links.linked_monitor_id || "context"}`);
  return {
    ...context,
    ...links,
    context_id,
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    trading_date: run.trading_date || run.date,
    resolved_scope: run.resolved_scope,
    scope_hash: run.scope_hash,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    source_manifest_hash: run.source_manifest_hash,
    step_id: step.step_id,
    mode: "replay",
    session: run.session,
    timestamp_paris: step.timestamp_paris,
    cutoff_paris: step.cutoff_paris || step.timestamp_paris,
    anti_lookahead_compliant: true,
    created_at: context.created_at ?? tick.utc,
    created_at_utc: context.created_at_utc ?? tick.utc,
    created_at_paris: context.created_at_paris ?? tick.paris,
  };
}

export function assertReplayCanAdvance(run, args) {
  if (!run.linked_master_analysis_id && args.force !== true) {
    throw new Error("replay_master_required_before_advance");
  }
  if (["FAILED", "CANCELLED", "DAY_END"].includes(run.status)) {
    throw new Error(`replay_not_advanceable:${run.status}`);
  }
  const allowed = new Set(["READY_FOR_NEXT_MONITOR", "WAITING_NEXT_STEP", "SIMULATION_UPDATED", "MASTER_MATERIALIZED"]);
  if (!allowed.has(run.status) && args.force !== true) {
    throw new Error(`replay_step_not_ready_to_advance:${run.status}`);
  }
}

export function normalizeReplayMonitor(args, run, step, tick) {
  const monitor_id = args.monitor_id;
  return {
    ...args,
    monitor_id,
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    trading_date: run.trading_date || run.date,
    resolved_scope: run.resolved_scope,
    scope_hash: run.scope_hash,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    source_manifest_hash: run.source_manifest_hash,
    step_id: step.step_id,
    master_id: args.master_id,
    thesis_id: args.thesis_id,
    sequence: args.sequence,
    scheduled_for_utc: args.scheduled_for_utc,
    as_of_utc: args.as_of_utc,
    mode: "replay",
    session: run.session,
    timestamp_paris: args.timestamp_paris || step.timestamp_paris,
    cutoff_paris: step.cutoff_paris || step.timestamp_paris,
    cadence: normalizeMonitorCadence(args.cadence || run.cadence),
    manual_triggered: args.manual_triggered !== false,
    triggered_by: args.triggered_by || "user_chatgpt",
    monitor_decision: args.monitor_decision || {},
    anti_lookahead_compliant: true,
    source_hash: hashObject(sourceHashPayload({ ...args, backtest_id: run.backtest_id, step_id: step.step_id })),
    saved_at: tick.utc,
    saved_at_utc: tick.utc,
    saved_at_paris: tick.paris,
    created_at: args.created_at ?? tick.utc,
    created_at_utc: args.created_at_utc ?? tick.utc,
    created_at_paris: args.created_at_paris ?? step.timestamp_paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function patchReplayThesis(thesis, monitor, tick) {
  return {
    ...thesis,
    ...(monitor.thesis_update || {}),
    ...(thesis.pinned_plan ? {
      plan_id: thesis.plan_id,
      pinned_plan: thesis.pinned_plan,
    } : {}),
    latest_monitor_id: monitor.monitor_id,
    latest_monitor_step_id: monitor.step_id,
    health_score: typeof monitor.thesis_health_score === "number"
      ? monitor.thesis_health_score
      : monitor.thesis_health_score?.score ?? thesis.health_score,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function buildReplayMonitorApplication(run, step, monitor, positions, tick, context = {}) {
  const nativeCommand = monitor.deterministic_monitor_command && typeof monitor.deterministic_monitor_command === "object"
    ? monitor.deterministic_monitor_command
    : {};
  const nativePositionRequest = nativeCommand.position_request && typeof nativeCommand.position_request === "object"
    ? nativeCommand.position_request
    : monitor.position_request && typeof monitor.position_request === "object"
      ? monitor.position_request
      : {};
  const nativePositionAction = String(nativePositionRequest.type || "NONE").trim().toUpperCase();
  const nativeReplanType = String(
    nativeCommand.replan_request?.type
      || monitor.replan_request?.type
      || "NOOP",
  ).trim().toUpperCase();
  const nativeThesisCommand = String(nativeCommand.thesis_command?.type || "NOOP").trim().toUpperCase();
  const requiresReplan = nativeReplanType === "REQUEST"
    || ["INVALIDATE", "EXPIRE", "REQUIRE_REPLAN", "SUPERSEDE"].includes(nativeThesisCommand);
  let action = nativePositionAction !== "NONE"
    ? nativePositionAction
    : normalizeReplayMonitorAction(monitor.monitor_decision);
  if (nativePositionAction === "NONE" && nativeReplanType === "REQUEST") action = "REPLAN_FULL";
  if (nativePositionAction === "NONE" && nativeThesisCommand === "INVALIDATE") action = "INVALIDATE_THESIS";
  if (nativePositionAction === "NONE" && ["EXPIRE", "REQUIRE_REPLAN", "SUPERSEDE"].includes(nativeThesisCommand)) action = "REPLAN_FULL";
  const existing = selectOpenReplayPosition(positions) || positions[0] || null;
  if (action === "TRIGGER_GO") {
    return {
      action: "ARM_SETUP",
      requested_action: action,
      position: existing,
      run_status: "WAITING_NEXT_STEP",
      note: "GPT TRIGGER_GO normalized to ARM_SETUP; only the deterministic closed-candle engine may create a position.",
      trigger_deferred_to_engine: true,
    };
  }
  if (action === "REPLAN_FULL") {
    const lastReplanMs = Date.parse(run.last_replan_at_paris || "");
    const checkpointMs = Date.parse(step.timestamp_paris || "");
    const minimumMinutes = positivePolicyNumber(run.risk_policy?.min_replan_interval_minutes, 60);
    const thesisRequiresImmediateReplan = replayThesisRequiresImmediateReplan(
      context.activeThesis,
      step.timestamp_paris,
    );
    if (monitor.monitor_decision?.hard_invalidation !== true
      && !thesisRequiresImmediateReplan
      && Number.isFinite(lastReplanMs)
      && Number.isFinite(checkpointMs)
      && checkpointMs - lastReplanMs < minimumMinutes * 60_000) {
      return {
        action: "MAINTAIN_THESIS",
        position: existing,
        run_status: "WAITING_NEXT_STEP",
        note: `REPLAN_FULL debounced: the previous replan is less than ${minimumMinutes} minutes old.`,
        replan_debounced: true,
        pending_replan_at_paris: new Date(lastReplanMs + minimumMinutes * 60_000).toISOString(),
      };
    }
    return { action, position: existing, run_status: "REPLAN_REQUIRED", note: "GPT monitor requested a full replan." };
  }
  if (action === "INVALIDATE_THESIS") {
    return { action, position: existing, run_status: "REPLAN_REQUIRED", note: "Replay thesis invalidated by GPT monitor." };
  }
  if (action === "EXIT_POSITION" && existing) {
    const eligibility = replayPositionRequestEligibility({ action, request: nativePositionRequest, position: existing });
    if (!eligibility.actionable) {
      return { action, position: existing, run_status: requiresReplan ? "REPLAN_REQUIRED" : "WAITING_NEXT_STEP", note: "Replay exit request deferred: " + eligibility.reason + ".", management_deferred_to_engine: true };
    }
    const exit = replayMonitorExitGeometry(existing, monitor, context.simulation);
    const finalized = finalizePositionAtPrice(existing, {
      exitPrice: exit.exit_price,
      exitReason: exit.exit_reason,
      closedAtParis: step.timestamp_paris,
      closedAtUtc: monitor.as_of_utc || monitor.scheduled_for_utc || null,
      tick,
    });
    if (!finalized.changed) {
      return {
        action,
        position: existing,
        run_status: requiresReplan ? "REPLAN_REQUIRED" : "WAITING_NEXT_STEP",
        note: "Replay exit deferred because no immutable interval mark is available.",
      };
    }
    return {
      action,
      position: mergeReplayPositionState(existing, {
        ...finalized.position,
        exit_price_source: exit.exit_price_source,
        exit_price_dataset: exit.exit_price_dataset,
        exit_price_timestamp_utc: exit.exit_price_timestamp_utc,
      }),
      run_status: requiresReplan ? "REPLAN_REQUIRED" : "WAITING_NEXT_STEP",
      note: `Replay position closed by the deterministic engine at immutable mark ${exit.exit_price}.`,
    };
  }
  if (action === "MOVE_STOP_BE" && existing) {
    const mark = replaySimulationMarkForInstrument(context.simulation, existing.instrument);
    const eligibility = replayPositionRequestEligibility({ action, request: nativePositionRequest, position: existing, mark });
    if (!eligibility.actionable) {
      return {
        action,
        position: existing,
        run_status: requiresReplan ? "REPLAN_REQUIRED" : "WAITING_NEXT_STEP",
        note: "Replay break-even request deferred: " + eligibility.reason + ".",
        management_deferred_to_engine: true,
        management_eligibility: eligibility,
      };
    }
    return {
      action,
      position: mergeReplayPositionState(existing, {
        status: "PROTECTED",
        stop_loss: existing.entry_price ?? existing.entry ?? existing.stop_loss,
        latest_management_action: action,
        updated_at: tick.utc,
        updated_at_utc: tick.utc,
        updated_at_paris: tick.paris,
      }),
      run_status: requiresReplan ? "REPLAN_REQUIRED" : "WAITING_NEXT_STEP",
      note: "Replay stop moved to breakeven by the deterministic engine after immutable-price validation.",
    };
  }
  if (["TAKE_PARTIAL", "REDUCE_RISK"].includes(action) && existing) {
    const eligibility = replayPositionRequestEligibility({ action, request: nativePositionRequest, position: existing });
    if (!eligibility.actionable) {
      return { action, position: existing, run_status: requiresReplan ? "REPLAN_REQUIRED" : "WAITING_NEXT_STEP", note: "Replay partial request deferred: " + eligibility.reason + ".", management_deferred_to_engine: true, management_eligibility: eligibility };
    }
    const mark = replaySimulationMarkForInstrument(context.simulation, existing.instrument);
    const partial = applyPartialExitAtPrice(existing, {
      fillPrice: mark?.close,
      filledAtParis: step.timestamp_paris,
      filledAtUtc: mark?.timestamp_utc || monitor.as_of_utc || null,
      reduceFraction: nativePositionRequest.reduce_fraction ?? null,
      managementAction: action,
      tick,
    });
    return {
      action,
      position: partial.changed
        ? mergeReplayPositionState(existing, {
          ...partial.position,
          latest_management_action: action,
          partial_fill_price_source: "immutable_replay_market_mark",
          partial_fill_price_dataset: mark?.dataset || null,
        })
        : existing,
      run_status: requiresReplan ? "REPLAN_REQUIRED" : "WAITING_NEXT_STEP",
      note: partial.changed
        ? `Replay ${action === "REDUCE_RISK" ? "risk reduction" : "partial"} filled by the deterministic engine at immutable mark ${mark.close}.`
        : `Replay ${action === "REDUCE_RISK" ? "risk reduction" : "partial"} request deferred: ${partial.reason}.`,
      management_deferred_to_engine: !partial.changed,
    };
  }
  return { action, position: existing, run_status: requiresReplan ? "REPLAN_REQUIRED" : "WAITING_NEXT_STEP", note: "Replay monitor applied without opening a new position." };
}

export function normalizeReplayMonitorAction(decision = {}) {
  return String(decision.action || decision.decision || decision.action_now || "WAIT_MORE").trim().toUpperCase();
}

export function mergeReplayPositionState(existing, update) {
  if (!update) return existing || null;
  if (!existing) return update;
  const merged = { ...existing, ...update };
  for (const key of [
    "position_id",
    "instrument",
    "direction",
    "entry_price",
    "initial_stop_loss",
    "opened_at_paris",
    "opened_at_utc",
    "created_at",
    "created_at_utc",
    "created_at_paris",
  ]) {
    if ((update[key] === null || update[key] === undefined || update[key] === "") && existing[key] !== null && existing[key] !== undefined && existing[key] !== "") {
      merged[key] = existing[key];
    }
  }
  return merged;
}

function replayMonitorPositionGeometry(monitor = {}) {
  const decision = monitor.monitor_decision || {};
  const setup = [
    decision.setup,
    decision.armed_setup,
    decision.setup_transition,
    decision.setup_candidate,
    monitor.armed_setup,
    monitor.setup_transition,
    monitor.setup_candidate,
  ].find((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate)) || {};
  return {
    setup_record_id: setup.setup_record_id || null,
    setup_id: setup.setup_id || setup.id || decision.setup_id || null,
    instrument: decision.instrument || setup.instrument || setup.contract || monitor.instrument || null,
    direction: decision.direction || setup.direction || monitor.direction || null,
    entry_price: decision.entry_price
      ?? decision.entry
      ?? setup.entry_price
      ?? setup.entry
      ?? canonicalSetupEntryGeometry(setup).execution_price
      ?? monitor.entry_price
      ?? monitor.entry
      ?? null,
    stop_loss: decision.stop_loss ?? decision.stop ?? setup.stop_loss ?? setup.stop ?? monitor.stop_loss ?? monitor.stop ?? null,
    take_profit_1: decision.take_profit_1
      ?? decision.tp1
      ?? setup.take_profit_1
      ?? setup.tp1
      ?? setup.targets?.[0]?.price
      ?? setup.targets?.[0]
      ?? monitor.take_profit_1
      ?? monitor.tp1
      ?? null,
  };
}

function hasCompleteReplayPositionGeometry(position = {}) {
  const direction = String(position.direction || "").trim().toLowerCase();
  return Boolean(position.instrument)
    && ["long", "short", "buy", "sell", "bull", "bear", "bullish", "bearish"].includes(direction)
    && Number.isFinite(Number(position.entry_price))
    && Number.isFinite(Number(position.stop_loss))
    && Number(position.entry_price) !== Number(position.stop_loss);
}

function replayMonitorExitGeometry(position = {}, monitor = {}, simulation = null) {
  const marketMark = replaySimulationMarkForInstrument(simulation, position.instrument);
  if (marketMark?.close !== null && marketMark?.close !== undefined) {
    return {
      exit_price: marketMark.close,
      exit_reason: "MONITOR_EXIT_POSITION",
      exit_price_source: "immutable_replay_market_mark",
      exit_price_dataset: marketMark.dataset,
      exit_price_timestamp_utc: marketMark.timestamp_utc,
    };
  }
  return {
    exit_price: null,
    exit_reason: "MONITOR_EXIT_POSITION",
    exit_price_source: null,
    exit_price_dataset: null,
    exit_price_timestamp_utc: null,
  };
}

function replayPositionRequestEligibility({ action, request = {}, position, mark = null }) {
  return evaluatePositionRequestEligibility({
    request: { ...request, type: action },
    position,
    mark: mark
      ? {
        price: mark.close,
        timestamp: mark.timestamp_utc || mark.timestamp_paris || null,
        source: mark.dataset || "immutable_replay_market_mark",
        immutable: true,
        reconciled: true,
      }
      : null,
    sourceAction: action,
  });
}
function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function replaySimulationMarkForInstrument(simulation, instrument) {
  const normalizedInstrument = String(instrument || "").toUpperCase();
  const marks = Array.isArray(simulation?.market_marks) ? simulation.market_marks : [];
  return marks.find((mark) => String(mark.instrument || "").toUpperCase() === normalizedInstrument) || null;
}

function isOpenReplayPosition(position) {
  if (!position) return false;
  return ["OPEN", "PROTECTED", "PARTIAL_TAKEN", "PENDING", "RUNNING"].includes(String(position.status || "").toUpperCase())
    && !position.closed_at
    && !position.closed_at_utc
    && !position.closed_at_paris
    && (position.exit_price === undefined || position.exit_price === null);
}

export async function buildReplayIntervalSimulation(store, run, step, position, setups = [], {
  from,
  to,
  positionHistory = [],
}, tick) {
  assertReplayIntervalBounds(run, step, { from, to });
  const replayTick = {
    ...tick,
    utc: normalizeUtcIso(to),
    paris: to,
    epochMs: Date.parse(to),
  };
  const pack = await store.getDeskPack({
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    mode: "replay",
  });
  assertRunPackScope(run, pack);
  const lifecycleSetups = (setups || []).map((setup) => (
    projectReplaySetupLifecycleAt(setup, {
      asOfParis: to,
      asOfUtc: replayTick.utc,
    })
  ));
  const lifecycleSetupUpdates = lifecycleSetups.filter((setup, index) => (
    normalizeReplaySetupStatus(setup.status || setup.lifecycle_status || setup.setup_status)
    !== normalizeReplaySetupStatus(
      setups[index]?.status || setups[index]?.lifecycle_status || setups[index]?.setup_status,
    )
  ));
  const activeSetups = selectActiveReplaySetups(lifecycleSetups, {
    asOfParis: to,
    asOfUtc: replayTick.utc,
  });
  const instruments = [...new Set([
    position?.instrument,
    ...activeSetups.map((setup) => setup.instrument),
    ...activeSetups.flatMap((setup) => [
      ...setupConditionInstrumentsV1(setup),
      ...canonicalReplaySetupConditionSource(setup).map((condition) => condition?.reference_instrument
        || condition?.parameters?.reference_instrument
        || condition?.instrument
        || condition?.contract
        || condition?.asset
        || condition?.market),
    ]),
  ].filter(Boolean).map((instrument) => String(instrument).toUpperCase()))];
  const datasets = [];
  const needsMacroEvents = instruments.includes(PREDICATE_EVENT_ROWS_INSTRUMENT_V1);
  const priceInstruments = instruments.filter((instrument) => instrument !== PREDICATE_EVENT_ROWS_INSTRUMENT_V1);
  const datasetSpecs = replayExecutionDatasetSpecs(pack, priceInstruments, activeSetups, position);
  for (const {
    instrument,
    timeframe,
    datasetName,
    sourceDatasetName,
    derivedFromM1,
  } of datasetSpecs) {
    if (!sourceDatasetName) {
      datasets.push({
        instrument,
        timeframe,
        datasetName,
        sourceDatasetName: null,
        derivedFromM1: false,
        derivationLineage: null,
        dataset: null,
        intervalRows: [],
        data_status: "UNAVAILABLE",
      });
      continue;
    }
    const dataset = await store.getDataset({
      pack_id: run.pack_id,
      pack_build_id: run.pack_build_id,
      dataset: sourceDatasetName,
      as_of_utc: normalizeUtcIso(to),
      mode: "replay",
      format: "json",
      max_rows: Number.MAX_SAFE_INTEGER,
    });
    const derivation = derivedFromM1
      ? deriveCanonicalTimeframeFromClosedM1(dataset?.rows || [], {
          cutoffUtc: normalizeUtcIso(to),
          targetTimeframe: timeframe,
          asset: instrument,
          requestedSymbol: `${instrument}1!`,
          sourceDataset: sourceDatasetName,
        })
      : null;
    const executionRows = (derivation?.rows || dataset?.rows || []).map((row) => ({
      ...row,
      instrument,
      timeframe,
      execution_timeframe: timeframe,
      execution_timeframe_fallback: derivedFromM1 === true,
    }));
    const intervalRows = filterReplayClosedRows(executionRows, {
      from,
      to,
      timeframe,
    });
    datasets.push({
      instrument,
      timeframe,
      datasetName,
      sourceDatasetName,
      derivedFromM1,
      derivationLineage: derivation?.lineage || null,
      dataset,
      intervalRows,
      data_status: intervalRows.length ? "AVAILABLE" : "UNAVAILABLE",
    });
  }
  if (needsMacroEvents) {
    const macroRef = pack.datasets?.macro_calendar || null;
    if (!macroRef) {
      datasets.push({
        instrument: PREDICATE_EVENT_ROWS_INSTRUMENT_V1,
        datasetName: null,
        dataset: null,
        intervalRows: [],
        data_status: "UNAVAILABLE",
      });
    } else {
      const macroDataset = await store.getDataset({
        pack_id: run.pack_id,
        pack_build_id: run.pack_build_id,
        dataset: "macro_calendar",
        as_of_utc: normalizeUtcIso(to),
        mode: "replay",
        format: "json",
        max_rows: 5_000,
      });
      const macroRows = (macroDataset.rows || []).map((event) => ({
        ...event,
        instrument: PREDICATE_EVENT_ROWS_INSTRUMENT_V1,
        timeframe: "EVENT",
        event_record: true,
        event_row_type: "MACRO_CALENDAR_EVENT",
        event_cutoff_utc: normalizeUtcIso(to),
        event_source_manifest_hash: pack.source_manifest_hash || pack.manifest?.source_manifest_hash || null,
      }));
      datasets.push({
        instrument: PREDICATE_EVENT_ROWS_INSTRUMENT_V1,
        datasetName: "macro_calendar",
        dataset: macroDataset,
        intervalRows: macroRows,
        data_status: macroRows.length ? "AVAILABLE" : "UNAVAILABLE",
      });
    }
  }
  const allRows = datasets
    .filter((item) => item.instrument !== PREDICATE_EVENT_ROWS_INSTRUMENT_V1)
    .flatMap((item) => item.intervalRows || []);
  const maxTimestampUsed = allRows
    .map((row) => replayRowCloseTimestamp(row))
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  const futurePricesUsed = Boolean(maxTimestampUsed && Date.parse(maxTimestampUsed) > Date.parse(to));
  if (futurePricesUsed) {
    throw deskError("LOOKAHEAD_DETECTED", "Replay interval contains a price observation after the step cutoff.", {
      backtest_id: run.backtest_id,
      step_id: step.step_id,
      max_timestamp_utc: normalizeUtcIso(maxTimestampUsed),
      allowed_until_utc: normalizeUtcIso(to),
    });
  }
  const sourceManifestHash = pack.source_manifest_hash || pack.manifest?.source_manifest_hash || null;
  const rawRefs = datasets.filter(({ datasetName }) => Boolean(datasetName)).map((item) => {
    const sourceDatasetName = item.sourceDatasetName || item.datasetName;
    return {
      dataset: item.datasetName,
      source_dataset: sourceDatasetName,
      object_path: pack.datasets?.[sourceDatasetName]?.object_path || pack.datasets?.[sourceDatasetName]?.storage_path || null,
      gcs_generation: pack.datasets?.[sourceDatasetName]?.gcs_generation || null,
      sha256: pack.datasets?.[sourceDatasetName]?.sha256 || null,
      derivation_lineage: item.derivationLineage || null,
    };
  });
  const marketMarks = datasets
    .filter(({ instrument }) => instrument !== PREDICATE_EVENT_ROWS_INSTRUMENT_V1)
    .map(({ instrument, datasetName, intervalRows }) => {
    const row = intervalRows.at(-1) || null;
    return {
      instrument,
      dataset: datasetName,
      timestamp_utc: row?.timestamp_utc || null,
      timestamp_paris: row?.timestamp_paris || null,
      close: finiteNumber(row?.close),
    };
  });
  const rowsByInstrument = new Map();
  const entryRowsByInstrument = new Map();
  for (const item of datasets) {
    const combined = [...(rowsByInstrument.get(item.instrument) || []), ...(item.intervalRows || [])]
      .sort((left, right) => Date.parse(left.timestamp_utc || left.timestamp_paris || "")
        - Date.parse(right.timestamp_utc || right.timestamp_paris || ""));
    rowsByInstrument.set(item.instrument, combined);
    if (item.timeframe === "M1") {
      entryRowsByInstrument.set(item.instrument, item.intervalRows || []);
    }
  }
  const riskGate = evaluateReplayDailyRiskGate(positionHistory, {
    policy: run.risk_policy,
    at: to,
  });
  let positionUpdate = null;
  let simulationStatus = position ? "UNCHANGED" : "NO_POSITION";
  let simulationNote = position ? "Interval recorded from the immutable dataset pinned to this replay." : "No replay position to simulate.";
  if (position) {
    const instrumentRows = entryRowsByInstrument.get(String(position.instrument || "").toUpperCase()) || [];
    const positionEvaluation = evaluateReplayPositionOnRows(position, instrumentRows, { tick: replayTick });
    if (positionEvaluation.changed) {
      positionUpdate = positionEvaluation.position;
      simulationStatus = positionEvaluation.reason;
      simulationNote = `Replay position updated during interval: ${positionEvaluation.reason}.`;
    } else if (instrumentRows.length) {
      positionUpdate = markPositionAtPrice(positionEvaluation.position || position, instrumentRows.at(-1)?.close, { tick: replayTick });
      simulationStatus = "MARKED_TO_MARKET";
      simulationNote = "Open replay position marked deterministically at the latest immutable close.";
    }
  }
  const setupEvaluations = [];
  let triggeredPosition = null;
  for (const setup of activeSetups) {
    const instrumentRows = entryRowsByInstrument.get(String(setup.instrument || "").toUpperCase()) || [];
    let evaluation = evaluateReplaySetupOnRows(setup, instrumentRows, { tick: replayTick, rowsByInstrument });
    if (evaluation.triggered && riskGate.blocked) {
      evaluation = deferReplaySetupTrigger(evaluation, setup, {
        tick: replayTick,
        reason: `RISK_GATE_${riskGate.reason}`,
      });
    }
    if (evaluation.triggered && (position || triggeredPosition)) {
      evaluation = deferReplaySetupTrigger(evaluation, setup, {
        tick: replayTick,
        reason: position ? "POSITION_ALREADY_OPEN_TRIGGER_DEFERRED" : "ANOTHER_SETUP_TRIGGERED_FIRST",
      });
    }
    setupEvaluations.push(evaluation);
    if (!position && !triggeredPosition && evaluation.triggered) {
      triggeredPosition = buildReplayPositionFromTriggeredSetup({
        setup: evaluation.setup,
        run,
        step,
        monitor: { monitor_id: setup.monitor_id || null },
        trigger: evaluation,
        tick: replayTick,
        makePositionId: (value) => scopedReplayChildId(run, "position", `${step.step_id}_${value}`),
      });
      const triggerMs = Date.parse(evaluation.trigger_row?.timestamp_utc || evaluation.trigger_row?.timestamp_paris || "");
      const postTriggerRows = instrumentRows.filter((row) => {
        const rowMs = Date.parse(row.timestamp_utc || row.timestamp_paris || "");
        return !Number.isFinite(triggerMs) || (Number.isFinite(rowMs) && rowMs > triggerMs);
      });
      const positionEvaluation = evaluateReplayPositionOnRows(triggeredPosition, postTriggerRows, { tick: replayTick });
      positionUpdate = positionEvaluation.changed
        ? positionEvaluation.position
        : markPositionAtPrice(triggeredPosition, postTriggerRows.at(-1)?.close, { tick: replayTick });
      evaluation.setup = {
        ...evaluation.setup,
        status: "TRIGGERED",
        lifecycle_status: "TRIGGERED",
        setup_status: "TRIGGERED",
        status_authority: "backend",
        trigger_source: "backend_immutable_interval",
        execution_status: "POSITION_CREATED",
        linked_position_id: triggeredPosition.position_id,
      };
      simulationStatus = positionEvaluation.changed ? positionEvaluation.reason : "SETUP_TRIGGERED";
      simulationNote = positionEvaluation.changed
        ? `Conditional replay setup triggered and position resolved during the same immutable interval: ${positionEvaluation.reason}.`
        : "Conditional replay setup triggered from immutable interval prices.";
    }
  }
  const evaluatedSetupUpdates = setupEvaluations
    .filter((evaluation) => evaluation.setup && (
      evaluation.triggered
      || evaluation.setup.condition_summary
      || normalizeReplaySetupStatus(evaluation.setup.status) !== normalizeReplaySetupStatus(
        setups.find((setup) => setup.setup_record_id === evaluation.setup.setup_record_id)?.status,
      )
    ))
    .map((evaluation) => evaluation.setup);
  const setupUpdates = [...new Map(
    [...lifecycleSetupUpdates, ...evaluatedSetupUpdates]
      .map((setup) => [setup.setup_record_id || setup.setup_id, setup]),
  ).values()];
  return {
    simulation_id: scopedReplayChildId(run, "simulation", `${step.sequence || 0}_${compactTimestamp(to)}`),
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    session: run.session,
    trading_date: run.trading_date || run.date,
    run_id: run.replay_run_id || run.backtest_id,
    resolved_scope: run.resolved_scope,
    scope_hash: run.scope_hash,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    source_manifest_hash: sourceManifestHash,
    step_id: step.step_id,
    mode: "replay",
    from_timestamp: from,
    to_timestamp: to,
    as_of_utc: normalizeUtcIso(to),
    cutoff_paris: to,
    position_id: positionUpdate?.position_id || position?.position_id || null,
    position: position || null,
    position_update: mergeReplayPositionState(position, positionUpdate),
    setup_updates: setupUpdates,
    active_setup_count: activeSetups.length,
    setup_evaluations: setupEvaluations.map((evaluation) => ({
      setup_record_id: evaluation.setup?.setup_record_id || null,
      setup_id: evaluation.setup?.setup_id || null,
      status: evaluation.status || evaluation.setup?.status || null,
      triggered: evaluation.triggered === true,
      reason: evaluation.reason,
      condition_summary: evaluation.setup?.condition_summary || null,
    })),
    dataset: datasets[0]?.datasetName || null,
    datasets: datasets.map((item) => ({
      instrument: item.instrument,
      timeframe: item.timeframe || null,
      dataset: item.datasetName,
      source_dataset: item.sourceDatasetName || item.datasetName || null,
      derived_from_m1: item.derivedFromM1 === true,
      derivation_lineage: item.derivationLineage || null,
      row_count: item.intervalRows.length,
      data_status: item.data_status,
    })),
    market_marks: marketMarks,
    row_count: allRows.length,
    max_price_timestamp_used: maxTimestampUsed,
    future_prices_used: false,
    risk_gate: riskGate,
    portfolio_arbitration: {
      policy: "RANK_THEN_PRIORITY_FIRST_ELIGIBLE",
      max_setups: 5,
      max_simultaneous_positions: 1,
      global_risk_budget_pct: 0.25,
      evaluated_setup_ids: setupEvaluations
        .map((evaluation) => evaluation.setup?.setup_id || evaluation.setup?.setup_record_id)
        .filter(Boolean),
      winner_setup_id: triggeredPosition?.setup_id
        || triggeredPosition?.linked_setup_id
        || setupEvaluations.find((evaluation) => evaluation.triggered)?.setup?.setup_id
        || null,
      deferred_setup_ids: setupEvaluations
        .filter((evaluation) => evaluation.reason === "ANOTHER_SETUP_TRIGGERED_FIRST")
        .map((evaluation) => evaluation.setup?.setup_id || evaluation.setup?.setup_record_id)
        .filter(Boolean),
    },
    integrity: datasets.map((item) => item.dataset?.integrity).filter(Boolean)[0] || null,
    data_quality: rawWindowQuality(allRows, { reason: instruments.length ? "pinned_dataset_has_no_rows_in_interval" : "no_replay_position_or_setup" }),
    raw_refs: rawRefs,
    result: {
      status: simulationStatus,
      note: simulationNote,
    },
    anti_lookahead_compliant: true,
    interval_semantics: "[from,to) by candle open; only candles closed by to are visible",
    computed_with_cutoff: to,
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
  };
}

export function evaluateReplayDailyRiskGate(positions = [], { policy = {}, at } = {}) {
  const maxDailyLossR = positivePolicyNumber(policy?.max_daily_loss_r, 3);
  const maxConsecutiveLosses = Math.max(1, Math.trunc(positivePolicyNumber(policy?.max_consecutive_losses, 3)));
  const cooldownMinutes = positivePolicyNumber(policy?.cooldown_after_loss_minutes, 30);
  const terminal = (positions || [])
    .filter((position) => ["CLOSED", "STOPPED"].includes(String(position.status || "").toUpperCase()))
    .filter((position) => finiteNumber(position.result_r ?? position.result_R ?? position.realized_R) !== null)
    .sort((left, right) => Date.parse(
      left.closed_at_paris || left.closed_at_utc || left.updated_at_paris || left.updated_at_utc || "",
    ) - Date.parse(
      right.closed_at_paris || right.closed_at_utc || right.updated_at_paris || right.updated_at_utc || "",
    ));
  const realizedR = terminal.reduce(
    (sum, position) => sum + finiteNumber(position.result_r ?? position.result_R ?? position.realized_R),
    0,
  );
  let consecutiveLosses = 0;
  for (const position of [...terminal].reverse()) {
    if (finiteNumber(position.result_r ?? position.result_R ?? position.realized_R) < 0) consecutiveLosses += 1;
    else break;
  }
  const latest = terminal.at(-1) || null;
  const latestResultR = finiteNumber(latest?.result_r ?? latest?.result_R ?? latest?.realized_R);
  const latestClosedMs = Date.parse(
    latest?.closed_at_paris || latest?.closed_at_utc || latest?.updated_at_paris || latest?.updated_at_utc || "",
  );
  const atMs = Date.parse(at || "");
  const cooldownUntilMs = latestResultR < 0 && Number.isFinite(latestClosedMs)
    ? latestClosedMs + cooldownMinutes * 60_000
    : Number.NaN;
  const dailyLossBlocked = realizedR <= -maxDailyLossR;
  const streakBlocked = consecutiveLosses >= maxConsecutiveLosses;
  const cooldownBlocked = Number.isFinite(cooldownUntilMs) && Number.isFinite(atMs) && atMs < cooldownUntilMs;
  const reason = dailyLossBlocked
    ? "MAX_DAILY_LOSS_REACHED"
    : streakBlocked
      ? "MAX_CONSECUTIVE_LOSSES_REACHED"
      : cooldownBlocked
        ? "LOSS_COOLDOWN_ACTIVE"
        : "ELIGIBLE";
  return {
    blocked: dailyLossBlocked || streakBlocked || cooldownBlocked,
    reason,
    realized_r: Number(realizedR.toFixed(8)),
    closed_trade_count: terminal.length,
    consecutive_losses: consecutiveLosses,
    limits: {
      max_daily_loss_r: maxDailyLossR,
      max_consecutive_losses: maxConsecutiveLosses,
      cooldown_after_loss_minutes: cooldownMinutes,
    },
    cooldown_until: Number.isFinite(cooldownUntilMs) ? new Date(cooldownUntilMs).toISOString() : null,
  };
}

export function certifyReplayRunResult({
  run,
  positions = [],
  simulations = [],
  setups = [],
  masterAnalyses = [],
} = {}) {
  const findings = [];
  const ambiguousPositions = positions.filter((position) => String(position.status || "").toUpperCase() === "REVIEW_REQUIRED");
  const openPositions = positions.filter((position) => isOpenReplayPosition(position));
  const unpricedTerminalPositions = positions.filter((position) => {
    const status = String(position.status || "").toUpperCase();
    return ["CLOSED", "STOPPED"].includes(status)
      && finiteNumber(position.result_r ?? position.result_R ?? position.realized_R) === null;
  });
  const lookaheadSimulations = simulations.filter((simulation) => simulation.future_prices_used === true);
  const orphanTriggeredSetups = setups.filter((setup) => (
    String(setup.status || setup.lifecycle_status || "").toUpperCase() === "TRIGGERED"
    && !setup.linked_position_id
  ));
  const executableSetups = setups.filter((setup) => setup.execution_geometry_ready === true
    && Array.isArray(canonicalReplaySetupConditionSource(setup))
    && canonicalReplaySetupConditionSource(setup).length > 0);
  const nonExecutableSetupDocuments = setups.filter((setup) => (
    ["SETUP_CANDIDATE", "PRE_ARMED", "ARMED_CONDITIONAL"].includes(
      normalizeReplaySetupStatus(setup.status || setup.lifecycle_status || setup.setup_status),
    )
    && setup.execution_geometry_ready !== true
  ));
  if (ambiguousPositions.length) findings.push({ code: "AMBIGUOUS_INTRABAR_POSITIONS", count: ambiguousPositions.length });
  if (openPositions.length) findings.push({ code: "OPEN_POSITIONS_AT_RUN_END", count: openPositions.length });
  if (unpricedTerminalPositions.length) findings.push({ code: "UNPRICED_TERMINAL_POSITIONS", count: unpricedTerminalPositions.length });
  if (lookaheadSimulations.length) findings.push({ code: "LOOKAHEAD_SIMULATIONS", count: lookaheadSimulations.length });
  if (orphanTriggeredSetups.length) findings.push({ code: "ORPHAN_TRIGGERED_SETUPS", count: orphanTriggeredSetups.length });
  const noSetupProofs = masterAnalyses
    .map((master) => master?.no_setup_proof
      || master?.full_analysis?.no_setup_proof
      || master?.executable_decision?.no_setup_proof)
    .filter(isCompleteNoSetupProof);
  if (!positions.length && !executableSetups.length && noSetupProofs.length === 0) {
    findings.push({ code: "NO_EXECUTABLE_SETUP", count: nonExecutableSetupDocuments.length || 1 });
  }
  const certified = findings.length === 0;
  return {
    certified,
    status: certified
      ? positions.length
        ? "CERTIFIED_ENGINE_V3"
        : "VALID_NO_OPPORTUNITY"
      : "INVALID_NO_EXECUTABLE_SETUP",
    result_eligible: certified,
    aggregate_eligible: certified && run?.aggregate_eligible !== false,
    engine_version: run?.position_engine_version || "3.0.0",
    policy_version: run?.replay_execution_policy_version || "3.0.0",
    no_setup_proof_count: noSetupProofs.length,
    findings,
  };
}

function isCompleteNoSetupProof(proof) {
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return false;
  const blockingReasons = proof.blocking_reasons || proof.blockers || proof.evidence;
  const waitConditions = proof.wait_to_go_conditions || proof.wait_conditions;
  const revalidationTriggers = proof.revalidation_triggers || proof.revalidation_conditions;
  return Boolean(
    proof.best_long && typeof proof.best_long === "object"
    && proof.best_short && typeof proof.best_short === "object"
    && Array.isArray(blockingReasons) && blockingReasons.length > 0
    && Array.isArray(waitConditions) && waitConditions.length > 0
    && Array.isArray(revalidationTriggers) && revalidationTriggers.length > 0
  );
}

function positivePolicyNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function replayThesisRequiresImmediateReplan(thesis, checkpointParis) {
  if (!thesis) return true;
  const status = String(thesis.status || thesis.lifecycle_status || "").toUpperCase();
  if (["INVALIDATED", "EXPIRED", "CANCELLED", "CANCELED", "REPLAN_REQUIRED"].includes(status)) {
    return true;
  }
  const checkpointMs = Date.parse(checkpointParis || "");
  const expiryMs = Date.parse(
    thesis.requires_replan_after
      || thesis.setup_expiry_time
      || thesis.valid_until
      || thesis.expires_at_paris
      || "",
  );
  return Number.isFinite(checkpointMs) && Number.isFinite(expiryMs) && checkpointMs >= expiryMs;
}

export function filterReplayClosedRows(rows, { from, to, timeframe = "5" } = {}) {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  return (rows || [])
    .map((row) => ({ row, closeMs: replayRowCloseMs(row, timeframe) }))
    .filter(({ closeMs }) => {
      if (!Number.isFinite(closeMs)) return false;
      if (Number.isFinite(fromMs) && closeMs <= fromMs) return false;
      if (Number.isFinite(toMs) && closeMs > toMs) return false;
      return true;
    })
    .sort((left, right) => left.closeMs - right.closeMs)
    .map(({ row, closeMs }) => ({
      ...row,
      candle_close_utc: row.candle_close_utc || new Date(closeMs).toISOString(),
    }));
}

function replayRowCloseTimestamp(row, fallbackTimeframe = "5") {
  const closeMs = replayRowCloseMs(row, fallbackTimeframe);
  return Number.isFinite(closeMs) ? new Date(closeMs).toISOString() : null;
}

function replayRowCloseMs(row = {}, fallbackTimeframe = "5") {
  const explicitClose = Date.parse(
    row.candle_close_utc
      || row.close_timestamp_utc
      || row.closed_at_utc
      || "",
  );
  if (Number.isFinite(explicitClose)) return explicitClose;
  const openedAt = Date.parse(row.timestamp_utc || row.timestamp_paris || row.timestamp || row.time || "");
  if (!Number.isFinite(openedAt)) return Number.NaN;
  return openedAt + replayTimeframeMilliseconds(row.timeframe || fallbackTimeframe);
}

function replayTimeframeMilliseconds(value) {
  const raw = String(value || "5").trim().toUpperCase();
  const match = raw.match(/^M?(\d+)$/);
  if (match) return Math.max(1, Number(match[1])) * 60_000;
  const hour = raw.match(/^H(\d+)$/);
  if (hour) return Math.max(1, Number(hour[1])) * 60 * 60_000;
  return 5 * 60_000;
}

function datasetTimeframeFromName(datasetName) {
  const match = String(datasetName || "").toUpperCase().match(/_(M\d+|H\d+)$/);
  return match?.[1] || "M5";
}

function deferReplaySetupTrigger(evaluation, originalSetup, { tick, reason }) {
  const retainedStatus = String(
    originalSetup.status || originalSetup.lifecycle_status || originalSetup.setup_status || "ARMED_CONDITIONAL",
  ).toUpperCase();
  return {
    ...evaluation,
    triggered: false,
    status: retainedStatus,
    reason,
    setup: {
      ...evaluation.setup,
      status: retainedStatus,
      lifecycle_status: retainedStatus,
      setup_status: retainedStatus,
      status_authority: originalSetup.status_authority || "backend_normalized",
      trigger_source: originalSetup.trigger_source || null,
      execution_status: "TRIGGER_DEFERRED",
      triggered_at_paris: originalSetup.triggered_at_paris || null,
      trigger_deferred_reason: reason,
      trigger_deferred_at_utc: tick?.utc || null,
    },
  };
}

export function assertReplayIntervalBounds(run, step, { from, to }) {
  const fromMs = Date.parse(String(from || ""));
  const toMs = Date.parse(String(to || ""));
  const stepCutoff = step.as_of_utc || step.cutoff_paris || step.timestamp_paris;
  const stepMs = Date.parse(String(stepCutoff || ""));
  const runClockMs = Date.parse(String(run.current_replay_time || ""));
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
    throw deskError("INVALID_SCOPE", "Replay interval bounds must be valid and ordered.", { from, to });
  }
  if (!Number.isFinite(stepMs) || toMs > stepMs || (Number.isFinite(runClockMs) && toMs > runClockMs)) {
    throw deskError("CLOCK_LIMIT_EXCEEDED", "Replay interval exceeds the current step cutoff.", {
      backtest_id: run.backtest_id,
      step_id: step.step_id,
      to,
      step_cutoff: stepCutoff || null,
      current_replay_time: run.current_replay_time || null,
    });
  }
  if (run.end_time && toMs > Date.parse(run.end_time)) {
    throw deskError("CLOCK_LIMIT_EXCEEDED", "Replay interval exceeds the run end time.", { to, end_time: run.end_time });
  }
  return true;
}

export function replayPositionDataset(pack, instrument) {
  const normalized = String(instrument || "").toUpperCase();
  const candidates = {
    MNQ: ["MNQ_M1"],
    NQ: ["NQ_M1", "MNQ_M1"],
    MES: ["MES_M1"],
    ES: ["ES_M1", "MES_M1"],
  }[normalized] || [normalized + "_M1"];
  const dataset = candidates.find((name) => pack.datasets?.[name]);
  if (!dataset) {
    throw deskError("DATASET_NOT_FOUND", "Pinned pack has no price dataset for the replay position.", {
      pack_id: pack.pack_id,
      pack_build_id: pack.pack_build_id,
      instrument,
      attempted_datasets: candidates,
    });
  }
  return dataset;
}

export function replayExecutionDatasetSpecs(pack, instruments, setups = [], position = null) {
  const requirements = new Map();
  const add = (instrumentValue, timeframeValue) => {
    const instrument = String(instrumentValue || "").toUpperCase();
    if (!instrument || instrument === PREDICATE_EVENT_ROWS_INSTRUMENT_V1) return;
    const timeframe = normalizeReplayExecutionTimeframe(timeframeValue);
    requirements.set(`${instrument}:${timeframe}`, { instrument, timeframe });
  };
  if (position?.instrument) add(position.instrument, "M1");
  for (const instrument of instruments || []) add(instrument, "M1");
  for (const setup of setups || []) {
    add(setup.instrument, "M1");
    for (const condition of canonicalReplaySetupConditionSource(setup)) {
      const instrument = condition.reference_instrument
        || condition.parameters?.reference_instrument
        || condition.instrument
        || setup.instrument;
      add(instrument, condition.timeframe || "M1");
    }
  }
  return [...requirements.values()].map((requirement) => (
    resolveReplayExecutionDatasetSpec(
      pack,
      requirement.instrument,
      requirement.timeframe,
    )
  ));
}

function resolveReplayExecutionDatasetSpec(pack, instrument, timeframe) {
  const directDatasetName = replayDatasetForTimeframe(pack, instrument, timeframe);
  if (directDatasetName) {
    return {
      instrument,
      timeframe,
      datasetName: directDatasetName,
      sourceDatasetName: directDatasetName,
      derivedFromM1: false,
    };
  }
  const sourceDatasetName = timeframe === "M1"
    ? null
    : replayDatasetForTimeframe(pack, instrument, "M1");
  return {
    instrument,
    timeframe,
    datasetName: sourceDatasetName ? `${instrument}_${timeframe}` : null,
    sourceDatasetName,
    derivedFromM1: Boolean(sourceDatasetName),
  };
}

function replayDatasetForTimeframe(pack, instrument, timeframe) {
  const suffix = {
    M1: "M1",
    M5: "M5",
    M15: "M15",
    H1: "H1",
    H4: "H4",
  }[timeframe] || "M1";
  const aliases = {
    MNQ: ["MNQ"],
    NQ: ["NQ", "MNQ"],
    MES: ["MES"],
    ES: ["ES", "MES"],
  }[instrument] || [instrument];
  return aliases
    .map((candidate) => `${candidate}_${suffix}`)
    .find((datasetName) => pack.datasets?.[datasetName]) || null;
}

function normalizeReplayExecutionTimeframe(value) {
  const normalized = String(value || "M1").trim().toUpperCase();
  if (["1", "1M", "M1"].includes(normalized)) return "M1";
  if (["5", "5M", "M5"].includes(normalized)) return "M5";
  if (["15", "15M", "M15"].includes(normalized)) return "M15";
  if (["60", "1H", "H1"].includes(normalized)) return "H1";
  if (["240", "4H", "H4"].includes(normalized)) return "H4";
  return "M1";
}

export function selectReplayTimeline(docs, backtestId) {
  return (docs || [])
    .filter((event) => event.backtest_id === backtestId)
    .sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0)
      || String(left.timestamp_paris || "").localeCompare(String(right.timestamp_paris || ""))
      || Number(left.event_rank || 999) - Number(right.event_rank || 999)
      || String(left.created_at || "").localeCompare(String(right.created_at || "")));
}

export function selectReplayBundles(docs, backtestId) {
  return (docs || [])
    .filter((bundle) => bundle.backtest_id === backtestId)
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
}

export function selectReplayBundle(bundles, { step_id, bundle_type }) {
  return (bundles || []).find((bundle) => (!step_id || bundle.step_id === step_id) && bundle.bundle_type === bundle_type) || null;
}

export function selectReplayBundleForRead(docs, args = {}) {
  const bundles = selectReplayBundles(docs, args.backtest_id);
  const bundle = selectReplayBundle(bundles, {
    step_id: args.step_id,
    bundle_type: args.bundle_type,
  });
  if (!bundle) {
    throw new Error(`replay_${args.bundle_type || "unknown"}_bundle_not_found`);
  }
  return bundle;
}

export function selectLatestReplayMaster(docs, backtestId) {
  return (docs || [])
    .filter((doc) => doc.backtest_id === backtestId)
    .sort((left, right) => String(right.saved_at || right.created_at || "").localeCompare(String(left.saved_at || left.created_at || "")))[0] || null;
}

export function selectReplayActiveThesis(docs, backtestId) {
  return (docs || [])
    .filter((doc) => doc.backtest_id === backtestId)
    .sort((left, right) => String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || "")))[0] || null;
}

export function selectReplayScopedSetups(docs, backtestId) {
  return (docs || [])
    .filter((doc) => doc.backtest_id === backtestId)
    .sort((left, right) => Number(left.priority || 999) - Number(right.priority || 999));
}

export function selectReplayMonitors(docs, backtestId) {
  return (docs || [])
    .filter((doc) => doc.backtest_id === backtestId)
    .sort((left, right) => String(right.timestamp_paris || right.saved_at || "").localeCompare(String(left.timestamp_paris || left.saved_at || "")));
}

export function selectReplayMonitorForStep(docs, backtestId, stepId) {
  return selectReplayMonitors(docs, backtestId).find((monitor) => monitor.step_id === stepId) || null;
}

export function selectReplayPositions(docs, backtestId) {
  return (docs || [])
    .filter((doc) => doc.backtest_id === backtestId)
    .sort((left, right) => String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || "")));
}

export function selectBacktestSteps(docs, backtestId) {
  return (docs || [])
    .filter((step) => step.backtest_id === backtestId)
    .sort((left, right) => String(left.timestamp_paris || left.created_at || "").localeCompare(String(right.timestamp_paris || right.created_at || "")));
}

export function normalizeMonitorCadence(value) {
  const normalized = String(value || "15m").trim().toLowerCase();
  if (["m5", "5", "5m"].includes(normalized)) return "5m";
  if (["m15", "15", "15m"].includes(normalized)) return "15m";
  if (["m30", "30", "30m"].includes(normalized)) return "30m";
  if (["h1", "1h", "60", "60m"].includes(normalized)) return "60m";
  return "15m";
}

export async function buildPinnedReplaySnapshots(store, run, pack, timestampParis, includeRawRefs, readMode = "replay") {
  const rows = [];
  const integrity = {};
  const rawRefs = [];
  const seenObjects = new Set();
  for (const [dataset, ref] of Object.entries(pack.datasets || {})) {
    if (["macro_calendar", "news_digest"].includes(dataset)) continue;
    if (!DATASETS.includes(dataset)) continue;
    const objectKey = `${ref.object_path || ref.storage_path || dataset}@${ref.gcs_generation || "unknown"}`;
    if (seenObjects.has(objectKey)) continue;
    seenObjects.add(objectKey);
    const result = await store.getDataset({
      pack_id: run.pack_id,
      pack_build_id: run.pack_build_id,
      dataset,
      as_of_utc: normalizeUtcIso(timestampParis),
      mode: readMode,
      format: "json",
      max_rows: 5000,
    });
    integrity[dataset] = result.integrity;
    rows.push(...(result.rows || []));
    if (includeRawRefs) {
      rawRefs.push({
        dataset,
        object_path: ref.object_path || ref.storage_path || null,
        gcs_generation: ref.gcs_generation || null,
        sha256: ref.sha256 || null,
      });
    }
  }

  const configs = [
    { key: "15m", timeframes: ["M5", "M15"], minutes: 15 },
    { key: "1h", timeframes: ["M5", "M15"], minutes: 60 },
    { key: "4h", timeframes: ["M15", "M5"], minutes: 240, fallback_timeframe: "H4" },
  ];
  const instruments = dedupeBy(rows.map((row) => row.asset || row.instrument).filter(Boolean), (item) => item);
  const rowsByInstrument = Object.fromEntries(instruments.map((instrument) => [instrument, rows
    .filter((row) => (row.asset || row.instrument) === instrument)
    .filter((row) => rowVisibleAtReplayCutoff(row, timestampParis))
    .sort(compareReplayRows)]));
  const snapshots = {};
  for (const config of configs) {
    const fromMs = Date.parse(offsetIso(timestampParis, -config.minutes * 60 * 1000));
    const toMs = Date.parse(timestampParis);
    const blocks = {};
    const missing = [];
    const closed = [];
    const stale = [];
    for (const instrument of instruments) {
      const instrumentRows = rowsByInstrument[instrument] || [];
      let selected = [];
      let timeframeUsed = null;
      for (const timeframe of config.timeframes) {
        const candidates = instrumentRows.filter((row) => timeframeMatches(row.timeframe, timeframe)).filter((row) => {
          const value = replayRowTimestampMs(row);
          return Number.isFinite(value) && value >= fromMs && value <= toMs;
        });
        if (candidates.length) {
          selected = candidates;
          timeframeUsed = timeframe;
          break;
        }
      }
      let fallbackUsed = false;
      if (!selected.length && config.fallback_timeframe) {
        const fallback = instrumentRows
          .filter((row) => timeframeMatches(row.timeframe, config.fallback_timeframe))
          .filter((row) => replayBarClosedAtCutoff(row, timestampParis))
          .slice(-1);
        if (fallback.length) {
          selected = fallback;
          timeframeUsed = config.fallback_timeframe;
          fallbackUsed = true;
        }
      }
      const marketState = replayMarketState(instrument, timestampParis);
      const lastKnown = latestReplayObservation(instrumentRows, timestampParis);
      const availability = replayAvailability({ selected, fallbackUsed, marketState, lastKnown });
      blocks[instrument] = rollingInstrumentBlock(selected, {
        raw_refs: [],
        missing_reason: availability === "missing_unexpected" ? "pinned_replay_window_empty" : null,
      }, {
        availability,
        market_state: marketState,
        last_known: replayLastKnownSummary(lastKnown, timestampParis),
        timeframe_used: timeframeUsed,
        fallback_used: fallbackUsed,
      });
      if (availability === "missing_unexpected") missing.push(instrument);
      if (["stale_market_closed", "not_yet_open"].includes(availability)) closed.push(instrument);
      if (availability === "stale_market_closed" || fallbackUsed) stale.push(instrument);
    }
    snapshots[config.key] = {
      snapshot_id: stableVNextId(readMode === "replay" ? "replay_rolling_snapshot" : "rolling_snapshot", `${run.backtest_id || run.run_id || run.date}_${config.key}`, timestampParis),
      backtest_id: run.backtest_id || null,
      step_id: run.current_step_id || null,
      strategy_id: run.strategy_id,
      scope_hash: run.scope_hash,
      pack_id: run.pack_id,
      pack_build_id: run.pack_build_id,
      source_manifest_hash: pack.source_manifest_hash || pack.manifest?.source_manifest_hash || null,
      date: run.date,
      session: run.session,
      window: config.key,
      timeframe: config.timeframes.join("|"),
      timestamp_paris: timestampParis,
      timestamp_utc: normalizeUtcIso(timestampParis),
      instruments: blocks,
      raw_refs: includeRawRefs ? rawRefs : [],
      data_quality: {
        status: missing.length ? "degraded" : "ready",
        missing_instruments: missing,
        closed_instruments: closed,
        stale_context_instruments: stale,
        execution_allowed: ["MNQ", "MES", "NQ", "ES"].some((instrument) => blocks[instrument]?.availability === "fresh"),
      },
      anti_lookahead_compliant: true,
      computed_with_cutoff: timestampParis,
    };
  }
  const marketAvailability = buildReplayMarketAvailability(rowsByInstrument, snapshots, timestampParis);
  return { snapshots, integrity, raw_refs: rawRefs, market_availability: marketAvailability };
}

const REPLAY_TECH_INSTRUMENTS = Object.freeze(["AAPL", "MSFT", "NVDA", "SMH", "SOXX", "TSLA"]);

const REPLAY_US_CASH_INSTRUMENTS = new Set(["VIX", "US02Y", "US10Y", ...REPLAY_TECH_INSTRUMENTS]);

const REPLAY_EU_CASH_INSTRUMENTS = new Set(["DAX", "SX5E"]);

const REPLAY_ASIA_CASH_INSTRUMENTS = new Set(["NI225", "HSI"]);

const REPLAY_US_CASH_HOLIDAYS = new Set([
  "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27", "2024-06-19", "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25",
  "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

export function replayMarketState(instrument, timestampParis) {
  const parts = replayParisClock(timestampParis);
  const weekend = parts.day_of_week === 0 || parts.day_of_week === 6;
  let profile = "futures_24x5";
  let start = 0;
  let end = 24 * 60;
  if (REPLAY_US_CASH_INSTRUMENTS.has(instrument)) {
    profile = "us_cash";
    start = 15 * 60 + 30;
    end = 22 * 60 + 15;
  } else if (REPLAY_EU_CASH_INSTRUMENTS.has(instrument)) {
    profile = "europe_cash";
    start = 9 * 60;
    end = 17 * 60 + 35;
  } else if (REPLAY_ASIA_CASH_INSTRUMENTS.has(instrument)) {
    profile = "asia_cash";
    start = instrument === "HSI" ? 3 * 60 + 30 : 2 * 60;
    end = instrument === "HSI" ? 10 * 60 : 8 * 60;
  }
  const holiday = profile === "us_cash" && REPLAY_US_CASH_HOLIDAYS.has(parts.date);
  const expectedOpen = !weekend && !holiday && parts.minutes >= start && parts.minutes <= end;
  const phase = expectedOpen
    ? "open"
    : weekend || holiday || parts.minutes > end
      ? "market_closed"
      : "not_yet_open";
  return {
    profile,
    phase,
    expected_open: expectedOpen,
    reason: weekend ? "weekend" : holiday ? "cash_market_holiday" : expectedOpen ? "inside_expected_session" : phase,
  };
}

export function replayParisClock(timestampParis) {
  const match = String(timestampParis || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) return { date: null, minutes: 0, day_of_week: 0 };
  const [year, month, day] = match[1].split("-").map(Number);
  return {
    date: match[1],
    minutes: Number(match[2]) * 60 + Number(match[3]),
    day_of_week: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

export function replayAvailability({ selected, fallbackUsed, marketState, lastKnown }) {
  if (selected.length && !fallbackUsed) return "fresh";
  if (selected.length || lastKnown) return marketState.expected_open ? "missing_unexpected" : "stale_market_closed";
  return marketState.expected_open ? "missing_unexpected" : "not_yet_open";
}

export function replayRowTimestampMs(row) {
  return Date.parse(row?.timestamp_utc || row?.timestamp_paris || "");
}

export function compareReplayRows(left, right) {
  const delta = replayRowTimestampMs(left) - replayRowTimestampMs(right);
  if (delta) return delta;
  return replayTimeframeMinutes(left?.timeframe) - replayTimeframeMinutes(right?.timeframe);
}

export function rowVisibleAtReplayCutoff(row, timestampParis) {
  const value = replayRowTimestampMs(row);
  return Number.isFinite(value) && value <= Date.parse(timestampParis);
}

export function replayBarClosedAtCutoff(row, timestampParis) {
  const timestamp = replayRowTimestampMs(row);
  const duration = replayTimeframeMinutes(row?.timeframe);
  return Number.isFinite(timestamp) && timestamp + duration * 60 * 1000 <= Date.parse(timestampParis);
}

export function replayTimeframeMinutes(value) {
  const text = String(value || "").toUpperCase();
  if (["5", "5M", "M5"].includes(text)) return 5;
  if (["15", "15M", "M15"].includes(text)) return 15;
  if (["60", "1H", "H1"].includes(text)) return 60;
  if (["240", "4H", "H4"].includes(text)) return 240;
  return 0;
}

export function latestReplayObservation(rows, timestampParis) {
  return (rows || []).filter((row) => {
    if (!rowVisibleAtReplayCutoff(row, timestampParis)) return false;
    const duration = replayTimeframeMinutes(row?.timeframe);
    return duration < 60 || replayBarClosedAtCutoff(row, timestampParis);
  }).sort(compareReplayRows).at(-1) || null;
}

export function replayLastKnownSummary(row, timestampParis) {
  if (!row) return null;
  const timestamp = row.timestamp_paris || row.timestamp_utc || null;
  return {
    timeframe: String(row.timeframe || ""),
    timestamp_paris: timestamp,
    age_minutes: timestamp ? Math.max(0, Math.round((Date.parse(timestampParis) - Date.parse(timestamp)) / 60000)) : null,
    open: row.open ?? null,
    high: row.high ?? null,
    low: row.low ?? null,
    close: row.close ?? null,
  };
}

export function buildReplayMarketAvailability(rowsByInstrument, snapshots, timestampParis) {
  const instrumentAvailability = Object.fromEntries(Object.entries(snapshots["15m"]?.instruments || {}).map(([instrument, block]) => [instrument, {
    availability: block.availability,
    market_state: block.market_state,
    last_known: block.last_known,
    fresh_confirmation_available: block.availability === "fresh",
    usable_as_context: block.usable_as_context === true,
  }]));
  const cutoffDate = String(timestampParis).slice(0, 10);
  const techGaps = Object.fromEntries(REPLAY_TECH_INSTRUMENTS.map((instrument) => {
    const rows = (rowsByInstrument[instrument] || []).filter((row) => timeframeMatches(row.timeframe, "M5"));
    const current = rows.filter((row) => String(row.timestamp_paris || "").slice(0, 10) === cutoffDate);
    const previous = rows.filter((row) => String(row.timestamp_paris || "").slice(0, 10) < cutoffDate);
    const firstCurrent = current[0] || null;
    const previousClose = previous.at(-1) || null;
    const gapPoints = firstCurrent && previousClose ? Number(firstCurrent.open) - Number(previousClose.close) : null;
    const gapPct = Number.isFinite(gapPoints) && Number(previousClose?.close)
      ? roundNumber((gapPoints / Number(previousClose.close)) * 100, 4)
      : null;
    return [instrument, {
      status: firstCurrent && previousClose ? "ready" : "not_yet_open",
      previous_close: previousClose?.close ?? null,
      previous_close_timestamp_paris: previousClose?.timestamp_paris || null,
      current_session_open: firstCurrent?.open ?? null,
      current_session_open_timestamp_paris: firstCurrent?.timestamp_paris || null,
      gap_points: gapPoints,
      gap_pct: gapPct,
      usable_for_confirmation: Boolean(firstCurrent && previousClose),
    }];
  }));
  const vix = instrumentAvailability.VIX || { availability: "not_yet_open", last_known: null, fresh_confirmation_available: false };
  return {
    as_of_paris: timestampParis,
    instruments: instrumentAvailability,
    vix_context: {
      source_type: "cash_index",
      availability: vix.availability,
      last_known: vix.last_known,
      fresh_confirmation_available: vix.fresh_confirmation_available,
      overnight_proxy_available: false,
    },
    tech_gap_context: techGaps,
    interpretation_rules: {
      missing_unexpected: "Critical source expected to be open but absent; DATA_NOT_READY may be required.",
      stale_market_closed: "Use last_known for regime/context only; do not use it as a fresh trigger and do not classify it as a feed outage.",
      not_yet_open: "The current-session gap or confirmation is not applicable yet; do not treat it as missing data.",
      fresh: "The source has observations inside the requested replay window.",
    },
  };
}

export function timeframeMatches(value, expected) {
  const text = String(value || "").toUpperCase();
  if (expected === "M5") return ["5", "5M", "M5"].includes(text);
  if (expected === "M15") return ["15", "15M", "M15"].includes(text);
  if (expected === "H1") return ["60", "1H", "H1"].includes(text);
  if (expected === "H4") return ["240", "4H", "H4"].includes(text);
  return text === expected;
}

export function assertReplayLineage(run, { master, thesis, monitors = [], positions = [] }) {
  if (!master) throw deskError("MASTER_SCOPE_MISMATCH", "Replay Master is required for a monitor bundle.", { backtest_id: run.backtest_id });
  if (!thesis) throw deskError("THESIS_SCOPE_MISMATCH", "Replay thesis is required for a monitor bundle.", { backtest_id: run.backtest_id });
  const documents = [master, thesis, ...monitors, ...positions].filter(Boolean);
  for (const document of documents) {
    if (document.backtest_id !== run.backtest_id || (document.scope_hash && document.scope_hash !== run.scope_hash)) {
      throw deskError("CROSS_SCOPE_REFERENCE", "Replay document belongs to another run or strategy scope.", {
        backtest_id: run.backtest_id,
        document_id: document.analysis_id || document.thesis_id || document.monitor_id || document.position_id || null,
        document_backtest_id: document.backtest_id || null,
      });
    }
  }
  if (thesis.linked_master_analysis_id !== master.analysis_id) {
    throw deskError("THESIS_SCOPE_MISMATCH", "Replay thesis is not linked to the pinned Master.", {
      master_id: master.analysis_id,
      linked_master_analysis_id: thesis.linked_master_analysis_id || null,
    });
  }
  return true;
}

export function rollingInstrumentBlock(rows, raw, context = {}) {
  const first = rows[0] || null;
  const last = rows.at(-1) || null;
  const high = maxBy(rows, (row) => numeric(row.high, Number.NEGATIVE_INFINITY));
  const low = maxBy(rows, (row) => -numeric(row.low, Number.POSITIVE_INFINITY));
  const availability = context.availability || (rows.length ? "fresh" : "missing_unexpected");
  return {
    status: availability === "fresh" ? "ready" : availability === "missing_unexpected" ? "missing" : "stale",
    availability,
    market_state: context.market_state || null,
    timeframe_used: context.timeframe_used || (last?.timeframe ? String(last.timeframe) : null),
    fallback_used: context.fallback_used === true,
    row_count: rows.length,
    open: first?.open ?? null,
    high: high?.high ?? null,
    low: low?.low ?? null,
    close: last?.close ?? null,
    first_timestamp_paris: first?.timestamp_paris || null,
    last_timestamp_paris: last?.timestamp_paris || null,
    range_points: rows.length ? roundNumber((high?.high ?? 0) - (low?.low ?? 0)) : null,
    missing_reason: availability === "missing_unexpected" ? raw.missing_reason || raw.warning || "raw_window_missing" : null,
    last_known: context.last_known || null,
    usable_as_context: Boolean(rows.length || context.last_known),
    usable_for_fresh_confirmation: availability === "fresh",
    raw_refs: raw.raw_refs || (raw.raw_ref ? [raw.raw_ref] : []),
    attempted_raw_refs: raw.attempted_raw_refs || [],
  };
}

export function sourceHashPayload(bundle) {
  return stripVolatileSourceFields(bundle);
}

const VOLATILE_SOURCE_HASH_KEYS = new Set([
  "source_hash",
  "created_at",
  "created_at_utc",
  "created_at_paris",
  "updated_at",
  "updated_at_utc",
  "updated_at_paris",
  "saved_at",
  "saved_at_utc",
  "saved_at_paris",
  "completed_at",
  "completed_at_utc",
  "completed_at_paris",
  "locked_until_paris",
]);

export function stripVolatileSourceFields(value) {
  if (Array.isArray(value)) {
    return value.map(stripVolatileSourceFields);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !VOLATILE_SOURCE_HASH_KEYS.has(key))
        .map(([key, item]) => [key, stripVolatileSourceFields(item)]),
    );
  }
  return value;
}

export function hashObject(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildMasterSetupDocs(masterAnalysis, { analysis_id } = {}, tick = new SystemClock().now()) {
  const full = masterAnalysis.full_analysis || {};
  const setups = firstArray(
    masterAnalysis.setups,
    masterAnalysis.candidate_setups,
    masterAnalysis.setup_candidates,
    masterAnalysis.active_thesis?.setups,
    full.setups,
    full.candidate_setups,
    full.setup_candidates,
    full.active_thesis?.setups,
  );
  if (!setups.length) {
    return [];
  }
  const executive = full.executive_summary || {};
  const analysis = {
    ...full,
    ...executionScopeFields(masterAnalysis),
    analysis_id,
    pack_id: masterAnalysis.pack_id,
    pack_build_id: masterAnalysis.pack_build_id,
    report_id: masterAnalysis.report_id,
    decision_id: masterAnalysis.decision_id || full.decision_id || null,
    date: masterAnalysis.date || masterAnalysis.trading_date,
    trading_date: masterAnalysis.trading_date || masterAnalysis.date,
    session: masterAnalysis.session,
    timezone: masterAnalysis.timezone || "Europe/Paris",
    source_contract: masterAnalysis.contract_name || "DeskMasterAnalysisContract",
    schema_version: masterAnalysis.schema_version || "4.0.0",
    primary_setup_id: full.primary_setup_id || executive.primary_setup_id || full.final_setup_id || null,
    executive_summary: {
      ...executive,
      primary_setup_id: full.primary_setup_id || executive.primary_setup_id || full.final_setup_id || null,
    },
    setups,
  };
  return buildSetupDocs(analysis, { analysis_id, decision_id: analysis.decision_id }, tick).map((setup) => decorateMasterSetupDoc(setup, masterAnalysis));
}

export function decorateMasterSetupDoc(setup, masterAnalysis) {
  const fullAnalysis = masterAnalysis.full_analysis || {};
  const activeThesis = fullAnalysis.active_thesis || masterAnalysis.active_thesis || {};
  const replayTimeline = masterAnalysis.mode === "replay"
    || Boolean(masterAnalysis.backtest_id || masterAnalysis.replay_run_id);
  const linkedThesisSetupId = activeThesis.linked_setup_id || null;
  const inheritsThesisValidity = !linkedThesisSetupId
    || linkedThesisSetupId === setup.setup_id
    || setup.is_primary === true;
  const materializedAtParis = firstValidIso(
    setup.materialized_at_paris,
    setup.saved_at_paris,
    setup.created_at_paris,
  );
  const requestedValidFromParis = firstValidIso(
    setup.valid_from_paris,
    setup.valid_from,
    inheritsThesisValidity ? activeThesis.valid_from : null,
    masterAnalysis.cutoff_paris,
    masterAnalysis.as_of_utc,
  );
  // A Replay is evaluated on its immutable historical clock. The wall-clock
  // save time remains useful audit metadata, but must never move a historical
  // setup beyond its own expiry. LIVE keeps the anti-retroactive guard.
  const validFromParis = replayTimeline
    ? requestedValidFromParis
    : latestValidIso(requestedValidFromParis, materializedAtParis);
  const expiresAtParis = firstValidIso(
    setup.expires_at_paris,
    setup.expiry_paris,
    setup.setup_expiry_time,
    setup.expires_at,
    setup.valid_until,
    inheritsThesisValidity ? activeThesis.setup_expiry_time : null,
    inheritsThesisValidity ? activeThesis.valid_until : null,
  );
  const expiredBeforeMaterialization = Boolean(
    validFromParis
    && expiresAtParis
    && Date.parse(expiresAtParis) <= Date.parse(validFromParis),
  );
  const waitSetup = setup.instrument === "WAIT" || setup.direction === "wait" || ["wait", "wait_only", "no_trade"].includes(setup.setup_type);
  const replayable = !waitSetup && hasReplayGeometry(setup);
  const requestedStatus = setup.status || (waitSetup ? "wait" : setup.executable ? "executable" : "candidate");
  const status = expiredBeforeMaterialization ? "EXPIRED" : requestedStatus;
  const inheritedReplayStatus = setup.replay_status && setup.replay_status !== "pending" ? setup.replay_status : null;
  return {
    ...setup,
    source_contract: masterAnalysis.contract_name || "DeskMasterAnalysisContract",
    schema_version: masterAnalysis.schema_version || "4.0.0",
    source_analysis_collection: COLLECTIONS.deskMasterAnalyses,
    status,
    lifecycle_status: expiredBeforeMaterialization ? "EXPIRED" : setup.lifecycle_status || status,
    setup_status: expiredBeforeMaterialization ? "EXPIRED" : setup.setup_status || status,
    valid_from_paris: validFromParis || null,
    expires_at_paris: expiresAtParis || null,
    materialized_at_paris: materializedAtParis || null,
    backend_can_trigger: expiredBeforeMaterialization ? false : setup.backend_can_trigger,
    activation_eligible: !expiredBeforeMaterialization,
    activation_rejected: expiredBeforeMaterialization,
    activation_rejected_reason: expiredBeforeMaterialization
      ? replayTimeline
        ? "SETUP_EXPIRED_ON_REPLAY_TIMELINE"
        : "SETUP_EXPIRED_BEFORE_LIVE_MATERIALIZATION"
      : null,
    lifecycle_integrity_status: expiredBeforeMaterialization
      ? "SAFE_EXPIRED_BEFORE_ACTIVATION"
      : "VALID",
    lifecycle_integrity: {
      valid: true,
      safe_terminal: expiredBeforeMaterialization,
      historical_violation_repaired: false,
      activation_rejected_reason: expiredBeforeMaterialization
        ? replayTimeline
          ? "SETUP_EXPIRED_ON_REPLAY_TIMELINE"
          : "SETUP_EXPIRED_BEFORE_LIVE_MATERIALIZATION"
        : null,
      requested_valid_from_paris: requestedValidFromParis || null,
      materialized_at_paris: materializedAtParis || null,
      effective_valid_from_paris: validFromParis || null,
      expires_at_paris: expiresAtParis || null,
    },
    replayable,
    replay_status: inheritedReplayStatus || (waitSetup ? "wait" : replayable ? "not_replayed" : "not_replayable"),
    replay_result: setup.replay_result ?? null,
  };
}

function firstValidIso(...values) {
  return values.find((value) => value && Number.isFinite(Date.parse(value))) || null;
}

function latestValidIso(...values) {
  const valid = values
    .filter((value) => value && Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left));
  return valid[0] || null;
}

export function buildSetupDocs(analysis, { analysis_id, decision_id } = {}, tick = new SystemClock().now()) {
  const primarySetupId = analysis.primary_setup_id || analysis.executive_summary?.primary_setup_id || analysis.executable_decision?.setup_id || null;
  return (analysis.setups || []).map((setup, index) => {
    const setup_id = String(setup.setup_id || `setup_${index + 1}`);
    const setup_record_id = setup.setup_record_id || `${sanitizeId(analysis_id)}_${sanitizeId(setup_id)}`;
    const entryGeometry = canonicalSetupEntryGeometry(setup);
    return {
      ...setup,
      ...(entryGeometry.entry_zone ? {
        entry_zone: entryGeometry.entry_zone,
        entry_zone_lower: entryGeometry.entry_zone.from,
        entry_zone_upper: entryGeometry.entry_zone.to,
      } : {}),
      entry_execution_price: entryGeometry.execution_price,
      entry_execution_rule: entryGeometry.execution_rule,
      ...executionScopeFields(analysis),
      setup_record_id,
      setup_id,
      analysis_id,
      pack_id: setup.pack_id || analysis.pack_id,
      pack_build_id: setup.pack_build_id || analysis.pack_build_id,
      decision_id: setup.decision_id || decision_id || null,
      report_id: setup.report_id || analysis.report_id || null,
      date: setup.date || analysis.date,
      trading_date: setup.trading_date || analysis.trading_date || analysis.date,
      session: setup.session || analysis.session,
      timezone: setup.timezone || analysis.timezone || "Europe/Paris",
      source: setup.source || "chatgpt_desk",
      environment: setup.environment || analysis.environment || deskEnvironment(),
      priority: setup.priority ?? index + 1,
      is_primary: setup_id === primarySetupId,
      lifecycle_status: setup.lifecycle_status || setup.status || "draft",
      replay_status: setup.replay_status || "pending",
      created_at: setup.created_at ?? tick.utc,
      created_at_utc: setup.created_at_utc ?? tick.utc,
      created_at_paris: setup.created_at_paris ?? tick.paris,
      saved_at: tick.utc,
      saved_at_utc: tick.utc,
      saved_at_paris: tick.paris,
    };
  });
}

export function canonicalSetupEntryGeometry(setup = {}) {
  const zone = setup.entry_zone && typeof setup.entry_zone === "object" ? setup.entry_zone : {};
  const from = finiteNumber(zone.lower ?? zone.from ?? zone.low ?? zone.min ?? setup.entry_from);
  const to = finiteNumber(zone.upper ?? zone.to ?? zone.high ?? zone.max ?? setup.entry_to);
  const direct = finiteNumber(setup.entry_price ?? setup.entry ?? setup.trigger_price);
  const lower = from === null || to === null ? from ?? to : Math.min(from, to);
  const upper = from === null || to === null ? from ?? to : Math.max(from, to);
  const direction = String(setup.direction || "").toLowerCase();
  const executionPrice = direct ?? (
    lower === null || upper === null
      ? lower ?? upper
      : direction === "short"
        ? lower
        : upper
  );
  return {
    entry_zone: lower === null && upper === null
      ? null
      : { from: lower ?? upper, to: upper ?? lower },
    execution_price: executionPrice,
    execution_rule: direct !== null
      ? "explicit_entry_price"
      : direction === "short"
        ? "short_lower_bound"
        : direction === "long"
          ? "long_upper_bound"
          : "available_bound",
  };
}

export function executionScopeFields(source = {}) {
  return stripUndefined({
    strategy_id: source.strategy_id,
    session: source.session,
    mode: source.mode,
    trading_date: source.trading_date || source.date,
    run_id: source.run_id || source.replay_run_id,
    replay_run_id: source.replay_run_id,
    backtest_id: source.backtest_id,
    as_of_utc: source.as_of_utc,
    cutoff_paris: source.cutoff_paris,
    cutoff_utc: source.cutoff_utc,
    timezone: source.timezone,
    resolved_scope: source.resolved_scope,
    scope_hash: source.scope_hash || source.resolved_scope?.scope_hash,
    pack_build_id: source.pack_build_id,
  });
}

export function localM5DatasetName(instrument) {
  const name = String(instrument || "").toUpperCase();
  if (name === "MNQ" || name === "MNQ1!") return "MNQ_M5";
  if (name === "MES" || name === "MES1!") return "MES_M5";
  return `${name}_M5`;
}

export function sanitizeId(value) {
  return String(value || "id")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 180) || "id";
}

export const REPLAY_ORCHESTRATION_ALGORITHMS = Object.freeze({
  assertReplayBundleExecutable,
  assertReplayCanAdvance,
  assertReplayContractSave,
  assertRunPackScope,
  buildOrchestratedReplayRunDoc,
  buildReplayIntervalSimulation,
  buildReplayMasterBundle,
  buildReplayMonitorApplication,
  buildReplayMonitorBundle,
  buildReplayReplanContext,
  buildReplaySetupDocs,
  buildReplayStepDoc,
  certifyReplayRunResult,
  deriveActiveThesisFromMaster,
  nextReplayAction,
  normalizeReplayActiveThesis,
  normalizeReplayContextTransmission,
  normalizeReplayMasterAnalysis,
  normalizeReplayMonitor,
  offsetIso,
  patchReplayRun,
  patchReplayStep,
  patchReplayThesis,
  pinReplaySources,
  replayCreationResult,
  replayTimelineEvent,
  resolveReplayMasterPreparation,
  resolveReplayStep,
  scopedReplayChildId,
  selectBacktestSteps,
  selectLatestReplayMaster,
  selectReplayActiveThesis,
  selectReplayBundle,
  selectReplayBundleForRead,
  selectReplayBundles,
  selectReplayMonitorForStep,
  selectReplayMonitors,
  selectReplayPositions,
  selectReplayScopedSetups,
  selectReplayTimeline,
});
