import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import {
  claimReplayWorkItem,
  completeReplayWorkItem,
  failReplayWorkItem,
  heartbeatReplayWorkItem,
  pauseReplayWorkItem,
  replayWorkEvent,
  replayWorkMatchesRun,
  replayWorkOutputMaterialized,
  resumeReplayWorkItem,
  selectClaimableReplayWork,
  selectVisibleDeskWork,
  supersedeReplayWorkItem,
} from "./replay-agent-work.js";
import { deskError } from "./desk-errors.js";
import { normalizeUtcIso } from "./desk-time-utils.js";

const COLLECTIONS = DESK_COLLECTIONS;
const REPLAY_AUTOPILOT_CONFIGS_COLLECTION = "desk_replay_autopilot_configs";
const REPLAY_AUTOPILOT_RECOVERABLE_CODES = new Set([
  "SAVE_DOCUMENT_UNDEFINED",
  "RETRYABLE_FAILURE",
  "WORK_ALREADY_CLAIMED_SAVE_BLOCKED",
]);

export class DeskReplayService {
  constructor({ persistence, clock, host }) {
    this.persistence = persistence;
    this.clock = clock;
    this.host = host;
  }

  async claimNext(args = {}) {
    const tick = this.clock.now();
    const items = await this.persistence.queryCollectionDocuments({
      collection: COLLECTIONS.deskAgentWorkItems,
      filters: [{ field: "status", operator: "in", value: ["READY", "CLAIMED"] }],
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
      filters: [{ field: "status", operator: "in", value: statuses }],
      limit: 500,
    }).catch(() => []);
    const work_item = selectVisibleDeskWork(items, args)[0] || null;
    return { ok: true, status: workQueueStatus(work_item), work_item: work_item ? deskWorkSummary(work_item) : null };
  }

  async upsertAutopilotConfig(args = {}) {
    const tick = this.clock.now();
    const config = normalizeReplayAutopilotConfig(args, tick);
    const existing = await this.persistence.getDocument(REPLAY_AUTOPILOT_CONFIGS_COLLECTION, config.config_id).catch(() => null);
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

  async startOrResumeAutopilot(args = {}) {
    const tick = this.clock.now();
    const resolved = await this.resolveAutopilotConfig(args);
    if (!resolved.config) {
      return { ok: true, status: "CONFIG_MISSING", reason: resolved.reason, selector: resolved.selector };
    }
    const config = resolved.config;
    if (config.enabled === false || config.status === "PAUSED" || config.status === "ARCHIVED") {
      return { ok: true, status: "CONFIG_DISABLED", config: projectReplayAutopilotConfig(config) };
    }

    const createArgs = replayAutopilotCreateArgs(config, args);
    let creation = null;
    let run = await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, createArgs.backtest_id).catch(() => null);
    if (!run) {
      creation = await this.host.createOrchestratedReplayDay(createArgs);
      run = creation.replay_run || await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, createArgs.backtest_id).catch(() => null);
    } else if (run.automation_enabled !== true) {
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
    return projectReplayAutopilotStartResult({ config, creation, recovered, automation, state, worker_id: args.worker_id });
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
      return { ok: true, status: "COMPLETED", idempotent_replay: true, work_item: deskWorkSummary(item) };
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
    await this.persistence.setDocument(COLLECTIONS.deskAgentWorkItems, failed.work_item_id, failed);
    const eventType = failed.status === "READY" ? "RETRY_SCHEDULED" : "FAILED";
    await this.writeWorkEvent(replayWorkEvent(failed, eventType, tick, { worker_id: args.worker_id, error_code: args.error_code }));
    return { ok: true, status: failed.status, retry_scheduled: failed.status === "READY", work_item: deskWorkSummary(failed) };
  }

  async setAutomation(args = {}) {
    const tick = this.clock.now();
    const run = await this.persistence.getDocument(COLLECTIONS.deskReplayRuns, args.backtest_id);
    const enabled = args.enabled === true;
    const items = await this.persistence.queryCollectionDocuments({
      collection: COLLECTIONS.deskAgentWorkItems,
      filters: [{ field: "backtest_id", operator: "==", value: run.backtest_id }],
      limit: 200,
    }).catch(() => []);
    for (const item of items) {
      const updated = enabled ? resumeReplayWorkItem(item, tick) : pauseReplayWorkItem(item, tick, args.reason);
      if (updated !== item) await this.persistence.setDocument(COLLECTIONS.deskAgentWorkItems, updated.work_item_id, updated);
    }
    const updatedRun = patchReplayRun(run, { automation_enabled: enabled, automation_status: enabled ? "running" : "paused" }, tick);
    await this.persistence.setDocument(COLLECTIONS.deskReplayRuns, run.backtest_id, updatedRun, { merge: true });
    const automation = enabled ? await this.host.driveReplayAutomation({ backtest_id: run.backtest_id }) : null;
    return { ok: true, backtest_id: run.backtest_id, automation_enabled: enabled, automation };
  }

