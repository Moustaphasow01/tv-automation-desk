import { rows, upper } from "./front-control-plane-projection-helpers.js";
import { codedError, text } from "./front-control-plane-common.js";

export function safeArrayFirst(value) { return rows(value)[0] || null; }

export function isSameUtcDay(value, nowIso) {
  const date = new Date(value);
  const reference = new Date(nowIso);
  return !Number.isNaN(date.getTime()) && !Number.isNaN(reference.getTime())
    && date.getUTCFullYear() === reference.getUTCFullYear() && date.getUTCMonth() === reference.getUTCMonth() && date.getUTCDate() === reference.getUTCDate();
}

export function hasTradeId(item) { return Boolean(item?.trade_id || item?.position_id); }

export function hasIncidentId(item) { return Boolean(item?.incident_id); }

export function selectById(items, requestedId, idOf, errorCode) {
  if (!requestedId) throw codedError(`${errorCode}_ID_REQUIRED`, "Resource identifier is required.", 400);
  const candidate = items.find((item) => String(idOf(item)) === String(requestedId));
  if (!candidate) throw codedError(errorCode, `Unknown resource: ${requestedId}`, 404);
  return candidate;
}

export function requiredQuery(query, key, code) { const value = text(query?.[key] ?? query?.[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)], ""); if (!value) throw codedError(code, `${key} is required`, 400); return value; }

export function metric(label, value) { return { label, value: String(value) }; }

export function explorerItem({ id, title, subtitle, status, primary, secondary, route, tags = [], facts = [] }) { return { id: text(id, "unavailable"), title: text(title, "Objet sans titre"), subtitle: text(subtitle, "Détail non publié"), status: text(status, "UNKNOWN"), primary: text(primary, "—"), secondary: text(secondary, "—"), route: route || null, tags: tags.filter(Boolean).map(String), facts }; }

export function explorerView(title, description, items, metrics = []) { return { summary: { title, description, total: items.length, metrics }, items }; }

export function side(value) { const normalized = upper(value); if (normalized.includes("SHORT") || normalized === "SELL") return "SHORT"; if (normalized.includes("LONG") || normalized === "BUY") return "LONG"; return "FLAT"; }
