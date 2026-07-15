import { toParisIso, toUtcIso } from "@tv-automation/desk-time";
import { buildWorkDeadLetter } from "./dead-letter.js";
import { floorParisCheckpoint, parisWallTimeIso } from "./live-scope.js";

export const LIVE_CURSOR_SCHEMA_VERSION = "2.0.0";
export const CADENCE_MINUTES = 15;
export const CADENCE_SECONDS = 900;
export const LEASE_MARGIN_SECONDS = 120;
export const LEASE_HARD_CAP_SECONDS = CADENCE_SECONDS - LEASE_MARGIN_SECONDS;
export const DEFAULT_LIVE_LEASE_SECONDS = 660;
export const MAX_LIVE_ATTEMPTS = 6;
export const RETRY_BACKOFF_BASE_SECONDS = 30;
export const RETRY_BACKOFF_MAX_SECONDS = 300;
export const RETRY_JITTER_MAX_SECONDS = 15;
export const LIVENESS_STALE_MINUTES = 20;
export const LIVE_CURSOR_TTL_DAYS = 90;

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
  "CURSOR_CLOSED",
]);

const LIVE_WINDOWS = Object.freeze({
  asia_open: { master_cutoff: "00:15:00", open: "00:30:00", close: "14:45:00", strategy_id: "asia_open" },
  ny_open: { master_cutoff: "15:30:00", open: "15:45:00", close: "21:45:00", strategy_id: "ny_open_1530" },
});

export function liveRunCursorId(tradingDate, session) {
  assertTradingDate(tradingDate);
  assertSession(session);
  return `livecur__${tradingDate}__${session}`;
}

