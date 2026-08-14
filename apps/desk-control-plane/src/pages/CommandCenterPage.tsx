import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FaBolt,
  FaChartLine,
  FaCheckCircle,
  FaClock,
  FaExclamationTriangle,
  FaFlask,
  FaPlay,
  FaRedo,
  FaShieldAlt,
  FaStethoscope,
  FaStop,
  FaSyncAlt
} from "react-icons/fa";
import { DataTable, MobileDataList } from "@/design-system/data";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useCapabilityCatalog, useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandSnapshot } from "@/domains/realtime/commandRuntime";
import type { CommandCenterActivity } from "@/domains/front-api/viewModels";

export function CommandCenterPage() {
  const query = useFrontView("command-center");
  const capabilityCatalog = useCapabilityCatalog();
  const repository = useFrontViewRepository();
  const [submittingCommand, setSubmittingCommand] = useState<DeskControlCommand | null>(null);
  const [lastCommand, setLastCommand] = useState<CommandSnapshot | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);

  const submitDeskControl = async (commandType: DeskControlCommand) => {
    setSubmittingCommand(commandType);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand({
        commandType,
        environment: "PAPER",
        reason: deskControlReason(commandType),
        payload: { source: "command-center", requestedMode: "semi_manual_paper" }
      });
      const terminal = await repository.getCommand(accepted.commandId).catch(() => null);
      setLastCommand(terminal ?? { ...accepted, updatedAt: accepted.acceptedAt });
      await Promise.all([query.refetch(), capabilityCatalog.refetch()]);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "DESK_CONTROL_COMMAND_FAILED");
    } finally {
      setSubmittingCommand(null);
    }
  };

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

      <DeskColdStartPanel
        actions={capabilityCatalog.data?.actions ?? []}
        disabled={capabilityCatalog.isLoading || capabilityCatalog.isError}
        submittingCommand={submittingCommand}
        lastCommand={lastCommand}
        error={commandError}
        onSubmit={submitDeskControl}
      />

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

type DeskControlCommand = "desk.status" | "desk.doctor" | "desk.start" | "desk.stop" | "desk.restart";

type DeskControlCapability = {
  commandType: string;
  allowed: boolean;
  brokerExecution: boolean;
};

const DESK_CONTROL_ACTIONS: readonly {
  commandType: DeskControlCommand;
  label: string;
  detail: string;
  icon: JSX.Element;
  tone: "neutral" | "accent" | "warning" | "danger";
}[] = [
  { commandType: "desk.status", label: "Status", detail: "Lire l’état opérationnel", icon: <FaSyncAlt />, tone: "accent" },
  { commandType: "desk.doctor", label: "Doctor", detail: "Diagnostiquer blockers", icon: <FaStethoscope />, tone: "neutral" },
  { commandType: "desk.start", label: "Start plan", detail: "Préparer le démarrage", icon: <FaPlay />, tone: "accent" },
  { commandType: "desk.stop", label: "Stop plan", detail: "Planifier l’arrêt sûr", icon: <FaStop />, tone: "warning" },
  { commandType: "desk.restart", label: "Restart plan", detail: "Planifier un restart", icon: <FaRedo />, tone: "warning" }
];

function DeskColdStartPanel({
  actions,
  disabled,
  submittingCommand,
  lastCommand,
  error,
  onSubmit
}: {
  actions: readonly DeskControlCapability[];
  disabled: boolean;
  submittingCommand: DeskControlCommand | null;
  lastCommand: CommandSnapshot | null;
  error: string | null;
  onSubmit(commandType: DeskControlCommand): void;
}) {
  const result = operationalMutationResult(lastCommand?.result);
  const state = stringFromPath(result, ["state", "state"]) || "—";
  const outcome = stringFromPath(result, ["plan", "outcome"]) || lastCommand?.status || "En attente";
  const blockers = arrayLengthFromPath(result, ["state", "blockers"]);
  const warnings = arrayLengthFromPath(result, ["state", "warnings"]);

  return (
    <Card
      title="Contrôle du desk"
      eyebrow="Cold start fail-closed"
      density="compact"
      tone={error ? "danger" : state === "PAPER_READY" ? "success" : state === "DEGRADED" ? "warning" : "neutral"}
      actions={<StatusBadge tone={state === "PAPER_READY" ? "success" : state === "FAILED" ? "danger" : "warning"}>{state}</StatusBadge>}
    >
      <div className="desk-control-panel">
        <div className="desk-control-panel__actions">
          {DESK_CONTROL_ACTIONS.map((action) => {
            const capability = actions.find((item) => item.commandType === action.commandType);
            const allowed = capability?.allowed === true && capability.brokerExecution === false;
            const busy = submittingCommand === action.commandType;
            return (
              <button
                key={action.commandType}
                type="button"
                className={`desk-control-action desk-control-action--${action.tone}`}
                disabled={disabled || !allowed || Boolean(submittingCommand)}
                onClick={() => onSubmit(action.commandType)}
              >
                <span>{busy ? <FaClock /> : action.icon}</span>
                <strong>{busy ? "Envoi…" : action.label}</strong>
                <small>{action.detail}</small>
              </button>
            );
          })}
        </div>
        <div className="desk-control-panel__result">
          <MetricBox label="Dernière commande" value={lastCommand?.commandId ?? "—"} />
          <MetricBox label="Résultat" value={outcome} />
          <MetricBox label="Blockers" value={String(blockers)} />
          <MetricBox label="Warnings" value={String(warnings)} />
          {error ? <p className="desk-control-panel__error">{error}</p> : null}
          {result ? <small>Broker/live/auto restent fermés par contrat control-plane.</small> : <small>Les commandes sont publiées par le BFF selon les capabilities réelles.</small>}
        </div>
      </div>
    </Card>
  );
}

function deskControlReason(commandType: DeskControlCommand) {
  const label = DESK_CONTROL_ACTIONS.find((item) => item.commandType === commandType)?.label || commandType;
  return `Operator requested ${label} from VNext Command Center; broker/live/auto execution must remain fail-closed.`;
}

function operationalMutationResult(result: unknown): Record<string, unknown> | null {
  if (!isRecord(result)) return null;
  const mutation = result.mutation_result;
  if (isRecord(mutation)) return mutation;
  return isRecord(result.state) ? result : null;
}

function stringFromPath(source: Record<string, unknown> | null, path: readonly string[]) {
  const value = valueFromPath(source, path);
  return typeof value === "string" ? value : "";
}

function arrayLengthFromPath(source: Record<string, unknown> | null, path: readonly string[]) {
  const value = valueFromPath(source, path);
  return Array.isArray(value) ? value.length : 0;
}

function valueFromPath(source: Record<string, unknown> | null, path: readonly string[]) {
  return path.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), source);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
