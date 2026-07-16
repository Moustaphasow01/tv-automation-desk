import { createHash, randomUUID } from "node:crypto";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { canonicalSha256 } from "@tv-automation/desk-domain";
import { deskError } from "./desk-errors.js";

const C = DESK_COLLECTIONS;
const TERMINAL = new Set(["DONE", "COMPLETED", "DAY_END", "FAILED", "CANCELLED", "ARCHIVED", "RESOLVED"]);
const ACTIVE = new Set(["RUNNING", "CLAIMED", "IN_PROGRESS", "PROCESSING"]);
const WAITING_GPT = new Set(["WAITING_GPT", "WAITING_GPT_MASTER", "WAITING_GPT_MONITOR", "READY", "WAITING_GPT_SAVE"]);
const BLOCKED = new Set(["BLOCKED", "WORK_BUSY", "WORK_FAILED_REQUIRES_OPERATOR", "DATA_NOT_READY", "REPLAN_REQUIRED"]);

export const OPERATIONS_CONTRACT_VERSION = "1.0.0";

export class FrontOperationsService {
  constructor({ persistence, clock, host }) {
    this.persistence = persistence;
    this.clock = clock;
    this.host = host;
  }

  async getOperationsSummary(filters = {}) {
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
    const [jobs, replayRuns, historicalRuns, workItems, featureRuns, errors] = await Promise.all([
      list(this.persistence, C.deskJobs),
      list(this.persistence, C.deskReplayRuns),
      list(this.persistence, C.deskBacktests),
      list(this.persistence, C.deskAgentWorkItems),
      list(this.persistence, C.deskFeatureRuns),
      list(this.persistence, C.deskErrors),
    ]);
    const replayWork = groupBy(workItems, (item) => item.backtest_id);
    const replayErrors = groupBy(errors, (item) => item.backtest_id || item.run_id || item.job_id);
    const items = [
      ...jobs.map(normalizeJobWorkflow),
      ...replayRuns.map((run) => normalizeReplayWorkflow(run, replayWork.get(run.backtest_id) || [], replayErrors.get(run.backtest_id) || [])),
      ...historicalRuns.map((run) => normalizeReplayWorkflow(run, [], replayErrors.get(run.backtest_id) || [], "backtest")),
      ...featureRuns.map(normalizeFeatureWorkflow),
    ]
      .filter((item) => workflowMatches(item, filters))
      .sort(byUpdatedDesc)
      .slice(0, bounded(filters.limit, 200, 1000));
    return contract("DeskWorkflowList", { filters: normalizedFilters(filters), count: items.length, items });
  }

  async getWorkflow(workflowId) {
    const listResult = await this.listWorkflows({ limit: 1000 });
    const workflow = listResult.items.find((item) => item.id === workflowId || item.sourceId === workflowId);
    if (!workflow) throw notFound("WORKFLOW_NOT_FOUND", `Workflow introuvable : ${workflowId}`);
    const [steps, events] = await Promise.all([this.getWorkflowSteps(workflow), this.getWorkflowEvents(workflow)]);
    return contract("DeskWorkflowDetail", {
      workflow,
      steps,
      events,
      allowedActions: allowedWorkflowActions(workflow),
      relations: workflowRelations(workflow, steps, events),
    });
  }

