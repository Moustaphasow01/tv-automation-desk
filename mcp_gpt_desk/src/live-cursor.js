import { toParisIso, toUtcIso } from "@tv-automation/desk-time";
import { buildWorkDeadLetter } from "./dead-letter.js";
import {
  buildLiveMonitorRollForwardContext,
  floorParisCheckpoint,
  parisWallTimeIso,
} from "./live-scope.js";
import { normalizeGptTelemetry, sameGptTelemetry } from "./gpt-telemetry.js";
import {
  DAILY_END_TIME,
  DAILY_NY_MASTER_TIME,
  DAILY_PHASES,
  DAILY_RUN_SCOPE,
  DAILY_SCOPE_SESSION,
  DAILY_START_TIME,
  dailyCursorId,
  dailyRunId,
  dailyRunPhaseAt,
  dailyRunStrategyAt,
} from "./daily-run-model.js";
import {
  assertActiveStrategyContractContext,
  assertActiveStrategySaveTarget,
} from "./strategy-runtime-versioning.js";
import {
  GPT_MONITOR_CADENCE_MINUTES,
  GPT_MONITOR_CADENCE_SECONDS,
} from "./desk-monitor-cadence.js";

export const LIVE_CURSOR_SCHEMA_VERSION = "3.0.0";
export const CADENCE_MINUTES = GPT_MONITOR_CADENCE_MINUTES;
export const CADENCE_SECONDS = GPT_MONITOR_CADENCE_SECONDS;
export const LEASE_MARGIN_SECONDS = 120;
// The GPT lease is intentionally decoupled from the analytical cadence.
// A monitor can legitimately take several minutes to complete; the
// latest-wins policy prevents a stale result from replacing a newer one.
export const LEASE_HARD_CAP_SECONDS = 780;
export const DEFAULT_LIVE_LEASE_SECONDS = 660;
export const MAX_LIVE_ATTEMPTS = 6;
export const RETRY_BACKOFF_BASE_SECONDS = 30;
export const RETRY_BACKOFF_MAX_SECONDS = 300;
export const RETRY_JITTER_MAX_SECONDS = 15;
export const LIVENESS_STALE_MINUTES = 20;
export const LIVE_CURSOR_TTL_DAYS = 90;
export const LIVE_REPLAN_ACTIONS = Object.freeze([
  "REPLAN_FULL",
  "REPLAN_REQUIRED",
  "NEW_MASTER_REQUIRED",
  "INVALIDATE_THESIS",
]);
const LIVE_REPLAN_ACTION_SET = new Set(LIVE_REPLAN_ACTIONS);

export const LIVE_CURSOR_STATUSES = Object.freeze([
  "IDLE",
  "DUE",
  "LEASED",
  "RETRY",
  "BLOCKED",
  "DEGRADED",
  "CLOSED",
]);
export const LIVE_CURSOR_WORKFLOWS = Object.freeze(["LIVE_MASTER", "LIVE_M15_MONITOR"]);
export const LIVE_CURSOR_EVENT_TYPES = Object.freeze([
  "CURSOR_CLAIMED",
  "CURSOR_HEARTBEAT",
  "CURSOR_COMPLETED",
  "CURSOR_ROLLED_FORWARD",
  "CURSOR_RETRY_SCHEDULED",
  "CURSOR_BLOCKED",
  "CURSOR_DEGRADED",
  "CURSOR_DEAD_LETTER",
  "CURSOR_LIVENESS_ALERT",
  "CURSOR_LEASE_CAPPED",
  "CURSOR_REPLAN_REQUESTED",
  "CURSOR_EVENT_MONITOR_REQUESTED",
  "CURSOR_CLOSED",
]);

export function liveRunCursorId(tradingDate) {
  assertTradingDate(tradingDate);
  return dailyCursorId(tradingDate);
}

export function initLiveRunCursor({ trading_date }, tick) {
  assertTradingDate(trading_date);
  const now = normalizeTick(tick);
  const cursorId = liveRunCursorId(trading_date);
  return {
    cursor_id: cursorId,
    schema_version: LIVE_CURSOR_SCHEMA_VERSION,
    run_id: dailyRunId(trading_date),
    trading_date,
    session: DAILY_SCOPE_SESSION,
    strategy_id: "asia_open",
    run_scope: DAILY_RUN_SCOPE,
    phases: DAILY_PHASES,
    current_phase: "asia_open",
    phase_master_ids: {},
    phase_thesis_ids: {},
    cadence_minutes: CADENCE_MINUTES,
    window: {
      master_cutoff_paris: parisWallTimeIso(trading_date, DAILY_START_TIME),
      open_paris: parisWallTimeIso(trading_date, "00:30:00"),
      close_paris: parisWallTimeIso(trading_date, DAILY_END_TIME),
      ny_master_cutoff_paris: parisWallTimeIso(trading_date, DAILY_NY_MASTER_TIME),
    },
    master_state: "MISSING",
    master_id: null,
    thesis_state: "MISSING",
    thesis_id: null,
    replan_checkpoint: null,
    replan_action: null,
    event_monitor_checkpoint: null,
    event_monitor_reason: null,
    event_monitor_event_types: [],
    target_checkpoint: null,
    last_completed_checkpoint: null,
    cursor_status: "IDLE",
    attempt: null,
    data_quality: null,
    gap_ledger: [],
    recovery_count: 0,
    last_claimed_at_utc: null,
    last_claimed_checkpoint: null,
    last_claimed_workflow: null,
    last_claimed_worker_id: null,
    dead_letter_ref: null,
    created_at_utc: now.utc,
    updated_at_utc: now.utc,
    closed_at_utc: null,
    expires_at_utc: null,
  };
}

