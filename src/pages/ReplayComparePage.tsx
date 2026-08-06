import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, Icon, LoadingView } from "@/components/common";
import { Breadcrumbs, formatTime, MetricCard, MetricStrip, PageHeading, PageTabs, ProgressBar, StatusTag } from "@/components/operations";
import { operationsKeys, useReplays } from "@/hooks/useOperations";
import type { ReplayComparison, ReplayComparisonItem, WorkflowSummary } from "@/operationsTypes";

export default function ReplayComparePage() {
  const replays = useReplays({ limit: 500, version_scope: "certified" });
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const comparison = useQuery({ queryKey: [...operationsKeys.replays, "compare", selected], queryFn: () => operationsApi.compareReplays(selected), enabled: selected.length >= 2 });
  const visibleItems = useMemo(() => filterReplayUniverse(replays.data?.items || [], search), [replays.data, search]);
  const selectedItems = useMemo(() => selected.map(id => replays.data?.items.find(item => item.sourceId === id)).filter(Boolean) as WorkflowSummary[], [replays.data?.items, selected]);

  if (replays.isLoading) return <LoadingView/>;
  if (replays.isError || !replays.data) return <ErrorView message={replays.error?.message || "Comparateur indisponible"} retry={() => replays.refetch()}/>;

  const toggle = (id: string) => setSelected(value => value.includes(id) ? value.filter(item => item !== id) : value.length < 8 ? [...value, id] : value);
  const selectTop = () => setSelected([...replays.data.items].sort((left, right) => Number(right.metrics.totalR || 0) - Number(left.metrics.totalR || 0)).slice(0, 4).map(item => item.sourceId));
  const selectFirstDay = () => {
    const date = replays.data.days[0]?.date;
    if (!date) return;
    setSelected(replays.data.items.filter(item => item.tradingDate === date).slice(0, 8).map(item => item.sourceId));
  };

  return <section className="view workspace-view replay-compare-v3">
    <Breadcrumbs items={[{ label: "Replay Lab", to: "/replay" }, { label: "Comparaison" }]}/>
    <PageHeading eyebrow="Station de comparaison" title="Comparer les exécutions" subtitle="Jusqu’à huit variantes ou tentatives, calculées par le backend canonique." backTo="/replay" tabs={<PageTabs items={[{ label: "Vue globale", to: "/replay", end: true }, { label: "Comparaison", to: "/replay/compare" }]}/>}/>

    <Card className="workspace-panel comparison-selector-v3 replay-compare-selector">
      <header><div><p className="eyebrow">Univers disponible</p><h2>Sélection · {selected.length}/8</h2></div><div><button className="text-btn" onClick={selectFirstDay} disabled={!replays.data.days.length}>Journée active</button><button className="text-btn" onClick={selectTop} disabled={!replays.data.items.length}>Top résultats</button>{selected.length > 0 && <button className="text-btn" onClick={() => setSelected([])}>Tout effacer</button>}</div></header>
      <div className="replay-compare-search"><Icon name="search" size={13}/><input aria-label="Rechercher une exécution à comparer" placeholder="Run, session, stratégie, variante…" value={search} onChange={event => setSearch(event.target.value)}/><span>{visibleItems.length}/{replays.data.items.length}</span></div>
      <div className="comparison-picker comparison-picker--p4">{visibleItems.map(item => <label key={item.id} className={`comparison-run-card ${selected.includes(item.sourceId) ? "selected" : ""}`} title={item.sourceId}>
        <input aria-label={`Sélectionner ${item.sourceId}`} type="checkbox" checked={selected.includes(item.sourceId)} onChange={() => toggle(item.sourceId)}/>
        <div className="comparison-run-card__main"><strong>{item.tradingDate || "—"} · {sessionLabel(item.session || item.kind)}</strong><small>{variantLabel(item.variantId) || "Configuration standard"} · V4 certifié</small></div>
        <div className="comparison-run-card__meta"><strong className={Number(item.metrics.totalR || 0) >= 0 ? "positive mono" : "negative mono"}>{Number(item.metrics.totalR || 0).toFixed(2)} R</strong><StatusTag status={item.status}/></div>
      </label>)}</div>
    </Card>

    {selected.length > 0 && <ReplaySelectionDock items={selectedItems} selected={selected} clear={() => setSelected([])}/>}
    {selected.length < 2 ? <Card className="workspace-empty replay-compare-empty"><h3>Sélectionnez au moins deux runs</h3><p>La matrice sera demandée au backend dès que deux exécutions seront cochées. Le premier run sélectionné devient la référence de delta.</p></Card> : comparison.isLoading ? <ReplayComparisonLoading count={selected.length}/> : comparison.isError ? <ErrorView message={comparison.error.message} retry={() => comparison.refetch()}/> : comparison.data ? <ReplayComparisonWorkbench data={comparison.data}/> : null}
  </section>;
}

