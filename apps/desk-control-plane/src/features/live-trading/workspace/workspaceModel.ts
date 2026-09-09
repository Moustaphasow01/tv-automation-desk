import type { LiveFocusView } from "@/domains/front-api/viewModels";
import type { DataValue } from "@/shared/contracts";
import { buildFocusQueueItems, type FocusQueueItem } from "../focusJournalModel";
import { operatorCopy } from "@/design-system/operatorVocabulary";
import { timeframeSeconds } from "./timeframeDuration";

export type TicketSection = "decisions" | "tracking" | "history";
export type WorkspacePanel = "markets" | "tickets" | "tracking" | "review";
export const ticketSections: { id: TicketSection; label: string }[] = [
  { id: "decisions", label: "À décider" }, { id: "tracking", label: "En suivi" }, { id: "history", label: "Historique" },
];

export function workspaceTickets(focus: LiveFocusView): FocusQueueItem[] {
  return buildFocusQueueItems(focus).map((item) => {
    // A rejected human decision does not close an independently tracked theoretical trade.
    const state = item.card?.theoreticalTradeStatus?.toUpperCase();
    const theoreticalOpen = state === "OPEN" || state === "ENTRY_FILLED";
    return theoreticalOpen ? { ...item, terminal: false, actionable: false, status: "Position théorique ouverte" } : item;
  });
}

export function ticketSection(item: FocusQueueItem): TicketSection {
  return item.terminal ? "history" : item.actionable ? "decisions" : "tracking";
}

export function selectWorkspaceTicket(items: readonly FocusQueueItem[], id: string | null): FocusQueueItem | null {
  // A missing explicit ID must not silently bind actions to another ticket.
  if (id) return items.find((item) => item.key === id) ?? null;
  return items.find((item) => item.actionable && !item.terminal) ?? null;
}

export function stableTicketOrder(items: readonly FocusQueueItem[], ids: readonly string[]) {
  const byId = new Map(items.map((item) => [item.key, item]));
  const ordered = ids.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
  const known = new Set(ids);
  return { ordered, incoming: items.filter((item) => !known.has(item.key)) };
}

export function numberLabel(value: unknown, maximumFractionDigits = 2): string {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits }).format(value) : "—";
}

export function knownLabel(value: DataValue<string | number> | undefined): string {
  return value?.state === "KNOWN" ? String(value.value) : "Non publié";
}

export function parisTime(value: string | null | undefined, date = false): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Heure non publiée";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", ...(date ? { day: "2-digit", month: "2-digit" } : {}),
    hour: "2-digit", minute: "2-digit", ...(date ? {} : { second: "2-digit" }),
  }).format(new Date(value));
}

export function timeframeLabel(value: string): string {
  const seconds = timeframeSeconds(value);
  if (seconds === null || !Number.isFinite(seconds)) return value;
  if (/D$/i.test(value)) return `${seconds / 86_400} j`;
  const minutes = seconds / 60;
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;
}

export function sideLabel(value: string): string {
  return /^(LONG|BUY)$/i.test(value) ? "Achat" : /^(SHORT|SELL)$/i.test(value) ? "Vente" : "Sens non publié";
}

export function marketName(symbol: string): string {
  return ({ ZC: "Maïs", ZW: "Blé", ZS: "Soja", ES: "S&P 500", MES: "Micro S&P 500", NQ: "Nasdaq 100", MNQ: "Micro Nasdaq 100", BTCUSD: "Bitcoin", SOLUSD: "Solana", DOGEUSD: "Dogecoin" } as Record<string, string>)[symbol] ?? symbol;
}

export function workspaceCopy(value: string | null | undefined): string {
  return operatorCopy(value ?? "")
    .replace(/\bPREOPEN\b/g, "avant séance")
    .replace(/\bUNAVAILABLE\b/g, "indisponible")
    .replace(/\bUNKNOWN\b/g, "non renseigné")
    .replace(/\bPARTIAL\b/g, "partiel")
    .replace(/\b(?:backend|BFF)\b/gi, "desk")
    .replace(/\bHuman Gate\b/gi, "validation humaine")
    .replace(/\bOrderIntent\b/g, "ticket")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (timestamp) => `${parisTime(timestamp, true)} (Paris)`);
}

export function ageLabel(value: string | undefined, now: number): string {
  const milliseconds = value ? now - Date.parse(value) : NaN;
  if (!Number.isFinite(milliseconds)) return "Âge non publié";
  if (milliseconds < -30_000) return "Horodatage à vérifier";
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  if (minutes < 1) return "Moins d’une minute";
  if (minutes < 60) return `Il y a ${minutes} min`;
  if (minutes < 1_440) return `Il y a ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return `Historique · il y a ${Math.floor(minutes / 1_440)} jour(s)`;
}
