import { useMemo, useState } from "react";
import { JourneyLink } from "@/features/trading-journey/JourneyNavigation";
import { FiX } from "react-icons/fi";
import { useFrontView } from "@/domains/front-api/repositories";
import { operatorCopy, operatorReason } from "@/design-system/operatorVocabulary";
import { buildOrderIntentDossier } from "@/features/order-intent/mapper";
import type { FocusQueueItem } from "../focusJournalModel";
import { focusTradePlanFromCard } from "../focusTradePlan";
import type { LiveTradingModel } from "../model";
import { actionFingerprint, actionLabel, ticketDecisionFingerprint, workspaceActions, type WorkspaceAction } from "./commandPolicy";
import { ActionConfirmation } from "./ActionConfirmation";
import type { WorkspaceCommand } from "./useWorkspaceCommand";
import { knownLabel, numberLabel, parisTime, sideLabel } from "./workspaceModel";
import { TicketDecisionBrief } from "./TicketDecisionBrief";
import { ExecutionDetail } from "./WorkspaceTracking";

type Props = { item: FocusQueueItem | null; model: LiveTradingModel; readOnly: string | null; command: WorkspaceCommand; embedded?: boolean; onClose(): void; onShowMarket(instrument: string): void };

export function TicketInspector(props: Props) {
  return <aside className="tw-inspector" aria-label="Détail du ticket">
    {!props.embedded ? <header className="tw-section-header"><h2>Ticket de décision</h2>{props.item ? <button aria-label="Désélectionner le ticket" onClick={props.onClose}><FiX /></button> : <span>En veille</span>}</header> : null}
    {props.item?.card ? <SelectedTicket key={props.item.key} {...props} item={props.item} /> : <div className="tw-inspector__empty"><span className="tw-eyebrow">Votre espace de décision</span><h3>Aucun ticket sélectionné</h3><p>Les décisions autorisées restent séparées des dossiers en suivi et de l’historique.</p><p>Sélectionnez un ticket pour examiner son plan, son contexte et les actions disponibles sans quitter les marchés.</p><div className="tw-inspector__guide"><b>01</b><span>Repérer une décision</span><b>02</b><span>Vérifier le plan autorisé</span><b>03</b><span>Décider et suivre le résultat</span></div></div>}
  </aside>;
}

