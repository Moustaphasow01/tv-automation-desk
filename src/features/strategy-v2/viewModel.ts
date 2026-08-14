import type {
  StrategyList,
  StrategyV2AuditEvent,
  StrategyV2Instance,
  StrategyV2Overview,
  StrategyV2OverviewItem,
  StrategyV2SignalPollResult,
  StrategyV2SignalOutboxItem,
  StrategyV2Version,
} from "@/operationsTypes";

export type StrategyV2Tone = "neutral" | "positive" | "warning" | "critical";

export interface StrategyV2Metric {
  label: string;
  value: string | number;
  detail?: string;
  tone?: StrategyV2Tone;
}

export interface StrategyV2Row {
  id: string;
  name: string;
  externalKey: string;
  owner: string;
  statusLabel: string;
  statusTone: StrategyV2Tone;
  versionLabel: string;
  versionStatus: string;
  executionModes: string;
  runtimeStates: string;
  instruments: string;
  performanceR: string;
  trades: string;
  recommendedNextStep: string;
  href: string;
}

export interface StrategyV2OverviewViewModel {
  generatedAt: string;
  sourceLabel: string;
  sourceDetail: string;
  empty: boolean;
  metrics: StrategyV2Metric[];
  rows: StrategyV2Row[];
  instanceRows: StrategyV2RuntimeInstanceRow[];
  signalRows: StrategyV2SignalRow[];
  signalSummary: StrategyV2SignalSummary;
}

export interface StrategyV2RuntimeInstanceRow {
  id: string;
  shortId: string;
  strategyName: string;
  versionLabel: string;
  mode: string;
  modeTone: StrategyV2Tone;
  runtime: string;
  runtimeTone: StrategyV2Tone;
  scope: string;
  sessions: string;
  account: string;
  approval: string;
  heartbeat: string;
  driftStatus: string;
  driftTone: StrategyV2Tone;
  driftDetail: string;
}

export interface StrategyV2SignalRow {
  id: string;
  shortId: string;
  signalId: string;
  strategyInstanceId: string;
  shortInstanceId: string;
  instrument: string;
  direction: string;
  confidence: string;
  mode: string;
  status: string;
  statusTone: StrategyV2Tone;
  generatedAt: string;
  expiresAt: string;
  correlationId: string;
  payloadHash: string;
  summary: string;
  canConsume: boolean;
}

export interface StrategyV2SignalSummary {
  available: boolean;
  count: number;
  pending: number;
  paper: number;
  shadow: number;
  live: number;
}

export interface StrategyV2DetailViewModel {
  id: string;
  title: string;
  subtitle: string;
  sourceDetail: string;
  metrics: StrategyV2Metric[];
  versions: StrategyV2VersionRow[];
  instances: StrategyV2InstanceRow[];
  audit: StrategyV2AuditRow[];
  raw: StrategyV2OverviewItem;
}

export interface StrategyV2VersionRow {
  id: string;
  label: string;
  status: string;
  statusTone: StrategyV2Tone;
  artifact: string;
  metricsRef: string;
  updatedAt: string;
}

export interface StrategyV2InstanceRow {
  id: string;
  runtimeState: string;
  executionMode: string;
  tone: StrategyV2Tone;
  instruments: string;
  sessions: string;
  account: string;
  heartbeat: string;
}

export interface StrategyV2AuditRow {
  id: string;
  eventType: string;
  aggregate: string;
  actor: string;
  reason: string;
  at: string;
}

export function buildStrategyV2OverviewViewModel(data: StrategyV2Overview, legacy?: StrategyList | null, signals?: StrategyV2SignalPollResult | null): StrategyV2OverviewViewModel {
  const rows = data.strategies.map((strategy) => strategyRow(strategy, legacy));
  const signalRows = signalViewRows(signals?.items || []);
  const signalSummary = summarizeSignals(signals);
  return {
    generatedAt: formatDate(data.generated_at_utc),
    sourceLabel: "STRATEGY KERNEL V2",
    sourceDetail: data.source?.note || "Gouvernance lue depuis le registre Strategy v2.",
    empty: rows.length === 0,
    metrics: overviewMetrics(data, rows, signalSummary),
    rows,
    instanceRows: data.instances.map((instance) => runtimeInstanceRow(instance, data)),
    signalRows,
    signalSummary,
  };
}

