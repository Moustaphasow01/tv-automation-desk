import type { FocusQueueItem } from "../focusJournalModel";
import type { useTicketPriority } from "./useTicketPriority";
import { sideLabel } from "./workspaceModel";
import { focusTradePlanFromCard } from "../focusTradePlan";

export function TicketPriorityBar({ priority, automatic, suspended, available, selected, onAutomatic, onInspect, onReturn }: {
  priority: ReturnType<typeof useTicketPriority>; automatic: boolean; suspended: boolean; available: boolean;
  selected: FocusQueueItem | null; onAutomatic(): void; onInspect(item: FocusQueueItem): void; onReturn(instrument: string): void;
}) {
  const notice = priority.notice;
  const current = notice && selected?.key === notice.key && selected.actionable && !selected.terminal ? selected : null;
  const plan = current?.card ? focusTradePlanFromCard(current.card) : null;
  if (!priority.next && !current) return null;
  return <section className="tw-ticket-priority" aria-label="Priorité aux nouveaux tickets">
    <button className="tw-priority-toggle" aria-pressed={automatic} onClick={onAutomatic}>Priorité tickets {automatic ? "activée" : "désactivée"}</button>
    {priority.next ? <div className="tw-priority-message" role="status"><span><strong>{priority.next.instrument} · nouveau ticket</strong>{!priority.supported ? " · graphique indisponible" : suspended ? " · votre lecture est préservée" : !available ? " · données à revérifier" : ` · ${priority.pending.length} à consulter`}</span><button disabled={suspended || !available || !priority.supported} onClick={priority.showNext}>Voir {priority.next.instrument}</button></div>
      : current && notice ? <div className="tw-priority-message" role="status"><span><strong>{current.instrument} · {sideLabel(current.side)}</strong> · {current.status}</span><button onClick={() => onInspect(current)}>Ouvrir le ticket</button>{notice.previous !== notice.instrument ? <button onClick={() => { onReturn(notice.previous); priority.dismiss(); }}>Revenir à {notice.previous}</button> : null}<button aria-label="Fermer l’annonce du ticket prioritaire" onClick={priority.dismiss}>Fermer</button></div> : null}
    {plan && !priority.next ? <p>{plan.authorityLabel} · entrée {plan.entry} · stop {plan.stop} · quantité {plan.quantity}</p> : null}
  </section>;
}
