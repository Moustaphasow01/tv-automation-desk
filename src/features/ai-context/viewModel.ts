import type { AiContextControl, AiContextDecision, AiContextMetric, AiContextOverview, AiContextTone } from "@/features/ai-context/types";

export interface AiContextMetricCard {
  label: string;
  value: string | number;
  detail?: string;
  tone?: AiContextTone;
}

export interface AiContextDecisionRow {
  key: string;
  task: string;
  mode: string;
  recommendation: string;
  binding: string;
  fallback: string;
  rationale: string;
  model: string;
  latency: string;
  updated: string;
  tone: AiContextTone;
}

export interface AiContextMetricRow {
  key: string;
  task: string;
  outcome: string;
  model: string;
  latency: string;
  tokens: string;
  cost: string;
  finished: string;
  tone: AiContextTone;
}

export interface AiContextViewModel {
  generatedAt: string;
  sourceLabel: string;
  sourceDetail: string;
  health: { label: string; tone: AiContextTone; detail: string };
  metrics: AiContextMetricCard[];
  decisionRows: AiContextDecisionRow[];
  metricRows: AiContextMetricRow[];
  controls: AiContextControl[];
  warnings: string[];
}

export function buildAiContextViewModel(data: AiContextOverview): AiContextViewModel {
  const decisionRows = data.decisions.map(decisionRow);
  return {
    generatedAt: formatDate(data.generatedAt),
    sourceLabel: sourceLabel(data.source.status),
    sourceDetail: data.source.reads.map(read => `${read.source}:${read.status}${read.error_code ? `/${read.error_code}` : ""}`).join(" · "),
    health: health(data),
    metrics: metricCards(data),
    decisionRows,
    metricRows: data.metrics.map(metricRow),
    controls: data.controls,
    warnings: warnings(data, decisionRows),
  };
}

function health(data: AiContextOverview) {
  if (data.summary.status === "READY") return { label: "Prêt", tone: "positive" as const, detail: `${data.summary.total_decisions} décision(s) contextuelles` };
  if (data.summary.status === "DEGRADED") return { label: "Dégradé", tone: "warning" as const, detail: `${data.summary.open_dead_letters} DLQ ouverte(s)` };
  return { label: "Aucune décision", tone: "info" as const, detail: "Le runtime réel ne montre pas encore de tâche CONTEXT_DECISION." };
}

function metricCards(data: AiContextOverview): AiContextMetricCard[] {
  return [
    { label: "État", value: health(data).label, detail: data.summary.status, tone: health(data).tone },
    { label: "Décisions", value: data.summary.total_decisions, detail: `${data.summary.shadow_count} shadow · ${data.summary.enforced_count} enforced` },
    { label: "Fallbacks", value: data.summary.fallback_count, detail: "WAIT déterministe", tone: data.summary.fallback_count ? "warning" : "positive" },
    { label: "Runs récents", value: data.summary.recent_runs, detail: "metrics agent-runtime" },
    { label: "DLQ", value: data.summary.open_dead_letters, detail: "erreurs ouvertes", tone: data.summary.open_dead_letters ? "critical" : "positive" },
    { label: "Dernière décision", value: formatTime(data.summary.latest_decision_at_utc), detail: "heure persistée" },
  ];
}

function decisionRow(item: AiContextDecision): AiContextDecisionRow {
  return {
    key: item.decision_id || item.task_id,
    task: `${shortId(item.task_id)} · ${item.task_type}`,
    mode: item.mode || "UNKNOWN",
    recommendation: item.recommendation || "UNKNOWN",
    binding: item.binding_action || "OBSERVE_ONLY",
    fallback: item.fallback_applied ? item.fallback_reason || "fallback" : "non",
    rationale: item.rationale || "Aucune explication persistée.",
    model: [item.model, item.reasoning_effort].filter(Boolean).join(" · ") || "modèle non renseigné",
    latency: item.latency_ms === null ? "—" : `${Math.round(item.latency_ms / 1000)}s`,
    updated: formatDate(item.updated_at_utc),
    tone: decisionTone(item),
  };
}

function metricRow(item: AiContextMetric): AiContextMetricRow {
  return {
    key: item.metric_id,
    task: `${shortId(item.task_id)} · ${item.task_type}`,
    outcome: item.outcome,
    model: [item.model, item.reasoning_effort].filter(Boolean).join(" · ") || "modèle non renseigné",
    latency: item.total_latency_ms === null ? "—" : `${Math.round(item.total_latency_ms / 1000)}s`,
    tokens: item.total_tokens === null ? "—" : String(item.total_tokens),
    cost: item.cost_micros_usd === null ? "—" : `$${(item.cost_micros_usd / 1_000_000).toFixed(4)}`,
    finished: formatDate(item.finished_at_utc),
    tone: item.outcome === "COMPLETED" ? "positive" : item.outcome === "FAILED" ? "critical" : "warning",
  };
}

function decisionTone(item: AiContextDecision): AiContextTone {
  if (item.fallback_applied) return "warning";
  if (item.recommendation === "REJECT") return "critical";
  if (item.recommendation === "TAKE" || item.recommendation === "TAKE_REDUCED") return "positive";
  if (item.recommendation === "WAIT") return "info";
  return "neutral";
}

function warnings(data: AiContextOverview, rows: AiContextDecisionRow[]) {
  return [
    ...(data.source.status !== "ready" ? ["Sources AI Context partielles : vérifier agent_tasks / metrics / DLQ."] : []),
    ...(!rows.length ? ["Aucune décision AI Context réelle visible pour l’instant."] : []),
    ...data.controls.filter(control => control.severity !== "info").map(control => `${control.label} · ${control.detail}`),
  ];
}

function sourceLabel(status: AiContextOverview["source"]["status"]) {
  if (status === "ready") return "POSTGRES + API";
  if (status === "partial") return "Sources partielles";
  return "Sources indisponibles";
}

function shortId(value?: string | null) {
  const text = String(value || "");
  return text.length > 16 ? `${text.slice(0, 8)}…${text.slice(-4)}` : text || "—";
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}
