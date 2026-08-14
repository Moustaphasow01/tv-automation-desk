import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, DataSourceBadge, ErrorView, Icon, LoadingView } from "@/components/common";
import { EmptyWorkspace, MetricCard, MetricStrip, PageHeading, StatusTag } from "@/components/operations";
import { buildDataFoundationViewModel } from "@/features/data-foundation/viewModel";

export default function DataFoundationPage() {
  const overview = useQuery({ queryKey: ["data-foundation", "overview"], queryFn: operationsApi.getDataFoundationOverview, refetchInterval: 60_000 });
  const datasets = useQuery({ queryKey: ["data-foundation", "datasets"], queryFn: () => operationsApi.listDataFoundationDatasets({ limit: 80 }), refetchInterval: 60_000 });
  const features = useQuery({ queryKey: ["data-foundation", "features"], queryFn: () => operationsApi.listDataFoundationFeatures({ limit: 120 }), refetchInterval: 60_000 });
  const marketProfiles = useQuery({ queryKey: ["data-foundation", "market-profiles"], queryFn: () => operationsApi.listDataFoundationMarketProfiles({ limit: 120 }), refetchInterval: 60_000 });
  const storageObjects = useQuery({ queryKey: ["data-foundation", "storage-objects"], queryFn: () => operationsApi.listDataFoundationStorageObjects({ limit: 80 }), refetchInterval: 60_000 });
  const hotSeriesWindows = useQuery({ queryKey: ["data-foundation", "hot-series-windows"], queryFn: () => operationsApi.listDataFoundationHotSeriesWindows({ limit: 80 }), refetchInterval: 60_000 });
  const queries = [overview, datasets, features, marketProfiles, storageObjects, hotSeriesWindows];
  const loading = queries.every((query) => query.isLoading);
  const hardError = overview.isError && datasets.isError && features.isError;

  if (loading) return <LoadingView title="Chargement Data Foundation" message="Lecture des datasets, features, couverture et lineage depuis l’API réelle." source="POSTGRES + API"/>;
  if (hardError) return <ErrorView message={overview.error?.message || datasets.error?.message || features.error?.message || "Data Foundation indisponible"} retry={() => queries.forEach((query) => query.refetch())}/>;

  const view = buildDataFoundationViewModel({
    overview: overview.data,
    datasets: datasets.data,
    features: features.data,
    marketProfiles: marketProfiles.data,
    storageObjects: storageObjects.data,
    hotSeriesWindows: hotSeriesWindows.data,
  });

  return <section className="view workspace-view data-foundation-page">
    <PageHeading
      eyebrow="Data Foundation"
      title="Couverture, lineage & features"
      subtitle="Lecture contrôlée des datasets, capacités marché, objets froids, séries chaudes et features point-in-time."
      actions={<><DataSourceBadge label="POSTGRES + API" detail="aucun mock"/><button className="secondary-btn" onClick={() => queries.forEach((query) => query.refetch())}><Icon name="refresh" size={14}/>Actualiser</button></>}
    />

    <MetricStrip className="metric-grid--compact">
      {view.metrics.map((metric) => <MetricCard key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} tone={metric.tone}/>)}
    </MetricStrip>

    <Card className="workspace-panel strategy-source-panel">
      <div>
        <p className="eyebrow">{view.sourceLabel}</p>
        <h2>Frontière d’accès contrôlée</h2>
        <p>Le front lit uniquement les endpoints Data Foundation. Les tables internes restent derrière le BFF et les contrats de lineage.</p>
      </div>
      <span className="terminal-counter">MAJ {view.generatedAt}</span>
    </Card>

    {view.warnings.length > 0 && <Card className="workspace-panel">
      <h2>Points d’attention</h2>
      <div className="tag-list">{view.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>
    </Card>}

    <section className="data-foundation-grid">
      <Panel title="Couverture marché" subtitle="Capacités réelles mesurées par feed">
        {view.coverageRows.length ? <div className="data-table-wrap"><table className="data-table">
          <thead><tr><th>Feed</th><th>État</th><th>Manques</th><th>Stockage</th><th>Lignes</th></tr></thead>
          <tbody>{view.coverageRows.map((row) => <tr key={row.key}>
            <td data-label="Feed"><strong>{row.label}</strong><small>{row.key}</small></td>
            <td data-label="État"><StatusTag status={row.state}/></td>
            <td data-label="Manques">{row.missing}</td>
            <td data-label="Stockage"><strong>{row.storage}</strong><small>{row.recommendation}</small></td>
            <td data-label="Lignes">{row.rows.toLocaleString("fr-FR")}</td>
          </tr>)}</tbody>
        </table></div> : <EmptyWorkspace title="Aucun profil marché" text="Lance le profilage TD2-206 pour matérialiser les capacités market data."/>}
      </Panel>

      <Panel title="Datasets & lineage" subtitle="Datasets scellés et lots source">
        {view.datasetRows.length ? <div className="data-table-wrap"><table className="data-table">
          <thead><tr><th>Dataset</th><th>État</th><th>Cutoff</th><th>Lineage</th><th>Hash</th></tr></thead>
          <tbody>{view.datasetRows.map((row) => <tr key={row.key}>
            <td data-label="Dataset"><strong>{row.label}</strong><small>{row.key}</small></td>
            <td data-label="État"><StatusTag status={row.status}/></td>
            <td data-label="Cutoff">{row.cutoff}</td>
            <td data-label="Lineage"><strong>{row.batches} batch(s)</strong><small>{row.lineage}</small></td>
            <td data-label="Hash">{row.hash}</td>
          </tr>)}</tbody>
        </table></div> : <EmptyWorkspace title="Aucun dataset visible" text="L’API ne retourne aucun dataset : état réel vide, aucun fallback fictif."/>}
      </Panel>
    </section>

    <section className="data-foundation-grid">
      <Panel title="Features point-in-time" subtitle="Catalogue publié, versionné et anti-lookahead">
        {view.featureRows.length ? <div className="data-table-wrap"><table className="data-table">
          <thead><tr><th>Feature</th><th>Catégorie</th><th>Sortie</th><th>Version</th><th>Lineage</th></tr></thead>
          <tbody>{view.featureRows.map((row) => <tr key={row.key}>
            <td data-label="Feature"><strong>{row.label}</strong><small>{row.key}</small></td>
            <td data-label="Catégorie">{row.category}</td>
            <td data-label="Sortie">{row.output}</td>
            <td data-label="Version"><StatusTag status={row.status}/><small>{row.version}</small></td>
            <td data-label="Lineage">{row.lineage}</td>
          </tr>)}</tbody>
        </table></div> : <EmptyWorkspace title="Aucune feature publiée" text="Le catalogue TD2-208 doit être seedé en base pour alimenter cette section."/>}
      </Panel>

      <Panel title="Stockage chaud/froid" subtitle="Objets froids reconstructibles et fenêtres PostgreSQL">
        <div className="split-list">
          <div>
            <h3>Objets froids</h3>
            {view.storageRows.length ? <ul className="terminal-list">{view.storageRows.map((row) => <li key={row.key}>
              <span><strong>{row.label}</strong><small>{row.tier} · {row.format} · {row.size}</small></span>
              <StatusTag status={row.status}/>
            </li>)}</ul> : <p className="muted-copy">Aucun objet froid matérialisé.</p>}
          </div>
          <div>
            <h3>Séries chaudes</h3>
            {view.hotRows.length ? <ul className="terminal-list">{view.hotRows.map((row) => <li key={row.key}>
              <span><strong>{row.label}</strong><small>{row.table} · {row.rows.toLocaleString("fr-FR")} lignes · {row.latest}</small></span>
              <StatusTag status={row.status}/>
            </li>)}</ul> : <p className="muted-copy">Aucune fenêtre chaude matérialisée.</p>}
          </div>
        </div>
      </Panel>
    </section>

    <p className="muted-copy">Besoin de comparer les résultats ? <Link to="/performance/analysis">ouvrir l’analyse performance</Link>.</p>
  </section>;
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <Card className="workspace-panel">
    <header className="panel-heading"><div><p className="eyebrow">{subtitle}</p><h2>{title}</h2></div></header>
    {children}
  </Card>;
}
