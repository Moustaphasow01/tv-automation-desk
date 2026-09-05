import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { assertMonotonicReplayClock, prepareReplayMutation, replayIdempotencyDocumentId, replayRequestHash, resolveIdempotentReplayResult } from "./replay-concurrency.js";
import { getReplayBundleSectionView, getReplaySnapshotView, projectReplayBundle } from "./replay-bundle-view.js";
import {
  assertReplayWorkForSave,
  buildReplayAgentWorkItem,
  claimReplayWorkItem,
  completeReplayWorkItem,
  failReplayWorkItem,
  heartbeatReplayWorkItem,
  isClaimableWorkItem,
  pauseReplayWorkItem,
  replayWorkEvent,
  replayWorkMatchesRun,
  replayWorkOutputMaterialized,
  resumeReplayWorkItem,
  selectClaimableReplayWork,
  selectVisibleDeskWork,
  supersedeReplayWorkItem,
} from "./replay-agent-work.js";
import { normalizeGptTelemetry, sameGptTelemetry } from "./gpt-telemetry.js";
import {
  buildReplaySetupMutationDocsFromMonitor,
  selectOpenReplayPosition,
} from "./replay-continuity.js";
import { deskError } from "./desk-errors.js";
import { normalizeUtcIso } from "./desk-time-utils.js";
import { replayNextAction } from "./desk-replay-transition-map.js";
import { REPLAY_ORCHESTRATION_ALGORITHMS } from "./desk-replay-orchestration-algorithms.js";
import {
  DAILY_RUN_SCOPE,
  dailyRunPhaseAt,
  isDailyNyMasterCheckpoint,
} from "./daily-run-model.js";
import {
  isContextOnlyWorkerFailure,
  normalizeDeskInstrumentScopes,
} from "./data-availability-policy.js";
import {
  assertMasterSetupCoverage,
  assertMonitorSetupTransition,
} from "./desk-ai-worker-envelope.js";
import {
  canonicalizeMasterStrategyPayload,
  canonicalizeMonitorStrategyPayload,
} from "./canonical-strategy-runtime.js";
import {
  ACTIVE_STRATEGY_RUNTIME_VERSIONS,
  assertActiveStrategyRuntimePins,
  isActiveStrategyRuntimePins,
} from "./strategy-runtime-versioning.js";
import { GPT_MONITOR_CADENCE_MINUTES } from "./desk-monitor-cadence.js";

const COLLECTIONS = DESK_COLLECTIONS;
const REPLAY_AUTOPILOT_CONFIGS_COLLECTION = "desk_replay_autopilot_configs";
const FULL_DAY_REPLAY_CADENCE_MINUTES = GPT_MONITOR_CADENCE_MINUTES;
const REPLAY_SCOPED_DOCUMENT_LIMIT = 5_000;
const REPLAY_AUTOPILOT_RECOVERABLE_CODES = new Set([
  "AI_AGENTIC_BOOTSTRAP_INCOMPLETE",
  "AI_REPLAY_CONTEXT_INCOMPLETE",
  "CODEX_TEMP_ACL_FAILED",
  "CONTRACT_HANDSHAKE_BLOCKED",
  "CONTRACT_HANDSHAKE_UNAVAILABLE",
  "DETERMINISTIC_EXECUTION_PLAN_INVALID",
  "DETERMINISTIC_MONITOR_COMMAND_INVALID",
  "MCP_RATE_LIMIT",
  "MONITOR_REVISION_CONFLICT",
  "SAVE_REPLAY_MONITOR_DOCUMENT_UNDEFINED_HEALTH_SCORE",
  "SAVE_DOCUMENT_UNDEFINED",
  "RETRYABLE_FAILURE",
  "WORK_ALREADY_CLAIMED_SAVE_BLOCKED",
]);

function replayCadenceMinutes(run, state = {}) {
  const explicit = replayCadenceValueToMinutes(run.cadence || run.monitor_cadence);
  const recommended = Number(state?.recommended_replay_cadence?.recommended_minutes);
  // The run's explicit cadence is authoritative. Historical M5 runs preserve
  // their original semantics while new runs default to the hybrid M15/M1 policy.
  const baseCadence = explicit
    || (Number.isFinite(recommended) && recommended > 0
      ? Math.max(1, Math.min(240, recommended))
      : FULL_DAY_REPLAY_CADENCE_MINUTES);
  const candidates = [baseCadence];
  const checkpointMinutes = nextReplayCheckpointMinutes(run, state);
  if (checkpointMinutes) candidates.push(checkpointMinutes);
  const remainingMinutes = remainingReplayWindowMinutes(run);
  if (remainingMinutes) candidates.push(remainingMinutes);
  return Math.max(1, Math.min(...candidates));
}

function replayCadenceValueToMinutes(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (["m5", "5", "5m"].includes(normalized)) return 5;
  if (["m15", "15", "15m"].includes(normalized)) return 15;
  if (["m30", "30", "30m"].includes(normalized)) return 30;
  if (["h1", "1h", "60", "60m"].includes(normalized)) return 60;
  const parsed = Number.parseInt(normalized.replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.min(240, parsed));
}

function nextReplayCheckpointMinutes(run = {}, state = {}) {
  const currentMs = Date.parse(run.current_replay_time || state.replay_time || "");
  if (!Number.isFinite(currentMs)) return null;
  const checkpoints = Array.isArray(state.event_checkpoints) ? state.event_checkpoints : [];
  const next = checkpoints
    .map((checkpoint) => Date.parse(checkpoint.checkpoint_paris || checkpoint.timestamp_paris || checkpoint.time || ""))
    .filter((value) => Number.isFinite(value) && value > currentMs)
    .sort((left, right) => left - right)[0];
  if (!Number.isFinite(next)) return null;
  return Math.max(1, Math.ceil((next - currentMs) / 60000));
}

function remainingReplayWindowMinutes(run = {}) {
  const currentMs = Date.parse(run.current_replay_time || "");
  const endMs = Date.parse(run.end_time || "");
  if (!Number.isFinite(currentMs) || !Number.isFinite(endMs) || endMs <= currentMs) return null;
  return Math.max(1, Math.ceil((endMs - currentMs) / 60000));
}

export class DeskReplayService {
  constructor({ persistence, clock, host }) {
    this.persistence = persistence;
    this.clock = clock;
    this.host = host;
    this.algorithms = REPLAY_ORCHESTRATION_ALGORITHMS;
  }

  async listReplayDocuments(collection, backtestId, {
    limit = REPLAY_SCOPED_DOCUMENT_LIMIT,
    orderBy = [],
  } = {}) {
    if (!backtestId) {
      throw deskError("SCOPE_REQUIRED", "backtest_id is required for a replay-scoped document read.");
    }
    if (typeof this.persistence.queryCollectionDocuments === "function") {
      return this.persistence.queryCollectionDocuments({
        collection,
        filters: [{ field: "backtest_id", operator: "==", value: backtestId }],
        orderBy,
        limit,
      });
    }
    const documents = await this.persistence.listDocuments(collection);
    return documents
      .filter((document) => document.backtest_id === backtestId)
      .slice(0, Math.max(1, Math.min(Number(limit) || REPLAY_SCOPED_DOCUMENT_LIMIT, REPLAY_SCOPED_DOCUMENT_LIMIT)));
  }

  async driveAutomation({ backtest_id, max_transitions = 8 } = {}) {
    const h = this.algorithms;
    const transitions = [];
    for (let index = 0; index < Math.max(1, Math.min(Number(max_transitions) || 8, 12)); index += 1) {
      const state = await this.host.getReplayState({ backtest_id });
      const run = state.selected_backtest;
      const step = state.current_step;
      if (!run) throw deskError("RUN_NOT_FOUND", `Replay run not found: ${backtest_id}.`);
      assertActiveStrategyRuntimePins(run, { operation: "drive_replay_automation" });
      if (run.automation_enabled !== true) {
        return { ok: true, status: "PAUSED", backtest_id, replay_status: run.status, transitions };
      }
      if (["WAITING_GPT_MASTER", "WAITING_GPT_MONITOR"].includes(run.status)) {
        return {
          ok: true,
          status: "WAITING_GPT",
          backtest_id,
          replay_status: run.status,
          work_item_id: state.current_work_item?.work_item_id || null,
          workflow: state.current_work_item?.workflow || null,
          transitions,
        };
      }
      if (["COMPLETED", "DAY_END", "FAILED", "CANCELLED"].includes(run.status)) {
        return { ok: true, status: "TERMINAL", backtest_id, replay_status: run.status, transitions };
      }

      const common = {
        backtest_id,
        step_id: step?.step_id,
        expected_revision: Number(run.revision || 0),
      };
      const key = (operation) => `replay-auto:${operation}:${step?.step_id || "run"}:${Number(run.revision || 0)}`;
      let result;
      if (["MASTER_DATA_PREPARING", "CREATED", "REPLAN_REQUIRED"].includes(run.status)) {
        result = await this.prepareReplayMasterBundle({ ...common, idempotency_key: key("prepare-master"), include_raw_refs: false });
      } else if (["READY_FOR_NEXT_MONITOR", "WAITING_NEXT_STEP", "SIMULATION_UPDATED", "MASTER_MATERIALIZED"].includes(run.status)) {
        result = await this.advanceReplayClock({ ...common, idempotency_key: key("advance-clock"), minutes: replayCadenceMinutes(run, state) });
      } else if (run.status === "MONITOR_DATA_PREPARING" && !step?.simulation_ref) {
        result = await this.simulateReplayInterval({ ...common, idempotency_key: key("simulate-interval") });
      } else if (run.status === "MONITOR_DATA_PREPARING") {
        result = await this.prepareReplayMonitorBundle({ ...common, idempotency_key: key("prepare-monitor"), timestamp_paris: step?.timestamp_paris, include_raw_refs: false });
      } else if (["MONITOR_SAVED", "MONITOR_APPLIED"].includes(run.status)) {
        result = await this.applyReplayMonitorResult({ ...common, idempotency_key: key("apply-monitor") });
      } else {
        return { ok: false, status: "BLOCKED", backtest_id, replay_status: run.status, reason: "unsupported_automatic_transition", transitions };
      }
      transitions.push({ from_status: run.status, operation: result?.next_action || h.nextReplayAction(run.status), to_status: result?.status || null, revision: result?.revision ?? null });
    }
    const finalState = await this.host.getReplayState({ backtest_id });
    return { ok: true, status: "TRANSITION_LIMIT", backtest_id, replay_status: finalState.status, transitions };
  }

