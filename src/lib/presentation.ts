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
