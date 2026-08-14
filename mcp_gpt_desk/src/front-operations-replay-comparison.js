import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";

const C = DESK_COLLECTIONS;

export function createReplayComparisonProjector(deps) {
  return new ReplayComparisonProjector(deps);
}

class ReplayComparisonProjector {
  constructor({ operationsService, persistence, host, simulationRunFront, helpers }) {
    this.operationsService = operationsService;
    this.persistence = persistence;
    this.host = host;
    this.simulationRunFront = simulationRunFront;
    this.helpers = helpers;
  }

  async compare(ids = []) {
    const unique = [...new Set(ids.filter(Boolean))].slice(0, 8);
    const replays = await this.operationsService.listReplays({ limit: 1000, versionScope: "all" });
    const runsById = replaySummaryIndex(replays.items);
    const details = await Promise.all(unique.map((id) => this.detail(id, runsById.get(id))));
    const baselineR = firstNumber(details[0]?.run?.metrics?.totalR) || 0;
    const rows = details.map((detail, index) => buildReplayComparisonRow(detail, unique[index], baselineR, index === 0));
    const rankedIds = [...rows].sort((a, b) => b.metrics.resultR - a.metrics.resultR).map((row) => row.id);
    return this.helpers.contract("DeskReplayComparison", {
      ids: unique,
      baselineRunId: unique[0] || null,
      summary: buildReplayComparisonSummary(rows),
      items: rows.map((row) => ({ ...row, rank: rankedIds.indexOf(row.id) + 1 })),
      dimensions: ["resultR", "deltaR", "progress", "steps", "gptProcesses", "telemetryCoverage", "timelineEvents", "riskFlags"],
    });
  }

  async detail(runId, runSummary) {
    const run = runSummary || await this.loadReplayRun(runId);
    const [timeline, gpt, simulationEvidence] = await Promise.all([
      this.operationsService.getReplayTimeline(runId).catch(() => ({ items: [] })),
      this.listGptProcesses(runId).catch(() => ({ items: [] })),
      this.simulationRunFront.findSimulationEvidenceForReplay(run).catch(() => null),
    ]);
    const gptProcesses = gpt.items || [];
    return {
      run,
      canonicalState: { summary_stats: run.metrics || {} },
      timeline: timeline.items || [],
      priceSeries: [],
      gptProcesses,
      conclusions: gptProcesses
        .filter((item) => item.conclusion)
        .map((item) => ({ processId: item.id, runId: item.runId, conclusion: item.conclusion, at: item.completedAt })),
      simulationEvidence,
    };
  }

  async loadReplayRun(runId) {
    const state = await this.host.getReplayState({ backtest_id: runId }).catch(() => null);
    if (!state?.selected_backtest || !this.helpers.isReplayLabRecord(state.selected_backtest, "all")) {
      throw this.helpers.notFound("REPLAY_NOT_FOUND", `Replay introuvable : ${runId}`);
    }
    const positions = await this.helpers.listForReplay(this.persistence, C.deskReplayPositions, runId);
    return this.helpers.normalizeReplayWorkflow(state.selected_backtest, state.work_queue || [], [], positions.filter((item) => item.backtest_id === runId));
  }

  async listGptProcesses(runId) {
    if (!runId) return this.helpers.contract("DeskGptProcessList", { count: 0, items: [] });
    const workItems = await this.helpers.projectDocuments(this.persistence, C.deskAgentWorkItems, replayWorkItemFields(), [{ field: "backtest_id", operator: "==", value: runId }]);
    const relevantItems = this.helpers.operationalRecords(workItems, { includeHistory: true });
    const outputs = await this.replayOutputs(runId, relevantItems.length);
    const items = relevantItems
      .map((item) => this.gptProcessRow(item, outputs))
      .sort(this.helpers.byUpdatedDesc)
      .slice(0, 200);
    return this.helpers.contract("DeskGptProcessList", { count: items.length, items });
  }

