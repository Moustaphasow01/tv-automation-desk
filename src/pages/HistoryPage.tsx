import { useDeferredValue, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, Icon, LoadingView } from "@/components/common";
import { formatDateTime, MetricCard, MetricStrip, PageHeading, ProgressBar, StatusTag } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";
import type { DeskHistory, HistoryAuditItem, HistoryIncidentMatrixItem, HistoryMatrixItem, HistorySessionSummary } from "@/operationsTypes";

export default function HistoryPage() {
  const [params, setParams] = useSearchParams();
  const rawFilters = useMemo(() => ({
    q: params.get("q") || "",
    status: params.get("status") || "",
    session: params.get("session") || "",
    kind: params.get("kind") || "",
    strategyId: params.get("strategy") || "",
    from: params.get("from") || "",
    to: params.get("to") || "",
  }), [params]);
  const filters = useDeferredValue(rawFilters);
  const apiFilters = useMemo(() => ({
    q: filters.q || null, status: filters.status || null, session: filters.session || null,
    kind: filters.kind || null, strategy_id: filters.strategyId || null,
    from: filters.from || null, to: filters.to || null,
  }), [filters]);
  const query = useQuery({ queryKey: operationsKeys.history(apiFilters), queryFn: () => operationsApi.getHistory(apiFilters) });
  const setFilter = (key: string, value: string) => setParams(current => {
    const next = new URLSearchParams(current);
    value ? next.set(key, value) : next.delete(key);
    return next;
  }, { replace: true });
  const clearFilters = () => setParams({}, { replace: true });

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Historique indisponible"} retry={() => query.refetch()}/>;

  const data = query.data;
  const summary = data.summary;
  const hasFilters = Object.values(rawFilters).some(Boolean);
  return <section className="view workspace-view history-v3">
    <PageHeading eyebrow="Mémoire opérationnelle" title="Historique des sessions" subtitle="Sessions, workflows, incidents, GPT et performance consolidés depuis l’état persistant." actions={<><button className="secondary-btn" onClick={() => query.refetch()}>Actualiser</button><Link className="primary-btn" to="/operations">Cockpit live</Link></>}/>

    <MetricStrip className="metric-grid--compact history-kpi-strip">
      <MetricCard label="Sessions" value={summary.sessions} detail={`${summary.activeDays} journées`}/>
      <MetricCard label="Workflows" value={summary.workflows} detail={`${summary.completed} terminés`}/>
      <MetricCard label="Actifs" value={summary.running + summary.waitingGpt} detail={`${summary.waitingGpt} attente GPT`} tone={summary.running + summary.waitingGpt ? "info" : "neutral"}/>
      <MetricCard label="Bloqués / échecs" value={summary.blocked + summary.failed} detail={`${summary.failed} échecs`} tone={summary.blocked + summary.failed ? "critical" : "neutral"}/>
      <MetricCard label="Résultat cumulé" value={formatR(summary.totalR)} tone={summary.totalR >= 0 ? "positive" : "critical"}/>
      <MetricCard label="Incidents ouverts" value={summary.openIncidents} detail={`${summary.gptProcesses} processus GPT`} tone={summary.openIncidents ? "warning" : "neutral"}/>
    </MetricStrip>

    <Card className="history-filter-bar" aria-label="Filtres de l’historique">
      <label className="history-filter-search"><span>Recherche</span><div><Icon name="search" size={13}/><input aria-label="Rechercher dans l’historique" placeholder="Run, workflow, statut…" value={rawFilters.q} onChange={event => setFilter("q", event.target.value)}/></div></label>
      <FilterSelect label="État" value={rawFilters.status} values={data.facets.statuses} onChange={value => setFilter("status", value)}/>
      <FilterSelect label="Session" value={rawFilters.session} values={data.facets.sessions} onChange={value => setFilter("session", value)} format={shortLabel}/>
      <FilterSelect label="Type" value={rawFilters.kind} values={data.facets.kinds} onChange={value => setFilter("kind", value)}/>
      <FilterSelect label="Stratégie" value={rawFilters.strategyId} values={data.facets.strategies} onChange={value => setFilter("strategy", value)}/>
      <label><span>Du</span><input aria-label="Historique depuis" type="date" value={rawFilters.from} min={data.facets.dateRange.from || undefined} max={data.facets.dateRange.to || undefined} onChange={event => setFilter("from", event.target.value)}/></label>
      <label><span>Au</span><input aria-label="Historique jusqu’au" type="date" value={rawFilters.to} min={data.facets.dateRange.from || undefined} max={data.facets.dateRange.to || undefined} onChange={event => setFilter("to", event.target.value)}/></label>
      <div className="history-filter-bar__result"><strong>{data.sessions.length}</strong><span>sessions</span>{hasFilters && <button className="text-btn" onClick={clearFilters}>Réinitialiser</button>}</div>
    </Card>

    <HistoryGovernanceBoard governance={data.governance}/>

    {!data.sessions.length ? <Card className="workspace-empty history-empty-state"><span className="terminal-code">{hasFilters ? "NO_MATCHING_HISTORY" : "NO_HISTORY_MATERIALIZED"}</span><h3>{hasFilters ? "Aucune session ne correspond aux filtres" : "Aucune session historique"}</h3><p>Cette vue est construite uniquement à partir des workflows persistés. Aucun historique n’est fabriqué côté frontend.</p>{hasFilters && <button className="secondary-btn" onClick={clearFilters}>Effacer les filtres</button>}</Card> :
      <section className="replay-terminal-section history-session-ledger">
        <header><div><p className="eyebrow">Registre consolidé</p><h2>Sessions matérialisées</h2></div><span>{data.sessions.length} lignes · source PostgreSQL</span></header>
        <div className="data-table-wrap"><table className="data-table history-session-table">
          <thead><tr><th>Date / session</th><th>État</th><th>Workflows</th><th>Composition</th><th>Progression</th><th>Résultat</th><th>Flux</th><th>Dernière activité</th><th/></tr></thead>
          <tbody>{data.sessions.map(session => <HistoryRow key={session.id} session={session}/>)}</tbody>
        </table></div>
      </section>}
  </section>;
}

