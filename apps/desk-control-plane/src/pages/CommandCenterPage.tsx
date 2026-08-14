import { Link } from "react-router-dom";
import {
  FaBolt,
  FaChartLine,
  FaCheckCircle,
  FaClock,
  FaExclamationTriangle,
  FaFlask,
  FaShieldAlt
} from "react-icons/fa";
import { DataTable, MobileDataList } from "@/design-system/data";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView } from "@/domains/front-api/repositories";
import type { CommandCenterActivity } from "@/domains/front-api/viewModels";

export function CommandCenterPage() {
  const query = useFrontView("command-center");

  if (query.isLoading) {
    return <CommandCenterLoading />;
  }

  if (query.isError) {
    return (
      <Card title="Command Center indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucune donnée opérateur" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/command-center`.</p>
      </Card>
    );
  }

  const { data, meta } = query.data;

  return (
    <div className="operator-page command-center-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="Command Center"
        description="Santé globale, activité temps réel, risques et prochaines actions du desk."
        actions={
          <>
            <span className="operator-scope-label">Périmètre global</span>
            <button type="button" onClick={() => query.refetch()} disabled={query.isFetching}>{query.isFetching ? "Actualisation…" : "Actualiser"}</button>
            <Link className="operator-primary-action" to="/operations">Ouvrir les opérations</Link>
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs du Command Center">
        <KpiCard label="ÉTAT DU DESK" value={data.summary.deskStatus} delta={data.summary.deskStatus === "NOMINAL" ? "Aucune exception critique projetée" : "Exceptions à examiner"} tone={data.summary.deskStatus === "NOMINAL" ? "success" : "warning"} />
        <KpiCard label="STRATÉGIES ACTIVES" value={`${data.summary.activeStrategies}`} delta="Instances actives publiées par le backend" />
        <KpiCard label="TÂCHES AGENT" value={`${data.summary.activeResearchAgents}`} delta="Tâches runtime visibles" tone="info" />
        <KpiCard label="INCIDENTS CRITIQUES" value={`${data.summary.criticalIncidents}`} delta={data.summary.criticalIncidents ? "Intervention ou analyse requise" : "Aucun incident critique projeté"} tone={data.summary.criticalIncidents ? "danger" : "success"} />
        <KpiCard label="COMMANDES EN ATTENTE" value={`${data.summary.pendingCommands}`} delta={data.summary.pendingCommands ? "Commandes non terminales" : "Aucune commande en attente"} tone={data.summary.pendingCommands ? "warning" : "success"} />
        <KpiCard label="LATENCE DE PROJECTION" value={`${meta.latencyMs ?? 0} ms`} delta={`Schéma ${meta.schemaVersion} · ${meta.availability ?? (meta.stale ? "STALE" : "AVAILABLE")}`} tone={meta.stale ? "warning" : "info"} />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Supervision globale">
        <Card title="Santé des systèmes" actions={<InlineAction>Observabilité</InlineAction>} density="compact">
          <div className="system-health-list">
            {data.systems.map((system) => (
              <article key={system.id}>
                <span className={`system-health-icon system-health-icon--${system.status.toLowerCase()}`}>
                  {system.status === "OK" ? <FaCheckCircle /> : <FaExclamationTriangle />}
                </span>
                <div>
                  <strong>{system.label}</strong>
                  <small>{system.detail}</small>
                </div>
                <span>{system.latencyMs} ms</span>
                <StatusBadge tone={system.status === "OK" ? "success" : system.status === "DEGRADED" ? "warning" : "danger"}>
                  {system.status}
                </StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Activité & workflows" actions={<InlineAction>Voir tous les workflows</InlineAction>} density="compact">
          <DataTable rows={data.activity} rowKey={(row) => row.id} columns={activityColumns} />
          <MobileDataList
            rows={data.activity}
            rowKey={(row) => row.id}
            renderTitle={(row) => row.label}
            renderMeta={(row) => `${row.time} · ${row.domain} · ${row.duration}`}
            renderBody={(row) => <span>{row.detail} · <StatusBadge tone={row.state === "DONE" ? "success" : row.state === "WATCH" ? "warning" : "accent"}>{row.state}</StatusBadge></span>}
          />
        </Card>

        <Card title="Cockpit risque" actions={<InlineAction>Risk Center</InlineAction>} density="compact">
          <div className="risk-overview">
            <div className="risk-overview__headline">
              <span><FaShieldAlt /><small>CAPITAL PROTÉGÉ</small><strong>{data.risk.capitalStatus}</strong></span>
              <span><FaChartLine /><small>DRAWDOWN MAX</small><strong>{formatSignedR(data.risk.maxDrawdownR)}</strong></span>
            </div>
            <div className="risk-usage">
              <span><small>Budget de risque utilisé</small><strong>{formatPercent(data.risk.riskUsagePct)}</strong></span>
              <ProgressBar value={data.risk.riskUsagePct} tone="warning" />
            </div>
            <div className="risk-metric-grid">
              <MetricBox label="Positions ouvertes" value={`${data.risk.openPositions}`} />
              <MetricBox label="Limites saines" value={<span className="text-success">{data.risk.healthyLimits}/{data.risk.totalLimits}</span>} />
              <MetricBox label="Ordres non protégés" value={<span className="text-success">0</span>} />
              <MetricBox label="Alertes actives" value={<span className="text-warning">{data.risk.activeAlerts}</span>} />
            </div>
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Agenda et accès rapides">
        <Card title="Chaînes opérationnelles" actions={<InlineAction>Operations Hub</InlineAction>} density="compact">
          <div className="operating-lanes">
            {data.lanes.map((lane) => (
              <article key={lane.id}>
                <div><strong>{lane.label}</strong><small>{lane.detail}</small></div>
                <span>{lane.completed}/{lane.total}</span>
                <ProgressBar value={(lane.completed / lane.total) * 100} tone={lane.state === "WATCH" ? "warning" : "accent"} />
                <StatusBadge tone={lane.state === "WATCH" ? "warning" : "success"}>{lane.state}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Prochains événements" actions={<InlineAction>Agenda complet</InlineAction>} density="compact">
          <ol className="command-agenda">
            {data.upcoming.map((event) => (
              <li key={event.id}>
                <span><FaClock />{event.time}</span>
                <div><strong>{event.title}</strong><small>{event.detail}</small></div>
                <StatusBadge tone={event.tone === "HIGH" ? "danger" : event.tone === "WATCH" ? "warning" : "accent"}>{event.tone}</StatusBadge>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Accès rapides" actions={<InlineAction>Personnaliser</InlineAction>} density="compact">
          <div className="command-shortcuts">
            <Link to="/live"><FaBolt /><span><strong>Live Trading</strong><small>Signaux et décisions en cours</small></span></Link>
            <Link to="/research"><FaFlask /><span><strong>Research Lab</strong><small>Expériences et agents IA</small></span></Link>
            <Link to="/portfolio"><FaChartLine /><span><strong>Portefeuille</strong><small>Exposition et réconciliation</small></span></Link>
            <Link to="/execution/incidents"><FaExclamationTriangle /><span><strong>Incidents</strong><small>Alertes, retries et runbooks</small></span></Link>
          </div>
        </Card>
      </section>
    </div>
  );
}

const activityColumns = [
  { key: "time", header: "Heure", render: (row: CommandCenterActivity) => row.time },
  { key: "domain", header: "Domaine", render: (row: CommandCenterActivity) => row.domain },
  { key: "workflow", header: "Workflow", render: (row: CommandCenterActivity) => <strong>{row.label}</strong> },
  { key: "detail", header: "Dernier événement", render: (row: CommandCenterActivity) => row.detail },
  { key: "duration", header: "Durée", align: "right" as const, render: (row: CommandCenterActivity) => row.duration },
  { key: "state", header: "État", render: (row: CommandCenterActivity) => <StatusBadge tone={row.state === "DONE" ? "success" : row.state === "WATCH" ? "warning" : "accent"}>{row.state}</StatusBadge> }
] as const;

function CommandCenterLoading() {
  return (
    <div className="operator-page command-center-page">
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
      </section>
    </div>
  );
}

function formatSignedR(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2).replace(".", ",")} R`;
}

function formatPercent(value: number) {
  return `${value.toFixed(1).replace(".", ",")}%`;
}
