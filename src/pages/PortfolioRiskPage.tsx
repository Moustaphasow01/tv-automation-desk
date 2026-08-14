import { Link, useParams } from "react-router-dom";
import { Card, DataSourceBadge, ErrorView, Icon, LoadingView } from "@/components/common";
import { Breadcrumbs, MetricCard, MetricStrip, PageHeading, PageTabs, StatusTag } from "@/components/operations";
import { usePortfolioRiskOverview } from "@/features/portfolio-risk/dataAccess";
import { buildPortfolioRiskViewModel, portfolioRiskSection, type PortfolioRiskSection } from "@/features/portfolio-risk/viewModel";

const operationsTabs = [
  { label: "Cockpit", to: "/operations", end: true },
  { label: "Agents IA", to: "/operations/agents" }, { label: "AI Context", to: "/operations/ai-context" },
  { label: "Files GPT", to: "/operations/claim-lanes" },
  { label: "Portfolio Risk", to: "/operations/portfolio-risk" },
  { label: "Exécution", to: "/operations/execution" },
  { label: "Observabilité", to: "/operations/observability" },
  { label: "Incidents", to: "/operations/incidents" },
];

export default function PortfolioRiskPage() {
  const { sectionId } = useParams();
  const query = usePortfolioRiskOverview();
  if (query.isLoading) return <LoadingView title="Chargement Portfolio Risk" message="Lecture des projections execution, stratégie et performance." source="POSTGRES + API"/>;
  if (query.isError || !query.data) return <ErrorView title="Portfolio Risk indisponible" message={query.error?.message || "API indisponible"} retry={() => query.refetch()}/>;

  const view = buildPortfolioRiskViewModel(query.data);
  const selected = portfolioRiskSection(view, sectionId);
  if (sectionId) return <PortfolioRiskDetail view={view} selected={selected} refresh={() => query.refetch()}/>;
  return <PortfolioRiskOverviewScreen view={view} refresh={() => query.refetch()}/>;
}

function PortfolioRiskOverviewScreen({ view, refresh }: { view: ReturnType<typeof buildPortfolioRiskViewModel>; refresh: () => void }) {
  return <section className="view workspace-view portfolio-risk-page">
    <PageHeading
      eyebrow="Risque global"
      title="Portfolio Risk"
      subtitle="Projection opérateur du risque consolidé, du netting broker et des contrôles avant exécution."
      actions={<><DataSourceBadge label={view.sourceLabel} detail={view.sourceDetail}/><button className="secondary-btn" onClick={refresh}><Icon name="refresh" size={14}/>Actualiser</button></>}
      tabs={<PageTabs items={operationsTabs}/>}
    />
    <MetricStrip className="metric-strip--six">{view.metrics.map(metric => <MetricCard key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} tone={metric.tone}/>)}</MetricStrip>
    <PortfolioRiskWarnings view={view}/>
    <section className="agent-runtime-layout">
      <Card className="workspace-panel">
        <header className="panel-heading"><div><p className="eyebrow">Vue zoomable</p><h2>Sections Portfolio Risk</h2></div><StatusTag status={view.health.tone}/></header>
        <div className="agent-pool-grid">{view.sections.map(section => <Link key={section.id} className={`agent-pool-card agent-pool-card--${section.tone}`} to={section.href}>
          <header><div><strong>{section.title}</strong><small>{section.summary}</small></div><span>{section.count}</span></header>
          <p>Ouvrir la vue dédiée pour inspecter les lignes et références sans surcharge de l’écran global.</p>
          <footer><Icon name="arrow" size={13}/> Ouvrir</footer>
        </Link>)}</div>
      </Card>
      <Card className="workspace-panel">
        <header className="panel-heading"><div><p className="eyebrow">Actions sensibles</p><h2>Commandes contrôlées</h2></div><span>{view.actions.length}</span></header>
        <ul className="terminal-list">{view.actions.map(action => <li key={action.key}>
          <span><strong>{action.label}</strong><small>{action.reason}</small></span>
          {action.href && action.enabled ? <Link className="secondary-btn" to={action.href}>Ouvrir</Link> : <button className="secondary-btn" disabled>{action.status}</button>}
        </li>)}</ul>
      </Card>
    </section>
    <PortfolioRiskPreview view={view}/>
  </section>;
}

function PortfolioRiskDetail({ view, selected, refresh }: { view: ReturnType<typeof buildPortfolioRiskViewModel>; selected: PortfolioRiskSection | null; refresh: () => void }) {
  return <section className="view workspace-view portfolio-risk-page">
    <Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: "Portfolio Risk", to: "/operations/portfolio-risk" }, { label: selected?.title || "Section inconnue" }]}/>
    <PageHeading
      eyebrow="Zoom Portfolio Risk"
      title={selected?.title || "Section inconnue"}
      subtitle={selected?.summary || "La section demandée n’existe pas dans le cockpit courant."}
      backTo="/operations/portfolio-risk"
      actions={<><DataSourceBadge label={view.sourceLabel}/><button className="secondary-btn" onClick={refresh}><Icon name="refresh" size={14}/>Actualiser</button></>}
      tabs={<PageTabs items={operationsTabs}/>}
    />
    {!selected ? <Card className="workspace-panel"><p>Section inconnue. Retourne à la vue Portfolio Risk pour ouvrir une section disponible.</p></Card> : <PortfolioRiskSectionTable id={selected.id} view={view}/>}
  </section>;
}

function PortfolioRiskWarnings({ view }: { view: ReturnType<typeof buildPortfolioRiskViewModel> }) {
  if (!view.warnings.length) return null;
  return <Card className="workspace-panel">
    <header className="panel-heading"><div><p className="eyebrow">Lecture opérateur</p><h2>Points de vigilance</h2></div><StatusTag status={view.health.tone}/></header>
    <ul className="terminal-list">{view.warnings.map(item => <li key={item}><span><strong>{item}</strong><small>{view.generatedAt}</small></span></li>)}</ul>
  </Card>;
}

