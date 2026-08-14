import { createHash, randomUUID } from "node:crypto";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { canonicalSha256 } from "@tv-automation/desk-domain";
import { deskError } from "./desk-errors.js";
import { normalizeGptTelemetry } from "./gpt-telemetry.js";
import { replayPositionToSimulatedTrade } from "./desk-backtest-algorithms.js";
import {
  CODEX_RUNTIME_SETTINGS_ID,
  isCodexReasoningEffort,
  loadCodexRuntimeSettings,
} from "./codex-runtime-settings.js";
import { clockEpochMs as frontOperationsEpochMs } from "./front-runtime-clock.js";
import { createSimulationRunFrontApi } from "./simulation-run-front-api.js";
import { createReplayComparisonProjector, replayIdentitySetForRun } from "./front-operations-replay-comparison.js";

const C = DESK_COLLECTIONS;
const TERMINAL = new Set(["DONE", "COMPLETED", "DAY_END", "FAILED", "CANCELLED", "ARCHIVED", "RESOLVED"]);
const ACTIVE = new Set(["RUNNING", "CLAIMED", "IN_PROGRESS", "PROCESSING"]);
const WAITING_GPT = new Set(["WAITING_GPT", "WAITING_GPT_MASTER", "WAITING_GPT_MONITOR", "READY", "WAITING_GPT_SAVE"]);
const BLOCKED = new Set(["BLOCKED", "WORK_BUSY", "WORK_FAILED_REQUIRES_OPERATOR", "DATA_NOT_READY", "REPLAN_REQUIRED"]);
const LIVE_CURSOR_COLLECTION = "desk_live_run_cursor";
const AI_WORKER_RUN_COLLECTION = "desk_ai_worker_runs";
const OBSERVABILITY_POLICY_ID = "default";
const GUARDRAIL_ALERT_SOURCE = "observability_guardrail";
const NOTIFICATION_SOURCE = "incident_escalation";
const LOCAL_NOTIFICATION_CHANNEL = "local_outbox";
const LIST_CACHE_TTL_MS = Math.max(0, Number(process.env.FRONT_OPERATIONS_LIST_CACHE_TTL_MS ?? 5000) || 0);
const SUMMARY_CACHE_TTL_MS = Math.max(0, Number(process.env.FRONT_OPERATIONS_SUMMARY_CACHE_TTL_MS ?? 15000) || 0);
const LIST_CACHE = new WeakMap();
const LIST_CACHE_INVALIDATION_PATCHED = Symbol("frontOperationsListCacheInvalidationPatched");
const OBSERVABILITY_SLA = Object.freeze({
  queueWarningMs: 5 * 60 * 1000,
  executionWarningMs: 10 * 60 * 1000,
  leaseExpiringMs: 2 * 60 * 1000,
});
const DEFAULT_OBSERVABILITY_POLICY = Object.freeze({
  id: OBSERVABILITY_POLICY_ID,
  revision: 0,
  enabled: true,
  queueWarningMs: OBSERVABILITY_SLA.queueWarningMs,
  executionWarningMs: OBSERVABILITY_SLA.executionWarningMs,
  leaseExpiringMs: OBSERVABILITY_SLA.leaseExpiringMs,
  telemetryCoverageWarningPct: 80,
  costCoverageMinimumPct: 80,
  failureRateWarningPct: 20,
  dailyCostBudgetUsd: null,
  monthlyCostBudgetUsd: null,
  updatedAt: null,
});

export const OPERATIONS_CONTRACT_VERSION = "1.0.0";
export class FrontOperationsService {
  constructor({ persistence, clock, host }) {
    this.persistence = persistence;
    this.clock = clock;
    this.host = host;
    this.simulationRunFront = createSimulationRunFrontApi({ host, clock });
    this.replayComparison = createReplayComparisonProjector({
      operationsService: this,
      persistence,
      host,
      simulationRunFront: this.simulationRunFront,
      helpers: replayComparisonHelpers(),
    });
    this.summaryCache = null;
    attachListCacheInvalidation(this.persistence);
  }

  async getOperationsSummary(filters = {}) {
    const cacheKey = canonicalSha256(normalizedFilters(filters));
    const now = frontOperationsEpochMs(this.clock);
    if (SUMMARY_CACHE_TTL_MS && this.summaryCache?.key === cacheKey && this.summaryCache.expiresAt > now) {
      return this.summaryCache.promise;
    }
    const promise = this.#buildOperationsSummary(filters);
    if (SUMMARY_CACHE_TTL_MS) {
      this.summaryCache = { key: cacheKey, expiresAt: now + SUMMARY_CACHE_TTL_MS, promise };
    }
    try {
      const summary = await promise;
      if (SUMMARY_CACHE_TTL_MS && this.summaryCache?.promise === promise) {
        this.summaryCache = { key: cacheKey, expiresAt: frontOperationsEpochMs(this.clock) + SUMMARY_CACHE_TTL_MS, promise: Promise.resolve(summary) };
      }
      return summary;
    } catch (error) {
      if (this.summaryCache?.promise === promise) this.summaryCache = null;
      throw error;
    }
  }