export function shadowLiveCursorBundle(cursorValue, prepared, tick) {
  const cursor = cloneCursor(cursorValue);
  assertCursor(cursor);
  cursor.cadence_minutes = CADENCE_MINUTES;
  const now = normalizeTick(tick);
  const workflow = prepared?.workflow;
  if (!LIVE_CURSOR_WORKFLOWS.includes(workflow)) throw new Error("LIVE_CURSOR_SHADOW_WORKFLOW_INVALID");
  const checkpoint = requiredText(prepared?.checkpoint, "LIVE_CURSOR_SHADOW_CHECKPOINT_REQUIRED");
  if (!Number.isFinite(Date.parse(checkpoint))) throw new Error("LIVE_CURSOR_SHADOW_CHECKPOINT_INVALID");
  const bundleId = requiredText(prepared?.bundle_id, "LIVE_CURSOR_SHADOW_BUNDLE_REQUIRED");
  const dataQuality = normalizeDataQuality(prepared?.data_quality);
  const workStatus = String(prepared?.work_status || "READY").toUpperCase();
  const completed = workStatus === "COMPLETED" || workStatus === "DONE";
  const phase = prepared?.phase || dailyRunPhaseAt(checkpoint);

  if (workflow === "LIVE_M15_MONITOR") {
    if (prepared.master_id) {
      cursor.master_state = "READY";
      cursor.master_id = prepared.master_id;
    }
    if (prepared.thesis_id) {
      cursor.thesis_state = "ACTIVE";
      cursor.thesis_id = prepared.thesis_id;
    }
    cursor.target_checkpoint = laterCheckpoint(cursor.target_checkpoint, checkpoint);
    if (completed) cursor.last_completed_checkpoint = laterCheckpoint(cursor.last_completed_checkpoint, checkpoint);
  } else if (completed) {
    if (prepared.master_id) {
      cursor.master_state = "READY";
      cursor.master_id = prepared.master_id;
    }
    if (prepared.thesis_id) {
      cursor.thesis_state = "ACTIVE";
      cursor.thesis_id = prepared.thesis_id;
    }
    cursor.current_phase = phase;
    cursor.phase_master_ids = { ...(cursor.phase_master_ids || {}), ...(prepared.master_id ? { [phase]: prepared.master_id } : {}) };
    cursor.phase_thesis_ids = { ...(cursor.phase_thesis_ids || {}), ...(prepared.thesis_id ? { [phase]: prepared.thesis_id } : {}) };
    cursor.last_completed_checkpoint = laterCheckpoint(cursor.last_completed_checkpoint, checkpoint);
  }

  if (!activeLease(cursor.attempt, now)) {
    cursor.attempt = {
      workflow,
      phase,
      checkpoint,
      bundle_id: bundleId,
      status: completed ? "DONE" : "PENDING",
      worker_id: null,
      lease_token: null,
      started_at_utc: null,
      lease_expires_at_utc: null,
      attempt_count: Number(cursor.attempt?.checkpoint === checkpoint ? cursor.attempt?.attempt_count || 0 : 0),
      available_at_utc: now.utc,
      bundle_ready_at_utc: now.utc,
      last_error: cursor.attempt?.checkpoint === checkpoint ? cursor.attempt?.last_error || null : null,
    };
    cursor.cursor_status = completed ? "IDLE" : "DUE";
  }
  cursor.data_quality = dataQuality;
  cursor.updated_at_utc = now.utc;
  return cursor;
}

export function resolveTargetCheckpoint(cursor, tick) {
  assertCursor(cursor);
  const now = normalizeTick(tick);
  const eventCheckpoint = validEventMonitorCheckpoint(cursor, now);
  if (eventCheckpoint) return eventCheckpoint;
  const floor = floorParisCheckpoint(now.epochMs, CADENCE_MINUTES);
  const floorMs = Date.parse(floor);
  const openMs = Date.parse(cursor.window.open_paris);
  const closeMs = Date.parse(cursor.window.close_paris);
  if (floorMs <= openMs) return cursor.window.open_paris;
  if (floorMs >= closeMs) return cursor.window.close_paris;
  return floor;
}

