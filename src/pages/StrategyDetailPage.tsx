import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, EmptyWorkspace, MetricCard, MetricStrip, PageHeading, StatusTag, TechnicalDetails } from "@/components/operations";
import { buildStrategyV2DetailViewModel } from "@/features/strategy-v2/viewModel";
import { operationsKeys } from "@/hooks/useOperations";

export default function StrategyDetailPage() {
  const { strategyId = "" } = useParams();
  const id = decodeURIComponent(strategyId);
  const registry = useQuery({
    queryKey: operationsKeys.strategyV2Overview({ limit: 500 }),
    queryFn: () => operationsApi.getStrategyV2Overview({ limit: 500 }),
    refetchInterval: 30_000,
  });
  const legacy = useQuery({
    queryKey: operationsKeys.strategies,
    queryFn: operationsApi.listStrategies,
    retry: false,
  });

  if (registry.isLoading) return <LoadingView/>;
  if (registry.isError || !registry.data) return <ErrorView message={registry.error?.message || "Registry Strategy v2 indisponible"} retry={() => registry.refetch()}/>;

  const view = buildStrategyV2DetailViewModel(registry.data, id, legacy.data);
  if (!view) return <ErrorView message="Strategy Definition introuvable dans le registry v2" retry={() => registry.refetch()}/>;

  return <section className="view workspace-view strategy-detail-v3 strategy-governance-v3 strategy-v2-detail-page">
    <Breadcrumbs items={[{ label: "Stratégies", to: "/strategies" }, { label: view.title }]}/>
    <PageHeading
      eyebrow="Strategy Definition"
      title={view.title}
      subtitle={view.subtitle}
      backTo="/strategies"
      actions={<Link className="primary-btn" to={`/performance/analysis?strategy=${encodeURIComponent(view.raw.external_key || view.id)}`}>Performance historique</Link>}
    />

    <MetricStrip className="metric-grid--compact strategy-kpi-strip">
      {view.metrics.map(metric => <MetricCard key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} tone={metric.tone}/>)}
    </MetricStrip>

    <Card className="workspace-panel strategy-source-panel">
      <div>
        <p className="eyebrow">Source canonique</p>
        <h2>Strategy Kernel V2</h2>
        <p>{view.sourceDetail}</p>
      </div>
      <StatusTag status={view.raw.operator_state.recommended_next_step}/>
    </Card>

    <div className="strategy-governance-grid">
      <Card className="workspace-panel strategy-version-ledger">
        <header><div><p className="eyebrow">Versions</p><h2>Cycle de publication</h2></div><span className="terminal-counter">{view.versions.length}</span></header>
        {!view.versions.length ? <EmptyWorkspace title="Aucune version" text="La définition existe mais aucune Strategy Version n’a encore été persistée."/> : <div className="data-table-wrap"><table className="data-table">
          <thead><tr><th>Version</th><th>Statut</th><th>Artifact</th><th>Métriques</th><th>Mise à jour</th></tr></thead>
          <tbody>{view.versions.map(version => <tr key={version.id}>
            <td data-label="Version"><strong>{version.label}</strong><small>{version.id}</small></td>
            <td data-label="Statut"><StatusTag status={version.status}/></td>
            <td data-label="Artifact"><code>{version.artifact}</code></td>
            <td data-label="Métriques"><code>{version.metricsRef}</code></td>
            <td data-label="Mise à jour">{version.updatedAt}</td>
          </tr>)}</tbody>
        </table></div>}
      </Card>

      <Card className="workspace-panel strategy-contract-ledger">
        <header><div><p className="eyebrow">Instances</p><h2>Runtime SHADOW / PAPER / LIVE</h2></div><span className="terminal-counter">{view.instances.length}</span></header>
        {!view.instances.length ? <EmptyWorkspace title="Aucune instance runtime" text="La stratégie n’est pas encore branchée au moteur en SHADOW, PAPER ou LIVE."/> : <div className="data-table-wrap"><table className="data-table">
          <thead><tr><th>Instance</th><th>Mode</th><th>Runtime</th><th>Scope</th><th>Compte</th><th>Heartbeat</th></tr></thead>
          <tbody>{view.instances.map(instance => <tr key={instance.id}>
            <td data-label="Instance"><strong>{instance.id}</strong></td>
            <td data-label="Mode"><StatusTag status={instance.executionMode}/></td>
            <td data-label="Runtime"><StatusTag status={instance.runtimeState}/></td>
            <td data-label="Scope"><strong>{instance.instruments}</strong><small>{instance.sessions}</small></td>
            <td data-label="Compte">{instance.account}</td>
            <td data-label="Heartbeat">{instance.heartbeat}</td>
          </tr>)}</tbody>
        </table></div>}
      </Card>
    </div>

    <Card className="workspace-panel strategy-diff-panel">
      <header><div><p className="eyebrow">Audit</p><h2>Dernières transitions</h2></div><span className="terminal-counter">{view.audit.length}</span></header>
      {!view.audit.length ? <EmptyWorkspace title="Audit vide" text="Aucune transition Strategy Kernel n’est encore associée à cette définition."/> : <div className="data-table-wrap"><table className="data-table">
        <thead><tr><th>Événement</th><th>Agrégat</th><th>Acteur</th><th>Raison</th><th>Date</th></tr></thead>
        <tbody>{view.audit.map(event => <tr key={event.id}>
          <td data-label="Événement"><strong>{event.eventType}</strong><small>{event.id}</small></td>
          <td data-label="Agrégat">{event.aggregate}</td>
          <td data-label="Acteur">{event.actor}</td>
          <td data-label="Raison">{event.reason}</td>
          <td data-label="Date">{event.at}</td>
        </tr>)}</tbody>
      </table></div>}
    </Card>

    <TechnicalDetails items={[
      { label: "Strategy Definition ID", value: view.id },
      { label: "External key", value: view.raw.external_key },
      { label: "Published version", value: view.raw.published_version?.strategy_version_id || "—" },
      { label: "Live instance", value: view.raw.live_instance?.strategy_instance_id || "—" },
    ]}/>
    <details className="raw-inspector"><summary>Données Strategy v2 brutes</summary><pre>{JSON.stringify(view.raw, null, 2)}</pre></details>
  </section>;
}