function HistoryRow({ session }: { session: HistorySessionSummary }) {
  return <tr>
    <td data-label="Date / session"><strong>{session.tradingDate || "Date inconnue"}</strong><small>{shortLabel(session.session || "global")} · {session.id}</small></td>
    <td data-label="État"><StatusTag status={session.status}/></td>
    <td data-label="Workflows"><strong>{session.workflowCount}</strong><small>{session.strategies.length} stratégies</small></td>
    <td data-label="Composition"><div className="history-kind-stack">{session.kinds.map(kind => <span key={kind}>{kind}</span>)}</div></td>
    <td data-label="Progression"><ProgressBar value={session.progress} status={session.status}/></td>
    <td data-label="Résultat" className={session.totalR >= 0 ? "positive" : "negative"}><strong>{formatR(session.totalR)}</strong></td>
    <td data-label="Flux"><strong>{session.gptProcesses} GPT</strong><small>{session.incidentCount} incidents</small></td>
    <td data-label="Dernière activité"><time>{formatDateTime(session.updatedAt)}</time></td>
    <td data-label="Action"><Link className="row-link" to={`/history/sessions/${encodeURIComponent(session.id)}`}>Explorer <Icon name="arrow" size={13}/></Link></td>
  </tr>;
}

function HistoryGovernanceBoard({ governance }: { governance: DeskHistory["governance"] }) {
  return <section className="history-governance-grid" aria-label="Console de gouvernance historique">
    <Card className="history-governance-panel history-matrix-panel">
      <header><div><p className="eyebrow">Command center</p><h2>Matrice workflows automatisés</h2></div><span className="terminal-counter">Score {governance.automationScore}%</span></header>
      <div className="history-matrix-grid">{governance.statusMatrix.slice(0, 6).map(item => <HistoryMatrixTile key={item.label} item={item}/>)}</div>
      <div className="history-risk-flags">{governance.riskFlags.length ? governance.riskFlags.map(flag => <span key={flag}>{flag}</span>) : <span>NO_ACTIVE_RISK</span>}</div>
    </Card>

    <Card className="history-governance-panel history-exposure-panel">
      <header><div><p className="eyebrow">Exposition métier</p><h2>Sessions, types, stratégies</h2></div><span>{governance.sessions.length} scopes</span></header>
      <HistoryCompactMatrix title="Sessions" items={governance.sessionMatrix.slice(0, 5)}/>
      <HistoryCompactMatrix title="Types" items={governance.kindMatrix.slice(0, 5)}/>
      <HistoryCompactMatrix title="Stratégies" items={governance.strategyMatrix.slice(0, 5)}/>
      {!!governance.incidentMatrix.length && <HistoryIncidentMatrix items={governance.incidentMatrix.slice(0, 4)}/>}
    </Card>

    <Card className="history-governance-panel history-audit-panel">
      <header><div><p className="eyebrow">Traçabilité</p><h2>Audit trail global</h2></div><span>{governance.auditTrail.length} événements</span></header>
      <HistoryAuditTape items={governance.auditTrail.slice(0, 7)}/>
    </Card>
  </section>;
}

