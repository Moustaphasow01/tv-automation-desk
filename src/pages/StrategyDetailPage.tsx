import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, PageHeading, WorkspaceNav } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";

export default function StrategyDetailPage() {
  const { strategyId = "" } = useParams();
  const id = decodeURIComponent(strategyId);
  const strategies = useQuery({ queryKey: operationsKeys.strategies, queryFn: operationsApi.listStrategies });
  const strategy = strategies.data?.items.find(item => item.id === id);
  const versions = useMemo(() => strategy?.versions || [], [strategy]);
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const comparison = useQuery({ queryKey: ["operations", "strategy-compare", id, left, right], queryFn: () => operationsApi.compareStrategyVersions(id, left, right), enabled: Boolean(left && right) });
  if (strategies.isLoading) return <LoadingView/>;
  if (strategies.isError || !strategy) return <ErrorView message={strategies.error?.message || "Stratégie introuvable"} retry={() => strategies.refetch()}/>;
  return <section className="view workspace-view"><WorkspaceNav/><Breadcrumbs items={[{ label: "Stratégies", to: "/strategies" }, { label: id }]}/><PageHeading eyebrow="Strategy governance" title={id} subtitle="Configuration, runtime, contrats et comparaison de versions" backTo="/strategies"/><div className="content-grid content-grid--start"><Card className="workspace-panel"><h2>Versions publiées</h2>{!versions.length ? <p className="muted-copy">Aucune version explicite.</p> : <div className="version-list">{versions.map((version, index) => <div key={String(version.version_id || index)}><strong>{String(version.version || version.version_id)}</strong><small>{String(version.status || "archivée")}</small></div>)}</div>}</Card><Card className="workspace-panel"><h2>Contrats actifs</h2><div className="version-list">{strategy.activeContracts.map(contract => <div key={`${contract.name}:${contract.version}`}><strong>{contract.name}</strong><small>v{contract.version} · {contract.status}</small></div>)}</div></Card></div>{versions.length >= 2 && <Card className="workspace-panel"><h2>Comparer deux versions</h2><div className="workspace-toolbar"><label>Avant<select value={left} onChange={event => setLeft(event.target.value)}><option value="">Sélectionner</option>{versions.map((version, index) => <option key={index} value={String(version.version_id || version.version)}>{String(version.version || version.version_id)}</option>)}</select></label><label>Après<select value={right} onChange={event => setRight(event.target.value)}><option value="">Sélectionner</option>{versions.map((version, index) => <option key={index} value={String(version.version_id || version.version)}>{String(version.version || version.version_id)}</option>)}</select></label></div>{comparison.data && <details className="raw-inspector" open><summary>Diff structurel</summary><pre>{JSON.stringify(comparison.data, null, 2)}</pre></details>}</Card>}<details className="raw-inspector"><summary>Configuration courante</summary><pre>{JSON.stringify(strategy.config || strategy.catalog, null, 2)}</pre></details></section>;
}
