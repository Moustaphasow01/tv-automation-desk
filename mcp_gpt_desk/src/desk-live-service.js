import { createHash, randomInt, randomUUID } from "node:crypto";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { buildLiveCursorWork, DESK_LIVE_PROMPT_VERSION } from "./live-cursor-work.js";
import {
  prepareDueLiveMasterBundle,
  prepareDueLiveMonitorBundle,
  resolveLiveMonitorReplanAction,
  resolveLiveMonitorReplanCheckpoint,
} from "./live-orchestration.js";
import {
  armLiveCursorEventMonitor,
  armLiveCursorReplan,
  claimLiveCursor,
  completeLiveCursor,
  failLiveCursor,
  heartbeatLiveCursor,
  initLiveRunCursor,
  liveRunCursorId,
  reconcileLiveCursorTick,
  shadowLiveCursorBundle,
} from "./live-cursor.js";
import { deskError } from "./desk-errors.js";
import { dailyRunId } from "./daily-run-model.js";

const COLLECTIONS = DESK_COLLECTIONS;
const LIVE_CURSOR_COLLECTION = "desk_live_run_cursor";
const LIVE_DEAD_LETTER_COLLECTION = "desk_agent_work_dead_letter";

export class DeskLiveService {
  constructor({ persistence, clock, host }) {
    this.persistence = persistence;
    this.clock = clock;
    this.host = host;
  }

  async getRunCursor({ cursor_id, trading_date, session } = {}) {
    const resolvedCursorId = cursor_id || liveRunCursorId(trading_date);
    const cursor = await this.persistence.getDocument(LIVE_CURSOR_COLLECTION, resolvedCursorId).catch(() => null);
    const lastClaim = await resolveLastLiveClaim(this.persistence, cursor, resolvedCursorId);
    return { ok: true, cursor, last_claim: lastClaim };
  }

  async ensureDailyCursors({ trading_date } = {}) {
    const tick = this.clock.now();
    const cursorId = liveRunCursorId(trading_date);
    const existing = await this.persistence.getDocument(LIVE_CURSOR_COLLECTION, cursorId).catch(() => null);
    const initial = initLiveRunCursor({ trading_date }, tick);
    const outcome = await this.transitionCursor(cursorId, initial, (current) => ({
      cursor: current,
      result: {
        ok: true,
        status: existing ? "EXISTING" : "CREATED",
        cursor_id: cursorId,
        run_scope: "full_day",
        trading_date,
      },
      events: [],
      dead_letters: [],
    }));
    const results = [{ ...outcome.result, cursor_status: outcome.cursor.cursor_status }];
    return {
      ok: true,
      status: "LIVE_DAY_READY",
      trading_date,
      created: results.filter((item) => item.status === "CREATED").length,
      cursors: results,
    };
  }

  async prewarmNext({ trading_date } = {}) {
    const tick = this.clock.now();
    const cursorId = liveRunCursorId(trading_date);
    const initialCursor = initLiveRunCursor({ trading_date }, tick);
    let observed = await this.persistence.getDocument(LIVE_CURSOR_COLLECTION, cursorId).catch(() => null)
      || initialCursor;
    observed = await this.armPersistedReplan(observed);
    const preview = claimLiveCursor(observed, {}, tick);
    if (preview.result?.status !== "WORK_DUE") {
      return {
        ok: true,
        status: "NO_PREWARM_DUE",
        cursor_id: cursorId,
        cursor_status: observed.cursor_status,
        reason: preview.result?.reason || null,
        target_checkpoint: preview.result?.target_checkpoint || null,
      };
    }

    try {
      const work = await prepareLiveCursorClaimWork(this.host, preview.result, {
        worker_id: "live-runtime-prewarm",
      }, tick);
      return {
        ok: true,
        status: "PREWARMED",
        cursor_id: cursorId,
        workflow: preview.result.workflow,
        phase: preview.result.phase,
        checkpoint: preview.result.checkpoint,
        target_checkpoint: preview.result.target_checkpoint,
        bundle_id: work.bundle?.bundle_id || null,
      };
    } catch (error) {
      const dataNotReady = liveDataNotReadyResponse(error, {
        cursorId,
        plan: preview.result,
        workerId: "live-runtime-prewarm",
      });
      if (dataNotReady) {
        return {
          ...dataNotReady,
          status: "PREWARM_DATA_NOT_READY",
        };
      }
      throw error;
    }
  }