  async createOrchestratedReplayDay(args = {}) {
    const h = this.algorithms;
    const tick = this.clock.now();
    const baseRun = h.buildOrchestratedReplayRunDoc(args, tick);
    const creationHash = replayRequestHash("create_orchestrated_replay", args);
    const existing = await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, baseRun.backtest_id).catch(() => null);
    if (existing) {
      if (existing.creation_idempotency_key === args.idempotency_key && existing.creation_request_hash === creationHash) {
        return h.replayCreationResult(existing, null, { idempotent_replay: true });
      }
      throw deskError("IDEMPOTENCY_CONFLICT", `Replay run already exists: ${baseRun.backtest_id}.`);
    }
    const pack = await this.host.getDeskPack({ pack_id: baseRun.pack_id, pack_build_id: baseRun.pack_build_id, mode: "replay" });
    h.assertRunPackScope(baseRun, pack);
    const contracts = await this.host.getActiveContracts();
    const run = h.pinReplaySources(baseRun, pack, contracts, creationHash, tick);
    const step = h.buildReplayStepDoc(run, {
      sequence: 1,
      step_type: "MASTER",
      status: "MASTER_DATA_PREPARING",
      timestamp_paris: run.current_replay_time,
    }, tick);
    const replayRun = { ...run, current_step_id: step.step_id };
    const timeline = h.replayTimelineEvent(replayRun, step, {
      event_type: "RUN_CREATED",
      phase: "Replay",
      action: "START_REPLAY_DAY",
      status: replayRun.status,
      note: "Orchestrated GPT replay created without initial setups.",
    }, tick);
    const result = h.replayCreationResult(replayRun, step);
    if (typeof this.persistence.createReplayRun === "function") {
      const committed = await this.persistence.createReplayRun({
        runCollection: COLLECTIONS.deskReplayRuns,
        idempotencyCollection: COLLECTIONS.deskReplayIdempotency,
        run: replayRun,
        idempotencyKey: args.idempotency_key,
        requestHash: creationHash,
        writes: [
          { collection: COLLECTIONS.deskReplaySteps, documentId: step.step_id, data: step },
          { collection: COLLECTIONS.deskReplayTimeline, documentId: timeline.event_id, data: timeline },
        ],
        result,
        tick,
      });
      if (replayRun.automation_enabled) {
        return { ...committed.result, automation: await this.driveAutomation({ backtest_id: replayRun.backtest_id }) };
      }
      return committed.result;
    }
    await this.persistence.setDocument(COLLECTIONS.deskReplayRuns, replayRun.backtest_id, replayRun);
    await this.persistence.setDocument(COLLECTIONS.deskReplaySteps, step.step_id, step);
    await this.persistence.setDocument(COLLECTIONS.deskReplayTimeline, timeline.event_id, timeline);
    if (replayRun.automation_enabled) {
      return { ...result, automation: await this.driveAutomation({ backtest_id: replayRun.backtest_id }) };
    }
    return result;
  }

  async prepareReplayMasterBundle(args = {}) {
    const h = this.algorithms;
    const tick = this.clock.now();
    const run = await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, args.backtest_id);
    const begin = await this.beginMutation(run, args, {
      operation: "prepare_replay_master_bundle",
      nextStatus: "WAITING_GPT_MASTER",
      allowedStatuses: ["MASTER_DATA_PREPARING", "CREATED", "REPLAN_REQUIRED"],
    });
    if (begin.existing_result) return begin.existing_result;
    const steps = h.selectBacktestSteps(await this.listReplayDocuments(COLLECTIONS.deskReplaySteps, run.backtest_id), run.backtest_id);
    const preparation = h.resolveReplayMasterPreparation(steps, run, args.step_id, tick);
    const step = preparation.step;
    const replanContext = preparation.is_replan
      ? h.buildReplayReplanContext(run, preparation, {
          master: h.selectLatestReplayMaster(await this.listReplayDocuments(COLLECTIONS.deskReplayMasterAnalyses, run.backtest_id), run.backtest_id),
          thesis: h.selectReplayActiveThesis(await this.listReplayDocuments(COLLECTIONS.deskReplayActiveTheses, run.backtest_id), run.backtest_id),
          setups: h.selectReplayScopedSetups(await this.listReplayDocuments(COLLECTIONS.deskReplaySetups, run.backtest_id), run.backtest_id),
          monitor: h.selectReplayMonitors(await this.listReplayDocuments(COLLECTIONS.deskReplayMonitors, run.backtest_id), run.backtest_id)[0] || null,
          position: h.selectReplayPositions(await this.listReplayDocuments(COLLECTIONS.deskReplayPositions, run.backtest_id), run.backtest_id)[0] || null,
        })
      : null;
    const bundle = await h.buildReplayMasterBundle(this.host, run, step, args, this.clock, replanContext);
    h.assertReplayBundleExecutable(bundle);
    const readyStep = h.patchReplayStep(step, {
      status: "WAITING_GPT_MASTER",
      bundle_id: bundle.bundle_id,
      bundle_ref: { collection: COLLECTIONS.deskReplayBundles, document_id: bundle.bundle_id },
      source_hash: bundle.source_hash,
      source_manifest_hash: bundle.source_manifest_hash,
      anti_lookahead_compliant: true,
      validation_result: "passed",
    }, tick);
    let readyRun = h.patchReplayRun(run, {
      status: "WAITING_GPT_MASTER",
      current_step_id: readyStep.step_id,
      latest_bundle_id: bundle.bundle_id,
    }, tick);
    const workItem = readyRun.automation_enabled ? buildReplayAgentWorkItem({ run: readyRun, step: readyStep, bundle, tick }) : null;
    if (workItem) readyRun = h.patchReplayRun(readyRun, { current_work_item_id: workItem.work_item_id, automation_status: "waiting_gpt" }, tick);
    const timeline = h.replayTimelineEvent(readyRun, readyStep, {
      event_type: "MASTER_BUNDLE_READY",
      phase: "Master",
      action: "WAITING_GPT_MASTER",
      status: readyRun.status,
      note: "Cutoff-scoped Master bundle ready for manual ChatGPT analysis.",
      ref: { collection: COLLECTIONS.deskReplayBundles, document_id: bundle.bundle_id },
      anti_lookahead_compliant: true,
    }, tick);
    const result = { ok: true, backtest_id: readyRun.backtest_id, step_id: readyStep.step_id, status: readyRun.status, bundle_id: bundle.bundle_id, bundle: projectReplayBundle(bundle, { view: "compact" }), work_item: workItem ? deskWorkSummary(workItem) : null, next_action: h.nextReplayAction(readyRun.status) };
    const committed = await this.commitMutation({
      run,
      runPatch: readyRun,
      mutation: begin.mutation,
      writes: [
        { collection: COLLECTIONS.deskReplayBundles, documentId: bundle.bundle_id, data: bundle },
        { collection: COLLECTIONS.deskReplaySteps, documentId: readyStep.step_id, data: readyStep },
        { collection: COLLECTIONS.deskReplayTimeline, documentId: timeline.event_id, data: timeline },
        ...(workItem ? [
          { collection: COLLECTIONS.deskAgentWorkItems, documentId: workItem.work_item_id, data: workItem },
          { collection: COLLECTIONS.deskAgentWorkEvents, documentId: `${workItem.work_item_id}__ready__${tick.epochMs}`, data: replayWorkEvent(workItem, "READY", tick) },
        ] : []),
      ],
      result,
      tick,
    });
    return committed.result;
  }

  async getReplayMasterBundle(args = {}) {
    const h = this.algorithms;
    const bundles = h.selectReplayBundles(await this.listReplayDocuments(COLLECTIONS.deskReplayBundles, args.backtest_id), args.backtest_id);
    const bundle = h.selectReplayBundle(bundles, { step_id: args.step_id, bundle_type: "master" });
    if (!bundle) throw new Error("replay_master_bundle_not_found");
    const run = await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, args.backtest_id).catch(() => null);
    const workItem = run?.current_work_item_id
      ? await this.persistence.getDocument(COLLECTIONS.deskAgentWorkItems, run.current_work_item_id).catch(() => null)
      : null;
    return projectReplayBundle(enrichReplayBundleSaveTargetForClaim(bundle, workItem), { ...args, bundle_type: "master" });
  }

  async validateReplayMasterStrategyPayload(args = {}) {
    const run = await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, args.backtest_id);
    return canonicalizeMasterStrategyPayload(args, {
      workflow: "REPLAY_MASTER",
      run,
      sourceMode: "replay",
    });
  }

  async saveReplayMasterAnalysis(args = {}) {
    const h = this.algorithms;
    const tick = this.clock.now();
    const run = await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, args.backtest_id);
    if ((args.replay_execution_policy_version || run?.replay_execution_policy_version) === "3.0.0") {
      assertMasterSetupCoverage(args, { workflow: "REPLAY_MASTER" });
    }
    const workItemId = args.work_item_id || run.current_work_item_id || null;
    const workItem = workItemId ? await this.persistence.getDocument(COLLECTIONS.deskAgentWorkItems, workItemId).catch(() => null) : null;
    if (args.work_item_id) assertReplayWorkForSave(workItem, args, "REPLAY_MASTER", tick);
    else if (workItem?.status === "CLAIMED") throw deskError("WORK_ALREADY_CLAIMED", "Pause automation before using the manual Master save path.");
    const begin = await this.beginMutation(run, args, {
      operation: "save_replay_master_analysis",
      nextStatus: "READY_FOR_NEXT_MONITOR",
      allowedStatuses: ["WAITING_GPT_MASTER", "REPLAN_REQUIRED"],
    });
    if (begin.existing_result) return begin.existing_result;
    const steps = h.selectBacktestSteps(await this.listReplayDocuments(COLLECTIONS.deskReplaySteps, run.backtest_id), run.backtest_id);
    const step = h.resolveReplayStep(steps, run, args.step_id, "MASTER");
    h.assertReplayContractSave(run, args, "master", step);
    const canonicalArgs = canonicalizeMasterStrategyPayload(args, {
      workflow: "REPLAY_MASTER",
      run,
      sourceMode: "replay",
    });
    const master = h.normalizeReplayMasterAnalysis(canonicalArgs, run, step, tick);
    const setupDocs = h.buildReplaySetupDocs(master, run, step, tick);
    const thesis = h.normalizeReplayActiveThesis(canonicalArgs.active_thesis || h.deriveActiveThesisFromMaster(master), master, run, step, tick);
    const writes = [{ collection: COLLECTIONS.deskReplayMasterAnalyses, documentId: master.analysis_id, data: master }];
    writes.push(...setupDocs.map((setup) => ({ collection: COLLECTIONS.deskReplaySetups, documentId: setup.setup_record_id, data: setup })));
    if (thesis) writes.push({ collection: COLLECTIONS.deskReplayActiveTheses, documentId: thesis.thesis_id, data: thesis });
    if (canonicalArgs.context_transmission) {
      const context = h.normalizeReplayContextTransmission(canonicalArgs.context_transmission, run, step, { linked_analysis_id: master.analysis_id }, tick);
      writes.push({ collection: COLLECTIONS.deskReplayContextTransmissions, documentId: context.context_id, data: context });
    }
    const savedStep = h.patchReplayStep(step, {
      status: "MASTER_MATERIALIZED",
      output_ref: { collection: COLLECTIONS.deskReplayMasterAnalyses, document_id: master.analysis_id },
      setup_count: setupDocs.length,
      thesis_id: thesis?.thesis_id || null,
    }, tick);
    const savedRun = h.patchReplayRun(run, {
      status: "READY_FOR_NEXT_MONITOR",
      linked_master_analysis_id: master.analysis_id,
      active_replay_thesis_id: thesis?.thesis_id || null,
      current_phase: savedStep.phase || run.current_phase || run.session,
      phase_master_ids: {
        ...(run.phase_master_ids || {}),
        [savedStep.phase || run.current_phase || run.session]: master.analysis_id,
      },
      last_replan_at_paris: step.is_replan || run.pending_replan_reason
        ? step.timestamp_paris
        : run.last_replan_at_paris || null,
      last_replan_master_id: step.is_replan || run.pending_replan_reason
        ? master.analysis_id
        : run.last_replan_master_id || null,
      pending_replan_reason: null,
      current_step_id: savedStep.step_id,
      setup_count: setupDocs.length,
      current_work_item_id: null,
      last_completed_work_item_id: workItem?.work_item_id || run.last_completed_work_item_id || null,
      automation_status: run.automation_enabled ? "running" : run.automation_status,
    }, tick);
    const timeline = h.replayTimelineEvent(savedRun, savedStep, {
      event_type: "GPT_MASTER_SAVED",
      phase: "Master",
      action: "MASTER_MATERIALIZED",
      status: savedRun.status,
      note: `Master saved; ${setupDocs.length} replay setup(s) materialized.`,
      ref: { collection: COLLECTIONS.deskReplayMasterAnalyses, document_id: master.analysis_id },
      anti_lookahead_compliant: true,
    }, tick);
    writes.push(
      { collection: COLLECTIONS.deskReplaySteps, documentId: savedStep.step_id, data: savedStep },
      { collection: COLLECTIONS.deskReplayTimeline, documentId: timeline.event_id, data: timeline },
    );
    if (workItem) {
      const completedWork = completeReplayWorkItem(workItem, {
        worker_id: args.worker_id,
        lease_token: args.lease_token,
        output_ref: { collection: COLLECTIONS.deskReplayMasterAnalyses, document_id: master.analysis_id },
      }, tick, { allowMaterialized: !args.work_item_id });
      writes.push(
        { collection: COLLECTIONS.deskAgentWorkItems, documentId: completedWork.work_item_id, data: completedWork },
        { collection: COLLECTIONS.deskAgentWorkEvents, documentId: `${completedWork.work_item_id}__completed__${tick.epochMs}`, data: replayWorkEvent(completedWork, "COMPLETED", tick, { worker_id: args.worker_id }) },
      );
    }
    const result = { ok: true, backtest_id: savedRun.backtest_id, step_id: savedStep.step_id, status: savedRun.status, analysis_id: master.analysis_id, setup_count: setupDocs.length, setup_ids: setupDocs.map((setup) => setup.setup_record_id), active_replay_thesis_id: thesis?.thesis_id || null, next_action: h.nextReplayAction(savedRun.status) };
    let committed;
    try {
      committed = await this.commitMutation({
        run, runPatch: savedRun, mutation: begin.mutation, writes, result, tick,
        preconditions: args.work_item_id ? [{
          collection: COLLECTIONS.deskAgentWorkItems,
          documentId: args.work_item_id,
          equals: { status: "CLAIMED", claimed_by: args.worker_id, lease_token: args.lease_token },
        }] : [],
      });
    } catch (error) {
      if (error?.code === "REVISION_CONFLICT") {
        throw deskError("MONITOR_REVISION_CONFLICT", "Replay Monitor revision changed before atomic commit.", {
          expected_revision: args.expected_revision,
          backtest_id: run.backtest_id,
        });
      }
      throw error;
    }
    return run.automation_enabled ? { ...committed.result, automation: await this.driveAutomation({ backtest_id: run.backtest_id }) } : committed.result;
  }

  async advanceReplayClock(args = {}) {
    const h = this.algorithms;
    const tick = this.clock.now();
    const run = await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, args.backtest_id);
    h.assertReplayCanAdvance(run, args);
    const steps = h.selectBacktestSteps(await this.listReplayDocuments(COLLECTIONS.deskReplaySteps, run.backtest_id), run.backtest_id);
    const sequence = steps.length + 1;
    const timestamp = h.offsetIso(run.current_replay_time, (Number(args.minutes) || 15) * 60 * 1000);
    if (run.end_time && Date.parse(timestamp) > Date.parse(run.end_time)) {
      const begin = await this.beginMutation(run, args, {
        operation: "advance_replay_clock",
        nextStatus: "COMPLETED",
        allowedStatuses: ["READY_FOR_NEXT_MONITOR", "WAITING_NEXT_STEP", "SIMULATION_UPDATED", "MASTER_MATERIALIZED"],
      });
      if (begin.existing_result) return begin.existing_result;
      const [positions, simulations, setups, masterAnalyses] = await Promise.all([
        this.listReplayDocuments(COLLECTIONS.deskReplayPositions, run.backtest_id)
          .then((items) => h.selectReplayPositions(items, run.backtest_id)),
        this.listReplayDocuments(COLLECTIONS.deskReplayTradeSimulations, run.backtest_id),
        this.listReplayDocuments(COLLECTIONS.deskReplaySetups, run.backtest_id)
          .then((items) => h.selectReplayScopedSetups(items, run.backtest_id)),
        this.listReplayDocuments(COLLECTIONS.deskReplayMasterAnalyses, run.backtest_id),
      ]);
      const certification = h.certifyReplayRunResult({
        run,
        positions,
        simulations,
        setups,
        masterAnalyses,
      });
      const ended = h.patchReplayRun(run, {
        status: "COMPLETED",
        completed_at_utc: tick.utc,
        result_eligible: certification.result_eligible,
        aggregate_eligible: certification.aggregate_eligible,
        result_certification_status: certification.status,
        result_certification: certification,
        result_certified_at_utc: tick.utc,
      }, tick);
      const result = { ok: true, backtest_id: ended.backtest_id, status: ended.status, next_action: h.nextReplayAction(ended.status) };
      return (await this.commitMutation({ run, runPatch: ended, mutation: begin.mutation, result, tick })).result;
    }
    assertMonotonicReplayClock(run.current_replay_time, timestamp, run.end_time || null);
    if (run.run_scope === DAILY_RUN_SCOPE
      && isDailyNyMasterCheckpoint(timestamp)
      && !run.phase_master_ids?.ny_open) {
      const begin = await this.beginMutation(run, args, {
        operation: "advance_replay_clock",
        nextStatus: "REPLAN_REQUIRED",
        allowedStatuses: ["READY_FOR_NEXT_MONITOR", "WAITING_NEXT_STEP", "SIMULATION_UPDATED", "MASTER_MATERIALIZED"],
      });
      if (begin.existing_result) return begin.existing_result;
      const boundaryStep = {
        ...(steps.find((item) => item.step_id === run.current_step_id) || null),
        timestamp_paris: timestamp,
        cutoff_paris: timestamp,
        phase: "ny_open",
      };
      const advancedRun = h.patchReplayRun(run, {
        status: "REPLAN_REQUIRED",
        current_replay_time: timestamp,
        current_phase: "ny_open",
        pending_replan_reason: "DAILY_PHASE_BOUNDARY_NY_MASTER",
      }, tick);
      const timeline = h.replayTimelineEvent(advancedRun, boundaryStep, {
        event_type: "PHASE_BOUNDARY_REPLAN_REQUIRED",
        phase: "New York",
        action: "PREPARE_NY_MASTER",
        status: advancedRun.status,
        note: "Daily replay reached 15:30 Paris; a new Master is required inside the same continuous run.",
        anti_lookahead_compliant: true,
      }, tick);
      const result = {
        ok: true,
        backtest_id: advancedRun.backtest_id,
        step_id: run.current_step_id,
        status: advancedRun.status,
        current_replay_time: timestamp,
        current_phase: advancedRun.current_phase,
        next_action: h.nextReplayAction(advancedRun.status),
      };
      return (await this.commitMutation({
        run,
        runPatch: advancedRun,
        mutation: begin.mutation,
        writes: [{ collection: COLLECTIONS.deskReplayTimeline, documentId: timeline.event_id, data: timeline }],
        result,
        tick,
      })).result;
    }
    const begin = await this.beginMutation(run, args, {
      operation: "advance_replay_clock",
      nextStatus: "MONITOR_DATA_PREPARING",
      allowedStatuses: ["READY_FOR_NEXT_MONITOR", "WAITING_NEXT_STEP", "SIMULATION_UPDATED", "MASTER_MATERIALIZED"],
    });
    if (begin.existing_result) return begin.existing_result;
    const step = h.buildReplayStepDoc(run, {
      sequence,
      step_type: "MONITOR",
      status: "MONITOR_DATA_PREPARING",
      timestamp_paris: timestamp,
      previous_step_id: run.current_step_id,
    }, tick);
    const advancedRun = h.patchReplayRun(run, {
      status: "MONITOR_DATA_PREPARING",
      current_step_id: step.step_id,
      current_replay_time: timestamp,
      current_phase: run.run_scope === DAILY_RUN_SCOPE ? dailyRunPhaseAt(timestamp) : run.current_phase || run.session,
    }, tick);
    const timeline = h.replayTimelineEvent(advancedRun, step, {
      event_type: "CLOCK_ADVANCED",
      phase: "Clock",
      action: `ADVANCE_${Number(args.minutes) || 15}M`,
      status: advancedRun.status,
      note: `Replay clock advanced to ${timestamp}.`,
      anti_lookahead_compliant: true,
    }, tick);
    const result = { ok: true, backtest_id: advancedRun.backtest_id, step_id: step.step_id, status: advancedRun.status, current_replay_time: timestamp, step, next_action: h.nextReplayAction(advancedRun.status) };
    return (await this.commitMutation({
      run,
      runPatch: advancedRun,
      mutation: begin.mutation,
      writes: [
        { collection: COLLECTIONS.deskReplaySteps, documentId: step.step_id, data: step },
        { collection: COLLECTIONS.deskReplayTimeline, documentId: timeline.event_id, data: timeline },
      ],
      result,
      tick,
    })).result;
  }

  async prepareReplayMonitorBundle(args = {}) {
    const h = this.algorithms;
    const tick = this.clock.now();
    const run = await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, args.backtest_id);
    const begin = await this.beginMutation(run, args, {
      operation: "prepare_replay_monitor_bundle",
      nextStatus: "WAITING_GPT_MONITOR",
      allowedStatuses: ["MONITOR_DATA_PREPARING"],
    });
    if (begin.existing_result) return begin.existing_result;
    const steps = h.selectBacktestSteps(await this.listReplayDocuments(COLLECTIONS.deskReplaySteps, run.backtest_id), run.backtest_id);
    const step = h.resolveReplayStep(steps, run, args.step_id, "MONITOR");
    const monitorStep = h.patchReplayStep(step, { status: "MONITOR_DATA_PREPARING", timestamp_paris: args.timestamp_paris || step.timestamp_paris }, tick);
    const monitorRun = h.patchReplayRun(run, { status: "MONITOR_DATA_PREPARING", current_step_id: monitorStep.step_id, current_replay_time: monitorStep.timestamp_paris }, tick);
    const replayDocs = {
      master: h.selectLatestReplayMaster(await this.listReplayDocuments(COLLECTIONS.deskReplayMasterAnalyses, run.backtest_id), run.backtest_id),
      thesis: h.selectReplayActiveThesis(await this.listReplayDocuments(COLLECTIONS.deskReplayActiveTheses, run.backtest_id), run.backtest_id),
      setups: h.selectReplayScopedSetups(await this.listReplayDocuments(COLLECTIONS.deskReplaySetups, run.backtest_id), run.backtest_id),
      monitors: h.selectReplayMonitors(await this.listReplayDocuments(COLLECTIONS.deskReplayMonitors, run.backtest_id), run.backtest_id),
      positions: h.selectReplayPositions(await this.listReplayDocuments(COLLECTIONS.deskReplayPositions, run.backtest_id), run.backtest_id),
    };
    const bundle = await h.buildReplayMonitorBundle(this.host, monitorRun, monitorStep, replayDocs, args, this.clock);
    h.assertReplayBundleExecutable(bundle);
    const readyStep = h.patchReplayStep(monitorStep, {
      status: "WAITING_GPT_MONITOR",
      bundle_id: bundle.bundle_id,
      bundle_ref: { collection: COLLECTIONS.deskReplayBundles, document_id: bundle.bundle_id },
      source_hash: bundle.source_hash,
      source_manifest_hash: bundle.source_manifest_hash,
      anti_lookahead_compliant: true,
      validation_result: "passed",
    }, tick);
    let readyRun = h.patchReplayRun(monitorRun, { status: "WAITING_GPT_MONITOR", latest_bundle_id: bundle.bundle_id }, tick);
    const workItem = readyRun.automation_enabled ? buildReplayAgentWorkItem({ run: readyRun, step: readyStep, bundle, tick }) : null;
    if (workItem) readyRun = h.patchReplayRun(readyRun, { current_work_item_id: workItem.work_item_id, automation_status: "waiting_gpt" }, tick);
    const timeline = h.replayTimelineEvent(readyRun, readyStep, {
      event_type: "MONITOR_BUNDLE_READY",
      phase: "Monitor",
      action: "WAITING_GPT_MONITOR",
      status: readyRun.status,
      note: "Replay monitor bundle ready for manual ChatGPT analysis.",
      ref: { collection: COLLECTIONS.deskReplayBundles, document_id: bundle.bundle_id },
      anti_lookahead_compliant: true,
    }, tick);
    const result = { ok: true, backtest_id: readyRun.backtest_id, step_id: readyStep.step_id, status: readyRun.status, bundle_id: bundle.bundle_id, bundle: projectReplayBundle(bundle, { view: "compact" }), work_item: workItem ? deskWorkSummary(workItem) : null, next_action: h.nextReplayAction(readyRun.status) };
    return (await this.commitMutation({
      run,
      runPatch: readyRun,
      mutation: begin.mutation,
      writes: [
        { collection: COLLECTIONS.deskReplayBundles, documentId: bundle.bundle_id, data: bundle },
        { collection: COLLECTIONS.deskReplaySteps, documentId: readyStep.step_id, data: readyStep },
        { collection: COLLECTIONS.deskReplayTimeline, documentId: timeline.event_id, data: timeline },
        ...(workItem ? [
          { collection: COLLECTIONS.deskAgentWorkItems, documentId: workItem.work_item_id, data: workItem },
          { collection: COLLECTIONS.deskAgentWorkEvents, documentId: `${workItem.work_item_id}__ready__${tick.epochMs}`, data: replayWorkEvent(workItem, "READY", tick) },
        ] : []),
      ],
      result,
      tick,
    })).result;
  }

  async getReplayMonitorBundle(args = {}) {
    const h = this.algorithms;
    const bundles = h.selectReplayBundles(await this.listReplayDocuments(COLLECTIONS.deskReplayBundles, args.backtest_id), args.backtest_id);
    const bundle = h.selectReplayBundle(bundles, { step_id: args.step_id, bundle_type: "monitor" });
    if (!bundle) throw new Error("replay_monitor_bundle_not_found");
    const run = await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, args.backtest_id).catch(() => null);
    const workItem = run?.current_work_item_id
      ? await this.persistence.getDocument(COLLECTIONS.deskAgentWorkItems, run.current_work_item_id).catch(() => null)
      : null;
    return projectReplayBundle(enrichReplayBundleSaveTargetForClaim(bundle, workItem), { ...args, bundle_type: "monitor" });
  }

  async getReplayBundleManifest(args = {}) {
    const h = this.algorithms;
    const docs = await this.listReplayDocuments(COLLECTIONS.deskReplayBundles, args.backtest_id);
    return projectReplayBundle(h.selectReplayBundleForRead(docs, args), { ...args, view: "manifest" });
  }

  async getReplayBundleSection(args = {}) {
    const h = this.algorithms;
    const docs = await this.listReplayDocuments(COLLECTIONS.deskReplayBundles, args.backtest_id);
    return getReplayBundleSectionView(h.selectReplayBundleForRead(docs, args), args);
  }

  async getReplaySnapshot(args = {}) {
    const h = this.algorithms;
    const docs = await this.listReplayDocuments(COLLECTIONS.deskReplayBundles, args.backtest_id);
    return getReplaySnapshotView(h.selectReplayBundleForRead(docs, args), args);
  }

  async validateReplayMonitorStrategyPayload(args = {}) {
    const run = await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, args.backtest_id);
    const state = await this.resolveReplayMonitorCurrentState(run);
    return canonicalizeMonitorStrategyPayload(args, {
      workflow: "REPLAY_MONITOR",
      run,
      sourceMode: "replay",
      currentState: state.currentState,
    });
  }

  async saveReplayMonitor(args = {}) {
    const h = this.algorithms;
    const tick = this.clock.now();
    const run = await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, args.backtest_id);
    if ((args.replay_execution_policy_version || run?.replay_execution_policy_version) === "3.0.0") {
      assertMonitorSetupTransition(args, { workflow: "REPLAY_MONITOR" });
    }
    const workItemId = args.work_item_id || run.current_work_item_id || null;
    const workItem = workItemId ? await this.persistence.getDocument(COLLECTIONS.deskAgentWorkItems, workItemId).catch(() => null) : null;
    if (args.work_item_id) assertReplayWorkForSave(workItem, args, "REPLAY_MONITOR", tick);
    else if (workItem?.status === "CLAIMED") throw deskError("WORK_ALREADY_CLAIMED", "Pause automation before using the manual Monitor save path.");
    let begin;
    try {
      begin = await this.beginMutation(run, args, {
        operation: "save_replay_monitor",
        nextStatus: "MONITOR_SAVED",
        allowedStatuses: ["WAITING_GPT_MONITOR"],
      });
    } catch (error) {
      if (error?.code === "REVISION_CONFLICT") {
        throw deskError("MONITOR_REVISION_CONFLICT", "Replay Monitor expected_revision no longer matches the canonical run.", {
          expected_revision: args.expected_revision,
          actual_revision: Number(run.revision || 0),
          backtest_id: run.backtest_id,
        });
      }
      throw error;
    }
    if (begin.existing_result) return begin.existing_result;
    const steps = h.selectBacktestSteps(await this.listReplayDocuments(COLLECTIONS.deskReplaySteps, run.backtest_id), run.backtest_id);
    const step = h.resolveReplayStep(steps, run, args.step_id, "MONITOR");
    h.assertReplayContractSave(run, args, "monitor", step);
    const {
      existingThesis,
      existingSetups,
      currentState,
    } = await this.resolveReplayMonitorCurrentState(run);
    const canonicalArgs = canonicalizeMonitorStrategyPayload(args, {
      workflow: "REPLAY_MONITOR",
      run,
      sourceMode: "replay",
      currentState,
    });
    const monitor = h.normalizeReplayMonitor(canonicalArgs, run, step, tick);
    const writes = [{ collection: COLLECTIONS.deskReplayMonitors, documentId: monitor.monitor_id, data: monitor }];
    if (canonicalArgs.monitor_context_transmission) {
      const context = h.normalizeReplayContextTransmission(canonicalArgs.monitor_context_transmission, run, step, { linked_monitor_id: monitor.monitor_id }, tick);
      writes.push({ collection: COLLECTIONS.deskReplayContextTransmissions, documentId: context.context_id, data: context });
    }
    if (existingThesis) {
      const updatedThesis = h.patchReplayThesis(existingThesis, monitor, tick);
      writes.push({ collection: COLLECTIONS.deskReplayActiveTheses, documentId: updatedThesis.thesis_id, data: updatedThesis });
    }
    const setupMutation = buildReplaySetupMutationDocsFromMonitor({
      monitor,
      run,
      step,
      existingSetups,
      tick,
      makeSetupId: (value) => h.scopedReplayChildId(run, "setup", value),
    });
    const monitorSetupDocs = setupMutation.materializedSetups;
    const replacedSetupDocs = setupMutation.replacedSetups;
    writes.push(...setupMutation.allSetups.map((setup) => ({ collection: COLLECTIONS.deskReplaySetups, documentId: setup.setup_record_id, data: setup })));
    const savedStep = h.patchReplayStep(step, {
      status: "MONITOR_SAVED",
      output_ref: { collection: COLLECTIONS.deskReplayMonitors, document_id: monitor.monitor_id },
    }, tick);
    const savedRun = h.patchReplayRun(run, {
      status: "MONITOR_SAVED",
      latest_monitor_id: monitor.monitor_id,
      current_step_id: savedStep.step_id,
      setup_count: Math.max(Number(run.setup_count || 0), existingSetups.length + monitorSetupDocs.filter((setup) => !existingSetups.some((item) => item.setup_record_id === setup.setup_record_id)).length),
      current_work_item_id: null,
      last_completed_work_item_id: workItem?.work_item_id || run.last_completed_work_item_id || null,
      automation_status: run.automation_enabled ? "running" : run.automation_status,
    }, tick);
    const timeline = h.replayTimelineEvent(savedRun, savedStep, {
      event_type: "GPT_MONITOR_SAVED",
      phase: "Monitor",
      action: monitor.monitor_decision?.action || monitor.monitor_decision?.decision || "MONITOR_SAVED",
      status: savedRun.status,
      note: "Replay monitor saved and ready to apply/simulate.",
      ref: { collection: COLLECTIONS.deskReplayMonitors, document_id: monitor.monitor_id },
      anti_lookahead_compliant: true,
    }, tick);
    writes.push(
      { collection: COLLECTIONS.deskReplaySteps, documentId: savedStep.step_id, data: savedStep },
      { collection: COLLECTIONS.deskReplayTimeline, documentId: timeline.event_id, data: timeline },
    );
    if (workItem) {
      const completedWork = completeReplayWorkItem(workItem, {
        worker_id: args.worker_id,
        lease_token: args.lease_token,
        output_ref: { collection: COLLECTIONS.deskReplayMonitors, document_id: monitor.monitor_id },
      }, tick, { allowMaterialized: !args.work_item_id });
      writes.push(
        { collection: COLLECTIONS.deskAgentWorkItems, documentId: completedWork.work_item_id, data: completedWork },
        { collection: COLLECTIONS.deskAgentWorkEvents, documentId: `${completedWork.work_item_id}__completed__${tick.epochMs}`, data: replayWorkEvent(completedWork, "COMPLETED", tick, { worker_id: args.worker_id }) },
      );
    }
    const result = {
      ok: true,
      backtest_id: savedRun.backtest_id,
      step_id: savedStep.step_id,
      status: savedRun.status,
      monitor_id: monitor.monitor_id,
      setup_ids: monitorSetupDocs.map((setup) => setup.setup_record_id),
      replaced_setup_ids: replacedSetupDocs.map((setup) => setup.setup_record_id),
      replacement_count: replacedSetupDocs.length,
      next_action: h.nextReplayAction(savedRun.status),
    };
    const committed = await this.commitMutation({
      run, runPatch: savedRun, mutation: begin.mutation, writes, result, tick,
      preconditions: args.work_item_id ? [{
        collection: COLLECTIONS.deskAgentWorkItems,
        documentId: args.work_item_id,
        equals: { status: "CLAIMED", claimed_by: args.worker_id, lease_token: args.lease_token },
      }] : [],
    });
    return run.automation_enabled ? { ...committed.result, automation: await this.driveAutomation({ backtest_id: run.backtest_id }) } : committed.result;
  }

  async resolveReplayMonitorCurrentState(run) {
    const h = this.algorithms;
    const [existingThesis, existingSetups, existingPositions] = await Promise.all([
      h.selectReplayActiveThesis(
        await this.listReplayDocuments(COLLECTIONS.deskReplayActiveTheses, run.backtest_id),
        run.backtest_id,
      ),
      Promise.resolve(h.selectReplayScopedSetups(
        await this.listReplayDocuments(COLLECTIONS.deskReplaySetups, run.backtest_id),
        run.backtest_id,
      )),
      Promise.resolve(h.selectReplayPositions(
        await this.listReplayDocuments(COLLECTIONS.deskReplayPositions, run.backtest_id),
        run.backtest_id,
      )),
    ]);
    const currentSetup = existingSetups.find((setup) => [
      "SETUP_CANDIDATE",
      "PRE_ARMED",
      "ARMED_CONDITIONAL",
    ].includes(String(setup.status || setup.lifecycle_status || setup.setup_status || "").toUpperCase()))
      || existingSetups[0]
      || null;
    const currentPosition = selectOpenReplayPosition(existingPositions);
    return {
      existingThesis,
      existingSetups,
      existingPositions,
      currentSetup,
      currentPosition,
      currentState: {
        thesis: existingThesis,
        setup: currentSetup,
        position: currentPosition,
        pinned_plan: existingThesis?.pinned_plan || null,
        replan: { state: existingThesis?.status === "REPLAN_REQUIRED" ? "REQUESTED" : "IDLE" },
      },
    };
  }

  async applyReplayMonitorResult(args = {}) {
    const h = this.algorithms;
    const tick = this.clock.now();
    const run = await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, args.backtest_id);
    const steps = h.selectBacktestSteps(await this.listReplayDocuments(COLLECTIONS.deskReplaySteps, run.backtest_id), run.backtest_id);
    const step = h.resolveReplayStep(steps, run, args.step_id, "MONITOR");
    const monitor = h.selectReplayMonitorForStep(await this.listReplayDocuments(COLLECTIONS.deskReplayMonitors, run.backtest_id), run.backtest_id, step.step_id);
    if (!monitor) throw new Error("replay_monitor_not_found_for_step");
    const positions = h.selectReplayPositions(await this.listReplayDocuments(COLLECTIONS.deskReplayPositions, run.backtest_id), run.backtest_id);
    const simulationId = step.simulation_ref?.document_id || run.latest_simulation_id || null;
    const simulation = simulationId
      ? await this.persistence.getDocument(COLLECTIONS.deskReplayTradeSimulations, simulationId).catch(() => null)
      : null;
    const activeThesis = h.selectReplayActiveThesis(
      await this.listReplayDocuments(COLLECTIONS.deskReplayActiveTheses, run.backtest_id),
      run.backtest_id,
    );
    const apply = h.buildReplayMonitorApplication(run, step, monitor, positions, tick, {
      simulation,
      activeThesis,
    });
    const begin = await this.beginMutation(run, args, {
      operation: "apply_replay_monitor_result",
      nextStatus: apply.run_status,
      allowedStatuses: ["MONITOR_SAVED", "MONITOR_APPLIED"],
    });
    if (begin.existing_result) return begin.existing_result;
    const writes = [];
    if (apply.position) writes.push({ collection: COLLECTIONS.deskReplayPositions, documentId: apply.position.position_id, data: apply.position });
    const appliedStep = h.patchReplayStep(step, { status: "SIMULATION_UPDATED", applied_decision: apply.action }, tick);
    const appliedRun = h.patchReplayRun(run, {
      status: apply.run_status,
      latest_position_id: apply.position?.position_id || run.latest_position_id || null,
    }, tick);
    const timeline = h.replayTimelineEvent(appliedRun, appliedStep, {
      event_type: "MONITOR_RESULT_APPLIED",
      phase: "Simulation",
      action: apply.action,
      status: appliedRun.status,
      note: apply.note,
      anti_lookahead_compliant: true,
    }, tick);
    writes.push(
      { collection: COLLECTIONS.deskReplaySteps, documentId: appliedStep.step_id, data: appliedStep },
      { collection: COLLECTIONS.deskReplayTimeline, documentId: timeline.event_id, data: timeline },
    );
    const result = { ok: true, backtest_id: appliedRun.backtest_id, step_id: appliedStep.step_id, status: appliedRun.status, action: apply.action, position: apply.position || null, next_action: h.nextReplayAction(appliedRun.status) };
    return (await this.commitMutation({ run, runPatch: appliedRun, mutation: begin.mutation, writes, result, tick })).result;
  }

  async simulateReplayInterval(args = {}) {
    const h = this.algorithms;
    const tick = this.clock.now();
    const run = await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, args.backtest_id);
    const begin = await this.beginMutation(run, args, {
      operation: "simulate_replay_interval",
      nextStatus: "MONITOR_DATA_PREPARING",
      allowedStatuses: ["MONITOR_DATA_PREPARING"],
    });
    if (begin.existing_result) return begin.existing_result;
    const steps = h.selectBacktestSteps(await this.listReplayDocuments(COLLECTIONS.deskReplaySteps, run.backtest_id), run.backtest_id);
    const step = h.resolveReplayStep(steps, run, args.step_id, "MONITOR");
    const positions = h.selectReplayPositions(await this.listReplayDocuments(COLLECTIONS.deskReplayPositions, run.backtest_id), run.backtest_id);
    const setups = h.selectReplayScopedSetups(await this.listReplayDocuments(COLLECTIONS.deskReplaySetups, run.backtest_id), run.backtest_id);
    const position = selectReplaySimulationPosition(positions);
    const fallbackCadenceMinutes = replayCadenceValueToMinutes(run.cadence || run.monitor_cadence)
      || FULL_DAY_REPLAY_CADENCE_MINUTES;
    const from = args.from_timestamp
      || step.previous_timestamp_paris
      || h.offsetIso(step.timestamp_paris, -fallbackCadenceMinutes * 60 * 1000);
    const to = args.to_timestamp || step.timestamp_paris || run.current_replay_time;
    const simulation = await h.buildReplayIntervalSimulation(this.host, run, step, position, setups, {
      from,
      to,
      positionHistory: positions,
    }, tick);
    const simulatedStep = h.patchReplayStep(step, {
      status: "MONITOR_DATA_PREPARING",
      simulation_ref: { collection: COLLECTIONS.deskReplayTradeSimulations, document_id: simulation.simulation_id },
      anti_lookahead_compliant: true,
      validation_result: "passed",
    }, tick);
    const simulatedRun = h.patchReplayRun(run, {
      status: "MONITOR_DATA_PREPARING",
      latest_simulation_id: simulation.simulation_id,
      latest_position_id: simulation.position_update?.position_id || run.latest_position_id || null,
    }, tick);
    const timeline = h.replayTimelineEvent(simulatedRun, simulatedStep, {
      event_type: "INTERVAL_SIMULATED",
      phase: "Simulation",
      action: "SIMULATE_INTERVAL",
      status: simulatedRun.status,
      note: `Replay interval simulated up to ${to}.`,
      ref: { collection: COLLECTIONS.deskReplayTradeSimulations, document_id: simulation.simulation_id },
      anti_lookahead_compliant: true,
    }, tick);
    const result = { ok: true, backtest_id: simulatedRun.backtest_id, step_id: simulatedStep.step_id, status: simulatedRun.status, simulation, next_action: h.nextReplayAction(simulatedRun.status) };
    return (await this.commitMutation({
      run,
      runPatch: simulatedRun,
      mutation: begin.mutation,
      writes: [
        { collection: COLLECTIONS.deskReplayTradeSimulations, documentId: simulation.simulation_id, data: simulation },
        ...(simulation.setup_updates || []).map((setup) => ({ collection: COLLECTIONS.deskReplaySetups, documentId: setup.setup_record_id, data: setup })),
        ...(simulation.position_update ? [{ collection: COLLECTIONS.deskReplayPositions, documentId: simulation.position_update.position_id, data: simulation.position_update }] : []),
        { collection: COLLECTIONS.deskReplaySteps, documentId: simulatedStep.step_id, data: simulatedStep },
        { collection: COLLECTIONS.deskReplayTimeline, documentId: timeline.event_id, data: timeline },
      ],
      result,
      tick,
    })).result;
  }

  async getReplayTimeline({ backtest_id, limit = 200 } = {}) {
    const h = this.algorithms;
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 200, 500));
    const timeline = h.selectReplayTimeline(await this.listReplayDocuments(
      COLLECTIONS.deskReplayTimeline,
      backtest_id,
      { limit: REPLAY_SCOPED_DOCUMENT_LIMIT },
    ), backtest_id).slice(0, boundedLimit);
    return { ok: true, backtest_id, count: timeline.length, timeline };
  }

  async beginMutation(run, args, config) {
    assertActiveStrategyRuntimePins(run, { operation: config.operation || "replay_mutation" });
    const idempotencyKey = String(args.idempotency_key || "").trim();
    if (idempotencyKey) {
      const id = replayIdempotencyDocumentId(run.backtest_id, idempotencyKey);
      const existing = await this.persistence.getDocument(COLLECTIONS.deskReplayIdempotency, id).catch(() => null);
      if (existing) {
        const request_hash = replayRequestHash(config.operation, args);
        const result = resolveIdempotentReplayResult(existing, { idempotency_key: idempotencyKey, request_hash });
        return { existing_result: { ...result, idempotent_replay: true } };
      }
    }
    return { mutation: prepareReplayMutation(run, args, config) };
  }

  async commitMutation({ run, runPatch, mutation, writes = [], result, tick, preconditions = [] }) {
    if (typeof this.persistence.commitReplayMutation === "function") {
      return this.persistence.commitReplayMutation({
        runCollection: COLLECTIONS.deskReplayRuns,
        idempotencyCollection: COLLECTIONS.deskReplayIdempotency,
        backtestId: run.backtest_id,
        idempotencyKey: mutation.idempotency_key,
        requestHash: mutation.request_hash,
        expectedRevision: mutation.expected_revision,
        runPatch,
        writes,
        preconditions,
        result,
        tick,
      });
    }
    const nextRun = { ...run, ...runPatch, revision: mutation.next_revision };
    const finalResult = { ...result, revision: mutation.next_revision, idempotent_replay: false };
    for (const write of writes) {
      await this.persistence.setDocument(write.collection, write.documentId, write.data, { merge: write.merge === true });
    }
    await this.persistence.setDocument(COLLECTIONS.deskReplayRuns, run.backtest_id, nextRun, { merge: true });
    const id = replayIdempotencyDocumentId(run.backtest_id, mutation.idempotency_key);
    await this.persistence.setDocument(COLLECTIONS.deskReplayIdempotency, id, {
      idempotency_id: id,
      idempotency_key: mutation.idempotency_key,
      request_hash: mutation.request_hash,
      backtest_id: run.backtest_id,
      expected_revision: mutation.expected_revision,
      applied_revision: mutation.next_revision,
      status: "applied",
      result: finalResult,
      created_at_utc: tick.utc,
    });
    return { replayed: false, run: nextRun, result: finalResult };
  }

  async claimNext(args = {}) {
    const tick = this.clock.now();
    const items = await this.persistence.queryCollectionDocuments({
      collection: COLLECTIONS.deskAgentWorkItems,
      filters: [
        { field: "status", operator: "in", value: ["READY", "CLAIMED"] },
        { field: "operational_visibility", operator: "!=", value: "history" },
      ],
      limit: 500,
    }).catch(() => []);
    for (const candidate of selectClaimableReplayWork(items, { ...args, workflows: args.workflows || ["REPLAY_MASTER", "REPLAY_MONITOR"] }, tick)) {
      const run = await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, candidate.backtest_id).catch(() => null);
      if (!replayWorkMatchesRun(candidate, run)) {
        const superseded = supersedeReplayWorkItem(candidate, tick);
        await this.persistence.setDocument(COLLECTIONS.deskAgentWorkItems, candidate.work_item_id, superseded);
        await this.writeWorkEvent(replayWorkEvent(superseded, "SUPERSEDED", tick));
        continue;
      }
      const proposed = claimReplayWorkItem(candidate, args, tick);
      const claimed = typeof this.persistence.claimDeskWorkItem === "function"
        ? await this.persistence.claimDeskWorkItem({ collection: COLLECTIONS.deskAgentWorkItems, workItemId: candidate.work_item_id, proposed, tick })
        : proposed;
      if (!claimed) continue;
      if (typeof this.persistence.claimDeskWorkItem !== "function") {
        await this.persistence.setDocument(COLLECTIONS.deskAgentWorkItems, claimed.work_item_id, claimed);
      }
      await this.writeWorkEvent(replayWorkEvent(claimed, "CLAIMED", tick, { worker_id: args.worker_id }));
      return replayClaimResponse(deskWorkClaimResponse(claimed), args);
    }
    return replayClaimResponse({ ok: true, status: "NO_WORK" }, args);
  }

  async getWorkItem({ work_item_id }) {
    const work_item = await this.persistence.getDocument(COLLECTIONS.deskAgentWorkItems, work_item_id);
    return { ok: true, work_item };
  }

  async peekNext(args = {}) {
    const statuses = args.include_terminal === true ? ["READY", "CLAIMED", "FAILED"] : ["READY", "CLAIMED"];
    const items = await this.persistence.queryCollectionDocuments({
      collection: COLLECTIONS.deskAgentWorkItems,
      filters: [
        { field: "status", operator: "in", value: statuses },
        { field: "operational_visibility", operator: "!=", value: "history" },
      ],
      limit: 500,
    }).catch(() => []);
    const work_item = selectVisibleDeskWork(items, args)[0] || null;
    return { ok: true, status: workQueueStatus(work_item), work_item: work_item ? deskWorkSummary(work_item) : null };
  }

  async upsertAutopilotConfig(args = {}) {
    const tick = this.clock.now();
    const config = normalizeReplayAutopilotConfig(args, tick);
    const existing = await this.persistence.getDocument(REPLAY_AUTOPILOT_CONFIGS_COLLECTION, config.config_id).catch(() => null);
    if (existing && !isActiveStrategyRuntimePins(existing, { operation: "upsert_replay_autopilot_config" })) {
      throw deskError(
        "HISTORICAL_REPLAY_CONFIG_READ_ONLY",
        "A historical replay config cannot be repinned in place. Create a new V5.2 config_id.",
        {
          config_id: config.config_id,
          historical_autopilot_version: existing.autopilot_version || null,
          required_autopilot_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.autopilot_version,
        },
      );
    }
    const doc = {
      ...(existing || {}),
      ...config,
      created_at_utc: existing?.created_at_utc || config.created_at_utc,
      created_at_paris: existing?.created_at_paris || config.created_at_paris,
      updated_at_utc: tick.utc,
      updated_at_paris: tick.paris,
    };
    await this.persistence.setDocument(REPLAY_AUTOPILOT_CONFIGS_COLLECTION, doc.config_id, doc, { merge: true });
    return { ok: true, status: "CONFIG_SAVED", config: projectReplayAutopilotConfig(doc) };
  }

  async setAutopilotWindow(args = {}) {
    const tick = this.clock.now();
    const configs = await this.persistence.listDocuments(REPLAY_AUTOPILOT_CONFIGS_COLLECTION, 500).catch(() => []);
    const plan = planReplayAutopilotWindow(configs, args, tick);
    if (!args.dry_run) {
      for (const change of plan.changes) {
        await this.persistence.setDocument(REPLAY_AUTOPILOT_CONFIGS_COLLECTION, change.config.config_id, change.config, { merge: true });
      }
    }
    return projectReplayAutopilotWindowResult(plan, args);
  }

  async startOrResumeAutopilot(args = {}) {
    const tick = this.clock.now();
    const resolved = await this.resolveAutopilotConfig(args);
    if (!resolved.config) {
      return { ok: true, status: "CONFIG_MISSING", reason: resolved.reason, selector: resolved.selector };
    }
    const config = resolved.config;
    assertReplayAutopilotConfigStartable(config);
    if (config.enabled === false || config.status === "PAUSED" || config.status === "ARCHIVED") {
      return { ok: true, status: "CONFIG_DISABLED", config: projectReplayAutopilotConfig(config) };
    }
    if (resolved.selector?.mode === "next_ready_config" || resolved.selector?.mode === "latest_ready_config") {
      await this.touchAutopilotConfigSelection(config, tick, args.worker_id);
    }

    const createArgs = replayAutopilotCreateArgs(config, args);
    let creation = null;
    let run = await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, createArgs.backtest_id).catch(() => null);
    if (!run) {
      creation = await this.host.createOrchestratedReplayDay(createArgs);
      run = creation.replay_run || await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, createArgs.backtest_id).catch(() => null);
    } else {
      assertActiveStrategyRuntimePins(run, { operation: "start_or_resume_replay_autopilot" });
    }
    if (run && run.automation_enabled !== true) {
      const resumedRun = patchReplayRun(run, { automation_enabled: true, automation_status: "running" }, tick);
      await this.persistence.setDocument(COLLECTIONS.deskReplayRuns, run.backtest_id, resumedRun, { merge: true });
      run = resumedRun;
    }

    const recovered = args.recover_failed === false
      ? null
      : await this.recoverAutopilotWork(createArgs.backtest_id, tick, args.worker_id);
    const automation = await this.host.driveReplayAutomation({
      backtest_id: createArgs.backtest_id,
      max_transitions: args.max_transitions || config.max_transitions || 6,
    });
    const state = await this.host.getReplayState({ backtest_id: createArgs.backtest_id });
    return projectReplayAutopilotStartResult({ config, creation, recovered, automation, state, worker_id: args.worker_id, tick });
  }

  async heartbeatWork(args = {}) {
    const tick = this.clock.now();
    const item = (await this.getWorkItem(args)).work_item;
    const updated = heartbeatReplayWorkItem(item, args, tick);
    await this.persistence.setDocument(COLLECTIONS.deskAgentWorkItems, updated.work_item_id, updated);
    await this.writeWorkEvent(replayWorkEvent(updated, "HEARTBEAT", tick, { worker_id: args.worker_id }));
    return { ok: true, status: updated.status, work_item: deskWorkSummary(updated) };
  }

  async completeWork(args = {}) {
    const tick = this.clock.now();
    const item = (await this.getWorkItem(args)).work_item;
    if (item.status === "COMPLETED") {
      const telemetry = normalizeGptTelemetry(args.telemetry);
      if (!telemetry) return { ok: true, status: "COMPLETED", idempotent_replay: true, work_item: deskWorkSummary(item) };
      if (item.gpt_telemetry && !sameGptTelemetry(item.gpt_telemetry, telemetry)) {
        throw deskError("GPT_TELEMETRY_CONFLICT", "GPT telemetry is immutable once recorded for a completed work item.");
      }
      const updated = {
        ...item,
        gpt_telemetry: item.gpt_telemetry || telemetry,
        telemetry_recorded_at_utc: item.telemetry_recorded_at_utc || tick.utc,
        updated_at_utc: tick.utc,
        updated_at_paris: tick.paris,
      };
      await this.persistence.setDocument(COLLECTIONS.deskAgentWorkItems, updated.work_item_id, updated);
      await this.writeWorkEvent(replayWorkEvent(updated, "TELEMETRY_RECORDED", tick, {
        worker_id: args.worker_id,
        telemetry: updated.gpt_telemetry,
      }));
      return { ok: true, status: "COMPLETED", idempotent_replay: true, telemetry_recorded: true, work_item: deskWorkSummary(updated) };
    }
    const run = await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, item.backtest_id);
    const materialized = replayWorkOutputMaterialized(item, run);
    if (!materialized) throw deskError("WORK_OUTPUT_NOT_MATERIALIZED", "The expected Desk output must be saved before completing this work item.");
    const completed = completeReplayWorkItem(item, args, tick, { allowMaterialized: true });
    await this.persistence.setDocument(COLLECTIONS.deskAgentWorkItems, completed.work_item_id, completed);
    await this.writeWorkEvent(replayWorkEvent(completed, "COMPLETED", tick, { worker_id: args.worker_id }));
    const automation = run?.automation_enabled ? await this.host.driveReplayAutomation({ backtest_id: run.backtest_id }) : null;
    return { ok: true, status: "COMPLETED", work_item: deskWorkSummary(completed), automation };
  }

  async failWork(args = {}) {
    const tick = this.clock.now();
    const item = (await this.getWorkItem(args)).work_item;
    const failed = failReplayWorkItem(item, args, tick);
    const run = failed.status === "FAILED"
      ? await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, failed.backtest_id).catch(() => null)
      : null;
    const blockedRun = run
      ? this.algorithms.patchReplayRun(run, {
        status: "WORK_FAILED_REQUIRES_OPERATOR",
        automation_status: "blocked",
        current_work_item_id: failed.work_item_id,
        last_automation_error: failed.last_error,
      }, tick)
      : null;
    const writes = [
      { collection: COLLECTIONS.deskAgentWorkItems, documentId: failed.work_item_id, data: failed },
      ...(blockedRun ? [{
        collection: COLLECTIONS.deskReplayRuns,
        documentId: blockedRun.backtest_id,
        data: blockedRun,
      }] : []),
    ];
    if (typeof this.persistence.writeDocuments === "function") {
      await this.persistence.writeDocuments(writes);
    } else {
      for (const write of writes) {
        await this.persistence.setDocument(write.collection, write.documentId, write.data);
      }
    }
    const eventType = failed.status === "READY" ? "RETRY_SCHEDULED" : "FAILED";
    await this.writeWorkEvent(replayWorkEvent(failed, eventType, tick, { worker_id: args.worker_id, error_code: args.error_code }));
    return {
      ok: true,
      status: failed.status,
      retry_scheduled: failed.status === "READY",
      work_item: deskWorkSummary(failed),
      run_status: blockedRun?.status || null,
    };
  }

  async setAutomation(args = {}) {
    const tick = this.clock.now();
    const run = await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, args.backtest_id);
    if (args.expected_revision !== undefined && Number(run.revision || 0) !== Number(args.expected_revision)) {
      throw deskError("REVISION_CONFLICT", "Replay revision changed before the automation command.", {
        expected_revision: args.expected_revision,
        actual_revision: Number(run.revision || 0),
      });
    }
    const enabled = args.enabled === true;
    if (enabled) {
      assertActiveStrategyRuntimePins(run, { operation: "enable_replay_automation" });
    }
    const items = await this.persistence.queryCollectionDocuments({
      collection: COLLECTIONS.deskAgentWorkItems,
      filters: [{ field: "backtest_id", operator: "==", value: run.backtest_id }],
      limit: 200,
    }).catch(() => []);
    const nextRevision = Number(run.revision || 0) + 1;
    for (const item of items) {
      const resumedOrPaused = enabled
        ? resumeReplayWorkItem(item, tick)
        : pauseReplayWorkItem(item, tick, args.reason);
      const updated = enabled && resumedOrPaused !== item
        ? alignRecoveredReplayWorkExpectedRevision(resumedOrPaused, nextRevision)
        : resumedOrPaused;
      if (updated !== item) await this.persistence.setDocument(COLLECTIONS.deskAgentWorkItems, updated.work_item_id, updated);
    }
    const updatedRun = patchReplayRun(run, {
      automation_enabled: enabled,
      automation_status: enabled ? "running" : "paused",
      revision: nextRevision,
    }, tick);
    await this.persistence.setDocument(COLLECTIONS.deskReplayRuns, run.backtest_id, updatedRun, { merge: true });
    const automation = enabled ? await this.host.driveReplayAutomation({ backtest_id: run.backtest_id }) : null;
    return { ok: true, backtest_id: run.backtest_id, automation_enabled: enabled, automation };
  }

  async retryAutomationWork(args = {}) {
    const tick = this.clock.now();
    const run = await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, args.backtest_id);
    assertActiveStrategyRuntimePins(run, { operation: "retry_replay_automation_work" });
    if (Number(run.revision || 0) !== Number(args.expected_revision)) {
      throw deskError("REVISION_CONFLICT", "Replay revision changed before retry.", {
        expected_revision: args.expected_revision,
        actual_revision: Number(run.revision || 0),
      });
    }
    const items = await this.persistence.queryCollectionDocuments({
      collection: COLLECTIONS.deskAgentWorkItems,
      filters: [{ field: "backtest_id", operator: "==", value: run.backtest_id }],
      orderBy: [{ field: "updated_at_utc", direction: "desc" }],
      limit: 100,
    }).catch(() => []);
    const failed = items.find((item) => item.status === "FAILED" && isRecoverableReplayAutopilotFailure(item));
    if (!failed) throw deskError("WORK_FAILED_REQUIRES_OPERATOR", "No bounded recoverable GPT work item is available for this replay.");
    const nextRevision = Number(run.revision || 0) + 1;
    const recovered = alignRecoveredReplayWorkExpectedRevision(
      recoverReplayAutopilotWorkItem(failed, tick, args.requested_by || "front-operator"),
      nextRevision,
    );
    await this.persistence.setDocument(COLLECTIONS.deskAgentWorkItems, recovered.work_item_id, recovered, { merge: true });
    await this.writeWorkEvent(replayWorkEvent(recovered, "RECOVERED", tick, {
      worker_id: args.requested_by || "front-operator",
      reason: args.reason || "Operator retry from Operations cockpit.",
      recovered_error: failed.last_error || null,
    }));
    const waitingStatus = recovered.workflow === "REPLAY_MASTER" ? "WAITING_GPT_MASTER" : "WAITING_GPT_MONITOR";
    const updatedRun = patchReplayRun(run, {
      status: waitingStatus,
      automation_enabled: true,
      automation_status: "waiting_gpt",
      current_work_item_id: recovered.work_item_id,
      last_automation_error: null,
      revision: nextRevision,
    }, tick);
    await this.persistence.setDocument(COLLECTIONS.deskReplayRuns, run.backtest_id, updatedRun);
    return { ok: true, status: "RECOVERED", backtest_id: run.backtest_id, revision: updatedRun.revision, work_item: deskWorkSummary(recovered) };
  }

  async resolveAutopilotConfig(args = {}) {
    const tick = this.clock.now();
    const selector = replayAutopilotConfigSelector(args);
    if (selector.config_id) {
      const config = await this.persistence.getDocument(REPLAY_AUTOPILOT_CONFIGS_COLLECTION, selector.config_id).catch(() => null);
      return { config, selector, reason: config ? null : "config_id_not_found" };
    }
    const configs = await this.persistence.listDocuments(REPLAY_AUTOPILOT_CONFIGS_COLLECTION, 100).catch(() => []);
    if (selector.mode === "next_ready_config" || selector.mode === "latest_ready_config") {
      return this.selectNextAutopilotConfig(configs, selector, tick);
    }
    const config = selectReplayAutopilotConfig(configs, selector);
    return { config, selector, reason: config ? null : "matching_config_not_found" };
  }

  async selectNextAutopilotConfig(configs, selector, tick) {
    for (const config of replayAutopilotConfigCandidates(configs, selector)) {
      const availability = await this.autopilotConfigAvailability(config, tick);
      if (availability.selectable) return { config, selector, reason: null, availability };
    }
    return { config: null, selector, reason: "no_available_config" };
  }

  async autopilotConfigAvailability(config, tick) {
    if (!isActiveStrategyRuntimePins(config, { operation: "replay_autopilot_config_availability" })) {
      return { selectable: false, reason: "historical_runtime_read_only" };
    }
    const run = await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, config.backtest_id).catch(() => null);
    if (!run) return { selectable: true, reason: "run_not_created" };
    if (isReplayAutopilotTerminalRun(run)) return { selectable: false, reason: "terminal_run", replay_status: run.status };
    const currentItem = run.current_work_item_id
      ? await this.persistence.getDocument(COLLECTIONS.deskAgentWorkItems, run.current_work_item_id).catch(() => null)
      : null;
    if (currentItem?.status === "CLAIMED" && !isClaimableWorkItem(currentItem, tick)) {
      return { selectable: false, reason: "work_busy", work_item_id: currentItem.work_item_id };
    }
    if (currentItem?.status === "FAILED" && !isRecoverableReplayAutopilotFailure(currentItem)) {
      return { selectable: false, reason: "work_failed_requires_operator", work_item_id: currentItem.work_item_id };
    }
    return { selectable: true, reason: "available", replay_status: run.status };
  }

  async touchAutopilotConfigSelection(config, tick, workerId) {
    const existing = await this.persistence.getDocument(REPLAY_AUTOPILOT_CONFIGS_COLLECTION, config.config_id).catch(() => config);
    await this.persistence.setDocument(REPLAY_AUTOPILOT_CONFIGS_COLLECTION, config.config_id, {
      last_selected_at_utc: tick.utc,
      last_selected_at_paris: tick.paris,
      last_selected_by: workerId || "gpt-replay-autopilot",
      selection_count: Number(existing?.selection_count || 0) + 1,
    }, { merge: true });
  }

  async recoverAutopilotWork(backtestId, tick, workerId) {
    const items = await this.persistence.queryCollectionDocuments({
      collection: COLLECTIONS.deskAgentWorkItems,
      filters: [
        { field: "backtest_id", operator: "==", value: backtestId },
        { field: "status", operator: "==", value: "FAILED" },
      ],
      limit: 50,
    }).catch(() => []);
    const ordered = items.sort(compareDeskWorkItems);
    const item = ordered.find(isRecoverableReplayAutopilotFailure);
    if (!item) {
      const blocked = ordered[0] || null;
      return blocked ? { status: "WORK_FAILED_REQUIRES_OPERATOR", work_item: deskWorkSummary(blocked) } : null;
    }
    const recovered = recoverReplayAutopilotWorkItem(item, tick, workerId);
    await this.persistence.setDocument(COLLECTIONS.deskAgentWorkItems, recovered.work_item_id, recovered, { merge: true });
    await this.writeWorkEvent(replayWorkEvent(recovered, "RECOVERED", tick, {
      worker_id: workerId || "replay_autopilot",
      recovered_error: item.last_error || null,
    }));
    const run = await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, backtestId).catch(() => null);
    if (run) {
      await this.persistence.setDocument(COLLECTIONS.deskReplayRuns, backtestId, patchReplayRun(run, {
        current_work_item_id: recovered.work_item_id,
        automation_status: "waiting_gpt",
        last_automation_error: null,
      }, tick), { merge: true });
    }
    return { status: "RECOVERED", work_item: deskWorkSummary(recovered), recovered_error: item.last_error || null };
  }

  async writeWorkEvent(event) {
    await this.persistence.setDocument(COLLECTIONS.deskAgentWorkEvents, event.event_id, event);
  }
}