  async replayOutputs(runId, hasItems) {
    if (!hasItems) return [];
    const [masters, monitors] = await Promise.all([
      this.helpers.projectDocuments(this.persistence, C.deskReplayMasterAnalyses, replayMasterFields(), [{ field: "backtest_id", operator: "==", value: runId }]),
      this.helpers.projectDocuments(this.persistence, C.deskReplayMonitors, replayMonitorFields(), [{ field: "backtest_id", operator: "==", value: runId }]),
    ]);
    return [...masters, ...monitors];
  }

  gptProcessRow(item, outputs) {
    const output = outputs.find((entry) => replayOutputMatchesWorkItem(entry, item));
    const times = replayWorkItemTimes(item, output, this.helpers);
    return {
      ...replayWorkItemIdentity(item),
      ...replayWorkItemAttempts(item),
      status: this.helpers.normalizeStatus(item.status),
      rawStatus: item.status || "UNKNOWN",
      ...times,
      conclusion: this.helpers.extractConclusion(output),
      decision: replayOutputDecision(output),
      error: this.helpers.publicError(item.last_error),
      telemetry: this.helpers.observedTelemetry(item.gpt_telemetry, []),
    };
  }
}

function replaySummaryIndex(items = []) {
  return new Map(items.flatMap((run) => [[run.sourceId, run], [run.id, run]].filter(([key]) => Boolean(key))));
}

function replayOutputMatchesWorkItem(entry, item) {
  return entry.work_item_id === item.work_item_id
    || entry.step_id === item.step_id
    || entry.analysis_id === item.expected_output_id
    || entry.monitor_id === item.expected_output_id;
}

function failedUpdatedAt(item) {
  return item.status === "FAILED" ? item.updated_at_utc : null;
}

function replayWorkItemIdentity(item = {}) {
  return {
    id: item.work_item_id,
    runId: item.backtest_id || item.run_id || null,
    stepId: item.step_id || null,
    workflow: item.workflow || item.task_type || "GPT",
    worker: item.worker_id || item.claimed_by || null,
    leaseExpiresAt: item.lease_expires_at_utc || null,
  };
}

function replayWorkItemAttempts(item = {}) {
  return {
    revision: Number(item.revision || item.attempt_count || 0),
    attempt: Number(item.attempt_count || 0),
    maxAttempts: Number(item.max_attempts || 0),
  };
}

function replayWorkItemTimes(item = {}, output = null, helpers) {
  const completedAt = item.completed_at_utc || item.failed_at_utc || item.last_error?.occurred_at_utc || failedUpdatedAt(item) || output?.created_at_utc || null;
  const updatedAt = helpers.eventTime(item);
  return {
    createdAt: item.created_at_utc || null,
    startedAt: item.claimed_at_utc || item.started_at_utc || null,
    completedAt,
    updatedAt,
    durationMs: helpers.duration(item.claimed_at_utc || item.created_at_utc, item.completed_at_utc || updatedAt),
  };
}

function replayOutputDecision(output = null) {
  return output?.monitor_decision?.decision || output?.decision || output?.action || null;
}

function replayWorkItemFields() {
  return [
    "work_item_id", "backtest_id", "run_id", "step_id", "workflow", "task_type", "status",
    "revision", "attempt_count", "max_attempts", "worker_id", "claimed_by", "lease_expires_at_utc",
    "created_at_utc", "claimed_at_utc", "started_at_utc", "completed_at_utc", "failed_at_utc", "updated_at_utc",
    "last_error", "gpt_telemetry", "operational_visibility", "expected_output_id",
  ];
}

function buildReplayComparisonRow(detail = {}, requestedId, baselineR = 0, baseline = false) {
  const run = detail.run || {};
  const gptProcesses = detail.gptProcesses || [];
  const timeline = detail.timeline || [];
  const priceSeries = detail.priceSeries || [];
  const simulationEvidence = detail.simulationEvidence || null;
  const metrics = replayComparisonMetrics({ run, gptProcesses, timeline, priceSeries, baselineR });
  const conclusion = latestConclusion(detail, gptProcesses);
  return {
    id: run.sourceId || requestedId,
    baseline,
    rank: null,
    run,
    summary: detail.canonicalState?.summary_stats || run.metrics || {},
    metrics,
    conclusion: conclusionProjection(conclusion, run),
    simulationEvidence,
    riskFlags: replayComparisonRiskFlags({ run, gptProcesses, metrics, simulationEvidence }),
    priceRange: replayPriceRange(priceSeries),
    timelineSample: timeline.slice(-5),
    gptProcesses,
    conclusions: detail.conclusions || [],
  };
}