function overviewMetrics(data: StrategyV2Overview, rows: StrategyV2Row[], signalSummary: StrategyV2SignalSummary): StrategyV2Metric[] {
  const covered = rows.filter((row) => row.executionModes !== "—").length;
  const running = data.instances.filter((instance) => String(instance.runtime_state || "").toUpperCase() === "RUNNING").length;
  const signalValue = signalSummary.available ? signalSummary.pending : "—";
  const signalDetail = signalSummary.available ? `${signalSummary.paper} paper · ${signalSummary.shadow} shadow · ${signalSummary.live} live` : "bus non chargé";
  return [
    { label: "Définitions", value: data.summary.definitions },
    { label: "Versions", value: data.summary.versions, detail: `${data.summary.published_versions} publiées` },
    { label: "Instances", value: data.summary.instances, detail: `${data.summary.shadow_instances} shadow · ${data.summary.paper_instances} paper · ${data.summary.live_instances} live`, tone: data.summary.live_instances ? "positive" : "neutral" },
    { label: "Couverture runtime", value: `${covered}/${Math.max(1, rows.length)}`, detail: "stratégies avec instance", tone: rows.length && covered === rows.length ? "positive" : "warning" },
    { label: "Instances RUNNING", value: running, detail: `${data.instances.length} instance(s) persistée(s)`, tone: running ? "positive" : "warning" },
    { label: "Signaux pending", value: signalValue, detail: signalDetail, tone: signalSummary.pending ? "warning" : signalSummary.available ? "positive" : "neutral" },
  ];
}

export function buildStrategyV2DetailViewModel(data: StrategyV2Overview, strategyDefinitionId: string, legacy?: StrategyList | null): StrategyV2DetailViewModel | null {
  const strategy = data.strategies.find((item) => item.strategy_definition_id === strategyDefinitionId || item.external_key === strategyDefinitionId);
  if (!strategy) return null;
  const row = strategyRow(strategy, legacy);
  const performance = legacyPerformance(strategy, legacy);
  return {
    id: strategy.strategy_definition_id,
    title: strategy.name || strategy.external_key || strategy.strategy_definition_id,
    subtitle: `${strategy.external_key || "clé externe absente"} · ${strategy.owner || "owner non renseigné"}`,
    sourceDetail: data.source?.note || "Source canonique Strategy Kernel v2.",
    metrics: [
      { label: "État opérateur", value: row.statusLabel, detail: row.recommendedNextStep, tone: row.statusTone },
      { label: "Versions", value: strategy.version_count, detail: `${strategy.versions.filter((item) => item.status === "PUBLISHED").length} publiée(s)` },
      { label: "Instances", value: strategy.instance_count, detail: row.executionModes, tone: strategy.live_instance ? "positive" : strategy.paper_instance ? "warning" : "neutral" },
      { label: "Performance legacy", value: performance ? formatR(performance.totalR) : "—", detail: performance ? `${performance.trades} trades historiques` : "fallback historique absent" },
    ],
    versions: strategy.versions.map(versionRow),
    instances: strategy.instances.map(instanceRow),
    audit: strategy.recent_audit.map(auditRow),
    raw: strategy,
  };
}

