import type { FocusQueueItem } from "../focusJournalModel";
import type { LiveTradingModel } from "../model";
import { numberLabel, parisTime, workspaceCopy } from "./workspaceModel";
import { normalizedSearch } from "./workspacePreferences";
import { useWorkspaceFilter } from "./useWorkspaceFilter";
import { manualExecutionLabel, publishedText } from "./workspaceSources";

export function WorkspaceJournal({ items, model, onSelect }: { items: readonly FocusQueueItem[]; model: LiveTradingModel; onSelect(item: FocusQueueItem): void }) {
  const [search, setSearch] = useWorkspaceFilter("journalSearch", "");
  const [phase, setPhase] = useWorkspaceFilter("journalPhase", "all", ["all", "before", "during", "after"]);
  const rows = items.filter((item) => normalizedSearch(item.searchText).includes(normalizedSearch(search)) && (phase === "all" || journalPhase(item) === phase));
  return <section className="tw-journal" aria-label="Journal des décisions">
    <header className="tw-section-header"><div><h2>Journal des décisions</h2><span>Avant · pendant · après le trade</span></div></header>
    <div className="tw-filter-bar"><label>Parcours<select value={phase} onChange={(event) => setPhase(event.target.value)}><option value="all">Tout le parcours reçu</option><option value="before">Avant · décisions</option><option value="during">Pendant · suivi</option><option value="after">Après · historique</option></select></label><label>Rechercher<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Actif ou stratégie" /></label></div>
    <p>Ce journal liste les dossiers reçus, indépendamment de la période du bilan consolidé. Aucun résultat n’est recalculé ici.</p>
    <div className="tw-journal-list">{rows.map((item) => {
      const theory = model.theoreticalExecution?.rows.find((row) => row.portfolioOrderIntentId === item.card?.orderIntentId);
      return <article key={item.key} className="tw-journal-row"><header><time>{parisTime(item.createdAt, true)}</time><strong>{item.instrument} · {item.title}</strong><button onClick={() => onSelect(item)}>Revoir le ticket</button></header>
        <dl><div><dt>Proposé</dt><dd>{item.orderPlan?.entry ?? "Entrée non publiée"}</dd></div><div><dt>Décidé</dt><dd>{workspaceCopy(publishedText(theory?.operatorDecision) ?? item.card?.operatorState ?? "Non publié")}</dd></div><div><dt>Déclaré</dt><dd>{manualExecutionLabel(theory?.manualExecutionStatus ?? theory?.manualExecution?.status ?? item.card?.operatorResult?.status)}</dd></div><div><dt>Résultat théorique</dt><dd>{item.terminal && item.card?.realizedR != null ? numberLabel(item.card.realizedR) + " R" : "Pas de résultat clôturé publié"}</dd></div></dl>
        <p>{workspaceCopy(item.card?.closeReason ?? item.reasonLine) || "Motif non publié."}</p>
      </article>;
    })}</div>
    {!rows.length ? <div className="tw-empty"><strong>Aucun dossier dans ce filtre</strong><button onClick={() => { setSearch(""); setPhase("all"); }}>Effacer les filtres du journal</button></div> : null}
    <small>{rows.length} dossier(s) affiché(s) · historique reçu potentiellement partiel</small>
    <details className="tw-journal-events"><summary>Derniers événements publiés · {model.timeline.length}</summary><ol>{model.timeline.map((event) => <li key={event.eventId}><time>{parisTime(event.at, true)}</time><strong>{workspaceCopy(event.title)}</strong><p>{workspaceCopy(event.detail)}</p></li>)}</ol></details>
  </section>;
}

function journalPhase(item: FocusQueueItem): string {
  return item.terminal ? "after" : item.actionable ? "before" : "during";
}
