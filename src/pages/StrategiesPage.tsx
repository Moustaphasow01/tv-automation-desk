import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { PageHeading, WorkspaceNav } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";

export default function StrategiesPage() {
  const query = useQuery({ queryKey: operationsKeys.strategies, queryFn: operationsApi.listStrategies });
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Stratégies indisponibles"} retry={() => query.refetch()}/>;
  return <section className="view workspace-view">
    <WorkspaceNav/><PageHeading eyebrow="Version governance" title="Stratégies & versions" subtitle="Configuration, runtime, contrats actifs et historique des versions."/>
    <div className="strategy-grid">{query.data.items.map(strategy => <Link key={strategy.id} to={`/strategies/${encodeURIComponent(strategy.id)}`}><Card className="strategy-card"><header><div><p className="eyebrow">Stratégie</p><h2>{strategy.id}</h2></div><span>{strategy.versions.length} versions</span></header><dl className="definition-grid"><dt>Catalogue</dt><dd>{strategy.catalog ? "Présent" : "Non publié"}</dd><dt>Configuration</dt><dd>{strategy.config ? "Active" : "Par défaut"}</dd><dt>Runtime</dt><dd>{strategy.runtime ? "Matérialisé" : "Inactif"}</dd><dt>Contrats</dt><dd>{strategy.activeContracts.length}</dd></dl><span className="row-link">Ouvrir la stratégie →</span></Card></Link>)}</div>
  </section>;
}