function strategyRow(strategy: StrategyV2OverviewItem, legacy?: StrategyList | null): StrategyV2Row {
  const performance = legacyPerformance(strategy, legacy);
  const status = strategy.live_instance
    ? "LIVE"
    : strategy.paper_instance
      ? "PAPER"
      : strategy.operator_state.has_runtime_instance
        ? "SHADOW"
        : strategy.operator_state.has_published_version
          ? "PUBLIÉE"
          : strategy.versions.length
            ? "À VALIDER"
            : "DÉFINITION";
  return {
    id: strategy.strategy_definition_id,
    name: strategy.name || strategy.external_key || "Stratégie sans nom",
    externalKey: strategy.external_key || "—",
    owner: strategy.owner || "—",
    statusLabel: status,
    statusTone: strategyTone(strategy),
    versionLabel: strategy.published_version?.version_label || strategy.latest_version?.version_label || "—",
    versionStatus: labelVersionStatus(strategy.published_version?.status || strategy.latest_version?.status),
    executionModes: compactCounts(strategy.instances.map((item) => item.execution_mode)),
    runtimeStates: compactCounts(strategy.instances.map((item) => item.runtime_state)),
    instruments: compactList(unique(strategy.instances.flatMap((item) => item.instrument_scope || []))),
    performanceR: performance ? formatR(performance.totalR) : "—",
    trades: performance ? String(performance.trades) : "—",
    recommendedNextStep: labelNextStep(strategy.operator_state.recommended_next_step),
    href: `/strategies/${encodeURIComponent(strategy.strategy_definition_id)}`,
  };
}

function versionRow(version: StrategyV2Version): StrategyV2VersionRow {
  return {
    id: version.strategy_version_id,
    label: version.version_label || version.strategy_version_id,
    status: labelVersionStatus(version.status),
    statusTone: versionStatusTone(version.status),
    artifact: version.compiled_artifact_ref || "—",
    metricsRef: version.validated_metrics_ref || "—",
    updatedAt: formatDate(version.updated_at_utc || version.updated_at || version.created_at_utc || version.created_at),
  };
}

function instanceRow(instance: StrategyV2Instance): StrategyV2InstanceRow {
  return {
    id: instance.strategy_instance_id,
    runtimeState: labelRuntimeState(instance.runtime_state),
    executionMode: labelExecutionMode(instance.execution_mode),
    tone: instanceTone(instance),
    instruments: compactList(instance.instrument_scope || []),
    sessions: compactList(instance.session_scope || []),
    account: instance.account_scope || "—",
    heartbeat: formatDate(instance.last_heartbeat_at),
  };
}

function auditRow(event: StrategyV2AuditEvent): StrategyV2AuditRow {
  return {
    id: event.audit_event_id,
    eventType: event.event_type || "AUDIT_EVENT",
    aggregate: `${event.aggregate_type}:${shortId(event.aggregate_id)}`,
    actor: event.actor || "desk",
    reason: event.reason || "—",
    at: formatDate(event.created_at_utc || event.created_at),
  };
}

function runtimeInstanceRow(instance: StrategyV2Instance, data: StrategyV2Overview): StrategyV2RuntimeInstanceRow {
  const version = data.versions.find((item) => item.strategy_version_id === instance.strategy_version_id);
  const definition = data.definitions.find((item) => item.strategy_definition_id === version?.strategy_definition_id);
  const drift = performanceDriftView(instance, version);
  return {
    id: instance.strategy_instance_id,
    shortId: shortId(instance.strategy_instance_id),
    strategyName: definition?.name || definition?.external_key || shortId(version?.strategy_definition_id),
    versionLabel: version?.version_label || shortId(instance.strategy_version_id),
    mode: labelExecutionMode(instance.execution_mode),
    modeTone: executionModeTone(instance.execution_mode),
    runtime: labelRuntimeState(instance.runtime_state),
    runtimeTone: instanceTone(instance),
    scope: compactList(instance.instrument_scope || []),
    sessions: compactList(instance.session_scope || []),
    account: instance.account_scope || "—",
    approval: instance.operator_approval_id ? shortId(instance.operator_approval_id) : "—",
    heartbeat: formatDate(instance.last_heartbeat_at),
    driftStatus: drift.label,
    driftTone: drift.tone,
    driftDetail: drift.detail,
  };
}

