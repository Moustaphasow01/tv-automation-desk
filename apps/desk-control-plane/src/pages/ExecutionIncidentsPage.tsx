import { useContext, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { routeDisplayName } from "@/app/routes";
import {
  FaBell,
  FaBug,
  FaCheckCircle,
  FaClipboardCheck,
  FaExclamationTriangle,
  FaFingerprint,
  FaLifeRing,
  FaProjectDiagram,
  FaRedoAlt,
  FaShieldAlt,
  FaSkullCrossbones,
  FaSyncAlt
} from "react-icons/fa";
import { DeskButton, ReasonInput } from "@/design-system/actions";
import { StatusBadge } from "@/design-system/primitives";
import {
  presentChronologyState,
  presentIncidentDomain,
  presentIncidentStatus,
  presentOperatorGate,
  presentPermission,
  presentReconciliationStatus,
  presentRetryState,
  presentSeverity
} from "@/design-system/labels";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted, SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";
import type { ExecutionIncidentsView } from "@/domains/front-api/viewModels";
import "@/features/incidents-operations/incidents-operations.css";

type ExecutionIncident = ExecutionIncidentsView["incidents"][number];
type IncidentAction = ExecutionIncidentsView["commandActions"][number];

const SEVERITY_COLORS: Record<string, string> = { HIGH: "var(--io-red)", MEDIUM: "var(--io-amber)", LOW: "var(--io-cyan)" };

export function ExecutionIncidentsPage() {
  const realtime = useContext(RealtimeContext);
  const query = useFrontView("execution-incidents");
  const observabilityQuery = useFrontView("operations-observability");
  const runbooksQuery = useFrontView("operations-runbooks");
  const repository = useFrontViewRepository();
  const [reason, setReason] = useState("Contrôle opérateur : traitement incident via le flux de commande, sans action broker directe.");
  const [stepUpToken, setStepUpToken] = useState("");
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);

  const data = query.data?.data ?? null;
  const selected = data?.selectedIncident ?? null;
  const severityBreakdown = useMemo(() => {
    if (!data) return [];
    const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<string, number>;
    data.incidents.forEach((item) => { counts[item.severity] = (counts[item.severity] ?? 0) + 1; });
    const total = data.incidents.length || 1;
    return (["HIGH", "MEDIUM", "LOW"] as const).map((key) => ({ key, count: counts[key] ?? 0, pct: (counts[key] ?? 0) / total }));
  }, [data]);

  if (query.isLoading) return <IncidentsLoading />;
  if (query.isError) return <div className="io-page"><h1 className="sr-only">Incidents &amp; Opérations</h1><div className="io-workspace"><p className="io-empty">La projection des incidents ne répond pas. Réessayez dans quelques instants.</p></div></div>;
  if (!data || !selected) return <div className="io-page"><h1 className="sr-only">Incidents &amp; Opérations</h1><div className="io-workspace"><p className="io-empty">Le BFF ne retourne pas encore la projection `/views/execution-incidents`.</p></div></div>;

  const reconcileAction = data.commandActions.find((action) => action.commandType === "execution.incident.reconcile");
  const workers = observabilityQuery.data?.data.workers
    ? observabilityQuery.data.data.workers.map((worker) => ({
        workerId: worker.workerId,
        role: worker.model,
        currentTask: worker.task,
        status: worker.status,
        lastHeartbeatAt: worker.lastSeenAt
      }))
    : (data.workers ?? []);
  const workerSummary = observabilityQuery.data?.data.workerSummary;
  const activeWorkers = workerSummary?.active ?? data.workersSummary?.active ?? workers.filter((worker) => worker.status === "ACTIVE").length;
  const registeredWorkers = workerSummary?.registered ?? data.workersSummary?.total ?? workers.length;
  const runbooks = runbooksQuery.data?.data.items ?? [];

  const confirmAction = async (action: IncidentAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand(buildExecutionIncidentCommand(action, reason, stepUpToken));
      setCommand(accepted);
    } catch (error) {
      setCommandError("La commande n'a pas abouti. Aucun changement n'a été appliqué.");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="io-page" data-testid="incidents-operations-golden-master">
      <header className="io-header">
        <div className="io-header__title">
          <h1>{routeDisplayName("execution/incidents")}</h1>
          <p>Incidents, réconciliation &amp; post-mortem</p>
        </div>
        <div className="io-header__clock">
          <strong>{formatClock(realtime?.now)}</strong>
          <small>{formatClockDate(realtime?.now)}</small>
        </div>
        <Link to="/execution/providers">Fournisseurs</Link>
        <Link to="/orders">Ordres</Link>
        {reconcileAction ? (
          <DeskButton variant="primary" disabled={isActionDisabled(reconcileAction, reason, stepUpToken) || submittingActionId === reconcileAction.actionId} onClick={() => confirmAction(reconcileAction)}>
            {submittingActionId === reconcileAction.actionId ? "Envoi..." : "Réconcilier"}
          </DeskButton>
        ) : null}
      </header>

      <div className="io-workspace">
        <section className="io-kpi-strip" aria-label="Indicateurs Incidents & Opérations">
          <KpiCell label="Ouverts" value={String(data.summary.openIncidents)} tone={data.summary.openIncidents > 0 ? "warn" : undefined} />
          <KpiCell label="Critiques" value={String(data.summary.criticalIncidents)} tone={data.summary.criticalIncidents > 0 ? "danger" : undefined} />
          <KpiCell label="Élevés" value={String(data.summary.highIncidents)} />
          <KpiCell label="Réconciliations" value={String(data.summary.pendingReconciliations)} detail="en attente" />
          <KpiCell label="Réessayables" value={String(data.summary.retryableIncidents)} />
          <KpiCell label="Âge moyen" value={`${Math.round(data.summary.avgAgeMinutes || 0)} min`} />
          <KpiCell label="Ordres touchés" value={String(data.summary.impactedOrders)} />
          <KpiCell label="Impact R" value={formatSignedR(data.summary.impactR)} />
        </section>

        <div className="io-row1">
          <section className="io-panel" aria-label="File incidents">
            <header><h2>File incidents</h2><small>{data.incidents.length}</small></header>
            <div className="io-filter-strip">
              <StatusBadge tone="accent">Sévérité {data.filters.activeSeverity === "ALL" ? "Toutes" : presentSeverity(data.filters.activeSeverity).label}</StatusBadge>
              <StatusBadge tone="accent">Domaine {data.filters.activeDomain === "ALL" ? "Tous" : presentIncidentDomain(data.filters.activeDomain).label}</StatusBadge>
            </div>
            <div className="io-panel__body" style={{ padding: "8px 12px" }}>
              <div className="io-table-scroll">
                <table className="io-table">
                  <thead><tr><th>Incident</th><th>Sév.</th><th>Statut</th><th>Impact</th></tr></thead>
                  <tbody>
                    {data.incidents.map((incident, index) => (
                      <tr key={`${incident.incidentId}-${index}`} aria-selected={selected.incidentId === incident.incidentId}>
                        <td><strong>{incident.title}</strong><br /><small style={{ color: "var(--io-muted)" }}>{formatTime(incident.openedAt)}</small></td>
                        <td><StatusBadge tone={severityTone(incident.severity)}>{presentSeverity(incident.severity).label}</StatusBadge></td>
                        <td><StatusBadge tone={statusTone(incident.status)}>{presentIncidentStatus(incident.status).label}</StatusBadge></td>
                        <td>{formatSignedR(incident.impactR)}</td>
                      </tr>
                    ))}
                    {!data.incidents.length ? <tr><td colSpan={4}><p className="io-empty">Aucun incident ouvert.</p></td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="io-panel" aria-label="Incidents par sévérité">
            <header><h2>Par sévérité</h2></header>
            <div className="io-panel__body">
              <SeverityDonut breakdown={severityBreakdown} />
              <div className="io-detail-grid" style={{ marginTop: 10 }}>
                <div><small>Payload sélection</small></div>
              </div>
              {selected.payloadPreview.map((item, index) => (
                <div key={`${item.key}-${index}`} className="io-detail-grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 4 }}>
                  <div><small>{item.key}</small><strong style={{ fontSize: 11.5 }}>{item.value}</strong></div>
                </div>
              ))}
            </div>
          </section>

          <section className="io-panel" aria-label="Réconciliation">
            <header><h2>Réconciliation</h2><small>{selected.reconciliationResults.length}</small></header>
            <div className="io-panel__body">
              <div className="io-reconcile-list">
                {selected.reconciliationResults.map((result, index) => (
                  <article key={`${result.resultId}-${index}`}>
                    <FaSyncAlt />
                    <div><strong>{result.label}</strong><small>Attendu {result.expected} · Réel {result.actual}</small></div>
                    <StatusBadge tone={reconciliationTone(result.status)}>{presentReconciliationStatus(result.status).label}</StatusBadge>
                  </article>
                ))}
                {!selected.reconciliationResults.length ? <p className="io-empty">Aucun résultat de réconciliation publié.</p> : null}
              </div>
              <div className="io-postmortem">
                <FaShieldAlt />
                <span>Le front affiche les résultats officiels. Il ne réconcilie pas localement ordres, exécutions ou positions.</span>
              </div>
            </div>
          </section>
        </div>

        <div className="io-row2">
          <section className="io-panel" aria-label="Chronologie incident">
            <header><h2>Chronologie</h2><small>{selected.incidentId}</small></header>
            <div className="io-panel__body">
              {selected.chronology.length ? <ol className="io-chronology">
                {selected.chronology.map((step, index) => (
                  <li key={`${step.stepId}-${index}`}>
                    <span>{formatTime(step.at)}</span>
                    <div><strong>{step.title}</strong><small>{step.detail}</small></div>
                    <StatusBadge tone={step.state === "DONE" ? "success" : step.state === "FAILED" ? "danger" : "warning"}>{presentChronologyState(step.state).label}</StatusBadge>
                  </li>
                ))}
              </ol> : <p className="io-empty">Aucune chronologie publiée.</p>}
              <div className="io-postmortem">
                <FaProjectDiagram />
                <div><strong>Post-mortem</strong><br /><small>{selected.postMortem.rootCause} · {selected.postMortem.permanentFix}</small></div>
              </div>
            </div>
          </section>

          <section className="io-panel" aria-label="Tentatives & DLQ">
            <header><h2>Tentatives &amp; DLQ</h2><small>{data.retries.length}</small></header>
            <div className="io-panel__body">
              <div className="io-retry-list">
                {data.retries.map((retry, index) => (
                  <article key={`${retry.retryId}-${index}`}>
                    <FaRedoAlt />
                    <div><strong>{retry.retryId}</strong><small>tentative {retry.attempt} · backoff {retry.backoffSeconds}s</small></div>
                    <StatusBadge tone={retry.state === "SUCCEEDED" ? "success" : retry.state === "ABANDONED" || retry.state === "FAILED" ? "danger" : "warning"}>{presentRetryState(retry.state).label}</StatusBadge>
                  </article>
                ))}
                {!data.retries.length ? <p className="io-empty">Aucune tentative publiée.</p> : null}
              </div>
              <div className="io-postmortem">
                <FaLifeRing />
                <span>L'humain intervient comme gate exceptionnel ; aucune assignation quotidienne n'est exposée.</span>
              </div>
            </div>
          </section>

          <section className="io-panel" aria-label="Actions incidents">
            <header><h2>Actions</h2></header>
            <div className="io-panel__body">
              <div className="io-command-result">
                <FaFingerprint />
                <div>
                  <small>Dernière commande</small>
                  <strong>{command ? `Acceptée · ${command.commandId}` : "Aucune commande confirmée"}</strong>
                  {commandError ? <div style={{ color: "var(--io-red)" }}>{commandError}</div> : null}
                </div>
              </div>
              <ReasonInput label="Motif obligatoire" value={reason} onChange={setReason} />
              <label className="io-step-up">
                <span>Step-up pour resolve/suspend</span>
                <input value={stepUpToken} onChange={(event) => setStepUpToken(event.target.value)} placeholder="actionId step-up" />
              </label>
              <div className="io-action-list" style={{ marginTop: 8 }}>
                {data.commandActions.map((action, index) => (
                  <article key={`${action.actionId}-${index}`} className={action.criticality === "EMERGENCY" ? "io-action-list__emergency" : undefined}>
                    <span>{actionIcon(action)}</span>
                    <div><strong>{action.label}</strong><small>{action.impactSummary}</small></div>
                    <StatusBadge tone={permissionTone(action.permission)}>{presentPermission(action.permission).label}</StatusBadge>
                    <button type="button" disabled={isActionDisabled(action, reason, stepUpToken) || submittingActionId === action.actionId} onClick={() => confirmAction(action)}>
                      {submittingActionId === action.actionId ? "Envoi..." : "Confirmer"}
                    </button>
                  </article>
                ))}
                {!data.commandActions.length ? <p className="io-empty">Aucune action commande publiée.</p> : null}
              </div>
            </div>
          </section>
        </div>

        <div className="io-row3">
          <section className="io-panel" aria-label="Statut des workers">
            <header><h2>Workers</h2><small>{activeWorkers} actifs / {registeredWorkers}</small></header>
            <div className="io-panel__body" style={{ padding: 0 }}>
              <table className="io-table">
                <thead><tr><th>Worker</th><th>Rôle</th><th>Tâche</th><th>Statut</th><th>Dernier heartbeat</th></tr></thead>
                <tbody>
                  {workers.map((worker, index) => (
                    <tr key={`${worker.workerId}-${index}`}>
                      <td><strong>{worker.workerId}</strong></td>
                      <td>{worker.role}</td>
                      <td>{worker.currentTask || "—"}</td>
                      <td><StatusBadge tone={worker.status === "ACTIVE" ? "success" : worker.status === "FAILED" ? "danger" : "warning"}>{worker.status}</StatusBadge></td>
                      <td>{formatTime(worker.lastHeartbeatAt)}</td>
                    </tr>
                  ))}
                  {!workers.length ? <tr><td colSpan={5}><p className="io-empty">Aucun worker enregistré dans la projection d'observabilité.</p></td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="io-panel" aria-label="Runbooks récents">
            <header><h2>Runbooks récents</h2><small>{runbooks.length}</small></header>
            <div className="io-panel__body" style={{ padding: 0 }}>
              <table className="io-table">
                <thead><tr><th>Runbook</th><th>Déclenché par</th><th>Statut</th><th>Sévérité</th><th>Mis à jour</th></tr></thead>
                <tbody>
                  {runbooks.map((runbook, index) => (
                    <tr key={`${runbook.id}-${index}`}>
                      <td><strong>{runbook.title}</strong></td>
                      <td>{runbook.secondary || "Non publié"}</td>
                      <td><StatusBadge tone="warning">{runbook.status}</StatusBadge></td>
                      <td>{runbook.tags.join(", ") || "—"}</td>
                      <td>{runbook.route ? <Link to={runbook.route}>Ouvrir</Link> : <span>Non publié</span>}</td>
                    </tr>
                  ))}
                  {!runbooks.length ? <tr><td colSpan={5}><p className="io-empty">Aucun runbook publié.</p></td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
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

function KpiCell({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "warn" | "danger" }) {
  return (
    <article className={`io-kpi-card${tone ? ` io-kpi-card--${tone}` : ""}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      {detail ? <span>{detail}</span> : null}
    </article>
  );
}

function SeverityDonut({ breakdown }: { breakdown: { key: string; count: number; pct: number }[] }) {
  const total = breakdown.reduce((sum, item) => sum + item.count, 0);
  let cursor = 0;
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="io-donut-wrap">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--io-surface-3)" strokeWidth="14" />
        {total > 0 ? breakdown.map((item) => {
          const dash = (item.pct * circumference) || 0;
          const offset = circumference - (cursor * circumference);
          cursor += item.pct;
          return (
            <circle
              key={item.key}
              cx="50" cy="50" r={radius} fill="none"
              stroke={SEVERITY_COLORS[item.key]}
              strokeWidth="14"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={offset}
              transform="rotate(-90 50 50)"
            />
          );
        }) : null}
        <text x="50" y="54" textAnchor="middle" fontSize="16" fill="var(--io-text)" fontWeight="700">{total}</text>
      </svg>
      <div className="io-donut-legend">
        {breakdown.map((item) => (
          <span key={item.key}><i style={{ background: SEVERITY_COLORS[item.key] }} />{presentSeverity(item.key as ExecutionIncident["severity"]).label} · {item.count}</span>
        ))}
      </div>
    </div>
  );
}

function IncidentsLoading() {
  return (
    <div className="io-page">
      <h1 className="sr-only">Incidents &amp; Opérations</h1>
      <div className="io-workspace">
        <section className="io-kpi-strip">
          {Array.from({ length: 8 }).map((_, index) => <article key={index} className="io-kpi-card"><div className="skeleton-line" /></article>)}
        </section>
      </div>
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
  if (severity === "HIGH") return "danger" as const;
  if (severity === "MEDIUM") return "warning" as const;
  return "accent" as const;
}

function statusTone(status: ExecutionIncident["status"]) {
  if (status === "RESOLVED") return "success" as const;
  if (status === "DLQ" || status === "ESCALATED") return "danger" as const;
  if (status === "RECONCILING" || status === "RETRYING") return "warning" as const;
  return "accent" as const;
}

function reconciliationTone(status: "MATCH" | "DELTA" | "MISSING" | "REPAIRED") {
  if (status === "MATCH" || status === "REPAIRED") return "success" as const;
  if (status === "DELTA") return "warning" as const;
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

function formatClock(value: Date | undefined) {
  if (!value) return "—:—:—";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}

function formatClockDate(value: Date | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(value);
}
