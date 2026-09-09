import type { FocusQueueItem } from "../focusJournalModel";

export type WorkspaceAlert = { id: string; ticketId: string; at: string; title: string; detail: string; severity: "attention" | "information"; read: boolean };
export type WorkspaceAlertState = { observed: Record<string, string>; alerts: WorkspaceAlert[]; initialized: boolean };
export const initialAlertState: WorkspaceAlertState = { observed: {}, alerts: [], initialized: false };
// A presentation reminder, not a trading-validity or authorization rule.
export const EXPIRY_NOTICE_MS = 120_000;

export function advanceWorkspaceAlerts(previous: WorkspaceAlertState, tickets: readonly FocusQueueItem[], now: number): WorkspaceAlertState {
  const alerts = [...previous.alerts];
  const known = new Set(alerts.map((alert) => alert.id));
  const observed: Record<string, string> = Object.create(null);
  const add = (alert: Omit<WorkspaceAlert, "read">) => {
    if (!known.has(alert.id)) { alerts.unshift({ ...alert, read: false }); known.add(alert.id); }
  };
  for (const item of tickets) {
    const signature = [item.status, item.card?.operatorState, item.card?.theoreticalTradeStatus, item.card?.revision].join("|");
    observed[item.key] = signature;
    const common = { ticketId: item.key, at: item.asOf || item.createdAt || new Date(now).toISOString() };
    if (item.actionable && !item.terminal && !previous.observed[item.key]) add({ ...common, id: item.key + ":new", title: item.instrument + " · décision disponible", detail: "Un ticket autorisé demande votre lecture. Ouvrir ne confirme aucun ordre.", severity: "attention" });
    if (previous.initialized && previous.observed[item.key] && previous.observed[item.key] !== signature) add({ ...common, id: item.key + ":state:" + signature, title: item.instrument + " · état modifié", detail: item.status, severity: "information" });
    const until = Date.parse(item.expiresAt ?? "") - now;
    if (item.actionable && !item.terminal && until > 0 && until <= EXPIRY_NOTICE_MS) add({ ...common, at: new Date(now).toISOString(), id: item.key + ":expiry:" + item.expiresAt, title: item.instrument + " · échéance proche", detail: "Moins de deux minutes de validité publiée. Relisez le plan ; aucune décision automatique.", severity: "attention" });
  }
  const next = { observed, alerts: alerts.slice(0, 100), initialized: true };
  return JSON.stringify(next) === JSON.stringify(previous) ? previous : next;
}