  async #buildOperationsSummary(filters = {}) {
    const [workflows, alerts, gpt] = await Promise.all([
      this.listWorkflows(filters),
      this.listIncidents({ ...filters, limit: 500 }),
      this.listGptProcesses({ ...filters, limit: 500 }),
    ]);
    const counts = countBy(workflows.items, (item) => item.status);
    return contract("DeskOperationsSummary", {
      generatedAt: this.clock.now().utc,
      filters: normalizedFilters(filters),
      totals: {
        workflows: workflows.items.length,
        running: counts.running || 0,
        waitingGpt: counts.waiting_gpt || 0,
        blocked: counts.blocked || 0,
        failed: counts.failed || 0,
        completed: counts.completed || 0,
        openIncidents: alerts.items.filter((item) => !["resolved", "archived"].includes(item.lifecycleStatus)).length,
        gptInProgress: gpt.items.filter((item) => ["running", "waiting_gpt"].includes(item.status)).length,
      },
      health: healthFromCounts(counts, alerts.items),
      recent: workflows.items.slice(0, 8),
    });
  }

  async listWorkflows(filters = {}) {
    const [replayRuns, workItems, errors, positions] = await Promise.all([
      list(this.persistence, C.deskReplayRuns),
      list(this.persistence, C.deskAgentWorkItems),
      list(this.persistence, C.deskErrors),
      list(this.persistence, C.deskReplayPositions),
    ]);
    const replayWork = groupBy(workItems, (item) => item.backtest_id);
    const replayErrors = groupBy(errors, (item) => item.backtest_id || item.run_id || item.job_id);
    const replayPositions = groupBy(positions, (item) => item.backtest_id || item.replay_run_id || item.run_id);
    const items = operationalRecords(replayLabRecords(replayRuns, "current"), filters)
      .map((run) => normalizeReplayWorkflow(
        run,
        replayWork.get(run.backtest_id) || [],
        replayErrors.get(run.backtest_id) || [],
        replayPositions.get(run.backtest_id) || [],
      ))
      .filter((item) => workflowMatches(item, filters))
      .sort(byUpdatedDesc)
      .slice(0, bounded(filters.limit, 200, 1000));
    return contract("DeskWorkflowList", { filters: normalizedFilters(filters), count: items.length, items });
  }

  async getWorkflow(workflowId) {
    const listResult = await this.listWorkflows({ limit: 1000 });
    const workflow = listResult.items.find((item) => item.id === workflowId || item.sourceId === workflowId);
    if (!workflow) throw notFound("WORKFLOW_NOT_FOUND", `Workflow introuvable : ${workflowId}`);
    const [steps, events, commands, commandEvents] = await Promise.all([
      this.getWorkflowSteps(workflow),
      this.getWorkflowEvents(workflow),
      list(this.persistence, C.deskOperationsCommands),
      list(this.persistence, C.deskOperationsEvents),
    ]);
    const allowedActions = allowedWorkflowActions(workflow);
    return contract("DeskWorkflowDetail", {
      workflow,
      steps,
      events,
      allowedActions,
      relations: workflowRelations(workflow, steps, events),
      commandCenter: buildWorkflowCommandCenter(workflow, allowedActions, commands, commandEvents, events),
    });
  }

  async getWorkflowSteps(workflowOrId) {
    const workflow = typeof workflowOrId === "string"
      ? (await this.getWorkflow(workflowOrId)).workflow
      : workflowOrId;
    const collection = workflow.kind === "replay" ? C.deskReplaySteps : null;
    if (!collection) return [];
    return (await list(this.persistence, collection))
      .filter((step) => (step.backtest_id || step.run_id) === workflow.sourceId)
      .map(normalizeStep)
      .sort(bySequence);
  }

  async getWorkflowEvents(workflowOrId) {
    const workflow = typeof workflowOrId === "string"
      ? (await this.getWorkflow(workflowOrId)).workflow
      : workflowOrId;
    const collections = workflow.kind === "replay"
      ? [C.deskReplayTimeline, C.deskAgentWorkEvents, C.deskReplayAuditLogs]
      : [C.deskOperationsEvents, C.deskAuditLogs];
    const docs = (await Promise.all(collections.map((collection) => list(this.persistence, collection)))).flat();
    return docs
      .filter((event) => eventMatchesWorkflow(event, workflow))
      .map(normalizeEvent)
      .sort(byTimeAsc);
  }

  async executeWorkflowAction(workflowId, input = {}, actor = {}) {
    validateCommandInput(input);
    const detail = await this.getWorkflow(workflowId);
    const workflow = detail.workflow;
    const action = String(input.action || "").toLowerCase();
    const replayed = await this.#replayCommand("workflow", workflow.id, action, input);
    if (replayed) return contract("DeskOperationsCommandResult", replayed);
    if (Number(input.expectedRevision) !== Number(workflow.revision)) {
      throw conflict("REVISION_CONFLICT", "Le workflow a changé. Rechargez son état avant de confirmer.");
    }
    const allowed = allowedWorkflowActions(workflow);
    if (!allowed.includes(action)) throw conflict("COMMAND_NOT_ALLOWED", `Action ${action} indisponible pour ${workflow.status}.`);
    const command = await this.#beginCommand("workflow", workflow.id, action, input, actor);
    if (command.replayed) return contract("DeskOperationsCommandResult", command.result);

    try {
      let result;
      if (workflow.kind === "replay" && action === "cancel") {
        result = await this.#patchReplayRun(workflow, { status: "CANCELLED", automation_enabled: false, automation_status: "cancelled" });
      } else if (workflow.kind === "replay" && action === "pause") {
        result = await this.host.setReplayAutomation({ backtest_id: workflow.sourceId, enabled: false, reason: input.reason, expected_revision: workflow.revision });
      } else if (workflow.kind === "replay" && action === "retry") {
        result = await this.host.retryReplayAutomationWork({ backtest_id: workflow.sourceId, expected_revision: workflow.revision, reason: input.reason, requested_by: actor.email || actor.kind || "front-operator" });
      } else if (workflow.kind === "replay" && action === "resume") {
        result = await this.host.setReplayAutomation({ backtest_id: workflow.sourceId, enabled: true, reason: input.reason, expected_revision: workflow.revision });
      } else {
        throw conflict("COMMAND_NOT_ALLOWED", "Cette action n’a pas de mutation canonique sûre pour ce type de workflow.");
      }
      invalidateListCache(this.persistence);
      const next = await this.getWorkflow(workflowId);
      const payload = { ok: true, idempotent: false, commandId: command.commandId, action, result, workflow: next.workflow };
      await this.#completeCommand(command, payload, actor, input.reason);
      return contract("DeskOperationsCommandResult", payload);
    } catch (error) {
      await this.#failCommand(command, error, actor, input.reason);
      throw error;
    }
  }

  async listReplays(filters = {}) {
    const [replayRuns, workItems, errors, positions] = await Promise.all([
      list(this.persistence, C.deskReplayRuns),
      list(this.persistence, C.deskAgentWorkItems),
      list(this.persistence, C.deskErrors),
      list(this.persistence, C.deskReplayPositions),
    ]);
    const replayWork = groupBy(workItems, (item) => item.backtest_id);
    const replayErrors = groupBy(errors, (item) => item.backtest_id || item.run_id || item.job_id);
    const replayPositions = groupBy(positions, (item) => item.backtest_id || item.replay_run_id || item.run_id);
    const normalizedReplayItems = replayLabRecords(replayRuns, filters.versionScope)
      .map((run) => normalizeReplayWorkflow(
        run,
        replayWork.get(run.backtest_id) || [],
        replayErrors.get(run.backtest_id) || [],
        replayPositions.get(run.backtest_id) || [],
      ));
    const replayItems = applyReplayResultSelection(normalizedReplayItems)
      .filter((item) => workflowMatches(item, filters))
      .sort(byUpdatedDesc)
      .slice(0, bounded(filters.limit, 500, 1000));
    const statusCounts = countBy(replayItems, (item) => item.status);
    const grouped = groupBy(replayItems, (item) => item.tradingDate || "unknown");
    const days = [...grouped.entries()].map(([date, items]) => {
      const primary = selectReplayDayPrimary(items);
      const sessions = [...items].sort((left, right) =>
        Number(right.sourceId === primary?.sourceId) - Number(left.sourceId === primary?.sourceId)
        || byUpdatedDesc(left, right));
      const eligible = sessions.filter((item) => item.resultEligible);
      return {
        date,
        status: primary?.status || aggregateStatus(sessions.map((item) => item.status)),
        sessionCount: sessions.length,
        comparisonCount: Math.max(0, sessions.length - (primary ? 1 : 0)),
        resultEligibleSessions: eligible.length,
        running: sessions.filter((item) => item.status === "running").length,
        failed: sessions.filter((item) => item.status === "failed").length,
        totalProgress: primary?.progress ?? average(sessions.map((item) => item.progress)),
        totalR: sum(eligible.map((item) => item.metrics?.totalR)),
        provisionalR: firstNumber(primary?.metrics?.totalR),
        primaryRunId: primary?.sourceId || null,
        currentReplayTime: primary?.currentReplayTime || null,
        startTime: primary?.startTime || null,
        endTime: primary?.endTime || null,
        sessions,
      };
    }).sort((a, b) => b.date.localeCompare(a.date));
    const resultItems = replayItems.filter((item) => item.resultEligible);
    return contract("DeskReplayList", {
      generatedAt: this.clock.now().utc,
      filters: normalizedFilters(filters),
      count: replayItems.length,
      summary: {
        executions: replayItems.length,
        days: days.length,
        active: (statusCounts.running || 0) + (statusCounts.waiting_gpt || 0) + (statusCounts.blocked || 0),
        running: statusCounts.running || 0,
        waitingGpt: statusCounts.waiting_gpt || 0,
        blocked: statusCounts.blocked || 0,
        failed: statusCounts.failed || 0,
        completed: statusCounts.completed || 0,
        certified: replayItems.filter((item) => item.v4Certified).length,
        contractualV4: replayItems.filter((item) => item.replayClassification === "v4_contractual").length,
        legacy: replayItems.filter((item) => item.replayClassification === "legacy").length,
        resultEligible: resultItems.length,
        averageProgress: average(days.map((item) => item.totalProgress)),
        totalR: sum(resultItems.map((item) => item.metrics?.totalR)),
        gptProcesses: sum(replayItems.map((item) => item.metrics?.gptProcesses)),
      },
      facets: {
        statuses: [...new Set(replayItems.map((item) => item.status).filter(Boolean))].sort(),
        sessions: [...new Set(replayItems.map((item) => item.session).filter(Boolean))].sort(),
        strategies: [...new Set(replayItems.map((item) => item.strategyId).filter(Boolean))].sort(),
        variants: [...new Set(replayItems.map((item) => item.variantId).filter(Boolean))].sort(),
        versions: [...new Set(replayItems.map((item) => item.replayClassification).filter(Boolean))].sort(),
      },
      days,
      items: replayItems,
    });
  }

  async getReplayRun(runId) {
    const state = await this.host.getReplayState({ backtest_id: runId }).catch(() => null);
    if (!state?.selected_backtest) throw notFound("REPLAY_NOT_FOUND", `Replay introuvable : ${runId}`);
    if (!isReplayLabRecord(state.selected_backtest, "all")) {
      throw notFound("REPLAY_NOT_FOUND", `Replay introuvable : ${runId}`);
    }
    const [timeline, gpt, priceSeries, positions, simulationEvidence] = await Promise.all([
      this.getReplayTimeline(runId),
      this.listGptProcesses({ runId, limit: 500 }),
      this.getReplayPriceSeries(runId),
      listForReplay(this.persistence, C.deskReplayPositions, runId),
      this.simulationRunFront.findSimulationEvidenceForReplay(state.selected_backtest),
    ]);
    const run = state.selected_backtest;
    return contract("DeskReplayRunDetail", {
      run: normalizeReplayWorkflow(run, state.work_queue || [], [], positions.filter((item) => item.backtest_id === runId)),
      canonicalState: state,
      timeline: timeline.items,
      priceSeries: priceSeries.items,
      gptProcesses: gpt.items,
      conclusions: gpt.items.filter((item) => item.conclusion).map((item) => ({ processId: item.id, conclusion: item.conclusion, at: item.completedAt })),
      simulationEvidence,
    });
  }

  async listSimulationRuns(filters = {}) {
    return this.simulationRunFront.listSimulationRuns(filters);
  }

  async getSimulationRun(simulationRunId) {
    return this.simulationRunFront.getSimulationRun(simulationRunId);
  }

  async getSimulationRunArtifacts(simulationRunId, filters = {}) {
    return this.simulationRunFront.getSimulationRunArtifacts(simulationRunId, filters);
  }

  async compareSimulationRuns(ids = []) {
    return this.simulationRunFront.compareSimulationRuns(ids);
  }

  async getReplayDays(runId) {
    const run = (await this.getReplayRun(runId)).run;
    const all = await this.listReplays({
      limit: 1000,
      versionScope: replayVersionScopeForEngine(run.engineVersion),
    });
    const days = all.days.filter((day) => day.date === run.tradingDate || day.sessions.some((session) => session.sourceId === run.sourceId));
    return contract("DeskReplayDayList", { runId: run.sourceId, count: days.length, items: days });
  }

  async getReplayDay(runId, date) {
    const target = (await this.listReplays({ limit: 1000, versionScope: "all" })).items
      .find((item) => item.sourceId === runId || item.id === runId);
    const all = await this.listReplays({
      limit: 1000,
      versionScope: replayVersionScopeForEngine(target?.engineVersion),
    });
    const day = all.days.find((item) => item.date === date);
    if (!day) throw notFound("REPLAY_DAY_NOT_FOUND", `Aucune exécution replay le ${date}.`);
    const sessions = assignAttempts(day.sessions);
    const sessionIds = new Set(sessions.map((item) => item.sourceId));
    const [gptLists, timelines] = await Promise.all([
      Promise.all([...sessionIds].map((id) => this.listGptProcesses({ runId: id, limit: 1000 }).catch(() => ({ items: [] })))),
      Promise.all([...sessionIds].map((id) => this.getReplayTimeline(id).catch(() => ({ items: [] })))),
    ]);
    const gpt = gptLists.flatMap((item) => item.items || []);
    const timeline = timelines.flatMap((item) => item.items || []).sort(byTimeAsc);
    return contract("DeskReplayDayDetail", {
      runId,
      date,
      status: day.status,
      metrics: {
        totalR: day.totalR,
        provisionalR: day.provisionalR,
        progress: day.totalProgress,
        sessionCount: sessions.length,
        gptProcesses: gpt.length,
        gptWaiting: gpt.filter((item) => item.status === "waiting_gpt").length,
        gptFailed: gpt.filter((item) => item.status === "failed").length,
        events: timeline.length,
      },
      sessions,
      variants: [...new Set(sessions.map((item) => item.variantId))],
      gptProcesses: gpt,
      conclusions: gpt.filter((item) => item.conclusion).map((item) => ({ processId: item.id, runId: item.runId, conclusion: item.conclusion, at: item.completedAt })),
      timeline,
    });
  }

  async getReplaySession(runId, sessionExecutionId) {
    const detail = await this.getReplayRun(sessionExecutionId || runId);
    return contract("DeskReplaySessionDetail", { parentRunId: runId, sessionExecutionId, ...detail });
  }

  async getReplayTimeline(runId) {
    const [timeline, steps, workEvents] = await Promise.all([
      listForReplay(this.persistence, C.deskReplayTimeline, runId),
      listForReplay(this.persistence, C.deskReplaySteps, runId),
      listForReplay(this.persistence, C.deskAgentWorkEvents, runId),
    ]);
    const items = [
      ...timeline.filter((item) => item.backtest_id === runId).map((item) => normalizeDecisionEvent(item, "decision")),
      ...steps.filter((item) => item.backtest_id === runId).map((item) => normalizeDecisionEvent(item, "step")),
      ...workEvents.filter((item) => item.backtest_id === runId).map((item) => normalizeDecisionEvent(item, "gpt")),
    ].sort(byTimeAsc);
    return contract("DeskReplayTimeline", {
      runId,
      count: items.length,
      range: { from: items[0]?.at || null, to: items.at(-1)?.at || null },
      layers: { decisions: true, gpt: true, trades: true, price: true },
      items,
    });
  }

  async getReplayPriceSeries(runId) {
    const [bundles, simulations, steps] = await Promise.all([
      listForReplay(this.persistence, C.deskReplayBundles, runId),
      listForReplay(this.persistence, C.deskReplayTradeSimulations, runId),
      listForReplay(this.persistence, C.deskReplaySteps, runId),
    ]);
    const values = [];
    for (const bundle of bundles.filter((item) => item.backtest_id === runId)) collectCandles(bundle, values);
    for (const item of simulations.filter((entry) => entry.backtest_id === runId)) collectCandles(item, values);
    if (!values.length) {
      for (const step of steps.filter((item) => item.backtest_id === runId)) {
        const price = firstNumber(step.close, step.price, step.market_price, step.simulation?.close);
        if (price !== null) values.push({ time: eventTime(step), open: price, high: price, low: price, close: price, source: "replay_step" });
      }
    }
    const deduped = [...new Map(values.filter((item) => item.time && Number.isFinite(item.close)).map((item) => [`${item.time}:${item.close}`, item])).values()]
      .sort((a, b) => String(a.time).localeCompare(String(b.time)))
      .slice(-5000);
    return contract("DeskReplayPriceSeries", { runId, count: deduped.length, items: deduped });
  }

  async listGptProcesses(filters = {}) {
    const scopedRunId = stringOrNull(filters.runId || filters.run_id);
    const replayIds = scopedRunId
      ? await replayIdentitySetForRun({ persistence: this.persistence, runId: scopedRunId, helpers: replayComparisonHelpers() })
      : new Set(replayLabRecords(await list(this.persistence, C.deskReplayRuns), "current").flatMap(replayIdentityValues));
    const itemFilters = [];
    if (scopedRunId) itemFilters.push({ field: "backtest_id", operator: "==", value: scopedRunId });
    if (filters.includeHistory !== true && !scopedRunId) {
      itemFilters.push({ field: "operational_visibility", operator: "!=", value: "history" });
    }
    const items = await projectDocuments(this.persistence, C.deskAgentWorkItems, [
      "work_item_id", "backtest_id", "run_id", "step_id", "workflow", "task_type", "status",
      "revision", "attempt_count", "max_attempts", "worker_id", "claimed_by", "lease_expires_at_utc",
      "created_at_utc", "claimed_at_utc", "started_at_utc", "completed_at_utc", "updated_at_utc",
      "last_error", "gpt_telemetry", "operational_visibility", "data_origin", "read_only",
    ], itemFilters);
    const relevantItems = items.filter((item) => replayIds.has(item.backtest_id || item.replay_run_id || item.run_id));
    const workItemIds = uniqueValues(relevantItems.map((item) => item.work_item_id));
    const relevantRunIds = uniqueValues(relevantItems.map((item) => item.backtest_id || item.run_id));
    const [events, bundles, masters, monitors, aiRuns] = relevantItems.length ? await Promise.all([
      workItemIds.length
        ? projectDocuments(this.persistence, C.deskAgentWorkEvents, [
          "event_id", "audit_id", "id", "work_item_id", "process_id", "event_type", "action", "phase",
          "status", "backtest_id", "run_id", "replay_run_id", "workflow", "workflow_id", "step_id",
          "at_utc", "created_at_utc", "updated_at_utc", "timestamp_utc", "timestamp_paris",
          "title", "note", "message", "reason", "actor", "performed_by", "ref", "output_ref",
          "monitor_decision", "decision", "conclusion", "price", "close", "market_price", "severity", "details",
        ], [{ field: "work_item_id", operator: "in", value: workItemIds }])
        : Promise.resolve([]),
      projectDocuments(this.persistence, C.deskReplayBundles, [
        "backtest_id", "step_id", "bundle_id", "manifest", "section_manifest", "data_quality",
      ], [{ field: "backtest_id", operator: "in", value: relevantRunIds }]),
      projectDocuments(this.persistence, C.deskReplayMasterAnalyses, [
        "backtest_id", "work_item_id", "step_id", "analysis_id", "created_at_utc",
        "decision", "action", "conclusion", "executive_summary", "summary", "thesis_summary",
      ], [{ field: "backtest_id", operator: "in", value: relevantRunIds }]),
      projectDocuments(this.persistence, C.deskReplayMonitors, [
        "backtest_id", "work_item_id", "step_id", "monitor_id", "created_at_utc",
        "monitor_decision", "decision", "action", "conclusion", "executive_summary", "summary", "thesis_summary",
      ], [{ field: "backtest_id", operator: "in", value: relevantRunIds }]),
      workItemIds.length
        ? projectDocuments(this.persistence, AI_WORKER_RUN_COLLECTION, [
          "ai_run_id", "claim_handle", "research_progress", "analytical_validation",
          "started_at_utc", "completed_at_utc", "updated_at_utc",
        ], [{ field: "claim_handle.work_item_id", operator: "in", value: workItemIds }])
        : Promise.resolve([]),
    ]) : [[], [], [], [], []];
    const eventGroups = groupBy(events, (event) => event.work_item_id);
    const bundleByStep = new Map(bundles.map((bundle) => [bundle.step_id, bundle]));
    const aiRunByWorkItem = latestAiRunByClaim(aiRuns, "work_item_id");
    const outputs = [...masters, ...monitors];
    const visibilityFilters = filters.runId
      ? { ...filters, includeHistory: true }
      : filters;
    const normalized = operationalRecords(relevantItems, visibilityFilters)
      .filter((item) => !scopedRunId || item.backtest_id === scopedRunId)
      .filter((item) => !filters.status || normalizeStatus(item.status) === filters.status)
      .map((item) => normalizeGptProcess(
        item,
        eventGroups.get(item.work_item_id) || [],
        bundleByStep.get(item.step_id),
        outputs,
        aiRunByWorkItem.get(item.work_item_id),
      ))
      .sort(byUpdatedDesc)
      .slice(0, bounded(filters.limit, 200, 1000));
    return contract("DeskGptProcessList", { count: normalized.length, items: normalized });
  }

  async getGptProcess(processId) {
    const item = await this.persistence.getDocument(C.deskAgentWorkItems, processId).catch(() => null);
    const all = await this.listGptProcesses(item?.backtest_id
      ? { runId: item.backtest_id, limit: 1000 }
      : { limit: 1000 });
    const process = all.items.find((item) => item.id === processId);
    if (!process) throw notFound("GPT_PROCESS_NOT_FOUND", `Processus GPT introuvable : ${processId}`);
    const manifest = process.bundle?.manifest || process.bundle?.section_manifest || null;
    const prompt = item?.execution_prompt || item?.prompt || null;
    const saveTarget = item?.save_target || item?.input_ref?.save_target || null;
    const transport = normalizeGptTransport(process, item, saveTarget, manifest, prompt, this.clock.now().epochMs);
    const protectedValues = [
      item?.lease_token,
      saveTarget?.suggested_payload?.lease_token,
      item?.input_ref?.save_target?.suggested_payload?.lease_token,
    ].map(stringOrNull).filter(Boolean);
    const [workflows, incidents, runbooks] = await Promise.all([
      this.listWorkflows({ limit: 1000 }),
      this.listIncidents({ limit: 1000 }),
      this.listRunbooks({ limit: 1000 }),
    ]);
    const workflow = findWorkflowForGptProcess(workflows.items, process);
    const linkedIncidents = incidents.items.filter((incident) => incidentMatchesGptProcess(incident, process, workflow)).slice(0, 8);
    const linkedRunbooks = runbooks.items.filter((runbook) => runbookMatchesGptProcess(runbook, process, workflow, linkedIncidents)).slice(0, 8);
    return contract("DeskGptProcessDetail", {
      process,
      ...projectAiRunResearch(process),
      manifest,
      prompt: redactProtectedFrontFields(prompt, protectedValues),
      saveTarget: redactProtectedFrontFields(saveTarget, protectedValues),
      transport,
      operationsContext: buildGptOperationsContext(process, transport, workflow, linkedIncidents, linkedRunbooks),
      error: redactProtectedFrontFields(item?.last_error || null, protectedValues),
      raw: redactProtectedFrontFields(item, protectedValues),
    });
  }

  async getObservabilityPolicy() {
    const stored = await this.persistence.getDocument(C.deskObservabilityPolicies, OBSERVABILITY_POLICY_ID).catch(() => null);
    return contract("DeskObservabilityPolicy", {
      policy: normalizeObservabilityPolicy(stored),
      persisted: Boolean(stored),
    });
  }

  async executeObservabilityPolicyAction(input = {}, actor = {}) {
    validateCommandInput(input);
    if (String(input.action || "").toLowerCase() !== "update") {
      throw invalid("INVALID_OBSERVABILITY_POLICY_ACTION", "Seule l’action update est autorisée.");
    }
    const current = (await this.getObservabilityPolicy()).policy;
    const replayed = await this.#replayCommand("observability_policy", OBSERVABILITY_POLICY_ID, "update", input);
    if (replayed) return contract("DeskOperationsCommandResult", replayed);
    if (Number(input.expectedRevision) !== Number(current.revision)) {
      throw conflict("REVISION_CONFLICT", "La policy d’observabilité a changé.");
    }
    const command = await this.#beginCommand("observability_policy", OBSERVABILITY_POLICY_ID, "update", input, actor);
    if (command.replayed) return contract("DeskOperationsCommandResult", command.result);
    try {
      const nextPolicy = normalizeObservabilityPolicyInput(input.policy, current);
      const tick = this.clock.now();
      const persisted = {
        policy_id: OBSERVABILITY_POLICY_ID,
        schema_version: "1.0.0",
        revision: Number(current.revision) + 1,
        enabled: nextPolicy.enabled,
        queue_warning_ms: nextPolicy.queueWarningMs,
        execution_warning_ms: nextPolicy.executionWarningMs,
        lease_expiring_ms: nextPolicy.leaseExpiringMs,
        telemetry_coverage_warning_pct: nextPolicy.telemetryCoverageWarningPct,
        cost_coverage_minimum_pct: nextPolicy.costCoverageMinimumPct,
        failure_rate_warning_pct: nextPolicy.failureRateWarningPct,
        daily_cost_budget_usd: nextPolicy.dailyCostBudgetUsd,
        monthly_cost_budget_usd: nextPolicy.monthlyCostBudgetUsd,
        updated_at_utc: tick.utc,
        updated_at_paris: tick.paris,
        updated_by: normalizeActor(actor),
      };
      await this.persistence.setDocument(C.deskObservabilityPolicies, OBSERVABILITY_POLICY_ID, persisted);
      const payload = {
        ok: true,
        idempotent: false,
        commandId: command.commandId,
        action: "update",
        policy: normalizeObservabilityPolicy(persisted),
      };
      await this.#completeCommand(command, payload, actor, input.reason);
      return contract("DeskOperationsCommandResult", payload);
    } catch (error) {
      await this.#failCommand(command, error, actor, input.reason);
      throw error;
    }
  }

  async getAiRuntimeSettings() {
    const settings = await loadCodexRuntimeSettings(this.persistence);
    return contract("DeskAiRuntimeSettings", {
      settings,
      persisted: settings.source === "database",
    });
  }

  async executeAiRuntimeSettingsAction(input = {}, actor = {}) {
    validateCommandInput(input);
    if (String(input.action || "").toLowerCase() !== "update_reasoning_effort") {
      throw invalid("INVALID_AI_RUNTIME_SETTINGS_ACTION", "Seule l’action update_reasoning_effort est autorisée.");
    }
    if (!isCodexReasoningEffort(input.reasoningEffort)) {
      throw invalid("INVALID_CODEX_REASONING_EFFORT", "Le niveau de réflexion Codex n’est pas supporté.");
    }
    const current = (await this.getAiRuntimeSettings()).settings;
    const replayed = await this.#replayCommand(
      "ai_runtime_settings",
      CODEX_RUNTIME_SETTINGS_ID,
      "update_reasoning_effort",
      input,
    );
    if (replayed) return contract("DeskOperationsCommandResult", replayed);
    if (Number(input.expectedRevision) !== Number(current.revision)) {
      throw conflict("REVISION_CONFLICT", "Les réglages IA ont changé.");
    }
    const command = await this.#beginCommand(
      "ai_runtime_settings",
      CODEX_RUNTIME_SETTINGS_ID,
      "update_reasoning_effort",
      input,
      actor,
    );
    if (command.replayed) return contract("DeskOperationsCommandResult", command.result);
    try {
      const tick = this.clock.now();
      const persisted = {
        settings_id: CODEX_RUNTIME_SETTINGS_ID,
        schema_version: "1.0.0",
        revision: Number(current.revision) + 1,
        reasoning_effort: String(input.reasoningEffort).toLowerCase(),
        applies_to: "next_analysis",
        updated_at_utc: tick.utc,
        updated_at_paris: tick.paris,
        updated_by: normalizeActor(actor),
      };
      await this.persistence.setDocument(
        C.deskAiRuntimeSettings,
        CODEX_RUNTIME_SETTINGS_ID,
        persisted,
      );
      const settings = (await this.getAiRuntimeSettings()).settings;
      const payload = {
        ok: true,
        idempotent: false,
        commandId: command.commandId,
        action: "update_reasoning_effort",
        settings,
      };
      await this.#completeCommand(command, payload, actor, input.reason);
      return contract("DeskOperationsCommandResult", payload);
    } catch (error) {
      await this.#failCommand(command, error, actor, input.reason);
      throw error;
    }
  }

  async getObservability(filters = {}) {
    const tick = this.clock.now();
    const [workItems, workEvents, liveCursors, policyResult, aiRuntimeSettingsResult, aiRuns, aiWorkerHeartbeats] = await Promise.all([
      list(this.persistence, C.deskAgentWorkItems),
      list(this.persistence, C.deskAgentWorkEvents),
      list(this.persistence, LIVE_CURSOR_COLLECTION),
      this.getObservabilityPolicy(),
      this.getAiRuntimeSettings(),
      list(this.persistence, AI_WORKER_RUN_COLLECTION),
      listCodexWorkerHeartbeats(this.persistence),
    ]);
    const policy = policyResult.policy;
    const eventsByWork = groupBy(workEvents.filter((event) => event.work_item_id), (event) => event.work_item_id);
    const eventsByCursor = groupBy(workEvents.filter((event) => event.cursor_id), (event) => event.cursor_id);
    const aiRunByWorkItem = latestAiRunByClaim(aiRuns, "work_item_id");
    const allItems = [
      ...operationalRecords(workItems, filters).map((item) => normalizeObservedReplayProcess(
        item,
        eventsByWork.get(item.work_item_id) || [],
        tick.epochMs,
        policy,
        aiRunByWorkItem.get(item.work_item_id),
      )),
      ...operationalRecords(liveCursors, filters).map((cursor) => normalizeObservedLiveProcess(cursor, eventsByCursor.get(cursor.cursor_id) || [], tick.epochMs, policy)).filter(Boolean),
    ];
    const items = allItems
      .filter((item) => observabilityMatches(item, filters))
      .sort(byUpdatedDesc)
      .slice(0, bounded(filters.limit, 500, 1000));
    const statusCounts = countBy(items, (item) => item.status);
    const telemetryItems = items.filter((item) => item.telemetry.available);
    const tokenItems = items.filter((item) => item.telemetry.totalTokens !== null);
    const costItems = items.filter((item) => item.telemetry.costUsd !== null);
    const completed = items.filter((item) => item.status === "completed");
    const failed = items.filter((item) => item.status === "failed");
    const executionSamples = items.map((item) => item.executionMs).filter(Number.isFinite);
    const queueSamples = items.map((item) => item.queueMs).filter(Number.isFinite);
    const dates = allItems.map((item) => item.tradingDate).filter(Boolean).sort();

    return contract("DeskObservabilityOverview", {
      generatedAt: tick.utc,
      filters: normalizedFilters(filters),
      sla: {
        queueWarningMs: policy.queueWarningMs,
        executionWarningMs: policy.executionWarningMs,
        leaseExpiringMs: policy.leaseExpiringMs,
      },
      guardrails: buildGuardrailProjection(allItems, policy),
      summary: {
        processes: items.length,
        queued: statusCounts.queued || 0,
        running: statusCounts.running || 0,
        failed: statusCounts.failed || 0,
        completed: statusCounts.completed || 0,
        retries: sum(items.map((item) => Math.max(0, item.attempts - 1))),
        successRate: completed.length + failed.length ? completed.length / (completed.length + failed.length) : null,
        avgQueueMs: averageNullable(queueSamples),
        avgExecutionMs: averageNullable(executionSamples),
        p95ExecutionMs: percentile(executionSamples, 0.95),
        inputTokens: sumNullable(tokenItems.map((item) => item.telemetry.inputTokens)),
        outputTokens: sumNullable(tokenItems.map((item) => item.telemetry.outputTokens)),
        totalTokens: sumNullable(tokenItems.map((item) => item.telemetry.totalTokens)),
        costUsd: sumNullable(costItems.map((item) => item.telemetry.costUsd), 6),
        slaBreaches: items.filter((item) => item.sla.queueBreached || item.sla.executionBreached || item.sla.leaseBreached).length,
      },
      coverage: {
        telemetry: coverage(telemetryItems.length, items.length),
        tokens: coverage(tokenItems.length, items.length),
        cost: coverage(costItems.length, items.length),
      },
      leases: {
        active: items.filter((item) => item.lease.state === "active").length,
        expiring: items.filter((item) => item.lease.state === "expiring").length,
        expired: items.filter((item) => item.lease.state === "expired").length,
      },
      queue: {
        depth: items.filter((item) => item.status === "queued").length,
        oldestQueuedMs: maxNullable(items.filter((item) => item.status === "queued").map((item) => item.queueMs)),
      },
      aiWorkers: projectCodexWorkerFleet(aiWorkerHeartbeats, aiRuns, tick.epochMs),
      aiRuntimeSettings: aiRuntimeSettingsResult.settings,
      facets: {
        scopes: uniqueValues(allItems.map((item) => item.scope)),
        workflows: uniqueValues(allItems.map((item) => item.workflow)),
        workers: uniqueValues(allItems.map((item) => item.worker)),
        sessions: uniqueValues(allItems.map((item) => item.session)),
        models: uniqueValues(allItems.map((item) => item.telemetry.model)),
        providers: uniqueValues(allItems.map((item) => item.telemetry.provider)),
        statuses: uniqueValues(allItems.map((item) => item.status)),
        dateRange: { from: dates[0] || null, to: dates.at(-1) || null },
      },
      breakdowns: {
        workflows: observabilityBreakdown(items, (item) => item.workflow),
        workers: observabilityBreakdown(items, (item) => item.worker || "non assigné"),
        models: observabilityBreakdown(items, (item) => item.telemetry.model || "N/D"),
      },
      daily: observabilityDailySeries(items),
      count: items.length,
      items,
    });
  }

  async evaluateObservabilityIncidents(input = {}, actor = {}) {
    const autoResolve = input.autoResolve !== false;
    const tick = this.clock.now();
    const overview = await this.getObservability({ limit: 1000 });
    const policy = overview.guardrails.policy;
    const signals = overview.guardrails.signals || [];
    const existingAlerts = await list(this.persistence, C.deskAlerts);
    const guardrailAlerts = existingAlerts.filter(isGuardrailAlert);
    const existingById = new Map(guardrailAlerts.map((item) => [item.alert_id || item.id, item]));
    const activeIds = new Set();
    const changes = [];
    let opened = 0;
    let updated = 0;
    let unchanged = 0;
    let resolved = 0;

    for (const signal of signals) {
      const alertId = guardrailAlertId(signal);
      activeIds.add(alertId);
      const current = existingById.get(alertId) || null;
      const next = guardrailAlertFromSignal(signal, current, policy, tick, actor);
      if (guardrailAlertEquivalent(current, next)) {
        unchanged += 1;
        continue;
      }
      await this.persistence.setDocument(C.deskAlerts, alertId, next);
      await this.#appendIncidentEvent(next, current ? (normalizeLifecycle(current.lifecycle_status || current.status) === "resolved" ? "REOPENED" : "OBSERVED") : "OPENED", actor, input.reason || null);
      if (!current) opened += 1;
      else updated += 1;
      changes.push(normalizeIncident(next, "guardrail"));
    }

    if (autoResolve) {
      for (const current of guardrailAlerts) {
        const alertId = current.alert_id || current.id;
        if (activeIds.has(alertId)) continue;
        if (["resolved", "archived"].includes(normalizeLifecycle(current.lifecycle_status || current.status))) continue;
        const next = resolveGuardrailAlert(current, tick, actor);
        await this.persistence.setDocument(C.deskAlerts, alertId, next);
        await this.#appendIncidentEvent(next, "AUTO_RESOLVED", actor, input.reason || "Signal guardrail revenu dans les seuils");
        resolved += 1;
        changes.push(normalizeIncident(next, "guardrail"));
      }
    }

    if (opened || updated || resolved) invalidateListCache(this.persistence);
    let notifications = null;
    if (input.syncNotifications !== false) {
      notifications = await this.syncIncidentNotifications({
        autoClear: true,
        reason: input.reason || "Synchronisation locale des notifications après évaluation observabilité",
      }, actor).catch((error) => ({ ok: false, error: publicError(error) }));
    }

    return contract("DeskObservabilityIncidentSync", {
      generatedAt: tick.utc,
      policy,
      evaluatedSignals: signals.length,
      opened,
      updated,
      unchanged,
      resolved,
      active: activeIds.size,
      incidents: changes.sort(byUpdatedDesc),
      notifications,
    });
  }

  async getPerformanceOverview(filters = {}) {
    const [stats, daily, trades, persistedEquity, replayPositions, runs] = await Promise.all([
      list(this.persistence, C.deskStrategyStats),
      list(this.persistence, C.deskStrategyDailyPerformance),
      list(this.persistence, C.deskStrategyTrades),
      list(this.persistence, C.deskStrategyEquityCurve),
      list(this.persistence, C.deskReplayPositions),
      this.listReplays({ limit: 1000, versionScope: "current" }),
    ]);
    const v4Daily = daily.filter(isAutopilotV4Record);
    const aggregateRunIds = new Set(runs.items
      .filter((item) => item.engineVersion !== "legacy" && item.resultEligible)
      .map((item) => item.sourceId));
    const v4Trades = dedupePerformanceTrades([
      ...trades.filter(isAutopilotV4Record),
      ...replayPositions
        .filter((item) => aggregateRunIds.has(item.backtest_id || item.run_id || item.replay_run_id))
        .filter(isReplayPositionPerformanceEligible)
        .map(replayPositionPerformanceTrade),
    ]);
    const v4Equity = persistedEquity.filter(isAutopilotV4Record);
    const filteredDaily = v4Daily.filter((item) => performanceMatches(item, filters));
    const filteredTrades = v4Trades.filter((item) => performanceMatches(item, filters));
    const filteredEquity = v4Equity.filter((item) => performanceMatches(item, filters));
    const dailySeries = buildDailyPerformanceSeries(filteredTrades, filteredDaily);
    const equity = buildPerformanceEquity(filteredTrades, filteredEquity, dailySeries);
    const totals = performanceTotals(filteredDaily, filteredTrades, equity, dailySeries);
    const relatedRuns = runs.items.filter((item) => performanceMatches(item, filters));
    const attribution = buildPerformanceAttribution(filteredTrades, dailySeries, relatedRuns);
    const dayDrilldowns = buildPerformanceDayDrilldowns(dailySeries, filteredTrades, equity, relatedRuns);
    return contract("DeskPerformanceOverview", {
      generatedAt: this.clock.now().utc,
      filters: normalizedFilters(filters),
      totals,
      risk: {
        maxDrawdownR: totals.maxDrawdownR,
        currentDrawdownR: totals.currentDrawdownR,
        profitFactor: totals.profitFactor,
        bestTradeR: totals.bestTradeR,
        worstTradeR: totals.worstTradeR,
        bestDayR: totals.bestDayR,
        worstDayR: totals.worstDayR,
      },
      facets: buildPerformanceFacets(v4Trades, v4Daily, runs.items),
      stats: stats.filter(isAutopilotV4Record).filter((item) => !filters.strategyId || (item.strategy_id || item.strategyId) === filters.strategyId),
      daily: filteredDaily.sort((a, b) => String(b.date || b.trading_date).localeCompare(String(a.date || a.trading_date))),
      dailySeries,
      equity,
      relatedRuns,
      replayDays: runs.days.filter((item) => dateMatches(item.date, filters)),
      breakdowns: buildBreakdowns(filteredTrades, dailySeries),
      attribution,
      dayDrilldowns,
    });
  }

  async compareReplays(ids = []) {
    return this.replayComparison.compare(ids);
  }

  async listIncidents(filters = {}) {
    const nowMs = this.clock.now().epochMs;
    const [alerts, errors, quality, events] = await Promise.all([
      list(this.persistence, C.deskAlerts),
      list(this.persistence, C.deskErrors),
      list(this.persistence, C.deskDataQualityAudits),
      list(this.persistence, C.deskAlertEvents),
    ]);
    const eventsByAlert = groupBy(events, (event) => event.alert_id || event.incident_id || "");
    const items = [
      ...operationalRecords(alerts, filters).map((item) => normalizeIncident(item, isGuardrailAlert(item) ? "guardrail" : "alert", eventsByAlert.get(item.alert_id || item.id) || [], nowMs)),
      ...operationalRecords(errors, filters).map((item) => normalizeIncident(item, "error", [], nowMs)),
      ...operationalRecords(quality, filters).filter((item) => isQualityIncident(item)).map((item) => normalizeIncident(item, "data_quality", [], nowMs)),
    ]
      .filter((item) => !filters.kind || item.kind === filters.kind)
      .filter((item) => !filters.status || item.lifecycleStatus === filters.status)
      .filter((item) => !filters.session || item.session === filters.session)
      .filter((item) => !filters.runId || item.runId === filters.runId)
      .filter((item) => !filters.process || item.processId === filters.process || item.targetId === filters.process)
      .filter((item) => !filters.workflow || item.workflow === filters.workflow || item.runId === filters.workflow || (item.runId && `replay:${item.runId}` === filters.workflow))
      .filter((item) => !filters.target || item.targetId === filters.target || item.processId === filters.target || item.runId === filters.target)
      .filter((item) => dateMatches(item.tradingDate, filters))
      .filter((item) => !filters.q || incidentSearchText(item).includes(String(filters.q).toLowerCase()))
      .sort(byUpdatedDesc)
      .slice(0, bounded(filters.limit, 200, 1000));
    const openItems = items.filter((item) => !["resolved", "archived"].includes(item.lifecycleStatus));
    return contract("DeskIncidentList", {
      generatedAt: this.clock.now().utc,
      filters: normalizedFilters(filters),
      count: items.length,
      summary: {
        open: openItems.length,
        critical: openItems.filter((item) => item.severity === "critical").length,
        warning: openItems.filter((item) => item.severity === "warning").length,
        acknowledged: items.filter((item) => item.lifecycleStatus === "acknowledged").length,
        snoozed: items.filter((item) => item.lifecycleStatus === "snoozed").length,
        resolved: items.filter((item) => item.lifecycleStatus === "resolved").length,
        guardrails: items.filter((item) => item.kind === "guardrail").length,
        unowned: openItems.filter((item) => !item.owner).length,
        slaBreached: openItems.filter((item) => item.sla?.breached).length,
        page: openItems.filter((item) => item.triage?.queue === "page").length,
        action: openItems.filter((item) => item.triage?.queue === "action").length,
      },
      triage: buildIncidentTriageOverview(items),
      items,
    });
  }

  async executeIncidentAction(incidentId, input = {}, actor = {}) {
    validateCommandInput(input);
    const all = await this.listIncidents({ limit: 1000 });
    const incident = all.items.find((item) => item.id === incidentId || item.sourceId === incidentId);
    if (!incident) throw notFound("INCIDENT_NOT_FOUND", `Incident introuvable : ${incidentId}`);
    const action = String(input.action || "").toLowerCase();
    const replayed = await this.#replayCommand("incident", incident.id, action, input);
    if (replayed) return contract("DeskOperationsCommandResult", replayed);
    if (Number(input.expectedRevision) !== Number(incident.revision)) throw conflict("REVISION_CONFLICT", "L’incident a changé.");
    if (!["acknowledge", "assign", "snooze", "resolve", "reopen"].includes(action)) throw invalid("INVALID_INCIDENT_ACTION", "Action incident invalide.");
    const command = await this.#beginCommand("incident", incident.id, action, input, actor);
    if (command.replayed) return contract("DeskOperationsCommandResult", command.result);
    try {
      const collection = incident.sourceCollection;
      const current = await this.persistence.getDocument(collection, incident.sourceId);
      if (Number(current.revision || 0) !== Number(input.expectedRevision)) throw conflict("REVISION_CONFLICT", "L’incident a changé avant l’écriture.");
      const tick = this.clock.now();
      const owner = input.owner || actor.email || actor.uid || actor.kind || current.owner || null;
      const lifecycle = action === "acknowledge" ? "acknowledged"
        : action === "assign" ? normalizeLifecycle(current.lifecycle_status || current.incident_status || current.status)
          : action === "snooze" ? "snoozed"
            : action === "resolve" ? "resolved"
              : "open";
      const updated = {
        ...current,
        lifecycle_status: lifecycle,
        status: lifecycle === "resolved" ? "RESOLVED" : current.status,
        owner: ["acknowledge", "assign"].includes(action) ? owner : current.owner || null,
        acknowledged_by: action === "acknowledge" ? normalizeActor(actor) : current.acknowledged_by || null,
        acknowledged_at_utc: action === "acknowledge" ? tick.utc : current.acknowledged_at_utc || null,
        assigned_by: action === "assign" ? normalizeActor(actor) : current.assigned_by || null,
        assigned_at_utc: action === "assign" ? tick.utc : current.assigned_at_utc || null,
        resolved_by: action === "resolve" ? normalizeActor(actor) : current.resolved_by || null,
        resolved_at_utc: action === "resolve" ? tick.utc : action === "reopen" ? null : current.resolved_at_utc || null,
        revision: Number(current.revision || 0) + 1,
        snoozed_until_utc: action === "snooze" ? input.snoozedUntilUtc || new Date(tick.epochMs + 60 * 60 * 1000).toISOString() : current.snoozed_until_utc || null,
        updated_at_utc: tick.utc,
        updated_at_paris: tick.paris,
      };
      await this.persistence.setDocument(collection, incident.sourceId, updated);
      await this.#appendIncidentEvent(updated, action.toUpperCase(), actor, input.reason);
      await this.syncIncidentNotifications({ autoClear: true, reason: input.reason || `Action incident ${action}` }, actor).catch(() => undefined);
      const payload = { ok: true, idempotent: false, commandId: command.commandId, action, incident: normalizeIncident(updated, incident.kind, [], tick.epochMs) };
      await this.#completeCommand(command, payload, actor, input.reason);
      return contract("DeskOperationsCommandResult", payload);
    } catch (error) {
      await this.#failCommand(command, error, actor, input.reason);
      throw error;
    }
  }

  async syncIncidentNotifications(input = {}, actor = {}) {
    const autoClear = input.autoClear !== false;
    const tick = this.clock.now();
    const [incidents, existing] = await Promise.all([
      this.listIncidents({ limit: bounded(input.limit || 1000, 200, 1000) }),
      list(this.persistence, C.deskNotificationOutbox),
    ]);
    const existingById = new Map(existing.map((item) => [item.notification_id || item.id, item]));
    const incidentsById = new Map(incidents.items.map((item) => [item.id, item]));
    const changes = [];
    let opened = 0;
    let updated = 0;
    let unchanged = 0;
    let cleared = 0;

    for (const incident of incidents.items) {
      if (["resolved", "archived"].includes(incident.lifecycleStatus)) continue;
      const notificationId = incidentNotificationId(incident);
      const current = existingById.get(notificationId) || null;
      const next = notificationFromIncident(incident, current, tick, actor);
      if (notificationEquivalent(current, next)) {
        unchanged += 1;
        continue;
      }
      await this.persistence.setDocument(C.deskNotificationOutbox, notificationId, next);
      if (current) updated += 1;
      else opened += 1;
      changes.push(normalizeNotification(next));
    }

    if (autoClear) {
      for (const current of existing.filter((item) => item.source === NOTIFICATION_SOURCE)) {
        const notificationId = current.notification_id || current.id;
        const incident = incidentsById.get(current.incident_id);
        const shouldClear = !incident || ["resolved", "archived"].includes(incident.lifecycleStatus);
        if (!shouldClear || normalizeNotificationStatus(current.status) === "cleared") continue;
        const next = clearNotification(current, tick, actor, input.reason || "Incident résolu ou absent de la vue active");
        await this.persistence.setDocument(C.deskNotificationOutbox, notificationId, next);
        cleared += 1;
        changes.push(normalizeNotification(next));
      }
    }

    if (opened || updated || cleared) invalidateListCache(this.persistence);
    const active = (await this.listNotifications({ status: "active", limit: 1000 })).items;
    return contract("DeskNotificationSync", {
      generatedAt: tick.utc,
      evaluatedIncidents: incidents.items.length,
      opened,
      updated,
      unchanged,
      cleared,
      active: active.length,
      notifications: changes.sort(byUpdatedDesc),
    });
  }

  async listNotifications(filters = {}) {
    const items = (await list(this.persistence, C.deskNotificationOutbox))
      .map(normalizeNotification)
      .filter((item) => notificationMatches(item, filters))
      .sort(byNotificationPriority)
      .slice(0, bounded(filters.limit, 200, 1000));
    const activeItems = items.filter((item) => !["dismissed", "cleared"].includes(item.status));
    return contract("DeskNotificationList", {
      generatedAt: this.clock.now().utc,
      filters: normalizedFilters(filters),
      count: items.length,
      summary: {
        active: activeItems.length,
        pending: items.filter((item) => item.status === "pending").length,
        read: items.filter((item) => item.status === "read").length,
        dismissed: items.filter((item) => item.status === "dismissed").length,
        cleared: items.filter((item) => item.status === "cleared").length,
        page: activeItems.filter((item) => item.escalationLevel === "page").length,
        action: activeItems.filter((item) => item.escalationLevel === "action").length,
        watch: activeItems.filter((item) => item.escalationLevel === "watch").length,
        muted: activeItems.filter((item) => item.escalationLevel === "muted").length,
      },
      items,
    });
  }

  async executeNotificationAction(notificationId, input = {}, actor = {}) {
    validateCommandInput(input);
    const action = String(input.action || "").toLowerCase();
    if (!["mark_read", "dismiss"].includes(action)) throw invalid("INVALID_NOTIFICATION_ACTION", "Action notification invalide.");
    const all = await this.listNotifications({ limit: 1000 });
    const notification = all.items.find((item) => item.id === notificationId || item.sourceId === notificationId);
    if (!notification) throw notFound("NOTIFICATION_NOT_FOUND", `Notification introuvable : ${notificationId}`);
    const replayed = await this.#replayCommand("notification", notification.id, action, input);
    if (replayed) return contract("DeskOperationsCommandResult", replayed);
    if (Number(input.expectedRevision) !== Number(notification.revision)) throw conflict("REVISION_CONFLICT", "La notification a changé.");
    const command = await this.#beginCommand("notification", notification.id, action, input, actor);
    if (command.replayed) return contract("DeskOperationsCommandResult", command.result);
    try {
      const current = await this.persistence.getDocument(C.deskNotificationOutbox, notification.sourceId);
      if (Number(current.revision || 0) !== Number(input.expectedRevision)) throw conflict("REVISION_CONFLICT", "La notification a changé avant l’écriture.");
      const tick = this.clock.now();
      const nextStatus = action === "mark_read" ? "read" : "dismissed";
      const updated = {
        ...current,
        status: nextStatus,
        read_at_utc: action === "mark_read" ? tick.utc : current.read_at_utc || null,
        read_by: action === "mark_read" ? normalizeActor(actor) : current.read_by || null,
        dismissed_at_utc: action === "dismiss" ? tick.utc : current.dismissed_at_utc || null,
        dismissed_by: action === "dismiss" ? normalizeActor(actor) : current.dismissed_by || null,
        revision: Number(current.revision || 0) + 1,
        updated_at_utc: tick.utc,
        updated_at_paris: tick.paris,
        updated_by: normalizeActor(actor),
        timeline: appendNotificationTimeline(current.timeline, {
          type: action === "mark_read" ? "MARKED_READ" : "DISMISSED",
          at: tick.utc,
          title: action === "mark_read" ? "Notification lue" : "Notification masquée",
          message: input.reason,
          severity: "info",
          actor: normalizeActor(actor),
        }),
      };
      await this.persistence.setDocument(C.deskNotificationOutbox, notification.sourceId, updated);
      const payload = { ok: true, idempotent: false, commandId: command.commandId, action, notification: normalizeNotification(updated) };
      await this.#completeCommand(command, payload, actor, input.reason);
      return contract("DeskOperationsCommandResult", payload);
    } catch (error) {
      await this.#failCommand(command, error, actor, input.reason);
      throw error;
    }
  }

  async listRunbooks(filters = {}) {
    const [workflows, incidents, notifications, gpt] = await Promise.all([
      this.listWorkflows({ limit: 1000 }),
      this.listIncidents({ limit: 1000 }),
      this.listNotifications({ limit: 1000 }),
      this.listGptProcesses({ limit: 1000 }),
    ]);
    const incidentById = new Map(incidents.items.map((item) => [item.id, item]));
    const workflowById = new Map(workflows.items.flatMap((item) => [[item.id, item], [item.sourceId, item]]));
    const gptById = new Map(gpt.items.map((item) => [item.id, item]));
    const activeNotifications = notifications.items.filter((item) => !["dismissed", "cleared"].includes(item.status));
    const runbooks = [
      ...activeNotifications.map((notification) => runbookFromNotification(notification, incidentById, workflowById, gptById)),
      ...incidents.items
        .filter((incident) => !["resolved", "archived"].includes(incident.lifecycleStatus))
        .filter((incident) => !activeNotifications.some((notification) => notification.incidentId === incident.id))
        .map((incident) => runbookFromIncident(incident, workflowById, gptById)),
      ...workflows.items
        .filter((workflow) => ["blocked", "failed", "waiting_gpt"].includes(workflow.status))
        .map((workflow) => runbookFromWorkflow(workflow, incidents.items, notifications.items, gpt.items)),
    ].filter(Boolean);
    const deduped = [...new Map(runbooks.map((item) => [item.id, item])).values()]
      .filter((item) => runbookMatches(item, filters))
      .sort(byRunbookPriority)
      .slice(0, bounded(filters.limit, 200, 1000));
    return contract("DeskRunbookList", {
      generatedAt: this.clock.now().utc,
      filters: normalizedFilters(filters),
      count: deduped.length,
      summary: runbookSummary(deduped),
      items: deduped,
    });
  }

  async getRunbook(runbookId) {
    const listResult = await this.listRunbooks({ limit: 1000 });
    const runbook = listResult.items.find((item) => item.id === runbookId || item.sourceId === runbookId);
    if (!runbook) throw notFound("RUNBOOK_NOT_FOUND", `Runbook introuvable : ${runbookId}`);
    return contract("DeskRunbookDetail", {
      generatedAt: this.clock.now().utc,
      runbook,
      related: {
        incidentId: runbook.incidentId,
        notificationId: runbook.notificationId,
        workflowId: runbook.workflowId,
        processId: runbook.processId,
      },
    });
  }

  async getHistory(filters = {}) {
    const [allWorkflows, incidents, audits, performance] = await Promise.all([
      this.listWorkflows({ limit: 1000, includeHistory: true }),
      this.listIncidents({ session: filters.session, date: filters.date, from: filters.from, to: filters.to, limit: 1000, includeHistory: true }),
      list(this.persistence, C.deskAuditLogs),
      this.getPerformanceOverview(filters),
    ]);
    const workflowItems = allWorkflows.items.filter((item) => workflowMatches(item, filters));
    const replayIds = new Set(workflowItems.map((item) => item.sourceId));
    const historyIncidents = incidents.items.filter((item) => !item.runId || replayIds.has(item.runId));
    const sessions = buildHistorySessions(workflowItems, historyIncidents, performance.dailySeries);
    const counts = countBy(workflowItems, (item) => item.status);
    const dates = allWorkflows.items.map((item) => item.tradingDate).filter(Boolean).sort();
    const filteredAudit = audits
      .filter((item) => isAutopilotV4Record(item) || replayIds.has(item.backtest_id || item.replay_run_id || item.run_id))
      .filter((item) => dateMatches(historyAuditDate(item), filters))
      .filter((item) => !filters.session || !item.session || item.session === filters.session)
      .sort(byUpdatedDesc);
    const governance = buildHistoryGovernance(workflowItems, sessions, historyIncidents, filteredAudit);
    return contract("DeskHistory", {
      generatedAt: this.clock.now().utc,
      filters: normalizedFilters(filters),
      summary: {
        sessions: sessions.length,
        workflows: workflowItems.length,
        running: counts.running || 0,
        waitingGpt: counts.waiting_gpt || 0,
        blocked: counts.blocked || 0,
        failed: counts.failed || 0,
        completed: counts.completed || 0,
        openIncidents: historyIncidents.filter((item) => !["resolved", "archived"].includes(item.lifecycleStatus)).length,
        totalR: roundPerformance(sum(workflowItems.map((item) => item.metrics?.totalR))),
        gptProcesses: sum(workflowItems.map((item) => item.metrics?.gptProcesses)),
        activeDays: uniqueValues(workflowItems.map((item) => item.tradingDate)).length,
        strategies: uniqueValues(workflowItems.map((item) => item.strategyId)).length,
      },
      facets: {
        statuses: uniqueValues(allWorkflows.items.map((item) => item.status)),
        sessions: uniqueValues(allWorkflows.items.map((item) => item.session)),
        kinds: uniqueValues(allWorkflows.items.map((item) => item.kind)),
        strategies: uniqueValues(allWorkflows.items.map((item) => item.strategyId)),
        dateRange: { from: dates[0] || null, to: dates.at(-1) || null },
      },
      sessions,
      incidents: historyIncidents,
      audit: filteredAudit,
      governance,
      performance,
    });
  }

  async getHistorySession(sessionId) {
    const history = await this.getHistory();
    const session = history.sessions.find((item) => item.id === sessionId);
    if (!session) throw notFound("HISTORY_SESSION_NOT_FOUND", `Session historique introuvable : ${sessionId}`);
    const workflowIds = new Set(session.workflows.flatMap((item) => [item.id, item.sourceId]));
    const [workflowEvents, workflowGpt, dayPerformance] = await Promise.all([
      Promise.all(session.workflows.map(async (workflow) => ({
        workflow,
        events: await this.getWorkflowEvents(workflow),
      }))),
      Promise.all(session.workflows.map((workflow) => (
        this.listGptProcesses({ runId: workflow.sourceId, limit: 1000 }).catch(() => ({ items: [] }))
      ))),
      this.getPerformanceOverview({
        date: session.tradingDate,
        session: session.session,
        limit: 1000,
      }),
    ]);
    const gptProcesses = workflowGpt
      .flatMap((item) => item.items || [])
      .filter((item) => item.runId && workflowIds.has(item.runId));
    const timeline = workflowEvents
      .flatMap(({ workflow, events }) => events.map((event) => ({
        ...event,
        workflowId: workflow.id,
        workflowName: workflow.name,
        runId: event.runId || (workflow.kind === "replay" ? workflow.sourceId : null),
      })))
      .sort(byTimeAsc);
    const incidents = history.incidents.filter((item) => (
      item.tradingDate === session.tradingDate
      && (!item.session || item.session === session.session)
    ));
    const counts = countBy(session.workflows, (item) => item.status);
    const matrix = {
      statuses: buildHistoryMatrix(session.workflows, incidents, (item) => item.status, (label) => `/history/sessions/${encodeURIComponent(session.id)}?status=${encodeURIComponent(label)}`),
      kinds: buildHistoryMatrix(session.workflows, incidents, (item) => item.kind, (label) => `/history/sessions/${encodeURIComponent(session.id)}?kind=${encodeURIComponent(label)}`),
      gptStatuses: buildGptHistoryMatrix(gptProcesses),
      eventLayers: buildEventHistoryMatrix(timeline),
      incidentLifecycle: buildIncidentHistoryMatrix(incidents),
    };
    const decisionFlow = buildHistoryDecisionFlow(timeline, gptProcesses);
    const auditTrail = buildHistoryAuditTrail(history.audit, session.workflows, incidents).slice(0, 20);
    return contract("DeskHistorySessionDetail", {
      generatedAt: this.clock.now().utc,
      session,
      summary: {
        workflows: session.workflowCount,
        running: counts.running || 0,
        waitingGpt: counts.waiting_gpt || 0,
        blocked: counts.blocked || 0,
        failed: counts.failed || 0,
        completed: counts.completed || 0,
        progress: session.progress,
        totalR: session.totalR,
        gptProcesses: gptProcesses.length,
        incidents: incidents.length,
        events: timeline.length,
        strategies: session.strategies.length,
      },
      workflows: session.workflows,
      gptProcesses,
      incidents,
      timeline,
      matrix,
      decisionFlow,
      auditTrail,
      links: buildHistorySessionLinks(session, gptProcesses),
      performance: dayPerformance,
    });
  }

  async listStrategies() {
    const [catalog, configs, runtime, versions, contracts, stats, daily, trades, equity, replayRuns, replayPositions] = await Promise.all([
      list(this.persistence, C.strategyCatalog),
      list(this.persistence, C.strategyConfigs),
      list(this.persistence, C.strategyRuntimeState),
      list(this.persistence, C.deskStrategyVersions),
      list(this.persistence, C.deskContracts),
      list(this.persistence, C.deskStrategyStats),
      list(this.persistence, C.deskStrategyDailyPerformance),
      list(this.persistence, C.deskStrategyTrades),
      list(this.persistence, C.deskStrategyEquityCurve),
      list(this.persistence, C.deskReplayRuns),
      list(this.persistence, C.deskReplayPositions),
    ]);
    const v4Runs = replayLabRecords(replayRuns);
    const aggregateRunIds = new Set(applyReplayResultSelection(
      v4Runs.map((run) => normalizeReplayWorkflow(run, [], [], replayPositions.filter((item) =>
        (item.backtest_id || item.run_id || item.replay_run_id) === run.backtest_id))),
    ).filter((item) => item.resultEligible).map((item) => item.sourceId));
    const v4Daily = daily.filter(isAutopilotV4Record);
    const v4Trades = dedupePerformanceTrades([
      ...trades.filter(isAutopilotV4Record),
      ...replayPositions
        .filter(isAutopilotV4Record)
        .filter((item) => aggregateRunIds.has(item.backtest_id || item.run_id || item.replay_run_id))
        .filter(isReplayPositionPerformanceEligible)
        .map(replayPositionPerformanceTrade),
    ]);
    const v4Equity = equity.filter(isAutopilotV4Record);
    const v4Stats = stats.filter(isAutopilotV4Record);
    const v4Versions = versions.filter(isAutopilotV4Record);
    const ids = new Set([...v4Stats, ...v4Daily, ...v4Trades, ...v4Equity, ...v4Runs].map((item) => item.strategy_id).filter(Boolean));
    if (!ids.size) ids.add("asia_open");
    const items = [...ids].sort().map((id) => {
      const strategyDaily = v4Daily.filter((item) => item.strategy_id === id);
      const strategyTrades = v4Trades.filter((item) => item.strategy_id === id);
      const strategyDailySeries = buildDailyPerformanceSeries(strategyTrades, strategyDaily);
      const strategyEquity = buildPerformanceEquity(strategyTrades, v4Equity.filter((item) => item.strategy_id === id), strategyDailySeries);
      return {
        id,
        catalog: catalog.find((item) => item.strategy_id === id && isAutopilotV4Record(item)) || null,
        config: configs.find((item) => item.strategy_id === id && isAutopilotV4Record(item)) || null,
        runtime: runtime.find((item) => item.strategy_id === id && isAutopilotV4Record(item)) || null,
        stats: v4Stats.find((item) => item.strategy_id === id) || null,
        performance: performanceTotals(strategyDaily, strategyTrades, strategyEquity, strategyDailySeries),
        replayCount: v4Runs.filter((item) => item.strategy_id === id).length,
        versions: v4Versions.filter((item) => item.strategy_id === id).sort(byVersionDesc),
        activeContracts: contracts.filter((item) => !item.strategy_id || item.strategy_id === id).map((item) => ({ name: item.contract_name || item.name, version: item.version, status: item.status })),
      };
    });
    return contract("DeskStrategyList", { count: items.length, items });
  }

  async compareStrategyVersions(strategyId, left, right) {
    const strategies = await this.listStrategies();
    const strategy = strategies.items.find((item) => item.id === strategyId);
    if (!strategy) throw notFound("STRATEGY_NOT_FOUND", `Stratégie introuvable : ${strategyId}`);
    const leftVersion = strategy.versions.find((item) => item.version_id === left || item.version === left) || strategy.config;
    const rightVersion = strategy.versions.find((item) => item.version_id === right || item.version === right) || strategy.runtime;
    return contract("DeskStrategyVersionComparison", {
      strategyId,
      left: leftVersion || null,
      right: rightVersion || null,
      changes: structuralDiff(leftVersion || {}, rightVersion || {}),
    });
  }

  async #patchReplayRun(workflow, patch) {
    const run = await this.persistence.getDocument(C.deskReplayRuns, workflow.sourceId);
    if (Number(run.revision || 0) !== Number(workflow.revision)) throw conflict("REVISION_CONFLICT", "Le replay a changé.");
    const tick = this.clock.now();
    const updated = { ...run, ...patch, revision: Number(run.revision || 0) + 1, updated_at: tick.utc, updated_at_utc: tick.utc, updated_at_paris: tick.paris };
    await this.persistence.setDocument(C.deskReplayRuns, workflow.sourceId, updated);
    invalidateListCache(this.persistence);
    return { ok: true, backtest_id: workflow.sourceId, status: updated.status, revision: updated.revision };
  }

  async #beginCommand(targetType, targetId, action, input, actor) {
    const commandId = commandDocumentId(targetType, targetId, input.idempotencyKey);
    const hash = commandRequestHash(targetType, targetId, action, input);
    const existing = await this.persistence.getDocument(C.deskOperationsCommands, commandId).catch(() => null);
    if (existing) {
      if (existing.request_hash !== hash) throw conflict("IDEMPOTENCY_CONFLICT", "Cette clé d’idempotence correspond à une autre commande.");
      if (existing.status !== "APPLIED" || !existing.result) throw conflict("COMMAND_INCOMPLETE", "La commande précédente n’est pas terminée et requiert une vérification opérateur.");
      return { replayed: true, commandId, result: { ...(existing.result || {}), idempotent: true } };
    }
    const tick = this.clock.now();
    await this.persistence.createDocument(C.deskOperationsCommands, commandId, {
      command_id: commandId,
      target_type: targetType,
      target_id: targetId,
      action,
      status: "PENDING",
      expected_revision: input.expectedRevision,
      idempotency_key: input.idempotencyKey,
      request_hash: hash,
      actor: normalizeActor(actor),
      reason: input.reason,
      created_at_utc: tick.utc,
      updated_at_utc: tick.utc,
    }).catch(async (error) => {
      if (error.code !== "DOCUMENT_ALREADY_EXISTS") throw error;
      const raced = await this.persistence.getDocument(C.deskOperationsCommands, commandId);
      if (raced.request_hash !== hash) throw conflict("IDEMPOTENCY_CONFLICT", "Conflit d’idempotence.");
    });
    return { replayed: false, commandId, requestHash: hash };
  }

  async #replayCommand(targetType, targetId, action, input) {
    const commandId = commandDocumentId(targetType, targetId, input.idempotencyKey);
    const hash = commandRequestHash(targetType, targetId, action, input);
    const existing = await this.persistence.getDocument(C.deskOperationsCommands, commandId).catch(() => null);
    if (!existing) return null;
    if (existing.request_hash !== hash) throw conflict("IDEMPOTENCY_CONFLICT", "Cette clé d’idempotence correspond à une autre commande.");
    if (existing.status !== "APPLIED" || !existing.result) throw conflict("COMMAND_INCOMPLETE", "La commande précédente n’est pas terminée et requiert une vérification opérateur.");
    return { ...(existing.result || {}), idempotent: true };
  }

  async #completeCommand(command, result, actor, reason) {
    const tick = this.clock.now();
    await this.persistence.setDocument(C.deskOperationsCommands, command.commandId, { status: "APPLIED", result, updated_at_utc: tick.utc }, { merge: true });
    const eventId = `${command.commandId}__${randomUUID()}`;
    await this.persistence.setDocument(C.deskOperationsEvents, eventId, {
      event_id: eventId,
      command_id: command.commandId,
      event_type: "APPLIED",
      actor: normalizeActor(actor),
      reason,
      result,
      created_at_utc: tick.utc,
      created_at_paris: tick.paris,
    });
    invalidateListCache(this.persistence);
  }

  async #failCommand(command, error, actor, reason) {
    const tick = this.clock.now();
    const failure = publicError(error) || { message: "Operations command failed." };
    await this.persistence.setDocument(C.deskOperationsCommands, command.commandId, {
      status: "FAILED",
      error: failure,
      updated_at_utc: tick.utc,
    }, { merge: true }).catch(() => undefined);
    const eventId = `${command.commandId}__failed__${randomUUID()}`;
    await this.persistence.setDocument(C.deskOperationsEvents, eventId, {
      event_id: eventId,
      command_id: command.commandId,
      event_type: "FAILED",
      actor: normalizeActor(actor),
      reason,
      error: failure,
      created_at_utc: tick.utc,
      created_at_paris: tick.paris,
    }).catch(() => undefined);
    invalidateListCache(this.persistence);
  }

  async #appendIncidentEvent(incident, eventType, actor, reason) {
    const tick = this.clock.now();
    const sourceId = incident.alert_id || incident.error_id || incident.audit_id || incident.id || "incident";
    const kind = isGuardrailAlert(incident) ? "guardrail" : incident.error_id ? "error" : incident.audit_id ? "data_quality" : "alert";
    const eventId = `incident_event_${hashObject({ sourceId, eventType, at: tick.utc, nonce: randomUUID() }).slice(0, 28)}`;
    await this.persistence.setDocument(C.deskAlertEvents, eventId, {
      event_id: eventId,
      alert_id: incident.alert_id || null,
      source_id: sourceId,
      incident_id: `${kind}:${sourceId}`,
      event_type: eventType,
      lifecycle_status: incident.lifecycle_status || incident.status || null,
      severity: incident.severity || null,
      actor: normalizeActor(actor),
      reason: reason || null,
      evidence: incident.evidence || null,
      created_at_utc: tick.utc,
      created_at_paris: tick.paris,
    }).catch(() => undefined);
    invalidateListCache(this.persistence);
  }
}