export function claimLiveCursor(cursorValue, args, tick) {
  const cursor = cloneCursor(cursorValue);
  assertCursor(cursor);
  cursor.cadence_minutes = CADENCE_MINUTES;
  const now = normalizeTick(tick);
  const target = resolveTargetCheckpoint(cursor, now);
  cursor.target_checkpoint = target;
  const replanCheckpoint = validReplanCheckpoint(cursor);
  const phase = dailyRunPhaseAt(replanCheckpoint || target);
  const phaseMasterCutoff = phase === "ny_open"
    ? cursor.window.ny_master_cutoff_paris
    : cursor.window.master_cutoff_paris;

  if (now.paris.slice(0, 10) !== cursor.trading_date) {
    return transition(cursor, noWork(cursor, "trading_date_mismatch", null), []);
  }
  const openMs = Date.parse(cursor.window.open_paris);
  const closeAfterCadenceMs = Date.parse(cursor.window.close_paris) + CADENCE_SECONDS * 1000;
  if (now.epochMs >= closeAfterCadenceMs) {
    cursor.cursor_status = "CLOSED";
    cursor.closed_at_utc = cursor.closed_at_utc || now.utc;
    cursor.expires_at_utc = cursor.expires_at_utc || liveCursorExpiryUtc(cursor.closed_at_utc);
    cursor.updated_at_utc = now.utc;
    const event = liveCursorEvent(cursor, "CURSOR_CLOSED", now, { target_checkpoint: target });
    return transition(cursor, noWork(cursor, "market_closed", null), [event]);
  }

  if (activeLease(cursor.attempt, now)) {
    return transition(cursor, noWork(cursor, "in_progress", cursor.attempt.lease_expires_at_utc), []);
  }

  const phaseMasterMissing = !cursor.phase_master_ids?.[phase] || !cursor.phase_thesis_ids?.[phase];
  const expectedWorkflow = phaseMasterMissing || replanCheckpoint
    ? "LIVE_MASTER"
    : "LIVE_M15_MONITOR";
  const eventMonitorContext = expectedWorkflow === "LIVE_M15_MONITOR"
    ? eventMonitorContextFor(cursor, target)
    : null;
  const requiredMasterCheckpoint = replanCheckpoint || phaseMasterCutoff;
  const requiredMasterMs = Date.parse(requiredMasterCheckpoint);
  if (expectedWorkflow === "LIVE_MASTER" && now.epochMs < requiredMasterMs) {
    cursor.cursor_status = "BLOCKED";
    cursor.updated_at_utc = now.utc;
    return transition(cursor, noWork(cursor, "master_not_due", toUtcIso(requiredMasterMs)), [
      liveCursorEvent(cursor, "CURSOR_BLOCKED", now, { reason: "master_not_due" }),
    ]);
  }
  if (expectedWorkflow === "LIVE_M15_MONITOR" && now.epochMs < openMs) {
    return transition(cursor, noWork(cursor, "outside_window", toUtcIso(openMs)), []);
  }
  if (expectedWorkflow === "LIVE_M15_MONITOR" && checkpointAtOrAfter(cursor.last_completed_checkpoint, target)) {
    cursor.cursor_status = "IDLE";
    cursor.updated_at_utc = now.utc;
    return transition(cursor, noWork(cursor, "up_to_date", null), []);
  }

  const claimCheckpoint = expectedWorkflow === "LIVE_MASTER"
    ? requiredMasterCheckpoint
    : target;

  const previousAttempt = cursor.attempt;
  const previousCheckpoint = previousAttempt?.checkpoint || null;
  const catchupContext = expectedWorkflow === "LIVE_M15_MONITOR"
    ? buildLiveMonitorRollForwardContext({
        session: phase,
        tradingDate: cursor.trading_date,
        lastCompletedCheckpoint: cursor.last_completed_checkpoint,
        previousAttemptCheckpoint: previousCheckpoint,
        previousAttemptStatus: previousAttempt?.status,
        monitorCheckpointParis: claimCheckpoint,
        cadenceMinutes: CADENCE_MINUTES,
      })
    : null;
  const masterRecoveryPromptVersion = String(args?.recovery_prompt_version || "");
  const recoversDegradedMasterAfterPromptUpgrade = cursor.cursor_status === "DEGRADED"
    && expectedWorkflow === "LIVE_MASTER"
    && previousAttempt?.workflow === "LIVE_MASTER"
    && previousCheckpoint === claimCheckpoint
    && Boolean(masterRecoveryPromptVersion)
    && previousAttempt?.prompt_version !== masterRecoveryPromptVersion;
  const targetAdvanced = expectedWorkflow === "LIVE_M15_MONITOR"
    && previousAttempt?.workflow === "LIVE_M15_MONITOR"
    && previousAttempt?.status !== "DONE"
    && checkpointBefore(previousCheckpoint, claimCheckpoint);
  const events = [];
  const rolledForwardFrom = catchupContext?.skipped_checkpoints?.length
    ? [...catchupContext.skipped_checkpoints]
    : [];
  const rollForwardAlreadyAudited = catchupContext
    ? cursor.gap_ledger.some((entry) => (
        entry.to_checkpoint === claimCheckpoint
        && sameCheckpointList(entry.skipped_checkpoints, catchupContext.skipped_checkpoints)
      ))
    : false;
  if (catchupContext && !rollForwardAlreadyAudited) {
    const reason = targetAdvanced ? "stale_checkpoint_rolled_forward" : "latest_monitor_wins";
    cursor.gap_ledger.push({
      from_checkpoint: catchupContext.analysis_window.from_paris,
      to_checkpoint: claimCheckpoint,
      skipped_checkpoints: [...catchupContext.skipped_checkpoints],
      skipped_checkpoint_count: catchupContext.skipped_checkpoint_count,
      reason,
      at_utc: now.utc,
    });
    cursor.recovery_count = Number(cursor.recovery_count || 0) + 1;
    events.push(liveCursorEvent(cursor, "CURSOR_ROLLED_FORWARD", now, {
      from_checkpoint: catchupContext.analysis_window.from_paris,
      to_checkpoint: claimCheckpoint,
      skipped_checkpoints: [...catchupContext.skipped_checkpoints],
      skipped_checkpoint_count: catchupContext.skipped_checkpoint_count,
      policy: catchupContext.selected_checkpoint_policy,
      reason,
    }));
  }

  if (!targetAdvanced && previousAttempt?.checkpoint === claimCheckpoint) {
    if (cursor.cursor_status === "DEGRADED" && !recoversDegradedMasterAfterPromptUpgrade) {
      return transition(cursor, noWork(cursor, "in_progress", nextCheckpointUtc(claimCheckpoint)), events);
    }
    const availableAtMs = Date.parse(previousAttempt.available_at_utc || "");
    if (Number.isFinite(availableAtMs) && availableAtMs > now.epochMs) {
      return transition(cursor, noWork(cursor, "in_progress", previousAttempt.available_at_utc), events);
    }
  }

  if (!args?.work) {
    return transition(cursor, {
      ok: true,
      status: "WORK_DUE",
      scope: "live",
      workflow: expectedWorkflow,
      phase,
      strategy_id: dailyRunStrategyAt(claimCheckpoint),
      run_id: cursor.run_id,
      cursor_id: cursor.cursor_id,
      trading_date: cursor.trading_date,
      checkpoint: claimCheckpoint,
      target_checkpoint: target,
      catchup_context: catchupContext,
      event_monitor_context: eventMonitorContext,
      rolled_forward_from: rolledForwardFrom.length ? rolledForwardFrom : null,
    }, events);
  }
  const work = normalizePreparedWork(args.work, expectedWorkflow, claimCheckpoint, phase);
  const requestedLeaseSeconds = boundedLeaseSeconds(args?.lease_seconds);
  const leaseSeconds = Math.min(requestedLeaseSeconds, LEASE_HARD_CAP_SECONDS);
  const leaseToken = requiredText(args?.lease_token, "LIVE_LEASE_TOKEN_REQUIRED");
  const workerId = requiredText(args?.worker_id, "LIVE_WORKER_ID_REQUIRED");
  const sameCheckpoint = previousCheckpoint === claimCheckpoint
    && previousAttempt?.workflow === expectedWorkflow;
  const attemptCount = sameCheckpoint ? Number(previousAttempt?.attempt_count || 0) + 1 : 1;
  const leaseExpiresAtUtc = toUtcIso(now.epochMs + leaseSeconds * 1000);
  const bundleReadyAtUtc = sameCheckpoint && previousAttempt?.bundle_id === work.bundle.bundle_id
    ? previousAttempt.bundle_ready_at_utc || previousAttempt.available_at_utc || now.utc
    : work.bundle_ready_at_utc || work.prepared_at_utc || now.utc;
  cursor.attempt = {
    workflow: expectedWorkflow,
    phase,
    checkpoint: claimCheckpoint,
    bundle_id: work.bundle.bundle_id,
    status: "LEASED",
    worker_id: workerId,
    lease_token: leaseToken,
    started_at_utc: now.utc,
    lease_expires_at_utc: leaseExpiresAtUtc,
    attempt_count: attemptCount,
    available_at_utc: now.utc,
    bundle_ready_at_utc: bundleReadyAtUtc,
    last_error: null,
    prompt_version: work.prompt_version || masterRecoveryPromptVersion || null,
  };
  cursor.cursor_status = "LEASED";
  cursor.current_phase = phase;
  cursor.strategy_id = dailyRunStrategyAt(claimCheckpoint);
  cursor.data_quality = work.data_quality;
  cursor.last_claimed_at_utc = now.utc;
  cursor.last_claimed_checkpoint = claimCheckpoint;
  cursor.last_claimed_workflow = expectedWorkflow;
  cursor.last_claimed_worker_id = workerId;
  cursor.updated_at_utc = now.utc;
  cursor.closed_at_utc = null;
  cursor.expires_at_utc = null;
  const claimedEvent = liveCursorEvent(cursor, "CURSOR_CLAIMED", now, {
    worker_id: workerId,
    workflow: expectedWorkflow,
    lease_expires_at_utc: leaseExpiresAtUtc,
    rolled_forward_from: rolledForwardFrom,
    catchup_context: catchupContext,
    event_monitor_context: eventMonitorContext,
    recovery_reason: recoversDegradedMasterAfterPromptUpgrade ? "live_prompt_version_upgraded" : null,
  });
  events.push(claimedEvent);
  return transition(cursor, {
    ok: true,
    status: "WORK_CLAIMED",
    scope: "live",
    claim_handle: {
      cursor_id: cursor.cursor_id,
      run_id: cursor.run_id,
      session: phase,
      phase,
      trading_date: cursor.trading_date,
      workflow: expectedWorkflow,
      checkpoint: claimCheckpoint,
      lease_token: leaseToken,
      lease_expires_at_utc: leaseExpiresAtUtc,
    },
    target_checkpoint: target,
    master_id: work.master_id ?? cursor.master_id,
    thesis_id: work.thesis_id ?? cursor.thesis_id,
    data_quality: work.data_quality,
    rolled_forward_from: rolledForwardFrom.length ? rolledForwardFrom : null,
    catchup_context: work.catchup_context || catchupContext,
    event_monitor_context: eventMonitorContext,
    recovery_reason: recoversDegradedMasterAfterPromptUpgrade ? "live_prompt_version_upgraded" : null,
    bundle: work.bundle,
    execution_prompt: work.execution_prompt,
    prompt_hash: work.prompt_hash,
    save_target: work.save_target,
    contract_context: work.contract_context,
    runtime_versions: work.runtime_versions,
  }, events);
}