function replayComparisonMetrics({ run = {}, gptProcesses = [], timeline = [], priceSeries = [], baselineR = 0 } = {}) {
  const resultR = firstNumber(run.metrics?.totalR) || 0;
  const stepsDone = Number(run.metrics?.stepsDone || 0);
  const stepsTotal = Number(run.metrics?.stepsTotal || 0);
  const telemetry = replayTelemetryMetrics(gptProcesses);
  return {
    resultR: roundPerformance(resultR),
    deltaR: roundPerformance(resultR - baselineR),
    progress: Number(run.progress || 0),
    stepsDone,
    stepsTotal,
    stepCompletionPct: completionPct(stepsDone, stepsTotal),
    gptProcesses: gptProcesses.length,
    gptWaiting: countStatus(gptProcesses, "waiting_gpt"),
    gptFailed: countFailureStatuses(gptProcesses),
    telemetryAvailable: telemetry.available,
    telemetryCoveragePct: coveragePct(telemetry.available, gptProcesses.length),
    costUsd: telemetry.available ? roundPerformance(telemetry.costUsd, 4) : null,
    totalTokens: telemetry.available ? telemetry.totalTokens : null,
    timelineEvents: timeline.length,
    decisions: decisionEvents(timeline).length,
    pricePoints: priceSeries.length,
    durationMs: run.durationMs || null,
  };
}

function replayTelemetryMetrics(gptProcesses = []) {
  const available = gptProcesses.filter((item) => item.telemetry?.available).length;
  return {
    available,
    costUsd: sum(gptProcesses.map((item) => item.telemetry?.costUsd).filter(presentValue)),
    totalTokens: sum(gptProcesses.map((item) => item.telemetry?.totalTokens).filter(presentValue)),
  };
}

function replayComparisonRiskFlags({ run = {}, gptProcesses = [], metrics = {}, simulationEvidence = null } = {}) {
  return [
    statusFlag(run.status, "failed", "RUN_FAILED"),
    statusFlag(run.status, "blocked", "RUN_BLOCKED"),
    run.error ? "RUN_ERROR" : null,
    metrics.gptFailed ? "GPT_FAILURE" : null,
    metrics.gptWaiting ? "WAITING_GPT" : null,
    partialTelemetryFlag(gptProcesses.length, metrics.telemetryAvailable),
    missingSimulationProofFlag(simulationEvidence),
  ].filter(Boolean);
}

function replayPriceRange(priceSeries = []) {
  const firstPrice = priceSeries[0] || null;
  const lastPrice = priceSeries.at(-1) || null;
  return {
    from: firstPrice?.time || null,
    to: lastPrice?.time || null,
    firstClose: firstPrice?.close ?? null,
    lastClose: lastPrice?.close ?? null,
  };
}

function latestConclusion(detail = {}, gptProcesses = []) {
  return (detail.conclusions || []).at(-1) || gptProcesses.find((item) => item.conclusion) || null;
}

function buildReplayComparisonSummary(items = []) {
  const sorted = [...items].sort((a, b) => b.metrics.resultR - a.metrics.resultR);
  const best = sorted[0] || null;
  const worst = sorted.at(-1) || null;
  const telemetry = replaySummaryTelemetry(items);
  const simulation = replaySummarySimulation(items);
  const performance = replaySummaryPerformance(items, best, worst);
  return {
    count: items.length,
    baselineRunId: items[0]?.id || null,
    bestRunId: best?.id || null,
    worstRunId: worst?.id || null,
    ...performance,
    completed: items.filter((item) => item.run.status === "completed").length,
    failed: items.filter((item) => item.run.status === "failed" || item.run.status === "blocked").length,
    waitingGpt: sum(items.map((item) => item.metrics.gptWaiting || 0)),
    gptProcesses: telemetry.gptProcesses,
    telemetryCoveragePct: telemetry.coveragePct,
    costUsd: telemetry.costUsd,
    totalTokens: telemetry.totalTokens,
    timelineEvents: sum(items.map((item) => item.metrics.timelineEvents || 0)),
    decisions: sum(items.map((item) => item.metrics.decisions || 0)),
    riskFlags: [...new Set(items.flatMap((item) => item.riskFlags || []))],
    simulationProofs: simulation.proofs,
    simulationProofFailures: simulation.failures,
  };
}

