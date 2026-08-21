import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FaBroadcastTower,
  FaCheckCircle,
  FaExchangeAlt,
  FaFingerprint,
  FaKey,
  FaNetworkWired,
  FaPlug,
  FaRandom,
  FaServer,
  FaShieldAlt,
  FaSyncAlt,
  FaTimesCircle
} from "react-icons/fa";
import { DataTable, MobileDataList } from "@/design-system/data";
import { DeskButton, ReasonInput } from "@/design-system/actions";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import { presentAvailability, presentGateState, presentPermission, presentQueueStatus, presentSeverity } from "@/design-system/labels";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted, SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";
import type { ExecutionProvidersView } from "@/domains/front-api/viewModels";

type ProviderAction = ExecutionProvidersView["commandActions"][number];
type ProviderAccount = ExecutionProvidersView["accounts"][number];

const pickMyTradeStates = [
  "NOT_CONFIGURED",
  "VALIDATION_PENDING",
  "DEMO",
  "SHADOW",
  "ACTIVE",
  "STANDBY",
  "DEGRADED",
  "DISCONNECTED",
  "DISABLED"
] as const;

export function ExecutionProvidersPage() {
  const query = useFrontView("execution-providers");
  const repository = useFrontViewRepository();
  const [reason, setReason] = useState("Contrôle opérateur : action provider validée en simulation uniquement.");
  const [stepUpToken, setStepUpToken] = useState("");
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);

  if (query.isLoading) {
    return <ExecutionProvidersLoading />;
  }

  if (query.isError) {
    return (
      <Card title="Fournisseurs indisponibles" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucune donnée fournisseurs" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/execution-providers`.</p>
      </Card>
    );
  }

  const { data, meta } = query.data;
  const switchAction = data.commandActions.find((action) => action.commandType === "execution.provider.switch_primary");

  const confirmAction = async (action: ProviderAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand(buildExecutionProviderCommand(action, reason, stepUpToken));
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "EXECUTION_PROVIDER_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="operator-page execution-providers-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="Fournisseurs d'exécution"
        description={`Provider primaire ${data.summary.primaryProviderId} · standby ${data.summary.standbyProviderId} · projection ${meta.latencyMs} ms · aucune donnée sensible navigateur.`}
        actions={
          <>
            <Link to="/orders">Ordres</Link>
            <Link to="/risk">Centre de risque</Link>
            {switchAction ? (
              <DeskButton variant="warning" disabled={isActionDisabled(switchAction, reason, stepUpToken)} onClick={() => confirmAction(switchAction)}>
                Basculer simulation
              </DeskButton>
            ) : null}
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs Fournisseurs d'exécution">
        <KpiCard label="PRINCIPAL" value={providerShort(data.summary.primaryProviderId)} delta="backend state only" tone="success" />
        <KpiCard label="RÉSERVE" value={providerShort(data.summary.standbyProviderId)} delta="PickMyTrade shadow" tone="warning" />
        <KpiCard label="PROVIDERS ACTIFS" value={`${data.summary.activeProviders}`} delta={`${data.summary.degradedProviders} degraded`} tone="info" />
        <KpiCard label="LATENCE AVG" value={`${data.summary.avgLatencyMs} ms`} delta="ACK provider" tone="warning" />
        <KpiCard label="TAUX DE FILL" value={formatPercent(data.summary.fillRatePct)} delta={`${formatSignedR(data.summary.slippageR)} slip`} detail={<ProgressBar value={data.summary.fillRatePct} tone="success" />} tone="success" />
        <KpiCard label="INCIDENTS" value={`${data.summary.openIncidents}`} delta={`${data.summary.accounts} comptes`} tone={data.summary.openIncidents > 0 ? "warning" : "success"} />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Providers, comptes et santé">
        <Card title="Fournisseurs & rôles" actions={<InlineAction>{data.providers.length} fournisseurs</InlineAction>} density="compact">
          <div className="provider-roster">
            {data.providers.map((provider) => (
              <article key={provider.providerId} className={`provider-card provider-card--${provider.state.toLowerCase()}`}>
                <header>
                  <FaServer />
                  <div><strong>{provider.label}</strong><small>{provider.providerId} · {provider.adapter}</small></div>
                  <StatusBadge tone={providerStateTone(provider.state)}>{presentAvailability(provider.state).label}</StatusBadge>
                </header>
                <div className="provider-card__metrics">
                  <MetricBox label="Rôle" value={provider.role} />
                  <MetricBox label="Latence" value={`${provider.latencyMs} ms`} />
                  <MetricBox label="Fill" value={formatPercent(provider.fillRatePct)} />
                </div>
                <p><FaKey /> Exposition navigateur : {provider.browserExposure}</p>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Comptes & adapters" actions={<InlineAction>Comptes</InlineAction>} density="compact">
          <DataTable rows={data.accounts} rowKey={(row) => row.accountId} columns={accountColumns} />
          <MobileDataList
            rows={data.accounts}
            rowKey={(row) => row.accountId}
            renderTitle={(row) => `${row.label} · ${row.mode}`}
            renderMeta={(row) => `${row.providerId} · ${presentAvailability(row.state).label}`}
            renderBody={(row) => `${formatCurrency(row.netLiqUsd)} net liq · ${row.openPositions} positions · ${row.ordersToday} ordres`}
          />
          <div className="provider-adapter-list">
            {data.adapters.map((adapter) => (
              <article key={adapter.adapterId}>
                <FaPlug />
                <div><strong>{adapter.label}</strong><small>{adapter.version} · {adapter.availableStates.join(", ")}</small></div>
                <span>{adapter.capabilityCount} caps</span>
                <StatusBadge tone={adapter.installed ? "success" : "danger"}>{adapter.installed ? "Installé" : "Manquant"}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Santé, capacités & états PickMyTrade" actions={<InlineAction>Santé</InlineAction>} density="compact">
          <div className="provider-health-list">
            {data.healthChecks.map((check) => (
              <article key={check.checkId}>
                <FaNetworkWired />
                <div><strong>{check.label}</strong><small>{check.detail}</small></div>
                <span>{check.latencyMs} ms</span>
                <StatusBadge tone={presentGateState(check.status).tone}>{presentGateState(check.status).label}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="provider-state-cloud" aria-label="États PickMyTrade supportés">
            {pickMyTradeStates.map((state) => (
              <StatusBadge key={state} tone={state === "DEGRADED" || state === "VALIDATION_PENDING" ? "warning" : state === "DISCONNECTED" || state === "DISABLED" ? "danger" : "accent"}>{presentAvailability(state).label}</StatusBadge>
            ))}
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Switch workflow, events et commandes">
        <Card title="Workflow de bascule fournisseur" actions={<InlineAction>Simulation uniquement</InlineAction>} density="compact">
          <ol className="provider-switch-workflow">
            {data.switchWorkflow.map((step) => (
              <li key={step.stepId}>
                <span>{step.order}</span>
                <div><strong>{step.label}</strong><small>{step.detail}</small></div>
                <StatusBadge tone={workflowTone(step.state)}>{presentQueueStatus(step.state).label}</StatusBadge>
              </li>
            ))}
          </ol>
          <div className="provider-switch-proof">
            <FaShieldAlt />
            <span>Bascule critique : gel des nouveaux ordres → vérification position → synchronisation → activation cible → réconciliation → reprise. Step-up obligatoire.</span>
          </div>
        </Card>

        <Card title="Événements & incidents fournisseur" actions={<InlineAction>Audit</InlineAction>} density="compact">
          <ol className="provider-events-list">
            {data.events.map((event) => (
              <li key={event.eventId}>
                <span>{formatTime(event.at)}</span>
                <div><strong>{event.title}</strong><small>{event.eventType} · {event.correlationId}</small></div>
                <StatusBadge tone={event.status === "RECEIVED" ? "success" : event.status === "EXPECTED" ? "accent" : "warning"}>{presentQueueStatus(event.status).label}</StatusBadge>
              </li>
            ))}
          </ol>
          <div className="provider-incidents-list">
            {data.incidents.map((incident) => (
              <Link key={incident.incidentId} to={incident.route}>
                <FaBroadcastTower />
                <div><strong>{incident.title}</strong><small>{incident.detail}</small></div>
                <StatusBadge tone={incident.severity === "HIGH" ? "danger" : "warning"}>{presentSeverity(incident.severity).label}</StatusBadge>
              </Link>
            ))}
          </div>
        </Card>

        <Card title="Actions fournisseurs" actions={<InlineAction>Flux de commande</InlineAction>} density="compact">
          <div className="provider-command-result">
            <FaFingerprint />
            <div>
              <small>Dernière commande provider</small>
              <strong>{command ? `Acceptée · ${command.commandId}` : "Aucune commande confirmée"}</strong>
              {commandError ? <span className="text-danger">{commandError}</span> : null}
            </div>
          </div>
          <ReasonInput label="Motif obligatoire" value={reason} onChange={setReason} />
          <label className="provider-step-up">
            <span>Step-up phrase pour switch/disable</span>
            <input value={stepUpToken} onChange={(event) => setStepUpToken(event.target.value)} placeholder={switchAction?.actionId ?? "actionId step-up"} />
          </label>
          <div className="provider-action-list">
            {data.commandActions.map((action) => (
              <article key={action.actionId} className={action.commandType.includes("switch") ? "provider-action-list__switch" : undefined}>
                <span>{actionIcon(action)}</span>
                <div><strong>{action.label}</strong><small>{action.commandType} · {action.impactSummary}</small></div>
                <StatusBadge tone={permissionTone(action.permission)}>{presentPermission(action.permission).label}</StatusBadge>
                <DeskButton
                  variant={action.commandType.includes("switch") ? "warning" : action.permission === "DENIED" ? "danger" : "primary"}
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

export function buildExecutionProviderCommand(action: ProviderAction, reason: string, stepUpToken = ""): SubmitDeskCommandInput {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw Object.assign(new Error("EXECUTION_PROVIDER_REASON_REQUIRED"), { code: "EXECUTION_PROVIDER_REASON_REQUIRED" });
  }

  if (action.permission === "DENIED") {
    throw Object.assign(new Error("EXECUTION_PROVIDER_PERMISSION_DENIED"), { code: "EXECUTION_PROVIDER_PERMISSION_DENIED" });
  }

  if (action.permission === "STEP_UP_REQUIRED" && stepUpToken.trim() !== action.actionId) {
    throw Object.assign(new Error("EXECUTION_PROVIDER_STEP_UP_REQUIRED"), { code: "EXECUTION_PROVIDER_STEP_UP_REQUIRED" });
  }

  return {
    commandType: action.commandType,
    environment: "MOCK",
    expectedVersion: action.expectedVersion,
    reason: normalizedReason,
    payload: {
      actionId: action.actionId,
      providerId: action.providerId,
      simulationOnly: action.simulationOnly,
      stepUpAccepted: action.permission === "STEP_UP_REQUIRED",
      ...action.payload
    }
  };
}

const accountColumns = [
  { key: "account", header: "Compte", render: (row: ProviderAccount) => <AccountCell row={row} /> },
  { key: "provider", header: "Fournisseur", render: (row: ProviderAccount) => providerShort(row.providerId) },
  { key: "mode", header: "Mode", render: (row: ProviderAccount) => row.mode },
  { key: "netliq", header: "Liquidité nette", align: "right" as const, render: (row: ProviderAccount) => formatCurrency(row.netLiqUsd) },
  { key: "positions", header: "Pos", align: "right" as const, render: (row: ProviderAccount) => row.openPositions },
  { key: "state", header: "État", render: (row: ProviderAccount) => <StatusBadge tone={row.state === "AVAILABLE" ? "success" : row.state === "RECONCILING" ? "warning" : "danger"}>{presentAvailability(row.state).label}</StatusBadge> }
] as const;

function AccountCell({ row }: { row: ProviderAccount }) {
  return (
    <div className="provider-account-cell">
      <strong>{row.label}</strong>
      <small>{row.accountId} · check {formatTime(row.lastPositionCheckAt)}</small>
    </div>
  );
}

function ExecutionProvidersLoading() {
  return (
    <div className="operator-page execution-providers-page">
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
      </section>
    </div>
  );
}

function isActionDisabled(action: ProviderAction, reason: string, stepUpToken: string) {
  if (action.permission === "DENIED") return true;
  if (!reason.trim()) return true;
  if (action.permission === "STEP_UP_REQUIRED" && stepUpToken.trim() !== action.actionId) return true;
  return false;
}

function actionIcon(action: ProviderAction) {
  if (action.commandType.includes("switch")) return <FaRandom />;
  if (action.commandType.includes("reconnect")) return <FaPlug />;
  if (action.commandType.includes("reconcile")) return <FaSyncAlt />;
  if (action.commandType.includes("disable")) return <FaTimesCircle />;
  if (action.commandType.includes("test")) return <FaCheckCircle />;
  return <FaExchangeAlt />;
}

function providerStateTone(state: ExecutionProvidersView["providers"][number]["state"]) {
  if (state === "ACTIVE" || state === "DEMO" || state === "SHADOW" || state === "STANDBY") return "success" as const;
  if (state === "DEGRADED" || state === "VALIDATION_PENDING") return "warning" as const;
  if (state === "DISABLED" || state === "DISCONNECTED") return "danger" as const;
  return "accent" as const;
}

function workflowTone(state: ExecutionProvidersView["switchWorkflow"][number]["state"]) {
  if (state === "DONE" || state === "READY") return "success" as const;
  if (state === "BLOCKED") return "danger" as const;
  return "warning" as const;
}

function permissionTone(permission: ProviderAction["permission"]) {
  if (permission === "ALLOWED") return "success" as const;
  if (permission === "STEP_UP_REQUIRED") return "warning" as const;
  return "danger" as const;
}

function providerShort(providerId: string) {
  return providerId.replace("provider_", "").replace("_sim101", "").replace("_shadow", "");
}

function formatPercent(value: number) {
  return `${value.toFixed(1).replace(".", ",")}%`;
}

function formatSignedR(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2).replace(".", ",")} R`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}