export function heartbeatLiveCursor(cursorValue, args, tick) {
  const cursor = cloneCursor(cursorValue);
  const now = normalizeTick(tick);
  assertLiveLease(cursor, args, now, { allowExpired: true });
  const hardCapMs = Date.parse(cursor.attempt.started_at_utc) + LEASE_HARD_CAP_SECONDS * 1000;
  if (now.epochMs >= hardCapMs) {
    cursor.attempt.status = "FAILED";
    cursor.attempt.lease_token = null;
    cursor.attempt.lease_expires_at_utc = now.utc;
    cursor.attempt.available_at_utc = now.utc;
    cursor.attempt.last_error = {
      code: "LIVE_LEASE_HARD_CAP",
      message: "Live cursor lease reached its hard cap.",
      class: "transient",
      occurred_at_utc: now.utc,
    };
    cursor.cursor_status = "RETRY";
    cursor.updated_at_utc = now.utc;
    const event = liveCursorEvent(cursor, "CURSOR_LEASE_CAPPED", now, { hard_cap_utc: toUtcIso(hardCapMs) });
    return transition(cursor, { ok: true, status: "LEASE_CAPPED", scope: "live" }, [event]);
  }
  const currentExpiryMs = Date.parse(cursor.attempt.lease_expires_at_utc || "");
  if (!Number.isFinite(currentExpiryMs) || currentExpiryMs <= now.epochMs) {
    throw liveCursorError("LIVE_LEASE_EXPIRED", "Live cursor lease has expired.");
  }
  const leaseExpiresAtUtc = toUtcIso(Math.min(
    now.epochMs + DEFAULT_LIVE_LEASE_SECONDS * 1000,
    hardCapMs,
  ));
  cursor.attempt.lease_expires_at_utc = leaseExpiresAtUtc;
  cursor.updated_at_utc = now.utc;
  const event = liveCursorEvent(cursor, "CURSOR_HEARTBEAT", now, { lease_expires_at_utc: leaseExpiresAtUtc });
  return transition(cursor, {
    ok: true,
    status: "LEASE_EXTENDED",
    scope: "live",
    lease_expires_at_utc: leaseExpiresAtUtc,
  }, [event]);
}

