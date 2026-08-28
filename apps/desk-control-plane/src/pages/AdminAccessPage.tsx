import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FaBan,
  FaClipboardList,
  FaFingerprint,
  FaKey,
  FaLayerGroup,
  FaLock,
  FaNetworkWired,
  FaShieldAlt,
  FaSignOutAlt,
  FaUserCog,
  FaUserPlus,
  FaUsers
} from "react-icons/fa";
import { DeskButton, ReasonInput } from "@/design-system/actions";
import { DataTable, MobileDataList } from "@/design-system/data";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import {
  presentAccessLevel,
  presentAccessState,
  presentAuditStatus,
  presentDecision,
  presentPermission,
  presentSeverity
} from "@/design-system/labels";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { AdminAccessView } from "@/domains/front-api/viewModels";
import type { CommandAccepted, SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";

type AdminUser = AdminAccessView["users"][number];
type AdminAction = AdminAccessView["commandActions"][number];

export function AdminAccessPage() {
  const query = useFrontView("admin-access");
  const repository = useFrontViewRepository();
  const [reason, setReason] = useState("Contrôle opérateur : action admin via le flux de commande BFF, audit obligatoire.");
  const [stepUpToken, setStepUpToken] = useState("");
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);

  if (query.isLoading) {
    return <AdminLoading />;
  }

  if (query.isError) {
    return (
      <div className="operator-page admin-access-page">
        <h1 className="sr-only">Accès administrateur</h1>
        <Card title="Admin indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
          <p>{(query.error as Error).message}</p>
        </Card>
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="operator-page admin-access-page">
        <h1 className="sr-only">Accès administrateur</h1>
        <Card title="Aucune donnée admin" eyebrow="EMPTY" state="empty" density="compact">
          <p>Le BFF ne retourne pas encore la projection `/views/admin-access`.</p>
        </Card>
      </div>
    );
  }

  const { data, meta } = query.data;
  const exportAction = data.commandActions.find((action) => action.commandType === "admin.audit.export");
  const stepUpAction = data.commandActions.find((action) => action.permission === "STEP_UP_REQUIRED");

  const confirmAction = async (action: AdminAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand(buildAdminAccessCommand(action, reason, stepUpToken));
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "ADMIN_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="operator-page admin-access-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="Accès administrateur"
        description={`RBAC BFF · ${presentAccessState(data.summary.accessMode).label} · ${data.summary.users} utilisateurs · projection ${meta.latencyMs} ms · exposition matérielle fournisseur : aucune.`}
        actions={
          <>
            <Link to="/auth">Authentification</Link>
            <Link to="/settings">Réglages</Link>
            {exportAction ? (
              <DeskButton variant="primary" disabled={isActionDisabled(exportAction, reason, stepUpToken)} onClick={() => confirmAction(exportAction)}>
                Exporter l'audit
              </DeskButton>
            ) : null}
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs Accès administrateur">
        <KpiCard label="ACCESS" value={presentAccessState(data.summary.accessMode).label} delta={data.currentAccess.readOnlyReason ?? "périmètre admin"} tone={data.summary.accessMode === "READ_ONLY" ? "warning" : "success"} />
        <KpiCard label="UTILISATEURS" value={`${data.summary.users}`} delta={`${data.summary.activeUsers} actifs`} tone="info" />
        <KpiCard label="RÔLES" value={`${data.summary.roles}`} delta={`${data.summary.capabilities} capacités`} tone="accent" />
        <KpiCard label="GROUPES" value={`${data.summary.accountGroups}`} delta="périmètres de comptes" tone="success" />
        <KpiCard label="EN ATTENTE" value={`${data.summary.pendingChanges}`} delta="modifications admin" tone="warning" />
        <KpiCard label="AUDIT" value={`${data.summary.auditEvents}`} delta="événements" detail={<ProgressBar value={100} tone="success" />} tone="success" />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Utilisateurs, rôles et capacités">
        <Card title="Utilisateurs & accès" actions={<InlineAction>{data.currentAccess.userId}</InlineAction>} density="compact">
          <DataTable rows={data.users} rowKey={(row) => row.userId} columns={userColumns} />
          <MobileDataList
            rows={data.users}
            rowKey={(row) => row.userId}
            renderTitle={(row) => `${row.displayName} · ${presentAccessState(row.status).label}`}
            renderMeta={(row) => `${row.roles.join(", ")} · ${row.maskedEmail}`}
            renderBody={(row) => `${row.accountGroupIds.join(", ")} · MFA ${presentAccessState(row.mfaState).label}`}
          />
        </Card>

        <Card title="Rôles & policies RBAC" actions={<InlineAction>{data.roles.length} rôles</InlineAction>} density="compact">
          <div className="admin-role-list">
            {data.roles.map((role) => (
              <article key={role.roleId}>
                <FaUserCog />
                <div><strong>{role.label}</strong><small>{role.description} · {role.capabilityCount} capacités</small></div>
                <span>{role.userCount} utilisateurs</span>
                <StatusBadge tone={role.riskLevel === "HIGH" ? "danger" : role.riskLevel === "MEDIUM" ? "warning" : "accent"}>{presentSeverity(role.riskLevel).label}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="admin-policy-list">
            {data.policies.map((policy) => (
              <article key={policy.policyId}>
                <FaShieldAlt />
                <div><strong>{policy.label}</strong><small>{policy.scope} · {policy.confirmationMode}</small></div>
                <StatusBadge tone={policy.status === "PASS" ? "success" : "warning"}>{policy.enabled ? "Activée" : "Désactivée"}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Capacités & accès fournisseur" actions={<InlineAction>Lecture seule</InlineAction>} density="compact">
          <div className="admin-capability-list" tabIndex={0} aria-label="Capacités et droits d’accès défilables">
            {data.capabilities.map((capability) => (
              <article key={capability.capability}>
                <FaKey />
                <div><strong>{capability.capability}</strong><small>{capability.domain} · {capability.reason}</small></div>
                <StatusBadge tone={decisionTone(capability.decision)}>{presentDecision(capability.decision).label}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="admin-provider-list">
            {data.providerAccess.map((provider) => (
              <article key={provider.providerId}>
                <FaNetworkWired />
                <div><strong>{provider.label}</strong><small>{provider.providerId} · {provider.environment} · exposition {provider.browserMaterialExposure}</small></div>
                <StatusBadge tone={provider.access === "DENIED" ? "danger" : provider.access === "COMMAND" ? "warning" : "success"}>{presentAccessLevel(provider.access).label}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Groupes comptes, audit et actions">
        <Card title="Groupes de comptes & environnements" actions={<InlineAction>{data.accountGroups.length} groupes</InlineAction>} density="compact">
          <div className="admin-group-list">
            {data.accountGroups.map((group) => (
              <article key={group.groupId}>
                <FaLayerGroup />
                <div><strong>{group.label}</strong><small>{group.environment} · comptes {group.accountIds.join(", ") || "aucun"} · fournisseurs {group.providerIds.join(", ") || "aucun"}</small></div>
                <StatusBadge tone={group.status === "ACTIVE" ? "success" : group.status === "READ_ONLY" ? "warning" : "danger"}>{presentAccessState(group.status).label}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="admin-access-proof">
            <FaLock />
            <span>L'utilisateur actuel est en lecture seule pour les mutations admin. Toute mutation requiert une permission BFF + expectedVersion + step-up.</span>
          </div>
        </Card>

        <Card title="Audit accès & commandes" actions={<InlineAction>{data.auditEvents.length} événements</InlineAction>} density="compact">
          <ol className="admin-audit-list">
            {data.auditEvents.map((event) => (
              <li key={event.auditId}>
                <span>{formatTime(event.at)}</span>
                <div><strong>{event.action}</strong><small>{event.actorUserId} → {event.target} · {event.correlationId}</small></div>
                <StatusBadge tone={event.status === "DENIED" || event.status === "FAILED" ? "danger" : "success"}>{presentAuditStatus(event.status).label}</StatusBadge>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Actions admin" actions={<InlineAction>Flux de commande</InlineAction>} density="compact">
          <div className="admin-command-result">
            <FaFingerprint />
            <div>
              <small>Dernière commande admin</small>
              <strong>{command ? `Acceptée · ${command.commandId}` : "Aucune commande confirmée"}</strong>
              {commandError ? <span className="text-danger">{commandError}</span> : null}
            </div>
          </div>
          <ReasonInput label="Motif obligatoire" value={reason} onChange={setReason} />
          <label className="admin-step-up">
            <span>Step-up phrase pour mutation admin</span>
            <input value={stepUpToken} onChange={(event) => setStepUpToken(event.target.value)} placeholder={stepUpAction?.actionId ?? "actionId step-up"} />
          </label>
          <div className="admin-action-list">
            {data.commandActions.map((action) => (
              <article key={action.actionId} className={action.permission === "DENIED" ? "admin-action-list__denied" : undefined}>
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

export function buildAdminAccessCommand(action: AdminAction, reason: string, stepUpToken = ""): SubmitDeskCommandInput {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw Object.assign(new Error("ADMIN_REASON_REQUIRED"), { code: "ADMIN_REASON_REQUIRED" });
  }

  if (action.permission === "DENIED") {
    throw Object.assign(new Error("ADMIN_PERMISSION_DENIED"), { code: "ADMIN_PERMISSION_DENIED" });
  }

  if (action.permission === "STEP_UP_REQUIRED" && stepUpToken.trim() !== action.actionId) {
    throw Object.assign(new Error("ADMIN_STEP_UP_REQUIRED"), { code: "ADMIN_STEP_UP_REQUIRED" });
  }

  return {
    commandType: action.commandType,
    environment: "MOCK",
    expectedVersion: action.expectedVersion,
    reason: normalizedReason,
    payload: {
      actionId: action.actionId,
      criticality: action.criticality,
      stepUpAccepted: action.permission === "STEP_UP_REQUIRED",
      ...action.payload
    }
  };
}

const userColumns = [
  { key: "user", header: "Utilisateur", render: (row: AdminUser) => <UserCell row={row} /> },
  { key: "roles", header: "Rôles", render: (row: AdminUser) => row.roles.join(", ") },
  { key: "mfa", header: "MFA", render: (row: AdminUser) => <StatusBadge tone={row.mfaState === "READY" ? "success" : row.mfaState === "REQUIRED" ? "warning" : "danger"}>{presentAccessState(row.mfaState).label}</StatusBadge> },
  { key: "status", header: "Statut", render: (row: AdminUser) => <StatusBadge tone={row.status === "ACTIVE" ? "success" : row.status === "INVITED" ? "warning" : "danger"}>{presentAccessState(row.status).label}</StatusBadge> }
] as const;

function UserCell({ row }: { row: AdminUser }) {
  return (
    <div className="admin-user-cell">
      <strong>{row.displayName}</strong>
      <small>{row.maskedEmail} · {row.userId} · {row.lastSeenAt ? formatTime(row.lastSeenAt) : "jamais"}</small>
    </div>
  );
}

function AdminLoading() {
  return (
    <div className="operator-page admin-access-page">
      <h1 className="sr-only">Accès administrateur</h1>
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
      </section>
    </div>
  );
}

function isActionDisabled(action: AdminAction, reason: string, stepUpToken: string) {
  if (action.permission === "DENIED") return true;
  if (!reason.trim()) return true;
  if (action.permission === "STEP_UP_REQUIRED" && stepUpToken.trim() !== action.actionId) return true;
  return false;
}

function actionIcon(action: AdminAction) {
  if (action.commandType.includes("invite")) return <FaUserPlus />;
  if (action.commandType.includes("role")) return <FaUserCog />;
  if (action.commandType.includes("logout")) return <FaSignOutAlt />;
  if (action.commandType.includes("account_group")) return <FaLayerGroup />;
  if (action.commandType.includes("policy")) return <FaShieldAlt />;
  if (action.permission === "DENIED") return <FaBan />;
  return <FaClipboardList />;
}

function decisionTone(decision: AdminAccessView["capabilities"][number]["decision"]) {
  if (decision === "ALLOW") return "success" as const;
  if (decision === "STEP_UP_REQUIRED" || decision === "READ_ONLY") return "warning" as const;
  return "danger" as const;
}

function permissionTone(permission: AdminAction["permission"]) {
  if (permission === "ALLOWED") return "success" as const;
  if (permission === "STEP_UP_REQUIRED") return "warning" as const;
  return "danger" as const;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}