function normalizeReplayWorkflow(run = {}, workItems = [], errors = [], positions = []) {
  const completed = Number(run.steps_done || workItems.filter((item) => item.status === "COMPLETED").length || 0);
  const total = Number(run.steps_total || workItems.length || 0);
  const positionPerformance = replayPositionPerformanceSummary(positions);
  const totalR = firstNumber(run.summary?.total_R, run.summary?.total_r, run.total_R) ?? positionPerformance.totalR;
  const masterContract = run.pinned_contracts?.master_contract || run.contract_context?.master_contract || {};
  const v4 = isAutopilotV4ReplayRun(run);
  const v4Certified = isCertifiedAutopilotV4ReplayRun(run);
  const strategyMajor = replayStrategyMajor(run);
  const currentWorkItem = workItems.find((item) => item.work_item_id === run.current_work_item_id) || null;
  const failedWorkItem = currentWorkItem?.status === "FAILED"
    ? currentWorkItem
    : [...workItems]
      .filter((item) => item.status === "FAILED")
      .sort((left, right) => String(eventTime(right) || "").localeCompare(String(eventTime(left) || "")))[0] || null;
  const backendRawStatus = run.status || null;
  const projectedRawStatus = failedWorkItem && (
    WAITING_GPT.has(String(run.status || "").toUpperCase())
    || String(run.status || "").toUpperCase().includes("WAITING_GPT")
  )
    ? "WORK_FAILED_REQUIRES_OPERATOR"
    : run.status;
  const normalizedStatus = normalizeStatus(projectedRawStatus);
  const processProgress = progressValue(run.progress, completed, total);
  const timelineProgress = replayTimelineProgress(run, normalizedStatus, processProgress);
  return workflowBase({
    id: `replay:${run.backtest_id || run.replay_run_id || run.run_id}`,
    sourceId: run.backtest_id || run.replay_run_id || run.run_id,
    kind: "replay",
    name: run.name || `Replay · ${run.session || run.strategy_id || "Desk"}`,
    status: projectedRawStatus,
    revision: run.revision,
    tradingDate: run.trading_date || run.date || run.date_from,
    session: run.session,
    strategyId: run.strategy_id,
    variantId: run.variant_id || `${run.strategy_id || "strategy"}:${run.cadence || run.monitor_cadence || "default"}`,
    updatedAt: eventTime(run),
    startedAt: run.started_at_utc || run.created_at_utc,
    completedAt: run.completed_at_utc,
    progress: timelineProgress,
    error: failedWorkItem?.last_error || run.last_automation_error || run.error || errors[0] || null,
    rawStatus: projectedRawStatus,
    metrics: {
      totalR,
      realizedR: positionPerformance.realizedR,
      unrealizedR: positionPerformance.unrealizedR,
      resultMode: positionPerformance.resultMode,
      stepsDone: completed,
      stepsTotal: total,
      processProgress,
      timelineProgress,
      gptProcesses: workItems.length,
      positions: positionPerformance.positions,
      pricedPositions: positionPerformance.pricedPositions,
      unpricedPositions: positionPerformance.unpricedPositions,
    },
    currentStepId: run.current_step_id || null,
    currentWorkItemId: run.current_work_item_id || null,
    nextAction: run.next_action || null,
    automationEnabled: run.automation_enabled === true,
    engineVersion: strategyMajor >= 5 ? "autopilot_v5" : v4 ? "autopilot_v4" : "legacy",
    replaySchemaVersion: run.replay_schema_version || null,
    masterContractId: masterContract.contract_id || null,
    masterContractVersion: masterContract.schema_version || null,
    v4Certified,
    replayClassification: v4Certified
      ? strategyMajor >= 5 ? "v5_certified" : "v4_certified"
      : v4
        ? strategyMajor >= 5 ? "v5_contractual" : "v4_contractual"
        : "legacy",
    resultEligibleCandidate: v4 && normalizedStatus === "completed",
    resultEligible: false,
    runScope: run.run_scope || "session",
    currentPhase: run.current_phase || run.session || null,
    executionId: run.execution_id || null,
    runFamilyId: run.run_family_id || null,
    runNumber: Number(run.run_number || 1),
    aggregateRole: run.aggregate_role || null,
    aggregateEligible: typeof run.aggregate_eligible === "boolean" ? run.aggregate_eligible : null,
    startTime: run.start_time || run.initial_cutoff || run.cutoff_paris || null,
    endTime: run.end_time || null,
    currentReplayTime: run.current_replay_time || run.cutoff_paris || null,
    backendRawStatus,
  });
}

function applyReplayResultSelection(items = []) {
  const selectedIds = new Set();
  for (const values of groupBy(items, (item) => item.tradingDate || "unknown").values()) {
    const selected = selectReplayDayPrimary(values);
    if (selected?.sourceId) selectedIds.add(selected.sourceId);
  }
  return items.map((item) => ({
    ...item,
    resultEligible: item.resultEligibleCandidate === true && selectedIds.has(item.sourceId),
    aggregateRole: selectedIds.has(item.sourceId) ? "primary" : item.aggregateRole || "comparison",
    aggregateEligible: selectedIds.has(item.sourceId),
    resultEligibilityReason: item.resultEligibleCandidate !== true
      ? "run_not_completed_v4"
      : selectedIds.has(item.sourceId)
        ? "selected_daily_primary"
        : "same_day_comparison",
  }));
}

function selectReplayDayPrimary(items = []) {
  const explicit = items.filter((item) => item.aggregateEligible === true || item.aggregateRole === "primary");
  const completed = items.filter((item) => item.resultEligibleCandidate === true);
  const activeExplicit = explicit.filter((item) => !["cancelled", "failed"].includes(item.status));
  const active = items.filter((item) => !["cancelled", "failed"].includes(item.status));
  const candidates = activeExplicit.length
    ? activeExplicit
    : completed.length
      ? completed
      : active.length
        ? active
        : explicit.length
          ? explicit
          : items;
  return [...candidates].sort((left, right) =>
    Number(right.aggregateEligible === true) - Number(left.aggregateEligible === true)
    || Number(right.aggregateRole === "primary") - Number(left.aggregateRole === "primary")
    || Number(right.runScope === "full_day") - Number(left.runScope === "full_day")
    || Number(left.runNumber || 1) - Number(right.runNumber || 1)
    || String(left.startedAt || "").localeCompare(String(right.startedAt || ""))
    || String(left.sourceId || "").localeCompare(String(right.sourceId || "")))[0] || null;
}

function workflowBase(value) {
  const status = normalizeStatus(value.status);
  return {
    id: value.id,
    sourceId: value.sourceId,
    kind: value.kind,
    name: value.name,
    status,
    rawStatus: value.rawStatus || value.status || "UNKNOWN",
    revision: Number(value.revision || 0),
    tradingDate: value.tradingDate || null,
    session: value.session || null,
    strategyId: value.strategyId || null,
    variantId: value.variantId || null,
    progress: status === "completed" ? 100 : value.progress,
    startedAt: value.startedAt || null,
    completedAt: value.completedAt || null,
    updatedAt: value.updatedAt || value.startedAt || null,
    durationMs: duration(value.startedAt, value.completedAt || value.updatedAt),
    error: publicError(value.error),
    metrics: value.metrics || {},
    currentStepId: value.currentStepId || null,
    currentWorkItemId: value.currentWorkItemId || null,
    nextAction: value.nextAction || null,
    automationEnabled: value.automationEnabled === true,
    engineVersion: value.engineVersion || "legacy",
    replaySchemaVersion: value.replaySchemaVersion || null,
    masterContractId: value.masterContractId || null,
    masterContractVersion: value.masterContractVersion || null,
    v4Certified: value.v4Certified === true,
    replayClassification: value.replayClassification || "legacy",
    resultEligibleCandidate: value.resultEligibleCandidate === true,
    resultEligible: value.resultEligible === true,
    runScope: value.runScope || "session",
    currentPhase: value.currentPhase || null,
    executionId: value.executionId || null,
    runFamilyId: value.runFamilyId || null,
    runNumber: Number(value.runNumber || 1),
    aggregateRole: value.aggregateRole || null,
    aggregateEligible: value.aggregateEligible === true,
    resultEligibilityReason: value.resultEligibilityReason || null,
    startTime: value.startTime || null,
    endTime: value.endTime || null,
    currentReplayTime: value.currentReplayTime || null,
    backendRawStatus: value.backendRawStatus || value.rawStatus || null,
  };
}

function normalizeStep(step = {}) {
  return {
    id: step.step_id || step.id,
    sequence: Number(step.sequence || step.index || 0),
    type: step.step_type || step.task_type || step.job_type || "STEP",
    status: normalizeStatus(step.status),
    rawStatus: step.status || "UNKNOWN",
    at: eventTime(step),
    durationMs: duration(step.started_at_utc, step.completed_at_utc || eventTime(step)),
    inputRef: step.input_ref || step.bundle_ref || null,
    outputRef: step.output_ref || step.simulation_ref || null,
    error: publicError(step.error || step.last_error),
  };
}

function normalizeEvent(event = {}) {
  const type = event.event_type || event.action || event.phase || "EVENT";
  const runId = event.backtest_id || event.run_id || event.replay_run_id || null;
  const processId = event.work_item_id || event.process_id || null;
  const decision = event.monitor_decision?.decision || event.decision || event.action || null;
  return {
    id: event.event_id || event.audit_id || event.id || hashObject(event).slice(0, 20),
    type,
    status: normalizeStatus(event.status || event.event_type),
    at: eventTime(event),
    title: event.title || event.action || event.event_type || "Événement",
    detail: event.note || event.message || event.reason || "",
    actor: event.actor || event.performed_by || null,
    ref: event.ref || event.output_ref || null,
    layer: inferEventLayer(event, type),
    runId,
    workflowId: runId ? `replay:${runId}` : event.workflow_id || null,
    stepId: event.step_id || null,
    processId,
    decision,
    conclusion: event.conclusion || event.note || event.message || null,
    price: firstNumber(event.price, event.close, event.market_price),
    severity: event.severity || null,
  };
}

