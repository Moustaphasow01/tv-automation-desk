import { createHash, randomInt, randomUUID } from "node:crypto";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { buildLiveCursorWork } from "./live-cursor-work.js";
import {
  prepareDueLiveMasterBundle,
  prepareDueLiveMonitorBundle,
} from "./live-orchestration.js";
import {
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
    const resolvedCursorId = cursor_id || liveRunCursorId(trading_date, session);
    const cursor = await this.persistence.getDocument(LIVE_CURSOR_COLLECTION, resolvedCursorId).catch(() => null);
    return { ok: true, cursor };
  }

  async claimNext(args = {}) {
    const tick = this.clock.now();
    const cursorId = liveRunCursorId(args.trading_date, args.session);
    const initialCursor = initLiveRunCursor(args, tick);
    const observed = await this.persistence.getDocument(LIVE_CURSOR_COLLECTION, cursorId).catch(() => initialCursor);
    const preview = claimLiveCursor(observed, args, tick);
    const work = preview.result?.status === "WORK_DUE"
      ? await prepareLiveCursorClaimWork(this.host, preview.result, args, tick)
      : null;
    const claimTick = this.clock.now();
    const outcome = await this.persistence.claimLiveCursor({
      cursorCollection: LIVE_CURSOR_COLLECTION,
      eventCollection: COLLECTIONS.deskAgentWorkEvents,
      deadLetterCollection: LIVE_DEAD_LETTER_COLLECTION,
      cursorId,
      initialCursor,
      transition: (current) => claimLiveCursor(current, work ? { ...args, lease_token: randomUUID(), work } : args, claimTick),
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
      const outcome = await this.transitionCursor(cursor.cursor_id, cursor, (current) => reconcileLiveCursorTick(current, tick));
      results.push({ cursor_id: cursor.cursor_id, event_count: outcome.events.length, cursor_status: outcome.cursor.cursor_status });
    }
    return { ok: true, reconciled: results.length, cursors: results };
  }

  async upsertBundle(bundle, prepared, tick) {
    const tradingDate = bundle.trading_date || bundle.date;
    const cursorId = liveRunCursorId(tradingDate, bundle.session);
    const initial = initLiveRunCursor({ trading_date: tradingDate, session: bundle.session }, tick);
    return this.transitionCursor(cursorId, initial, (current) => ({
      cursor: shadowLiveCursorBundle(current, liveCursorInput(bundle, prepared), tick),
      result: null,
      events: [],
      dead_letters: [],
    }));
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

async function prepareLiveCursorClaimWork(store, plan, args, tick) {
  const result = plan.workflow === "LIVE_MASTER"
    ? await prepareDueLiveMasterBundle(store, {
        workflow: args.session === "ny_open" ? "ny_open" : "asia_open",
        trading_date: args.trading_date,
        cutoff_paris: plan.checkpoint,
        as_of_utc: new Date(plan.checkpoint).toISOString(),
        run_id: `front_live_${args.trading_date}_${args.session}`,
        mode: "live",
        include_raw_refs: true,
        save: true,
        enqueue_agent_work: false,
      }, { now: tick.epochMs })
    : await prepareDueLiveMonitorBundle(store, {
        session: args.session,
        trading_date: args.trading_date,
        timestamp_paris: plan.checkpoint,
        as_of_utc: new Date(plan.checkpoint).toISOString(),
        run_id: `front_live_${args.trading_date}_${args.session}`,
        mode: "live",
        catchup_mode: true,
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
    });
  }
  const item = buildLiveCursorWork({ bundle: result.bundle, plan });
  return {
    workflow: plan.workflow,
    checkpoint: plan.checkpoint,
    master_id: result.master_id || item.save_target?.linked_master_analysis_id || null,
    thesis_id: result.thesis_id || item.save_target?.linked_active_thesis_id || null,
    data_quality: liveCursorDataQuality(result.bundle, result.status),
    bundle: {
      bundle_id: item.bundle_id,
      bundle_tool: item.bundle_tool,
      bundle_args: item.bundle_args,
    },
    execution_prompt: item.execution_prompt,
    prompt_hash: item.prompt_hash,
    save_target: item.save_target,
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
    const selector = {
      strategy_id: cursor.strategy_id,
      session: cursor.session,
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
  return { outputMaterialized: Boolean(monitor?.monitor_id) };
}
