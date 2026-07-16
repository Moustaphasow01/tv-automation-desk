import { useQuery } from "@tanstack/react-query";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { MetricCard, PageHeading, WorkspaceNav } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";

export default function PerformanceAnalysisPage() {
  const query = useQuery({ queryKey: operationsKeys.performance, queryFn: () => operationsApi.getPerformance() });
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Analyse indisponible"} retry={() => query.refetch()}/>;
  const data = query.data;
  const totals = data.totals;
  return <section className="view workspace-view">
    <WorkspaceNav/><PageHeading eyebrow="Analytics" title="Analyse de performance" subtitle="Résultats réels consolidés par session, instrument, direction et journée."/>
    <div className="metric-grid"><MetricCard label="Résultat" value={`${Number(totals.totalR || 0).toFixed(2)} R`} tone={Number(totals.totalR || 0) >= 0 ? "positive" : "critical"}/><MetricCard label="Trades" value={Number(totals.trades || 0)}/><MetricCard label="Win rate" value={totals.winRate === null ? "—" : `${(Number(totals.winRate) * 100).toFixed(1)}%`}/><MetricCard label="Expectancy" value={totals.expectancyR === null ? "—" : `${Number(totals.expectancyR).toFixed(2)} R`}/></div>
    {!data.breakdowns.some(item => item.items.length) ? <Card className="workspace-empty"><h3>Pas encore de résultat matérialisé</h3><p>Les performances calculées par le backend s’afficheront dès que des trades ou bilans journaliers seront disponibles.</p></Card> : <div className="breakdown-grid">{data.breakdowns.map(group => <Card className="workspace-panel" key={group.dimension}><h2>Par {group.dimension}</h2><div className="breakdown-list">{group.items.map((item, index) => <div key={String(item.label || index)}><span>{String(item.label || "—")}</span><strong>{Number(item.totalR || 0).toFixed(2)} R</strong><small>{Number(item.trades || 0)} trades</small></div>)}</div></Card>)}</div>}
  </section>;
}