function inferEventLayer(event = {}, type = "") {
  const raw = `${type} ${event.workflow || ""} ${event.action || ""}`.toUpperCase();
  if (event.work_item_id || event.process_id || raw.includes("GPT") || raw.includes("WORK")) return "gpt";
  if (event.monitor_decision || event.decision || event.action || raw.includes("SAVED") || raw.includes("DECISION")) return "decision";
  if (event.step_id || raw.includes("STEP")) return "step";
  return "event";
}

function normalizeDecisionEvent(event, layer) {
  const normalized = normalizeEvent(event);
  return {
    ...normalized,
    layer,
    runId: event.backtest_id || event.run_id || null,
    workflowId: event.backtest_id ? `replay:${event.backtest_id}` : null,
    stepId: event.step_id || null,
    processId: event.work_item_id || null,
    decision: event.monitor_decision?.decision || event.decision || event.action || null,
    conclusion: event.conclusion || event.note || event.message || null,
    price: firstNumber(event.price, event.close, event.market_price),
    severity: event.severity || (normalized.status === "failed" ? "critical" : normalized.status === "blocked" ? "warning" : "info"),
    rawStatus: event.status || event.event_type || "UNKNOWN",
  };
}

function normalizeGptProcess(item, events, bundle, outputs, aiRun = null) {
  const output = outputs.find((entry) => entry.work_item_id === item.work_item_id || entry.step_id === item.step_id || entry.analysis_id === item.expected_output_id || entry.monitor_id === item.expected_output_id);
  const telemetry = observedTelemetry(item.gpt_telemetry, events);
  return {
    id: item.work_item_id,
    runId: item.backtest_id || item.run_id || null,
    stepId: item.step_id || null,
    workflow: item.workflow || item.task_type || "GPT",
    status: normalizeStatus(item.status),
    rawStatus: item.status || "UNKNOWN",
    revision: Number(item.revision || item.attempt_count || 0),
    attempt: Number(item.attempt_count || 0),
    maxAttempts: Number(item.max_attempts || 0),
    worker: item.worker_id || item.claimed_by || null,
    leaseExpiresAt: item.lease_expires_at_utc || null,
    createdAt: item.created_at_utc || null,
    startedAt: item.claimed_at_utc || item.started_at_utc || null,
    completedAt: item.completed_at_utc
      || item.failed_at_utc
      || item.last_error?.occurred_at_utc
      || (item.status === "FAILED" ? item.updated_at_utc : null)
      || output?.created_at_utc
      || null,
    updatedAt: eventTime(item),
    durationMs: duration(item.claimed_at_utc || item.created_at_utc, item.completed_at_utc || eventTime(item)),
    events: events.map(normalizeEvent).sort(byTimeAsc),
    conclusion: extractConclusion(output),
    decision: output?.monitor_decision?.decision || output?.decision || output?.action || null,
    error: publicError(item.last_error),
    telemetry,
    bundle: bundle ? { bundleId: bundle.bundle_id, manifest: bundle.manifest || bundle.section_manifest || null, dataQuality: bundle.data_quality || null } : null,
    ...projectAiRunResearch(aiRun),
  };
}

function normalizeGptTransport(process, item, saveTarget, manifest, prompt, nowMs) {
  const target = plainRecord(saveTarget);
  const nestedTarget = plainRecord(item?.input_ref?.save_target);
  const protectedSuggested = {
    ...plainRecord(nestedTarget.suggested_payload),
    ...plainRecord(target.suggested_payload),
  };
  const workItemId = stringOrNull(protectedSuggested.work_item_id) || stringOrNull(item?.work_item_id) || process.id || null;
  const workerId = stringOrNull(protectedSuggested.worker_id) || stringOrNull(item?.worker_id) || stringOrNull(item?.claimed_by) || process.worker || null;
  const leaseProtected = Boolean(
    stringOrNull(protectedSuggested.lease_token) || stringOrNull(item?.lease_token),
  );
  const suggested = redactProtectedFrontFields(protectedSuggested);
  return {
    saveTool: stringOrNull(target.tool) || stringOrNull(nestedTarget.tool) || stringOrNull(item?.save_tool) || null,
    suggestedPayload: Object.keys(suggested).length ? suggested : null,
    workItemId,
    workerId,
    leaseToken: null,
    leaseProtected,
    hasLeaseHandle: Boolean(workItemId && workerId && leaseProtected),
    lease: observedLease(process.leaseExpiresAt, process.status, nowMs),
    manifestAvailable: Boolean(manifest),
    saveTargetAvailable: Boolean(saveTarget),
    promptAvailable: Boolean(prompt),
  };
}

function redactProtectedFrontFields(value, protectedValues = []) {
  if (typeof value === "string") {
    return protectedValues.reduce(
      (result, secret) => secret ? result.replaceAll(secret, "[PROTECTED]") : result,
      value,
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactProtectedFrontFields(item, protectedValues));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => {
        const normalized = String(key).toLowerCase();
        return ![
          "lease_token",
          "receipt_signing_key",
          "database_url",
        ].includes(normalized) && !normalized.endsWith("_lease_token");
      })
      .map(([key, item]) => [
        key,
        redactProtectedFrontFields(item, protectedValues),
      ]),
  );
}

function findWorkflowForGptProcess(workflows = [], process = {}) {
  const runId = stringOrNull(process.runId);
  const processId = stringOrNull(process.id);
  return workflows.find((workflow) => {
    if (processId && workflow.currentWorkItemId === processId) return true;
    if (!runId) return false;
    return workflow.sourceId === runId || workflow.id === runId || workflow.id === `replay:${runId}`;
  }) || null;
}

function incidentMatchesGptProcess(incident = {}, process = {}, workflow = null) {
  const processIds = new Set([process.id, process.workItemId].filter(Boolean).map(String));
  const workflowIds = new Set([workflow?.id, workflow?.sourceId].filter(Boolean).map(String));
  const runIds = new Set([process.runId, workflow?.sourceId].filter(Boolean).map(String));
  if (incident.processId && processIds.has(String(incident.processId))) return true;
  if (incident.targetId && processIds.has(String(incident.targetId))) return true;
  if (incident.targetId && workflowIds.has(String(incident.targetId))) return true;
  if (incident.runId && runIds.has(String(incident.runId))) return true;
  return false;
}

function runbookMatchesGptProcess(runbook = {}, process = {}, workflow = null, incidents = []) {
  const incidentIds = new Set(incidents.map((incident) => incident.id).filter(Boolean));
  if (runbook.processId && process.id && runbook.processId === process.id) return true;
  if (runbook.runId && process.runId && runbook.runId === process.runId) return true;
  if (workflow && runbook.workflowId && runbook.workflowId === workflow.id) return true;
  if (runbook.incidentId && incidentIds.has(runbook.incidentId)) return true;
  return false;
}

function buildGptOperationsContext(process, transport, workflow, incidents = [], runbooks = []) {
  const allowedActions = workflow ? allowedWorkflowActions(workflow) : [];
  const recommended = workflow ? recommendedWorkflowAction(workflow, allowedActions) : null;
  const workflowCommand = workflow && recommended
    ? workflowActionDescriptor(recommended, workflow, allowedActions.includes(recommended))
    : null;
  const transportHealth = buildGptTransportHealth(process, transport);
  return {
    workflow,
    workflowCommand,
    incidents,
    runbooks,
    links: gptContextLinks(process, workflow, workflowCommand, incidents, runbooks),
    riskFlags: gptRiskFlags(process, transportHealth, workflow, incidents, runbooks),
    transportHealth,
  };
}

function buildGptTransportHealth(process = {}, transport = {}) {
  const terminal = ["completed", "cancelled"].includes(process.status);
  const blockedReasons = [];
  if (!terminal && !transport.hasLeaseHandle) blockedReasons.push("LEASE_HANDLE_INCOMPLET");
  if (!terminal && transport.lease?.state === "expired") blockedReasons.push("LEASE_EXPIRED");
  if (!transport.saveTargetAvailable) blockedReasons.push("SAVE_TARGET_ABSENT");
  if (!transport.promptAvailable) blockedReasons.push("PROMPT_ABSENT");
  if (!transport.manifestAvailable) blockedReasons.push("MANIFEST_ABSENT");
  if (["failed", "blocked"].includes(process.status)) blockedReasons.push(`PROCESS_${String(process.status).toUpperCase()}`);
  const saveReady = Boolean(transport.saveTargetAvailable);
  const canSave = !terminal
    && Boolean(transport.hasLeaseHandle)
    && saveReady
    && Boolean(transport.promptAvailable)
    && Boolean(transport.manifestAvailable)
    && !["expired", "none"].includes(transport.lease?.state);
  const state = terminal && process.conclusion ? "saved"
    : transport.lease?.state === "expired" ? "lease_expired"
      : canSave ? "ready_to_save"
        : blockedReasons.length ? "attention"
          : "waiting";
  return {
    state,
    canSave,
    blockedReasons: uniqueValues(blockedReasons),
    hasLeaseHandle: Boolean(transport.hasLeaseHandle),
    leaseState: transport.lease?.state || "none",
    leaseExpiresAt: transport.lease?.expiresAt || null,
    leaseRemainingMs: transport.lease?.remainingMs ?? null,
    saveReady,
    promptReady: Boolean(transport.promptAvailable),
    manifestReady: Boolean(transport.manifestAvailable),
  };
}

function gptContextLinks(process = {}, workflow = null, workflowCommand = null, incidents = [], runbooks = []) {
  const primaryIncident = incidents[0] || null;
  const primaryRunbook = runbooks[0] || null;
  return [
    workflow ? { label: "Workflow parent", href: `/operations/workflows/${encodeURIComponent(workflow.id)}`, kind: "workflow" } : null,
    workflowCommand ? { label: `Préparer ${workflowCommand.action}`, href: workflowCommand.href, kind: "workflow_action", action: workflowCommand.action } : null,
    process.runId ? { label: "Replay run", href: `/replay/runs/${encodeURIComponent(process.runId)}`, kind: "replay" } : null,
    workflow?.tradingDate ? { label: "Historique session", href: `/history/sessions/${encodeURIComponent(`${workflow.tradingDate}:${workflow.session || "global"}`)}`, kind: "history" } : null,
    primaryIncident ? { label: "Incident lié", href: `/operations/incidents?incident=${encodeURIComponent(primaryIncident.id)}`, kind: "incident" } : null,
    primaryRunbook ? { label: "Runbook lié", href: `/operations/runbooks?runbook=${encodeURIComponent(primaryRunbook.id)}`, kind: "runbook" } : null,
    process.id ? { label: "Observabilité GPT", href: `/operations/observability?process=${encodeURIComponent(process.id)}`, kind: "observability" } : null,
  ].filter(Boolean);
}

function gptRiskFlags(process = {}, transportHealth = {}, workflow = null, incidents = [], runbooks = []) {
  const activeIncidents = incidents.filter((incident) => !["resolved", "archived"].includes(incident.lifecycleStatus));
  const actionRunbooks = runbooks.filter((runbook) => runbook.status === "action_required");
  const flags = [];
  if (transportHealth.state === "saved") flags.push(gptRiskFlag("OUTPUT_SAVED", "Sortie sauvegardée", "positive"));
  if (!workflow) flags.push(gptRiskFlag("WORKFLOW_MISSING", "Workflow parent non trouvé", "warning"));
  if (workflow?.status === "waiting_gpt") flags.push(gptRiskFlag("WORKFLOW_WAITING_GPT", "Workflow en attente GPT", "info"));
  if (["failed", "blocked"].includes(workflow?.status)) flags.push(gptRiskFlag("WORKFLOW_ACTION_REQUIRED", "Workflow à reprendre", workflow.status === "failed" ? "critical" : "warning"));
  if (transportHealth.leaseState === "expired" && transportHealth.state !== "saved") flags.push(gptRiskFlag("LEASE_EXPIRED", "Lease expiré", "critical"));
  if (!transportHealth.hasLeaseHandle) flags.push(gptRiskFlag("LEASE_HANDLE_MISSING", "Handle lease incomplet", "critical"));
  if (!transportHealth.saveReady) flags.push(gptRiskFlag("SAVE_TARGET_MISSING", "Save target absent", "critical"));
  if (!transportHealth.promptReady) flags.push(gptRiskFlag("PROMPT_MISSING", "Prompt absent", "warning"));
  if (!transportHealth.manifestReady) flags.push(gptRiskFlag("MANIFEST_MISSING", "Manifest absent", "warning"));
  if (activeIncidents.length) flags.push(gptRiskFlag("ACTIVE_INCIDENTS", `${activeIncidents.length} incident${activeIncidents.length > 1 ? "s" : ""} actif${activeIncidents.length > 1 ? "s" : ""}`, activeIncidents.some((incident) => incident.severity === "critical") ? "critical" : "warning"));
  if (actionRunbooks.length) flags.push(gptRiskFlag("RUNBOOK_ACTION", `${actionRunbooks.length} runbook${actionRunbooks.length > 1 ? "s" : ""} action`, "warning"));
  if (process.status === "completed" && !process.telemetry?.available) flags.push(gptRiskFlag("TELEMETRY_MISSING", "Télémétrie GPT absente", "warning"));
  return flags.length ? flags : [gptRiskFlag("CLEAR", "Contexte sain", "positive")];
}

function gptRiskFlag(code, label, tone = "info") {
  return { code, label, tone };
}

function normalizeObservedReplayProcess(item, events, nowMs, policy = DEFAULT_OBSERVABILITY_POLICY, aiRun = null) {
  const status = observabilityStatus(item.status);
  const createdAt = item.available_at_utc || item.retry_after_utc || item.created_at_utc || null;
  const startedAt = item.claimed_at_utc || item.started_at_utc || eventTimestamp(events.find((event) => String(event.event_type).toUpperCase() === "CLAIMED"));
  const completedAt = item.completed_at_utc || eventTimestamp([...events].reverse().find((event) => ["COMPLETED", "FAILED"].includes(String(event.event_type).toUpperCase())));
  return observedProcess({
    id: item.work_item_id,
    scope: item.automation_scope || "replay",
    workflow: item.workflow || item.task_type || "REPLAY_GPT",
    runId: item.backtest_id || item.run_id || null,
    workItemId: item.work_item_id,
    cursorId: null,
    checkpoint: item.cutoff_paris || null,
    tradingDate: item.trading_date || null,
    session: item.session || null,
    strategyId: item.strategy_id || null,
    status,
    rawStatus: item.status || "UNKNOWN",
    worker: item.claimed_by || item.worker_id || item.completed_by || null,
    attempts: Number(item.attempt_count || 0),
    maxAttempts: Number(item.max_attempts || 0),
    failureCount: Number(item.failure_count || 0),
    createdAt,
    startedAt,
    completedAt,
    updatedAt: eventTime(item),
    leaseExpiresAt: item.lease_expires_at_utc || null,
    telemetry: observedTelemetry(item.gpt_telemetry, events),
    error: publicError(item.last_error),
    ...projectAiRunResearch(aiRun),
  }, nowMs, policy);
}

function normalizeObservedLiveProcess(cursor, events, nowMs, policy = DEFAULT_OBSERVABILITY_POLICY) {
  const attempt = cursor.attempt;
  if (!attempt) return null;
  const relatedEvents = events.filter((event) => !event.checkpoint || event.checkpoint === attempt.checkpoint);
  const status = observabilityStatus(attempt.status || cursor.cursor_status);
  const completedEvent = [...relatedEvents].reverse().find((event) => (
    ["CURSOR_COMPLETED", "CURSOR_DEAD_LETTER", "CURSOR_DEGRADED"].includes(String(event.event_type).toUpperCase())
  ));
  return observedProcess({
    id: `${cursor.cursor_id}:${attempt.checkpoint || "current"}`,
    scope: "live",
    workflow: attempt.workflow || "LIVE_GPT",
    runId: cursor.run_id || null,
    workItemId: null,
    cursorId: cursor.cursor_id,
    checkpoint: attempt.checkpoint || null,
    tradingDate: cursor.trading_date || null,
    session: cursor.session || null,
    strategyId: cursor.strategy_id || null,
    status,
    rawStatus: attempt.status || cursor.cursor_status || "UNKNOWN",
    worker: attempt.worker_id || null,
    attempts: Number(attempt.attempt_count || 0),
    maxAttempts: 6,
    failureCount: Number(attempt.last_error ? 1 : 0),
    createdAt: attempt.available_at_utc || cursor.created_at_utc || null,
    startedAt: attempt.started_at_utc || null,
    completedAt: attempt.completed_at_utc || eventTimestamp(completedEvent),
    updatedAt: cursor.updated_at_utc || eventTimestamp(relatedEvents.at(-1)),
    leaseExpiresAt: attempt.lease_expires_at_utc || null,
    telemetry: observedTelemetry(attempt.gpt_telemetry, relatedEvents),
    error: publicError(attempt.last_error),
  }, nowMs, policy);
}

function observedProcess(input, nowMs, policy = DEFAULT_OBSERVABILITY_POLICY) {
  const queueEnd = input.startedAt || (input.status === "queued" ? new Date(nowMs).toISOString() : null);
  const executionEnd = input.completedAt || (input.status === "running" ? new Date(nowMs).toISOString() : null);
  const queueMs = duration(input.createdAt, queueEnd);
  const executionMs = duration(input.startedAt, executionEnd);
  const endToEndMs = duration(input.createdAt, input.completedAt || (["queued", "running"].includes(input.status) ? new Date(nowMs).toISOString() : input.updatedAt));
  const lease = observedLease(input.leaseExpiresAt, input.status, nowMs, policy);
  return {
    ...input,
    queueMs,
    executionMs,
    endToEndMs,
    lease,
    sla: {
      queueBreached: queueMs !== null && queueMs > policy.queueWarningMs,
      executionBreached: executionMs !== null && executionMs > policy.executionWarningMs,
      leaseBreached: lease.state === "expired",
    },
  };
}

function observedTelemetry(value, events = []) {
  const eventValue = [...events].reverse().find((event) => event.details?.telemetry)?.details?.telemetry;
  const telemetry = normalizeGptTelemetry(value || eventValue);
  return {
    available: Boolean(telemetry),
    provider: telemetry?.provider || null,
    model: telemetry?.model || null,
    requestId: telemetry?.request_id || null,
    inputTokens: telemetry?.input_tokens ?? null,
    outputTokens: telemetry?.output_tokens ?? null,
    totalTokens: telemetry?.total_tokens ?? null,
    cachedInputTokens: telemetry?.cached_input_tokens ?? null,
    reasoningTokens: telemetry?.reasoning_tokens ?? null,
    reasoningEffort: telemetry?.reasoning_effort || null,
    runtimeSettingsRevision: telemetry?.runtime_settings_revision ?? null,
    costUsd: telemetry?.cost_usd ?? null,
    apiLatencyMs: telemetry?.api_latency_ms ?? null,
    startedAt: telemetry?.started_at_utc || null,
    completedAt: telemetry?.completed_at_utc || null,
  };
}

function observedLease(expiresAt, status, nowMs, policy = DEFAULT_OBSERVABILITY_POLICY) {
  const expiryMs = Date.parse(expiresAt || "");
  if (!Number.isFinite(expiryMs) || status !== "running") return { state: "none", expiresAt: expiresAt || null, remainingMs: null };
  const remainingMs = expiryMs - nowMs;
  return {
    state: remainingMs <= 0 ? "expired" : remainingMs <= policy.leaseExpiringMs ? "expiring" : "active",
    expiresAt,
    remainingMs,
  };
}

function observabilityStatus(value) {
  const status = String(value || "UNKNOWN").toUpperCase();
  if (["DONE", "COMPLETED"].includes(status)) return "completed";
  if (["FAILED", "DEGRADED", "DEAD_LETTER"].includes(status)) return "failed";
  if (["CLAIMED", "LEASED", "RUNNING", "RUNNING_GPT", "PROCESSING", "IN_PROGRESS"].includes(status)) return "running";
  if (["READY", "QUEUED", "CREATED", "PENDING", "RETRY", "IDLE"].includes(status) || status.startsWith("WAITING")) return "queued";
  if (["PAUSED", "BLOCKED"].includes(status)) return "blocked";
  if (["CANCELLED", "SUPERSEDED", "CLOSED"].includes(status)) return "cancelled";
  return normalizeStatus(status);
}

function observabilityMatches(item, filters = {}) {
  if (filters.scope && item.scope !== filters.scope) return false;
  if (filters.workflow && item.workflow !== filters.workflow) return false;
  if (filters.worker && item.worker !== filters.worker) return false;
  if (filters.model && item.telemetry.model !== filters.model) return false;
  if (filters.provider && item.telemetry.provider !== filters.provider) return false;
  if (filters.status && item.status !== filters.status) return false;
  if (filters.session && item.session !== filters.session) return false;
  if (filters.runId && item.runId !== filters.runId) return false;
  if (filters.process) {
    const processId = String(filters.process);
    if (![item.id, item.workItemId, item.cursorId].filter(Boolean).map(String).includes(processId)) return false;
  }
  if (!dateMatches(item.tradingDate, filters)) return false;
  if (filters.q) {
    const search = `${item.id} ${item.runId || ""} ${item.workflow} ${item.worker || ""} ${item.telemetry.model || ""}`.toLowerCase();
    if (!search.includes(String(filters.q).toLowerCase())) return false;
  }
  return true;
}

function observabilityBreakdown(items, select) {
  return [...groupBy(items, select).entries()]
    .map(([label, values]) => {
      const terminal = values.filter((item) => ["completed", "failed"].includes(item.status));
      const completed = terminal.filter((item) => item.status === "completed").length;
      const costValues = values.map((item) => item.telemetry.costUsd).filter((value) => value !== null);
      const tokenValues = values.map((item) => item.telemetry.totalTokens).filter((value) => value !== null);
      return {
        label,
        processes: values.length,
        running: values.filter((item) => item.status === "running").length,
        failed: values.filter((item) => item.status === "failed").length,
        successRate: terminal.length ? completed / terminal.length : null,
        avgExecutionMs: averageNullable(values.map((item) => item.executionMs).filter(Number.isFinite)),
        totalTokens: sumNullable(tokenValues),
        costUsd: sumNullable(costValues, 6),
        costCoverage: coverage(costValues.length, values.length),
      };
    })
    .sort((left, right) => right.processes - left.processes || String(left.label).localeCompare(String(right.label)));
}