function ReplaySelectionDock({ items, selected, clear }: { items: WorkflowSummary[]; selected: string[]; clear: () => void }) {
  const baseline = items[0];
  return <Card className="replay-selection-dock">
    <header>
      <div><p className="eyebrow">Panier de comparaison</p><h2>{selected.length} run{selected.length > 1 ? "s" : ""} retenu{selected.length > 1 ? "s" : ""}</h2></div>
      <span>Référence · {baseline ? compactId(baseline.sourceId, 42) : compactId(selected[0] || "—", 42)}</span>
      <button className="text-btn" onClick={clear}>Réinitialiser</button>
    </header>
    <div>{items.map((item, index) => <span key={item.sourceId} className={index === 0 ? "is-baseline" : ""} title={item.sourceId}>
      <strong>{index === 0 ? "REF" : `#${index + 1}`}</strong>
      <em>{item.tradingDate || "—"} · {sessionLabel(item.session || item.kind)}</em>
      <small>{variantLabel(item.variantId) || "Configuration standard"}</small>
    </span>)}</div>
  </Card>;
}

function ReplayComparisonLoading({ count }: { count: number }) {
  return <Card className="replay-compare-loading">
    <h3>Calcul comparatif en cours</h3>
    <p>Le backend agrège {count} runs avec leurs étapes, processus GPT, décisions et échantillons de timeline. La donnée reste réelle, aucun mock n’est injecté.</p>
    <div><i/><i/><i/></div>
  </Card>;
}

function ReplayComparisonWorkbench({ data }: { data: ReplayComparison }) {
  const rows = data.items;
  const summary = data.summary;
  return <>
    <MetricStrip className="metric-grid--compact replay-summary-strip replay-compare-kpis">
      <MetricCard label="Runs comparés" value={summary.count} detail={`réf. ${compactId(summary.baselineRunId || "—", 28)}`}/>
      <MetricCard label="Meilleur résultat" value={`${summary.bestR.toFixed(2)} R`} detail={compactId(summary.bestRunId || "—", 28)} tone="positive"/>
      <MetricCard label="Résultat moyen" value={`${summary.averageR.toFixed(2)} R`} tone={summary.averageR >= 0 ? "positive" : "negative"}/>
      <MetricCard label="Spread max/min" value={`${summary.spreadR.toFixed(2)} R`}/>
      <MetricCard label="GPT" value={summary.gptProcesses} detail={`${summary.waitingGpt} attente · ${summary.telemetryCoveragePct ?? "—"}% tél.`}/>
      <MetricCard label="Coût mesuré" value={formatCost(summary.costUsd)} detail={summary.totalTokens != null ? `${summary.totalTokens} tokens` : "couverture absente"}/>
    </MetricStrip>

    <section className="replay-terminal-section replay-compare-scoreboard">
      <header><div><p className="eyebrow">Classement, delta et risque</p><h2>Scoreboard comparatif</h2></div><span>{rows.length} runs · référence {compactId(data.baselineRunId || "—", 42)}</span></header>
      <div className="replay-scoreboard-grid">
        {rows.map(row => <article key={row.id} className={row.baseline ? "is-baseline" : ""} data-status={row.run.status}>
          <header><span>#{row.rank || "—"}</span><div><strong title={row.id}>{compactId(row.id, 34)}</strong><small>{row.run.tradingDate || "—"} · {sessionLabel(row.run.session || row.run.kind)}</small></div><StatusTag status={row.run.status}/></header>
          <div className="replay-scoreboard-result"><strong className={row.metrics.resultR >= 0 ? "positive" : "negative"}>{row.metrics.resultR.toFixed(2)} R</strong><span className={row.metrics.deltaR >= 0 ? "positive" : "negative"}>{row.baseline ? "RÉFÉRENCE" : `${row.metrics.deltaR >= 0 ? "+" : ""}${row.metrics.deltaR.toFixed(2)} R`}</span></div>
          <ProgressBar value={row.metrics.progress} status={row.run.status}/>
          <footer><span>{row.metrics.gptProcesses} GPT</span><span>{row.metrics.timelineEvents} événements</span><span>{row.metrics.decisions} décisions</span></footer>
          <RiskFlags flags={row.riskFlags}/>
        </article>)}
      </div>
    </section>

    <section className="replay-terminal-section">
      <header><div><p className="eyebrow">Comparaison canonique</p><h2>Matrice comparative</h2></div><span>Référence · première ligne sélectionnée</span></header>
      <div className="data-table-wrap"><table className="data-table replay-compare-table">
        <thead><tr><th>Run</th><th>Rang</th><th>État</th><th>Progression</th><th>Résultat</th><th>Δ référence</th><th>Étapes</th><th>GPT</th><th>Télémétrie</th><th>Timeline</th><th>Conclusion</th></tr></thead>
        <tbody>{rows.map(row => <ReplayCompareRow key={row.id} row={row}/>)}</tbody>
      </table></div>
    </section>

    <div className="replay-compare-lower-grid">
      <ReplayCompareGptPanel rows={rows}/>
      <ReplayCompareTimelinePanel rows={rows}/>
    </div>
  </>;
}