export function completeLiveCursor(cursorValue, args, tick, {
  outputMaterialized = false,
  materializedMasterId = null,
  materializedThesisId = null,
  monitorAction = null,
  monitorReplanCheckpoint = null,
} = {}) {
  const cursor = cloneCursor(cursorValue);
  const now = normalizeTick(tick);
  const telemetry = normalizeGptTelemetry(args?.telemetry);
  const alreadyCompletedAttempt = cursor.attempt?.status === "DONE" && cursor.attempt?.checkpoint === args?.checkpoint;
  const completingLeasedAttempt = cursor.attempt?.status === "LEASED"
    && cursor.attempt?.checkpoint === args?.checkpoint;
  if (alreadyCompletedAttempt
    || (!completingLeasedAttempt && checkpointAtOrAfter(cursor.last_completed_checkpoint, args?.checkpoint))) {
    if (telemetry && cursor.attempt?.checkpoint === args?.checkpoint) {
      if (cursor.attempt.gpt_telemetry) {
        if (!sameGptTelemetry(cursor.attempt.gpt_telemetry, telemetry)) {
          throw liveCursorError("GPT_TELEMETRY_CONFLICT", "GPT telemetry is immutable once recorded for a completed live cursor.");
        }
        return transition(cursor, {
          ok: true,
          status: "DONE",
          scope: "live",
          idempotent: true,
          telemetry_recorded: true,
          last_completed_checkpoint: cursor.last_completed_checkpoint,
        }, []);
      }
      cursor.attempt.gpt_telemetry = telemetry;
      cursor.attempt.telemetry_recorded_at_utc = now.utc;
      cursor.updated_at_utc = now.utc;
      const event = liveCursorEvent(cursor, "CURSOR_COMPLETED", now, { worker_id: args.worker_id, telemetry: cursor.attempt.gpt_telemetry, telemetry_only: true });
      return transition(cursor, {
        ok: true,
        status: "DONE",
        scope: "live",
        idempotent: true,
        telemetry_recorded: true,
        last_completed_checkpoint: cursor.last_completed_checkpoint,
      }, [event]);
    }
    return transition(cursor, {
      ok: true,
      status: "DONE",
      scope: "live",
      idempotent: true,
      last_completed_checkpoint: cursor.last_completed_checkpoint,
    }, []);
  }
  assertLiveLease(cursor, args, now, { allowExpired: false });
  if (!outputMaterialized) throw liveCursorError("LIVE_OUTPUT_NOT_MATERIALIZED", "Live GPT output is not materialized.");
  if (cursor.attempt.workflow === "LIVE_MASTER") {
    const phase = cursor.attempt.phase || dailyRunPhaseAt(args.checkpoint);
    cursor.master_id = requiredText(materializedMasterId, "LIVE_MASTER_ID_REQUIRED");
    cursor.master_state = "READY";
    cursor.thesis_id = requiredText(materializedThesisId, "LIVE_THESIS_ID_REQUIRED");
    cursor.thesis_state = "ACTIVE";
    cursor.current_phase = phase;
    cursor.strategy_id = dailyRunStrategyAt(args.checkpoint);
    cursor.phase_master_ids = { ...(cursor.phase_master_ids || {}), [phase]: cursor.master_id };
    cursor.phase_thesis_ids = { ...(cursor.phase_thesis_ids || {}), [phase]: cursor.thesis_id };
    if (cursor.replan_checkpoint && Date.parse(cursor.replan_checkpoint) <= Date.parse(args.checkpoint)) {
      cursor.replan_checkpoint = null;
      cursor.replan_action = null;
    }
    cursor.last_completed_checkpoint = laterCheckpoint(cursor.last_completed_checkpoint, args.checkpoint);
  } else {
    cursor.last_completed_checkpoint = args.checkpoint;
    if (cursor.event_monitor_checkpoint
      && Date.parse(cursor.event_monitor_checkpoint) <= Date.parse(args.checkpoint)) {
      cursor.event_monitor_checkpoint = null;
      cursor.event_monitor_reason = null;
      cursor.event_monitor_event_types = [];
    }
    const normalizedMonitorAction = normalizeLiveReplanAction(monitorAction);
    if (normalizedMonitorAction) {
      cursor.replan_checkpoint = validMonitorReplanCheckpoint(
        monitorReplanCheckpoint,
        args.checkpoint,
        cursor.trading_date,
      );
      cursor.replan_action = normalizedMonitorAction;
      cursor.master_state = "REPLAN_REQUIRED";
      cursor.thesis_state = "REPLAN_REQUIRED";
    }
  }
  cursor.attempt.status = "DONE";
  cursor.attempt.completed_at_utc = now.utc;
  cursor.attempt.gpt_telemetry = telemetry || cursor.attempt.gpt_telemetry || null;
  cursor.attempt.telemetry_recorded_at_utc = telemetry ? now.utc : cursor.attempt.telemetry_recorded_at_utc || null;
  cursor.attempt.lease_token = null;
  cursor.attempt.lease_expires_at_utc = null;
  cursor.cursor_status = cursor.replan_checkpoint ? "DUE" : "IDLE";
  cursor.updated_at_utc = now.utc;
  const event = liveCursorEvent(cursor, "CURSOR_COMPLETED", now, {
    worker_id: args.worker_id,
    telemetry: cursor.attempt.gpt_telemetry,
    replan_checkpoint: cursor.replan_checkpoint,
    replan_action: cursor.replan_action,
  });
  return transition(cursor, {
    ok: true,
    status: "DONE",
    scope: "live",
    idempotent: false,
    last_completed_checkpoint: cursor.last_completed_checkpoint,
    next_workflow: cursor.replan_checkpoint ? "LIVE_MASTER" : null,
  }, [event]);
}