function observabilityDailySeries(items) {
  return [...groupBy(items.filter((item) => item.tradingDate), (item) => item.tradingDate).entries()]
    .map(([date, values]) => ({
      date,
      processes: values.length,
      completed: values.filter((item) => item.status === "completed").length,
      failed: values.filter((item) => item.status === "failed").length,
      totalTokens: sumNullable(values.map((item) => item.telemetry.totalTokens).filter((value) => value !== null)),
      costUsd: sumNullable(values.map((item) => item.telemetry.costUsd).filter((value) => value !== null), 6),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function eventTimestamp(event) {
  return event?.at_utc || event?.created_at_utc || event?.updated_at_utc || event?.timestamp_utc || null;
}

function normalizeObservabilityPolicy(value = null) {
  if (!value) return { ...DEFAULT_OBSERVABILITY_POLICY };
  return {
    id: value.policy_id || value.id || OBSERVABILITY_POLICY_ID,
    revision: Number(value.revision || 0),
    enabled: value.enabled !== false,
    queueWarningMs: policyInteger(value.queue_warning_ms ?? value.queueWarningMs, DEFAULT_OBSERVABILITY_POLICY.queueWarningMs),
    executionWarningMs: policyInteger(value.execution_warning_ms ?? value.executionWarningMs, DEFAULT_OBSERVABILITY_POLICY.executionWarningMs),
    leaseExpiringMs: policyInteger(value.lease_expiring_ms ?? value.leaseExpiringMs, DEFAULT_OBSERVABILITY_POLICY.leaseExpiringMs),
    telemetryCoverageWarningPct: policyPercent(value.telemetry_coverage_warning_pct ?? value.telemetryCoverageWarningPct, DEFAULT_OBSERVABILITY_POLICY.telemetryCoverageWarningPct),
    costCoverageMinimumPct: policyPercent(value.cost_coverage_minimum_pct ?? value.costCoverageMinimumPct, DEFAULT_OBSERVABILITY_POLICY.costCoverageMinimumPct),
    failureRateWarningPct: policyPercent(value.failure_rate_warning_pct ?? value.failureRateWarningPct, DEFAULT_OBSERVABILITY_POLICY.failureRateWarningPct),
    dailyCostBudgetUsd: policyBudget(value.daily_cost_budget_usd ?? value.dailyCostBudgetUsd),
    monthlyCostBudgetUsd: policyBudget(value.monthly_cost_budget_usd ?? value.monthlyCostBudgetUsd),
    updatedAt: value.updated_at_utc || value.updatedAt || null,
  };
}

function normalizeObservabilityPolicyInput(value, current) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid("INVALID_OBSERVABILITY_POLICY", "Le payload policy est requis.");
  }
  const next = {
    ...current,
    enabled: value.enabled === undefined ? current.enabled : value.enabled,
    queueWarningMs: value.queueWarningMs ?? current.queueWarningMs,
    executionWarningMs: value.executionWarningMs ?? current.executionWarningMs,
    leaseExpiringMs: value.leaseExpiringMs ?? current.leaseExpiringMs,
    telemetryCoverageWarningPct: value.telemetryCoverageWarningPct ?? current.telemetryCoverageWarningPct,
    costCoverageMinimumPct: value.costCoverageMinimumPct ?? current.costCoverageMinimumPct,
    failureRateWarningPct: value.failureRateWarningPct ?? current.failureRateWarningPct,
    dailyCostBudgetUsd: Object.hasOwn(value, "dailyCostBudgetUsd") ? value.dailyCostBudgetUsd : current.dailyCostBudgetUsd,
    monthlyCostBudgetUsd: Object.hasOwn(value, "monthlyCostBudgetUsd") ? value.monthlyCostBudgetUsd : current.monthlyCostBudgetUsd,
  };
  if (typeof next.enabled !== "boolean") throw invalid("INVALID_OBSERVABILITY_POLICY", "enabled doit être booléen.");
  assertPolicyRange(next.queueWarningMs, 60_000, 86_400_000, "queueWarningMs");
  assertPolicyRange(next.executionWarningMs, 60_000, 86_400_000, "executionWarningMs");
  assertPolicyRange(next.leaseExpiringMs, 30_000, 1_800_000, "leaseExpiringMs");
  for (const field of ["telemetryCoverageWarningPct", "costCoverageMinimumPct", "failureRateWarningPct"]) {
    assertPolicyRange(next[field], 0, 100, field);
  }
  for (const field of ["dailyCostBudgetUsd", "monthlyCostBudgetUsd"]) {
    if (next[field] !== null && (!Number.isFinite(Number(next[field])) || Number(next[field]) < 0 || Number(next[field]) > 1_000_000)) {
      throw invalid("INVALID_OBSERVABILITY_POLICY", `${field} doit être null ou un montant positif.`);
    }
    next[field] = next[field] === null ? null : Number(next[field]);
  }
  return next;
}

function buildGuardrailProjection(items, policy) {
  const signals = [];
  const push = (signal) => signals.push({
    id: `guardrail:${signal.type}:${signal.targetId || "global"}`,
    observedAt: signal.observedAt || null,
    ...signal,
  });
  const telemetryCount = items.filter((item) => item.telemetry.available).length;
  const costCount = items.filter((item) => item.telemetry.costUsd !== null).length;
  const telemetryCoverage = coverage(telemetryCount, items.length);
  const costCoverage = coverage(costCount, items.length);
  const terminal = items.filter((item) => ["completed", "failed"].includes(item.status));
  const failed = terminal.filter((item) => item.status === "failed");
  const failureRatePct = terminal.length ? Math.round((failed.length / terminal.length) * 100) : null;

  if (policy.enabled) {
    for (const item of items) {
      if (item.lease.state === "expired") push({
        type: "LEASE_EXPIRED",
        severity: "critical",
        title: "Lease GPT expirée",
        message: `${item.workflow} est toujours ${item.rawStatus} après l’expiration de sa lease.`,
        targetId: item.id,
        processId: item.workItemId,
        runId: item.runId,
        tradingDate: item.tradingDate,
        session: item.session,
        strategyId: item.strategyId,
        workflow: item.workflow,
        worker: item.worker,
        scope: item.scope,
        observedValue: item.lease.remainingMs,
        thresholdValue: 0,
        unit: "ms",
        observedAt: item.updatedAt,
      });
      else if (item.lease.state === "expiring") push({
        type: "LEASE_EXPIRING",
        severity: "warning",
        title: "Lease GPT proche de l’expiration",
        message: `${item.workflow} doit terminer ou renouveler sa lease.`,
        targetId: item.id,
        processId: item.workItemId,
        runId: item.runId,
        tradingDate: item.tradingDate,
        session: item.session,
        strategyId: item.strategyId,
        workflow: item.workflow,
        worker: item.worker,
        scope: item.scope,
        observedValue: item.lease.remainingMs,
        thresholdValue: policy.leaseExpiringMs,
        unit: "ms",
        observedAt: item.updatedAt,
      });
      if (item.sla.queueBreached) push({
        type: "QUEUE_SLA_BREACH",
        severity: "warning",
        title: "Attente en queue hors SLA",
        message: `${item.workflow} attend depuis ${Math.round(Number(item.queueMs || 0) / 60_000)} minutes.`,
        targetId: item.id,
        processId: item.workItemId,
        runId: item.runId,
        tradingDate: item.tradingDate,
        session: item.session,
        strategyId: item.strategyId,
        workflow: item.workflow,
        worker: item.worker,
        scope: item.scope,
        observedValue: item.queueMs,
        thresholdValue: policy.queueWarningMs,
        unit: "ms",
        observedAt: item.updatedAt,
      });
      if (item.sla.executionBreached) push({
        type: "EXECUTION_SLA_BREACH",
        severity: item.lease.state === "expired" ? "critical" : "warning",
        title: "Exécution GPT hors SLA",
        message: `${item.workflow} dépasse la durée d’exécution autorisée.`,
        targetId: item.id,
        processId: item.workItemId,
        runId: item.runId,
        tradingDate: item.tradingDate,
        session: item.session,
        strategyId: item.strategyId,
        workflow: item.workflow,
        worker: item.worker,
        scope: item.scope,
        observedValue: item.executionMs,
        thresholdValue: policy.executionWarningMs,
        unit: "ms",
        observedAt: item.updatedAt,
      });
    }
    if (items.length && telemetryCoverage.percent < policy.telemetryCoverageWarningPct) push({
      type: "TELEMETRY_COVERAGE_LOW",
      severity: "warning",
      title: "Couverture de télémétrie insuffisante",
      message: `${telemetryCoverage.percent}% des processus publient une télémétrie GPT.`,
      targetId: "telemetry",
      observedValue: telemetryCoverage.percent,
      thresholdValue: policy.telemetryCoverageWarningPct,
      unit: "percent",
    });
    if ((policy.dailyCostBudgetUsd !== null || policy.monthlyCostBudgetUsd !== null)
      && items.length && costCoverage.percent < policy.costCoverageMinimumPct) push({
      type: "COST_COVERAGE_LOW",
      severity: "warning",
      title: "Couverture coût insuffisante",
      message: `Le contrôle budget ne couvre que ${costCoverage.percent}% des processus.`,
      targetId: "cost",
      observedValue: costCoverage.percent,
      thresholdValue: policy.costCoverageMinimumPct,
      unit: "percent",
    });
    if (failureRatePct !== null && failureRatePct > policy.failureRateWarningPct) push({
      type: "FAILURE_RATE_HIGH",
      severity: "critical",
      title: "Taux d’échec GPT élevé",
      message: `${failureRatePct}% des processus terminaux sont en échec.`,
      targetId: "failure-rate",
      observedValue: failureRatePct,
      thresholdValue: policy.failureRateWarningPct,
      unit: "percent",
    });
  }

  const daily = [...groupBy(items.filter((item) => item.tradingDate), (item) => item.tradingDate).entries()]
    .map(([date, values]) => budgetPeriod(date, values, policy.dailyCostBudgetUsd, policy.costCoverageMinimumPct))
    .sort((left, right) => right.period.localeCompare(left.period));
  const monthly = [...groupBy(items.filter((item) => item.tradingDate), (item) => item.tradingDate.slice(0, 7)).entries()]
    .map(([month, values]) => budgetPeriod(month, values, policy.monthlyCostBudgetUsd, policy.costCoverageMinimumPct))
    .sort((left, right) => right.period.localeCompare(left.period));
  if (policy.enabled) {
    for (const period of [...daily, ...monthly]) {
      if (period.state !== "breached") continue;
      const monthlyPeriod = period.period.length === 7;
      push({
        type: monthlyPeriod ? "MONTHLY_COST_BUDGET_BREACH" : "DAILY_COST_BUDGET_BREACH",
        severity: "critical",
        title: monthlyPeriod ? "Budget GPT mensuel dépassé" : "Budget GPT journalier dépassé",
        message: `${period.period} atteint $${period.measuredCostUsd.toFixed(4)} pour une limite de $${period.limitUsd.toFixed(4)}.`,
        targetId: period.period,
        tradingDate: monthlyPeriod ? null : period.period,
        observedValue: period.measuredCostUsd,
        thresholdValue: period.limitUsd,
        unit: "usd",
      });
    }
  }
  const orderedSignals = signals
    .sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || String(right.observedAt || "").localeCompare(String(left.observedAt || "")))
    .slice(0, 200);
  return {
    policy,
    enabled: policy.enabled,
    summary: {
      signals: orderedSignals.length,
      critical: orderedSignals.filter((item) => item.severity === "critical").length,
      warning: orderedSignals.filter((item) => item.severity === "warning").length,
      telemetryCoveragePct: telemetryCoverage.percent,
      costCoveragePct: costCoverage.percent,
      failureRatePct,
    },
    budgets: { daily, monthly },
    signals: orderedSignals,
  };
}

function budgetPeriod(period, items, limitUsd, minimumCoveragePct) {
  const measured = items.map((item) => item.telemetry.costUsd).filter((value) => value !== null);
  const measuredCostUsd = sumNullable(measured, 6) ?? 0;
  const costCoverage = coverage(measured.length, items.length);
  const state = limitUsd === null ? "not_configured"
    : measuredCostUsd > limitUsd ? "breached"
      : costCoverage.percent < minimumCoveragePct ? "insufficient_data"
        : "within";
  return { period, measuredCostUsd, limitUsd, coveragePct: costCoverage.percent, state };
}

function policyInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function policyPercent(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : fallback;
}

function policyBudget(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function assertPolicyRange(value, min, max, field) {
  if (!Number.isInteger(Number(value)) || Number(value) < min || Number(value) > max) {
    throw invalid("INVALID_OBSERVABILITY_POLICY", `${field} doit être compris entre ${min} et ${max}.`);
  }
}

function severityRank(value) {
  return value === "critical" ? 2 : value === "warning" ? 1 : 0;
}

function normalizeIncident(item = {}, kind, events = [], nowMs = frontOperationsEpochMs()) {
  const sourceId = item.alert_id || item.error_id || item.audit_id || item.id || hashObject(item).slice(0, 24);
  const sourceCollection = ["alert", "guardrail"].includes(kind) ? C.deskAlerts : kind === "error" ? C.deskErrors : C.deskDataQualityAudits;
  const evidence = item.evidence || null;
  const timeline = normalizeIncidentTimeline([...(item.timeline || []), ...(events || [])]);
  const incident = {
    id: `${kind}:${sourceId}`,
    sourceId,
    sourceCollection,
    kind,
    title: item.title || item.code || item.error_code || (kind === "data_quality" ? "Qualité des données" : "Incident Desk"),
    message: item.message || item.description || item.reason || item.error_message || "",
    severity: normalizeSeverity(item.severity || item.level || (kind === "error" ? "critical" : "warning")),
    lifecycleStatus: normalizeLifecycle(item.lifecycle_status || item.incident_status || item.status),
    revision: Number(item.revision || 0),
    tradingDate: item.trading_date || item.date || null,
    session: item.session || null,
    runId: item.backtest_id || item.run_id || item.job_id || item.runId || null,
    processId: item.process_id || item.work_item_id || item.cursor_id || null,
    targetId: item.target_id || evidence?.targetId || null,
    workflow: item.workflow || evidence?.workflow || null,
    worker: item.worker || evidence?.worker || null,
    source: item.source || null,
    guardrailType: item.guardrail_type || evidence?.type || null,
    fingerprint: item.fingerprint || null,
    owner: item.owner || null,
    occurrenceCount: Number(item.occurrence_count || 0),
    observedValue: firstNumber(item.observed_value, evidence?.observedValue),
    thresholdValue: firstNumber(item.threshold_value, evidence?.thresholdValue),
    unit: item.unit || evidence?.unit || null,
    policyRevision: item.policy_revision ?? evidence?.policyRevision ?? null,
    policySnapshot: item.policy_snapshot || evidence?.policySnapshot || null,
    evidence,
    timeline,
    createdAt: item.first_observed_at_utc || item.created_at_utc || item.created_at || null,
    firstObservedAt: item.first_observed_at_utc || item.created_at_utc || item.created_at || null,
    lastObservedAt: item.last_observed_at_utc || item.updated_at_utc || null,
    resolvedAt: item.resolved_at_utc || null,
    updatedAt: eventTime(item),
    snoozedUntil: item.snoozed_until_utc || null,
  };
  return enrichIncidentForTriage(incident, nowMs);
}

function enrichIncidentForTriage(incident, nowMs = frontOperationsEpochMs()) {
  const active = !["resolved", "archived"].includes(incident.lifecycleStatus);
  const sla = incidentSla(incident, nowMs);
  const triage = incidentTriage(incident, sla);
  return {
    ...incident,
    triage,
    sla,
    recommendedActions: incidentRecommendedActions(incident, triage),
    links: incidentLinks(incident),
    blastRadius: incidentBlastRadius(incident),
  };
}

function incidentSla(incident = {}, nowMs = frontOperationsEpochMs()) {
  const start = Date.parse(incident.firstObservedAt || incident.createdAt || incident.updatedAt || "");
  const ageMs = Number.isFinite(start) ? Math.max(0, nowMs - start) : null;
  const targetMs = incident.severity === "critical" ? 15 * 60 * 1000
    : incident.severity === "warning" ? 60 * 60 * 1000
      : 4 * 60 * 60 * 1000;
  const dueAt = Number.isFinite(start) ? new Date(start + targetMs).toISOString() : null;
  const remainingMs = ageMs === null ? null : targetMs - ageMs;
  const active = !["resolved", "archived"].includes(incident.lifecycleStatus);
  return {
    ageMs,
    targetMs,
    dueAt,
    remainingMs,
    breached: active && remainingMs !== null && remainingMs < 0,
  };
}

function incidentTriage(incident = {}, sla = {}) {
  const active = !["resolved", "archived"].includes(incident.lifecycleStatus);
  const ageBoost = sla.ageMs === null ? 0
    : sla.ageMs >= 4 * 60 * 60 * 1000 ? 18
      : sla.ageMs >= 60 * 60 * 1000 ? 10
        : sla.ageMs >= 15 * 60 * 1000 ? 5
          : 0;
  const base = incident.severity === "critical" ? 72 : incident.severity === "warning" ? 46 : 24;
  const score = active ? Math.max(0, Math.min(100,
    base
    + ageBoost
    + (sla.breached ? 15 : 0)
    + (!incident.owner ? 10 : 0)
    + (incident.kind === "guardrail" ? 5 : 0)
    + Math.min(8, Number(incident.occurrenceCount || 0) * 2)
    - (incident.lifecycleStatus === "acknowledged" ? 18 : 0)
    - (incident.lifecycleStatus === "snoozed" ? 30 : 0),
  )) : 0;
  const queue = !active ? "closed" : score >= 90 ? "page" : score >= 68 ? "action" : score >= 38 ? "watch" : "backlog";
  const nextAction = !active ? "reopen"
    : !incident.owner ? "assign"
      : incident.lifecycleStatus === "open" ? "acknowledge"
        : incident.lifecycleStatus === "snoozed" ? "watch"
          : "resolve";
  return {
    score,
    queue,
    nextAction,
    ownerRequired: active && !incident.owner,
    reasonCodes: [
      incident.severity === "critical" ? "critical" : null,
      incident.kind === "guardrail" ? "guardrail" : null,
      !incident.owner && active ? "unowned" : null,
      sla.breached ? "sla_breached" : null,
      incident.lifecycleStatus === "snoozed" ? "snoozed" : null,
      incident.guardrailType || null,
    ].filter(Boolean),
  };
}

function incidentRecommendedActions(incident = {}, triage = {}) {
  const active = !["resolved", "archived"].includes(incident.lifecycleStatus);
  if (!active) return [{
    action: "reopen",
    label: "Réouvrir",
    tone: "warning",
    reason: "Incident clôturé : réouvrir uniquement si le signal revient.",
    confirmationPhrase: "CONFIRM_REOPEN",
  }];
  const actions = [];
  if (!incident.owner) actions.push({
    action: "assign",
    label: "Assigner owner",
    tone: triage.queue === "page" ? "critical" : "warning",
    reason: "Aucun responsable n’est attaché au signal actif.",
    confirmationPhrase: "CONFIRM_ASSIGN",
  });
  if (incident.lifecycleStatus === "open") actions.push({
    action: "acknowledge",
    label: "Acquitter",
    tone: "info",
    reason: "Marquer la prise en charge opérateur et figer l’owner.",
    confirmationPhrase: "CONFIRM_ACKNOWLEDGE",
  });
  if (incident.lifecycleStatus !== "snoozed") actions.push({
    action: "snooze",
    label: "Reporter",
    tone: "neutral",
    reason: "Mettre en veille temporaire quand le signal est connu et surveillé.",
    confirmationPhrase: "CONFIRM_SNOOZE",
  });
  actions.push({
    action: "resolve",
    label: "Résoudre",
    tone: "critical",
    reason: "À utiliser seulement après preuve que l’état canonique est revenu dans les seuils.",
    confirmationPhrase: "CONFIRM_RESOLVE",
  });
  return actions;
}

function incidentLinks(incident = {}) {
  const workflowId = incident.runId ? `replay:${incident.runId}` : null;
  const historyId = incident.tradingDate ? `${incident.tradingDate}:${incident.session || "global"}` : null;
  const workflowAction = incidentWorkflowAction(incident);
  return [
    { label: "Incident", href: `/operations/incidents?incident=${encodeURIComponent(incident.id)}`, kind: "incident" },
    workflowId ? { label: "Workflow", href: `/operations/workflows/${encodeURIComponent(workflowId)}`, kind: "workflow" } : null,
    workflowId && workflowAction ? { label: `Action ${workflowAction}`, href: workflowActionHref(workflowId, workflowAction), kind: "workflow_action", action: workflowAction } : null,
    incident.runId ? { label: "Replay", href: `/replay/runs/${encodeURIComponent(incident.runId)}`, kind: "replay" } : null,
    incident.runId && incident.processId ? { label: "GPT", href: `/replay/runs/${encodeURIComponent(incident.runId)}/gpt/${encodeURIComponent(incident.processId)}`, kind: "gpt" } : null,
    historyId ? { label: "Historique", href: `/history/sessions/${encodeURIComponent(historyId)}`, kind: "history" } : null,
    { label: "Observabilité", href: "/operations/observability", kind: "observability" },
  ].filter(Boolean);
}

function incidentWorkflowAction(incident = {}) {
  const text = [incident.guardrailType, incident.title, incident.message, incident.kind, incident.workflow].filter(Boolean).join(" ").toUpperCase();
  if (text.includes("LEASE") || text.includes("GPT") || text.includes("FAIL") || text.includes("BLOCK") || text.includes("DATA_NOT_READY")) return "retry";
  if (text.includes("PAUSE") || text.includes("SNOOZE")) return "resume";
  return null;
}

function workflowActionHref(workflowId, action) {
  return `/operations/workflows/${encodeURIComponent(workflowId)}?action=${encodeURIComponent(action)}#command-center`;
}

function incidentBlastRadius(incident = {}) {
  const impacted = [
    incident.runId ? { kind: "run", id: incident.runId, label: `Run ${incident.runId}` } : null,
    incident.processId ? { kind: "process", id: incident.processId, label: `GPT ${incident.processId}` } : null,
    incident.workflow ? { kind: "workflow", id: incident.workflow, label: incident.workflow } : null,
    incident.worker ? { kind: "worker", id: incident.worker, label: incident.worker } : null,
    incident.tradingDate ? { kind: "session", id: `${incident.tradingDate}:${incident.session || "global"}`, label: `${incident.tradingDate} · ${incident.session || "global"}` } : null,
  ].filter(Boolean);
  return {
    scope: incident.processId ? "process" : incident.runId ? "run" : incident.tradingDate ? "session" : "desk",
    impacted,
    count: impacted.length || 1,
  };
}

function buildIncidentTriageOverview(items = []) {
  const active = items.filter((item) => !["resolved", "archived"].includes(item.lifecycleStatus));
  const byQueue = countBy(active, (item) => item.triage?.queue || "backlog");
  return {
    active: active.length,
    page: byQueue.page || 0,
    action: byQueue.action || 0,
    watch: byQueue.watch || 0,
    backlog: byQueue.backlog || 0,
    closed: items.length - active.length,
    top: active
      .sort((a, b) => Number(b.triage?.score || 0) - Number(a.triage?.score || 0) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
      .slice(0, 5)
      .map((item) => ({ id: item.id, title: item.title, score: item.triage?.score || 0, queue: item.triage?.queue || "backlog", href: `/operations/incidents?incident=${encodeURIComponent(item.id)}` })),
  };
}

function guardrailAlertId(signal = {}) {
  const type = safeIdPart(signal.type || "signal");
  const digest = hashObject({ type: signal.type || null, targetId: signal.targetId || "global" }).slice(0, 18);
  return `guardrail__${type}__${digest}`;
}

function guardrailAlertFromSignal(signal, current, policy, tick, actor) {
  const alertId = guardrailAlertId(signal);
  const fingerprint = hashObject({
    type: signal.type,
    severity: signal.severity,
    title: signal.title,
    message: signal.message,
    targetId: signal.targetId || null,
    processId: signal.processId || null,
    runId: signal.runId || null,
    observedValue: signal.observedValue ?? null,
    thresholdValue: signal.thresholdValue ?? null,
    unit: signal.unit || null,
    policyRevision: policy.revision,
  });
  const currentLifecycle = normalizeLifecycle(current?.lifecycle_status || current?.incident_status || current?.status);
  const snoozeExpired = currentLifecycle === "snoozed" && current?.snoozed_until_utc && Date.parse(current.snoozed_until_utc) <= tick.epochMs;
  const lifecycle = !current || ["resolved", "archived"].includes(currentLifecycle) || snoozeExpired ? "open" : currentLifecycle;
  const revision = Number(current?.revision || 0) + (current?.fingerprint === fingerprint && lifecycle === currentLifecycle ? 0 : 1);
  const observedAt = signal.observedAt || tick.utc;
  const evidence = {
    signalId: signal.id || null,
    type: signal.type || null,
    targetId: signal.targetId || null,
    processId: signal.processId || null,
    runId: signal.runId || null,
    workflow: signal.workflow || null,
    worker: signal.worker || null,
    scope: signal.scope || null,
    observedValue: signal.observedValue ?? null,
    thresholdValue: signal.thresholdValue ?? null,
    unit: signal.unit || null,
    observedAt,
    policyRevision: policy.revision,
    policySnapshot: compactObservabilityPolicy(policy),
  };
  const timeline = appendIncidentTimeline(current?.timeline, {
    type: current ? (currentLifecycle === "resolved" ? "REOPENED" : "OBSERVED") : "OPENED",
    at: tick.utc,
    title: signal.title,
    message: signal.message,
    severity: signal.severity,
    actor: normalizeActor(actor),
    evidence,
  });
  return {
    ...(current || {}),
    alert_id: alertId,
    alert_kind: "guardrail",
    source: GUARDRAIL_ALERT_SOURCE,
    fingerprint,
    guardrail_signal_id: signal.id || null,
    guardrail_type: signal.type || null,
    title: signal.title || "Guardrail observabilité",
    message: signal.message || "",
    severity: normalizeSeverity(signal.severity),
    lifecycle_status: lifecycle,
    status: lifecycle === "resolved" ? "RESOLVED" : "OPEN",
    revision,
    trading_date: signal.tradingDate || null,
    session: signal.session || null,
    strategy_id: signal.strategyId || null,
    run_id: signal.runId || null,
    process_id: signal.processId || null,
    target_id: signal.targetId || null,
    workflow: signal.workflow || null,
    worker: signal.worker || null,
    observed_value: signal.observedValue ?? null,
    threshold_value: signal.thresholdValue ?? null,
    unit: signal.unit || null,
    policy_revision: policy.revision,
    policy_snapshot: compactObservabilityPolicy(policy),
    evidence,
    timeline,
    occurrence_count: Number(current?.occurrence_count || 0) + (current?.fingerprint === fingerprint ? 0 : 1),
    first_observed_at_utc: current?.first_observed_at_utc || observedAt,
    last_observed_at_utc: observedAt,
    created_at_utc: current?.created_at_utc || tick.utc,
    created_at_paris: current?.created_at_paris || tick.paris,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
    updated_by: normalizeActor(actor),
    resolved_at_utc: lifecycle === "resolved" ? current?.resolved_at_utc || null : null,
  };
}

function guardrailAlertEquivalent(current, next) {
  if (!current) return false;
  return current.fingerprint === next.fingerprint
    && normalizeLifecycle(current.lifecycle_status || current.status) === normalizeLifecycle(next.lifecycle_status || next.status)
    && String(current.owner || "") === String(next.owner || "")
    && String(current.snoozed_until_utc || "") === String(next.snoozed_until_utc || "");
}

function resolveGuardrailAlert(current, tick, actor) {
  return {
    ...current,
    lifecycle_status: "resolved",
    status: "RESOLVED",
    revision: Number(current.revision || 0) + 1,
    resolved_at_utc: tick.utc,
    resolved_by: normalizeActor(actor),
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
    timeline: appendIncidentTimeline(current.timeline, {
      type: "AUTO_RESOLVED",
      at: tick.utc,
      title: "Signal revenu dans les seuils",
      message: "Le matérialiseur d’observabilité ne détecte plus ce signal guardrail.",
      severity: "info",
      actor: normalizeActor(actor),
      evidence: current.evidence || null,
    }),
  };
}

function compactObservabilityPolicy(policy = {}) {
  return {
    revision: Number(policy.revision || 0),
    enabled: Boolean(policy.enabled),
    queueWarningMs: policy.queueWarningMs,
    executionWarningMs: policy.executionWarningMs,
    leaseExpiringMs: policy.leaseExpiringMs,
    telemetryCoverageWarningPct: policy.telemetryCoverageWarningPct,
    costCoverageMinimumPct: policy.costCoverageMinimumPct,
    failureRateWarningPct: policy.failureRateWarningPct,
    dailyCostBudgetUsd: policy.dailyCostBudgetUsd,
    monthlyCostBudgetUsd: policy.monthlyCostBudgetUsd,
  };
}

function appendIncidentTimeline(timeline = [], event) {
  return [
    ...normalizeIncidentTimeline(timeline),
    {
      id: event.id || hashObject({ at: event.at, type: event.type, title: event.title, message: event.message }).slice(0, 20),
      type: event.type,
      at: event.at,
      title: event.title || event.type,
      message: event.message || "",
      severity: normalizeSeverity(event.severity || "info"),
      actor: event.actor || null,
      evidence: event.evidence || null,
    },
  ].slice(-30);
}

function normalizeIncidentTimeline(timeline = []) {
  return (timeline || []).map((event) => ({
    id: event.event_id || event.id || hashObject(event).slice(0, 20),
    type: event.event_type || event.type || "EVENT",
    at: event.created_at_utc || event.at || event.timestamp_utc || null,
    title: event.title || event.event_type || event.type || "Événement",
    message: event.message || event.reason || "",
    severity: normalizeSeverity(event.severity || event.level || "info"),
    actor: event.actor || null,
    evidence: event.evidence || null,
  })).sort((left, right) => String(left.at || "").localeCompare(String(right.at || ""))).slice(-30);
}

function isGuardrailAlert(item = {}) {
  return item.alert_kind === "guardrail" || item.source === GUARDRAIL_ALERT_SOURCE || String(item.alert_id || "").startsWith("guardrail__");
}

function incidentSearchText(item = {}) {
  return [
    item.id, item.sourceId, item.kind, item.title, item.message, item.severity, item.lifecycleStatus,
    item.runId, item.processId, item.targetId, item.workflow, item.worker, item.owner, item.guardrailType,
  ].filter(Boolean).join(" ").toLowerCase();
}

function incidentNotificationId(incident = {}) {
  return `notif_incident_${hashObject({ incidentId: incident.id || incident.sourceId }).slice(0, 32)}`;
}

function notificationFromIncident(incident, current, tick, actor) {
  const notificationId = incidentNotificationId(incident);
  const escalation = incidentEscalation(incident, tick.epochMs);
  const fingerprint = hashObject({
    incidentId: incident.id,
    incidentSourceId: incident.sourceId,
    incidentRevision: incident.revision,
    lifecycleStatus: incident.lifecycleStatus,
    severity: incident.severity,
    escalationLevel: escalation.level,
    incidentFingerprint: incident.fingerprint || null,
  });
  const currentStatus = normalizeNotificationStatus(current?.status);
  const keepDismissed = currentStatus === "dismissed" && current?.fingerprint === fingerprint;
  const keepRead = currentStatus === "read" && current?.fingerprint === fingerprint;
  const passiveIncident = ["acknowledged", "snoozed"].includes(incident.lifecycleStatus);
  const status = keepDismissed ? "dismissed" : keepRead || passiveIncident ? "read" : "pending";
  const baseRevision = Number(current?.revision || 0);
  const actorSnapshot = normalizeActor(actor);
  const candidate = {
    ...(current || {}),
    notification_id: notificationId,
    schema_version: OPERATIONS_CONTRACT_VERSION,
    source: NOTIFICATION_SOURCE,
    channel: LOCAL_NOTIFICATION_CHANNEL,
    delivery_state: "local_only",
    status,
    escalation_level: escalation.level,
    priority: escalation.priority,
    reason_codes: escalation.reasonCodes,
    title: notificationTitle(incident, escalation),
    message: notificationMessage(incident, escalation),
    severity: incident.severity,
    incident_id: incident.id,
    incident_source_id: incident.sourceId,
    incident_kind: incident.kind,
    incident_revision: incident.revision,
    incident_lifecycle_status: incident.lifecycleStatus,
    incident_fingerprint: incident.fingerprint || null,
    owner: incident.owner || null,
    run_id: incident.runId || null,
    process_id: incident.processId || null,
    workflow: incident.workflow || null,
    worker: incident.worker || null,
    trading_date: incident.tradingDate || null,
    session: incident.session || null,
    target_id: incident.targetId || null,
    target_url: `/operations/incidents?incident=${encodeURIComponent(incident.id)}`,
    dedupe_key: `incident:${incident.id}`,
    fingerprint,
    evidence: {
      incident: {
        id: incident.id,
        sourceId: incident.sourceId,
        kind: incident.kind,
        severity: incident.severity,
        lifecycleStatus: incident.lifecycleStatus,
        revision: incident.revision,
      },
      observedValue: incident.observedValue ?? null,
      thresholdValue: incident.thresholdValue ?? null,
      unit: incident.unit || null,
      guardrailType: incident.guardrailType || null,
      reasonCodes: escalation.reasonCodes,
    },
    first_notified_at_utc: current?.first_notified_at_utc || tick.utc,
    last_evaluated_at_utc: tick.utc,
    created_at_utc: current?.created_at_utc || tick.utc,
    created_at_paris: current?.created_at_paris || tick.paris,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
    updated_by: actorSnapshot,
    timeline: appendNotificationTimeline(current?.timeline, {
      type: !current || currentStatus === "cleared" ? "OPENED" : "UPDATED",
      at: tick.utc,
      title: notificationTitle(incident, escalation),
      message: notificationMessage(incident, escalation),
      severity: incident.severity,
      actor: actorSnapshot,
      evidence: { incidentId: incident.id, escalationLevel: escalation.level, reasonCodes: escalation.reasonCodes },
    }),
  };
  candidate.revision = !current
    ? 1
    : notificationEquivalent(current, { ...candidate, revision: baseRevision })
      ? baseRevision
      : baseRevision + 1;
  return candidate;
}

function clearNotification(current, tick, actor, reason) {
  const actorSnapshot = normalizeActor(actor);
  return {
    ...current,
    status: "cleared",
    escalation_level: "cleared",
    priority: 0,
    cleared_at_utc: tick.utc,
    cleared_by: actorSnapshot,
    revision: Number(current.revision || 0) + 1,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
    updated_by: actorSnapshot,
    timeline: appendNotificationTimeline(current.timeline, {
      type: "CLEARED",
      at: tick.utc,
      title: "Notification clôturée",
      message: reason,
      severity: "info",
      actor: actorSnapshot,
    }),
  };
}

function incidentEscalation(incident = {}, epochMs = frontOperationsEpochMs()) {
  const lifecycle = normalizeLifecycle(incident.lifecycleStatus);
  const severity = normalizeSeverity(incident.severity);
  const ageMs = Math.max(0, epochMs - Date.parse(incident.firstObservedAt || incident.createdAt || incident.updatedAt || new Date(epochMs).toISOString()));
  if (lifecycle === "snoozed") return { level: "muted", priority: 10, reasonCodes: ["incident_snoozed"] };
  if (lifecycle === "acknowledged") return { level: "watch", priority: 30, reasonCodes: ["incident_acknowledged"] };
  if (severity === "critical" && (!incident.owner || ageMs >= 15 * 60 * 1000)) {
    return { level: "page", priority: 100, reasonCodes: [incident.owner ? "critical_aged_15m" : "critical_unowned"] };
  }
  if (severity === "critical") return { level: "action", priority: 80, reasonCodes: ["critical_incident"] };
  if (severity === "warning" && ageMs >= 30 * 60 * 1000) return { level: "action", priority: 60, reasonCodes: ["warning_aged_30m"] };
  return { level: "watch", priority: 40, reasonCodes: ["watch_incident"] };
}

function notificationTitle(incident = {}, escalation = {}) {
  const prefix = escalation.level === "page" ? "Escalade immédiate"
    : escalation.level === "action" ? "Action opérateur"
      : escalation.level === "muted" ? "Incident en sourdine"
        : "Surveillance incident";
  return `${prefix} · ${incident.title || incident.id || "Incident Desk"}`;
}

function notificationMessage(incident = {}, escalation = {}) {
  const owner = incident.owner ? `Assigné à ${incident.owner}.` : "Aucun owner assigné.";
  const context = [incident.workflow, incident.runId, incident.processId].filter(Boolean).join(" · ");
  return [incident.message || "Incident actif détecté.", owner, context ? `Contexte : ${context}.` : null, escalation.reasonCodes?.length ? `Raison : ${escalation.reasonCodes.join(", ")}.` : null]
    .filter(Boolean)
    .join(" ");
}

function notificationEquivalent(current, next) {
  if (!current) return false;
  return normalizeNotificationStatus(current.status) === normalizeNotificationStatus(next.status)
    && normalizeEscalationLevel(current.escalation_level) === normalizeEscalationLevel(next.escalation_level)
    && Number(current.priority || 0) === Number(next.priority || 0)
    && String(current.fingerprint || "") === String(next.fingerprint || "")
    && String(current.incident_lifecycle_status || "") === String(next.incident_lifecycle_status || "")
    && String(current.owner || "") === String(next.owner || "")
    && String(current.title || "") === String(next.title || "")
    && String(current.message || "") === String(next.message || "");
}

function normalizeNotification(item = {}) {
  const sourceId = item.notification_id || item.id || hashObject(item).slice(0, 24);
  const status = normalizeNotificationStatus(item.status);
  const escalationLevel = normalizeEscalationLevel(item.escalation_level || item.level);
  return {
    id: `notification:${sourceId}`,
    sourceId,
    source: item.source || null,
    channel: item.channel || LOCAL_NOTIFICATION_CHANNEL,
    deliveryState: item.delivery_state || "local_only",
    status,
    escalationLevel,
    priority: Number(item.priority || 0),
    reasonCodes: Array.isArray(item.reason_codes) ? item.reason_codes : [],
    title: item.title || "Notification Desk",
    message: item.message || "",
    severity: normalizeSeverity(item.severity || (escalationLevel === "page" ? "critical" : "warning")),
    revision: Number(item.revision || 0),
    incidentId: item.incident_id || null,
    incidentSourceId: item.incident_source_id || null,
    incidentKind: item.incident_kind || null,
    incidentRevision: Number(item.incident_revision || 0),
    incidentLifecycleStatus: item.incident_lifecycle_status || null,
    owner: item.owner || null,
    runId: item.run_id || null,
    processId: item.process_id || null,
    workflow: item.workflow || null,
    worker: item.worker || null,
    tradingDate: item.trading_date || null,
    session: item.session || null,
    targetId: item.target_id || null,
    targetUrl: item.target_url || null,
    dedupeKey: item.dedupe_key || null,
    fingerprint: item.fingerprint || null,
    evidence: item.evidence || null,
    timeline: normalizeNotificationTimeline(item.timeline || []),
    firstNotifiedAt: item.first_notified_at_utc || item.created_at_utc || null,
    lastEvaluatedAt: item.last_evaluated_at_utc || null,
    readAt: item.read_at_utc || null,
    dismissedAt: item.dismissed_at_utc || null,
    clearedAt: item.cleared_at_utc || null,
    createdAt: item.created_at_utc || null,
    updatedAt: eventTime(item),
    allowedActions: allowedNotificationActions(status),
  };
}

function appendNotificationTimeline(timeline = [], event) {
  return [
    ...normalizeNotificationTimeline(timeline),
    {
      id: event.id || hashObject({ at: event.at, type: event.type, title: event.title, message: event.message }).slice(0, 20),
      type: event.type,
      at: event.at,
      title: event.title || event.type,
      message: event.message || "",
      severity: normalizeSeverity(event.severity || "info"),
      actor: event.actor || null,
      evidence: event.evidence || null,
    },
  ].slice(-30);
}

function normalizeNotificationTimeline(timeline = []) {
  return (timeline || []).map((event) => ({
    id: event.event_id || event.id || hashObject(event).slice(0, 20),
    type: event.event_type || event.type || "EVENT",
    at: event.created_at_utc || event.at || event.timestamp_utc || null,
    title: event.title || event.event_type || event.type || "Événement",
    message: event.message || event.reason || "",
    severity: normalizeSeverity(event.severity || event.level || "info"),
    actor: event.actor || null,
    evidence: event.evidence || null,
  })).sort((left, right) => String(left.at || "").localeCompare(String(right.at || ""))).slice(-30);
}

function normalizeNotificationStatus(status) {
  const value = String(status || "pending").toLowerCase();
  return ["pending", "read", "dismissed", "cleared"].includes(value) ? value : "pending";
}

function normalizeEscalationLevel(level) {
  const value = String(level || "watch").toLowerCase();
  return ["page", "action", "watch", "muted", "cleared"].includes(value) ? value : "watch";
}

function allowedNotificationActions(status) {
  if (status === "pending") return ["mark_read", "dismiss"];
  if (status === "read") return ["dismiss"];
  return [];
}

function notificationMatches(item = {}, filters = {}) {
  if (filters.status && filters.status !== "active" && item.status !== filters.status) return false;
  if (filters.status === "active" && ["dismissed", "cleared"].includes(item.status)) return false;
  if (filters.level && item.escalationLevel !== filters.level) return false;
  if (filters.session && item.session !== filters.session) return false;
  if (!dateMatches(item.tradingDate, filters)) return false;
  if (filters.q && !notificationSearchText(item).includes(String(filters.q).toLowerCase())) return false;
  return true;
}

function notificationSearchText(item = {}) {
  return [
    item.id, item.sourceId, item.title, item.message, item.status, item.escalationLevel, item.severity,
    item.incidentId, item.incidentKind, item.owner, item.runId, item.processId, item.workflow, item.worker,
  ].filter(Boolean).join(" ").toLowerCase();
}

function byNotificationPriority(left, right) {
  const statusRank = { pending: 0, read: 1, dismissed: 2, cleared: 3 };
  const levelRank = { page: 4, action: 3, watch: 2, muted: 1, cleared: 0 };
  return (statusRank[left.status] ?? 9) - (statusRank[right.status] ?? 9)
    || (levelRank[right.escalationLevel] ?? 0) - (levelRank[left.escalationLevel] ?? 0)
    || Number(right.priority || 0) - Number(left.priority || 0)
    || String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
}

function runbookFromNotification(notification, incidentById, workflowById, gptById) {
  const incident = notification.incidentId ? incidentById.get(notification.incidentId) : null;
  const workflow = notification.runId ? workflowById.get(notification.runId) : null;
  const process = notification.processId ? gptById.get(notification.processId) : null;
  const kind = classifyRunbook({ incident, notification, workflow, process });
  return normalizeRunbook({
    sourceId: `notification:${notification.sourceId}`,
    kind,
    title: runbookTitle(kind, notification.title),
    summary: notification.message,
    severity: notification.severity,
    status: notification.status === "pending" ? "action_required" : "watching",
    priority: notification.priority,
    notification,
    incident,
    workflow,
    process,
    reasonCodes: notification.reasonCodes,
    timeline: notification.timeline,
  });
}

function runbookFromIncident(incident, workflowById, gptById) {
  const workflow = incident.runId ? workflowById.get(incident.runId) : null;
  const process = incident.processId ? gptById.get(incident.processId) : null;
  const kind = classifyRunbook({ incident, workflow, process });
  return normalizeRunbook({
    sourceId: `incident:${incident.id}`,
    kind,
    title: runbookTitle(kind, incident.title),
    summary: incident.message,
    severity: incident.severity,
    status: incident.lifecycleStatus === "acknowledged" ? "watching" : "action_required",
    priority: incident.severity === "critical" ? 90 : 55,
    incident,
    workflow,
    process,
    reasonCodes: [incident.guardrailType, incident.kind].filter(Boolean),
    timeline: incident.timeline,
  });
}

function runbookFromWorkflow(workflow, incidents = [], notifications = [], processes = []) {
  const incident = incidents.find((item) => item.runId === workflow.sourceId || item.workflow === workflow.name || item.workflow === workflow.kind) || null;
  const notification = notifications.find((item) => item.runId === workflow.sourceId || item.incidentId === incident?.id) || null;
  const process = processes.find((item) => item.runId === workflow.sourceId && ["failed", "blocked", "waiting_gpt"].includes(item.status)) || null;
  const kind = classifyRunbook({ incident, notification, workflow, process });
  return normalizeRunbook({
    sourceId: `workflow:${workflow.id}`,
    kind,
    title: runbookTitle(kind, workflow.name),
    summary: workflow.error?.message || `Workflow ${workflow.status}.`,
    severity: workflow.status === "failed" ? "critical" : workflow.status === "blocked" ? "warning" : "info",
    status: workflow.status === "waiting_gpt" ? "waiting" : "action_required",
    priority: workflow.status === "failed" ? 75 : workflow.status === "blocked" ? 65 : 35,
    notification,
    incident,
    workflow,
    process,
    reasonCodes: [workflow.status, workflow.kind].filter(Boolean),
    timeline: [],
  });
}

function normalizeRunbook(input = {}) {
  const targetId = input.notification?.id || input.incident?.id || input.workflow?.id || input.process?.id || input.sourceId;
  const sourceId = input.sourceId || `${input.kind}:${targetId}`;
  const id = `runbook:${hashObject({ sourceId, kind: input.kind }).slice(0, 32)}`;
  const runId = input.notification?.runId || input.incident?.runId || input.workflow?.sourceId || input.process?.runId || null;
  const processId = input.notification?.processId || input.incident?.processId || input.process?.id || input.workflow?.currentWorkItemId || null;
  const workflowId = input.workflow?.id || (runId ? `replay:${runId}` : null);
  const steps = runbookSteps(input.kind, { ...input, id, runId, processId, workflowId });
  const triage = runbookTriage(input, steps);
  return {
    id,
    sourceId,
    kind: input.kind,
    title: input.title,
    summary: input.summary || "Intervention opérateur recommandée.",
    severity: normalizeSeverity(input.severity || "warning"),
    status: input.status || "action_required",
    priority: Number(input.priority || 50),
    reasonCodes: input.reasonCodes || [],
    notificationId: input.notification?.id || null,
    incidentId: input.incident?.id || null,
    workflowId,
    runId,
    processId,
    owner: input.notification?.owner || input.incident?.owner || null,
    session: input.notification?.session || input.incident?.session || input.workflow?.session || null,
    tradingDate: input.notification?.tradingDate || input.incident?.tradingDate || input.workflow?.tradingDate || null,
    updatedAt: input.notification?.updatedAt || input.incident?.updatedAt || input.workflow?.updatedAt || input.process?.updatedAt || null,
    context: {
      notificationStatus: input.notification?.status || null,
      escalationLevel: input.notification?.escalationLevel || null,
      incidentStatus: input.incident?.lifecycleStatus || null,
      workflowStatus: input.workflow?.status || null,
      processStatus: input.process?.status || null,
      workflow: input.notification?.workflow || input.incident?.workflow || input.workflow?.kind || input.process?.workflow || null,
      worker: input.notification?.worker || input.incident?.worker || input.process?.worker || null,
    },
    steps,
    nextAction: steps.find((step) => step.kind === "operator_action") || steps[0] || null,
    links: runbookLinks({ notification: input.notification, incident: input.incident, workflow: input.workflow, process: input.process, runId, processId, workflowId }),
    timeline: normalizeRunbookTimeline(input.timeline || [], input),
    triage,
    sla: input.incident?.sla || null,
    recommendedActions: input.incident?.recommendedActions || [],
    blastRadius: input.incident?.blastRadius || (runId || processId || workflowId ? {
      scope: processId ? "process" : runId ? "run" : "workflow",
      count: [runId, processId, workflowId].filter(Boolean).length,
      impacted: [
        runId ? { kind: "run", id: runId, label: `Run ${runId}` } : null,
        processId ? { kind: "process", id: processId, label: `GPT ${processId}` } : null,
        workflowId ? { kind: "workflow", id: workflowId, label: workflowId } : null,
      ].filter(Boolean),
    } : null),
  };
}

function runbookTriage(input = {}, steps = []) {
  if (input.incident?.triage) return input.incident.triage;
  const status = input.status || "action_required";
  const severity = normalizeSeverity(input.severity || "warning");
  const score = status === "resolved" ? 0
    : Math.max(0, Math.min(100,
      Number(input.priority || 50)
      + (severity === "critical" ? 12 : severity === "warning" ? 5 : 0)
      + (steps.some((step) => step.kind === "operator_action") ? 8 : 0)
      + (input.process?.status === "failed" ? 8 : 0),
    ));
  return {
    score,
    queue: status === "resolved" ? "closed" : score >= 90 ? "page" : score >= 68 ? "action" : score >= 38 ? "watch" : "backlog",
    nextAction: steps.find((step) => step.kind === "operator_action")?.commandAction || steps[0]?.id || "inspect",
    ownerRequired: Boolean(input.incident && !input.incident.owner),
    reasonCodes: uniqueValues([...(input.reasonCodes || []), status, severity, input.kind].filter(Boolean)),
  };
}

function classifyRunbook({ incident, notification, workflow, process } = {}) {
  const guardrail = String(incident?.guardrailType || notification?.reasonCodes?.join(" ") || "").toUpperCase();
  const text = [guardrail, incident?.title, incident?.message, notification?.title, notification?.message, workflow?.error?.message, process?.error?.message].filter(Boolean).join(" ").toUpperCase();
  if (incident?.kind === "data_quality" || text.includes("DATA_QUALITY") || text.includes("QUALIT")) return "data_quality_issue";
  if (text.includes("LEASE")) return "lease_expired";
  if (text.includes("TELEMETRY") || text.includes("TÉLÉMÉTRIE") || text.includes("COVERAGE")) return "telemetry_missing";
  if (text.includes("BUDGET") || text.includes("COST") || text.includes("COÛT")) return "cost_budget_breach";
  if (process?.status === "failed" || text.includes("GPT") && text.includes("FAIL")) return "gpt_failure";
  if (workflow?.status === "blocked" || workflow?.status === "failed" || text.includes("BLOCK")) return "workflow_blocked";
  return "incident_response";
}

function runbookTitle(kind, targetTitle) {
  const labels = {
    lease_expired: "Runbook lease GPT",
    workflow_blocked: "Runbook workflow bloqué",
    gpt_failure: "Runbook échec GPT",
    telemetry_missing: "Runbook télémétrie manquante",
    cost_budget_breach: "Runbook budget/coût GPT",
    data_quality_issue: "Runbook data quality",
    incident_response: "Runbook incident",
  };
  return `${labels[kind] || "Runbook"} · ${targetTitle || "Desk"}`;
}

function runbookSteps(kind, context = {}) {
  const steps = [
    {
      id: "inspect_context",
      kind: "investigation",
      title: "Inspecter le contexte canonique",
      description: "Lire l’incident, la notification et le workflow liés avant toute mutation.",
      href: context.incident?.id ? `/operations/incidents?incident=${encodeURIComponent(context.incident.id)}` : context.workflowId ? `/operations/workflows/${encodeURIComponent(context.workflowId)}` : "/operations",
    },
  ];
  if (context.processId && context.runId) {
    steps.push({
      id: "inspect_gpt_process",
      kind: "investigation",
      title: "Ouvrir le processus GPT",
      description: "Vérifier le prompt, le save target, le lease, la conclusion et l’erreur éventuelle.",
      href: `/replay/runs/${encodeURIComponent(context.runId)}/gpt/${encodeURIComponent(context.processId)}`,
    });
  }
  if (kind === "lease_expired") {
    steps.push({
      id: "recover_or_retry_work",
      kind: "operator_action",
      title: "Relancer ou reprendre le travail",
      description: "Si le work item est récupérable, utiliser l’action retry/resume du workflow; sinon assigner l’incident et documenter la cause.",
      href: context.workflowId ? workflowActionHref(context.workflowId, "retry") : "/operations",
      commandAction: "retry",
    });
  } else if (kind === "workflow_blocked" || kind === "gpt_failure") {
    steps.push({
      id: "retry_or_cancel_workflow",
      kind: "operator_action",
      title: "Décider retry, resume ou cancel",
      description: "Appliquer uniquement une action disponible côté backend avec révision attendue et justification.",
      href: context.workflowId ? workflowActionHref(context.workflowId, "retry") : "/operations",
      commandAction: "retry",
    });
  } else if (kind === "telemetry_missing") {
    steps.push({
      id: "verify_telemetry_source",
      kind: "investigation",
      title: "Vérifier la source télémétrie",
      description: "Contrôler si le connecteur GPT a fourni tokens/coût mesurés; ne pas extrapoler de coût.",
      href: "/operations/observability",
    });
  } else if (kind === "cost_budget_breach") {
    steps.push({
      id: "review_cost_policy",
      kind: "operator_action",
      title: "Revoir la policy budget",
      description: "Comparer coût mesuré et limites configurées avant de modifier les seuils.",
      href: "/operations/observability",
      commandAction: "update_policy",
    });
  } else if (kind === "data_quality_issue") {
    steps.push({
      id: "audit_data_quality",
      kind: "investigation",
      title: "Auditer la donnée source",
      description: "Vérifier pack, cutoff, bougies et disponibilité avant de relancer le workflow.",
      href: "/audit",
    });
  }
  if (context.notification?.id) {
    steps.push({
      id: "mark_notification_read",
      kind: "operator_action",
      title: "Marquer la notification comme lue",
      description: "Quand la prise en charge est réelle, acquitter l’outbox locale.",
      href: "/operations/notifications",
      commandAction: "mark_read",
    });
  }
  if (context.incident?.id) {
    steps.push({
      id: "resolve_incident",
      kind: "operator_action",
      title: "Résoudre l’incident après preuve",
      description: "Ne résoudre qu’après vérification de l’état canonique et preuve dans la timeline.",
      href: `/operations/incidents?incident=${encodeURIComponent(context.incident.id)}`,
      commandAction: "resolve",
    });
  }
  return steps.map((step, index) => ({ ...step, index: index + 1 }));
}

function runbookLinks({ notification, incident, workflow, process, runId, processId, workflowId }) {
  return [
    notification?.id ? { label: "Notification", href: "/operations/notifications", kind: "notification" } : null,
    incident?.id ? { label: "Incident", href: `/operations/incidents?incident=${encodeURIComponent(incident.id)}`, kind: "incident" } : null,
    workflowId ? { label: "Workflow", href: `/operations/workflows/${encodeURIComponent(workflowId)}`, kind: "workflow" } : null,
    processId && runId ? { label: "GPT process", href: `/replay/runs/${encodeURIComponent(runId)}/gpt/${encodeURIComponent(processId)}`, kind: "gpt_process" } : null,
    workflow?.sourceId ? { label: "Replay", href: `/replay/runs/${encodeURIComponent(workflow.sourceId)}`, kind: "replay" } : null,
    process?.runId ? { label: "Replay", href: `/replay/runs/${encodeURIComponent(process.runId)}`, kind: "replay" } : null,
  ].filter(Boolean);
}

function normalizeRunbookTimeline(timeline = [], input = {}) {
  const base = normalizeNotificationTimeline(timeline.length ? timeline : input.incident?.timeline || []);
  return base.map((event) => ({ ...event, source: input.notification ? "notification" : input.incident ? "incident" : "workflow" })).slice(-20);
}

function runbookMatches(item = {}, filters = {}) {
  if (filters.runbook && item.id !== filters.runbook && item.sourceId !== filters.runbook) return false;
  if (filters.incident && item.incidentId !== filters.incident && item.sourceId !== `incident:${filters.incident}`) return false;
  if (filters.process && item.processId !== filters.process) return false;
  if (filters.workflow && item.workflowId !== filters.workflow && item.context?.workflow !== filters.workflow) return false;
  if (filters.runId && item.runId !== filters.runId) return false;
  if (filters.target && ![item.id, item.sourceId, item.incidentId, item.workflowId, item.processId, item.runId].filter(Boolean).includes(filters.target)) return false;
  if (filters.kind && item.kind !== filters.kind) return false;
  if (filters.status && item.status !== filters.status) return false;
  if (filters.level && item.severity !== filters.level) return false;
  if (filters.session && item.session !== filters.session) return false;
  if (!dateMatches(item.tradingDate, filters)) return false;
  if (filters.q && !runbookSearchText(item).includes(String(filters.q).toLowerCase())) return false;
  return true;
}

function runbookSearchText(item = {}) {
  return [
    item.id, item.sourceId, item.kind, item.title, item.summary, item.severity, item.status, item.notificationId,
    item.incidentId, item.workflowId, item.runId, item.processId, item.owner, item.context?.workflow, item.context?.worker,
  ].filter(Boolean).join(" ").toLowerCase();
}

function byRunbookPriority(left, right) {
  const statusRank = { action_required: 0, waiting: 1, watching: 2, resolved: 3 };
  return (statusRank[left.status] ?? 9) - (statusRank[right.status] ?? 9)
    || Number(right.priority || 0) - Number(left.priority || 0)
    || severityRank(right.severity) - severityRank(left.severity)
    || String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
}

function runbookSummary(items = []) {
  return {
    actionRequired: items.filter((item) => item.status === "action_required").length,
    waiting: items.filter((item) => item.status === "waiting").length,
    watching: items.filter((item) => item.status === "watching").length,
    critical: items.filter((item) => item.severity === "critical").length,
    warning: items.filter((item) => item.severity === "warning").length,
    leaseExpired: items.filter((item) => item.kind === "lease_expired").length,
    workflowBlocked: items.filter((item) => item.kind === "workflow_blocked").length,
    gptFailure: items.filter((item) => item.kind === "gpt_failure").length,
    dataQuality: items.filter((item) => item.kind === "data_quality_issue").length,
  };
}

function safeIdPart(value) {
  return String(value || "id").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "id";
}

function contract(name, payload) {
  return { contract: name, schemaVersion: OPERATIONS_CONTRACT_VERSION, ...payload };
}

function normalizeStatus(value) {
  const status = String(value || "UNKNOWN").toUpperCase();
  if (TERMINAL.has(status)) return status === "FAILED" ? "failed" : status === "CANCELLED" ? "cancelled" : "completed";
  if (WAITING_GPT.has(status) || status.includes("WAITING_GPT")) return "waiting_gpt";
  if (BLOCKED.has(status) || status.includes("BLOCK")) return "blocked";
  if (ACTIVE.has(status) || status.includes("RUNNING") || status.includes("PREPARING") || status.includes("ADVANCING") || status.includes("SAVED") || status.includes("MATERIALIZED") || status.includes("UPDATED")) return "running";
  if (["PAUSED", "SNOOZED"].includes(status)) return "paused";
  if (["QUEUED", "CREATED", "PENDING", "IDLE"].includes(status)) return "queued";
  return status === "UNKNOWN" ? "unknown" : "running";
}

function allowedWorkflowActions(workflow) {
  if (["completed", "cancelled"].includes(workflow.status)) return [];
  if (workflow.kind === "replay") {
    if (workflow.status === "paused") return ["resume", "cancel"];
    if (workflow.status === "failed") return workflow.currentWorkItemId ? ["retry", "cancel"] : ["cancel"];
    if (workflow.status === "blocked") return ["resume", "cancel"];
    return ["pause", "cancel"];
  }
  return [];
}

function validateCommandInput(input) {
  if (!input || typeof input !== "object") throw invalid("INVALID_OPERATIONS_COMMAND", "Commande requise.");
  if (!String(input.action || "").trim()) throw invalid("INVALID_OPERATIONS_COMMAND", "action requise.");
  if (!Number.isInteger(Number(input.expectedRevision)) || Number(input.expectedRevision) < 0) throw invalid("INVALID_OPERATIONS_COMMAND", "expectedRevision invalide.");
  if (String(input.idempotencyKey || "").length < 8) throw invalid("INVALID_OPERATIONS_COMMAND", "idempotencyKey doit contenir au moins 8 caractères.");
  if (String(input.reason || "").trim().length < 3) throw invalid("INVALID_OPERATIONS_COMMAND", "reason doit contenir au moins 3 caractères.");
  const phrase = `CONFIRM_${String(input.action || "").toUpperCase()}`;
  if (input.confirmationPhrase !== phrase) throw invalid("CONFIRMATION_REQUIRED", `Phrase attendue : ${phrase}`);
}

function assignAttempts(items) {
  const counters = new Map();
  return [...items].sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt))).map((item) => {
    const key = `${item.session || "global"}:${item.variantId || "default"}`;
    const attempt = (counters.get(key) || 0) + 1;
    counters.set(key, attempt);
    return { ...item, sessionExecutionId: item.sourceId, attempt, variantId: item.variantId || "default" };
  });
}

