import type {
  AgentRuntimeDeadLetter,
  AgentRuntimeDeadLetterList,
  AgentRuntimeMetric,
  AgentRuntimeMetricList,
  AgentRuntimeOverview,
  AgentRuntimePool,
  AgentRuntimePoolOverview,
  AgentRuntimeSchedulerPlan,
  AgentRuntimeTask,
  AgentRuntimeTaskList,
} from "@/features/agent-runtime/types";

export type AgentRuntimeTone = "neutral" | "positive" | "warning" | "critical" | "info";

export interface AgentRuntimeMetricCard {
  label: string;
  value: string | number;
  detail?: string;
  tone?: AgentRuntimeTone;
}

export interface AgentRuntimePoolRow {
  key: string;
  label: string;
  lane: string;
  status: string;
  tone: AgentRuntimeTone;
  active: number;
  ready: number;
  errors: number;
  maxWorkers: number;
  runRate: string;
  cost: string;
  responsibilities: string;
}

export interface AgentRuntimeTaskRow {
  key: string;
  idShort: string;
  label: string;
  lane: string;
  status: string;
  tone: AgentRuntimeTone;
  worker: string;
  attempts: string;
  nextTime: string;
  updated: string;
  payload: string;
  lastRun: string;
}

export interface AgentRuntimeSchedulerRow {
  key: string;
  label: string;
  lane: string;
  status: string;
  reason: string;
  priority: number;
  scheduledFor: string;
  bucket: "selected" | "deferred" | "rejected";
}

export interface AgentRuntimeDeadLetterRow {
  key: string;
  idShort: string;
  label: string;
  lane: string;
  status: string;
  error: string;
  attempts: number;
  retryable: boolean;
  created: string;
  tone: AgentRuntimeTone;
}

export interface AgentRuntimeViewModel {
  generatedAt: string;
  health: { label: string; tone: AgentRuntimeTone };
  metrics: AgentRuntimeMetricCard[];
  poolRows: AgentRuntimePoolRow[];
  taskRows: AgentRuntimeTaskRow[];
  schedulerRows: AgentRuntimeSchedulerRow[];
  deadLetterRows: AgentRuntimeDeadLetterRow[];
  metricRows: Array<{ key: string; label: string; lane: string; worker: string; model: string; outcome: string; latency: string; tokens: string; cost: string; finished: string; tone: AgentRuntimeTone }>;
  warnings: string[];
}

export interface BuildAgentRuntimeViewModelInput {
  overview?: AgentRuntimeOverview | null;
  pools?: AgentRuntimePoolOverview | null;
  scheduler?: AgentRuntimeSchedulerPlan | null;
  tasks?: AgentRuntimeTaskList | null;
  deadLetters?: AgentRuntimeDeadLetterList | null;
  metrics?: AgentRuntimeMetricList | null;
}

export function buildAgentRuntimeViewModel(input: BuildAgentRuntimeViewModelInput): AgentRuntimeViewModel {
  const sources = agentRuntimeSources(input);
  const summary = agentRuntimeSummary(sources);
  return {
    generatedAt: sourceGeneratedAt(input),
    health: health(summary.deadLetterOpen, summary.failed, summary.selectedCount),
    metrics: agentRuntimeMetricCards(sources, summary),
    poolRows: sources.pools.map(poolRow),
    taskRows: sources.tasks.map(taskRow),
    schedulerRows: schedulerRows(input.scheduler),
    deadLetterRows: sources.deadLetters.map(deadLetterRow),
    metricRows: sources.runtimeMetrics.map(metricRow),
    warnings: agentRuntimeWarnings(sources.pools.length, summary),
  };
}

function agentRuntimeSources(input: BuildAgentRuntimeViewModelInput) {
  return {
    tasks: sourceTasks(input.tasks, input.overview),
    pools: sourcePools(input.pools),
    deadLetters: sourceDeadLetters(input.deadLetters, input.overview),
    runtimeMetrics: sourceRuntimeMetrics(input.metrics, input.overview),
    taskStatusCounts: sourceTaskStatusCounts(input.tasks, input.overview),
    deadLetterStatusCounts: sourceDeadLetterStatusCounts(input.overview),
    selectedTasks: sourceSelectedTasks(input.scheduler),
  };
}

function sourceTasks(taskList?: AgentRuntimeTaskList | null, overview?: AgentRuntimeOverview | null) {
  if (taskList) return taskList.items;
  if (overview) return overview.recent_tasks;
  return [];
}

