import { useEffect, useRef, useState } from "react";
import { useCommandStatus, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted } from "@/domains/realtime/commandRuntime";
import { buildOrderIntentDossier } from "@/features/order-intent/mapper";
import { buildHumanGateCommand } from "@/features/order-intent/model";
import { buildManualExecutionCommand } from "../focusModel";
import type { FocusQueueItem } from "../focusJournalModel";
import { toLiveTradingModel } from "../mapper";
import { knownLabel, workspaceTickets } from "./workspaceModel";
import { actionFingerprint, readOnlyReason, ticketDecisionFingerprint, workspaceActions, type WorkspaceAction, type WorkspaceHealth } from "./commandPolicy";

type CommandInput = { price?: number | null; quantity?: number | null; reason: string };
const terminal = new Set(["SUCCEEDED", "FAILED", "CANCELLED", "CONFLICT", "REJECTED", "TIMED_OUT"]);

export function useWorkspaceCommand(health: WorkspaceHealth, selectedId: string | null, refresh: () => void) {
  const repository = useFrontViewRepository();
  const [receipt, setReceipt] = useState<(CommandAccepted & { ticket: string }) | null>(null);
  const [sending, setSending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statusQuery = useCommandStatus(receipt?.commandId ?? null);
  const status = statusQuery.data?.status ?? receipt?.status ?? null;
  const busy = sending || uncertain || status === "TIMED_OUT" || Boolean(status && !terminal.has(status));
  const current = useRef({ health, selectedId, busy });
  current.current = { health, selectedId, busy };
  const inFlight = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (status && terminal.has(status)) refresh(); }, [status, refresh]);

  const submit = async (requested: WorkspaceAction, input: CommandInput, item: FocusQueueItem, account?: string): Promise<boolean> => {
    if (inFlight.current || current.current.busy || readOnlyReason(current.current.health, Date.now())) return false;
    inFlight.current = true;
    setSending(true); setError(null);
    let submitted = false;
    try {
      const refreshed = await revalidate(requested, item, repository, account);
      if (!mounted.current) return false;
      if (!refreshed || current.current.selectedId !== item.key || readOnlyReason(current.current.health, Date.now())) {
        setError("Le ticket ou ses autorisations ont changé. Relisez le dossier avant de confirmer."); refresh(); return false;
      }
      const command = refreshed.kind === "gate" ? buildHumanGateCommand(refreshed.action, input.reason) : buildManualExecutionCommand(refreshed.action, input);
      submitted = true;
      const accepted = await repository.submitCommand(command);
      setReceipt({ ...accepted, ticket: `${item.instrument} · ${item.card?.orderIntentId}` });
      refresh();
      return true;
    } catch {
      setUncertain(submitted);
      setError(submitted ? "Résultat non confirmé. Vérifiez le journal avant toute nouvelle tentative ; aucune répétition automatique." : "Impossible de revérifier le dossier. Aucune commande envoyée. Réessayez après actualisation.");
      return false;
    } finally { inFlight.current = false; setSending(false); }
  };
  return { submit, busy, sending, error, receipt, status, statusError: statusQuery.isError };
}

async function revalidate(requested: WorkspaceAction, item: FocusQueueItem, repository: ReturnType<typeof useFrontViewRepository>, account?: string) {
  if (!item.card?.orderIntentId) return null;
  const [focus, detail, live] = await Promise.all([
    repository.getView("live-focus"), repository.getView("order-detail", { orderId: item.card.orderIntentId }), repository.getView("live-trading"),
  ]);
  const now = Date.now();
  if (readOnlyReason({ meta: focus.meta, connected: true, paused: false, failed: false }, now)) return null;
  const fresh = workspaceTickets(focus.data).find((candidate) => candidate.key === item.key);
  if (!fresh || ticketDecisionFingerprint(fresh) !== ticketDecisionFingerprint(item)) return null;
  const dossier = buildOrderIntentDossier(detail);
  if (account !== undefined && knownLabel(dossier.targetPosition.account) !== account) return null;
  const actions = workspaceActions(fresh, dossier, toLiveTradingModel(live, { signalId: fresh.signalId }), now);
  return actions.find((candidate) => actionFingerprint(candidate) === actionFingerprint(requested)) ?? null;
}

export type WorkspaceCommand = ReturnType<typeof useWorkspaceCommand>;

export function commandStatusLabel(status: string | null) {
  return ({ ACCEPTED: "Demande reçue · traitement en attente", REQUESTED: "Demande en préparation", RUNNING: "Traitement en cours", SUCCEEDED: "Décision enregistrée", FAILED: "Échec du traitement", CONFLICT: "Ticket modifié · relisez le dossier", REJECTED: "Demande refusée", CANCELLED: "Demande annulée", TIMED_OUT: "Délai dépassé · résultat à vérifier" } as Record<string, string>)[status ?? ""] ?? "Statut à vérifier";
}