function ReplayCompareRow({ row }: { row: ReplayComparisonItem }) {
  return <tr className={row.baseline ? "is-baseline" : ""}>
    <td data-label="Run"><div className="replay-compare-run-cell"><strong title={row.id}>{compactId(row.id, 46)}</strong><small>{row.run.tradingDate || "—"} · {row.run.variantId || "default"}</small><div className="replay-compare-inline-actions"><Link className="row-link" to={`/replay/runs/${encodeURIComponent(row.id)}`}>Run <Icon name="arrow" size={13}/></Link></div></div></td>
    <td data-label="Rang"><span className="terminal-code">#{row.rank || "—"}</span></td>
    <td data-label="État"><StatusTag status={row.run.status}/></td>
    <td data-label="Progression"><ProgressBar value={row.metrics.progress} status={row.run.status}/></td>
    <td data-label="Résultat" className={row.metrics.resultR >= 0 ? "positive" : "negative"}><strong>{row.metrics.resultR.toFixed(2)} R</strong></td>
    <td data-label="Delta" className={row.metrics.deltaR >= 0 ? "positive" : "negative"}>{row.baseline ? "RÉF." : `${row.metrics.deltaR >= 0 ? "+" : ""}${row.metrics.deltaR.toFixed(2)} R`}</td>
    <td data-label="Étapes">{row.metrics.stepsDone}/{row.metrics.stepsTotal}<small>{row.metrics.stepCompletionPct}%</small></td>
    <td data-label="GPT">{row.metrics.gptProcesses}<small>{row.metrics.gptWaiting} attente · {row.metrics.gptFailed} risque</small></td>
    <td data-label="Télémétrie">{row.metrics.telemetryCoveragePct ?? "—"}%<small>{formatCost(row.metrics.costUsd)}</small></td>
    <td data-label="Timeline">{row.metrics.timelineEvents}<small>{row.metrics.decisions} décisions</small></td>
    <td data-label="Conclusion"><span>{row.conclusion?.conclusion || row.conclusion?.decision || "—"}</span><RiskFlags flags={row.riskFlags}/></td>
  </tr>;
}

