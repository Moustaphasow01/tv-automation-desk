import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FaClock,
  FaDoorOpen,
  FaFingerprint,
  FaIdBadge,
  FaKey,
  FaLock,
  FaRoute,
  FaSignOutAlt,
  FaSyncAlt,
  FaUserShield
} from "react-icons/fa";
import { DeskButton, ReasonInput, TrackedCommandReceipt } from "@/design-system/actions";
import { DataTable, MobileDataList } from "@/design-system/data";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import { presentAccessState, presentAvailability, presentDecision, presentPermission, presentQueueStatus } from "@/design-system/labels";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useCapabilityCatalog, useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { AuthSessionView } from "@/domains/front-api/viewModels";
import type { CommandAccepted, SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";

type AuthPermission = AuthSessionView["permissions"][number];
type AuthAction = AuthSessionView["commandActions"][number];
type AuthEnvironment = AuthSessionView["environments"][number];

export function AuthSessionPage() {
  const query = useFrontView("auth-session");
  const repository = useFrontViewRepository();
  const capabilityCatalog = useCapabilityCatalog();
  const [reason, setReason] = useState("Contrôle opérateur : action session demandée via BFF Command Runtime.");
  const [stepUpToken, setStepUpToken] = useState("");
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);
  const [operatorPin, setOperatorPin] = useState("");
  const [authSessionMessage, setAuthSessionMessage] = useState<string | null>(null);
  const [authSessionError, setAuthSessionError] = useState<string | null>(null);
  const [authSessionSubmitting, setAuthSessionSubmitting] = useState(false);

  if (query.isLoading) {
    return <AuthLoading />;
  }

  if (query.isError) {
    return (
      <Card title="Session indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucune session" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/auth-session`.</p>
      </Card>
    );
  }

  const { data, meta } = query.data;
  const refreshAction = data.commandActions.find((action) => action.commandType === "auth.session.refresh");
  const logoutAction = data.commandActions.find((action) => action.commandType === "auth.session.logout");
  const verificationAction = capabilityCatalog.data?.actions.find((action) => action.commandType === "control_plane.verify");

  const confirmAction = async (action: AuthAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand(buildAuthSessionCommand(action, reason, stepUpToken));
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "AUTH_SESSION_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  const loginOperator = async () => {
    const pin = operatorPin.trim();
    if (!pin) {
      setAuthSessionError("PIN_OPERATEUR_REQUIS");
      return;
    }
    setAuthSessionSubmitting(true);
    setAuthSessionError(null);
    setAuthSessionMessage(null);
    try {
      await repository.loginOperator(pin);
      setOperatorPin("");
      setAuthSessionMessage("Session opérateur active. Les commandes PAPER peuvent maintenant être envoyées avec audit.");
      await Promise.all([query.refetch(), capabilityCatalog.refetch()]);
    } catch (error) {
      setAuthSessionError(error instanceof Error ? error.message : "OPERATOR_LOGIN_FAILED");
    } finally {
      setOperatorPin("");
      setAuthSessionSubmitting(false);
    }
  };

  const logoutOperator = async () => {
    setAuthSessionSubmitting(true);
    setAuthSessionError(null);
    setAuthSessionMessage(null);
    try {
      await repository.logoutOperator();
      setAuthSessionMessage("Session opérateur fermée. Le cockpit repasse en lecture seule.");
      await Promise.all([query.refetch(), capabilityCatalog.refetch()]);
    } catch (error) {
      setAuthSessionError(error instanceof Error ? error.message : "OPERATOR_LOGOUT_FAILED");
    } finally {
      setAuthSessionSubmitting(false);
    }
  };

  const verifyControlPlane = async () => {
    if (!verificationAction?.allowed) return;
    setSubmittingActionId(verificationAction.actionId);
    setCommandError(null);
    try {
      setCommand(await repository.submitCommand({
        commandType: "control_plane.verify",
        environment: "PAPER",
        expectedVersion: verificationAction.actionId,
        reason,
        payload: { source: "auth-session", requested_check: "operator-e2e" }
      }));
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "CONTROL_PLANE_VERIFY_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="operator-page auth-session-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="Auth & Session"
        description={`${data.principal.displayName} · ${data.summary.environment} · ${data.summary.sessionState} · projection ${meta.latencyMs} ms · aucune matière sensible navigateur.`}
        actions={
          <>
            <Link to="/command-center">Command Center</Link>
            <Link to="/settings">Settings</Link>
            {refreshAction ? (
              <DeskButton variant="primary" disabled={isActionDisabled(refreshAction, reason, stepUpToken)} onClick={() => confirmAction(refreshAction)}>
                Refresh
              </DeskButton>
            ) : null}
            {verificationAction ? (
              <DeskButton variant="primary" disabled={!verificationAction.allowed || submittingActionId === verificationAction.actionId} onClick={verifyControlPlane}>
                Vérifier le Control Plane
              </DeskButton>
            ) : null}
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs Auth Session">
        <KpiCard label="SESSION" value={presentAccessState(data.summary.sessionState).label} delta={data.summary.authenticated ? "authentifiée" : "inactive"} tone={data.summary.authenticated ? "success" : "danger"} />
        <KpiCard label="ENV" value={data.summary.environment} delta={data.summary.readOnly ? "read-only" : "write gated"} tone={data.summary.environment === "LIVE" ? "danger" : "success"} />
        <KpiCard label="EXPIRY" value={`${data.summary.minutesToExpiry} min`} delta={`refresh ${formatTime(data.session.refreshAfterAt)}`} detail={<ProgressBar value={Math.min(100, (data.summary.minutesToExpiry / 90) * 100)} tone="success" />} tone="warning" />
        <KpiCard label="ALLOW" value={`${data.summary.permissionsGranted}`} delta={`${data.summary.permissionsDenied} denied`} tone="info" />
        <KpiCard label="STEP-UP" value={data.summary.stepUpReady ? "Prêt" : "Bloqué"} delta={`${data.stepUp.methods.length} méthodes`} tone={data.summary.stepUpReady ? "success" : "danger"} />
        <KpiCard label="BROWSER" value={data.session.browserMaterialExposure === "NONE" ? "Aucune" : data.session.browserMaterialExposure} delta={data.session.httpOnlySession ? "httpOnly" : "exposed"} tone={data.session.browserMaterialExposure === "NONE" ? "success" : "danger"} />
      </section>

      {command || commandError ? (
        <Card title="Résultat de commande" eyebrow="COMMAND RUNTIME" density="compact" tone={commandError ? "danger" : "neutral"}>
          {commandError ? <p role="alert">{commandError}</p> : null}
          <TrackedCommandReceipt command={command} />
        </Card>
      ) : null}

      <section className="operator-grid operator-grid--top" aria-label="Identité, environnement et permissions">
        <Card title="Identity & session bootstrap" actions={<InlineAction>{data.principal.identityProvider}</InlineAction>} density="compact">
          <div className="auth-identity-card">
            <FaUserShield />
            <div>
              <strong>{data.principal.displayName}</strong>
              <small>{data.principal.maskedEmail} · {data.principal.userId}</small>
            </div>
            <StatusBadge tone={data.summary.authenticated ? "success" : "danger"}>{presentAccessState(data.summary.sessionState).label}</StatusBadge>
          </div>
          <div className="auth-metric-grid">
            <MetricBox label="Roles" value={data.principal.roles.join(", ")} />
            <MetricBox label="Desks" value={data.principal.desks.join(", ")} />
            <MetricBox label="Accounts" value={data.principal.accountScopes.length} />
            <MetricBox label="Timezone" value={data.principal.timezone} />
          </div>
          <div className="auth-session-proof">
            <FaLock />
            <span>Session httpOnly liée CSRF, aucun store legacy importé, projection navigateur limitée aux états opérationnels.</span>
          </div>
          <div className="auth-operator-session-control">
            <label>
              <span>PIN opérateur</span>
              <input
                type="password"
                value={operatorPin}
                onChange={(event) => setOperatorPin(event.target.value)}
                placeholder={data.summary.authenticated ? "Session active" : "Déverrouiller les actions PAPER"}
                autoComplete="one-time-code"
                disabled={data.summary.authenticated || authSessionSubmitting}
              />
            </label>
            {data.summary.authenticated ? (
              <DeskButton variant="warning" disabled={authSessionSubmitting} onClick={logoutOperator}>
                <FaSignOutAlt /> Logout
              </DeskButton>
            ) : (
              <DeskButton variant="primary" disabled={authSessionSubmitting || !operatorPin.trim()} onClick={loginOperator}>
                <FaKey /> Login opérateur
              </DeskButton>
            )}
            <DeskButton variant="ghost" disabled={authSessionSubmitting} onClick={() => query.refetch()}>
              <FaSyncAlt /> Vérifier
            </DeskButton>
          </div>
          {authSessionMessage ? <p className="auth-session-message auth-session-message--ok">{authSessionMessage}</p> : null}
          {authSessionError ? <p className="auth-session-message auth-session-message--error">{authSessionError}</p> : null}
        </Card>

        <Card title="Environnements autorisés" actions={<InlineAction>{data.summary.environment}</InlineAction>} density="compact">
          <div className="auth-environment-list">
            {data.environments.map((environment) => (
              <article key={environment.environment} className={environment.current ? "auth-environment-list__current" : undefined}>
                <FaDoorOpen />
                <div><strong>{environment.label}</strong><small>{environment.riskProfile} · {environment.accountIds.join(", ") || "no account"}</small></div>
                <span>{environment.writeEnabled ? "Écriture" : "Lecture"}</span>
                <StatusBadge tone={environmentTone(environment)}>{presentAccessState(environment.status).label}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Permissions trading & route guards" actions={<InlineAction>{data.permissions.length} capabilities</InlineAction>} density="compact">
          <DataTable rows={data.permissions} rowKey={(row) => row.capability} columns={permissionColumns} />
          <MobileDataList
            rows={data.permissions}
            rowKey={(row) => row.capability}
            renderTitle={(row) => `${row.label} · ${presentDecision(row.decision).label}`}
            renderMeta={(row) => `${row.domain} · ${row.capability}`}
            renderBody={(row) => `${row.reason} · step-up ${row.requiresStepUp ? "oui" : "non"}`}
          />
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Step-up, events et commandes">
        <Card title="MFA / Step-up readiness" actions={<InlineAction>{data.stepUp.ready ? "Ready" : "Blocked"}</InlineAction>} density="compact">
          <div className="auth-stepup-list">
            {data.stepUp.methods.map((method) => (
              <article key={method.methodId}>
                <FaKey />
                <div><strong>{method.label}</strong><small>{method.methodId} · {method.lastVerifiedAt ? formatTime(method.lastVerifiedAt) : "non vérifié"}</small></div>
                <StatusBadge tone={method.state === "AVAILABLE" ? "success" : method.state === "DEGRADED" ? "warning" : "danger"}>{presentAvailability(method.state).label}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="auth-required-list">
            {data.stepUp.requiredFor.map((capability) => <StatusBadge key={capability} tone="warning">{capability}</StatusBadge>)}
          </div>
        </Card>

        <Card title="Route guards & audit events" actions={<InlineAction>Guards</InlineAction>} density="compact">
          <ol className="auth-route-list">
            {data.routeGuards.map((guard) => (
              <li key={`${guard.route}:${guard.capability}`}>
                <span><FaRoute /></span>
                <div><strong>{guard.route}</strong><small>{guard.capability} · {guard.reason}</small></div>
                <StatusBadge tone={decisionTone(guard.decision)}>{presentDecision(guard.decision).label}</StatusBadge>
              </li>
            ))}
          </ol>
          <div className="auth-event-list">
            {data.events.map((event) => (
              <article key={event.eventId}>
                <FaClock />
                <div><strong>{event.title}</strong><small>{event.eventType} · {formatTime(event.at)}</small></div>
                <StatusBadge tone={event.status === "OK" ? "success" : "warning"}>{presentQueueStatus(event.status).label}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Actions session" actions={<InlineAction>Command Runtime</InlineAction>} density="compact">
          <div className="auth-command-result">
            <FaFingerprint />
            <div>
              <small>Dernière commande auth</small>
              <strong>{command ? `Acceptée · ${command.commandId}` : "Aucune commande confirmée"}</strong>
              {commandError ? <span className="text-danger">{commandError}</span> : null}
            </div>
          </div>
          <ReasonInput label="Reason obligatoire" value={reason} onChange={setReason} />
          <label className="auth-step-up-input">
            <span>Step-up phrase pour logout</span>
            <input value={stepUpToken} onChange={(event) => setStepUpToken(event.target.value)} placeholder={logoutAction?.actionId ?? "actionId step-up"} />
          </label>
          <div className="auth-action-list">
            {data.commandActions.map((action) => (
              <article key={action.actionId} className={action.commandType.includes("logout") ? "auth-action-list__logout" : undefined}>
                <span>{actionIcon(action)}</span>
                <div><strong>{action.label}</strong><small>{action.commandType} · {action.impactSummary}</small></div>
                <StatusBadge tone={permissionTone(action.permission)}>{presentPermission(action.permission).label}</StatusBadge>
                <DeskButton
                  variant={action.criticality === "HIGH" ? "danger" : "primary"}
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

export function buildAuthSessionCommand(action: AuthAction, reason: string, stepUpToken = ""): SubmitDeskCommandInput {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw Object.assign(new Error("AUTH_SESSION_REASON_REQUIRED"), { code: "AUTH_SESSION_REASON_REQUIRED" });
  }

  if (action.permission === "DENIED") {
    throw Object.assign(new Error("AUTH_SESSION_PERMISSION_DENIED"), { code: "AUTH_SESSION_PERMISSION_DENIED" });
  }

  if (action.permission === "STEP_UP_REQUIRED" && stepUpToken.trim() !== action.actionId) {
    throw Object.assign(new Error("AUTH_SESSION_STEP_UP_REQUIRED"), { code: "AUTH_SESSION_STEP_UP_REQUIRED" });
  }

  return {
    commandType: action.commandType,
    environment: "MOCK",
    expectedVersion: action.expectedVersion,
    reason: normalizedReason,
    payload: {
      actionId: action.actionId,
      criticality: action.criticality,
      impactSummary: action.impactSummary,
      stepUpAccepted: action.permission === "STEP_UP_REQUIRED",
      ...action.payload
    }
  };
}

const permissionColumns = [
  { key: "capability", header: "Capability", render: (row: AuthPermission) => <PermissionCell row={row} /> },
  { key: "domain", header: "Domain", render: (row: AuthPermission) => row.domain },
  { key: "decision", header: "Decision", render: (row: AuthPermission) => <StatusBadge tone={decisionTone(row.decision)}>{presentDecision(row.decision).label}</StatusBadge> },
  { key: "stepup", header: "Step-up", render: (row: AuthPermission) => row.requiresStepUp ? "Oui" : "Non" }
] as const;

function PermissionCell({ row }: { row: AuthPermission }) {
  return (
    <div className="auth-permission-cell">
      <strong>{row.label}</strong>
      <small>{row.capability} · {row.reason}</small>
    </div>
  );
}

function AuthLoading() {
  return (
    <div className="operator-page auth-session-page">
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
      </section>
    </div>
  );
}

function isActionDisabled(action: AuthAction, reason: string, stepUpToken: string) {
  if (action.permission === "DENIED") return true;
  if (!reason.trim()) return true;
  if (action.permission === "STEP_UP_REQUIRED" && stepUpToken.trim() !== action.actionId) return true;
  return false;
}

function actionIcon(action: AuthAction) {
  if (action.commandType.includes("refresh")) return <FaSyncAlt />;
  if (action.commandType.includes("step_up")) return <FaKey />;
  if (action.commandType.includes("logout")) return <FaSignOutAlt />;
  return <FaIdBadge />;
}

function environmentTone(environment: AuthEnvironment) {
  if (environment.status === "AVAILABLE") return "success" as const;
  if (environment.status === "READ_ONLY") return "warning" as const;
  return "danger" as const;
}

function decisionTone(decision: AuthPermission["decision"] | AuthSessionView["routeGuards"][number]["decision"]) {
  if (decision === "ALLOW") return "success" as const;
  if (decision === "STEP_UP_REQUIRED" || decision === "READ_ONLY") return "warning" as const;
  return "danger" as const;
}

function permissionTone(permission: AuthAction["permission"]) {
  if (permission === "ALLOWED") return "success" as const;
  if (permission === "STEP_UP_REQUIRED") return "warning" as const;
  return "danger" as const;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}
