import type { ReplayDaySummary, ReplayList } from "@/operationsTypes";

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export function entityLabel(reference: string | null | undefined, kind = "Élément") {
  const value = String(reference || "").trim();
  if (!value) return `${kind} sans référence`;
  const date = extractDate(value);
  const time = extractTime(value);
  if (date) return `${kind} du ${date}${time ? ` · ${time}` : ""}`;
  return `${kind} · ${shortReference(value)}`;
}

export function replayLabel(reference: string | null | undefined) {
  return entityLabel(reference, "Replay");
}

export function workflowLabel(reference: string | null | undefined) {
  const value = String(reference || "");
  if (value.startsWith("replay:")) return replayLabel(value.slice("replay:".length));
  return entityLabel(value, "Automatisation");
}

export function gptProcessLabel(reference: string | null | undefined) {
  return entityLabel(reference, "Analyse GPT");
}

export function incidentLabel(reference: string | null | undefined) {
  return entityLabel(reference, "Incident");
}

export function shortReference(reference: string | null | undefined, visible = 8) {
  const value = String(reference || "").trim();
  if (!value) return "N/D";
  if (value.length <= visible + 3) return value;
  return `#${value.slice(-visible).toUpperCase()}`;
}

export function technicalReference(reference: string | null | undefined) {
  return String(reference || "").trim() || "N/D";
}

function extractDate(value: string) {
  const match = value.match(/20\d{2}[-_](\d{2})[-_](\d{2})/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${day} ${MONTHS[month - 1]}`;
}

function extractTime(value: string) {
  const match = value.match(/T(\d{2})[_:](\d{2})/);
  return match ? `${match[1]}:${match[2]}` : null;
}

const SESSION_LABELS: Record<string, string> = {
  "Asia Open": "Session Asie",
  "NY Open": "Session New York",
  asia_open: "Session Asie",
  ny_open: "Session New York",
  full_day: "Journée continue",
};

export function sessionLabel(value: string | null | undefined) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return SESSION_LABELS[trimmed] || trimmed.replaceAll("_", " ");
}

const DATA_QUALITY_LABELS: Record<string, string> = {
  ready: "prête",
  healthy: "opérationnelle",
  context_limited: "contexte partiel",
  degraded: "dégradée",
  waiting: "en attente",
};

export function dataQualityLabel(value: string | null | undefined) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return DATA_QUALITY_LABELS[trimmed] || trimmed.replaceAll("_", " ");
}

const DESK_STATUS_COPY: Record<string, string> = {
  "Run Master to create a current thesis.": "Lancez le Master pour créer la thèse courante.",
  "Master analysis required": "Analyse Master requise",
  WAIT: "Attente",
  wait: "Attente",
  "MARKET FEED": "Flux marché",
  NO_ACTION: "Aucune action",
  "NO ACTIVE THESIS": "Aucune thèse active",
  NO_ACTIVE_THESIS: "Aucune thèse active",
  "NO SETUP": "Aucun setup",
  NO_SETUP: "Aucun setup",
  "NO POSITION": "Aucune position",
  NO_POSITION: "Aucune position",
};

export function deskStatusText(value: string | null | undefined) {
  if (!value) return "";
  const trimmed = value.trim();
  if (DESK_STATUS_COPY[trimmed]) return DESK_STATUS_COPY[trimmed];
  return Object.entries(DESK_STATUS_COPY).reduce((text, [code, label]) => {
    // Skip WAIT/wait in the substring fallback: as a bare 4-letter code it would
    // also match inside unrelated words like "awaiting"/"waiting", mangling them.
    if (code === "WAIT" || code === "wait") return text;
    return text.replaceAll(code, label);
  }, value);
}

export function replayPulseHeadline(summary: ReplayList["summary"]) {
  if (summary.failed > 0 || summary.blocked > 0) {
    return [
      summary.failed > 0 ? `${summary.failed} échec${summary.failed > 1 ? "s" : ""}` : null,
      summary.blocked > 0 ? `${summary.blocked} bloqué${summary.blocked > 1 ? "s" : ""}` : null,
    ].filter(Boolean).join(" · ");
  }
  if (summary.active > 0) {
    return `${summary.active} replay${summary.active > 1 ? "s" : ""} actif${summary.active > 1 ? "s" : ""} · aucun blocage`;
  }
  return "Aucun replay en cours";
}

export function findCertifiedReplayDay(days: ReplayDaySummary[]) {
  return [...days]
    .sort((left, right) => right.date.localeCompare(left.date))
    .find(day => Number(day.resultEligibleSessions || 0) > 0) || null;
}

export function findActiveReplayDay(days: ReplayDaySummary[]) {
  return [...days]
    .sort((left, right) => right.date.localeCompare(left.date))
    .find(day => !["completed", "cancelled"].includes(day.status)) || null;
}