function collectCandles(value, output, depth = 0) {
  if (!value || depth > 7 || output.length > 6000) return;
  if (Array.isArray(value)) {
    for (const item of value) collectCandles(item, output, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const time = value.timestamp_paris || value.timestamp_utc || value.time || value.datetime || value.date;
  const close = firstNumber(value.close, value.c, value.price);
  if (time && close !== null && ("open" in value || "high" in value || "low" in value || "close" in value || "c" in value)) {
    output.push({
      time: String(time),
      open: firstNumber(value.open, value.o, close),
      high: firstNumber(value.high, value.h, close),
      low: firstNumber(value.low, value.l, close),
      close,
      volume: firstNumber(value.volume, value.v),
      source: value.source || "replay_bundle",
    });
  }
  for (const [key, child] of Object.entries(value)) {
    if (["raw_payload", "prompt", "execution_prompt"].includes(key)) continue;
    collectCandles(child, output, depth + 1);
  }
}

function workflowRelations(workflow, steps, events) {
  return {
    replayRunId: workflow.kind === "replay" ? workflow.sourceId : null,
    currentStepId: workflow.currentStepId,
    currentWorkItemId: workflow.currentWorkItemId,
    stepIds: steps.map((item) => item.id),
    eventIds: events.map((item) => item.id),
  };
}

function buildWorkflowCommandCenter(workflow, allowedActions = [], commands = [], commandEvents = [], events = []) {
  const actionSet = new Set(allowedActions);
  const history = normalizeWorkflowCommandHistory(workflow, commands, commandEvents);
  const last = history[0] || null;
  return {
    status: workflow.status,
    expectedRevision: workflow.revision,
    recommendedAction: recommendedWorkflowAction(workflow, allowedActions),
    actions: ["retry", "resume", "pause", "cancel"].map((action) => workflowActionDescriptor(action, workflow, actionSet.has(action))),
    commandBus: {
      targetType: "workflow",
      targetId: workflow.id,
      pending: history.filter((item) => item.status === "PENDING").length,
      applied: history.filter((item) => item.status === "APPLIED").length,
      failed: history.filter((item) => item.status === "FAILED").length,
      lastCommandAt: last?.updatedAt || last?.createdAt || null,
      lastAction: last?.action || null,
      history,
    },
    audit: {
      events: events.filter((event) => event.type === "APPLIED" || event.type === "FAILED" || event.ref?.command_id).slice(-12),
      eventCount: events.length,
    },
    links: workflowCommandLinks(workflow, allowedActions),
  };
}

function workflowActionDescriptor(action, workflow, enabled) {
  const labels = {
    retry: "Retry contrôlé",
    resume: "Resume automation",
    pause: "Pause automation",
    cancel: "Cancel workflow",
  };
  const reasons = {
    retry: "Relancer uniquement après inspection de l’erreur et du work item courant.",
    resume: "Réactiver une automation pausée/bloquée après vérification des préconditions.",
    pause: "Geler temporairement l’automation sans supprimer l’état canonique.",
    cancel: "Arrêter le workflow ; action irréversible côté opérateur.",
  };
  const tones = { retry: "warning", resume: "positive", pause: "info", cancel: "critical" };
  return {
    action,
    label: labels[action] || action,
    tone: tones[action] || "neutral",
    enabled,
    recommended: recommendedWorkflowAction(workflow, [action]) === action,
    confirmationPhrase: `CONFIRM_${String(action).toUpperCase()}`,
    expectedRevision: workflow.revision,
    reason: reasons[action] || "Action opérateur contrôlée par révision et idempotence.",
    disabledReason: enabled ? null : disabledWorkflowActionReason(action, workflow),
    href: `/operations/workflows/${encodeURIComponent(workflow.id)}?action=${encodeURIComponent(action)}#command-center`,
  };
}

function disabledWorkflowActionReason(action, workflow) {
  if (["completed", "cancelled"].includes(workflow.status)) return "Workflow terminal.";
  if (action === "retry" && workflow.status !== "failed") return "Retry réservé aux échecs récupérables.";
  if (action === "resume" && !["paused", "blocked"].includes(workflow.status)) return "Resume réservé aux workflows pausés ou bloqués.";
  if (action === "pause" && workflow.kind !== "replay") return "Pause disponible uniquement pour l’automation replay.";
  if (action === "cancel") return "Cancel indisponible pour cet état.";
  return "Action non exposée par le backend pour cet état.";
}

function recommendedWorkflowAction(workflow, allowedActions = []) {
  if (!allowedActions.length) return null;
  if (workflow.status === "failed" && allowedActions.includes("retry")) return "retry";
  if (["blocked", "paused"].includes(workflow.status) && allowedActions.includes("resume")) return "resume";
  if (workflow.status === "waiting_gpt" && allowedActions.includes("pause")) return "pause";
  if (workflow.error && allowedActions.includes("retry")) return "retry";
  return allowedActions[0] || null;
}

function normalizeWorkflowCommandHistory(workflow, commands = [], commandEvents = []) {
  const ids = new Set([workflow.id, workflow.sourceId].filter(Boolean));
  const matching = commands
    .filter((item) => item.target_type === "workflow")
    .filter((item) => ids.has(item.target_id) || ids.has(String(item.result?.workflow?.id || "")) || ids.has(String(item.result?.workflow?.sourceId || "")));
  const eventsByCommand = groupBy(commandEvents, (event) => event.command_id || "");
  return matching.map((item) => {
    const events = normalizeCommandEvents(eventsByCommand.get(item.command_id) || []);
    return {
      id: item.command_id,
      action: item.action,
      status: item.status || "UNKNOWN",
      expectedRevision: Number(item.expected_revision || 0),
      idempotencyKey: item.idempotency_key || null,
      actor: actorLabel(item.actor),
      reason: item.reason || null,
      error: publicError(item.error),
      resultStatus: item.result?.workflow?.status || null,
      createdAt: item.created_at_utc || null,
      updatedAt: item.updated_at_utc || item.created_at_utc || null,
      events,
    };
  }).sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""))).slice(0, 20);
}