function SelectedTicket({ item, model, readOnly, command, onShowMarket }: Props & { item: FocusQueueItem }) {
  const query = useFrontView("order-detail", { orderId: item.card?.orderIntentId }, { enabled: Boolean(item.card?.orderIntentId), refetchInterval: 30_000 });
  const dossier = useMemo(() => query.data ? buildOrderIntentDossier(query.data) : null, [query.data]);
  const [tab, setTab] = useState("plan");
  const [pending, setPending] = useState<{ action: WorkspaceAction; item: FocusQueueItem; account: string } | null>(null);
  const actions = readOnly || query.isError ? [] : workspaceActions(item, dossier, model, Date.now());
  const pendingValid = Boolean(pending && ticketDecisionFingerprint(pending.item) === ticketDecisionFingerprint(item)
    && pending.account === knownLabel(dossier?.targetPosition.account)
    && actions.some((action) => actionFingerprint(action) === actionFingerprint(pending.action)));
  return <div className="tw-inspector__body">
    <div className="tw-ticket-identity"><div><strong>{item.instrument}</strong><span className={/^(LONG|BUY)$/i.test(item.side) ? "tw-positive" : "tw-negative"}>{sideLabel(item.side)}</span></div><span className="tw-ticket-state" data-tone={item.statusTone}>{item.status}</span><h3>{item.title}</h3><p>Reçu le {parisTime(item.createdAt, true)} · Paris</p></div>
    {item.terminal ? <p className="tw-inline-warning">Dossier historique. Ce plan n’est pas une proposition à exécuter maintenant.</p> : null}
    <TicketDecisionBrief item={item} />
    <div className="tw-inspector-tabs" aria-label="Informations du ticket">{[{ id: "plan", label: "Plan" }, { id: "context", label: "Contexte" }, { id: "journey", label: "Parcours" }].map(({ id, label }) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {tab === "plan" ? <TicketPlan item={item} account={knownLabel(dossier?.targetPosition.account)} /> : tab === "context" ? <TicketContext item={item} /> : <><TicketJourney item={item} /><ExecutionDetail item={item} model={model} /></>}
    <button className="tw-show-market" onClick={() => onShowMarket(item.instrument)}>Afficher {item.instrument} sur le graphique principal</button>
    {item.route?.startsWith("/") && !item.route.startsWith("//") ? <JourneyLink className="tw-dossier-link" to={item.route}>Ouvrir le dossier d’exécution</JourneyLink> : null}
    <div className="tw-decision-actions">
      {readOnly ? <p className="tw-inline-warning" role="status">{readOnly}</p> : null}
      {query.isLoading ? <p role="status">Vérification du dossier…</p> : query.isError ? <p role="status">Dossier indisponible. Aucune décision possible. <button onClick={() => void query.refetch()}>Réessayer</button></p> : null}
      {!readOnly && !query.isLoading && !query.isError && !actions.length ? <p>Consultation uniquement. Aucune action actuellement autorisée pour ce ticket.</p> : null}
      {actions.map((action) => <button key={action.action.actionId} className={action.action.action === "CONFIRM" ? "tw-primary" : ""} disabled={command.busy} onClick={() => setPending({ action, item, account: knownLabel(dossier?.targetPosition.account) })}>{actionLabel(action)}</button>)}
      <small>Validation humaine requise. Aucune exécution automatique depuis cet écran.</small>
    </div>
    <details className="tw-ticket-reference"><summary>Source et références</summary><p>{item.source || "Source non publiée"} · {parisTime(item.asOf, true)} Paris</p><p>{item.card?.orderIntentId}</p></details>
    {pending ? <ActionConfirmation action={pending.action} item={pending.item} account={pending.account} command={command} valid={pendingValid} onClose={() => setPending(null)} /> : null}
  </div>;
}

function TicketPlan({ item, account }: { item: FocusQueueItem; account: string }) {
  const plan = focusTradePlanFromCard(item.card!);
  return <section className="tw-plan" aria-label="Plan du ticket">
    <p className="tw-plan__authority">{plan.authority === "AUTHORIZED" ? "Plan autorisé" : plan.authority === "PROPOSED" ? "Plan proposé · non autorisé" : "Plan non publié"}</p>
    <dl className="tw-plan-grid"><div><dt>Entrée</dt><dd>{plan.entry}</dd></div><div><dt>Protection · stop</dt><dd>{plan.stop}</dd></div>{plan.targets.map((target, index) => <div key={index}><dt>Objectif {index + 1}</dt><dd>{target}</dd></div>)}<div><dt>Contrats autorisés</dt><dd>{plan.quantity}</dd></div><div><dt>Potentiel prévisionnel</dt><dd>{plan.expectedR}</dd></div></dl>
    <dl className="tw-detail-lines"><div><dt>Type d’ordre</dt><dd>{operatorCopy(plan.orderType)}</dd></div><div><dt>Compte</dt><dd>{account}</dd></div><div><dt>Validité · Paris</dt><dd>{parisTime(item.expiresAt, true)}</dd></div><div><dt>Résultat théorique clôturé</dt><dd>{item.card?.realizedR == null ? "Non publié" : `${numberLabel(item.card.realizedR)} R`}</dd></div></dl>
  </section>;
}

function TicketContext({ item }: { item: FocusQueueItem }) {
  return <section className="tw-ticket-context" aria-label="Contexte du ticket"><h3>Pourquoi ce dossier ?</h3><p>{item.reasonLine || "Explication non publiée."}</p>
    {item.card?.setup ? <p>{operatorCopy(item.card.setup)}</p> : null}
    {item.card?.denialReasons.length ? <><h3>Points à vérifier</h3><ul>{item.card.denialReasons.map((reason) => <li key={reason}>{operatorReason(reason)}</li>)}</ul></> : null}
    <p>Les niveaux du plan et les quantités sont publiés par le desk. Ils ne sont pas recalculés dans le navigateur.</p>
  </section>;
}

function TicketJourney({ item }: { item: FocusQueueItem }) {
  return <section className="tw-ticket-journey" aria-label="Parcours du ticket"><ol>{item.timeline.map((step, index) => <li key={`${step.label}-${index}`} data-tone={step.tone}><strong>{step.label}</strong><span>{operatorCopy(step.value)}</span></li>)}</ol><p>Suivi théorique et exécution déclarée sont deux parcours distincts. Une autorisation n’est pas une preuve d’exécution.</p></section>;
}