function sourcePools(poolOverview?: AgentRuntimePoolOverview | null) {
  return poolOverview ? poolOverview.pools : [];
}

function sourceDeadLetters(dlqList?: AgentRuntimeDeadLetterList | null, overview?: AgentRuntimeOverview | null) {
  if (dlqList) return dlqList.items;
  if (overview) return overview.open_dead_letters;
  return [];
}

function sourceRuntimeMetrics(metricList?: AgentRuntimeMetricList | null, overview?: AgentRuntimeOverview | null) {
  if (metricList) return metricList.items;
  if (overview) return overview.recent_metrics;
  return [];
}

function sourceTaskStatusCounts(taskList?: AgentRuntimeTaskList | null, overview?: AgentRuntimeOverview | null) {
  const rows = overview ? overview.summary.task_status : [];
  return mergeStatusCounts(rows, sourceTasks(taskList, overview));
}

function sourceDeadLetterStatusCounts(overview?: AgentRuntimeOverview | null) {
  return overview ? overview.summary.dead_letter_status : [];
}

function sourceSelectedTasks(scheduler?: AgentRuntimeSchedulerPlan | null) {
  return scheduler ? scheduler.plan.selected_tasks : [];
}

function agentRuntimeSummary(sources: ReturnType<typeof agentRuntimeSources>) {
  const deadLetterOpen = openDeadLetterCount(sources);
  const failed = statusCount(sources.taskStatusCounts, "ERROR") + statusCount(sources.taskStatusCounts, "EXPIRED");
  return {
    ready: statusCount(sources.taskStatusCounts, "PENDING") + statusCount(sources.taskStatusCounts, "READY"),
    active: statusCount(sources.taskStatusCounts, "CLAIMED") + statusCount(sources.taskStatusCounts, "RUNNING"),
    deadLetterOpen,
    failed,
    selectedCount: sources.selectedTasks.length,
    completedRuns: outcomeCount(sources.runtimeMetrics, "COMPLETED"),
    failedRuns: failedOutcomeCount(sources.runtimeMetrics),
  };
}

function agentRuntimeMetricCards(sources: ReturnType<typeof agentRuntimeSources>, summary: ReturnType<typeof agentRuntimeSummary>): AgentRuntimeMetricCard[] {
  const runtimeMetrics = sources.runtimeMetrics;
  return [
    { label: "Prêtes", value: summary.ready, detail: "PENDING + READY", tone: summary.ready ? "info" : "neutral" },
    { label: "En cours", value: summary.active, detail: "leases actifs", tone: summary.active ? "positive" : "neutral" },
    { label: "DLQ ouverte", value: summary.deadLetterOpen, detail: "intervention opérateur", tone: summary.deadLetterOpen ? "critical" : "positive" },
    schedulerMetric(sources, summary),
    { label: "Runs mesurés", value: runtimeMetrics.length, detail: `${summary.completedRuns} ok · ${summary.failedRuns} échec`, tone: summary.failedRuns ? "warning" : runtimeMetrics.length ? "positive" : "neutral" },
    { label: "Coût fenêtre", value: formatCost(sum(runtimeMetrics.map((item) => item.cost_micros_usd))), detail: "métriques récentes", tone: "neutral" },
  ];
}

function schedulerMetric(sources: ReturnType<typeof agentRuntimeSources>, summary: ReturnType<typeof agentRuntimeSummary>): AgentRuntimeMetricCard {
  const latestTask = sources.selectedTasks[0]?.task_type;
  return {
    label: "Scheduler",
    value: summary.selectedCount ? "Sélection" : "Idle",
    detail: summary.selectedCount ? readableTaskType(latestTask) : "aucune tâche sélectionnée",
    tone: summary.selectedCount ? "info" : "neutral",
  };
}

function agentRuntimeWarnings(poolCount: number, summary: ReturnType<typeof agentRuntimeSummary>) {
  return [
    ...(!poolCount ? ["Aucun pool agent-runtime visible depuis l’API."] : []),
    ...(summary.deadLetterOpen ? [`${summary.deadLetterOpen} dead-letter ouverte(s) à traiter.`] : []),
    ...(summary.failed ? [`${summary.failed} tâche(s) en état ERROR/EXPIRED.`] : []),
  ];
}

function sourceGeneratedAt(input: BuildAgentRuntimeViewModelInput) {
  return formatDateTime(input.overview?.generated_at_utc || input.pools?.generated_at_utc || input.scheduler?.generated_at_utc);
}