  async getWorkflowSteps(workflowOrId) {
    const workflow = typeof workflowOrId === "string"
      ? (await this.getWorkflow(workflowOrId)).workflow
      : workflowOrId;
    const collection = workflow.kind === "replay" ? C.deskReplaySteps
      : workflow.kind === "backtest" ? C.deskBacktestSteps
        : null;
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
      if (workflow.kind === "job" && action === "cancel") {
        result = await this.host.cancelDeskJob({ job_id: workflow.sourceId, reason: input.reason });
      } else if (workflow.kind === "job" && ["retry", "resume"].includes(action)) {
        result = await this.host.updateDeskJobStatus({ job_id: workflow.sourceId, status: action === "retry" ? "QUEUED" : "RUNNING", error: null });
      } else if (["replay", "backtest"].includes(workflow.kind) && action === "cancel") {
        result = workflow.kind === "backtest"
          ? await this.host.cancelBacktestRun({ backtest_id: workflow.sourceId, reason: input.reason })
          : await this.#patchReplayRun(workflow, { status: "CANCELLED", automation_enabled: false, automation_status: "cancelled" });
      } else if (workflow.kind === "replay" && action === "pause") {
        result = await this.host.setReplayAutomation({ backtest_id: workflow.sourceId, enabled: false, reason: input.reason, expected_revision: workflow.revision });
      } else if (workflow.kind === "replay" && action === "retry") {
        result = await this.host.retryReplayAutomationWork({ backtest_id: workflow.sourceId, expected_revision: workflow.revision, reason: input.reason, requested_by: actor.email || actor.kind || "front-operator" });
      } else if (workflow.kind === "replay" && action === "resume") {
        result = await this.host.setReplayAutomation({ backtest_id: workflow.sourceId, enabled: true, reason: input.reason, expected_revision: workflow.revision });
      } else if (workflow.kind === "backtest" && ["resume", "retry"].includes(action)) {
        result = await this.host.runNextBacktestStep({ backtest_id: workflow.sourceId, write_result: true });
      } else {
        throw conflict("COMMAND_NOT_ALLOWED", "Cette action n’a pas de mutation canonique sûre pour ce type de workflow.");
      }
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
    const workflows = await this.listWorkflows({ ...filters, kind: filters.kind || null, limit: filters.limit || 500 });
    const replayItems = workflows.items.filter((item) => ["replay", "backtest"].includes(item.kind));
    const grouped = groupBy(replayItems, (item) => item.tradingDate || "unknown");
    const days = [...grouped.entries()].map(([date, items]) => ({
      date,
      status: aggregateStatus(items.map((item) => item.status)),
      sessionCount: items.length,
      running: items.filter((item) => item.status === "running").length,
      failed: items.filter((item) => item.status === "failed").length,
      totalProgress: average(items.map((item) => item.progress)),
      totalR: sum(items.map((item) => item.metrics?.totalR)),
      sessions: items,
    })).sort((a, b) => b.date.localeCompare(a.date));
    return contract("DeskReplayList", { count: replayItems.length, days, items: replayItems });
  }

  async getReplayRun(runId) {
    const state = await this.host.getReplayState({ backtest_id: runId }).catch(() => null);
    if (!state?.selected_backtest) throw notFound("REPLAY_NOT_FOUND", `Replay introuvable : ${runId}`);
    const [timeline, gpt, priceSeries] = await Promise.all([
      this.getReplayTimeline(runId),
      this.listGptProcesses({ runId, limit: 500 }),
      this.getReplayPriceSeries(runId),
    ]);
    const run = state.selected_backtest;
    return contract("DeskReplayRunDetail", {
      run: normalizeReplayWorkflow(run, state.work_queue || [], [], run.replay_mode ? "replay" : "backtest"),
      canonicalState: state,
      timeline: timeline.items,
      priceSeries: priceSeries.items,
      gptProcesses: gpt.items,
      conclusions: gpt.items.filter((item) => item.conclusion).map((item) => ({ processId: item.id, conclusion: item.conclusion, at: item.completedAt })),
    });
  }

  async getReplayDays(runId) {
    const run = (await this.getWorkflow(runId)).workflow;
    const all = await this.listReplays({ limit: 1000 });
    const days = all.days.filter((day) => day.date === run.tradingDate || day.sessions.some((session) => session.sourceId === run.sourceId));
    return contract("DeskReplayDayList", { runId: run.sourceId, count: days.length, items: days });
  }

  async getReplayDay(runId, date) {
    const all = await this.listReplays({ limit: 1000 });
    const day = all.days.find((item) => item.date === date);
    if (!day) throw notFound("REPLAY_DAY_NOT_FOUND", `Aucune exécution replay le ${date}.`);
    const sessions = assignAttempts(day.sessions);
    return contract("DeskReplayDayDetail", {
      runId,
      date,
      status: day.status,
      metrics: { totalR: day.totalR, progress: day.totalProgress, sessionCount: sessions.length },
      sessions,
      variants: [...new Set(sessions.map((item) => item.variantId))],
    });
  }

  async getReplaySession(runId, sessionExecutionId) {
    const detail = await this.getReplayRun(sessionExecutionId || runId);
    return contract("DeskReplaySessionDetail", { parentRunId: runId, sessionExecutionId, ...detail });
  }