  async armEventMonitor({
    trading_date,
    checkpoint,
    reason,
    event_types,
  } = {}) {
    const tick = this.clock.now();
    const cursorId = liveRunCursorId(trading_date);
    const initialCursor = initLiveRunCursor({ trading_date }, tick);
    const outcome = await this.transitionCursor(
      cursorId,
      initialCursor,
      (current) => armLiveCursorEventMonitor(current, {
        checkpoint,
        reason,
        event_types,
      }, tick),
    );
    return outcome.result;
  }

  async claimNext(args = {}) {
    const tick = this.clock.now();
    const claimArgs = {
      ...args,
      recovery_prompt_version: DESK_LIVE_PROMPT_VERSION,
    };
    const cursorId = liveRunCursorId(args.trading_date);
    const initialCursor = initLiveRunCursor({ trading_date: args.trading_date }, tick);
    let observed = await this.persistence.getDocument(LIVE_CURSOR_COLLECTION, cursorId).catch(() => null)
      || initialCursor;
    observed = await this.armPersistedReplan(observed);
    const preview = claimLiveCursor(observed, claimArgs, tick);
    let work = null;
    if (preview.result?.status === "WORK_DUE") {
      try {
        work = await prepareLiveCursorClaimWork(this.host, preview.result, args, tick);
      } catch (error) {
        const dataNotReady = liveDataNotReadyResponse(error, {
          cursorId,
          plan: preview.result,
          workerId: args.worker_id,
        });
        if (dataNotReady) return dataNotReady;
        throw error;
      }
    }
    const claimTick = this.clock.now();
    const outcome = await this.persistence.claimLiveCursor({
      cursorCollection: LIVE_CURSOR_COLLECTION,
      eventCollection: COLLECTIONS.deskAgentWorkEvents,
      deadLetterCollection: LIVE_DEAD_LETTER_COLLECTION,
      cursorId,
      initialCursor,
      transition: (current) => claimLiveCursor(
        current,
        work ? { ...claimArgs, lease_token: randomUUID(), work } : claimArgs,
        claimTick,
      ),
    });
    return finalizeLiveClaimResponse(outcome.result, args.worker_id);
  }

  async heartbeat(args = {}) {
    const tick = this.clock.now();
    const outcome = await this.transitionCursor(args.cursor_id, null, (current) => heartbeatLiveCursor(current, args, tick));
    return outcome.result;
  }

  async complete(args = {}) {
    const tick = this.clock.now();
    const observed = (await this.getRunCursor(args)).cursor;
    if (!observed) throw deskError("LIVE_CURSOR_NOT_FOUND", `Live cursor not found: ${args.cursor_id}.`);
    const materialization = await resolveLiveCursorMaterialization(this.host, observed);
    const outcome = await this.transitionCursor(args.cursor_id, null, (current) => completeLiveCursor(current, args, tick, materialization));
    return outcome.result;
  }

  async fail(args = {}) {
    const tick = this.clock.now();
    const jitterSeconds = randomInt(0, 16);
    const outcome = await this.transitionCursor(args.cursor_id, null, (current) => failLiveCursor(current, args, tick, { jitterSeconds }));
    return outcome.result;
  }

