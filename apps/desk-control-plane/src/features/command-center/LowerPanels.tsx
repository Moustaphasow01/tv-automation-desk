import { Link } from "react-router-dom";
import type { CommandCenterView } from "@/domains/front-api/viewModels";
import { displayNumber, displayTime, statusTone } from "./mapper";
import { CommandPanel, EmptyPanelState, PanelStatus } from "./panelPrimitives";

export function IncidentsOperationsPanel({ incidents }: { incidents: CommandCenterView["incidents"] }) {
  return (
    <CommandPanel code="A" title="Incidents & Operations" className="cc-panel--incidents" action={<Link to="/execution/incidents">Voir tout</Link>}>
      {incidents.length ? <div className="cc-table-scroll"><table className="cc-table"><thead><tr><th>Sévérité</th><th>Détecté</th><th>Ressource</th><th>Problème</th><th>Runbook</th><th>Action</th></tr></thead><tbody>{incidents.map((incident) => <tr key={incident.id}><td><PanelStatus tone={statusTone(incident.severity) === "danger" ? "danger" : "warning"}>{incident.severity}</PanelStatus></td><td>{displayTime(incident.detectedAt)}</td><td>{incident.resource}</td><td><Link to={`/operations/incidents/${encodeURIComponent(incident.id)}`}>{incident.title}</Link></td><td>{incident.runbook}</td><td>{incident.action}</td></tr>)}</tbody></table></div> : <EmptyPanelState label="Aucun incident ouvert dans la projection" />}
      <footer className="cc-incident-stats"><span>Queues: <strong>UNAVAILABLE</strong></span><span>DLQ: <strong>UNAVAILABLE</strong></span><span>Stale feeds: <strong>UNAVAILABLE</strong></span></footer>
    </CommandPanel>
  );
}

export function JarvisPanel({ assistant }: { assistant: CommandCenterView["assistant"] }) {
  return (
    <CommandPanel code="B" title="Jarvis / Assistant (read-only)" className="cc-panel--jarvis" action={<Link to="/jarvis">Ouvrir</Link>}>
      <div className="cc-chat-question">Activité Jarvis publiée</div>
      {assistant.latest.length ? <div className="cc-chat-answer"><strong>{displayNumber(assistant.activeWorkers)} workers actifs</strong><span>{displayNumber(assistant.runningTasks)} tâche(s) en cours.</span>{assistant.latest.map((task) => <small key={task.id}>{task.role}: {task.status}</small>)}</div> : <EmptyPanelState label="Aucun message ou résumé Jarvis publié" />}
      <footer>Jarvis est en mode advisory. Il ne peut ni exécuter d'ordres ni modifier les paramètres.</footer>
    </CommandPanel>
  );
}

export function AuditTimelinePanel({ audit }: { audit: CommandCenterView["audit"] }) {
  return (
    <CommandPanel code="C" title="Timeline d'audit (corrélée)" className="cc-panel--audit" action={<Link to="/events">Voir tout</Link>}>
      {audit.length ? <ol className="cc-audit-list">{audit.map((event) => <li key={event.id}><time>{displayTime(event.at)}</time><i className={`cc-audit-dot cc-audit-dot--${statusTone(event.status)}`} aria-hidden="true" /><strong>{event.eventType}</strong><span>{event.detail}</span><small>{event.actor}</small><PanelStatus tone={statusTone(event.status) === "success" ? "success" : statusTone(event.status) === "danger" ? "danger" : "warning"}>{event.status}</PanelStatus></li>)}</ol> : <EmptyPanelState label="Aucun événement corrélé publié" />}
    </CommandPanel>
  );
}
