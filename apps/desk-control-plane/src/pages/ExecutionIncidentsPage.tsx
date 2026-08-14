import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FaBell,
  FaBug,
  FaCheckCircle,
  FaClipboardCheck,
  FaExclamationTriangle,
  FaFingerprint,
  FaHistory,
  FaLifeRing,
  FaProjectDiagram,
  FaRedoAlt,
  FaShieldAlt,
  FaSkullCrossbones,
  FaSyncAlt
} from "react-icons/fa";
import { DeskButton, ReasonInput } from "@/design-system/actions";
import { DataTable, MobileDataList } from "@/design-system/data";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted, SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";
import type { ExecutionIncidentsView } from "@/domains/front-api/viewModels";

type ExecutionIncident = ExecutionIncidentsView["incidents"][number];
type IncidentAction = ExecutionIncidentsView["commandActions"][number];
type ReconciliationResult = ExecutionIncidentsView["selectedIncident"]["reconciliationResults"][number];

export function ExecutionIncidentsPage() {
  const query = useFrontView("execution-incidents");
  const repository = useFrontViewRepository();
  const [reason, setReason] = useState("Contrôle opérateur : traitement incident via Command Runtime, sans action broker directe.");
  const [stepUpToken, setStepUpToken] = useState("");
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);

  if (query.isLoading) {
    return <ExecutionIncidentsLoading />;
  }

  if (query.isError) {
    return (
      <Card title="Incidents indisponibles" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucune donnée incidents" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/execution-incidents`.</p>
      </Card>
    );
  }

  const { data, meta } = query.data;
  const reconcileAction = data.commandActions.find((action) => action.commandType === "execution.incident.reconcile");
  const stepUpAction = data.commandActions.find((action) => action.permission === "STEP_UP_REQUIRED");

  const confirmAction = async (action: IncidentAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand(buildExecutionIncidentCommand(action, reason, stepUpToken));
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "EXECUTION_INCIDENT_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="operator-page execution-incidents-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="Execution Incidents"
        description={`Incidents, reconciliation et post-mortem · ${data.summary.openIncidents} ouverts · projection ${meta.latencyMs} ms · gate opérateur exceptionnel uniquement.`}
        actions={
          <>
            <Link to="/execution/providers">Providers</Link>
            <Link to="/orders">Orders</Link>
            <Link to="/events">Events</Link>
            {reconcileAction ? (
              <DeskButton variant="primary" disabled={isActionDisabled(reconcileAction, reason, stepUpToken)} onClick={() => confirmAction(reconcileAction)}>
                Reconcile
              </DeskButton>
            ) : null}
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs Execution Incidents">
        <KpiCard label="OUVERTS" value={`${data.summary.openIncidents}`} delta={`${data.summary.criticalIncidents} critical`} tone={data.summary.criticalIncidents > 0 ? "danger" : "warning"} />
        <KpiCard label="HIGH" value={`${data.summary.highIncidents}`} delta="sévérité max" tone={data.summary.highIncidents > 0 ? "danger" : "success"} />
        <KpiCard label="RECONCILE" value={`${data.summary.pendingReconciliations}`} delta="pending checks" tone="warning" />
        <KpiCard label="RETRYABLE" value={`${data.summary.retryableIncidents}`} delta={`âge moyen ${data.summary.avgAgeMinutes} min`} tone="info" />
        <KpiCard label="ORDRES TOUCHÉS" value={`${data.summary.impactedOrders}`} delta="provider/order path" tone="accent" />
        <KpiCard label="IMPACT R" value={formatSignedR(data.summary.impactR)} delta="calcul backend" detail={<ProgressBar value={Math.min(100, Math.abs(data.summary.impactR) * 1000)} tone="warning" />} tone="warning" />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Incidents, payload et réconciliation">
        <Card title="File incidents filtrable" actions={<InlineAction>{data.filters.searchHint}</InlineAction>} density="compact">
          <div className="incident-filter-strip">
            <StatusBadge tone="accent">Severity {data.filters.activeSeverity}</StatusBadge>
            <StatusBadge tone="accent">Domain {data.filters.activeDomain}</StatusBadge>
            {data.filters.statuses.map((status) => <StatusBadge key={status} tone={statusTone(status)}>{status}</StatusBadge>)}
          </div>
          <DataTable rows={data.incidents} rowKey={(row) => row.incidentId} columns={incidentColumns} />
          <MobileDataList
            rows={data.incidents}
            rowKey={(row) => row.incidentId}
            renderTitle={(row) => `${row.title} · ${row.severity}`}
            renderMeta={(row) => `${row.domain} · ${row.status} · ${row.correlationId}`}
            renderBody={(row) => `${row.impactSummary} · retry ${row.retryCount} · gate ${row.operatorGate}`}
          />
        </Card>

        <Card title="Payload, meta & impact" actions={<InlineAction>{data.selectedIncident.incidentId}</InlineAction>} density="compact">
          <div className="incident-payload-grid">
            {data.selectedIncident.payloadPreview.map((item) => (
              <MetricBox key={item.key} label={item.key} value={item.value} />
            ))}
          </div>
          <div className="incident-meta-list">
            {data.selectedIncident.meta.map((item) => (
              <article key={item.label}>
                <FaClipboardCheck />
                <div><strong>{item.label}</strong><small>{item.value}</small></div>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Reconciliation results" actions={<InlineAction>Backend checks</InlineAction>} density="compact">
          <div className="incident-reconcile-list">
            {data.selectedIncident.reconciliationResults.map((result) => (
              <article key={result.resultId} className={`incident-reconcile-list__${result.status.toLowerCase()}`}>
                <FaSyncAlt />
                <div><strong>{result.label}</strong><small>Expected {result.expected} · Actual {result.actual}</small></div>
                <StatusBadge tone={reconciliationTone(result)}>{result.status}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="incident-reconcile-proof">
            <FaShieldAlt />
            <span>Le front affiche les résultats officiels. Il ne réconcilie pas localement orders, fills ou positions.</span>
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Chronologie, retries et actions">
        <Card title="Chronologie zoom incident" actions={<InlineAction>Drill-down</InlineAction>} density="compact">
          <ol className="incident-chronology-list">
            {data.selectedIncident.chronology.map((step) => (
              <li key={step.stepId}>
                <span>{formatTime(step.at)}</span>
                <div><strong>{step.title}</strong><small>{step.detail}{step.eventId ? ` · ${step.eventId}` : ""}</small></div>
                <StatusBadge tone={step.state === "DONE" ? "success" : step.state === "FAILED" ? "danger" : "warning"}>{step.state}</StatusBadge>
              </li>
            ))}
          </ol>
          <div className="incident-postmortem">
            <FaProjectDiagram />
            <div>
              <strong>Post-mortem</strong>
              <small>{data.selectedIncident.postMortem.rootCause} · {data.selectedIncident.postMortem.permanentFix}</small>
            </div>
          </div>
        </Card>

        <Card title="Retries & dead letters" actions={<InlineAction>{data.retries.length} retries</InlineAction>} density="compact">
          <div className="incident-retry-list">
            {data.retries.map((retry) => (
              <article key={retry.retryId}>
                <FaRedoAlt />
                <div><strong>{retry.retryId}</strong><small>{retry.incidentId} · attempt {retry.attempt} · backoff {retry.backoffSeconds}s</small></div>
                <span>{retry.nextRunAt ? formatTime(retry.nextRunAt) : retry.lastErrorCode ?? "—"}</span>
                <StatusBadge tone={retry.state === "SUCCEEDED" ? "success" : retry.state === "ABANDONED" || retry.state === "FAILED" ? "danger" : "warning"}>{retry.state}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="incident-escalation-proof">
            <FaLifeRing />
            <span>L’humain intervient comme gate exceptionnel ; aucun champ d’assignation quotidienne n’est exposé.</span>
          </div>
        </Card>

        <Card title="Actions incidents" actions={<InlineAction>Command Runtime</InlineAction>} density="compact">
          <div className="incident-command-result">
            <FaFingerprint />
            <div>
              <small>Dernière commande incident</small>
              <strong>{command ? `ACCEPTED · ${command.commandId}` : "Aucune commande confirmée"}</strong>
              {commandError ? <span className="text-danger">{commandError}</span> : null}
            </div>
          </div>
          <ReasonInput label="Reason obligatoire" value={reason} onChange={setReason} />
          <label className="incident-step-up">
            <span>Step-up phrase pour resolve/suspend</span>
            <input value={stepUpToken} onChange={(event) => setStepUpToken(event.target.value)} placeholder={stepUpAction?.actionId ?? "actionId step-up"} />
          </label>
          <div className="incident-action-list">
            {data.commandActions.map((action) => (
              <article key={action.actionId} className={action.criticality === "EMERGENCY" ? "incident-action-list__emergency" : undefined}>
                <span>{actionIcon(action)}</span>
                <div><strong>{action.label}</strong><small>{action.commandType} · {action.impactSummary}</small></div>
                <StatusBadge tone={permissionTone(action.permission)}>{action.permission}</StatusBadge>
                <DeskButton
                  variant={action.criticality === "EMERGENCY" ? "emergency" : action.criticality === "HIGH" ? "danger" : "primary"}
                  disabled={isActionDisabled(action, reason, stepUpToken) || submittingActionId === action.actionId}
                  onClick={() => confirmAction(action)}
                >
                  {submittingActionId === action.actionId ? "Envoi..." : "Confirmer"}
                </DeskButton>
              </article>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}

export function buildExecutionIncidentCommand(action: IncidentAction, reason: string, stepUpToken = ""): SubmitDeskCommandInput {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw Object.assign(new Error("EXECUTION_INCIDENT_REASON_REQUIRED"), { code: "EXECUTION_INCIDENT_REASON_REQUIRED" });
  }

  if (action.permission === "DENIED") {
    throw Object.assign(new Error("EXECUTION_INCIDENT_PERMISSION_DENIED"), { code: "EXECUTION_INCIDENT_PERMISSION_DENIED" });
  }

  if (action.permission === "STEP_UP_REQUIRED" && stepUpToken.trim() !== action.actionId) {
    throw Object.assign(new Error("EXECUTION_INCIDENT_STEP_UP_REQUIRED"), { code: "EXECUTION_INCIDENT_STEP_UP_REQUIRED" });
  }

  return {
    commandType: action.commandType,
    environment: "MOCK",
    expectedVersion: action.expectedVersion,
    reason: normalizedReason,
    payload: {
      actionId: action.actionId,
      incidentId: action.incidentId,
      criticality: action.criticality,
      impactSummary: action.impactSummary,
      stepUpAccepted: action.permission === "STEP_UP_REQUIRED",
      ...action.payload
    }
  };
}

const incidentColumns = [
  { key: "incident", header: "Incident", render: (row: ExecutionIncident) => <IncidentCell row={row} /> },
  { key: "severity", header: "Sev", render: (row: ExecutionIncident) => <StatusBadge tone={severityTone(row.severity)}>{row.severity}</StatusBadge> },
  { key: "domain", header: "Domain", render: (row: ExecutionIncident) => row.domain },
  { key: "status", header: "Status", render: (row: ExecutionIncident) => <StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge> },
  { key: "impact", header: "Impact", align: "right" as const, render: (row: ExecutionIncident) => formatSignedR(row.impactR) },
  { key: "gate", header: "Gate", render: (row: ExecutionIncident) => row.operatorGate }
] as const;

function IncidentCell({ row }: { row: ExecutionIncident }) {
  return (
    <div className="incident-cell">
      <strong><Link to={`/operations/incidents/${encodeURIComponent(row.incidentId)}`}>{row.title}</Link></strong>
      <small>{row.incidentId} · {row.providerId ?? row.strategyInstanceId ?? "system"} · {formatTime(row.openedAt)}</small>
    </div>
  );
}

function ExecutionIncidentsLoading() {
  return (
    <div className="operator-page execution-incidents-page">
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
      </section>
    </div>
  );
}

function isActionDisabled(action: IncidentAction, reason: string, stepUpToken: string) {
  if (action.permission === "DENIED") return true;
  if (!reason.trim()) return true;
  if (action.permission === "STEP_UP_REQUIRED" && stepUpToken.trim() !== action.actionId) return true;
  return false;
}

function actionIcon(action: IncidentAction) {
  if (action.commandType.includes("acknowledge")) return <FaBell />;
  if (action.commandType.includes("reconcile")) return <FaSyncAlt />;
  if (action.commandType.includes("resolve")) return <FaCheckCircle />;
  if (action.commandType.includes("escalate")) return <FaExclamationTriangle />;
  if (action.commandType.includes("suspend")) return <FaShieldAlt />;
  if (action.commandType.includes("emergency")) return <FaSkullCrossbones />;
  return <FaBug />;
}

function severityTone(severity: ExecutionIncident["severity"]) {
  if (severity === "CRITICAL" || severity === "HIGH") return "danger" as const;
  if (severity === "MEDIUM") return "warning" as const;
  return "accent" as const;
}

function statusTone(status: ExecutionIncident["status"] | ExecutionIncidentsView["filters"]["statuses"][number]) {
  if (status === "RESOLVED") return "success" as const;
  if (status === "DLQ" || status === "ESCALATED") return "danger" as const;
  if (status === "RECONCILING" || status === "RETRYING") return "warning" as const;
  return "accent" as const;
}

function reconciliationTone(result: ReconciliationResult) {
  if (result.status === "MATCH" || result.status === "REPAIRED") return "success" as const;
  if (result.status === "DELTA") return "warning" as const;
  return "danger" as const;
}

function permissionTone(permission: IncidentAction["permission"]) {
  if (permission === "ALLOWED") return "success" as const;
  if (permission === "STEP_UP_REQUIRED") return "warning" as const;
  return "danger" as const;
}

function formatSignedR(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2).replace(".", ",")} R`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}