export function armLiveCursorEventMonitor(cursorValue, {
  checkpoint,
  reason = "CRITICAL_ENGINE_EVENT",
  event_types = [],
} = {}, tick) {
  const cursor = cloneCursor(cursorValue);
  const now = normalizeTick(tick);
  assertCursor(cursor);
  const checkpointMs = Date.parse(checkpoint || "");
  if (!Number.isFinite(checkpointMs)
    || String(checkpoint).slice(0, 10) !== cursor.trading_date
    || checkpointMs > now.epochMs) {
    throw liveCursorError(
      "LIVE_EVENT_MONITOR_CHECKPOINT_INVALID",
      "Live event Monitor checkpoint is invalid.",
    );
  }
  if (checkpointAtOrAfter(cursor.last_completed_checkpoint, checkpoint)) {
    return transition(cursor, {
      ok: true,
      status: "EVENT_MONITOR_ALREADY_COVERED",
      scope: "live",
      checkpoint,
    }, []);
  }
  if (cursor.event_monitor_checkpoint === checkpoint) {
    return transition(cursor, {
      ok: true,
      status: "EVENT_MONITOR_ALREADY_ARMED",
      scope: "live",
      checkpoint,
    }, []);
  }
  cursor.event_monitor_checkpoint = laterCheckpoint(cursor.event_monitor_checkpoint, checkpoint);
  cursor.event_monitor_reason = requiredText(reason, "LIVE_EVENT_MONITOR_REASON_REQUIRED");
  cursor.event_monitor_event_types = [...new Set(
    (Array.isArray(event_types) ? event_types : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];
  if (!activeLease(cursor.attempt, now)) cursor.cursor_status = "DUE";
  cursor.updated_at_utc = now.utc;
  return transition(cursor, {
    ok: true,
    status: "EVENT_MONITOR_ARMED",
    scope: "live",
    checkpoint: cursor.event_monitor_checkpoint,
    reason: cursor.event_monitor_reason,
    event_types: cursor.event_monitor_event_types,
  }, [liveCursorEvent(cursor, "CURSOR_EVENT_MONITOR_REQUESTED", now, {
    checkpoint: cursor.event_monitor_checkpoint,
    reason: cursor.event_monitor_reason,
    event_types: cursor.event_monitor_event_types,
  })]);
}

export function armLiveCursorReplan(cursorValue, {
  checkpoint,
  action,
} = {}, tick) {
  const cursor = cloneCursor(cursorValue);
  const now = normalizeTick(tick);
  assertCursor(cursor);
  const normalizedAction = normalizeLiveReplanAction(action);
  if (!normalizedAction) return transition(cursor, { ok: true, status: "NO_REPLAN", scope: "live" }, []);
  const checkpointMs = Date.parse(checkpoint || "");
  if (!Number.isFinite(checkpointMs)) {
    throw liveCursorError("LIVE_REPLAN_CHECKPOINT_INVALID", "Live replan checkpoint is invalid.");
  }
  if (!checkpointAtOrAfter(cursor.last_completed_checkpoint, checkpoint)) {
    return transition(cursor, { ok: true, status: "REPLAN_NOT_COMPLETED", scope: "live" }, []);
  }
  if (cursor.replan_checkpoint === checkpoint && cursor.replan_action === normalizedAction) {
    return transition(cursor, { ok: true, status: "REPLAN_ALREADY_ARMED", scope: "live" }, []);
  }
  cursor.replan_checkpoint = checkpoint;
  cursor.replan_action = normalizedAction;
  cursor.master_state = "REPLAN_REQUIRED";
  cursor.thesis_state = "REPLAN_REQUIRED";
  if (!activeLease(cursor.attempt, now)) cursor.cursor_status = "DUE";
  cursor.updated_at_utc = now.utc;
  return transition(cursor, {
    ok: true,
    status: "REPLAN_ARMED",
    scope: "live",
    checkpoint,
    action: normalizedAction,
  }, [liveCursorEvent(cursor, "CURSOR_REPLAN_REQUESTED", now, {
    checkpoint,
    action: normalizedAction,
  })]);
}

export function failLiveCursor(cursorValue, args, tick, { jitterSeconds = 0, contextSnapshot = {} } = {}) {
  const cursor = cloneCursor(cursorValue);
  const now = normalizeTick(tick);
  assertLiveLease(cursor, args, now, { allowExpired: true });
  const errorClass = args.error_class;
  if (!['transient', 'deterministic'].includes(errorClass)) {
    throw liveCursorError("LIVE_ERROR_CLASS_INVALID", "Live error class is invalid.");
  }
  const lastError = {
    code: requiredText(args.error_code, "LIVE_ERROR_CODE_REQUIRED"),
    message: requiredText(args.error_message, "LIVE_ERROR_MESSAGE_REQUIRED"),
    class: errorClass,
    occurred_at_utc: now.utc,
  };
  cursor.attempt.status = "FAILED";
  cursor.attempt.lease_token = null;
  cursor.attempt.lease_expires_at_utc = null;
  cursor.attempt.last_error = lastError;
  cursor.updated_at_utc = now.utc;
  const events = [];
  const deadLetters = [];
  const exhausted = errorClass === "transient" && Number(cursor.attempt.attempt_count || 0) >= MAX_LIVE_ATTEMPTS;
  if (errorClass === "deterministic" || exhausted) {
    const deadLetter = buildWorkDeadLetter({
      scope: "live",
      source_ref: {
        cursor_id: cursor.cursor_id,
        run_id: cursor.run_id,
        checkpoint: cursor.attempt.checkpoint,
      },
      workflow: cursor.attempt.workflow,
      error: {
        code: lastError.code,
        message: lastError.message,
        class: exhausted ? "transient_exhausted" : "deterministic",
        occurred_at_utc: now.utc,
      },
      attempt_count: cursor.attempt.attempt_count,
      context_snapshot: {
        data_quality: cursor.data_quality,
        master_id: cursor.master_id,
        thesis_id: cursor.thesis_id,
        pack_build_id: contextSnapshot.pack_build_id || null,
        ...contextSnapshot,
      },
    }, now);
    cursor.cursor_status = "DEGRADED";
    cursor.dead_letter_ref = deadLetter.dead_letter_id;
    cursor.attempt.available_at_utc = now.utc;
    deadLetters.push(deadLetter);
    events.push(liveCursorEvent(cursor, "CURSOR_DEAD_LETTER", now, { dead_letter_id: deadLetter.dead_letter_id }));
    events.push(liveCursorEvent(cursor, "CURSOR_DEGRADED", now, { error_class: deadLetter.error.class }));
  } else {
    const backoffSeconds = liveRetryBackoffSeconds(cursor.attempt.attempt_count, jitterSeconds);
    cursor.attempt.available_at_utc = toUtcIso(now.epochMs + backoffSeconds * 1000);
    cursor.cursor_status = "RETRY";
    events.push(liveCursorEvent(cursor, "CURSOR_RETRY_SCHEDULED", now, {
      backoff_seconds: backoffSeconds,
      available_at_utc: cursor.attempt.available_at_utc,
    }));
  }
  return {
    ...transition(cursor, {
      ok: true,
      status: cursor.cursor_status,
      scope: "live",
      next_eligible_at_utc: cursor.attempt.available_at_utc,
      dead_letter_ref: cursor.dead_letter_ref,
    }, events),
    dead_letters: deadLetters,
  };
}

export function reconcileLiveCursorTick(cursorValue, tick, { livenessStaleMinutes = LIVENESS_STALE_MINUTES } = {}) {
  const cursor = cloneCursor(cursorValue);
  assertCursor(cursor);
  const now = normalizeTick(tick);
  if (cursor.cursor_status === "CLOSED") {
    if (cursor.closed_at_utc && !cursor.expires_at_utc) {
      cursor.expires_at_utc = liveCursorExpiryUtc(cursor.closed_at_utc);
      cursor.updated_at_utc = now.utc;
    }
    return transition(cursor, null, []);
  }
  if (now.paris.slice(0, 10) !== cursor.trading_date) return transition(cursor, null, []);
  const target = resolveTargetCheckpoint(cursor, now);
  cursor.target_checkpoint = target;
  const closeAfterCadenceMs = Date.parse(cursor.window.close_paris) + CADENCE_SECONDS * 1000;
  if (now.epochMs >= closeAfterCadenceMs && cursor.cursor_status !== "CLOSED") {
    cursor.cursor_status = "CLOSED";
    cursor.closed_at_utc = now.utc;
    cursor.expires_at_utc = liveCursorExpiryUtc(cursor.closed_at_utc);
    cursor.updated_at_utc = now.utc;
    return transition(cursor, null, [liveCursorEvent(cursor, "CURSOR_CLOSED", now)]);
  }
  if (activeLease(cursor.attempt, now) || !targetAfterLastCompleted(cursor.last_completed_checkpoint, target)) {
    return transition(cursor, null, []);
  }
  const updatedAtMs = Date.parse(cursor.updated_at_utc || cursor.created_at_utc || "");
  const staleMs = Number(livenessStaleMinutes) * 60 * 1000;
  if (Number.isFinite(updatedAtMs) && now.epochMs - updatedAtMs > staleMs) {
    return transition(cursor, null, [liveCursorEvent(cursor, "CURSOR_LIVENESS_ALERT", now, {
      liveness_stale_minutes: Number(livenessStaleMinutes),
      target_checkpoint: target,
      last_completed_checkpoint: cursor.last_completed_checkpoint,
    })]);
  }
  return transition(cursor, null, []);
}

export function liveRetryBackoffSeconds(attemptCount, jitterSeconds) {
  const attempt = Math.max(1, Number(attemptCount) || 1);
  const jitter = Number(jitterSeconds);
  if (!Number.isInteger(jitter) || jitter < 0 || jitter > RETRY_JITTER_MAX_SECONDS) {
    throw liveCursorError("LIVE_RETRY_JITTER_INVALID", "Live retry jitter must be an integer between 0 and 15 seconds.");
  }
  return Math.min(RETRY_BACKOFF_MAX_SECONDS, RETRY_BACKOFF_BASE_SECONDS * (2 ** (attempt - 1))) + jitter;
}

export function liveCursorEvent(cursor, eventType, tick, details = {}) {
  if (!LIVE_CURSOR_EVENT_TYPES.includes(eventType)) throw new Error(`LIVE_CURSOR_EVENT_TYPE_INVALID:${eventType}`);
  const now = normalizeTick(tick);
  return {
    event_id: `${cursor.cursor_id}__${eventType.toLowerCase()}__${now.epochMs}`,
    scope: "live",
    cursor_id: cursor.cursor_id,
    work_item_id: null,
    run_id: cursor.run_id,
    workflow: cursor.attempt?.workflow || null,
    checkpoint: cursor.attempt?.checkpoint || cursor.target_checkpoint || null,
    event_type: eventType,
    cursor_status: cursor.cursor_status,
    at_utc: now.utc,
    details: { ...details },
  };
}

function normalizePreparedWork(work, expectedWorkflow, target, expectedPhase) {
  if (!work || typeof work !== "object") throw liveCursorError("LIVE_BUNDLE_REQUIRED", "A prepared live bundle is required for claim.");
  if (work.workflow !== expectedWorkflow) {
    throw liveCursorError("LIVE_WORKFLOW_MISMATCH", `Expected ${expectedWorkflow}, received ${work.workflow || "missing"}.`);
  }
  if (work.checkpoint && Date.parse(work.checkpoint) !== Date.parse(target)) {
    throw liveCursorError("LIVE_STALE_BUNDLE", "Prepared live bundle does not match the current target checkpoint.");
  }
  const expectedBundleTool = expectedWorkflow === "LIVE_MASTER" ? "get_master_cutoff_bundle" : "get_manual_monitor_bundle";
  if (work.bundle?.bundle_tool !== expectedBundleTool) {
    throw liveCursorError("LIVE_BUNDLE_TOOL_MISMATCH", `Expected ${expectedBundleTool}.`);
  }
  if (!work.bundle?.bundle_id || !work.bundle?.bundle_args) {
    throw liveCursorError("LIVE_BUNDLE_INVALID", "Prepared live bundle is incomplete.");
  }
  const scopedPhases = [
    work.phase,
    work.bundle?.bundle_args?.session,
    work.save_target?.session,
  ].filter(Boolean);
  if (scopedPhases.some((phase) => phase !== expectedPhase)) {
    throw liveCursorError(
      "LIVE_WORK_PHASE_MISMATCH",
      `Expected live phase ${expectedPhase}, received ${[...new Set(scopedPhases)].join(", ")}.`,
    );
  }
  if (!["ready", "stale", "degraded"].includes(work.data_quality)) {
    throw liveCursorError("LIVE_DATA_QUALITY_INVALID", "Live bundle data quality is invalid.");
  }
  assertActiveStrategyContractContext(work.contract_context, {
    workflow: expectedWorkflow,
    operation: "claim_live_cursor",
  });
  assertActiveStrategySaveTarget(work.save_target, {
    workflow: expectedWorkflow,
    mode: "live",
    operation: "claim_live_cursor",
  });
  return {
    ...work,
    execution_prompt: requiredText(work.execution_prompt, "LIVE_EXECUTION_PROMPT_REQUIRED"),
    prompt_hash: requiredText(work.prompt_hash, "LIVE_PROMPT_HASH_REQUIRED"),
    save_target: work.save_target || {},
  };
}

function noWork(cursor, reason, nextEligibleAtUtc) {
  const retryable = ["in_progress", "master_not_due", "outside_window"].includes(reason);
  return {
    ok: true,
    status: "NO_WORK",
    scope: "live",
    reason,
    cursor_status: cursor.cursor_status,
    target_checkpoint: cursor.target_checkpoint,
    last_completed_checkpoint: cursor.last_completed_checkpoint,
    next_eligible_at_utc: nextEligibleAtUtc || null,
    retryable,
    retry_after_seconds: retryable ? 60 : null,
  };
}

function transition(cursor, result, events) {
  return { cursor, result, events };
}

function assertLiveLease(cursor, args, tick, { allowExpired }) {
  assertCursor(cursor);
  const attempt = cursor.attempt;
  if (!attempt || attempt.status !== "LEASED") throw liveCursorError("LIVE_WORK_NOT_LEASED", "Live cursor is not leased.");
  if (attempt.worker_id !== args?.worker_id) throw liveCursorError("LIVE_WORKER_MISMATCH", "Live cursor belongs to another worker.");
  if (attempt.checkpoint !== args?.checkpoint) throw liveCursorError("LIVE_CHECKPOINT_MISMATCH", "Live cursor checkpoint does not match.");
  if (!args?.lease_token || attempt.lease_token !== args.lease_token) throw liveCursorError("LIVE_LEASE_TOKEN_MISMATCH", "Live cursor lease token is invalid.");
  const expiryMs = Date.parse(attempt.lease_expires_at_utc || "");
  if (!allowExpired && (!Number.isFinite(expiryMs) || expiryMs <= tick.epochMs)) {
    throw liveCursorError("LIVE_LEASE_EXPIRED", "Live cursor lease has expired.");
  }
}

function activeLease(attempt, tick) {
  if (!attempt || attempt.status !== "LEASED" || !attempt.lease_token) return false;
  const expiryMs = Date.parse(attempt.lease_expires_at_utc || "");
  return Number.isFinite(expiryMs) && expiryMs > tick.epochMs;
}

function checkpointAtOrAfter(left, right) {
  const leftMs = Date.parse(left || "");
  const rightMs = Date.parse(right || "");
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs >= rightMs;
}

function checkpointBefore(left, right) {
  if (!left) return false;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right || "");
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs < rightMs;
}

function sameCheckpointList(left, right) {
  const normalizedLeft = Array.isArray(left) ? left : [];
  const normalizedRight = Array.isArray(right) ? right : [];
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function targetAfterLastCompleted(lastCompleted, target) {
  if (!lastCompleted) return Boolean(target);
  return checkpointBefore(lastCompleted, target);
}

function validReplanCheckpoint(cursor) {
  const checkpoint = cursor.replan_checkpoint;
  if (!checkpoint || !Number.isFinite(Date.parse(checkpoint))) return null;
  return checkpoint.slice(0, 10) === cursor.trading_date ? checkpoint : null;
}

function validEventMonitorCheckpoint(cursor, tick) {
  const checkpoint = cursor.event_monitor_checkpoint;
  const checkpointMs = Date.parse(checkpoint || "");
  if (!Number.isFinite(checkpointMs)
    || checkpointMs > tick.epochMs
    || String(checkpoint).slice(0, 10) !== cursor.trading_date
    || checkpointAtOrAfter(cursor.last_completed_checkpoint, checkpoint)) {
    return null;
  }
  return checkpoint;
}

function eventMonitorContextFor(cursor, checkpoint) {
  if (!checkpoint || cursor.event_monitor_checkpoint !== checkpoint) return null;
  return {
    trigger: "CRITICAL_ENGINE_EVENT",
    checkpoint,
    reason: cursor.event_monitor_reason || "CRITICAL_ENGINE_EVENT",
    event_types: Array.isArray(cursor.event_monitor_event_types)
      ? [...cursor.event_monitor_event_types]
      : [],
  };
}

function validMonitorReplanCheckpoint(value, completedCheckpoint, tradingDate) {
  const completedMs = Date.parse(completedCheckpoint || "");
  const requestedMs = Date.parse(value || "");
  if (!Number.isFinite(requestedMs)
    || !Number.isFinite(completedMs)
    || requestedMs < completedMs
    || String(value).slice(0, 10) !== tradingDate) {
    return completedCheckpoint;
  }
  return value;
}

function normalizeLiveReplanAction(value) {
  const action = String(value || "").trim().toUpperCase();
  return LIVE_REPLAN_ACTION_SET.has(action) ? action : null;
}

function nextCheckpointUtc(checkpoint) {
  const checkpointMs = Date.parse(checkpoint || "");
  return Number.isFinite(checkpointMs) ? toUtcIso(checkpointMs + CADENCE_SECONDS * 1000) : null;
}

function laterCheckpoint(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function liveCursorExpiryUtc(closedAtUtc) {
  return toUtcIso(Date.parse(closedAtUtc) + LIVE_CURSOR_TTL_DAYS * 24 * 60 * 60 * 1000);
}

function normalizeDataQuality(value) {
  const normalized = String(value || "ready").toLowerCase();
  if (["ready", "stale", "degraded"].includes(normalized)) return normalized;
  if (["failed", "error", "missing"].includes(normalized)) return "degraded";
  return "ready";
}

function boundedLeaseSeconds(value) {
  const seconds = value == null ? DEFAULT_LIVE_LEASE_SECONDS : Number(value);
  if (!Number.isInteger(seconds) || seconds < 120 || seconds > 840) {
    throw liveCursorError("LIVE_LEASE_SECONDS_INVALID", "Live lease must be between 120 and 840 seconds.");
  }
  return seconds;
}

function assertCursor(cursor) {
  if (!cursor || cursor.schema_version !== LIVE_CURSOR_SCHEMA_VERSION) throw new Error("LIVE_CURSOR_SCHEMA_INVALID");
  if (cursor.run_scope !== DAILY_RUN_SCOPE) throw new Error("LIVE_CURSOR_SCOPE_INVALID");
  assertTradingDate(cursor.trading_date);
  if (!LIVE_CURSOR_STATUSES.includes(cursor.cursor_status)) throw new Error("LIVE_CURSOR_STATUS_INVALID");
  if (cursor.attempt?.workflow && !LIVE_CURSOR_WORKFLOWS.includes(cursor.attempt.workflow)) throw new Error("LIVE_CURSOR_WORKFLOW_INVALID");
}

function assertTradingDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) throw new Error(`LIVE_CURSOR_TRADING_DATE_INVALID:${value || "missing"}`);
}

function normalizeTick(tick) {
  const epochMs = Number.isFinite(tick?.epochMs) ? tick.epochMs : Date.parse(tick?.utc || tick?.paris || "");
  if (!Number.isFinite(epochMs)) throw new Error("LIVE_CURSOR_TICK_INVALID");
  return {
    epochMs,
    utc: tick?.utc || toUtcIso(epochMs),
    paris: tick?.paris || toParisIso(epochMs),
  };
}

function cloneCursor(cursor) {
  return structuredClone(cursor);
}

function requiredText(value, code) {
  const text = String(value || "").trim();
  if (!text) throw liveCursorError(code, code);
  return text;
}

function liveCursorError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