export function initLiveRunCursor({ trading_date, session }, tick) {
  const windowConfig = LIVE_WINDOWS[assertSession(session)];
  assertTradingDate(trading_date);
  const now = normalizeTick(tick);
  const cursorId = liveRunCursorId(trading_date, session);
  return {
    cursor_id: cursorId,
    schema_version: LIVE_CURSOR_SCHEMA_VERSION,
    run_id: `front_live_${trading_date}_${session}`,
    trading_date,
    session,
    strategy_id: windowConfig.strategy_id,
    cadence_minutes: CADENCE_MINUTES,
    window: {
      master_cutoff_paris: parisWallTimeIso(trading_date, windowConfig.master_cutoff),
      open_paris: parisWallTimeIso(trading_date, windowConfig.open),
      close_paris: parisWallTimeIso(trading_date, windowConfig.close),
    },
    master_state: "MISSING",
    master_id: null,
    thesis_state: "MISSING",
    thesis_id: null,
    target_checkpoint: null,
    last_completed_checkpoint: null,
    cursor_status: "IDLE",
    attempt: null,
    data_quality: null,
    gap_ledger: [],
    recovery_count: 0,
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
  const now = normalizeTick(tick);
  const workflow = prepared?.workflow;
  if (!LIVE_CURSOR_WORKFLOWS.includes(workflow)) throw new Error("LIVE_CURSOR_SHADOW_WORKFLOW_INVALID");
  const checkpoint = requiredText(prepared?.checkpoint, "LIVE_CURSOR_SHADOW_CHECKPOINT_REQUIRED");
  if (!Number.isFinite(Date.parse(checkpoint))) throw new Error("LIVE_CURSOR_SHADOW_CHECKPOINT_INVALID");
  const bundleId = requiredText(prepared?.bundle_id, "LIVE_CURSOR_SHADOW_BUNDLE_REQUIRED");
  const dataQuality = normalizeDataQuality(prepared?.data_quality);
  const workStatus = String(prepared?.work_status || "READY").toUpperCase();
  const completed = workStatus === "COMPLETED" || workStatus === "DONE";

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
  }

  if (!activeLease(cursor.attempt, now)) {
    cursor.attempt = {
      workflow,
      checkpoint,
      bundle_id: bundleId,
      status: completed ? "DONE" : "PENDING",
      worker_id: null,
      lease_token: null,
      started_at_utc: null,
      lease_expires_at_utc: null,
      attempt_count: Number(cursor.attempt?.checkpoint === checkpoint ? cursor.attempt?.attempt_count || 0 : 0),
      available_at_utc: now.utc,
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
  const now = normalizeTick(tick);
  const target = resolveTargetCheckpoint(cursor, now);
  cursor.target_checkpoint = target;

  if (now.paris.slice(0, 10) !== cursor.trading_date) {
    return transition(cursor, noWork(cursor, "trading_date_mismatch", null), []);
  }
  const masterCutoffMs = Date.parse(cursor.window.master_cutoff_paris);
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

  const expectedWorkflow = cursor.master_state === "MISSING" || cursor.thesis_state === "MISSING"
    ? "LIVE_MASTER"
    : "LIVE_M15_MONITOR";
  if (expectedWorkflow === "LIVE_MASTER" && now.epochMs < masterCutoffMs) {
    cursor.cursor_status = "BLOCKED";
    cursor.updated_at_utc = now.utc;
    return transition(cursor, noWork(cursor, "master_not_due", toUtcIso(masterCutoffMs)), [
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
    ? cursor.window.master_cutoff_paris
    : target;

  const previousAttempt = cursor.attempt;
  const previousCheckpoint = previousAttempt?.checkpoint || null;
  const targetAdvanced = expectedWorkflow === "LIVE_M15_MONITOR"
    && previousAttempt?.workflow === "LIVE_M15_MONITOR"
    && previousAttempt?.status !== "DONE"
    && checkpointBefore(previousCheckpoint, claimCheckpoint);
  const events = [];
  const rolledForwardFrom = [];
  if (targetAdvanced) {
    cursor.gap_ledger.push({
      from_checkpoint: previousCheckpoint,
      to_checkpoint: claimCheckpoint,
      reason: "stale_checkpoint_rolled_forward",
      at_utc: now.utc,
    });
    cursor.recovery_count = Number(cursor.recovery_count || 0) + 1;
    rolledForwardFrom.push(previousCheckpoint);
    events.push(liveCursorEvent(cursor, "CURSOR_ROLLED_FORWARD", now, {
      from_checkpoint: previousCheckpoint,
      to_checkpoint: claimCheckpoint,
    }));
  }

  if (!targetAdvanced && previousAttempt?.checkpoint === claimCheckpoint) {
    if (cursor.cursor_status === "DEGRADED") {
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
      checkpoint: claimCheckpoint,
      target_checkpoint: target,
    }, events);
  }
  const work = normalizePreparedWork(args.work, expectedWorkflow, claimCheckpoint);
  const requestedLeaseSeconds = boundedLeaseSeconds(args?.lease_seconds);
  const leaseSeconds = Math.min(requestedLeaseSeconds, LEASE_HARD_CAP_SECONDS);
  const leaseToken = requiredText(args?.lease_token, "LIVE_LEASE_TOKEN_REQUIRED");
  const workerId = requiredText(args?.worker_id, "LIVE_WORKER_ID_REQUIRED");
  const sameCheckpoint = previousCheckpoint === claimCheckpoint;
  const attemptCount = sameCheckpoint ? Number(previousAttempt?.attempt_count || 0) + 1 : 1;
  const leaseExpiresAtUtc = toUtcIso(now.epochMs + leaseSeconds * 1000);
  cursor.attempt = {
    workflow: expectedWorkflow,
    checkpoint: claimCheckpoint,
    bundle_id: work.bundle.bundle_id,
    status: "LEASED",
    worker_id: workerId,
    lease_token: leaseToken,
    started_at_utc: now.utc,
    lease_expires_at_utc: leaseExpiresAtUtc,
    attempt_count: attemptCount,
    available_at_utc: now.utc,
    last_error: null,
  };
  cursor.cursor_status = "LEASED";
  cursor.data_quality = work.data_quality;
  cursor.updated_at_utc = now.utc;
  cursor.closed_at_utc = null;
  cursor.expires_at_utc = null;
  const claimedEvent = liveCursorEvent(cursor, "CURSOR_CLAIMED", now, {
    worker_id: workerId,
    workflow: expectedWorkflow,
    lease_expires_at_utc: leaseExpiresAtUtc,
    rolled_forward_from: rolledForwardFrom,
  });
  events.push(claimedEvent);
  return transition(cursor, {
    ok: true,
    status: "WORK_CLAIMED",
    scope: "live",
    claim_handle: {
      cursor_id: cursor.cursor_id,
      run_id: cursor.run_id,
      session: cursor.session,
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
    bundle: work.bundle,
    execution_prompt: work.execution_prompt,
    prompt_hash: work.prompt_hash,
    save_target: work.save_target,
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
} = {}) {
  const cursor = cloneCursor(cursorValue);
  const now = normalizeTick(tick);
  const alreadyCompletedAttempt = cursor.attempt?.status === "DONE" && cursor.attempt?.checkpoint === args?.checkpoint;
  if (alreadyCompletedAttempt || checkpointAtOrAfter(cursor.last_completed_checkpoint, args?.checkpoint)) {
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
    cursor.master_id = requiredText(materializedMasterId, "LIVE_MASTER_ID_REQUIRED");
    cursor.master_state = "READY";
    cursor.thesis_id = requiredText(materializedThesisId, "LIVE_THESIS_ID_REQUIRED");
    cursor.thesis_state = "ACTIVE";
  } else {
    cursor.last_completed_checkpoint = args.checkpoint;
  }
  cursor.attempt.status = "DONE";
  cursor.attempt.lease_token = null;
  cursor.attempt.lease_expires_at_utc = null;
  cursor.cursor_status = "IDLE";
  cursor.updated_at_utc = now.utc;
  const event = liveCursorEvent(cursor, "CURSOR_COMPLETED", now, { worker_id: args.worker_id });
  return transition(cursor, {
    ok: true,
    status: "DONE",
    scope: "live",
    idempotent: false,
    last_completed_checkpoint: cursor.last_completed_checkpoint,
  }, [event]);
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

function normalizePreparedWork(work, expectedWorkflow, target) {
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
  if (!["ready", "stale", "degraded"].includes(work.data_quality)) {
    throw liveCursorError("LIVE_DATA_QUALITY_INVALID", "Live bundle data quality is invalid.");
  }
  return {
    ...work,
    execution_prompt: requiredText(work.execution_prompt, "LIVE_EXECUTION_PROMPT_REQUIRED"),
    prompt_hash: requiredText(work.prompt_hash, "LIVE_PROMPT_HASH_REQUIRED"),
    save_target: work.save_target || {},
  };
}

function noWork(cursor, reason, nextEligibleAtUtc) {
  return {
    ok: true,
    status: "NO_WORK",
    scope: "live",
    reason,
    cursor_status: cursor.cursor_status,
    target_checkpoint: cursor.target_checkpoint,
    last_completed_checkpoint: cursor.last_completed_checkpoint,
    next_eligible_at_utc: nextEligibleAtUtc || null,
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

function targetAfterLastCompleted(lastCompleted, target) {
  if (!lastCompleted) return Boolean(target);
  return checkpointBefore(lastCompleted, target);
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
  assertSession(cursor.session);
  assertTradingDate(cursor.trading_date);
  if (!LIVE_CURSOR_STATUSES.includes(cursor.cursor_status)) throw new Error("LIVE_CURSOR_STATUS_INVALID");
  if (cursor.attempt?.workflow && !LIVE_CURSOR_WORKFLOWS.includes(cursor.attempt.workflow)) throw new Error("LIVE_CURSOR_WORKFLOW_INVALID");
}

function assertSession(session) {
  if (!LIVE_WINDOWS[session]) throw new Error(`LIVE_CURSOR_SESSION_INVALID:${session || "missing"}`);
  return session;
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
