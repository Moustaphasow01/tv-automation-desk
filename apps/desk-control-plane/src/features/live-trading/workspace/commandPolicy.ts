import type { LiveManualExecutionAction } from "@/domains/front-api/viewModels";
import type { ViewMeta } from "@/shared/contracts";
import type { HumanGateAction, OrderIntentDossier } from "@/features/order-intent/model";
import type { FocusQueueItem } from "../focusJournalModel";
import type { LiveTradingModel } from "../model";
import { focusTradePlanFromCard } from "../focusTradePlan";

export type WorkspaceAction = { kind: "gate"; action: HumanGateAction } | { kind: "manual"; action: LiveManualExecutionAction };
export type WorkspaceHealth = { connected: boolean; paused: boolean; failed: boolean; meta: ViewMeta };

export function readOnlyReason(health: WorkspaceHealth, now: number): string | null {
  if (health.paused) return "Reprenez tous les graphiques pour pouvoir décider.";
  if (!health.connected) return "Connexion en attente. Les décisions reprendront après synchronisation.";
  if (health.failed) return "Actualisation interrompue. Vérifiez la connexion puis actualisez.";
  if (!freshProjection(health.meta, now)) return "Données incomplètes ou anciennes. Actualisez avant de décider.";
  return null;
}

export function freshProjection(meta: ViewMeta, now: number): boolean {
  const age = now - Date.parse(meta.generatedAt);
  return meta.availability === "AVAILABLE" && !meta.stale && Number.isFinite(age) && age >= -30_000 && age <= 120_000;
}

export function workspaceActions(item: FocusQueueItem, dossier: OrderIntentDossier | null, model: LiveTradingModel, now: number): WorkspaceAction[] {
  const card = item.card;
  if (!card || !dossier || dossier.degradedReadOnly || !freshProjection(dossier.meta, now) || !freshProjection(model.meta, now)) return [];
  if (dossier.identity.orderIntentId.state !== "KNOWN" || dossier.identity.orderIntentId.value !== card.orderIntentId) return [];
  if (dossier.targetPosition.account.state !== "KNOWN" || dossier.signal.instrument.state !== "KNOWN" || dossier.signal.instrument.value !== card.instrument) return [];
  const allowed = card.allowedActions.map((value) => value.toUpperCase());
  const plan = focusTradePlanFromCard(card);
  const gate: WorkspaceAction[] = dossier.humanGate.actions.filter((action) => {
    if (!actionComplete(action, card.orderIntentId) || !allowed.includes(action.action)) return false;
    if (action.action !== "CONFIRM") return true; // Undo remains resource-authorized, not inferred from a display status.
    return !item.terminal && !card.expiredByTime && plan.authority === "AUTHORIZED"
      && plan.entry !== "Non publiée" && plan.stop !== "Non publié" && plan.targets.length > 0 && plan.orderType !== "Non publié"
      && typeof card.authorizedQuantity === "number" && card.authorizedQuantity > 0
      && Number.isFinite(Date.parse(card.expiresAt ?? "")) && Date.parse(card.expiresAt!) > now;
  }).map((action) => ({ kind: "gate", action }));
  const theoretical = model.selectedTheoreticalExecution;
  const manual: WorkspaceAction[] = theoretical?.portfolioOrderIntentId === card.orderIntentId
    ? (theoretical.manualExecution?.allowedActions ?? []).filter((action) => actionComplete(action, card.orderIntentId)).map((action) => ({ kind: "manual", action })) : [];
  return [...gate, ...manual];
}

function actionComplete(action: HumanGateAction | LiveManualExecutionAction, orderIntentId: string): boolean {
  const target = action.payload.portfolioOrderIntentId ?? action.payload.orderIntentId;
  return action.permission === "ALLOWED" && Boolean(action.actionId && action.commandType && action.expectedRevision) && target === orderIntentId;
}

export function actionFingerprint(value: WorkspaceAction): string {
  const action = value.action;
  return JSON.stringify([value.kind, action.actionId, action.action, action.commandType, action.environment, action.expectedRevision,
    Object.entries(action.payload).sort(([left], [right]) => left.localeCompare(right)), action.requiresReason,
    value.kind === "manual" && value.action.requiresPrice, value.kind === "manual" && value.action.requiresQuantity]);
}

export function ticketDecisionFingerprint(item: FocusQueueItem): string {
  const card = item.card;
  return JSON.stringify([card?.orderIntentId, card?.instrument, card?.side, card?.authorizedQuantity,
    card?.riskAuthorizedPlan, card?.expiresAt, card?.revision]);
}

export function actionLabel(value: WorkspaceAction): string {
  return ({ CONFIRM: "Autoriser le ticket", REJECT: "Refuser", UNDO: "Revenir sur la décision", REPORT_PLACED: "Déclarer l’ordre posé", REPORT_FILLED: "Déclarer l’exécution", REPORT_CLOSED: "Déclarer la clôture", REPORT_SKIPPED: "Signaler non pris", REPORT_MODIFIED: "Consigner une modification", REPORT_STOP_PLACED: "Déclarer la protection" } as Record<string, string>)[value.action.action] ?? "Consigner une décision";
}

export function optionalNumber(input: string): number | null {
  if (!input.trim()) return null;
  const parsed = Number(input.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}