function normalizeCommandEvents(events = []) {
  return events.map((event) => ({
    id: event.event_id || event.id || hashObject(event).slice(0, 20),
    type: event.event_type || "EVENT",
    at: event.created_at_utc || event.at || null,
    actor: actorLabel(event.actor),
    reason: event.reason || null,
    status: event.event_type || "UNKNOWN",
    error: publicError(event.error),
  })).sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
}

function workflowCommandLinks(workflow, allowedActions = []) {
  const recommended = recommendedWorkflowAction(workflow, allowedActions);
  return [
    recommended ? { label: `Préparer ${recommended}`, href: `/operations/workflows/${encodeURIComponent(workflow.id)}?action=${encodeURIComponent(recommended)}#command-center`, kind: "workflow_action", action: recommended } : null,
    workflow.kind === "replay" ? { label: "Replay Lab", href: `/replay/runs/${encodeURIComponent(workflow.sourceId)}`, kind: "replay" } : null,
    workflow.currentWorkItemId && workflow.sourceId ? { label: "GPT courant", href: `/replay/runs/${encodeURIComponent(workflow.sourceId)}/gpt/${encodeURIComponent(workflow.currentWorkItemId)}`, kind: "gpt" } : null,
    workflow.tradingDate ? { label: "Historique session", href: `/history/sessions/${encodeURIComponent(`${workflow.tradingDate}:${workflow.session || "global"}`)}`, kind: "history" } : null,
  ].filter(Boolean);
}

function eventMatchesWorkflow(event, workflow) {
  const ids = [event.backtest_id, event.replay_run_id, event.run_id, event.job_id, event.target_id, event.workflow_id, event.result?.workflow?.sourceId];
  return ids.includes(workflow.sourceId) || ids.includes(workflow.id);
}

function workflowMatches(item, filters) {
  if (filters.kind && item.kind !== filters.kind) return false;
  if (filters.status && item.status !== filters.status) return false;
  if (filters.session && item.session !== filters.session) return false;
  if (filters.strategyId && item.strategyId !== filters.strategyId) return false;
  if (!dateMatches(item.tradingDate, filters)) return false;
  if (filters.q) {
    const search = `${item.name} ${item.sourceId} ${item.rawStatus}`.toLowerCase();
    if (!search.includes(String(filters.q).toLowerCase())) return false;
  }
  return true;
}

function buildHistorySessions(workflows, incidents, dailySeries) {
  const performanceByDate = new Map((dailySeries || []).map((item) => [item.date, item]));
  return [...groupBy(workflows, (item) => `${item.tradingDate || "unknown"}:${item.session || "global"}`).entries()]
    .map(([key, items]) => {
      const tradingDate = items[0]?.tradingDate || null;
      const session = items[0]?.session || null;
      const relatedIncidents = incidents.filter((item) => (
        item.tradingDate === tradingDate
        && (!item.session || item.session === session)
      ));
      const starts = items.map((item) => item.startedAt).filter(Boolean).sort();
      const completions = items.map((item) => item.completedAt).filter(Boolean).sort();
      const updates = items.map((item) => item.updatedAt).filter(Boolean).sort();
      const statusCounts = countBy(items, (item) => item.status);
      const kindCounts = countBy(items, (item) => item.kind);
      return {
        id: key,
        tradingDate,
        session,
        status: aggregateStatus(items.map((item) => item.status)),
        workflowCount: items.length,
        progress: average(items.map((item) => item.progress)),
        totalR: roundPerformance(sum(items.map((item) => item.metrics?.totalR))),
        gptProcesses: sum(items.map((item) => item.metrics?.gptProcesses)),
        incidentCount: relatedIncidents.length,
        kinds: uniqueValues(items.map((item) => item.kind)),
        strategies: uniqueValues(items.map((item) => item.strategyId)),
        startedAt: starts[0] || null,
        completedAt: completions.at(-1) || null,
        updatedAt: updates.at(-1) || null,
        durationMs: sum(items.map((item) => item.durationMs)),
        performance: performanceByDate.get(tradingDate) || null,
        workflows: items,
        statusCounts,
        kindCounts,
        riskFlags: historyRiskFlags(items, relatedIncidents),
        automationScore: historyAutomationScore(items, relatedIncidents),
        links: buildHistorySessionLinks({ id: key, tradingDate, session, workflows: items }),
      };
    })
    .sort((a, b) => (
      String(b.tradingDate).localeCompare(String(a.tradingDate))
      || String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
      || String(a.session || "").localeCompare(String(b.session || ""))
    ));
}

function buildHistoryGovernance(workflows, sessions, incidents, audits) {
  const auditTrail = buildHistoryAuditTrail(audits, workflows, incidents).slice(0, 18);
  return {
    statusMatrix: buildHistoryMatrix(workflows, incidents, (item) => item.status, (label) => `/history?status=${encodeURIComponent(label)}`),
    kindMatrix: buildHistoryMatrix(workflows, incidents, (item) => item.kind, (label) => `/history?kind=${encodeURIComponent(label)}`),
    sessionMatrix: buildHistoryMatrix(workflows, incidents, (item) => item.session || "global", (label) => `/history?session=${encodeURIComponent(label)}`),
    strategyMatrix: buildHistoryMatrix(workflows, incidents, (item) => item.strategyId || "unassigned", (label) => `/history?strategy=${encodeURIComponent(label)}`),
    incidentMatrix: buildIncidentHistoryMatrix(incidents),
    auditTrail,
    riskFlags: historyRiskFlags(workflows, incidents),
    automationScore: historyAutomationScore(workflows, incidents),
    sessions: sessions.map((session) => ({
      id: session.id,
      tradingDate: session.tradingDate,
      session: session.session,
      status: session.status,
      workflowCount: session.workflowCount,
      progress: session.progress,
      totalR: session.totalR,
      gptProcesses: session.gptProcesses,
      incidentCount: session.incidentCount,
      updatedAt: session.updatedAt,
      riskFlags: session.riskFlags,
      href: `/history/sessions/${encodeURIComponent(session.id)}`,
    })).slice(0, 30),
  };
}

function buildHistoryMatrix(workflows, incidents, select, hrefFor) {
  return [...groupBy(workflows, (item) => String(select(item) || "unknown")).entries()]
    .map(([label, items]) => {
      const statuses = countBy(items, (item) => item.status);
      const relatedIncidents = countRelatedIncidents(items, incidents);
      const totalR = roundPerformance(sum(items.map((item) => item.metrics?.totalR)));
      return {
        label,
        count: items.length,
        totalR,
        gptProcesses: sum(items.map((item) => item.metrics?.gptProcesses)),
        incidents: relatedIncidents,
        progress: average(items.map((item) => item.progress)),
        statuses,
        kinds: uniqueValues(items.map((item) => item.kind)),
        sessions: uniqueValues(items.map((item) => item.session)),
        strategies: uniqueValues(items.map((item) => item.strategyId)),
        updatedAt: items.map((item) => item.updatedAt).filter(Boolean).sort().at(-1) || null,
        href: hrefFor ? hrefFor(label, items) : null,
        tone: historyMatrixTone(label, statuses, relatedIncidents, totalR),
      };
    })
    .sort((a, b) => (
      Number(Boolean(b.incidents)) - Number(Boolean(a.incidents))
      || b.count - a.count
      || Number(b.totalR) - Number(a.totalR)
      || a.label.localeCompare(b.label)
    ));
}