  async getReplayTimeline(runId) {
    const [timeline, steps, workEvents] = await Promise.all([
      list(this.persistence, C.deskReplayTimeline),
      list(this.persistence, C.deskReplaySteps),
      list(this.persistence, C.deskAgentWorkEvents),
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
      list(this.persistence, C.deskReplayBundles),
      list(this.persistence, C.deskReplayTradeSimulations),
      list(this.persistence, C.deskReplaySteps),
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
    const [items, events, bundles, masters, monitors] = await Promise.all([
      list(this.persistence, C.deskAgentWorkItems),
      list(this.persistence, C.deskAgentWorkEvents),
      list(this.persistence, C.deskReplayBundles),
      list(this.persistence, C.deskReplayMasterAnalyses),
      list(this.persistence, C.deskReplayMonitors),
    ]);
    const eventGroups = groupBy(events, (event) => event.work_item_id);
    const bundleByStep = new Map(bundles.map((bundle) => [bundle.step_id, bundle]));
    const outputs = [...masters, ...monitors];
    const normalized = items
      .filter((item) => !filters.runId || item.backtest_id === filters.runId)
      .filter((item) => !filters.status || normalizeStatus(item.status) === filters.status)
      .map((item) => normalizeGptProcess(item, eventGroups.get(item.work_item_id) || [], bundleByStep.get(item.step_id), outputs))
      .sort(byUpdatedDesc)
      .slice(0, bounded(filters.limit, 200, 1000));
    return contract("DeskGptProcessList", { count: normalized.length, items: normalized });
  }

  async getGptProcess(processId) {
    const all = await this.listGptProcesses({ limit: 1000 });
    const process = all.items.find((item) => item.id === processId);
    if (!process) throw notFound("GPT_PROCESS_NOT_FOUND", `Processus GPT introuvable : ${processId}`);
    const item = await this.persistence.getDocument(C.deskAgentWorkItems, processId).catch(() => null);
    return contract("DeskGptProcessDetail", {
      process,
      manifest: process.bundle?.manifest || process.bundle?.section_manifest || null,
      prompt: item?.execution_prompt || item?.prompt || null,
      saveTarget: item?.save_target || item?.input_ref?.save_target || null,
      error: item?.last_error || null,
      raw: item,
    });
  }

  async getPerformanceOverview(filters = {}) {
    const [stats, daily, trades, runs] = await Promise.all([
      list(this.persistence, C.deskStrategyStats),
      list(this.persistence, C.deskStrategyDailyPerformance),
      list(this.persistence, C.deskStrategyTrades),
      this.listReplays({ limit: 1000 }),
    ]);
    const filteredDaily = daily.filter((item) => dateMatches(item.trading_date || item.date, filters));
    const filteredTrades = trades.filter((item) => dateMatches(item.trading_date || item.date, filters));
    return contract("DeskPerformanceOverview", {
      filters: normalizedFilters(filters),
      totals: performanceTotals(filteredDaily, filteredTrades),
      stats,
      daily: filteredDaily.sort((a, b) => String(b.date || b.trading_date).localeCompare(String(a.date || a.trading_date))),
      replayDays: runs.days,
      breakdowns: buildBreakdowns(filteredTrades, filteredDaily),
    });
  }

  async compareReplays(ids = []) {
    const unique = [...new Set(ids.filter(Boolean))].slice(0, 8);
    const details = await Promise.all(unique.map((id) => this.getReplayRun(id)));
    return contract("DeskReplayComparison", {
      ids: unique,
      items: details.map((detail) => ({
        run: detail.run,
        summary: detail.canonicalState?.summary_stats || detail.run.metrics,
        conclusions: detail.conclusions,
      })),
      dimensions: ["progress", "totalR", "steps", "gptProcesses", "failures"],
    });
  }

  async listIncidents(filters = {}) {
    const [alerts, errors, quality] = await Promise.all([
      list(this.persistence, C.deskAlerts),
      list(this.persistence, C.deskErrors),
      list(this.persistence, C.deskDataQualityAudits),
    ]);
    const items = [
      ...alerts.map((item) => normalizeIncident(item, "alert")),
      ...errors.map((item) => normalizeIncident(item, "error")),
      ...quality.filter((item) => isQualityIncident(item)).map((item) => normalizeIncident(item, "data_quality")),
    ]
      .filter((item) => !filters.status || item.lifecycleStatus === filters.status)
      .filter((item) => dateMatches(item.tradingDate, filters))
      .sort(byUpdatedDesc)
      .slice(0, bounded(filters.limit, 200, 1000));
    return contract("DeskIncidentList", { count: items.length, items });
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
    if (!["acknowledge", "snooze", "resolve", "reopen"].includes(action)) throw invalid("INVALID_INCIDENT_ACTION", "Action incident invalide.");
    const command = await this.#beginCommand("incident", incident.id, action, input, actor);
    if (command.replayed) return contract("DeskOperationsCommandResult", command.result);
    try {
      const collection = incident.sourceCollection;
      const current = await this.persistence.getDocument(collection, incident.sourceId);
      if (Number(current.revision || 0) !== Number(input.expectedRevision)) throw conflict("REVISION_CONFLICT", "L’incident a changé avant l’écriture.");
      const tick = this.clock.now();
      const lifecycle = action === "acknowledge" ? "acknowledged" : action === "snooze" ? "snoozed" : action === "resolve" ? "resolved" : "open";
      const updated = {
        ...current,
        lifecycle_status: lifecycle,
        status: lifecycle === "resolved" ? "RESOLVED" : current.status,
        revision: Number(current.revision || 0) + 1,
        snoozed_until_utc: action === "snooze" ? input.snoozedUntilUtc || null : current.snoozed_until_utc || null,
        updated_at_utc: tick.utc,
        updated_at_paris: tick.paris,
      };
      await this.persistence.setDocument(collection, incident.sourceId, updated);
      const payload = { ok: true, idempotent: false, commandId: command.commandId, action, incident: normalizeIncident(updated, incident.kind) };
      await this.#completeCommand(command, payload, actor, input.reason);
      return contract("DeskOperationsCommandResult", payload);
    } catch (error) {
      await this.#failCommand(command, error, actor, input.reason);
      throw error;
    }
  }

  async getHistory(filters = {}) {
    const [workflows, incidents, audits, performance] = await Promise.all([
      this.listWorkflows({ ...filters, limit: 1000 }),
      this.listIncidents({ ...filters, limit: 1000 }),
      list(this.persistence, C.deskAuditLogs),
      this.getPerformanceOverview(filters),
    ]);
    const sessions = [...groupBy(workflows.items, (item) => `${item.tradingDate || "unknown"}:${item.session || "global"}`).entries()]
      .map(([key, items]) => ({
        id: key,
        tradingDate: items[0]?.tradingDate || null,
        session: items[0]?.session || null,
        status: aggregateStatus(items.map((item) => item.status)),
        workflowCount: items.length,
        workflows: items,
      }))
      .sort((a, b) => String(b.tradingDate).localeCompare(String(a.tradingDate)));
    return contract("DeskHistory", { sessions, incidents: incidents.items, audit: audits.sort(byUpdatedDesc), performance });
  }

  async listStrategies() {
    const [catalog, configs, runtime, versions, contracts] = await Promise.all([
      list(this.persistence, C.strategyCatalog),
      list(this.persistence, C.strategyConfigs),
      list(this.persistence, C.strategyRuntimeState),
      list(this.persistence, C.deskStrategyVersions),
      list(this.persistence, C.deskContracts),
    ]);
    const ids = new Set([...catalog, ...configs, ...runtime, ...versions].map((item) => item.strategy_id).filter(Boolean));
    if (!ids.size) ids.add("ny_open_1530");
    const items = [...ids].map((id) => ({
      id,
      catalog: catalog.find((item) => item.strategy_id === id) || null,
      config: configs.find((item) => item.strategy_id === id) || null,
      runtime: runtime.find((item) => item.strategy_id === id) || null,
      versions: versions.filter((item) => item.strategy_id === id).sort(byVersionDesc),
      activeContracts: contracts.filter((item) => !item.strategy_id || item.strategy_id === id).map((item) => ({ name: item.contract_name || item.name, version: item.version, status: item.status })),
    }));
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
    return { ok: true, backtest_id: workflow.sourceId, status: updated.status, revision: updated.revision };
  }

  async #beginCommand(targetType, targetId, action, input, actor) {
    const commandId = commandDocumentId(targetType, targetId, input.idempotencyKey);
    const hash = hashObject({ targetType, targetId, action, expectedRevision: input.expectedRevision, reason: input.reason, snoozedUntilUtc: input.snoozedUntilUtc || null });
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
    const hash = hashObject({ targetType, targetId, action, expectedRevision: input.expectedRevision, reason: input.reason, snoozedUntilUtc: input.snoozedUntilUtc || null });
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
  }
}

function normalizeJobWorkflow(job = {}) {
  return workflowBase({
    id: `job:${job.job_id || job.id}`,
    sourceId: job.job_id || job.id,
    kind: "job",
    name: job.name || job.job_type || job.task_type || "Desk job",
    status: job.status,
    revision: job.revision,
    tradingDate: job.trading_date || job.date,
    session: job.session,
    strategyId: job.strategy_id,
    updatedAt: eventTime(job),
    startedAt: job.started_at_utc || job.started_at,
    completedAt: job.completed_at_utc || job.completed_at,
    progress: progressValue(job.progress, job.steps_done, job.steps_total),
    error: job.error,
    rawStatus: job.status,
  });
}

function normalizeReplayWorkflow(run = {}, workItems = [], errors = [], kind = "replay") {
  const completed = Number(run.steps_done || workItems.filter((item) => item.status === "COMPLETED").length || 0);
  const total = Number(run.steps_total || workItems.length || 0);
  return workflowBase({
    id: `${kind}:${run.backtest_id || run.replay_run_id || run.run_id}`,
    sourceId: run.backtest_id || run.replay_run_id || run.run_id,
    kind,
    name: run.name || `${kind === "replay" ? "Replay" : "Backtest"} · ${run.session || run.strategy_id || "Desk"}`,
    status: run.status,
    revision: run.revision,
    tradingDate: run.trading_date || run.date || run.date_from,
    session: run.session,
    strategyId: run.strategy_id,
    variantId: run.variant_id || `${run.strategy_id || "strategy"}:${run.cadence || run.monitor_cadence || "default"}`,
    updatedAt: eventTime(run),
    startedAt: run.started_at_utc || run.created_at_utc,
    completedAt: run.completed_at_utc,
    progress: progressValue(run.progress, completed, total),
    error: run.last_automation_error || run.error || errors[0] || null,
    rawStatus: run.status,
    metrics: { totalR: firstNumber(run.summary?.total_R, run.summary?.total_r, run.total_R), stepsDone: completed, stepsTotal: total, gptProcesses: workItems.length },
    currentStepId: run.current_step_id || null,
    currentWorkItemId: run.current_work_item_id || null,
    nextAction: run.next_action || null,
    automationEnabled: run.automation_enabled === true,
  });
}

function normalizeFeatureWorkflow(run = {}) {
  return workflowBase({
    id: `feature:${run.feature_run_id || run.run_id || run.id}`,
    sourceId: run.feature_run_id || run.run_id || run.id,
    kind: "feature",
    name: run.feature || run.feature_name || "Feature pipeline",
    status: run.status,
    revision: run.revision,
    tradingDate: run.trading_date || run.date,
    session: run.session,
    strategyId: run.strategy_id,
    updatedAt: eventTime(run),
    startedAt: run.started_at_utc,
    completedAt: run.completed_at_utc,
    progress: progressValue(run.progress, run.steps_done, run.steps_total),
    error: run.error,
    rawStatus: run.status,
  });
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
  return {
    id: event.event_id || event.audit_id || event.id || hashObject(event).slice(0, 20),
    type: event.event_type || event.action || event.phase || "EVENT",
    status: normalizeStatus(event.status || event.event_type),
    at: eventTime(event),
    title: event.title || event.action || event.event_type || "Événement",
    detail: event.note || event.message || event.reason || "",
    actor: event.actor || event.performed_by || null,
    ref: event.ref || event.output_ref || null,
  };
}

function normalizeDecisionEvent(event, layer) {
  const normalized = normalizeEvent(event);
  return {
    ...normalized,
    layer,
    stepId: event.step_id || null,
    processId: event.work_item_id || null,
    decision: event.monitor_decision?.decision || event.decision || event.action || null,
    conclusion: event.conclusion || event.note || event.message || null,
    price: firstNumber(event.price, event.close, event.market_price),
    severity: event.severity || (normalized.status === "failed" ? "critical" : normalized.status === "blocked" ? "warning" : "info"),
    rawStatus: event.status || event.event_type || "UNKNOWN",
  };
}

function normalizeGptProcess(item, events, bundle, outputs) {
  const output = outputs.find((entry) => entry.work_item_id === item.work_item_id || entry.step_id === item.step_id || entry.analysis_id === item.expected_output_id || entry.monitor_id === item.expected_output_id);
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
    completedAt: item.completed_at_utc || output?.created_at_utc || null,
    updatedAt: eventTime(item),
    durationMs: duration(item.claimed_at_utc || item.created_at_utc, item.completed_at_utc || eventTime(item)),
    events: events.map(normalizeEvent).sort(byTimeAsc),
    conclusion: extractConclusion(output),
    decision: output?.monitor_decision?.decision || output?.decision || output?.action || null,
    error: publicError(item.last_error),
    bundle: bundle ? { bundleId: bundle.bundle_id, manifest: bundle.manifest || bundle.section_manifest || null, dataQuality: bundle.data_quality || null } : null,
  };
}