function performanceDriftView(instance: StrategyV2Instance, version?: StrategyV2Version): { label: string; tone: StrategyV2Tone; detail: string } {
  const explicit = asRecord(instance.performance_drift);
  if (explicit?.status) return driftStatusView(String(explicit.status), readText(explicit, "severity"), driftReason(explicit));
  const baseline = driftMetricSource(instance, version, "baseline");
  const observed = driftMetricSource(instance, version, "observed");
  if (!hasMetrics(baseline)) return driftStatusView("BASELINE_MISSING", "warning", "baseline_metrics absent");
  if (!hasMetrics(observed)) return driftStatusView("INSUFFICIENT_DATA", "info", "observed_metrics absent");
  const totalDrop = metricDrop(baseline, observed, "total_r", "totalR");
  const expectancyDrop = metricDrop(baseline, observed, "expectancy_r", "expectancyR");
  const drawdown = drawdownWorsening(baseline, observed);
  if (totalDrop >= 4 || expectancyDrop >= 0.5 || drawdown >= 3) return driftStatusView("DRIFT", "critical", `ΔR ${formatSigned(-totalDrop)} · ΔExp ${formatSigned(-expectancyDrop)}`);
  if (totalDrop >= 2 || expectancyDrop >= 0.25 || drawdown >= 1.5) return driftStatusView("WATCH", "warning", `ΔR ${formatSigned(-totalDrop)} · DD +${drawdown.toFixed(2)} R`);
  return driftStatusView("OK", "positive", "alignée à la baseline");
}

function driftMetricSource(instance: StrategyV2Instance, version: StrategyV2Version | undefined, kind: "baseline" | "observed") {
  const mode = String(instance.execution_mode || "shadow").toLowerCase();
  const im = asRecord(instance.metadata) || {};
  let vm: Record<string, unknown> = {};
  if (version) vm = asRecord(version.metadata) || {};
  if (kind === "baseline") return firstRecord([im.performance_baseline, im.baseline_metrics, vm.performance_baseline, vm.baseline_metrics, vm.validated_metrics]);
  return firstRecord([im.performance_observed, im.observed_metrics, im.live_metrics, im.paper_metrics, im.shadow_metrics, im[`${mode}_metrics`], im[`${mode}_performance`]]);
}

function firstRecord(candidates: unknown[]) {
  return asRecord(candidates.find((item) => asRecord(item))) || {};
}

function driftStatusView(status: string, severity: string, detail: string) {
  const normalized = String(status || "").toUpperCase();
  const label = ({ OK: "Drift OK", WATCH: "Drift watch", DRIFT: "Drift critique", BASELINE_MISSING: "Baseline absente", INSUFFICIENT_DATA: "Observation insuff." } as Record<string, string>)[normalized] || normalized;
  const tone: StrategyV2Tone = normalized === "DRIFT" || severity === "critical" ? "critical" : normalized === "WATCH" || normalized === "BASELINE_MISSING" || severity === "warning" ? "warning" : normalized === "OK" ? "positive" : "neutral";
  return { label, tone, detail: detail || "—" };
}

function driftReason(report: Record<string, unknown>) {
  const reasons = Array.isArray(report.reasons) ? report.reasons : [];
  const first = asRecord(reasons[0]);
  return readText(first, "code") || readText(first, "message") || readText(report, "status");
}

function signalViewRows(items: StrategyV2SignalOutboxItem[]): StrategyV2SignalRow[] {
  return [...items]
    .sort((left, right) => dateValue(right.generated_at_utc) - dateValue(left.generated_at_utc))
    .map((item) => ({
      id: item.signal_outbox_id,
      shortId: shortId(item.signal_outbox_id),
      signalId: shortId(item.signal_id),
      strategyInstanceId: item.strategy_instance_id,
      shortInstanceId: shortId(item.strategy_instance_id),
      instrument: item.instrument || "—",
      direction: labelDirection(item.direction),
      confidence: formatConfidence(item.confidence),
      mode: labelExecutionMode(item.execution_mode_origin),
      status: labelSignalStatus(item.status),
      statusTone: signalTone(item.status),
      generatedAt: formatDate(item.generated_at_utc),
      expiresAt: formatDate(item.expires_at_utc),
      correlationId: shortId(item.correlation_id),
      payloadHash: item.payload_hash || "—",
      summary: signalSummaryText(item),
      canConsume: ["PENDING", "PUBLISHED"].includes(String(item.status || "").toUpperCase()),
    }));
}

