import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { ErrorView, Icon, LoadingView } from "@/components/common";
import { MetricCard, MetricStrip, PageHeading } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";
import { shortReference } from "@/lib/presentation";

export default function StrategiesPage() {
  const query = useQuery({ queryKey: operationsKeys.strategies, queryFn: operationsApi.listStrategies });
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Stratégies indisponibles"} retry={() => query.refetch()}/>;
  const items = query.data.items;
  const totalR = items.reduce((total, item) => total + Number(item.performance.totalR || 0), 0);
  const trades = items.reduce((total, item) => total + Number(item.performance.trades || 0), 0);
  return <section className="view workspace-view strategies-v3">
    <PageHeading eyebrow="Strategy governance" title="Stratégies & versions" subtitle="Catalogue, runtime, performance réelle, contrats et historique des versions." actions={<Link className="secondary-btn" to="/performance/analysis">Performance globale</Link>}/>
    <MetricStrip className="metric-grid--compact">
      <MetricCard label="Stratégies détectées" value={items.length}/>
      <MetricCard label="Résultat cumulé" value={formatR(totalR)} tone={totalR >= 0 ? "positive" : "critical"}/>
      <MetricCard label="Trades persistés" value={trades}/>
      <MetricCard label="Versions publiées" value={items.reduce((total, item) => total + item.versions.length, 0)}/>
    </MetricStrip>
    <section className="replay-terminal-section strategy-terminal-section"><header><div><p className="eyebrow">Registry canonique</p><h2>Catalogue et activité</h2></div><span>{items.length} stratégies matérialisées</span></header><div className="data-table-wrap"><table className="data-table strategy-registry-table"><thead><tr><th>Stratégie</th><th>État des sources</th><th>Résultat</th><th>Trades</th><th>Win rate</th><th>Drawdown</th><th>Replays</th><th>Versions</th><th>Contrats</th><th/></tr></thead><tbody>{items.map(strategy => <tr key={strategy.id}>
      <td data-label="Stratégie"><strong>{String(strategy.catalog?.name || strategy.config?.name || "Stratégie détectée")}</strong><small>{shortReference(strategy.id)}</small></td>
      <td data-label="Sources"><div className="strategy-source-flags"><i data-ready={Boolean(strategy.catalog)}>CAT</i><i data-ready={Boolean(strategy.config)}>CFG</i><i data-ready={Boolean(strategy.runtime)}>RUN</i><i data-ready={Boolean(strategy.stats)}>STAT</i></div></td>
      <td data-label="Résultat" className={strategy.performance.totalR >= 0 ? "positive" : "negative"}><strong>{formatR(strategy.performance.totalR)}</strong></td>
      <td data-label="Trades">{strategy.performance.trades}</td>
      <td data-label="Win rate">{strategy.performance.winRate === null ? "—" : `${(strategy.performance.winRate * 100).toFixed(1)}%`}</td>
      <td data-label="Drawdown" className={strategy.performance.maxDrawdownR < 0 ? "negative" : ""}>{formatR(strategy.performance.maxDrawdownR)}</td>
      <td data-label="Replays">{strategy.replayCount}</td><td data-label="Versions">{strategy.versions.length}</td><td data-label="Contrats">{strategy.activeContracts.length}</td>
      <td data-label="Action"><Link className="row-link" to={`/strategies/${encodeURIComponent(strategy.id)}`}>Ouvrir <Icon name="arrow" size={13}/></Link></td>
    </tr>)}</tbody></table></div></section>
  </section>;
}

function formatR(value: number) { return `${value > 0 ? "+" : ""}${Number(value || 0).toFixed(2)} R`; }