function openDeadLetterCount(sources: ReturnType<typeof agentRuntimeSources>) {
  return sources.deadLetters.filter((item) => String(item.status || "").toUpperCase() === "OPEN").length
    || statusCount(sources.deadLetterStatusCounts, "OPEN");
}

function outcomeCount(metrics: AgentRuntimeMetric[], outcome: string) {
  return metrics.filter((item) => String(item.outcome || "").toUpperCase() === outcome).length;
}

function failedOutcomeCount(metrics: AgentRuntimeMetric[]) {
  return metrics.filter((item) => {
    const outcome = String(item.outcome || "").toUpperCase();
    return outcome.startsWith("FAILED") || outcome === "DEAD_LETTERED";
  }).length;
}

export function shortAgentRuntimeId(value?: string | null) {
  const text = String(value || "");
  if (!text) return "—";
  return text.length <= 14 ? text : `${text.slice(0, 8)}…${text.slice(-4)}`;
}

export function readableTaskType(value?: string | null) {
  const text = String(value || "agent_task").trim();
  const known: Record<string, string> = {
    LIVE_MASTER: "Master LIVE",
    LIVE_M15_MONITOR: "Monitor LIVE",
    LIVE_MONITOR: "Monitor LIVE",
    REPLAY_MASTER: "Master Replay",
    REPLAY_MONITOR: "Monitor Replay",
    RISK_GATE: "Contrôle risque",
    BROKER_SAFETY_CHECK: "Sécurité broker",
    DLQ_RECOVERY: "Récupération DLQ",
    STRATEGY_VALIDATION: "Validation stratégie",
    HYPOTHESIS_DISCOVERY: "Recherche stratégie",
  };
  return known[text] || text.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase());
}

export function agentRuntimeStatusTone(status?: string | null): AgentRuntimeTone {
  const normalized = String(status || "").toUpperCase();
  if (["DONE", "COMPLETED", "REQUEUED", "RESOLVED"].includes(normalized)) return "positive";
  if (["READY", "PENDING", "CLAIMED", "RUNNING", "SELECTED"].includes(normalized)) return "info";
  if (["WAITING_DEPENDENCY", "DEFERRED", "EXPIRED"].includes(normalized)) return "warning";
  if (["ERROR", "FAILED", "CANCELLED", "DEAD_LETTERED", "OPEN"].includes(normalized)) return "critical";
  return "neutral";
}

function poolRow(pool: AgentRuntimePool): AgentRuntimePoolRow {
  const ready = number(pool.task_status.READY) + number(pool.task_status.PENDING);
  const active = number(pool.active_count);
  const errors = number(pool.failed_count) + number(pool.task_status.ERROR) + number(pool.task_status.EXPIRED);
  return {
    key: pool.pool_id,
    label: poolLabel(pool),
    lane: laneLabel(pool.lane),
    status: pool.enabled ? (errors ? "À surveiller" : active ? "Actif" : ready ? "Prêt" : "Idle") : "Désactivé",
    tone: pool.enabled ? errors ? "warning" : active ? "positive" : "neutral" : "critical",
    active,
    ready,
    errors,
    maxWorkers: number(pool.max_concurrent_workers),
    runRate: `${number(pool.metrics.completed_count)}/${number(pool.metrics.run_count)} ok`,
    cost: formatCost(pool.metrics.cost_micros_usd),
    responsibilities: pool.responsibilities.map(readableKey).join(" · ") || "Responsabilité non renseignée",
  };
}

function taskRow(task: AgentRuntimeTask): AgentRuntimeTaskRow {
  return {
    key: task.task_id,
    idShort: shortAgentRuntimeId(task.task_id),
    label: readableTaskType(task.task_type),
    lane: laneLabel(task.lane),
    status: task.status,
    tone: agentRuntimeStatusTone(task.status),
    worker: task.assigned_worker_id ? shortAgentRuntimeId(task.assigned_worker_id) : task.lease_active ? "lease actif" : "non assigné",
    attempts: `${number(task.attempt_count)}/${number(task.max_attempts) || "∞"}`,
    nextTime: formatDateTime(task.not_before_utc || task.lease_expires_at_utc),
    updated: formatDateTime(task.updated_at_utc || task.created_at_utc),
    payload: (task.payload_keys || []).slice(0, 5).map(readableKey).join(", ") || "payload masqué",
    lastRun: task.last_run ? `${readableKey(task.last_run.outcome)} · ${formatDuration(task.last_run.total_latency_ms)}` : "pas encore mesuré",
  };
}

