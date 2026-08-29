import { useContext, useState } from "react";
import { Link } from "react-router-dom";
import { routeDisplayName } from "@/app/routes";
import { FaServer } from "react-icons/fa";
import { DeskButton } from "@/design-system/actions";
import { StatusBadge } from "@/design-system/primitives";
import { presentAvailability } from "@/design-system/labels";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted, SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";
import type { ExecutionProvidersView } from "@/domains/front-api/viewModels";
import "@/features/execution-providers/execution-providers.css";

type ProviderAction = ExecutionProvidersView["commandActions"][number];
type ProviderAccount = ExecutionProvidersView["accounts"][number];

type CommandTab = "all" | "working" | "pending" | "filled" | "partial" | "rejected" | "cancelled";
const COMMAND_TAB_STATUSES: Record<CommandTab, readonly string[] | null> = {
  all: null,
  working: ["pending", "leased", "sent"],
  pending: ["pending"],
  filled: ["filled"],
  partial: ["partially_filled"],
  rejected: ["rejected"],
  cancelled: ["cancelled"],
};

export function ExecutionProvidersPage() {
  const realtime = useContext(RealtimeContext);
  const query = useFrontView("execution-providers");
  const repository = useFrontViewRepository();
  const [reason] = useState("Contrôle opérateur : action provider validée en simulation uniquement.");
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);
  const [commandTab, setCommandTab] = useState<CommandTab>("all");

  if (query.isLoading) return <ExecutionProvidersLoading />;
  if (query.isError) return <div className="ep-page"><div className="ep-workspace"><p className="ep-empty">Fournisseurs indisponibles : {(query.error as Error).message}</p></div></div>;
  if (!query.data) return <div className="ep-page"><div className="ep-workspace"><p className="ep-empty">Le BFF ne retourne pas encore la projection `/views/execution-providers`.</p></div></div>;

  const { data } = query.data;
  const switchAction = data.commandActions.find((action) => action.commandType === "execution.provider.switch_primary");
  const allowedStatuses = COMMAND_TAB_STATUSES[commandTab];
  const visibleCommands = allowedStatuses ? data.providerCommands.items.filter((item) => allowedStatuses.includes(item.status)) : data.providerCommands.items;

  const confirmAction = async (action: ProviderAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand(buildExecutionProviderCommand(action, reason));
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "EXECUTION_PROVIDER_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="ep-page" data-testid="execution-providers-golden-master">
      <header className="ep-header">
        <div className="ep-header__title">
          <h1>{routeDisplayName("execution/providers")}</h1>
          <p>Connectivité provider &amp; cycle de vie des ordres</p>
        </div>
        <div className="ep-header__clock">
          <strong>{formatClock(realtime?.now)}</strong>
          <small>{formatClockDate(realtime?.now)}</small>
        </div>
        <Link to="/orders">Ordres</Link>
        <Link to="/risk">Centre de risque</Link>
        {switchAction ? (
          <DeskButton variant="warning" disabled={isActionDisabled(switchAction, reason) || submittingActionId === switchAction.actionId} onClick={() => confirmAction(switchAction)}>
            {submittingActionId === switchAction.actionId ? "Envoi..." : "Basculer simulation"}
          </DeskButton>
        ) : null}
      </header>

      <div className="ep-workspace">
        {(command || commandError) && (
          <div className="ep-panel"><div className="ep-panel__body">
            <strong>{command ? `Commande ${command.status}` : "Commande rejetée"}</strong>
            <p className="ep-empty">{command?.commandId ?? commandError}</p>
          </div></div>
        )}

        <section className="ep-kpi-strip" aria-label="Indicateurs Exécution & Fournisseurs">
          <KpiCell label="Principal" value={providerShort(data.summary.primaryProviderId)} />
          <KpiCell label="Réserve" value={providerShort(data.summary.standbyProviderId)} />
          <KpiCell label="Providers actifs" value={String(data.summary.activeProviders)} detail={`${data.summary.degradedProviders} dégradés`} />
          <KpiCell label="Latence moy." value={`${data.summary.avgLatencyMs} ms`} />
          <KpiCell label="Taux de fill" value={formatPercent(data.summary.fillRatePct)} detail={`${formatSignedR(data.summary.slippageR)} slip`} />
          <KpiCell label="Incidents ouverts" value={String(data.summary.openIncidents)} tone={data.summary.openIncidents > 0 ? "warn" : undefined} />
        </section>

        <div className="ep-row1">
          <section className="ep-panel" aria-label="Fournisseurs">
            <header><h2>Fournisseurs</h2><small>{data.providers.length}</small></header>
            <div className="ep-panel__body">
              {data.providers.map((provider) => (
                <div key={provider.providerId} className="ep-provider-card">
                  <div className="ep-provider-title"><FaServer aria-hidden="true" /> {provider.label} <StatusBadge tone={providerStateTone(provider.state)}>{presentAvailability(provider.state).label}</StatusBadge></div>
                  <div className="ep-provider-grid">
                    <div><small>Rôle</small><strong>{provider.role}</strong></div>
                    <div><small>Adapter</small><strong>{provider.adapter}</strong></div>
                    <div><small>Latence</small><strong>{provider.latencyMs} ms</strong></div>
                    <div><small>Fill</small><strong>{formatPercent(provider.fillRatePct)}</strong></div>
                    <div><small>Connectivité</small><strong>{provider.connectivity}</strong></div>
                    <div><small>Dernier heartbeat</small><strong>{formatTime(provider.heartbeatAt)}</strong></div>
                  </div>
                </div>
              ))}
              {!data.providers.length ? <p className="ep-empty">Aucun fournisseur publié.</p> : null}
            </div>
          </section>

          <section className="ep-panel" aria-label="Comptes">
            <header><h2>Comptes</h2><small>{data.accounts.length}</small></header>
            <div className="ep-panel__body" style={{ padding: 0 }}>
              <div className="ep-table-scroll">
                <table className="ep-table">
                  <thead><tr><th>Compte</th><th>Fournisseur</th><th>Mode</th><th>Liquidité nette</th><th>Pos.</th><th>État</th></tr></thead>
                  <tbody>
                    {data.accounts.map((account: ProviderAccount) => (
                      <tr key={account.accountId}>
                        <td><strong>{account.label}</strong></td>
                        <td>{providerShort(account.providerId)}</td>
                        <td>{account.mode}</td>
                        <td>{formatCurrency(account.netLiqUsd)}</td>
                        <td>{account.openPositions}</td>
                        <td><StatusBadge tone={account.state === "AVAILABLE" ? "success" : account.state === "RECONCILING" ? "warning" : "danger"}>{presentAvailability(account.state).label}</StatusBadge></td>
                      </tr>
                    ))}
                    {!data.accounts.length ? <tr><td colSpan={6}><p className="ep-empty">Aucun compte publié.</p></td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="ep-panel" aria-label="Contrôles santé">
            <header><h2>Contrôles santé</h2><small>{data.healthChecks.length}</small></header>
            <div className="ep-panel__body">
              {data.healthChecks.map((check) => (
                <div key={check.checkId} className="ep-health-row">
                  <span>{check.label}</span>
                  <StatusBadge tone={check.status === "PASS" ? "success" : check.status === "WATCH" ? "warning" : "danger"}>{check.status}</StatusBadge>
                </div>
              ))}
              {!data.healthChecks.length ? <p className="ep-empty">Aucun contrôle santé publié.</p> : null}
            </div>
          </section>
        </div>

        <div className="ep-row3">
          <section className="ep-panel" aria-label="Modes d'exécution">
            <header><h2>Modes d'exécution</h2></header>
            <div className="ep-panel__body">
              <div className="ep-mode-row"><strong>Mode courant</strong><StatusBadge tone="accent">{data.executionModes.current}</StatusBadge></div>
              <div className="ep-mode-row"><span>Exécution activée</span><StatusBadge tone={data.executionModes.executionEnabled ? "success" : "danger"}>{data.executionModes.executionEnabled ? "OUI" : "NON"}</StatusBadge></div>
              <div className="ep-mode-row"><span>Approbation opérateur requise</span><StatusBadge tone={data.executionModes.entryOperatorApprovalRequired ? "warning" : "success"}>{data.executionModes.entryOperatorApprovalRequired ? "OUI" : "NON"}</StatusBadge></div>
              <div className="ep-mode-row"><span>Exécution manuelle Telegram</span><StatusBadge tone={data.executionModes.manualTelegramExecutionEnabled ? "warning" : "success"}>{data.executionModes.manualTelegramExecutionEnabled ? "ACTIVE" : "INACTIVE"}</StatusBadge></div>
              <div className="ep-mode-row"><span>Compte live autorisé</span><StatusBadge tone={data.executionModes.liveAccountAllowed ? "danger" : "success"}>{data.executionModes.liveAccountAllowed ? "OUI" : "NON"}</StatusBadge></div>
            </div>
          </section>

          <section className="ep-panel" aria-label="Disjoncteurs">
            <header><h2>Disjoncteurs</h2></header>
            <div className="ep-panel__body">
              <div className="ep-breaker-panel">
                {data.circuitBreakers.map((breaker) => (
                  <div key={breaker.breakerId} className="ep-breaker-row">
                    <strong>{breaker.label}</strong>
                    <StatusBadge tone={breaker.armed ? "danger" : "success"}>{breaker.armed ? "BLOQUANT" : "OK"}</StatusBadge>
                    <small>{breaker.detail}</small>
                  </div>
                ))}
                {!data.circuitBreakers.length ? <p className="ep-empty">Aucun disjoncteur publié.</p> : null}
              </div>
            </div>
          </section>
        </div>

        <section className="ep-panel" aria-label="Commandes provider">
          <header>
            <h2>Commandes provider</h2>
            <div className="ep-tabs">
              {(Object.keys(COMMAND_TAB_STATUSES) as CommandTab[]).map((tab) => (
                <button key={tab} type="button" className={`ep-tab${commandTab === tab ? " ep-tab--active" : ""}`} onClick={() => setCommandTab(tab)}>
                  {tab.toUpperCase()} ({data.providerCommands.counts[tab]})
                </button>
              ))}
            </div>
          </header>
          <div className="ep-panel__body" style={{ padding: 0 }}>
            <div className="ep-table-scroll">
              <table className="ep-table">
                <thead><tr><th>Heure</th><th>OrderIntent</th><th>Instrument</th><th>Côté</th><th>Qté</th><th>Type</th><th>Statut</th></tr></thead>
                <tbody>
                  {visibleCommands.map((item) => (
                    <tr key={item.commandId}>
                      <td>{formatTime(item.at)}</td>
                      <td>{shortId(item.orderIntentId)}</td>
                      <td>{item.instrument}</td>
                      <td><StatusBadge tone={item.side === "BUY" ? "success" : "danger"}>{item.side}</StatusBadge></td>
                      <td>{item.quantity}</td>
                      <td>{item.commandType}</td>
                      <td><StatusBadge tone={commandStatusTone(item.status)}>{item.status}</StatusBadge></td>
                    </tr>
                  ))}
                  {!visibleCommands.length ? <tr><td colSpan={7}><p className="ep-empty">Aucune commande provider publiée pour cet onglet.</p></td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <div className="ep-row4">
          <section className="ep-panel" aria-label="Remplissages récents">
            <header><h2>Remplissages</h2><small>{data.fills.length}</small></header>
            <div className="ep-panel__body" style={{ padding: 0 }}>
              <table className="ep-table">
                <thead><tr><th>Heure</th><th>Côté</th><th>Qté</th><th>Prix</th></tr></thead>
                <tbody>
                  {data.fills.map((event) => (
                    <tr key={event.eventId}>
                      <td>{formatTime(event.at)}</td>
                      <td>{event.side ? <StatusBadge tone={event.side === "BUY" ? "success" : "danger"}>{event.side}</StatusBadge> : "—"}</td>
                      <td>{event.fillQuantity ?? event.quantity ?? "—"}</td>
                      <td>{event.fillPrice != null ? event.fillPrice.toFixed(2) : "—"}</td>
                    </tr>
                  ))}
                  {!data.fills.length ? <tr><td colSpan={4}><p className="ep-empty">Aucun remplissage publié.</p></td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="ep-panel" aria-label="Remplissages partiels">
            <header><h2>Remplissages partiels</h2><small>{data.partialFills.length}</small></header>
            <div className="ep-panel__body" style={{ padding: 0 }}>
              <table className="ep-table">
                <thead><tr><th>Heure</th><th>Côté</th><th>Rempli</th><th>Demandé</th></tr></thead>
                <tbody>
                  {data.partialFills.map((event) => (
                    <tr key={event.eventId}>
                      <td>{formatTime(event.at)}</td>
                      <td>{event.side ? <StatusBadge tone={event.side === "BUY" ? "success" : "danger"}>{event.side}</StatusBadge> : "—"}</td>
                      <td>{event.fillQuantity ?? "—"}</td>
                      <td>{event.quantity ?? "—"}</td>
                    </tr>
                  ))}
                  {!data.partialFills.length ? <tr><td colSpan={4}><p className="ep-empty">Aucun remplissage partiel publié.</p></td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="ep-panel" aria-label="Rejets et annulations">
            <header><h2>Rejets &amp; annulations</h2><small>{data.rejectsAndCancels.length}</small></header>
            <div className="ep-panel__body" style={{ padding: 0 }}>
              <table className="ep-table">
                <thead><tr><th>Heure</th><th>Type</th><th>Statut</th></tr></thead>
                <tbody>
                  {data.rejectsAndCancels.map((event) => (
                    <tr key={event.eventId}>
                      <td>{formatTime(event.at)}</td>
                      <td>{event.eventType}</td>
                      <td><StatusBadge tone="danger">{event.status}</StatusBadge></td>
                    </tr>
                  ))}
                  {!data.rejectsAndCancels.length ? <tr><td colSpan={3}><p className="ep-empty">Aucun rejet ou annulation publié.</p></td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="ep-row2">
          <section className="ep-panel" aria-label="Incidents fournisseurs">
            <header><h2>Incidents</h2><small>{data.incidents.length}</small></header>
            <div className="ep-panel__body" style={{ padding: 0 }}>
              <div className="ep-table-scroll">
                <table className="ep-table">
                  <thead><tr><th>Fournisseur</th><th>Titre</th><th>Sévérité</th></tr></thead>
                  <tbody>
                    {data.incidents.map((incident) => (
                      <tr key={incident.incidentId}>
                        <td>{providerShort(incident.providerId)}</td>
                        <td><Link to={incident.route}>{incident.title}</Link></td>
                        <td><StatusBadge tone={incident.severity === "HIGH" ? "danger" : incident.severity === "MEDIUM" ? "warning" : "accent"}>{incident.severity}</StatusBadge></td>
                      </tr>
                    ))}
                    {!data.incidents.length ? <tr><td colSpan={3}><p className="ep-empty">Aucun incident fournisseur ouvert.</p></td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="ep-panel" aria-label="Événements provider">
            <header><h2>Événements récents</h2><small>{data.events.length}</small></header>
            <div className="ep-panel__body" style={{ padding: 0 }}>
              <div className="ep-table-scroll">
                <table className="ep-table">
                  <thead><tr><th>Heure</th><th>Type</th><th>Titre</th><th>Statut</th></tr></thead>
                  <tbody>
                    {data.events.map((event) => (
                      <tr key={event.eventId}>
                        <td>{formatTime(event.at)}</td>
                        <td>{event.eventType}</td>
                        <td><Link to={event.route}>{event.title}</Link></td>
                        <td><StatusBadge tone={event.status === "RECEIVED" ? "success" : event.status === "STALE" ? "warning" : event.status === "BLOCKED" ? "danger" : "accent"}>{event.status}</StatusBadge></td>
                      </tr>
                    ))}
                    {!data.events.length ? <tr><td colSpan={4}><p className="ep-empty">Aucun événement fournisseur publié.</p></td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </div>
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

function KpiCell({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "warn" }) {
  return (
    <article className={`ep-kpi-card${tone ? ` ep-kpi-card--${tone}` : ""}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      {detail ? <span>{detail}</span> : null}
    </article>
  );
}

function ExecutionProvidersLoading() {
  return (
    <div className="ep-page">
      <div className="ep-workspace">
        <section className="ep-kpi-strip">
          {Array.from({ length: 6 }).map((_, index) => <article key={index} className="ep-kpi-card"><div className="skeleton-line" /></article>)}
        </section>
      </div>
    </div>
  );
}

function isActionDisabled(action: ProviderAction, reason: string, stepUpToken = "") {
  if (action.permission === "DENIED") return true;
  if (!reason.trim()) return true;
  if (action.permission === "STEP_UP_REQUIRED" && stepUpToken.trim() !== action.actionId) return true;
  return false;
}

function providerStateTone(state: ExecutionProvidersView["providers"][number]["state"]) {
  if (state === "ACTIVE" || state === "DEMO" || state === "SHADOW" || state === "STANDBY") return "success" as const;
  if (state === "DEGRADED" || state === "VALIDATION_PENDING") return "warning" as const;
  if (state === "DISABLED" || state === "DISCONNECTED") return "danger" as const;
  return "accent" as const;
}

function commandStatusTone(status: string) {
  if (status === "filled") return "success" as const;
  if (status === "rejected" || status === "cancelled") return "danger" as const;
  if (status === "partially_filled") return "warning" as const;
  return "accent" as const;
}

function shortId(value: string) {
  return value.length > 14 ? `${value.slice(0, 14)}…` : value;
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

function formatClock(value: Date | undefined) {
  if (!value) return "—:—:—";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}

function formatClockDate(value: Date | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(value);
}