  async reconcile() {
    const tick = this.clock.now();
    const cursors = await this.persistence.listDocuments(LIVE_CURSOR_COLLECTION, 500).catch(() => []);
    const results = [];
    for (const cursor of cursors) {
      if (!["IDLE", "DUE", "RETRY", "BLOCKED", "DEGRADED"].includes(cursor.cursor_status)
        && !(cursor.cursor_status === "CLOSED" && cursor.closed_at_utc && !cursor.expires_at_utc)) continue;
      if (cursor.schema_version !== "3.0.0") continue;
      const outcome = await this.transitionCursor(cursor.cursor_id, cursor, (current) => reconcileLiveCursorTick(current, tick));
      results.push({ cursor_id: cursor.cursor_id, event_count: outcome.events.length, cursor_status: outcome.cursor.cursor_status });
    }
    return { ok: true, reconciled: results.length, cursors: results };
  }

  async upsertBundle(bundle, prepared, tick) {
    const tradingDate = bundle.trading_date || bundle.date;
    const cursorId = liveRunCursorId(tradingDate);
    const initial = initLiveRunCursor({ trading_date: tradingDate }, tick);
    return this.transitionCursor(cursorId, initial, (current) => ({
      cursor: shadowLiveCursorBundle(current, liveCursorInput(bundle, prepared), tick),
      result: null,
      events: [],
      dead_letters: [],
    }));
  }

  async armPersistedReplan(cursor) {
    const attempt = cursor?.attempt;
    if (attempt?.workflow !== "LIVE_M15_MONITOR"
      || attempt?.status !== "DONE"
      || !attempt?.bundle_id
      || cursor?.replan_checkpoint) {
      return cursor;
    }
    const monitor = await this.host.getLatestManualMonitor({
      bundle_id: attempt.bundle_id,
      limit: 1,
    }).then((value) => value.latest_monitor || value.monitors?.[0] || null)
      .catch(() => null);
    const action = resolveLiveMonitorReplanAction(monitor);
    if (!action) return cursor;
    const checkpoint = resolveLiveMonitorReplanCheckpoint(monitor, attempt.checkpoint);
    const tick = this.clock.now();
    const outcome = await this.transitionCursor(cursor.cursor_id, cursor, (current) => {
      if (current.attempt?.workflow !== "LIVE_M15_MONITOR"
        || current.attempt?.status !== "DONE"
        || current.attempt?.bundle_id !== attempt.bundle_id
        || current.attempt?.checkpoint !== attempt.checkpoint) {
        return {
          cursor: current,
          result: { ok: true, status: "REPLAN_STATE_CHANGED", scope: "live" },
          events: [],
          dead_letters: [],
        };
      }
      return armLiveCursorReplan(current, {
        checkpoint,
        action,
      }, tick);
    });
    return outcome.cursor;
  }

  async transitionCursor(cursorId, initialCursor, transition) {
    if (typeof this.persistence.transitionLiveCursor !== "function") {
      throw deskError("LIVE_CURSOR_TRANSACTION_UNAVAILABLE", "Persistent live cursor transactions are unavailable.");
    }
    return this.persistence.transitionLiveCursor({
      cursorCollection: LIVE_CURSOR_COLLECTION,
      eventCollection: COLLECTIONS.deskAgentWorkEvents,
      deadLetterCollection: LIVE_DEAD_LETTER_COLLECTION,
      cursorId,
      initialCursor,
      transition,
    });
  }
}

async function resolveLastLiveClaim(persistence, cursor, cursorId) {
  if (!cursor) return null;
  const persistedAt = cursor.last_claimed_at_utc || cursor.attempt?.started_at_utc || null;
  if (persistedAt) {
    return {
      at_utc: persistedAt,
      checkpoint: cursor.last_claimed_checkpoint || cursor.attempt?.checkpoint || null,
      workflow: cursor.last_claimed_workflow || cursor.attempt?.workflow || null,
      worker_id: cursor.last_claimed_worker_id || cursor.attempt?.worker_id || null,
    };
  }
  if (typeof persistence?.queryCollectionDocuments !== "function") return null;
  const events = await persistence.queryCollectionDocuments({
    collection: COLLECTIONS.deskAgentWorkEvents,
    filters: [
      { field: "cursor_id", operator: "==", value: cursorId },
      { field: "event_type", operator: "==", value: "CURSOR_CLAIMED" },
    ],
    orderBy: [{ field: "at_utc", direction: "desc" }],
    limit: 1,
  }).catch(() => []);
  const event = events[0];
  if (!event) return null;
  return {
    at_utc: event.at_utc || event.created_at_utc || null,
    checkpoint: event.checkpoint || null,
    workflow: event.workflow || event.details?.workflow || null,
    worker_id: event.details?.worker_id || event.worker_id || null,
  };
}