function HistoryMatrixTile({ item }: { item: HistoryMatrixItem }) {
  const body = <><i data-tone={item.tone}/><span>{shortLabel(item.label)}</span><strong>{item.count}</strong><small>{formatR(item.totalR)} · {item.gptProcesses} GPT · {item.incidents} inc.</small><ProgressBar value={item.progress} status={item.tone}/></>;
  return item.href ? <Link className="history-matrix-tile" data-tone={item.tone} to={item.href}>{body}</Link> : <div className="history-matrix-tile" data-tone={item.tone}>{body}</div>;
}

function HistoryCompactMatrix({ title, items }: { title: string; items: HistoryMatrixItem[] }) {
  return <div className="history-compact-matrix"><h3>{title}</h3>{!items.length ? <small>—</small> : items.map(item => <Link key={item.label} to={item.href || "/history"} data-tone={item.tone}><span>{shortLabel(item.label)}</span><strong>{item.count}</strong><small>{formatR(item.totalR)}</small></Link>)}</div>;
}

function HistoryIncidentMatrix({ items }: { items: HistoryIncidentMatrixItem[] }) {
  return <div className="history-compact-matrix"><h3>Incidents</h3>{items.map(item => <Link key={item.label} to="/operations/incidents" data-tone={item.tone}><span>{shortLabel(item.label)}</span><strong>{item.count}</strong><small>{item.critical} critical</small></Link>)}</div>;
}

function HistoryAuditTape({ items }: { items: HistoryAuditItem[] }) {
  if (!items.length) return <div className="terminal-empty-state"><span>NO_AUDIT_EVENT</span><small>Aucun événement d’audit matérialisé sur le scope.</small></div>;
  return <ol className="history-audit-tape">{items.map(item => <li key={item.id} data-severity={item.severity}>{item.href ? <Link to={item.href}>{auditBody(item)}</Link> : <span>{auditBody(item)}</span>}</li>)}</ol>;
}

function auditBody(item: HistoryAuditItem) {
  return <><time>{formatDateTime(item.at)}</time><span><strong>{item.title}</strong><small>{item.type} · {item.actor}</small></span><em>{shortLabel(item.status)}</em></>;
}

function FilterSelect({ label, value, values, onChange, format = value => value }: { label: string; value: string; values: string[]; onChange: (value: string) => void; format?: (value: string) => string }) {
  return <label><span>{label}</span><select aria-label={`Filtrer l’historique par ${label.toLowerCase()}`} value={value} onChange={event => onChange(event.target.value)}><option value="">Tous</option>{values.map(item => <option key={item} value={item}>{format(item)}</option>)}</select></label>;
}

function shortLabel(value: string) { return value.replaceAll("_", " ").toUpperCase(); }
function formatR(value: number) { return `${value > 0 ? "+" : ""}${Number(value || 0).toFixed(2)} R`; }