function schedulerRows(scheduler?: AgentRuntimeSchedulerPlan | null): AgentRuntimeSchedulerRow[] {
  const plan = scheduler?.plan;
  if (!plan) return [];
  return [
    ...plan.selected_tasks.map(item => schedulerRow(item, "selected")),
    ...plan.deferred_tasks.map(item => schedulerRow(item, "deferred")),
    ...plan.rejected_tasks.map(item => schedulerRow(item, "rejected")),
  ];
}

function schedulerRow(item: AgentRuntimeSchedulerRowInput, bucket: AgentRuntimeSchedulerRow["bucket"]): AgentRuntimeSchedulerRow {
  return {
    key: `${bucket}:${item.task_id || item.task_key}`,
    label: readableTaskType(item.task_type),
    lane: laneLabel(item.lane),
    status: bucket === "selected" ? "SELECTED" : String(item.status || bucket).toUpperCase(),
    reason: readableKey(item.reason || bucket),
    priority: number(item.priority),
    scheduledFor: formatDateTime(item.not_before_utc || item.created_at_utc),
    bucket,
  };
}

function deadLetterRow(item: AgentRuntimeDeadLetter): AgentRuntimeDeadLetterRow {
  return {
    key: item.dead_letter_id,
    idShort: shortAgentRuntimeId(item.dead_letter_id),
    label: readableTaskType(item.task_type),
    lane: laneLabel(item.lane),
    status: item.status,
    error: `${item.error_code}${item.error_message ? ` · ${item.error_message}` : ""}`,
    attempts: number(item.attempt_count),
    retryable: item.retryable === true,
    created: formatDateTime(item.created_at_utc),
    tone: agentRuntimeStatusTone(item.status),
  };
}

function metricRow(item: AgentRuntimeMetric) {
  return {
    key: item.metric_id,
    label: readableTaskType(item.task_type),
    lane: laneLabel(item.lane),
    worker: shortAgentRuntimeId(item.worker_id),
    model: [item.model, item.reasoning_effort].filter(Boolean).join(" · ") || "modèle non renseigné",
    outcome: item.outcome,
    latency: formatDuration(item.total_latency_ms),
    tokens: number(item.total_tokens).toLocaleString("fr-FR"),
    cost: formatCost(item.cost_micros_usd),
    finished: formatDateTime(item.finished_at_utc),
    tone: agentRuntimeStatusTone(item.outcome),
  };
}

function health(deadLetterOpen: number, failed: number, selected: number) {
  if (deadLetterOpen || failed) return { label: "Action requise", tone: "critical" as const };
  if (selected) return { label: "Orchestration active", tone: "positive" as const };
  return { label: "Disponible", tone: "neutral" as const };
}

function mergeStatusCounts(rows: AgentRuntimeOverview["summary"]["task_status"] = [], tasks: AgentRuntimeTask[] = []) {
  if (rows.length) return rows;
  const counts = new Map<string, number>();
  for (const task of tasks) counts.set(String(task.status || "UNKNOWN").toUpperCase(), (counts.get(String(task.status || "UNKNOWN").toUpperCase()) || 0) + 1);
  return [...counts.entries()].map(([status, count]) => ({ lane: "all", status, count }));
}

function statusCount(rows: Array<{ status: string; count: number }> = [], status: string): number {
  return sum(rows.filter((row) => String(row.status || "").toUpperCase() === status).map((row) => row.count));
}

function poolLabel(pool: AgentRuntimePool) {
  const labels: Record<string, string> = {
    live: "Décisions LIVE",
    safety: "Sécurité & broker",
    operations: "Recovery Ops",
    replay: "Replay & backtests",
    validation: "Validation stratégie",
    research: "Research lab",
    default: "Fallback",
  };
  return labels[pool.pool_id] || pool.label || pool.pool_id;
}

function laneLabel(value?: string | null) {
  return readableKey(value || "default");
}

function readableKey(value?: string | null) {
  return String(value || "—").toLowerCase().replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, char => char.toUpperCase());
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDuration(value?: number | null) {
  const millis = number(value);
  if (!millis) return "—";
  if (millis < 1000) return `${millis} ms`;
  const seconds = millis / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${(seconds / 60).toFixed(1)} min`;
}

function formatCost(value?: number | null) {
  const micros = number(value);
  if (!micros) return "$0.0000";
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

function sum(values: Array<number | null | undefined>): number {
  return values.reduce<number>((total, value) => total + number(value), 0);
}

function number(value?: number | string | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type AgentRuntimeSchedulerRowInput = AgentRuntimeSchedulerPlan["plan"]["selected_tasks"][number];