function ReplayCompareGptPanel({ rows }: { rows: ReplayComparisonItem[] }) {
  const total = rows.reduce((sum, row) => sum + row.gptProcesses.length, 0);
  return <Card className="replay-compare-gpt-panel">
    <header><div><p className="eyebrow">GPT & conclusions</p><h2>Processus par run</h2></div><span>{total}</span></header>
    <div>{rows.map(row => <section key={row.id}>
      <header><strong title={row.id}>{compactId(row.id, 48)}</strong><small>{row.conclusion?.conclusion || "Aucune conclusion persistée"}</small></header>
      {!row.gptProcesses.length ? <p className="muted-copy">Aucun processus GPT.</p> : <>
        {row.gptProcesses.slice(0, 8).map(process => <Link key={process.id} to={`/replay/runs/${encodeURIComponent(process.runId || row.id)}/gpt/${encodeURIComponent(process.id)}`} title={process.id}>
          <span>{process.workflow}</span><strong>{compactId(process.id, 44)}</strong><small>{process.telemetry?.available ? `${process.telemetry.model || "model"} · ${process.telemetry.totalTokens ?? "—"} tok` : "télémétrie absente"}</small><StatusTag status={process.status}/>
        </Link>)}
        {row.gptProcesses.length > 8 && <Link className="replay-compare-more-link" to={`/replay/runs/${encodeURIComponent(row.id)}`}>+{row.gptProcesses.length - 8} processus dans le détail du run <Icon name="arrow" size={13}/></Link>}
      </>}
    </section>)}</div>
  </Card>;
}

function ReplayCompareTimelinePanel({ rows }: { rows: ReplayComparisonItem[] }) {
  return <Card className="replay-compare-timeline-panel">
    <header><div><p className="eyebrow">Timeline échantillon</p><h2>Derniers événements comparés</h2></div><span>{rows.reduce((total, row) => total + row.timelineSample.length, 0)}</span></header>
    <ol>{rows.flatMap(row => row.timelineSample.map(event => ({ row, event }))).sort((left, right) => String(right.event.at || "").localeCompare(String(left.event.at || ""))).map(({ row, event }) => <li key={`${row.id}:${event.id}`} data-layer={event.layer || "event"}>
      <time>{formatTime(event.at)}</time><i aria-hidden="true"/><div><strong title={row.id}>{compactId(row.id, 34)} · {event.title || event.type}</strong><p>{event.conclusion || event.decision || event.detail || event.status}</p></div>
    </li>)}</ol>
  </Card>;
}

function RiskFlags({ flags }: { flags: string[] }) {
  if (!flags.length) return <div className="risk-flags"><span data-tone="positive">Propre</span></div>;
  return <div className="risk-flags">{flags.slice(0, 4).map(flag => <span key={flag} data-tone={flag.includes("FAILED") || flag.includes("ERROR") ? "critical" : "warning"}>{riskLabel(flag)}</span>)}</div>;
}

function filterReplayUniverse(items: WorkflowSummary[], search: string) {
  const q = search.trim().toLowerCase();
  if (!q) return items;
  return items.filter(item => [item.sourceId, item.tradingDate, item.session, item.strategyId, item.variantId, item.status].filter(Boolean).join(" ").toLowerCase().includes(q));
}

function sessionLabel(value: string) {
  return value === "asia_open" ? "Session Asie" : value === "ny_open" ? "Session New York" : value.replaceAll("_", " ");
}

function variantLabel(value?: string | null) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const cadence = normalized.match(/(?:^|:|_)(\d+)(?:m|min)(?:$|:|_)/i)?.[1];
  const session = normalized.includes("asia_open")
    ? "Session Asie"
    : normalized.includes("ny_open")
      ? "Session New York"
      : normalized.replaceAll("_", " ").replaceAll(":", " · ");
  return cadence ? `${session.replace(/\s*·?\s*\d+\s*(?:m|min)\b/i, "").trim()} · ${cadence} min` : session;
}

function riskLabel(value: string) {
  const labels: Record<string, string> = { RUN_FAILED: "run en échec", RUN_BLOCKED: "run bloqué", RUN_ERROR: "erreur", GPT_FAILURE: "risque GPT", WAITING_GPT: "attente GPT", TELEMETRY_PARTIAL: "tél. partielle" };
  return labels[value] || value.toLowerCase();
}

function formatCost(value: number | null | undefined) {
  return value == null ? "—" : `$${value.toFixed(4)}`;
}

function compactId(value: string, max = 36) {
  if (!value || value.length <= max) return value;
  const head = Math.max(10, Math.floor(max * 0.58));
  const tail = Math.max(8, max - head - 1);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
