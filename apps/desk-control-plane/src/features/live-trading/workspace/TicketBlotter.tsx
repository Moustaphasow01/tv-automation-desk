import { useMemo, useState } from "react";
import { FiArrowUpRight, FiSearch } from "react-icons/fi";
import type { FocusQueueItem } from "../focusJournalModel";
import { numberLabel, parisTime, sideLabel, stableTicketOrder, ticketSection, ticketSections } from "./workspaceModel";
import { useWorkspaceFilter } from "./useWorkspaceFilter";
import { normalizedSearch } from "./workspacePreferences";

export function TicketBlotter({ items, selectedId, onSelect }: { items: readonly FocusQueueItem[]; selectedId: string | null; onSelect(item: FocusQueueItem): void }) {
  const [section, setSection] = useWorkspaceFilter("ticketSection", "decisions", ticketSections.map((item) => item.id));
  const [search, setSearch] = useWorkspaceFilter("ticketSearch", "");
  const [ids, setIds] = useState(() => items.map((item) => item.key));
  const { ordered, incoming } = useMemo(() => stableTicketOrder(items, ids), [items, ids]);
  const rows = ordered.filter((item) => ticketSection(item) === section && normalizedSearch(item.searchText).includes(normalizedSearch(search)));
  return <section className="tw-blotter" id="workspace-tickets" aria-label="Tickets de la séance">
    <header className="tw-section-header"><h2>Tickets</h2><label className="tw-search"><FiSearch aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Actif, stratégie…" aria-label="Filtrer les tickets" type="search" /></label></header>
    <div className="tw-ticket-filters" aria-label="État des tickets">{ticketSections.map(({ id, label }) => <button key={id} aria-pressed={section === id} onClick={() => setSection(id)}>{label}<span>{items.filter((item) => ticketSection(item) === id).length}</span></button>)}</div>
    {incoming.length ? <button className="tw-incoming" onClick={() => setIds(items.map((item) => item.key))}>{incoming.length} nouveau(x) ticket(s) · Mettre à jour la liste</button> : null}
    <div className="tw-ticket-columns" aria-hidden="true"><span>Reçu · Paris</span><span>Actif / sens</span><span>Stratégie</span><span>Entrée / stop</span><span>État</span><span /></div>
    <div className="tw-ticket-list" tabIndex={rows.length ? 0 : undefined} role="region" aria-label={`${ticketSections.find((tab) => tab.id === section)?.label} · ${rows.length} tickets affichés`}>
      {rows.map((item) => <TicketRow key={item.key} item={item} selected={selectedId === item.key} onSelect={() => onSelect(item)} />)}
      {!rows.length ? <div className="tw-empty"><strong>{search ? "Aucun ticket ne correspond" : section === "decisions" ? "Aucune décision à prendre" : section === "tracking" ? "Aucun ticket en cours de suivi" : "Aucun ticket dans l’historique reçu"}</strong>
        <p>{search ? "Essayez un autre actif ou effacez le filtre." : section === "decisions" ? "Les dossiers autorisés apparaîtront ici. Les marchés restent disponibles pendant la veille." : "Les compteurs portent sur les dossiers actuellement reçus, pas sur l’ensemble de votre historique."}</p>
        {search ? <button onClick={() => setSearch("")}>Effacer le filtre</button> : section !== "history" ? <button onClick={() => setSection("history")}>Consulter l’historique</button> : null}
      </div> : null}
    </div>
    <footer>{rows.length} ticket(s) affiché(s) · liste reçue, historique potentiellement partiel</footer>
  </section>;
}

function TicketRow({ item, selected, onSelect }: { item: FocusQueueItem; selected: boolean; onSelect(): void }) {
  return <button className="tw-ticket-row" aria-pressed={selected} onClick={onSelect} data-ticket-id={item.key}>
    <time dateTime={item.createdAt ?? undefined}>{parisTime(item.createdAt, true)}</time>
    <span><strong>{item.instrument}</strong><small className={/^(LONG|BUY)$/i.test(item.side) ? "tw-positive" : "tw-negative"}>{sideLabel(item.side)}</small></span>
    <span><b>{item.title}</b><small>{item.card?.expectedR == null ? "Potentiel non publié" : `${numberLabel(item.card.expectedR)} R prévisionnel`}</small></span>
    <span className="tw-ticket-row__levels"><b>{item.orderPlan?.entry ?? "—"}</b><small>Stop {item.orderPlan?.stop ?? "—"}</small></span>
    <span className="tw-ticket-state" data-tone={item.statusTone}>{item.status}</span><FiArrowUpRight aria-hidden="true" />
  </button>;
}
