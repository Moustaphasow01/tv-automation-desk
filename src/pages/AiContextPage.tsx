import { Link } from "react-router-dom";
import { Card, DataSourceBadge, ErrorView, Icon, LoadingView } from "@/components/common";
import { Breadcrumbs, MetricCard, MetricStrip, PageHeading, PageTabs, StatusTag } from "@/components/operations";
import { useAiContextOverview } from "@/features/ai-context/dataAccess";
import { buildAiContextViewModel, type AiContextDecisionRow, type AiContextMetricRow } from "@/features/ai-context/viewModel";

const operationsTabs = [
  { label: "Cockpit", to: "/operations", end: true },
  { label: "Agents IA", to: "/operations/agents" },
  { label: "AI Context", to: "/operations/ai-context" },
  { label: "Files GPT", to: "/operations/claim-lanes" },
  { label: "Portfolio Risk", to: "/operations/portfolio-risk" },
  { label: "Exécution", to: "/operations/execution" },
  { label: "Observabilité", to: "/operations/observability" },
  { label: "Incidents", to: "/operations/incidents" },
  { label: "Notifications", to: "/operations/notifications" },
  { label: "Runbooks", to: "/operations/runbooks" },
];

export default function AiContextPage() {
  const query = useAiContextOverview();
  if (query.isLoading) return <LoadingView title="Chargement AI Context" message="Lecture des tâches CONTEXT_DECISION depuis l’agent-runtime réel." source="POSTGRES + API"/>;
  if (query.isError || !query.data) return <ErrorView title="AI Context indisponible" message={query.error?.message || "API indisponible"} retry={() => query.refetch()}/>;
  const view = buildAiContextViewModel(query.data);
  return <section className="view workspace-view ai-context-page">
    <Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: "AI Context", to: "/operations/ai-context" }]}/>
    <PageHeading
      eyebrow="AI Context Gate"
      title="Décisions contextuelles"
      subtitle="Avis IA consultatifs, fallbacks, contraintes validées et preuves visibles sans accès direct à l’exécution."
      backTo="/operations"
      actions={<><DataSourceBadge label={view.sourceLabel} detail={view.sourceDetail}/><button className="secondary-btn" onClick={() => query.refetch()}><Icon name="refresh" size={14}/>Actualiser</button></>}
      tabs={<PageTabs items={operationsTabs}/>}
    />
    <MetricStrip className="metric-strip--six">{view.metrics.map(metric => <MetricCard key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} tone={metric.tone}/>)}</MetricStrip>
    <AiContextWarnings view={view}/>
    <section className="agent-runtime-layout">
      <Card className="workspace-panel">
        <header className="panel-heading"><div><p className="eyebrow">Décisions</p><h2>Advisory ledger</h2></div><StatusTag status={view.health.tone}/></header>
        <DecisionTable rows={view.decisionRows}/>
      </Card>
      <Card className="workspace-panel">
        <header className="panel-heading"><div><p className="eyebrow">Preuves</p><h2>Contrôles et sources</h2></div><span>{view.controls.length}</span></header>
        {!view.controls.length ? <p className="empty-copy">Aucun contrôle AI Context à afficher.</p> : <ul className="terminal-list">{view.controls.map(control => <li key={`${control.code}-${control.label}`}>
          <span><strong>{control.label}</strong><small>{control.code} · {control.detail}</small></span><StatusTag status={control.severity}/>
        </li>)}</ul>}
      </Card>
    </section>
    <Card className="workspace-panel">
      <header className="panel-heading"><div><p className="eyebrow">Runtime</p><h2>Coût, latence et modèle</h2></div><Link className="row-link" to="/operations/agents">Ouvrir Agents IA</Link></header>
      <MetricTable rows={view.metricRows}/>
    </Card>
  </section>;
}

function AiContextWarnings({ view }: { view: ReturnType<typeof buildAiContextViewModel> }) {
  if (!view.warnings.length) return null;
  return <Card className="workspace-panel">
    <header className="panel-heading"><div><p className="eyebrow">Lecture opérateur</p><h2>Points de vigilance</h2></div><StatusTag status={view.health.tone}/></header>
    <ul className="terminal-list">{view.warnings.map(item => <li key={item}><span><strong>{item}</strong><small>{view.generatedAt}</small></span></li>)}</ul>
  </Card>;
}

function DecisionTable({ rows }: { rows: AiContextDecisionRow[] }) {
  if (!rows.length) return <p className="empty-copy">Aucune décision AI Context réelle n’est visible dans la base pour le moment.</p>;
  return <div className="data-table-wrap"><table className="data-table">
    <thead><tr><th>Tâche</th><th>Mode</th><th>Reco</th><th>Effet portfolio</th><th>Fallback</th><th>Explication</th><th>Modèle</th><th>Latence</th><th>MAJ</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.key}>
      <td><strong>{row.task}</strong></td><td>{row.mode}</td><td><StatusTag status={row.tone}/><small>{row.recommendation}</small></td><td>{row.binding}</td><td>{row.fallback}</td><td><small>{row.rationale}</small></td><td>{row.model}</td><td>{row.latency}</td><td>{row.updated}</td>
    </tr>)}</tbody>
  </table></div>;
}

function MetricTable({ rows }: { rows: AiContextMetricRow[] }) {
  if (!rows.length) return <p className="empty-copy">Aucune métrique CONTEXT_DECISION récente.</p>;
  return <div className="data-table-wrap"><table className="data-table">
    <thead><tr><th>Tâche</th><th>Outcome</th><th>Modèle</th><th>Latence</th><th>Tokens</th><th>Coût</th><th>Fin</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.key}>
      <td><strong>{row.task}</strong></td><td><StatusTag status={row.tone}/><small>{row.outcome}</small></td><td>{row.model}</td><td>{row.latency}</td><td>{row.tokens}</td><td>{row.cost}</td><td>{row.finished}</td>
    </tr>)}</tbody>
  </table></div>;
}
