import { Link } from "react-router-dom";
import { FiArrowLeft, FiBarChart2, FiBell, FiBookOpen, FiRefreshCw } from "react-icons/fi";
import type { LiveFocusView } from "@/domains/front-api/viewModels";
import type { RealtimeStatus } from "@/domains/realtime/RealtimeProvider";
import { parisTime, type WorkspacePanel } from "./workspaceModel";
import { commandStatusLabel, type WorkspaceCommand } from "./useWorkspaceCommand";

type Props = { focus: LiveFocusView; realtime: RealtimeStatus | null; panel: WorkspacePanel; decisionCount: number; alertCount: number; readOnly: string | null; refreshing: boolean; onExit(): void; onLegacy(): void; onRefresh(): void; onPanel(panel: WorkspacePanel): void; onBrief(): void; onAlerts(): void; onSettings(): void };

export function WorkspaceChrome(props: Props) {
  const { focus, realtime } = props;
  const connected = realtime?.connectionStatus === "OPEN" && !realtime.resyncing;
  const session = ({ OPEN: "Séance ouverte", PREOPEN: "Avant séance", PRE_OPEN: "Avant séance", CLOSED: "Marché fermé", BREAK: "Interruption de séance" } as Record<string, string>)[focus.session.marketState] ?? "État de séance à vérifier";
  return <>
    <header className="tw-topbar"><div className="tw-brand"><button onClick={props.onExit} aria-label="Retour au desk"><FiArrowLeft /></button><h1>Séance<span>Poste de trading</span></h1></div>
      <nav className="tw-desktop-nav" aria-label="Espaces du desk"><button aria-pressed={props.panel === "markets" || props.panel === "tickets"} onClick={() => props.onPanel("markets")}>Marchés & tickets</button><button aria-pressed={props.panel === "tracking"} onClick={() => props.onPanel("tracking")}>Suivi</button><button aria-pressed={props.panel === "review"} onClick={() => props.onPanel("review")}>Bilan</button></nav>
      <div className="tw-connection" data-connected={connected}><i aria-hidden="true" /><span>{connected ? "Desk connecté" : realtime?.resyncing ? "Synchronisation…" : "Connexion interrompue"}</span></div>
      <time className="tw-clock" dateTime={realtime?.now.toISOString()}>{parisTime(realtime?.now.toISOString())}<small>Paris</small></time>
      <button className="tw-refresh-main" disabled={props.refreshing} onClick={props.onRefresh} aria-label="Actualiser la séance"><FiRefreshCw aria-hidden="true" /></button>
      <button className="tw-alert-toggle" aria-label={"Alertes" + (props.alertCount ? " · " + props.alertCount + " non lues" : "")} onClick={props.onAlerts}><FiBell aria-hidden="true" /><span>Alertes</span>{props.alertCount ? <b>{props.alertCount}</b> : null}</button>
      <details className="tw-options"><summary>Options</summary><button onClick={props.onSettings}>Configurer mon poste</button><button className="tw-compact-action" onClick={props.onBrief}>Lire la séance</button><button className="tw-compact-action" disabled={props.refreshing} onClick={props.onRefresh}>Actualiser la séance</button><button onClick={props.onLegacy}>Revenir au Focus classique</button><Link to="/risk">Risque et limites</Link><Link to="/events">Journal technique complet</Link></details>
    </header>
    <div className="tw-session-strip"><span>{session}</span><span>{focus.safety.physicalLiveEnabled ? "Exécution réelle autorisée par la configuration" : "Exécution réelle désactivée"}</span><span>{focus.safety.autoExecutionEnabled ? "Automatisation active" : focus.safety.humanGateRequired ? "Validation humaine" : "Validation humaine non requise"}</span><button className="tw-decision-count" onClick={() => { props.onPanel("tickets"); window.requestAnimationFrame(() => document.getElementById("workspace-tickets")?.scrollIntoView({ block: "start" })); }}>{props.decisionCount} à décider</button><button onClick={props.onBrief}><FiBookOpen aria-hidden="true" />Lire la séance</button></div>
    {props.readOnly ? <div className="tw-health" role="status">Lecture seule · {props.readOnly}</div> : null}
    <nav className="tw-mobile-nav" aria-label="Navigation du poste mobile">{[{ id: "markets", label: "Marchés" }, { id: "tickets", label: "Tickets" }, { id: "tracking", label: "Suivi" }, { id: "review", label: "Bilan" }].map(({ id, label }) => <button key={id} aria-pressed={props.panel === id} onClick={() => props.onPanel(id as WorkspacePanel)}>{id === "markets" ? <FiBarChart2 aria-hidden="true" /> : null}{label}{id === "tickets" && props.decisionCount ? <b>{props.decisionCount}</b> : null}</button>)}</nav>
  </>;
}

export function CommandReceipt({ command }: { command: WorkspaceCommand }) {
  if (!command.receipt && !command.error) return null;
  return <div className="tw-command-receipt" role="status">
    {command.error ? <p>{command.error}</p> : null}
    {command.receipt ? <><strong>{command.statusError ? "Suivi momentanément indisponible · demande conservée" : commandStatusLabel(command.status)}</strong><span>{command.receipt.ticket}</span><small>Une décision enregistrée ne prouve pas une exécution courtier.</small><details><summary>Reçu de la demande</summary><p>{command.receipt.commandId}</p><p>{command.receipt.correlationId}</p></details></> : null}
    <Link to="/events">Vérifier dans le journal</Link>
  </div>;
}