function replaySummaryPerformance(items = [], best = null, worst = null) {
  const results = items.map((item) => item.metrics.resultR);
  return {
    bestR: best ? best.metrics.resultR : 0,
    worstR: worst ? worst.metrics.resultR : 0,
    averageR: items.length ? roundPerformance(sum(results) / items.length) : 0,
    spreadR: best && worst ? roundPerformance(best.metrics.resultR - worst.metrics.resultR) : 0,
  };
}

function replaySummaryTelemetry(items = []) {
  const telemetryAvailable = sum(items.map((item) => item.metrics.telemetryAvailable || 0));
  const gptProcesses = sum(items.map((item) => item.metrics.gptProcesses || 0));
  return {
    gptProcesses,
    coveragePct: coveragePct(telemetryAvailable, gptProcesses),
    costUsd: telemetryAvailable ? roundPerformance(sum(items.map((item) => item.metrics.costUsd || 0)), 4) : null,
    totalTokens: telemetryAvailable ? sum(items.map((item) => item.metrics.totalTokens || 0)) : null,
  };
}

function replaySummarySimulation(items = []) {
  return {
    proofs: sum(items.map((item) => item.simulationEvidence?.count || 0)),
    failures: items.filter((item) => item.simulationEvidence?.available && !item.simulationEvidence.count).length,
  };
}

function conclusionProjection(conclusion, run) {
  return conclusion ? {
    processId: conclusion.processId || conclusion.id || null,
    runId: conclusion.runId || run.sourceId || null,
    conclusion: conclusion.conclusion || null,
    decision: conclusion.decision || null,
    at: conclusion.at || conclusion.completedAt || null,
  } : null;
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function completionPct(done, total) {
  return total ? Math.round((done / total) * 100) : 0;
}

function coveragePct(available, total) {
  return total ? Math.round((available / total) * 100) : null;
}

function countStatus(items, status) {
  return items.filter((item) => item.status === status).length;
}

function countFailureStatuses(items) {
  return items.filter((item) => item.status === "failed" || item.status === "blocked").length;
}

function decisionEvents(timeline = []) {
  return timeline.filter((item) => item.layer === "decision" || item.decision);
}

function presentValue(value) {
  return value !== null && value !== undefined;
}

function statusFlag(actual, expected, flag) {
  return actual === expected ? flag : null;
}

function partialTelemetryFlag(total, available) {
  return total && available < total ? "TELEMETRY_PARTIAL" : null;
}

function missingSimulationProofFlag(simulationEvidence = null) {
  return simulationEvidence?.available && simulationEvidence.count === 0 ? "SIMULATION_PROOF_MISSING" : null;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function roundPerformance(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function replayMasterFields() {
  return [
    "backtest_id", "work_item_id", "step_id", "analysis_id", "created_at_utc",
    "decision", "action", "conclusion", "executive_summary", "summary", "thesis_summary",
  ];
}

function replayMonitorFields() {
  return [
    "backtest_id", "work_item_id", "step_id", "monitor_id", "created_at_utc",
    "monitor_decision", "decision", "action", "conclusion", "executive_summary", "summary", "thesis_summary",
  ];
}

export async function replayIdentitySetForRun({ persistence, runId, helpers }) {
  const fallback = new Set([runId]);
  if (!runId || typeof persistence?.queryCollectionDocuments !== "function") return fallback;
  const runs = await persistence.queryCollectionDocuments({
    collection: C.deskReplayRuns,
    filters: [{ field: "backtest_id", operator: "==", value: runId }],
    limit: 10,
  }).catch(() => []);
  const labRuns = (runs || []).filter((item) => helpers.isReplayLabRecord(item, "all"));
  if (!labRuns.length) return fallback;
  return new Set(labRuns.flatMap(helpers.replayIdentityValues));
}