function PortfolioRiskPreview({ view }: { view: ReturnType<typeof buildPortfolioRiskViewModel> }) {
  return <section className="data-foundation-grid">
    <Card className="workspace-panel"><header className="panel-heading"><div><p className="eyebrow">Exposition</p><h2>Top lignes actives</h2></div><Link className="row-link" to="/operations/portfolio-risk/exposures">Zoom</Link></header><ExposureTable rows={view.exposures.slice(0, 8)}/></Card>
    <Card className="workspace-panel"><header className="panel-heading"><div><p className="eyebrow">Contrôles</p><h2>Verrous et sources</h2></div><Link className="row-link" to="/operations/portfolio-risk/controls">Zoom</Link></header><ControlTable rows={view.controls.slice(0, 8)}/></Card>
  </section>;
}

function PortfolioRiskSectionTable({ id, view }: { id: PortfolioRiskSection["id"]; view: ReturnType<typeof buildPortfolioRiskViewModel> }) {
  if (id === "accounts") return <Card className="workspace-panel"><AccountTable rows={view.accounts}/></Card>;
  if (id === "exposures") return <Card className="workspace-panel"><ExposureTable rows={view.exposures}/></Card>;
  if (id === "controls") return <Card className="workspace-panel"><ControlTable rows={view.controls}/></Card>;
  if (id === "strategy") return <Card className="workspace-panel"><StrategyTable rows={view.strategyRows}/></Card>;
  if (id === "intents") return <Card className="workspace-panel"><IntentTable rows={view.intentRows}/></Card>;
  return <Card className="workspace-panel"><ReconciliationTable rows={view.reconciliationRows}/></Card>;
}

function AccountTable({ rows }: { rows: ReturnType<typeof buildPortfolioRiskViewModel>["accounts"] }) {
  if (!rows.length) return <p className="empty-copy">Aucun compte broker n’est visible dans la projection réelle.</p>;
  return <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Compte</th><th>Mode</th><th>État</th><th>Capital</th><th>Risque</th><th>Contrôles</th></tr></thead><tbody>{rows.map(row => <tr key={row.key}><td><strong>{row.label}</strong><small>{row.key}</small></td><td>{row.mode}</td><td><StatusTag status={row.status}/></td><td>{row.capital}<small>{row.updated}</small></td><td>{row.risk}</td><td><small>{row.controls}</small></td></tr>)}</tbody></table></div>;
}

function ExposureTable({ rows }: { rows: ReturnType<typeof buildPortfolioRiskViewModel>["exposures"] }) {
  if (!rows.length) return <p className="empty-copy">Aucune exposition active ou intention en attente.</p>;
  return <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Instrument</th><th>Compte</th><th>État</th><th>Net</th><th>Pending</th><th>Détail</th></tr></thead><tbody>{rows.map(row => <tr key={row.key}><td><strong>{row.instrument}</strong></td><td>{row.account}</td><td><StatusTag status={row.status}/></td><td>{row.net}</td><td>{row.pending}</td><td><small>{row.detail}</small></td></tr>)}</tbody></table></div>;
}

function ControlTable({ rows }: { rows: ReturnType<typeof buildPortfolioRiskViewModel>["controls"] }) {
  if (!rows.length) return <p className="empty-copy">Aucun contrôle bloquant dans la projection courante.</p>;
  return <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Contrôle</th><th>Sévérité</th><th>Code</th><th>Détail</th></tr></thead><tbody>{rows.map(row => <tr key={row.key}><td><strong>{row.label}</strong></td><td><StatusTag status={row.severity}/></td><td>{row.code}</td><td><small>{row.detail}</small></td></tr>)}</tbody></table></div>;
}

function StrategyTable({ rows }: { rows: ReturnType<typeof buildPortfolioRiskViewModel>["strategyRows"] }) {
  if (!rows.length) return <p className="empty-copy">Aucune concentration stratégie n’est visible.</p>;
  return <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Instrument</th><th>Mode</th><th>État</th><th>Détail</th></tr></thead><tbody>{rows.map(row => <tr key={row.key}><td><strong>{row.instrument}</strong></td><td>{row.mode}</td><td><StatusTag status={row.status}/></td><td><small>{row.detail}</small></td></tr>)}</tbody></table></div>;
}

function IntentTable({ rows }: { rows: ReturnType<typeof buildPortfolioRiskViewModel>["intentRows"] }) {
  if (!rows.length) return <p className="empty-copy">Aucune intention d’ordre active.</p>;
  return <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Intention</th><th>Instrument</th><th>Compte</th><th>Sens</th><th>Qté</th><th>Expire</th></tr></thead><tbody>{rows.map(row => <tr key={row.key}><td><strong>{row.key}</strong><small>{row.status}</small></td><td>{row.instrument}</td><td>{row.account}</td><td>{row.side}</td><td>{row.quantity}</td><td>{row.expires}</td></tr>)}</tbody></table></div>;
}

function ReconciliationTable({ rows }: { rows: ReturnType<typeof buildPortfolioRiskViewModel>["reconciliationRows"] }) {
  if (!rows.length) return <p className="empty-copy">Aucune réconciliation récente.</p>;
  return <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Run</th><th>Compte</th><th>État</th><th>Écarts</th><th>Fin</th></tr></thead><tbody>{rows.map(row => <tr key={row.key}><td><strong>{row.key}</strong></td><td>{row.account}</td><td><StatusTag status={row.status}/></td><td>{row.mismatches}</td><td>{row.completed}</td></tr>)}</tbody></table></div>;
}
