import { createHash } from "node:crypto";
import { canonicalSha256 } from "@tv-automation/desk-domain";

export const REPLAY_TERMINAL_STATUSES = Object.freeze([
  "COMPLETED",
  "DAY_END",
  "CANCELLED",
  "FAILED",
  "INVALIDATED",
  "QUARANTINED",
]);

export const REPLAY_TRANSITIONS = Object.freeze({
  CREATED: Object.freeze(["MASTER_DATA_PREPARING", "CANCELLED", "FAILED"]),
  MASTER_DATA_PREPARING: Object.freeze(["WAITING_GPT_MASTER", "FAILED", "QUARANTINED"]),
  WAITING_GPT_MASTER: Object.freeze(["MASTER_SAVED", "READY_FOR_NEXT_MONITOR", "FAILED", "CANCELLED"]),
  MASTER_SAVED: Object.freeze(["READY_FOR_NEXT_MONITOR", "FAILED"]),
  MASTER_MATERIALIZED: Object.freeze(["READY_FOR_NEXT_MONITOR", "FAILED"]),
  READY_FOR_NEXT_MONITOR: Object.freeze(["MONITOR_DATA_PREPARING", "COMPLETED", "DAY_END", "CANCELLED", "FAILED"]),
  MONITOR_DATA_PREPARING: Object.freeze(["WAITING_GPT_MONITOR", "FAILED", "QUARANTINED"]),
  WAITING_GPT_MONITOR: Object.freeze(["MONITOR_SAVED", "FAILED", "CANCELLED"]),
  MONITOR_SAVED: Object.freeze(["MONITOR_APPLIED", "WAITING_NEXT_STEP", "REPLAN_REQUIRED", "FAILED"]),
  MONITOR_APPLIED: Object.freeze(["WAITING_NEXT_STEP", "REPLAN_REQUIRED", "FAILED"]),
  SIMULATION_UPDATED: Object.freeze(["WAITING_NEXT_STEP", "MONITOR_DATA_PREPARING", "COMPLETED", "DAY_END", "FAILED"]),
  WAITING_NEXT_STEP: Object.freeze(["MONITOR_DATA_PREPARING", "COMPLETED", "DAY_END", "FAILED", "CANCELLED"]),
  REPLAN_REQUIRED: Object.freeze(["WAITING_GPT_MASTER", "MASTER_SAVED", "READY_FOR_NEXT_MONITOR", "FAILED", "CANCELLED"]),
});

export class DeskReplayError extends Error {
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = "DeskReplayError";
    this.code = code;
    this.details = details;
  }
}

export function assertReplayTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) return true;
  if (REPLAY_TERMINAL_STATUSES.includes(fromStatus)) {
    throw new DeskReplayError("RUN_SCOPE_MISMATCH", `Run is terminal and cannot transition from ${fromStatus}.`, {
      from_status: fromStatus,
      to_status: toStatus,
    });
  }
  const allowed = REPLAY_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    throw new DeskReplayError("INVALID_SCOPE", `Replay transition ${fromStatus} -> ${toStatus} is not allowed.`, {
      from_status: fromStatus,
      to_status: toStatus,
      allowed,
    });
  }
  return true;
}

export function prepareReplayMutation(run, args = {}, { operation, nextStatus, allowedStatuses = null } = {}) {
  if (!run?.backtest_id) {
    throw new DeskReplayError("RUN_NOT_FOUND", "Replay run is missing.");
  }
  const expectedRevision = requiredRevision(args.expected_revision);
  const idempotencyKey = requiredString(args.idempotency_key, "idempotency_key");
  const actualRevision = Number(run.revision || 0);
  if (expectedRevision !== actualRevision) {
    throw new DeskReplayError("REVISION_CONFLICT", "Replay revision no longer matches the caller expectation.", {
      backtest_id: run.backtest_id,
      expected_revision: expectedRevision,
      actual_revision: actualRevision,
    });
  }
  if (allowedStatuses && !allowedStatuses.includes(run.status)) {
    throw new DeskReplayError("INVALID_SCOPE", `Operation ${operation} is not allowed while replay is ${run.status}.`, {
      operation,
      status: run.status,
      allowed_statuses: allowedStatuses,
    });
  }
  if (nextStatus) assertReplayTransition(run.status, nextStatus);
  if (args.force === true || args.force_rebuild === true) {
    throw new DeskReplayError("CLOCK_REGRESSION_FORBIDDEN", "force and force_rebuild are forbidden for normal replay mutations.", {
      operation,
    });
  }
  const requestHash = replayRequestHash(operation, args);
  return {
    operation,
    idempotency_key: idempotencyKey,
    request_hash: requestHash,
    expected_revision: expectedRevision,
    actual_revision: actualRevision,
    next_revision: actualRevision + 1,
    next_status: nextStatus || run.status,
  };
}

export function replayRequestHash(operation, args = {}) {
  const payload = Object.fromEntries(
    Object.entries(args)
      .filter(([key]) => !["expected_revision", "idempotency_key", "lease_owner", "lease_expires_at"].includes(key))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return canonicalSha256({ operation, payload });
}

export function resolveIdempotentReplayResult(existing, mutation) {
  if (!existing) return null;
  if (existing.request_hash !== mutation.request_hash) {
    throw new DeskReplayError("IDEMPOTENCY_CONFLICT", "The idempotency key was already used with a different payload.", {
      idempotency_key: mutation.idempotency_key,
      expected_request_hash: existing.request_hash || null,
      actual_request_hash: mutation.request_hash,
    });
  }
  return existing.result || null;
}

export function assertMonotonicReplayClock(currentTimestamp, nextTimestamp, limitTimestamp = null) {
  const currentMs = Date.parse(String(currentTimestamp || ""));
  const nextMs = Date.parse(String(nextTimestamp || ""));
  if (!Number.isFinite(currentMs) || !Number.isFinite(nextMs)) {
    throw new DeskReplayError("INVALID_SCOPE", "Replay clock timestamps must be valid ISO instants.", {
      current_timestamp: currentTimestamp,
      next_timestamp: nextTimestamp,
    });
  }
  if (nextMs <= currentMs) {
    throw new DeskReplayError("CLOCK_REGRESSION_FORBIDDEN", "Replay clock must advance strictly forward.", {
      current_timestamp: currentTimestamp,
      next_timestamp: nextTimestamp,
    });
  }
  if (limitTimestamp && nextMs > Date.parse(limitTimestamp)) {
    throw new DeskReplayError("CLOCK_LIMIT_EXCEEDED", "Replay clock exceeds the run limit.", {
      next_timestamp: nextTimestamp,
      limit_timestamp: limitTimestamp,
    });
  }
  return true;
}

export function replayIdempotencyDocumentId(backtestId, idempotencyKey) {
  return `${sanitize(backtestId)}__${createHash("sha256").update(String(idempotencyKey)).digest("hex").slice(0, 32)}`;
}

function requiredRevision(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new DeskReplayError("SCOPE_REQUIRED", "expected_revision must be a non-negative integer.", { field: "expected_revision" });
  }
  return value;
}

function requiredString(value, field) {
  const text = String(value || "").trim();
  if (!text) {
    throw new DeskReplayError("SCOPE_REQUIRED", `${field} is required.`, { field });
  }
  return text;
}

function sanitize(value) {
  return String(value || "").replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 180);
}