function buildGptHistoryMatrix(processes = []) {
  return [...groupBy(processes, (item) => item.status || "unknown").entries()]
    .map(([label, items]) => ({
      label,
      count: items.length,
      totalR: 0,
      gptProcesses: items.length,
      incidents: 0,
      progress: average(items.map((item) => item.status === "completed" ? 100 : item.status === "failed" ? 0 : 50)),
      statuses: countBy(items, (item) => item.status),
      kinds: uniqueValues(items.map((item) => item.workflow)),
      sessions: [],
      strategies: [],
      updatedAt: items.map((item) => item.updatedAt).filter(Boolean).sort().at(-1) || null,
      href: null,
      tone: historyMatrixTone(label, countBy(items, (item) => item.status), 0, 0),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildEventHistoryMatrix(events = []) {
  return [...groupBy(events, (item) => item.layer || "event").entries()]
    .map(([label, items]) => ({
      label,
      count: items.length,
      totalR: 0,
      gptProcesses: items.filter((item) => item.layer === "gpt" || item.processId).length,
      incidents: 0,
      progress: 0,
      statuses: countBy(items, (item) => item.status),
      kinds: uniqueValues(items.map((item) => item.type)),
      sessions: [],
      strategies: [],
      updatedAt: items.map((item) => item.at).filter(Boolean).sort().at(-1) || null,
      href: "#timeline-events",
      tone: historyMatrixTone(label, countBy(items, (item) => item.status), 0, 0),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildIncidentHistoryMatrix(incidents = []) {
  return [...groupBy(incidents, (item) => item.lifecycleStatus || "open").entries()]
    .map(([label, items]) => ({
      label,
      count: items.length,
      critical: items.filter((item) => item.severity === "critical").length,
      warning: items.filter((item) => item.severity === "warning").length,
      sessions: uniqueValues(items.map((item) => item.session)),
      updatedAt: items.map((item) => item.updatedAt).filter(Boolean).sort().at(-1) || null,
      tone: items.some((item) => item.severity === "critical") ? "critical" : items.length ? "warning" : "neutral",
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildHistoryDecisionFlow(timeline = [], gptProcesses = []) {
  const processById = new Map(gptProcesses.map((item) => [item.id, item]));
  const eventItems = timeline
    .filter((event) => (
      event.layer === "decision"
      || event.layer === "gpt"
      || event.decision
      || event.conclusion
      || /GPT|MONITOR|MASTER|SAVED|CLAIM|COMPLETE|FAIL/i.test(`${event.type} ${event.title}`)
    ))
    .map((event) => historyDecisionFromEvent(event, processById.get(event.processId)));
  const seen = new Set(eventItems.map((item) => item.processId).filter(Boolean));
  const processItems = gptProcesses
    .filter((process) => !seen.has(process.id))
    .map((process) => historyDecisionFromProcess(process));
  return [...eventItems, ...processItems]
    .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")))
    .slice(-80);
}

function historyDecisionFromEvent(event, process = null) {
  const processId = event.processId || process?.id || null;
  const runId = event.runId || process?.runId || null;
  return {
    id: event.id,
    at: event.at || process?.updatedAt || null,
    type: event.type,
    title: event.title || event.type,
    status: event.status,
    layer: event.layer || (processId ? "gpt" : "event"),
    workflowId: event.workflowId || (runId ? `replay:${runId}` : null),
    workflowName: event.workflowName || process?.workflow || null,
    runId,
    processId,
    decision: event.decision || process?.decision || null,
    conclusion: event.conclusion || process?.conclusion || null,
    detail: event.detail || process?.conclusion || process?.error?.message || "",
    telemetry: process?.telemetry ? {
      model: process.telemetry.model,
      totalTokens: process.telemetry.totalTokens,
      costUsd: process.telemetry.costUsd,
    } : null,
    href: historyDecisionHref(runId, processId, event.workflowId),
  };
}

function historyDecisionFromProcess(process) {
  return {
    id: process.id,
    at: process.completedAt || process.updatedAt,
    type: process.workflow,
    title: process.workflow,
    status: process.status,
    layer: "gpt",
    workflowId: process.runId ? `replay:${process.runId}` : null,
    workflowName: process.workflow,
    runId: process.runId,
    processId: process.id,
    decision: process.decision,
    conclusion: process.conclusion,
    detail: process.error?.message || process.rawStatus,
    telemetry: process.telemetry ? {
      model: process.telemetry.model,
      totalTokens: process.telemetry.totalTokens,
      costUsd: process.telemetry.costUsd,
    } : null,
    href: historyDecisionHref(process.runId, process.id, process.runId ? `replay:${process.runId}` : null),
  };
}

function historyDecisionHref(runId, processId, workflowId) {
  if (runId && processId) return `/replay/runs/${encodeURIComponent(runId)}/gpt/${encodeURIComponent(processId)}`;
  if (workflowId) return `/operations/workflows/${encodeURIComponent(workflowId)}`;
  return null;
}

function buildHistoryAuditTrail(audits = [], workflows = [], incidents = []) {
  const auditItems = audits
    .filter((item) => auditMatchesWorkflows(item, workflows))
    .map(normalizeHistoryAuditItem);
  const incidentItems = incidents.map(incidentToHistoryAudit);
  return [...auditItems, ...incidentItems]
    .filter(Boolean)
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
}

function normalizeHistoryAuditItem(item = {}) {
  const runId = item.backtest_id || item.run_id || item.replay_run_id || null;
  const jobId = item.job_id || null;
  const workflowId = item.workflow_id || (runId ? `replay:${runId}` : jobId ? `job:${jobId}` : null);
  const processId = item.work_item_id || item.process_id || null;
  const type = item.event_type || item.action || item.type || item.kind || "AUDIT";
  return {
    id: item.audit_id || item.event_id || item.id || hashObject(item).slice(0, 20),
    at: eventTime(item),
    type,
    title: item.title || item.action || item.event_type || item.kind || "Audit",
    message: item.message || item.reason || item.note || "",
    status: normalizeStatus(item.status || item.lifecycle_status || item.event_type),
    severity: normalizeSeverity(item.severity || item.level || (/FAIL|ERROR|BLOCK/i.test(type) ? "critical" : "info")),
    actor: actorLabel(item.actor || item.performed_by),
    workflowId,
    runId,
    processId,
    href: historyDecisionHref(runId, processId, workflowId),
  };
}

function incidentToHistoryAudit(incident = {}) {
  const workflowId = incident.runId ? `replay:${incident.runId}` : null;
  return {
    id: `incident:${incident.id}`,
    at: incident.updatedAt || incident.createdAt,
    type: `INCIDENT_${String(incident.lifecycleStatus || "open").toUpperCase()}`,
    title: incident.title || incident.kind || "Incident",
    message: incident.message || "",
    status: incident.lifecycleStatus || "open",
    severity: incident.severity || "warning",
    actor: incident.owner || incident.source || "system",
    workflowId,
    runId: incident.runId || null,
    processId: incident.processId || null,
    href: `/operations/incidents?incident=${encodeURIComponent(incident.id)}`,
  };
}

function auditMatchesWorkflows(item = {}, workflows = []) {
  if (!workflows.length) return true;
  const ids = new Set(workflows.flatMap((workflow) => [workflow.id, workflow.sourceId]).filter(Boolean));
  const runId = item.backtest_id || item.run_id || item.replay_run_id || item.workflow_id || item.job_id || null;
  if (runId && (ids.has(runId) || ids.has(`replay:${runId}`) || ids.has(`job:${runId}`))) return true;
  const date = historyAuditDate(item);
  const session = item.session || null;
  return workflows.some((workflow) => (
    workflow.tradingDate
    && date === workflow.tradingDate
    && (!session || !workflow.session || session === workflow.session)
  ));
}

function actorLabel(actor) {
  if (!actor) return "system";
  if (typeof actor === "string") return actor;
  return actor.email || actor.uid || actor.kind || actor.name || "operator";
}

function countRelatedIncidents(workflows = [], incidents = []) {
  const ids = new Set(workflows.flatMap((workflow) => [workflow.id, workflow.sourceId]).filter(Boolean));
  return incidents.filter((incident) => {
    if (incident.runId && (ids.has(incident.runId) || ids.has(`replay:${incident.runId}`))) return true;
    return workflows.some((workflow) => (
      workflow.tradingDate
      && incident.tradingDate === workflow.tradingDate
      && (!incident.session || !workflow.session || incident.session === workflow.session)
    ));
  }).length;
}

function historyRiskFlags(workflows = [], incidents = []) {
  return [
    workflows.some((item) => item.status === "failed") ? "WORKFLOW_FAILED" : null,
    workflows.some((item) => item.status === "blocked") ? "WORKFLOW_BLOCKED" : null,
    workflows.some((item) => item.status === "waiting_gpt") ? "WAITING_GPT" : null,
    incidents.some((item) => item.severity === "critical" && !["resolved", "archived"].includes(item.lifecycleStatus)) ? "CRITICAL_INCIDENT" : null,
    incidents.some((item) => item.lifecycleStatus === "open") ? "OPEN_INCIDENT" : null,
    workflows.some((item) => item.error) ? "ERROR_ATTACHED" : null,
  ].filter(Boolean);
}

function historyAutomationScore(workflows = [], incidents = []) {
  if (!workflows.length) return 0;
  const completedScore = workflows.filter((item) => item.status === "completed").length / workflows.length;
  const progressScore = average(workflows.map((item) => item.progress)) / 100;
  const incidentPenalty = Math.min(0.45, incidents.filter((item) => !["resolved", "archived"].includes(item.lifecycleStatus)).length * 0.12);
  return Math.max(0, Math.min(100, Math.round(((completedScore * 0.55) + (progressScore * 0.45) - incidentPenalty) * 100)));
}

function historyMatrixTone(label, statuses = {}, incidents = 0, totalR = 0) {
  const normalized = String(label || "").toLowerCase();
  if (normalized.includes("failed") || statuses.failed || incidents > 0) return incidents > 0 ? "warning" : "critical";
  if (normalized.includes("blocked") || statuses.blocked) return "warning";
  if (normalized.includes("waiting") || statuses.waiting_gpt) return "info";
  if (Number(totalR) < 0) return "critical";
  if (Number(totalR) > 0 || statuses.completed) return "positive";
  return "neutral";
}

function buildHistorySessionLinks(session = {}, gptProcesses = []) {
  const firstReplay = (session.workflows || []).find((workflow) => workflow.kind === "replay");
  const params = new URLSearchParams();
  if (session.tradingDate) params.set("date", session.tradingDate);
  if (session.session) params.set("session", session.session);
  const links = [
    session.session ? { label: "Cockpit filtré", href: `/operations?session=${encodeURIComponent(session.session)}`, kind: "workflow" } : null,
    { label: "Performance", href: `/performance/analysis${params.toString() ? `?${params.toString()}` : ""}`, kind: "performance" },
    firstReplay?.sourceId && session.tradingDate ? { label: "Replay day", href: `/replay/runs/${encodeURIComponent(firstReplay.sourceId)}/days/${encodeURIComponent(session.tradingDate)}`, kind: "replay" } : null,
    firstReplay?.sourceId ? { label: "Workflow replay", href: `/operations/workflows/${encodeURIComponent(firstReplay.id)}`, kind: "workflow" } : null,
    gptProcesses[0]?.runId && gptProcesses[0]?.id ? { label: "Dernier GPT", href: `/replay/runs/${encodeURIComponent(gptProcesses[0].runId)}/gpt/${encodeURIComponent(gptProcesses[0].id)}`, kind: "gpt" } : null,
  ].filter(Boolean);
  return links;
}

function dateMatches(date, filters) {
  if (filters.date && date !== filters.date) return false;
  if (filters.from && date && date < filters.from) return false;
  if (filters.to && date && date > filters.to) return false;
  return true;
}

function historyAuditDate(item) {
  return item.trading_date || item.date || String(eventTime(item) || "").slice(0, 10) || null;
}

function performanceTotals(daily, trades, equity = [], dailySeries = []) {
  const closed = trades.filter((item) => ["CLOSED", "DONE", "TP", "SL"].includes(String(item.status || "").toUpperCase()) || firstNumber(item.result_R, item.result_r) !== null);
  const tradeValues = closed.map(performanceResult).filter((value) => value !== null);
  const dailyValues = dailySeries.length
    ? dailySeries.map((item) => Number(item.totalR || 0))
    : daily.map((item) => Number(firstNumber(item.total_R, item.total_r, item.result_R) || 0));
  const totalR = roundPerformance(tradeValues.length ? sum(tradeValues) : sum(dailyValues));
  const wins = tradeValues.length ? tradeValues.filter((value) => value > 0).length : sum(daily.map((item) => firstNumber(item.wins) || 0));
  const losses = tradeValues.length ? tradeValues.filter((value) => value < 0).length : sum(daily.map((item) => firstNumber(item.losses) || 0));
  const flats = tradeValues.length ? tradeValues.filter((value) => value === 0).length : Math.max(0, closed.length - wins - losses);
  const tradeCount = tradeValues.length || closed.length || sum(daily.map((item) => firstNumber(item.closed_trades, item.trade_count) || 0));
  const grossProfitR = roundPerformance(sum(tradeValues.filter((value) => value > 0)));
  const grossLossR = roundPerformance(Math.abs(sum(tradeValues.filter((value) => value < 0))));
  const drawdowns = equity.map((item) => Number(item.drawdownR || 0));
  return {
    totalR,
    trades: tradeCount,
    wins,
    losses,
    flats,
    winRate: tradeCount ? wins / tradeCount : null,
    expectancyR: tradeCount ? totalR / tradeCount : null,
    grossProfitR,
    grossLossR,
    profitFactor: grossLossR > 0 ? grossProfitR / grossLossR : grossProfitR > 0 ? null : 0,
    maxDrawdownR: drawdowns.length ? Math.min(...drawdowns) : 0,
    currentDrawdownR: drawdowns.length ? drawdowns.at(-1) : 0,
    bestTradeR: tradeValues.length ? Math.max(...tradeValues) : null,
    worstTradeR: tradeValues.length ? Math.min(...tradeValues) : null,
    bestDayR: dailyValues.length ? Math.max(...dailyValues) : null,
    worstDayR: dailyValues.length ? Math.min(...dailyValues) : null,
    activeDays: dailySeries.length,
    winningDays: dailyValues.filter((value) => value > 0).length,
    losingDays: dailyValues.filter((value) => value < 0).length,
  };
}

function buildBreakdowns(trades, dailySeries) {
  const dimension = (name, key) => ({
    dimension: name,
    items: [...groupBy(trades, (item) => item[key] || item[camelCase(key)] || "unknown").entries()]
      .map(([label, items]) => ({ label, ...performanceTotals([], items) }))
      .sort((a, b) => Number(b.totalR) - Number(a.totalR)),
  });
  return [dimension("strategy", "strategy_id"), dimension("session", "session"), dimension("instrument", "instrument"), dimension("direction", "direction"), {
    dimension: "day",
    items: [...dailySeries].reverse().map((item) => ({ label: item.date, totalR: item.totalR, trades: item.trades, winRate: item.winRate })),
  }];
}

function buildPerformanceAttribution(trades, dailySeries, runs) {
  const dimensions = [
    ["strategy", "strategy_id"],
    ["session", "session"],
    ["instrument", "instrument"],
    ["direction", "direction"],
  ];
  return dimensions.map(([dimension, key]) => {
    const rawItems = [...groupBy(trades, (item) => item[key] || item[camelCase(key)] || "unknown").entries()]
      .map(([label, items]) => {
        const totals = performanceTotals([], items);
        const values = items.map(performanceResult).filter((value) => value !== null);
        const runIds = relatedRunIdsForTrades(items, runs);
        const days = uniqueValues(items.map(performanceDate));
        return {
          label,
          totalR: totals.totalR,
          trades: totals.trades,
          wins: totals.wins,
          losses: totals.losses,
          winRate: totals.winRate,
          expectancyR: totals.expectancyR,
          bestTradeR: values.length ? Math.max(...values) : null,
          worstTradeR: values.length ? Math.min(...values) : null,
          avgR: totals.trades ? roundPerformance(totals.totalR / totals.trades) : null,
          days,
          runIds,
          sessionIds: uniqueValues(items.map((item) => item.session || item.session_id)),
          strategyIds: uniqueValues(items.map((item) => item.strategy_id || item.strategyId)),
          contributionPct: null,
          tone: totals.totalR > 0 ? "positive" : totals.totalR < 0 ? "negative" : "neutral",
        };
      })
      .sort((a, b) => Number(b.totalR) - Number(a.totalR));
    const denominator = Math.max(0.0001, sum(rawItems.map((item) => Math.abs(Number(item.totalR || 0)))));
    const items = rawItems.map((item) => ({ ...item, contributionPct: roundPerformance(Math.abs(Number(item.totalR || 0)) / denominator) }));
    return {
      dimension,
      best: items[0] || null,
      worst: items.at(-1) || null,
      items,
    };
  }).filter((group) => group.items.length);
}

function buildPerformanceDayDrilldowns(dailySeries, trades, equity, runs) {
  const equityByDay = new Map(equity.filter((item) => item.date).map((item) => [item.date, item]));
  return dailySeries.map((day) => {
    const dayTrades = trades.filter((item) => performanceDate(item) === day.date)
      .map((item) => ({
        id: item.trade_id || item.id || hashObject(item).slice(0, 16),
        runId: item.backtest_id || item.run_id || item.replay_run_id || null,
        strategyId: item.strategy_id || item.strategyId || null,
        session: item.session || item.session_id || null,
        instrument: item.instrument || item.symbol || null,
        direction: item.direction || item.side || null,
        status: item.status || null,
        resultR: performanceResult(item),
        at: performanceTime(item),
      }))
      .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
    const relatedRuns = runs.filter((run) => run.tradingDate === day.date || day.runIds.includes(run.sourceId));
    const values = dayTrades.map((item) => item.resultR).filter((value) => value !== null);
    const best = dayTrades.find((item) => item.resultR === Math.max(...values)) || null;
    const worst = dayTrades.find((item) => item.resultR === Math.min(...values)) || null;
    const point = equityByDay.get(day.date) || null;
    return {
      ...day,
      cumulativeR: point?.cumulativeR ?? null,
      drawdownR: point?.drawdownR ?? null,
      bestTrade: best,
      worstTrade: worst,
      tradeItems: dayTrades,
      relatedRuns: relatedRuns.map((run) => ({
        id: run.id,
        sourceId: run.sourceId,
        session: run.session,
        strategyId: run.strategyId,
        status: run.status,
        totalR: firstNumber(run.metrics?.totalR) || 0,
      })),
    };
  });
}

function relatedRunIdsForTrades(trades, runs) {
  const explicit = uniqueValues(trades.map((item) => item.backtest_id || item.run_id || item.replay_run_id));
  if (explicit.length) return explicit;
  const dates = new Set(trades.map(performanceDate).filter(Boolean));
  const sessions = new Set(trades.map((item) => item.session || item.session_id).filter(Boolean));
  const strategies = new Set(trades.map((item) => item.strategy_id || item.strategyId).filter(Boolean));
  return uniqueValues(runs
    .filter((run) => (!dates.size || dates.has(run.tradingDate)) && (!sessions.size || sessions.has(run.session)) && (!strategies.size || strategies.has(run.strategyId)))
    .map((run) => run.sourceId));
}

function performanceMatches(item, filters = {}) {
  const strategy = item.strategy_id || item.strategyId || null;
  const session = item.session || item.session_id || null;
  const instrument = item.instrument || item.symbol || null;
  const direction = item.direction || item.side || null;
  const date = item.trading_date || item.tradingDate || item.date || null;
  if (filters.strategyId && strategy !== filters.strategyId) return false;
  if (filters.session && session !== filters.session) return false;
  if (filters.instrument && instrument !== filters.instrument) return false;
  if (filters.direction && String(direction).toLowerCase() !== String(filters.direction).toLowerCase()) return false;
  return dateMatches(date, filters);
}

function performanceDate(item) {
  return item.trading_date || item.tradingDate || item.date || null;
}

function buildDailyPerformanceSeries(trades, daily) {
  const tradeValues = trades.map((item) => ({ item, result: performanceResult(item), date: item.trading_date || item.tradingDate || item.date }))
    .filter((entry) => entry.date && entry.result !== null);
  if (tradeValues.length) {
    return [...groupBy(tradeValues, (entry) => entry.date).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, entries]) => {
      const values = entries.map((entry) => entry.result);
      const wins = values.filter((value) => value > 0).length;
      const losses = values.filter((value) => value < 0).length;
      return {
        date,
        totalR: roundPerformance(sum(values)),
        trades: values.length,
        wins,
        losses,
        winRate: values.length ? wins / values.length : null,
        runIds: uniqueValues(entries.map((entry) => entry.item.backtest_id || entry.item.run_id || entry.item.replay_run_id)),
        strategyIds: uniqueValues(entries.map((entry) => entry.item.strategy_id || entry.item.strategyId)),
        sessions: uniqueValues(entries.map((entry) => entry.item.session)),
        source: "trades",
      };
    });
  }
  return [...groupBy(daily.filter((item) => item.date || item.trading_date), (item) => item.date || item.trading_date).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => {
      const totalR = roundPerformance(sum(items.map((item) => firstNumber(item.total_R, item.total_r, item.result_R) || 0)));
      const tradesCount = sum(items.map((item) => firstNumber(item.closed_trades, item.trade_count) || 0));
      const wins = sum(items.map((item) => firstNumber(item.wins) || 0));
      const losses = sum(items.map((item) => firstNumber(item.losses) || 0));
      return {
        date,
        totalR,
        trades: tradesCount,
        wins,
        losses,
        winRate: tradesCount ? wins / tradesCount : null,
        runIds: uniqueValues(items.map((item) => item.backtest_id || item.run_id || item.replay_run_id)),
        strategyIds: uniqueValues(items.map((item) => item.strategy_id || item.strategyId)),
        sessions: uniqueValues(items.map((item) => item.session)),
        source: "daily_performance",
      };
    });
}

function buildPerformanceEquity(trades, persistedEquity, dailySeries) {
  const orderedTrades = trades.map((item) => ({ item, result: performanceResult(item) }))
    .filter((entry) => entry.result !== null)
    .sort((a, b) => String(performanceTime(a.item)).localeCompare(String(performanceTime(b.item))));
  if (orderedTrades.length) return accumulatePerformance(orderedTrades.map((entry, index) => ({
    sequence: index + 1,
    date: entry.item.trading_date || entry.item.tradingDate || entry.item.date || null,
    at: performanceTime(entry.item),
    tradeId: entry.item.trade_id || entry.item.id || null,
    runId: entry.item.backtest_id || entry.item.run_id || entry.item.replay_run_id || null,
    strategyId: entry.item.strategy_id || entry.item.strategyId || null,
    resultR: entry.result,
  })));
  if (persistedEquity.length) return persistedEquity
    .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0) || String(performanceTime(a)).localeCompare(String(performanceTime(b))))
    .map((item, index) => ({
      sequence: Number(item.sequence || index + 1),
      date: item.date || item.trading_date || null,
      at: performanceTime(item),
      tradeId: item.trade_id || null,
      runId: item.backtest_id || item.run_id || null,
      strategyId: item.strategy_id || null,
      resultR: firstNumber(item.result_R, item.result_r) || 0,
      cumulativeR: firstNumber(item.cumulative_R, item.cumulative_r) || 0,
      drawdownR: firstNumber(item.drawdown_R, item.drawdown_r) || 0,
    }));
  return accumulatePerformance(dailySeries.map((item, index) => ({
    sequence: index + 1,
    date: item.date,
    at: item.date,
    tradeId: null,
    runId: item.runIds[0] || null,
    strategyId: item.strategyIds[0] || null,
    resultR: item.totalR,
  })));
}

function accumulatePerformance(points) {
  let cumulative = 0;
  let peak = 0;
  return points.map((point) => {
    cumulative = roundPerformance(cumulative + Number(point.resultR || 0));
    peak = Math.max(peak, cumulative);
    return { ...point, cumulativeR: cumulative, drawdownR: roundPerformance(cumulative - peak) };
  });
}

function replayComparisonHelpers() {
  return {
    byUpdatedDesc,
    contract,
    duration,
    eventTime,
    extractConclusion,
    isReplayLabRecord,
    listForReplay,
    normalizeReplayWorkflow,
    normalizeStatus,
    observedTelemetry,
    operationalRecords,
    projectDocuments,
    publicError,
    replayIdentityValues,
    notFound,
  };
}

function buildPerformanceFacets(trades, daily, runs) {
  const dates = [...trades, ...daily, ...runs].map((item) => item.trading_date || item.tradingDate || item.date).filter(Boolean).sort();
  return {
    strategies: uniqueValues([...trades, ...daily, ...runs].map((item) => item.strategy_id || item.strategyId)),
    sessions: uniqueValues([...trades, ...daily, ...runs].map((item) => item.session || item.session_id)),
    instruments: uniqueValues(trades.map((item) => item.instrument || item.symbol)),
    directions: uniqueValues(trades.map((item) => String(item.direction || item.side || "").toLowerCase())),
    dateRange: { from: dates[0] || null, to: dates.at(-1) || null },
  };
}

function performanceResult(item) {
  return firstNumber(item.result_R, item.result_r, item.pnl_R, item.pnl_r, item.realized_R, item.realized_r);
}

function performanceTime(item) {
  return item.closed_at_paris || item.closed_at_utc || item.exit_at || item.timestamp_paris || item.timestamp_utc || item.updated_at_utc || item.trading_date || item.date || null;
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function camelCase(value) {
  return value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function roundPerformance(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function structuralDiff(left, right, path = "") {
  const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
  const changes = [];
  for (const key of keys) {
    if (["updated_at", "updated_at_utc", "created_at", "created_at_utc"].includes(key)) continue;
    const currentPath = path ? `${path}.${key}` : key;
    const a = left?.[key];
    const b = right?.[key];
    if (isPlainObject(a) && isPlainObject(b)) changes.push(...structuralDiff(a, b, currentPath));
    else if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ path: currentPath, before: a ?? null, after: b ?? null });
  }
  return changes.slice(0, 500);
}

function extractConclusion(output) {
  if (!output) return null;
  return output.conclusion || output.executive_summary || output.summary || output.monitor_decision?.reason || output.monitor_decision?.summary || output.thesis_summary || null;
}

function healthFromCounts(counts, incidents) {
  const critical = incidents.filter((item) => item.severity === "critical" && item.lifecycleStatus !== "resolved").length;
  if (critical || counts.failed) return { status: "critical", label: "Intervention requise" };
  if (counts.blocked || counts.waiting_gpt) return { status: "warning", label: "Attention" };
  if (counts.running) return { status: "running", label: "En cours" };
  return { status: "healthy", label: "Stable" };
}

function aggregateStatus(statuses) {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("running")) return "running";
  if (statuses.includes("waiting_gpt")) return "waiting_gpt";
  if (statuses.includes("paused")) return "paused";
  if (statuses.every((item) => item === "completed")) return "completed";
  return statuses[0] || "unknown";
}

function normalizeLifecycle(value) {
  const status = String(value || "OPEN").toLowerCase();
  if (["resolved", "closed", "done", "completed"].includes(status)) return "resolved";
  if (["ack", "acknowledged"].includes(status)) return "acknowledged";
  if (["snoozed", "paused"].includes(status)) return "snoozed";
  if (["archived"].includes(status)) return "archived";
  return "open";
}

function normalizeSeverity(value) {
  const severity = String(value || "warning").toLowerCase();
  if (["critical", "fatal", "error"].includes(severity)) return "critical";
  if (["warning", "warn", "action"].includes(severity)) return "warning";
  if (["info", "watch", "positive"].includes(severity)) return severity;
  return "warning";
}

function isQualityIncident(item) {
  return !["ready", "ok", "pass", "passed", "healthy"].includes(String(item.status || item.result || "").toLowerCase());
}

function eventTime(value = {}) {
  return value.updated_at_utc || value.completed_at_utc || value.created_at_utc || value.at_utc || value.timestamp_utc || value.timestamp_paris || value.time || value.updated_at || value.created_at || null;
}

function progressValue(value, done, total) {
  const explicit = Number(value);
  if (Number.isFinite(explicit)) return explicit > 1 ? Math.min(100, explicit) : Math.round(explicit * 100);
  if (Number(total) > 0) return Math.round((Number(done || 0) / Number(total)) * 100);
  return TERMINAL.has(String(value || "").toUpperCase()) ? 100 : 0;
}

function replayTimelineProgress(run = {}, status, fallback = 0) {
  if (status === "completed") return 100;
  const start = Date.parse(run.start_time || run.initial_cutoff || run.cutoff_paris || "");
  const current = Date.parse(run.current_replay_time || run.cutoff_paris || "");
  const end = Date.parse(run.end_time || "");
  if (!Number.isFinite(start) || !Number.isFinite(current) || !Number.isFinite(end) || end <= start) {
    return fallback;
  }
  const ratio = Math.max(0, Math.min(1, (current - start) / (end - start)));
  return Math.min(99, Math.round(ratio * 100));
}

function duration(start, end) {
  const a = Date.parse(start || "");
  const b = Date.parse(end || "");
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : null;
}

function publicError(error) {
  if (!error) return null;
  if (typeof error === "string") return { message: error };
  return { code: error.code || error.error_code || null, message: error.message || error.reason || error.error_message || "Erreur", retryable: error.retryable ?? null };
}

function normalizeActor(actor = {}) {
  return { kind: actor.kind || "operator", email: actor.email || null, uid: actor.uid || null, clientIp: actor.clientIp || null };
}

function normalizedFilters(filters = {}) {
  return {
    kind: filters.kind || null,
    scope: filters.scope || null,
    workflow: filters.workflow || null,
    worker: filters.worker || null,
    model: filters.model || null,
    provider: filters.provider || null,
    status: filters.status || null,
    level: filters.level || null,
    session: filters.session || null,
    strategyId: filters.strategyId || null,
    versionScope: normalizeReplayVersionScope(filters.versionScope),
    instrument: filters.instrument || null,
    direction: filters.direction || null,
    date: filters.date || null,
    from: filters.from || null,
    to: filters.to || null,
    q: filters.q || null,
    includeHistory: filters.includeHistory === true,
  };
}

function operationalRecords(items, filters = {}) {
  if (filters.includeHistory === true) return items || [];
  return (items || []).filter((item) => item?.operational_visibility !== "history");
}

function replayLabRecords(items = [], versionScope = "v4") {
  return (items || []).filter((item) => isReplayLabRecord(item, versionScope));
}

function replayIdentityValues(item = {}) {
  return uniqueValues([item.backtest_id, item.replay_run_id, item.run_id, item.id]);
}

function isReplayLabRecord(item = {}, versionScope = "v4") {
  const isHistory = item.operational_visibility === "history";
  if (isHistory && item.research_visibility && item.research_visibility !== "replay_lab") return false;
  const scope = normalizeReplayVersionScope(versionScope);
  const v4 = isAutopilotV4ReplayRun(item);
  if (scope === "all") return true;
  if (scope === "current") return v4;
  if (scope === "legacy") return !v4;
  if (scope === "v5") return replayStrategyMajor(item) >= 5;
  if (scope === "v4") return v4 && replayStrategyMajor(item) === 4;
  if (scope === "certified") return isCertifiedAutopilotV4ReplayRun(item);
  if (scope === "active") return v4 && !["completed", "cancelled", "failed"].includes(normalizeStatus(item.status));
  return v4;
}

function isAutopilotV4Record(item = {}) {
  if (item.v4_history_eligible === true) return true;
  const strategyVersion = String(item.strategy_version || item.strategyVersion || "").toLowerCase();
  const autopilotVersion = String(item.autopilot_version || item.autopilotVersion || "").toLowerCase();
  if (["autopilot_v4", "v4", "4.0.0", "autopilot_v5", "v5", "5.0.0", "5.1.0", "5.2.0", "5.4.0"].includes(strategyVersion)) return true;
  if (["v4", "v5"].includes(autopilotVersion) || /^[45]\./.test(autopilotVersion)) return true;
  const masterContract = item.pinned_contracts?.master_contract || item.contract_context?.master_contract || {};
  return ["4.0.0", "5.0.0", "5.1.0", "5.2.0", "5.4.0"].includes(String(masterContract.schema_version || ""));
}

function isAutopilotV4ReplayRun(item = {}) {
  const masterContract = item.pinned_contracts?.master_contract || item.contract_context?.master_contract || {};
  const cadence = String(item.cadence || item.monitor_cadence || "").toLowerCase();
  return item.replay_schema_version === "2.0.0"
    && ["5m", "15m"].includes(cadence)
    && ["4.0.0", "5.0.0", "5.1.0", "5.2.0", "5.4.0"].includes(String(masterContract.schema_version || ""));
}

function isCertifiedAutopilotV4ReplayRun(item = {}) {
  return isAutopilotV4ReplayRun(item) && (
    item.v4_history_eligible === true
    || String(item.result_certification_status || "").toUpperCase() === "CERTIFIED"
  );
}

function replayStrategyMajor(item = {}) {
  const masterContract = item.pinned_contracts?.master_contract || item.contract_context?.master_contract || {};
  const explicit = String(item.autopilot_version || item.strategy_version || masterContract.schema_version || "").match(/([0-9]+)/);
  return explicit ? Number(explicit[1]) : 0;
}

function normalizeReplayVersionScope(value) {
  const scope = String(value || "v4").toLowerCase();
  return ["v4", "v5", "current", "certified", "active", "legacy", "all"].includes(scope) ? scope : "v4";
}

function replayVersionScopeForEngine(engineVersion) {
  if (engineVersion === "autopilot_v5") return "v5";
  if (engineVersion === "autopilot_v4") return "v4";
  return "legacy";
}

function replayPositionPerformanceTrade(position = {}) {
  const materializedResult = firstNumber(position.result_R, position.result_r, position.realized_R);
  const derivedResult = replayPositionToSimulatedTrade(position)?.r_result ?? null;
  const unrealizedResult = firstNumber(position.unrealized_R, position.unrealized_r);
  const canonicalResult = materializedResult ?? derivedResult ?? unrealizedResult;
  return {
    ...position,
    trade_id: position.trade_id || position.position_id,
    session: position.session || position.resolved_scope?.session || null,
    strategy_id: position.strategy_id || position.resolved_scope?.strategy_id || null,
    result_R: canonicalResult,
    realized_points: firstNumber(position.realized_points),
    performance_source: canonicalResult === null
      ? "canonical_outcome_missing"
      : materializedResult !== null
        ? "canonical_trade_outcome"
        : derivedResult !== null
          ? "replay_v2_position_geometry"
          : "replay_mark_to_market",
  };
}

function isReplayPositionPerformanceEligible(position = {}) {
  if (position.excluded_from_results === true || position.invalid_position_record === true) return false;
  const status = String(position.status || "").toUpperCase();
  return !["CANCELLED", "CANCELED", "VOID", "INVALID"].includes(status);
}

function replayPositionPerformanceSummary(positions = []) {
  const eligiblePositions = (positions || []).filter(isReplayPositionPerformanceEligible);
  const projected = eligiblePositions.map(replayPositionPerformanceTrade);
  const values = projected
    .map(performanceResult)
    .filter((value) => value !== null);
  const realizedValues = projected
    .filter((item) => item.performance_source !== "replay_mark_to_market")
    .map(performanceResult)
    .filter((value) => value !== null);
  const unrealizedValues = projected
    .filter((item) => item.performance_source === "replay_mark_to_market")
    .map(performanceResult)
    .filter((value) => value !== null);
  return {
    totalR: values.length ? roundPerformance(sum(values)) : null,
    realizedR: realizedValues.length ? roundPerformance(sum(realizedValues)) : 0,
    unrealizedR: unrealizedValues.length ? roundPerformance(sum(unrealizedValues)) : 0,
    resultMode: unrealizedValues.length ? "mark_to_market" : realizedValues.length ? "realized" : "pending",
    positions: eligiblePositions.length,
    pricedPositions: values.length,
    unpricedPositions: Math.max(0, eligiblePositions.length - values.length),
  };
}

function dedupePerformanceTrades(items = []) {
  const output = new Map();
  for (const item of items || []) {
    const key = item.position_id || item.trade_id || item.id || hashObject(item).slice(0, 24);
    if (!output.has(key)) output.set(key, item);
  }
  return [...output.values()];
}

function commandDocumentId(type, target, idempotencyKey) {
  return `ops_${createHash("sha256").update(`${type}:${target}:${idempotencyKey}`).digest("hex").slice(0, 32)}`;
}

function commandRequestHash(targetType, targetId, action, input = {}) {
  const payload = { targetType, targetId, action, expectedRevision: input.expectedRevision, reason: input.reason, snoozedUntilUtc: input.snoozedUntilUtc || null, policy: input.policy || null };
  if (input.owner) payload.owner = input.owner;
  return hashObject(payload);
}

function hashObject(value) {
  return canonicalSha256(value);
}

function groupBy(items, select) {
  const output = new Map();
  for (const item of items || []) {
    const key = select(item);
    if (!output.has(key)) output.set(key, []);
    output.get(key).push(item);
  }
  return output;
}

function countBy(items, select) {
  return Object.fromEntries([...groupBy(items, select)].map(([key, values]) => [key, values.length]));
}

async function list(persistence, collection) {
  if (!collection) return [];
  if (!LIST_CACHE_TTL_MS || !persistence || (typeof persistence !== "object" && typeof persistence !== "function")) {
    return persistence.listDocuments(collection, 1000).catch(() => []);
  }
  const now = frontOperationsEpochMs();
  let cache = LIST_CACHE.get(persistence);
  if (!cache) {
    cache = new Map();
    LIST_CACHE.set(persistence, cache);
  }
  const cached = cache.get(collection);
  if (cached && cached.expiresAt > now) {
    const items = await cached.promise;
    return items.slice();
  }
  const promise = persistence.listDocuments(collection, 1000).catch(() => []);
  cache.set(collection, { expiresAt: now + LIST_CACHE_TTL_MS, promise });
  const items = await promise;
  cache.set(collection, { expiresAt: frontOperationsEpochMs() + LIST_CACHE_TTL_MS, promise: Promise.resolve(items) });
  return items.slice();
}

async function listCodexWorkerHeartbeats(persistence) {
  if (!persistence?.pool?.query) return [];
  const result = await persistence.pool.query(
    `SELECT service_id, instance_id, release_version, status, details,
            heartbeat_at_utc, started_at_utc
     FROM desk_service_heartbeats
     WHERE service_kind = 'codex_ai_worker'
     ORDER BY service_id`,
  ).catch(() => ({ rows: [] }));
  return result.rows || [];
}

function projectCodexWorkerFleet(heartbeats = [], runs = [], nowMs = frontOperationsEpochMs()) {
  const recentRuns = [...runs]
    .sort((left, right) => String(right.updated_at_utc || "").localeCompare(String(left.updated_at_utc || "")))
    .slice(0, 20)
    .map((run) => ({
      id: run.ai_run_id,
      workerId: run.worker_id || null,
      scope: run.scope || null,
      workflow: run.workflow || null,
      status: String(run.status || "UNKNOWN").toLowerCase(),
      decisionSummary: run.decision_summary || null,
      dataQualityStatus: run.data_quality_status || null,
      startedAt: run.started_at_utc || null,
      completedAt: run.completed_at_utc || null,
      error: run.error || null,
    }));
  const latestByWorker = new Map();
  for (const run of recentRuns) {
    if (run.workerId && !latestByWorker.has(run.workerId)) latestByWorker.set(run.workerId, run);
  }
  const workers = heartbeats.map((row) => {
    const heartbeatAt = row.heartbeat_at_utc ? new Date(row.heartbeat_at_utc).toISOString() : null;
    const ageMs = heartbeatAt ? Math.max(0, nowMs - Date.parse(heartbeatAt)) : null;
    const status = String(row.status || "unknown").toLowerCase();
    return {
      serviceId: row.service_id,
      workerId: row.instance_id,
      scope: row.details?.scope || null,
      mode: row.details?.mode || "unknown",
      status,
      healthy: status === "disabled" || (["healthy", "starting"].includes(status) && ageMs !== null && ageMs <= 90_000),
      releaseVersion: row.release_version || null,
      heartbeatAt,
      ageMs,
      lastResult: row.details?.last_result || null,
      latestRun: latestByWorker.get(row.instance_id) || null,
    };
  });
  return {
    expected: 3,
    registered: workers.length,
    healthy: workers.filter((worker) => worker.healthy).length,
    active: workers.filter((worker) => worker.mode === "active" && worker.healthy).length,
    shadow: workers.filter((worker) => worker.mode === "shadow" && worker.healthy).length,
    degraded: workers.filter((worker) => !worker.healthy).length,
    items: workers,
    recentRuns,
  };
}

function latestAiRunByClaim(runs = [], claimField) {
  const latestByClaim = new Map();
  for (const run of runs) {
    const claimId = stringOrNull(run?.claim_handle?.[claimField]);
    if (!claimId) continue;
    const current = latestByClaim.get(claimId);
    if (!current || compareAiRunRecency(run, current) > 0) latestByClaim.set(claimId, run);
  }
  return latestByClaim;
}

function compareAiRunRecency(left, right) {
  const timestampDelta = aiRunTimestamp(left) - aiRunTimestamp(right);
  if (timestampDelta) return timestampDelta;
  return String(left?.ai_run_id || "").localeCompare(String(right?.ai_run_id || ""));
}

function aiRunTimestamp(run = {}) {
  for (const field of ["updated_at_utc", "completed_at_utc", "started_at_utc"]) {
    const timestamp = Date.parse(run[field] || "");
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return Number.NEGATIVE_INFINITY;
}

function projectAiRunResearch(run = null) {
  if (!run) return {};
  const researchProgress = run.research_progress ?? run.researchProgress;
  const analyticalValidation = run.analytical_validation ?? run.analyticalValidation;
  return {
    ...(researchProgress != null ? { researchProgress } : {}),
    ...(analyticalValidation != null ? { analyticalValidation } : {}),
  };
}

async function listForReplay(persistence, collection, backtestId) {
  if (!collection || !backtestId) return [];
  if (typeof persistence.queryCollectionDocuments !== "function") {
    return (await list(persistence, collection)).filter((item) => item.backtest_id === backtestId);
  }
  return persistence.queryCollectionDocuments({
    collection,
    filters: [{ field: "backtest_id", operator: "==", value: backtestId }],
    limit: 1000,
  }).catch(() => []);
}

async function projectDocuments(persistence, collection, fields, filters = []) {
  if (!collection) return [];
  if (typeof persistence.queryCollectionDocumentProjections !== "function") {
    const documents = filters.length && typeof persistence.queryCollectionDocuments === "function"
      ? await persistence.queryCollectionDocuments({ collection, filters, limit: 1000 }).catch(() => [])
      : await list(persistence, collection);
    return documents
      .filter((document) => filters.every((filter) => projectionFilterMatches(document, filter)))
      .map((document) => Object.fromEntries(fields
      .filter((field) => document[field] !== undefined)
      .map((field) => [field, document[field]])));
  }
  const cacheKey = `projection:${collection}:${canonicalSha256({ fields, filters })}`;
  if (!LIST_CACHE_TTL_MS || !persistence || (typeof persistence !== "object" && typeof persistence !== "function")) {
    return persistence.queryCollectionDocumentProjections({ collection, fields, filters, limit: 1000 }).catch(() => []);
  }
  const now = frontOperationsEpochMs();
  let cache = LIST_CACHE.get(persistence);
  if (!cache) {
    cache = new Map();
    LIST_CACHE.set(persistence, cache);
  }
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    const items = await cached.promise;
    return items.slice();
  }
  const promise = persistence.queryCollectionDocumentProjections({ collection, fields, filters, limit: 1000 }).catch(() => []);
  cache.set(cacheKey, { expiresAt: now + LIST_CACHE_TTL_MS, promise });
  const items = await promise;
  cache.set(cacheKey, { expiresAt: frontOperationsEpochMs() + LIST_CACHE_TTL_MS, promise: Promise.resolve(items) });
  return items.slice();
}

function projectionFilterMatches(document, filter) {
  const actual = String(filter.field || "").split(".").reduce((value, key) => value?.[key], document);
  if ((filter.operator || "==") === "==") return actual === filter.value;
  if (filter.operator === "!=") return actual !== filter.value;
  if (filter.operator === "in") return Array.isArray(filter.value) && filter.value.includes(actual);
  return false;
}

function invalidateListCache(persistence) {
  if (persistence && (typeof persistence === "object" || typeof persistence === "function")) {
    LIST_CACHE.delete(persistence);
  }
}

function attachListCacheInvalidation(persistence) {
  if (!persistence || (typeof persistence !== "object" && typeof persistence !== "function") || persistence[LIST_CACHE_INVALIDATION_PATCHED]) return;
  for (const method of ["setDocument", "createDocument", "deleteDocument", "deleteCollection"]) {
    if (typeof persistence[method] !== "function") continue;
    const original = persistence[method];
    Object.defineProperty(persistence, method, {
      configurable: true,
      writable: true,
      value: async function cachedWriteInvalidator(...args) {
        try {
          return await original.apply(this, args);
        } finally {
          invalidateListCache(persistence);
        }
      },
    });
  }
  Object.defineProperty(persistence, LIST_CACHE_INVALIDATION_PATCHED, {
    configurable: true,
    value: true,
  });
}

function bounded(value, fallback, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, max)) : fallback;
}

function plainRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringOrNull(value) {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function sum(values) { return values.reduce((total, value) => total + (Number(value) || 0), 0); }
function average(values) { return values.length ? Math.round(sum(values) / values.length) : 0; }
function sumNullable(values, decimals = 0) {
  if (!values.length) return null;
  const total = values.reduce((result, value) => result + Number(value), 0);
  const factor = 10 ** decimals;
  return decimals ? Math.round(total * factor) / factor : total;
}
function averageNullable(values) {
  return values.length ? Math.round(sum(values) / values.length) : null;
}
function maxNullable(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.max(...finite) : null;
}
function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}
function coverage(available, total) {
  return { available, total, percent: total ? Math.round((available / total) * 100) : 0 };
}
function byUpdatedDesc(a, b) { return String(b.updatedAt || eventTime(b) || "").localeCompare(String(a.updatedAt || eventTime(a) || "")); }
function byTimeAsc(a, b) { return String(a.at || eventTime(a) || "").localeCompare(String(b.at || eventTime(b) || "")); }
function bySequence(a, b) { return Number(a.sequence || 0) - Number(b.sequence || 0); }
function byVersionDesc(a, b) { return String(b.version || b.version_id || "").localeCompare(String(a.version || a.version_id || "")); }
function isPlainObject(value) { return value && typeof value === "object" && !Array.isArray(value); }

function httpError(code, message, statusCode) {
  const error = deskError(code, message);
  error.statusCode = statusCode;
  return error;
}
function invalid(code, message) { return httpError(code, message, 400); }
function conflict(code, message) { return httpError(code, message, 409); }
function notFound(code, message) { return httpError(code, message, 404); }
