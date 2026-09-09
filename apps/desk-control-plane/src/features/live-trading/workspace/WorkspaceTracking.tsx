import type { FocusQueueItem } from "../focusJournalModel";
import type { LiveTradingModel } from "../model";
import { canonicalEvidence, manualExecutionLabel, manualStopLabel, publishedText } from "./workspaceSources";
import { numberLabel, parisTime, sideLabel, workspaceCopy } from "./workspaceModel";
import { normalizedSearch } from "./workspacePreferences";
import { useWorkspaceFilter } from "./useWorkspaceFilter";

export function WorkspaceTracking({ items, model, onSelect }: { items: readonly FocusQueueItem[]; model: LiveTradingModel; onSelect(item: FocusQueueItem): void }) {
  const [filter, setFilter] = useWorkspaceFilter("trackingScope", "open", ["open", "all"]);
  const [search, setSearch] = useWorkspaceFilter("trackingSearch", "");
  const rows = items.filter((item) => (filter === "all" || !item.terminal) && normalizedSearch(item.searchText).includes(normalizedSearch(search)));
  return <section className="tw-tracking" aria-label="Suivi des tickets et positions">
    <header className="tw-section-header"><div><h2>Suivi des tickets et positions</h2><span>Du plan autorisé à l’exécution publiée</span></div></header>
    <div className="tw-filter-bar"><label>Afficher<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="open">Dossiers en cours</option><option value="all">Tous les dossiers reçus</option></select></label><label>Rechercher<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Actif ou stratégie" /></label></div>
    <p className="tw-tracking__notice">Théorie, déclaration opérateur et exécution courtier restent distinctes. Un ordre envoyé ou accepté ne prouve pas un remplissage.</p>
    <div className="tw-tracking-list">{rows.map((item) => <article key={item.key} className="tw-followup"><header><div><strong>{item.instrument} · {sideLabel(item.side)}</strong><p>{item.title}</p></div><button onClick={() => onSelect(item)}>Ouvrir le ticket</button></header><ExecutionDetail item={item} model={model} /></article>)}</div>
    {!rows.length ? <div className="tw-empty"><strong>Aucun dossier ne correspond à cette vue</strong><p>Cette liste porte uniquement sur les dossiers reçus. Elle ne prouve pas l’absence d’exposition sur un compte courtier.</p><button onClick={() => { setFilter("all"); setSearch(""); }}>Voir les dossiers reçus</button></div> : null}
    <footer>{rows.length} dossier(s) affiché(s) · {parisTime(model.meta.generatedAt, true)} Paris · historique potentiellement partiel</footer>
  </section>;
}

export function ExecutionDetail({ item, model }: { item: FocusQueueItem; model: LiveTradingModel }) {
  const theory = model.theoreticalExecution?.rows.find((row) => row.portfolioOrderIntentId === item.card?.orderIntentId);
  const evidence = canonicalEvidence(model, item.card?.orderIntentId);
  const manual = theory?.manualExecution;
  const closed = Boolean(theory?.exitAt) || ["TARGET_HIT", "STOP_HIT", "CLOSED"].includes(theory?.status ?? "");
  return <div className="tw-execution-detail">
    <dl className="tw-execution-lanes">
      <div><dt>Décision opérateur</dt><dd>{workspaceCopy(publishedText(theory?.operatorDecision) ?? item.card?.operatorState ?? "Non publiée")}<small>{parisTime(theory?.operatorDecisionAt, true)}</small></dd></div>
      <div><dt>Suivi théorique</dt><dd>{theory ? workspaceCopy(theory.status) : "Non publié"}<small>{theory ? "Entrée suivie : " + numberLabel(theory.entryFillPrice) : "Données du dossier non disponibles"}</small></dd></div>
      <div><dt>Exécution déclarée</dt><dd>{manualExecutionLabel(theory?.manualExecutionStatus ?? manual?.status ?? item.card?.operatorResult?.status)}<small>{manualStopLabel(manual?.stopPlacement ?? item.card?.operatorResult?.stopPlacement)}</small></dd></div>
      <div><dt>Preuve courtier</dt><dd>{evidence.fills.length ? evidence.fills.length + " remplissage(s) publié(s)" : "Aucun remplissage publié"}<small>{theory?.brokerEvidence && theory.brokerEvidence !== "NONE" ? "Événement courtier reçu ; vérifier sa nature" : "L’absence de preuve n’établit pas l’absence d’exécution"}</small></dd></div>
    </dl>
    <dl className="tw-detail-lines"><div><dt>Stop du plan</dt><dd>{item.orderPlan?.stop ?? "Non publié"}</dd></div><div><dt>Risque du ticket publié</dt><dd>{item.card?.riskAmount == null ? "Non publié" : numberLabel(item.card.riskAmount) + " · unité non précisée"}</dd></div><div><dt>Résultat théorique clôturé</dt><dd>{closed ? numberLabel(theory?.resultR) + " R" : "Pas de clôture publiée"}</dd></div></dl>
    <details><summary>Ordres, remplissages et état d’exécution</summary><p>La protection effective chez le courtier n’est pas certifiée par le seul stop du plan ou par une déclaration manuelle.</p>
      {evidence.orders.map((order, index) => <p key={String(order.commandId ?? index)}>Ordre : {workspaceCopy(publishedText(order.status) ?? "État non publié")} · {parisTime(publishedText(order.updatedAt), true)}</p>)}
      {evidence.fills.map((fill, index) => <p key={String(fill.fillId ?? index)}>Remplissage : {numberLabel(fill.quantity)} contrat(s) à {numberLabel(fill.price)} · {parisTime(publishedText(fill.filledAt), true)}</p>)}
      {evidence.positions.map((position, index) => <p key={index}>État d’exécution : {workspaceCopy(publishedText(position.lifecycleStatus) ?? "Non publié")} · quantité remplie {numberLabel(position.filledQuantity)} · {parisTime(publishedText(position.asOf), true)}</p>)}
      {!evidence.orders.length && !evidence.fills.length && !evidence.positions.length ? <p>Aucun ordre, remplissage ou état d’exécution publié dans ce périmètre pour ce ticket.</p> : null}
    </details>
  </div>;
}