  async resolveAutopilotConfig(args = {}) {
    const selector = replayAutopilotConfigSelector(args);
    if (selector.config_id) {
      const config = await this.persistence.getDocument(REPLAY_AUTOPILOT_CONFIGS_COLLECTION, selector.config_id).catch(() => null);
      return { config, selector, reason: config ? null : "config_id_not_found" };
    }
    const configs = await this.persistence.listDocuments(REPLAY_AUTOPILOT_CONFIGS_COLLECTION, 100).catch(() => []);
    const config = selectReplayAutopilotConfig(configs, selector);
    return { config, selector, reason: config ? null : "matching_config_not_found" };
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
  };
}

function normalizeReplayAutopilotConfig(args = {}, tick) {
  const tradingDate = args.trading_date || args.date;
  const session = args.session;
  const strategyId = args.strategy_id || (session === "ny_open" ? "ny_open_1530" : "asia_open");
  const configId = args.config_id || replayAutopilotDefaultConfigId({ trading_date: tradingDate, session });
  const backtestId = args.backtest_id || replayAutopilotDefaultBacktestId({ trading_date: tradingDate, session, cadence: args.cadence });
  const start = normalizeReplayTimestamp(args.start_time || args.initial_cutoff || args.cutoff_paris, tradingDate);
  const cutoff = normalizeReplayTimestamp(args.cutoff_paris || args.initial_cutoff || args.start_time, tradingDate);
  const end = normalizeReplayTimestamp(args.end_time, tradingDate);
  return {
    ...args,
    config_schema_version: "1.0.0",
    config_id: configId,
    enabled: args.enabled !== false,
    status: args.status || "READY",
    backtest_id: backtestId,
    strategy_id: strategyId,
    trading_date: tradingDate,
    date: tradingDate,
    session,
    pack_id: args.pack_id,
    pack_build_id: args.pack_build_id,
    cutoff_paris: cutoff,
    cutoff_utc: args.cutoff_utc || normalizeUtcIso(cutoff),
    initial_cutoff: args.initial_cutoff ? normalizeReplayTimestamp(args.initial_cutoff, tradingDate) : cutoff,
    start_time: start,
    end_time: end,
    cadence: normalizeReplayAutopilotCadence(args.cadence),
    timezone: args.timezone || "Europe/Paris",
    instruments: args.instruments || ["MNQ", "MES", "NQ", "ES"],
    risk_model: args.risk_model || "0.5pct_fixed",
    automation_mode: "gpt_scheduled_task",
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function replayAutopilotCreateArgs(config = {}, args = {}) {
  assertReplayAutopilotConfigStartable(config);
  const backtestId = config.backtest_id || replayAutopilotDefaultBacktestId(config);
  return {
    backtest_id: backtestId,
    replay_run_id: config.replay_run_id || backtestId,
    run_id: config.run_id || backtestId,
    strategy_id: config.strategy_id || (config.session === "ny_open" ? "ny_open_1530" : "asia_open"),
    date: config.trading_date || config.date,
    trading_date: config.trading_date || config.date,
    session: config.session,
    pack_id: config.pack_id,
    pack_build_id: config.pack_build_id,
    cutoff_paris: config.cutoff_paris || config.initial_cutoff || config.start_time,
    cutoff_utc: config.cutoff_utc || normalizeUtcIso(config.cutoff_paris || config.initial_cutoff || config.start_time),
    initial_cutoff: config.initial_cutoff || config.cutoff_paris || config.start_time,
    start_time: config.start_time || config.cutoff_paris || config.initial_cutoff,
    end_time: config.end_time,
    cadence: normalizeReplayAutopilotCadence(config.cadence),
    timezone: config.timezone || "Europe/Paris",
    instruments: config.instruments || ["MNQ", "MES", "NQ", "ES"],
    risk_model: config.risk_model || "0.5pct_fixed",
    automation_enabled: true,
    automation_mode: "gpt_scheduled_task",
    idempotency_key: config.idempotency_key || `replay-autopilot:create:${config.config_id || backtestId}:${config.pack_build_id}:${backtestId}`,
    requested_by: args.worker_id || "gpt-replay-autopilot",
  };
}

function assertReplayAutopilotConfigStartable(config = {}) {
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
  return configs
    .filter((config) => config && config.enabled !== false)
    .filter((config) => !["PAUSED", "ARCHIVED"].includes(config.status))
    .filter((config) => selector.mode === "latest_ready_config" || !selector.trading_date || config.trading_date === selector.trading_date || config.date === selector.trading_date)
    .filter((config) => selector.mode === "latest_ready_config" || !selector.session || config.session === selector.session)
    .sort((left, right) =>
      String(right.updated_at_utc || right.created_at_utc || "").localeCompare(String(left.updated_at_utc || left.created_at_utc || ""))
      || String(right.trading_date || "").localeCompare(String(left.trading_date || "")))
    [0] || null;
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
  const text = String(value || "60m").toLowerCase();
  if (text === "1h" || text === "60" || text === "60m") return "60m";
  if (text === "30" || text === "30m") return "30m";
  if (text === "m15" || text === "15" || text === "15m") return "15m";
  return value || "60m";
}

function projectReplayAutopilotConfig(config = {}) {
  return {
    config_id: config.config_id || null,
    enabled: config.enabled !== false,
    status: config.status || null,
    backtest_id: config.backtest_id || null,
    strategy_id: config.strategy_id || null,
    trading_date: config.trading_date || config.date || null,
    session: config.session || null,
    pack_id: config.pack_id || null,
    pack_build_id: config.pack_build_id || null,
    start_time: config.start_time || null,
    end_time: config.end_time || null,
    cadence: config.cadence || null,
    instruments: config.instruments || [],
    updated_at_utc: config.updated_at_utc || null,
  };
}

function isRecoverableReplayAutopilotFailure(item = {}) {
  const lastError = item.last_error || {};
  const code = String(lastError.code || item.error_code || "");
  const message = String(lastError.message || item.error_message || "");
  if (item.status !== "FAILED") return false;
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

function projectReplayAutopilotStartResult({ config, creation, recovered, automation, state, worker_id }) {
  const run = state?.selected_backtest || null;
  const workItem = state?.current_work_item || null;
  const terminal = ["COMPLETED", "DAY_END", "FAILED", "CANCELLED"].includes(state?.status);
  const status = terminal
    ? "TERMINAL"
    : workItem?.status === "FAILED"
      ? "WORK_FAILED_REQUIRES_OPERATOR"
      : workItem?.status === "CLAIMED"
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
      tool: "claim_next_desk_work",
      args: {
        worker_id: worker_id || "gpt-replay-autopilot",
        workflows: ["REPLAY_MASTER", "REPLAY_MONITOR"],
        backtest_id: run?.backtest_id || config?.backtest_id || null,
      },
    } : null,
    work_item: workItem ? deskWorkSummary(workItem) : null,
    next_action: status === "WAITING_GPT" ? "claim_next_desk_work" : state?.next_action || null,
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

export function enrichReplayBundleSaveTargetForClaim(bundle = {}, workItem = null) {
  if (!bundle || !workItem || workItem.status !== "CLAIMED" || workItem.step_id !== bundle.step_id) return bundle;
  return { ...bundle, save_target: enrichReplaySaveTargetForClaim(bundle.save_target, workItem) };
}

function enrichReplaySaveTargetForClaim(saveTarget = null, workItem = null) {
  if (!saveTarget || !workItem || workItem.status !== "CLAIMED") return saveTarget;
  const leasePayload = {
    work_item_id: workItem.work_item_id,
    worker_id: workItem.claimed_by || workItem.worker_id,
    lease_token: workItem.lease_token,
  };
  const enriched = { ...saveTarget, ...leasePayload };
  if (saveTarget.suggested_payload && typeof saveTarget.suggested_payload === "object") {
    enriched.suggested_payload = { ...saveTarget.suggested_payload, ...leasePayload };
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

function nextReplayAction(status) {
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
    DAY_END: "review_replay_report",
    COMPLETED: "review_replay_report",
    FAILED: "inspect_replay_error",
    CANCELLED: "start_new_replay",
  };
  return map[status] || "refresh_replay_state";
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
