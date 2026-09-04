import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FaChartLine, FaDownload, FaFolderOpen, FaSearch } from "react-icons/fa";
import type { LiveFocusView } from "@/domains/front-api/viewModels";
import { operatorCode } from "@/design-system/operatorVocabulary";
import {
  buildFocusQueueItems,
  buildFocusSignalFlowItems,
  filterFocusQueueItems,
  type FocusQueueFilter,
  type FocusQueueItem,
  type FocusQueueTimelineStep,
  type FocusSignalFlowItem,
} from "./focusJournalModel";

type JournalProps = {
  focus: LiveFocusView;
  selectedSignalId: string | null;
  onSelectDecision(signalId: string): void;
  onOpenTrade(card: LiveFocusView["tradeCards"][number]): void;
  onOpenChart(): void;
};

export function LiveFocusJournal(props: JournalProps) {
  const { focus, selectedSignalId } = props;
  const [filter, setFilter] = useState<FocusQueueFilter>("ALL");
  const [instrument, setInstrument] = useState("ALL");
  const [query, setQuery] = useState("");
  const items = useMemo(() => buildFocusQueueItems(focus), [focus]);
  const signalFlowItems = useMemo(() => buildFocusSignalFlowItems(focus), [focus]);
  const visibleItems = useMemo(() => filterFocusQueueItems(items, filter, instrument, query), [filter, instrument, items, query]);
  const instruments = useMemo(() => [...new Set(items.map((item) => item.instrument).filter(Boolean))].sort(), [items]);
  const actionable = items.filter((item) => item.actionable).length;
  const filters: { id: FocusQueueFilter; label: string; count: number }[] = [
    { id: "ALL", label: "Tous les dossiers", count: items.length },
    { id: "ACTIONABLE", label: "Prêts à poser", count: actionable },
    { id: "QUALIFIED", label: "Qualifiés", count: items.filter((item) => item.kind === "trade" && !item.actionable && !item.terminal).length },
    { id: "EXPIRED", label: "Expirés / terminés", count: items.filter((item) => item.terminal).length },
  ];
  return <aside className="live-focus__queue" aria-labelledby="live-focus-journal-title">
    <header>
      <div><small>TICKETS OPÉRATEUR</small><h2 id="live-focus-journal-title">Prêts à poser & historique</h2><span>{actionable} prêt(s) à poser · {items.length} dossier(s) qualifié(s)</span></div>
      <button type="button" className="live-focus__queue-export" onClick={() => exportFocusQueueSnapshot(visibleItems, focus.asOf)} aria-label="Exporter les tickets affichés"><FaDownload aria-hidden="true" /></button>
    </header>
    <div className="live-focus__queue-tools" aria-label="Filtres des tickets opérateur">
      <label className="live-focus__queue-search"><FaSearch aria-hidden="true" /><span className="sr-only">Rechercher dans le journal</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Instrument, stratégie, identifiant…" /></label>
      <div className="live-focus__queue-filter-row">
        <label className="live-focus__queue-state"><span className="sr-only">Filtrer par état</span><select aria-label="Filtrer par état" value={filter} onChange={(event) => setFilter(event.target.value as FocusQueueFilter)}>{filters.map((item) => <option key={item.id} value={item.id}>{item.label} ({item.count})</option>)}</select></label>
        <label className="live-focus__queue-state"><span className="sr-only">Filtrer par instrument</span><select aria-label="Filtrer par instrument" value={instrument} onChange={(event) => setInstrument(event.target.value)}><option value="ALL">Tous les instruments</option>{instruments.map((name) => <option key={name}>{name}</option>)}</select></label>
      </div>
    </div>
    <div className="live-focus__queue-track" tabIndex={0} role="region" aria-label="Liste verticale des tickets" data-focus-scroll>
      <details className="live-focus__queue-summary">
      <summary>Résumé des tickets · {visibleItems.length} affiché(s)</summary>
      <dl className="live-focus__queue-kpis"><JournalFact label="Prêts à poser" value={String(actionable)} /><JournalFact label="Ne pas poser" value={String(items.filter((item) => item.terminal).length)} /><JournalFact label="Dossiers qualifiés" value={String(focus.tradeCards.length)} /><JournalFact label="Signaux filtrés" value={String(signalFlowItems.length)} /></dl>
      </details>
      {visibleItems.map((item) => <JournalTicket key={item.key} item={item} selected={item.signalId === selectedSignalId && Boolean(selectedSignalId)} onSelectDecision={props.onSelectDecision} onOpenTrade={props.onOpenTrade} onOpenChart={props.onOpenChart} />)}
      {!visibleItems.length ? <p>{items.length ? "Aucun ticket ne correspond aux filtres." : "Aucun ordre prêt à poser : aucun signal n’a encore produit de dossier Position cible → Ordre proposé → Human Gate."}</p> : null}
      <SignalFlowPanel items={signalFlowItems} />
    </div>
  </aside>;
}