function normalizeIncident(item = {}, kind) {
  const sourceId = item.alert_id || item.error_id || item.audit_id || item.id || hashObject(item).slice(0, 24);
  const sourceCollection = kind === "alert" ? C.deskAlerts : kind === "error" ? C.deskErrors : C.deskDataQualityAudits;
  return {
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
    runId: item.backtest_id || item.run_id || item.job_id || null,
    createdAt: item.created_at_utc || item.created_at || null,
    updatedAt: eventTime(item),
    snoozedUntil: item.snoozed_until_utc || null,
  };
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
  // The legacy backtest runner has no safe restart transition: runNextBacktestStep
  // deliberately treats FAILED as terminal. Do not advertise a command that
  // would succeed without changing canonical state.
  if (workflow.kind === "backtest") return ["cancel"];
  if (workflow.kind === "job") {
    if (workflow.status === "failed") return ["retry", "cancel"];
    if (workflow.status === "paused") return ["resume", "cancel"];
    return ["cancel"];
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
    replayRunId: ["replay", "backtest"].includes(workflow.kind) ? workflow.sourceId : null,
    currentStepId: workflow.currentStepId,
    currentWorkItemId: workflow.currentWorkItemId,
    stepIds: steps.map((item) => item.id),
    eventIds: events.map((item) => item.id),
  };
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

function dateMatches(date, filters) {
  if (filters.date && date !== filters.date) return false;
  if (filters.from && date && date < filters.from) return false;
  if (filters.to && date && date > filters.to) return false;
  return true;
}

function performanceTotals(daily, trades) {
  const totalR = sum(daily.map((item) => firstNumber(item.total_R, item.total_r, item.result_R))) || sum(trades.map((item) => firstNumber(item.result_R, item.result_r, item.pnl_R)));
  const closed = trades.filter((item) => ["CLOSED", "DONE", "TP", "SL"].includes(String(item.status || "").toUpperCase()) || firstNumber(item.result_R, item.result_r) !== null);
  const wins = closed.filter((item) => Number(firstNumber(item.result_R, item.result_r, item.pnl_R) || 0) > 0).length;
  return { totalR, trades: closed.length, wins, losses: Math.max(0, closed.length - wins), winRate: closed.length ? wins / closed.length : null, expectancyR: closed.length ? totalR / closed.length : null };
}

function buildBreakdowns(trades, daily) {
  const dimension = (name, key) => ({
    dimension: name,
    items: [...groupBy(trades, (item) => item[key] || "unknown").entries()].map(([label, items]) => ({ label, ...performanceTotals([], items) })),
  });
  return [dimension("session", "session"), dimension("instrument", "instrument"), dimension("direction", "direction"), {
    dimension: "day",
    items: daily.map((item) => ({ label: item.date || item.trading_date, totalR: firstNumber(item.total_R, item.total_r, item.result_R) || 0, trades: Number(item.closed_trades || item.trade_count || 0) })),
  }];
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
  return value.updated_at_utc || value.completed_at_utc || value.created_at_utc || value.timestamp_utc || value.timestamp_paris || value.time || value.updated_at || value.created_at || null;
}

function progressValue(value, done, total) {
  const explicit = Number(value);
  if (Number.isFinite(explicit)) return explicit > 1 ? Math.min(100, explicit) : Math.round(explicit * 100);
  if (Number(total) > 0) return Math.round((Number(done || 0) / Number(total)) * 100);
  return TERMINAL.has(String(value || "").toUpperCase()) ? 100 : 0;
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
  return { kind: filters.kind || null, status: filters.status || null, session: filters.session || null, strategyId: filters.strategyId || null, date: filters.date || null, from: filters.from || null, to: filters.to || null, q: filters.q || null };
}

function commandDocumentId(type, target, idempotencyKey) {
  return `ops_${createHash("sha256").update(`${type}:${target}:${idempotencyKey}`).digest("hex").slice(0, 32)}`;
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
  return persistence.listDocuments(collection, 1000).catch(() => []);
}

function bounded(value, fallback, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, max)) : fallback;
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
