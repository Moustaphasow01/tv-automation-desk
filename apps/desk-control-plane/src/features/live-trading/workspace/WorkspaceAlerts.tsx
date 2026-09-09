import { useState } from "react";
import type { FocusQueueItem } from "../focusJournalModel";
import type { LiveTradingModel } from "../model";
import type { WorkspaceAlert } from "./workspaceAlertModel";
import { parisTime, workspaceCopy } from "./workspaceModel";

export function WorkspaceAlerts({ alerts, tickets, model, readOnly, onRead, onSelect }: {
  alerts: readonly WorkspaceAlert[]; tickets: readonly FocusQueueItem[]; model: LiveTradingModel; readOnly: string | null;
  onRead(id: string): void; onSelect(item: FocusQueueItem): void;
}) {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const displayed = alerts.filter((alert) => !unreadOnly || !alert.read);
  const unprotected = model.theoreticalExecution?.rows.filter((row) => row.manualExecutionStatus === "FILLED" && !row.manualExecution?.stopPlacement?.placed) ?? [];
  return <section className="tw-alerts" aria-label="Centre d’alertes">
    {readOnly ? <div className="tw-health"><strong>Avertissement actif · lecture seule</strong><p>{readOnly}</p><small>Non masquable depuis les notifications.</small></div> : null}
    {unprotected.map((row) => <p className="tw-inline-warning" key={row.portfolioOrderIntentId}>{row.instrument} · une entrée manuelle est déclarée, sans placement de stop déclaré. Vérifiez la protection effective chez votre courtier.</p>)}
    {model.source.incidents.map((incident) => <article className="tw-active-incident" key={incident.incidentId}><strong>{workspaceCopy(incident.title)}</strong><p>{workspaceCopy(incident.detail)}</p></article>)}
    <label className="tw-check"><input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />Uniquement les notifications non lues</label>
    <p>Notifications locales depuis l’ouverture du poste, jusqu’à 100 messages. « Lu » est un repère personnel, pas un acquittement métier ni une décision de trading.</p>
    <ol className="tw-alert-list">{displayed.map((alert) => {
      const item = tickets.find((ticket) => ticket.key === alert.ticketId);
      return <li key={alert.id} data-severity={alert.severity} data-read={alert.read}><time>{parisTime(alert.at, true)}</time><strong>{alert.title}</strong><p>{alert.detail}</p><div>{item ? <button onClick={() => onSelect(item)}>Ouvrir le ticket</button> : <span>Ticket absent du périmètre reçu</span>}{!alert.read ? <button onClick={() => onRead(alert.id)}>Marquer comme lu</button> : <small>Lu sur ce poste</small>}</div></li>;
    })}</ol>
    {!displayed.length ? <p>Aucune notification {unreadOnly ? "non lue" : "enregistrée depuis l’ouverture"}. Les avertissements actifs restent affichés au-dessus.</p> : null}
  </section>;
}