function replayAutopilotConfigSelector(args = {}) {
  return {
    config_id: args.config_id || null,
    trading_date: args.trading_date || null,
    session: args.session || null,
    mode: args.mode || null,
    worker_group: args.worker_group || null,
  };
}

function normalizeReplayAutopilotConfig(args = {}, tick) {
  assertActiveStrategyRuntimePins(args, {
    operation: "upsert_replay_autopilot_config",
    allowMissing: true,
  });
  const tradingDate = args.trading_date || args.date;
  const session = args.session;
  const strategyId = args.strategy_id || (session === "ny_open" ? "ny_open_1530" : "asia_open");
  const configId = args.config_id || replayAutopilotDefaultConfigId({ trading_date: tradingDate, session });
  const backtestId = args.backtest_id || replayAutopilotDefaultBacktestId({ trading_date: tradingDate, session, cadence: args.cadence });
  const start = normalizeReplayTimestamp(args.start_time || args.initial_cutoff || args.cutoff_paris, tradingDate);
  const cutoff = normalizeReplayTimestamp(args.cutoff_paris || args.initial_cutoff || args.start_time, tradingDate);
  const end = normalizeReplayTimestamp(args.end_time, tradingDate);
  const instrumentScopes = normalizeDeskInstrumentScopes(args);
  return {
    ...args,
    config_schema_version: "1.0.0",
    strategy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.strategy_version,
    autopilot_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.autopilot_version,
    replay_execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
    execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
    monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
    condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
    deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
    condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
    strategy_profile: args.strategy_profile || "OPPORTUNITY_SEEKING_CONTROLLED",
    config_id: configId,
    enabled: args.enabled !== false,
    status: args.status || "READY",
    backtest_id: backtestId,
    strategy_id: strategyId,
    trading_date: tradingDate,
    date: tradingDate,
    session,
    run_scope: args.run_scope || "session",
    phases: args.phases || [],
    execution_id: args.execution_id || null,
    run_family_id: args.run_family_id || null,
    run_number: Number(args.run_number || 1),
    aggregate_role: args.aggregate_role || "primary",
    aggregate_eligible: args.aggregate_eligible !== false,
    pack_id: args.pack_id,
    pack_build_id: args.pack_build_id,
    cutoff_paris: cutoff,
    cutoff_utc: args.cutoff_utc || normalizeUtcIso(cutoff),
    initial_cutoff: args.initial_cutoff ? normalizeReplayTimestamp(args.initial_cutoff, tradingDate) : cutoff,
    start_time: start,
    end_time: end,
    cadence: normalizeReplayAutopilotCadence(args.cadence),
    timezone: args.timezone || "Europe/Paris",
    instruments: instrumentScopes.instruments,
    trading_instruments: instrumentScopes.trading_instruments,
    context_instruments: instrumentScopes.context_instruments,
    risk_model: args.risk_model || "0.25pct_net_equity",
    worker_group: args.worker_group || "default",
    priority: Number(args.priority || 100),
    max_transitions: Number(args.max_transitions || 6),
    automation_mode: "gpt_scheduled_task",
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function planReplayAutopilotWindow(configs = [], args = {}, tick) {
  const workerGroup = args.worker_group || "default";
  const session = args.session || null;
  const dateFrom = args.date_from;
  const dateTo = args.date_to;
  const includeArchived = args.include_archived === true;
  const pauseOutside = args.pause_outside_window !== false;
  const setPriorityByDate = args.set_priority_by_date !== false;
  const priorityBase = Number(args.priority_base || 10);
  const priorityStep = Number(args.priority_step || 10);
  const windowId = replayAutopilotWindowId({ workerGroup, session, dateFrom, dateTo });
  const scoped = (configs || [])
    .filter((config) => config)
    .filter((config) => includeArchived || config.status !== "ARCHIVED")
    .filter((config) => (config.worker_group || "default") === workerGroup)
    .filter((config) => !session || config.session === session)
    .filter((config) => isActiveStrategyRuntimePins(config, { operation: "set_replay_autopilot_window" }));
  const activeSorted = scoped
    .filter((config) => replayAutopilotConfigDateInWindow(config, dateFrom, dateTo))
    .sort((left, right) =>
      String(left.trading_date || left.date || "").localeCompare(String(right.trading_date || right.date || "")) ||
      String(left.config_id || "").localeCompare(String(right.config_id || "")));
  const priorityByConfigId = new Map(activeSorted.map((config, index) => [
    config.config_id,
    Math.min(999, priorityBase + (index * priorityStep)),
  ]));
  const changes = [];
  const entries = [];
  for (const config of scoped) {
    const inWindow = replayAutopilotConfigDateInWindow(config, dateFrom, dateTo);
    let action = "UNCHANGED";
    let patch = null;
    if (inWindow) {
      action = config.enabled === false || config.status !== "READY" ? "ACTIVATED" : "KEPT_ACTIVE";
      patch = {
        enabled: true,
        status: "READY",
        window_active: true,
        active_window_id: windowId,
        active_window_from: dateFrom,
        active_window_to: dateTo,
        window_activated_at_utc: tick.utc,
        window_activated_at_paris: tick.paris,
        window_reason: args.reason || null,
      };
      if (setPriorityByDate) {
        patch.priority = priorityByConfigId.get(config.config_id) || config.priority || priorityBase;
      }
    } else if (pauseOutside) {
      action = config.enabled === false || config.status === "PAUSED" ? "KEPT_PAUSED" : "PAUSED";
      patch = {
        enabled: false,
        status: "PAUSED",
        window_active: false,
        paused_by_window_id: windowId,
        active_window_id: null,
        active_window_from: dateFrom,
        active_window_to: dateTo,
        window_paused_at_utc: tick.utc,
        window_paused_at_paris: tick.paris,
        window_reason: args.reason || null,
      };
    }
    const next = patch
      ? {
        ...config,
        ...patch,
        updated_at_utc: tick.utc,
        updated_at_paris: tick.paris,
      }
      : config;
    if (patch) changes.push({ action, previous: config, config: next });
    entries.push({
      action,
      in_window: inWindow,
      config: projectReplayAutopilotConfig(next),
    });
  }
  return {
    window_id: windowId,
    worker_group: workerGroup,
    session,
    date_from: dateFrom,
    date_to: dateTo,
    scoped_count: scoped.length,
    changes,
    entries,
  };
}

function projectReplayAutopilotWindowResult(plan, args = {}) {
  const counts = plan.entries.reduce((acc, entry) => {
    acc[entry.action] = (acc[entry.action] || 0) + 1;
    return acc;
  }, {});
  return {
    ok: true,
    status: args.dry_run ? "WINDOW_DRY_RUN" : "WINDOW_APPLIED",
    dry_run: args.dry_run === true,
    window_id: plan.window_id,
    worker_group: plan.worker_group,
    session: plan.session,
    date_from: plan.date_from,
    date_to: plan.date_to,
    scoped_count: plan.scoped_count,
    changed_count: plan.changes.length,
    active_count: plan.entries.filter((entry) => entry.config.enabled && entry.config.status === "READY").length,
    paused_count: plan.entries.filter((entry) => entry.config.status === "PAUSED" || entry.config.enabled === false).length,
    counts,
    configs: plan.entries.map((entry) => ({
      action: entry.action,
      in_window: entry.in_window,
      ...entry.config,
    })),
  };
}

function replayAutopilotConfigDateInWindow(config = {}, dateFrom, dateTo) {
  const date = String(config.trading_date || config.date || "");
  return Boolean(date && date >= dateFrom && date <= dateTo);
}

function replayAutopilotWindowId({ workerGroup, session, dateFrom, dateTo } = {}) {
  return `replay_autopilot_window__${sanitizeAutopilotId(workerGroup || "default")}__${sanitizeAutopilotId(session || "all")}__${sanitizeAutopilotId(dateFrom)}__${sanitizeAutopilotId(dateTo)}`;
}

function replayAutopilotCreateArgs(config = {}, args = {}) {
  assertReplayAutopilotConfigStartable(config);
  const backtestId = config.backtest_id || replayAutopilotDefaultBacktestId(config);
  const instrumentScopes = normalizeDeskInstrumentScopes(config);
  return {
    backtest_id: backtestId,
    replay_run_id: config.replay_run_id || backtestId,
    run_id: config.run_id || backtestId,
    strategy_id: config.strategy_id || (config.session === "ny_open" ? "ny_open_1530" : "asia_open"),
    date: config.trading_date || config.date,
    trading_date: config.trading_date || config.date,
    session: config.session,
    run_scope: config.run_scope || "session",
    phases: config.phases || [],
    execution_id: config.execution_id || null,
    run_family_id: config.run_family_id || null,
    run_number: Number(config.run_number || 1),
    aggregate_role: config.aggregate_role || "primary",
    aggregate_eligible: config.aggregate_eligible !== false,
    pack_id: config.pack_id,
    pack_build_id: config.pack_build_id,
    cutoff_paris: config.cutoff_paris || config.initial_cutoff || config.start_time,
    cutoff_utc: config.cutoff_utc || normalizeUtcIso(config.cutoff_paris || config.initial_cutoff || config.start_time),
    initial_cutoff: config.initial_cutoff || config.cutoff_paris || config.start_time,
    start_time: config.start_time || config.cutoff_paris || config.initial_cutoff,
    end_time: config.end_time,
    cadence: normalizeReplayAutopilotCadence(config.cadence),
    timezone: config.timezone || "Europe/Paris",
    instruments: instrumentScopes.instruments,
    trading_instruments: instrumentScopes.trading_instruments,
    context_instruments: instrumentScopes.context_instruments,
    source_evidence: config.source_evidence || null,
    risk_model: config.risk_model || "0.25pct_net_equity",
    strategy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.strategy_version,
    autopilot_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.autopilot_version,
    replay_execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
    execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
    monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
    condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
    deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
    condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
    strategy_profile: config.strategy_profile || "OPPORTUNITY_SEEKING_CONTROLLED",
    automation_enabled: true,
    automation_mode: "gpt_scheduled_task",
    idempotency_key: config.idempotency_key || `replay-autopilot:create:${config.config_id || backtestId}:${config.pack_build_id}:${backtestId}`,
    requested_by: args.worker_id || "gpt-replay-autopilot",
  };
}

function assertReplayAutopilotConfigStartable(config = {}) {
  assertActiveStrategyRuntimePins(config, { operation: "start_replay_autopilot_config" });
  const missing = ["trading_date", "session", "pack_id", "pack_build_id", "start_time", "end_time"]
    .filter((field) => !config[field] && !(field === "trading_date" && config.date));
  if (missing.length) {
    throw deskError("REPLAY_AUTOPILOT_CONFIG_INCOMPLETE", "Replay autopilot config is missing required fields.", {
      config_id: config.config_id || null,
      missing,
    });
  }
}

function selectReplayAutopilotConfig(configs = [], selector = {}) {
  return replayAutopilotConfigCandidates(configs, selector)[0] || null;
}

function replayAutopilotConfigCandidates(configs = [], selector = {}) {
  const candidates = configs
    .filter((config) => config && config.enabled !== false)
    .filter((config) => isActiveStrategyRuntimePins(config, { operation: "select_replay_autopilot_config" }))
    .filter((config) => !["PAUSED", "ARCHIVED"].includes(config.status))
    .filter((config) => selector.mode === "latest_ready_config" || !selector.trading_date || config.trading_date === selector.trading_date || config.date === selector.trading_date)
    .filter((config) => selector.mode === "latest_ready_config" || !selector.session || config.session === selector.session)
    .filter((config) => !selector.worker_group || (config.worker_group || "default") === selector.worker_group);
  if (selector.mode === "next_ready_config" || selector.mode === "latest_ready_config") {
    return candidates.sort((left, right) =>
      Number(left.priority || 100) - Number(right.priority || 100) ||
      compareEmptyFirst(left.last_selected_at_utc, right.last_selected_at_utc) ||
      String(left.trading_date || left.date || "").localeCompare(String(right.trading_date || right.date || "")) ||
      String(left.config_id || "").localeCompare(String(right.config_id || "")));
  }
  return candidates.sort((left, right) =>
      String(right.updated_at_utc || right.created_at_utc || "").localeCompare(String(left.updated_at_utc || left.created_at_utc || ""))
      || String(right.trading_date || "").localeCompare(String(left.trading_date || "")));
}

function compareEmptyFirst(left, right) {
  const leftText = String(left || "");
  const rightText = String(right || "");
  if (!leftText && rightText) return -1;
  if (leftText && !rightText) return 1;
  return leftText.localeCompare(rightText);
}

function isReplayAutopilotTerminalRun(run = {}) {
  return ["COMPLETED", "DAY_END", "FAILED", "CANCELLED"].includes(run.status);
}

function replayAutopilotDefaultConfigId({ trading_date, session } = {}) {
  return `replay_autopilot__${sanitizeAutopilotId(trading_date || "date")}__${sanitizeAutopilotId(session || "session")}`;
}

function replayAutopilotDefaultBacktestId({ trading_date, date, session, cadence } = {}) {
  const day = trading_date || date || "date";
  const normalizedCadence = normalizeReplayAutopilotCadence(cadence);
  return `replay_${sanitizeAutopilotId(day)}_${sanitizeAutopilotId(session || "session")}_${sanitizeAutopilotId(normalizedCadence)}_autopilot`;
}

function sanitizeAutopilotId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "auto";
}

function normalizeReplayAutopilotCadence(value) {
  const text = String(value || "15m").toLowerCase();
  if (text === "m5" || text === "5" || text === "5m") return "5m";
  if (text === "1h" || text === "60" || text === "60m") return "60m";
  if (text === "30" || text === "30m") return "30m";
  if (text === "m15" || text === "15" || text === "15m") return "15m";
  return value || "15m";
}

function projectReplayAutopilotConfig(config = {}) {
  const instrumentScopes = normalizeDeskInstrumentScopes(config);
  return {
    config_id: config.config_id || null,
    enabled: config.enabled !== false,
    status: config.status || null,
    backtest_id: config.backtest_id || null,
    strategy_id: config.strategy_id || null,
    strategy_version: config.strategy_version || null,
    autopilot_version: config.autopilot_version || null,
    replay_execution_policy_version: config.replay_execution_policy_version || null,
    execution_plan_version: config.execution_plan_version || null,
    monitor_command_version: config.monitor_command_version || null,
    condition_catalog_version: config.condition_catalog_version || null,
    deterministic_compiler_version: config.deterministic_compiler_version || null,
    condition_engine_version: config.condition_engine_version || null,
    strategy_profile: config.strategy_profile || null,
    trading_date: config.trading_date || config.date || null,
    session: config.session || null,
    run_scope: config.run_scope || "session",
    phases: config.phases || [],
    execution_id: config.execution_id || null,
    run_family_id: config.run_family_id || null,
    run_number: Number(config.run_number || 1),
    aggregate_role: config.aggregate_role || "primary",
    aggregate_eligible: config.aggregate_eligible !== false,
    pack_id: config.pack_id || null,
    pack_build_id: config.pack_build_id || null,
    source_evidence: config.source_evidence || null,
    start_time: config.start_time || null,
    end_time: config.end_time || null,
    cadence: config.cadence || null,
    instruments: instrumentScopes.instruments,
    trading_instruments: instrumentScopes.trading_instruments,
    context_instruments: instrumentScopes.context_instruments,
    worker_group: config.worker_group || "default",
    priority: Number(config.priority || 100),
    max_transitions: Number(config.max_transitions || 6),
    window_active: config.window_active === true,
    active_window_id: config.active_window_id || null,
    active_window_from: config.active_window_from || null,
    active_window_to: config.active_window_to || null,
    last_selected_at_utc: config.last_selected_at_utc || null,
    selection_count: Number(config.selection_count || 0),
    updated_at_utc: config.updated_at_utc || null,
  };
}

function isRecoverableReplayAutopilotFailure(item = {}) {
  const lastError = item.last_error || {};
  const code = String(lastError.code || item.error_code || "");
  const message = String(lastError.message || item.error_message || "");
  if (item.status !== "FAILED") return false;
  if (isContextOnlyWorkerFailure({ code, message })) return Number(item.recovery_count || 0) < 3;
  if (REPLAY_AUTOPILOT_RECOVERABLE_CODES.has(code)) return Number(item.recovery_count || 0) < 3;
  if (lastError.retryable === false || item.retryable === false) return false;
  if (Number(item.recovery_count || 0) >= 3) return false;
  if (message.includes("SAVE_DOCUMENT_UNDEFINED")) return true;
  if (message.includes("trigger_policy.min_score")) return true;
  if (message.toLowerCase().includes("undefined") && message.toLowerCase().includes("document")) return true;
  return false;
}

function recoverReplayAutopilotWorkItem(item, tick, workerId) {
  const history = Array.isArray(item.recovery_history) ? item.recovery_history : [];
  return {
    ...item,
    status: "READY",
    claimed_by: null,
    worker_id: null,
    lease_token: null,
    lease_expires_at_utc: null,
    lease_expires_at_paris: null,
    claimed_at_utc: null,
    claimed_at_paris: null,
    retry_after_utc: null,
    retry_after_paris: null,
    attempt_count: 0,
    failure_count: 0,
    recovery_count: Number(item.recovery_count || 0) + 1,
    recovery_history: [
      ...history.slice(-4),
      {
        recovered_at_utc: tick.utc,
        recovered_at_paris: tick.paris,
        recovered_by: workerId || "replay_autopilot",
        previous_error: item.last_error || null,
      },
    ],
    last_error: null,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function alignRecoveredReplayWorkExpectedRevision(item, expectedRevision) {
  const nextExpectedRevision = Number(expectedRevision);
  if (!Number.isInteger(nextExpectedRevision) || nextExpectedRevision < 0) {
    throw deskError(
      "INVALID_EXPECTED_REVISION",
      "Recovered Replay work requires a non-negative canonical expected_revision.",
      { expected_revision: expectedRevision },
    );
  }
  const saveTarget = item.save_target && typeof item.save_target === "object"
    ? {
        ...item.save_target,
        expected_revision: nextExpectedRevision,
      }
    : item.save_target;
  return {
    ...item,
    expected_revision: nextExpectedRevision,
    save_target: saveTarget,
  };
}

function projectReplayAutopilotStartResult({ config, creation, recovered, automation, state, worker_id, tick }) {
  const run = state?.selected_backtest || null;
  const workItem = state?.current_work_item || null;
  const terminal = ["COMPLETED", "DAY_END", "FAILED", "CANCELLED"].includes(state?.status);
  const workBusy = workItem?.status === "CLAIMED" && !isClaimableWorkItem(workItem, tick || { epochMs: Date.now() });
  const status = terminal
    ? "TERMINAL"
    : workItem?.status === "FAILED"
      ? "WORK_FAILED_REQUIRES_OPERATOR"
      : workBusy
        ? "WORK_BUSY"
        : ["WAITING_GPT_MASTER", "WAITING_GPT_MONITOR"].includes(state?.status)
          ? "WAITING_GPT"
          : automation?.status || state?.status || "UNKNOWN";
  return {
    ok: true,
    status,
    config: projectReplayAutopilotConfig(config),
    backtest_id: run?.backtest_id || config?.backtest_id || null,
    replay_status: state?.status || run?.status || null,
    current_replay_time: run?.current_replay_time || state?.replay_time || null,
    current_step_id: run?.current_step_id || state?.current_step_id || null,
    revision: Number(run?.revision || 0),
    created_replay: Boolean(creation && creation.idempotent_replay !== true),
    idempotent_replay: Boolean(creation?.idempotent_replay),
    recovered,
    automation,
    gpt_action_required: status === "WAITING_GPT",
    gpt_claim: status === "WAITING_GPT" ? {
      tool: "claim_next_replay_work",
      args: {
        worker_id: worker_id || "gpt-replay-autopilot",
        backtest_id: run?.backtest_id || config?.backtest_id || null,
      },
    } : null,
    work_item: workItem ? deskWorkSummary(workItem) : null,
    next_action: status === "WAITING_GPT" ? "claim_next_replay_work" : state?.next_action || null,
  };
}

function replayClaimResponse(result, args) {
  if (result?.status !== "WORK_CLAIMED") {
    return { ok: true, status: "NO_WORK", scope: "replay", reason: "no_ready_step", backtest_id: args.backtest_id || null };
  }
  const item = result.work_item;
  const saveTarget = enrichReplaySaveTargetForClaim(result.save_target, item);
  return {
    ok: true,
    status: "WORK_CLAIMED",
    scope: "replay",
    claim_handle: {
      work_item_id: item.work_item_id,
      backtest_id: item.backtest_id,
      step_id: item.step_id,
      sequence: item.sequence ?? null,
      lease_token: item.lease_token,
      lease_expires_at_utc: item.lease_expires_at_utc,
    },
    workflow: item.workflow,
    cutoff_paris: item.cutoff_paris,
    as_of_utc: item.as_of_utc || null,
    bundle: { bundle_id: item.bundle_id, bundle_tool: item.bundle_tool, bundle_args: result.bundle_args },
    execution_prompt: result.execution_prompt,
    prompt_hash: result.prompt_hash,
    save_target: saveTarget,
    expected_revision: item.expected_revision,
    idempotency_key: item.idempotency_key,
  };
}

function deskWorkClaimResponse(item) {
  return {
    ok: true,
    status: "WORK_CLAIMED",
    work_item: deskWorkSummary(item, { includeLeaseToken: true }),
    execution_prompt: item.execution_prompt,
    prompt_hash: item.execution_prompt_hash,
    bundle_args: item.bundle_args,
    save_target: enrichReplaySaveTargetForClaim(item.save_target, item),
  };
}

export function selectReplaySimulationPosition(positions = []) {
  return selectOpenReplayPosition(positions);
}

export function enrichReplayBundleSaveTargetForClaim(bundle = {}, workItem = null) {
  if (!bundle || !workItem || workItem.status !== "CLAIMED" || workItem.step_id !== bundle.step_id) return bundle;
  return { ...bundle, save_target: enrichReplaySaveTargetForClaim(bundle.save_target, workItem) };
}

function enrichReplaySaveTargetForClaim(saveTarget = null, workItem = null) {
  if (!saveTarget || !workItem || workItem.status !== "CLAIMED") return saveTarget;
  const protectedPayload = {
    expected_revision: workItem.expected_revision,
    idempotency_key: workItem.idempotency_key,
    work_item_id: workItem.work_item_id,
    worker_id: workItem.claimed_by || workItem.worker_id,
    lease_token: workItem.lease_token,
  };
  const canonicalWorkSaveTarget = workItem.save_target
    && typeof workItem.save_target === "object"
    && !workItem.save_target.suggested_payload
    ? workItem.save_target
    : {};
  const enriched = { ...saveTarget, ...canonicalWorkSaveTarget, ...protectedPayload };
  if (saveTarget.suggested_payload && typeof saveTarget.suggested_payload === "object") {
    enriched.suggested_payload = {
      ...saveTarget.suggested_payload,
      ...canonicalWorkSaveTarget,
      ...protectedPayload,
    };
  }
  return enriched;
}

export function deskWorkSummary(item, { includeLeaseToken = false } = {}) {
  if (!item) return null;
  return {
    work_item_id: item.work_item_id || null,
    workflow: item.workflow || null,
    automation_scope: item.automation_scope || null,
    status: item.status || null,
    priority: item.priority ?? null,
    backtest_id: item.backtest_id || null,
    run_id: item.run_id || null,
    trading_date: item.trading_date || null,
    session: item.session || null,
    step_id: item.step_id || null,
    sequence: item.sequence ?? null,
    cutoff_paris: item.cutoff_paris || null,
    as_of_utc: item.as_of_utc || null,
    bundle_id: item.bundle_id || null,
    bundle_tool: item.bundle_tool || null,
    save_tool: item.save_tool || null,
    expected_revision: item.expected_revision ?? null,
    idempotency_key: item.idempotency_key || null,
    prompt_name: item.prompt_name || null,
    prompt_version: item.prompt_version || null,
    prompt_hash: item.prompt_hash || null,
    prompt_text: item.prompt_text || null,
    attempt_count: item.attempt_count ?? null,
    max_attempts: item.max_attempts ?? null,
    retry_after_utc: item.retry_after_utc || null,
    failure_count: item.failure_count || 0,
    claimed_by: item.claimed_by || null,
    ...(includeLeaseToken ? { lease_token: item.lease_token || null } : {}),
    lease_expires_at_utc: item.lease_expires_at_utc || null,
    last_error: item.last_error || null,
    completed_at_utc: item.completed_at_utc || null,
  };
}

function workQueueStatus(item) {
  if (!item) return "NO_WORK";
  if (item.status === "CLAIMED") return "WORK_BUSY";
  if (item.status === "FAILED") return "WORK_FAILED";
  return "WORK_READY";
}

export function compareDeskWorkItems(left, right) {
  return Number(left.priority || 999) - Number(right.priority || 999)
    || String(right.created_at_utc || "").localeCompare(String(left.created_at_utc || ""));
}

function patchReplayRun(run, patch, tick) {
  return {
    ...run,
    ...patch,
    next_action: nextReplayAction(patch.status || run.status),
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

export function nextReplayAction(status) {
  return replayNextAction(status);
}

function normalizeReplayTimestamp(value, date) {
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text;
  if (/^\d{2}:\d{2}/.test(text)) return `${date}T${text.length === 5 ? `${text}:00` : text}${parisOffsetForDate(date)}`;
  return text;
}

function parisOffsetForDate(dateText) {
  const date = new Date(`${dateText}T12:00:00Z`);
  const year = date.getUTCFullYear();
  const dstStart = lastSundayUtc(year, 2);
  const dstEnd = lastSundayUtc(year, 9);
  return date >= dstStart && date < dstEnd ? "+02:00" : "+01:00";
}

function lastSundayUtc(year, monthIndex) {
  const date = new Date(Date.UTC(year, monthIndex + 1, 0, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date;
}