function liveDataNotReadyResponse(error, { cursorId, plan, workerId }) {
  const message = error?.message || String(error);
  const code = error?.code
    || (message.startsWith("LIVE_ROLLING_PACK_COVERAGE_INSUFFICIENT")
      ? "LIVE_ROLLING_PACK_COVERAGE_INSUFFICIENT"
      : null);
  if (![
    "LOCAL_PACK_CORE_DATASET_MISSING",
    "LOCAL_PACK_CORE_DATASET_STALE",
    "LIVE_ROLLING_PACK_COVERAGE_INSUFFICIENT",
  ].includes(code)) return null;
  return {
    ok: true,
    status: "DATA_NOT_READY",
    scope: "live",
    reason: "live_source_not_fresh",
    retryable: true,
    retry_after_seconds: 60,
    max_claim_attempts: 3,
    worker_id: workerId,
    cursor_id: cursorId,
    workflow: plan.workflow,
    checkpoint: plan.checkpoint,
    data_quality: {
      status: "missing_unexpected",
      execution_allowed: false,
      freshness_required: true,
      blocker_code: code,
      blocker_details: error?.details || {},
    },
    next_action: "wait_for_fresh_closed_candles",
    error: {
      code,
      message,
      details: error?.details || {},
    },
  };
}

async function prepareLiveCursorClaimWork(store, plan, args, tick) {
  const phase = plan.phase;
  const strategyId = plan.strategy_id;
  const runId = plan.run_id || dailyRunId(plan.trading_date);
  const result = plan.workflow === "LIVE_MASTER"
    ? await prepareDueLiveMasterBundle(store, {
        workflow: phase === "ny_open" ? "ny_open" : "asia_open",
        trading_date: plan.trading_date,
        cutoff_paris: plan.checkpoint,
        as_of_utc: new Date(plan.checkpoint).toISOString(),
        run_id: runId,
        mode: "live",
        include_raw_refs: true,
        save: true,
        enqueue_agent_work: false,
      }, { now: tick.epochMs })
    : await prepareDueLiveMonitorBundle(store, {
        session: phase,
        strategy_id: strategyId,
        trading_date: plan.trading_date,
        timestamp_paris: plan.checkpoint,
        as_of_utc: new Date(plan.checkpoint).toISOString(),
        run_id: runId,
        mode: "live",
        catchup_mode: Boolean(plan.catchup_context),
        catchup_context: plan.catchup_context || null,
        include_raw_refs: true,
        save: true,
        enqueue_agent_work: false,
      }, { now: tick.epochMs });
  if (result?.ok === false || !result?.bundle?.bundle_id) {
    throw deskError("LIVE_BUNDLE_NOT_READY", "The due live bundle could not be prepared for cursor claim.", {
      workflow: plan.workflow,
      checkpoint: plan.checkpoint,
      preparation_status: result?.status || null,
      skipped_reason: result?.skipped_reason || null,
      preparation_error: result?.error || null,
      continuity_recovery: result?.continuity_recovery || null,
    });
  }
  const item = buildLiveCursorWork({ bundle: result.bundle, plan });
  return {
    workflow: plan.workflow,
    phase,
    checkpoint: plan.checkpoint,
    master_id: result.master_id || item.save_target?.linked_master_analysis_id || null,
    thesis_id: result.thesis_id || item.save_target?.linked_active_thesis_id || null,
    data_quality: liveCursorDataQuality(result.bundle, result.status),
    catchup_context: item.catchup_context || plan.catchup_context || null,
    bundle: {
      bundle_id: item.bundle_id,
      bundle_tool: item.bundle_tool,
      bundle_args: item.bundle_args,
    },
    execution_prompt: item.execution_prompt,
    prompt_hash: item.prompt_hash,
    save_target: item.save_target,
    contract_context: item.contract_context,
    runtime_versions: item.runtime_versions,
  };
}