function summarizeSignals(signals?: StrategyV2SignalPollResult | null): StrategyV2SignalSummary {
  const items = signals?.items || [];
  const byMode = (mode: string) => items.filter((item) => String(item.execution_mode_origin || "").toUpperCase() === mode).length;
  return {
    available: Boolean(signals),
    count: items.length,
    pending: items.filter((item) => String(item.status || "").toUpperCase() === "PENDING").length,
    paper: byMode("PAPER"),
    shadow: byMode("SHADOW"),
    live: byMode("LIVE"),
  };
}

function signalSummaryText(item: StrategyV2SignalOutboxItem) {
  const payload = asRecord(item.payload);
  const signal = asRecord(payload?.signal) || payload;
  const parts = [
    readText(signal, "setup_id") || readText(signal, "setupId"),
    readText(signal, "decision"),
    readText(signal, "reason") || readText(signal, "rationale"),
  ].filter(Boolean);
  return parts.length ? parts.slice(0, 2).join(" · ") : "Signal canonique Strategy Kernel";
}

function strategyTone(strategy: StrategyV2OverviewItem): StrategyV2Tone {
  if (strategy.live_instance) return "positive";
  if (strategy.paper_instance) return "warning";
  if (strategy.operator_state.has_runtime_instance) return "neutral";
  if (strategy.operator_state.has_published_version) return "warning";
  if (strategy.versions.length) return "warning";
  return "neutral";
}

function instanceTone(instance: StrategyV2Instance): StrategyV2Tone {
  const runtime = String(instance.runtime_state || "").toUpperCase();
  if (runtime === "RUNNING") return "positive";
  if (runtime === "ERRORED" || runtime === "FAILED_TO_START") return "critical";
  if (runtime === "PAUSED" || runtime === "STARTING") return "warning";
  return "neutral";
}

function executionModeTone(value?: string | null): StrategyV2Tone {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "LIVE") return "positive";
  if (normalized === "PAPER") return "warning";
  if (normalized === "SHADOW") return "neutral";
  return "neutral";
}

function signalTone(value?: string | null): StrategyV2Tone {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "CONSUMED") return "positive";
  if (normalized === "FAILED" || normalized === "CANCELLED") return "critical";
  if (normalized === "PENDING") return "warning";
  return "neutral";
}

function versionStatusTone(status?: string | null): StrategyV2Tone {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "PUBLISHED" || normalized === "VALIDATED") return "positive";
  if (normalized === "IN_SIMULATION") return "warning";
  if (normalized === "RETIRED") return "neutral";
  return "neutral";
}

function legacyPerformance(strategy: StrategyV2OverviewItem, legacy?: StrategyList | null) {
  const ids = new Set([strategy.strategy_definition_id, strategy.external_key, strategy.name].filter(Boolean));
  const item = legacy?.items.find((candidate) => ids.has(candidate.id));
  return item?.performance || null;
}

function compactCounts(values: string[]) {
  const counts = values.filter(Boolean).reduce((state, value) => {
    const key = String(value).toUpperCase();
    state[key] = (state[key] || 0) + 1;
    return state;
  }, {} as Record<string, number>);
  const entries = Object.entries(counts);
  return entries.length ? entries.map(([key, count]) => `${labelExecutionMode(key)} ${count}`).join(" · ") : "—";
}

function compactList(values: string[]) {
  const items = unique(values).filter(Boolean);
  return items.length ? items.join(", ") : "—";
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => String(value || "").toUpperCase()).filter(Boolean))];
}