function JournalTicket({ item, selected, onSelectDecision, onOpenTrade, onOpenChart }: {
  item: FocusQueueItem;
  selected: boolean;
} & Pick<JournalProps, "onSelectDecision" | "onOpenTrade" | "onOpenChart">) {
  return <article className="live-focus__queue-card" data-priority={item.priority} data-terminal={String(item.terminal)} data-actionable={String(item.actionable)} data-kind={item.kind} aria-current={selected ? "true" : undefined}>
    <button type="button" className="live-focus__queue-card-main" disabled={!item.signalId} onClick={() => item.signalId && onSelectDecision(item.signalId)}>
      <span className="live-focus__queue-card-title"><strong>{item.instrument}</strong><em>{operatorCode(item.side)}</em><small data-tone={item.statusTone}>{item.status}</small></span>
      <span className="live-focus__queue-strategy">{item.title}</span>
      <span className="live-focus__queue-levels">{item.levelLine}</span>
    </button>
    {item.orderPlan ? <OrderPlanPreview item={item} /> : null}
    <dl className="live-focus__queue-card-meta">
      <JournalFact label="Signal" value={journalTimestamp(item.createdAt)} />
      <JournalFact label="Échéance" value={journalTimestamp(item.expiresAt)} />
      <JournalFact label="Âge des données" value={item.freshnessLine.replace(/^Âge /, "")} />
    </dl>
    <p className="live-focus__queue-verdict">{item.lifecycleLine}</p>
    <details className="live-focus__queue-details">
      <summary>Parcours et sources</summary>
      <FocusQueueTimeline steps={item.timeline} />
      <p>{item.rLine} · {item.reasonLine}</p>
      <dl><JournalFact label="Source" value={item.source ?? "Non publiée"} /><JournalFact label="Données arrêtées à" value={journalTimestamp(item.asOf)} /><JournalFact label="Fenêtre" value={item.expirationLine} /></dl>
    </details>
    <footer>
      {item.card ? <button type="button" onClick={() => onOpenTrade(item.card!)}><FaFolderOpen aria-hidden="true" />Dossier</button> : item.route ? <Link to={item.route}><FaFolderOpen aria-hidden="true" />Détail du signal</Link> : null}
      <button type="button" disabled={!item.signalId} onClick={() => { if (item.signalId) onSelectDecision(item.signalId); onOpenChart(); }}><FaChartLine aria-hidden="true" />Graphique</button>
    </footer>
  </article>;
}

function OrderPlanPreview({ item }: { item: FocusQueueItem }) {
  if (!item.orderPlan) return null;
  return <dl className="live-focus__queue-order-plan" aria-label={`Plan d’ordre ${item.instrument}`}>
    <JournalFact label="Type" value={item.orderPlan.orderType} />
    <JournalFact label="Entrée" value={item.orderPlan.entry} />
    <JournalFact label="Stop" value={item.orderPlan.stop} />
    <JournalFact label="Obj. 1" value={item.orderPlan.target1} />
    <JournalFact label="Obj. 2" value={item.orderPlan.target2} />
  </dl>;
}

function SignalFlowPanel({ items }: { items: readonly FocusSignalFlowItem[] }) {
  return <section className="live-focus__signal-flow" aria-labelledby="live-focus-signal-flow-title">
    <header>
      <div><small>FLUX SIGNAUX</small><h3 id="live-focus-signal-flow-title">Signaux filtrés avant ticket</h3></div>
      <span>{items.length} signal(s)</span>
    </header>
    {items.length ? (
      <ol>
        {items.map((item) => <li key={item.key} data-tone={item.statusTone} data-terminal={String(item.terminal)}>
          <div className="live-focus__signal-flow-head">
            <strong>{item.instrument}</strong>
            <em>{operatorCode(item.side)}</em>
            <small>{item.status}</small>
          </div>
          <p><span>Bloqué à</span> {item.gateLabel}</p>
          <small>{item.blockerLine}</small>
          <dl>
            <JournalFact label="Signal" value={journalTimestamp(item.createdAt)} />
            <JournalFact label="Fenêtre" value={item.expirationLine} />
            <JournalFact label="Source" value={item.source} />
          </dl>
          <footer>
            <span>{item.reasonLine}</span>
            <Link to={item.route}>Dossier signal</Link>
          </footer>
        </li>)}
      </ol>
    ) : <p>Aucun signal moteur filtré n’est publié sur cette fenêtre.</p>}
  </section>;
}

export function FocusQueueTimeline({ steps }: { steps: readonly FocusQueueTimelineStep[] }) {
  return <ol className="live-focus__queue-timeline" aria-label="Progression du ticket">{steps.map((step) => <li key={step.label} data-tone={step.tone}><span aria-hidden="true" /><div><strong>{step.label}</strong><small>{step.value}</small></div></li>)}</ol>;
}

function JournalFact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function journalTimestamp(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Non publié";
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function exportFocusQueueSnapshot(items: readonly FocusQueueItem[], asOf: string) {
  const payload = {
    exportedAt: new Date().toISOString(),
    asOf,
    itemCount: items.length,
    items: items.map((item) => ({
      kind: item.kind,
      instrument: item.instrument,
      side: item.side,
      status: item.status,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
      signalId: item.signalId,
      route: item.route,
      actionable: item.actionable,
      terminal: item.terminal,
      source: item.source,
      asOf: item.asOf,
      orderPlan: item.orderPlan,
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `live-focus-journal-${asOf.slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(href);
}