function finalizeLiveClaimResponse(result, workerId) {
  if (result?.status !== "WORK_CLAIMED") return result;
  const handle = result.claim_handle;
  const executionPrompt = [
    result.execution_prompt,
    "",
    "Attribution LIVE active:",
    `- cursor_id: ${handle.cursor_id}`,
    `- session: ${handle.session}`,
    `- phase: ${handle.phase || handle.session}`,
    `- workflow: ${handle.workflow}`,
    `- checkpoint: ${handle.checkpoint}`,
    `- worker_id: ${workerId}`,
    `- lease_token: ${handle.lease_token}`,
    `- lease_expires_at_utc: ${handle.lease_expires_at_utc}`,
    "- Utilise heartbeat_live si le bail risque d'expirer.",
    "- Après matérialisation des sorties, appelle complete_live avec ce handle.",
    "- En cas d'échec, appelle fail_live avec ce handle et une classe structurée.",
  ].join("\n");
  return {
    ...result,
    execution_prompt: executionPrompt,
    prompt_hash: createHash("sha256").update(executionPrompt).digest("hex"),
  };
}

function liveCursorInput(bundle, prepared) {
  const workflow = bundle.bundle_type === "master_cutoff" ? "LIVE_MASTER" : "LIVE_M15_MONITOR";
  const suggested = bundle.save_target?.suggested_payload || {};
  return {
    workflow,
    phase: bundle.phase || bundle.session,
    checkpoint: bundle.cutoff_paris || bundle.timestamp_paris,
    bundle_id: bundle.bundle_id,
    work_status: prepared?.status || "READY",
    data_quality: liveCursorDataQuality(bundle, prepared?.status),
    master_id: suggested.linked_master_analysis_id || null,
    thesis_id: suggested.linked_active_thesis_id || null,
  };
}

function liveCursorDataQuality(bundle, fallback) {
  const value = String(
    bundle?.data_quality?.status
      || bundle?.data_quality_audit?.status
      || bundle?.quality?.status
      || fallback
      || "ready",
  ).toLowerCase();
  if (value.includes("stale")) return "stale";
  if (value.includes("degrad") || value.includes("fail") || value.includes("missing")) return "degraded";
  return "ready";
}

async function resolveLiveCursorMaterialization(store, cursor) {
  if (cursor.attempt?.workflow === "LIVE_MASTER") {
    const phase = cursor.attempt.phase || cursor.current_phase || "asia_open";
    const selector = {
      strategy_id: phase === "ny_open" ? "ny_open_1530" : "asia_open",
      session: phase,
      mode: "live",
      trading_date: cursor.trading_date,
      run_id: cursor.run_id,
      as_of_utc: new Date(cursor.attempt.checkpoint).toISOString(),
    };
    const master = await store.getLatestMasterAnalysis(selector).then((value) => value.analysis).catch(() => null);
    const thesis = master?.analysis_id
      ? await store.getActiveThesis({ ...selector, master_id: master.analysis_id, status: "any" }).then((value) => value.active_thesis).catch(() => null)
      : null;
    return {
      outputMaterialized: Boolean(master?.analysis_id && thesis?.thesis_id),
      materializedMasterId: master?.analysis_id || null,
      materializedThesisId: thesis?.thesis_id || null,
    };
  }
  const monitor = await store.getLatestManualMonitor({ bundle_id: cursor.attempt?.bundle_id, limit: 1 })
    .then((value) => value.latest_monitor || value.monitors?.[0] || null)
    .catch(() => null);
  return {
    outputMaterialized: Boolean(monitor?.monitor_id),
    monitorAction: resolveLiveMonitorReplanAction(monitor),
    monitorReplanCheckpoint: resolveLiveMonitorReplanCheckpoint(monitor, cursor.attempt?.checkpoint),
  };
}