function labelNextStep(value?: string | null) {
  return ({
    CREATE_VERSION: "Créer une version exploitable",
    VALIDATE_AND_PUBLISH_VERSION: "Valider puis publier",
    CREATE_SHADOW_INSTANCE: "Créer une instance SHADOW",
    RUN_SHADOW_VALIDATION: "Laisser tourner SHADOW",
    EVALUATE_PAPER_PROMOTION: "Évaluer promotion PAPER → LIVE",
    MONITOR_LIVE_INSTANCE: "Surveiller l’instance LIVE",
  } as Record<string, string>)[String(value || "")] || "À qualifier";
}

function labelVersionStatus(value?: string | null) {
  return ({
    DRAFT: "Brouillon",
    IN_SIMULATION: "En simulation",
    VALIDATED: "Validée",
    PUBLISHED: "Publiée",
    RETIRED: "Retirée",
  } as Record<string, string>)[String(value || "").toUpperCase()] || "—";
}

function labelRuntimeState(value?: string | null) {
  return ({
    CREATED: "Créée",
    STARTING: "Démarrage",
    RUNNING: "En marche",
    PAUSED: "En pause",
    STOPPED: "Arrêtée",
    ERRORED: "Erreur",
    FAILED_TO_START: "Échec démarrage",
  } as Record<string, string>)[String(value || "").toUpperCase()] || "—";
}

function labelExecutionMode(value?: string | null) {
  return ({
    SHADOW: "Shadow",
    PAPER: "Paper",
    LIVE: "Live",
    DISABLED: "Désactivé",
  } as Record<string, string>)[String(value || "").toUpperCase()] || String(value || "—");
}

function labelSignalStatus(value?: string | null) {
  return ({
    PENDING: "En attente",
    PUBLISHED: "Publié",
    CONSUMED: "Consommé",
    FAILED: "Échec",
    CANCELLED: "Annulé",
  } as Record<string, string>)[String(value || "").toUpperCase()] || String(value || "—");
}

function labelDirection(value?: string | null) {
  return ({
    LONG: "Long",
    SHORT: "Short",
    FLAT: "Flat",
    NO_TRADE: "No trade",
  } as Record<string, string>)[String(value || "").toUpperCase()] || String(value || "—");
}

function hasMetrics(metrics: Record<string, unknown>) {
  return ["trade_count", "trades", "total_r", "totalR", "expectancy_r", "expectancyR", "win_rate", "winRate", "profit_factor", "profitFactor", "max_drawdown_r", "maxDrawdownR"]
    .some((key) => Number.isFinite(Number(metrics[key])));
}

function metricDrop(baseline: Record<string, unknown>, observed: Record<string, unknown>, snakeKey: string, camelKey: string) {
  const left = metricNumber(baseline[snakeKey] ?? baseline[camelKey]);
  const right = metricNumber(observed[snakeKey] ?? observed[camelKey]);
  return left === null || right === null ? 0 : round(left - right);
}

function drawdownWorsening(baseline: Record<string, unknown>, observed: Record<string, unknown>) {
  const left = metricNumber(baseline.max_drawdown_r ?? baseline.maxDrawdownR);
  const right = metricNumber(observed.max_drawdown_r ?? observed.maxDrawdownR);
  return left === null || right === null ? 0 : round(Math.abs(right) - Math.abs(left));
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" }).format(date);
}

function formatR(value: number) {
  return `${value > 0 ? "+" : ""}${Number(value || 0).toFixed(2)} R`;
}

function formatConfidence(value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const numeric = Number(value);
  return numeric <= 1 ? `${Math.round(numeric * 100)}%` : `${numeric.toFixed(1)}%`;
}

function formatSigned(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)} R`;
}

function shortId(value?: string | null) {
  return value ? `${value.slice(0, 8)}…` : "—";
}

function dateValue(value?: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readText(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function metricNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}
