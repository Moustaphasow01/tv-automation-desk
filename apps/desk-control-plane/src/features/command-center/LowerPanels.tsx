import { Link } from "react-router-dom";
import type { CommandCenterView } from "@/domains/front-api/viewModels";
import { operatorCode, operatorCopy } from "@/design-system/operatorVocabulary";
import { displayNumber, displayTime, statusLabel, statusTone } from "./mapper";
import { CommandPanel, EmptyPanelState, PanelStatus } from "./panelPrimitives";

export function IncidentsOperationsPanel({ incidents, operations }: { incidents: CommandCenterView["incidents"]; operations: CommandCenterView["operations"] }) {
  return (
    <CommandPanel code="A" title="Incidents & opérations" className="cc-panel--incidents" action={<Link to="/execution/incidents">Voir tout</Link>}>
      {incidents.length ? <div className="cc-table-scroll" role="region" aria-label="Incidents défilables" tabIndex={0}><table className="cc-table"><thead><tr><th>Sévérité</th><th>Détecté</th><th>Ressource</th><th>Problème</th><th>Procédure</th><th>Action</th></tr></thead><tbody>{incidents.map((incident) => <tr key={incident.id}><td><PanelStatus tone={statusTone(incident.severity)}>{operatorCode(incident.severity)}</PanelStatus></td><td>{displayTime(incident.detectedAt)}</td><td>{operatorCopy(incident.resource)}</td><td><Link to={`/operations/incidents/${encodeURIComponent(incident.id)}`}>{operatorCopy(incident.title)}</Link></td><td>{operatorCopy(incident.runbook)}</td><td>{operatorCopy(incident.action)}</td></tr>)}</tbody></table></div> : <EmptyPanelState label="Aucun incident ouvert dans la projection" />}
      <footer className="cc-incident-stats"><span>Files : <strong>{displayNumber(operations.queuedTasks)}</strong></span><span>Traitements en échec : <strong>{displayNumber(operations.dlqItems)}</strong></span><span>Flux périmés : <strong>{displayNumber(operations.staleFeeds)}</strong></span></footer>
    </CommandPanel>
  );
}

export function JarvisPanel({ assistant }: { assistant: CommandCenterView["assistant"] }) {
  return (
    <CommandPanel code="B" title="Jarvis / Assistant (lecture seule)" className="cc-panel--jarvis" action={<Link to="/jarvis">Ouvrir</Link>}>
      <div className="cc-chat-question">Activité Jarvis publiée</div>
      {assistant.latest.length ? <div className="cc-chat-answer"><strong>{displayNumber(assistant.activeWorkers)} agents de calcul actifs</strong><span>{displayNumber(assistant.runningTasks)} {(assistant.runningTasks ?? 0) > 1 ? "tâches" : "tâche"} en cours.</span>{assistant.latest.map((task) => <small key={task.id}>{operatorCopy(task.role)} : {operatorCode(task.status)}</small>)}</div> : <EmptyPanelState label="Aucun message ou résumé Jarvis publié" />}
      <footer>Jarvis est en mode consultatif. Il ne peut ni exécuter d'ordres ni modifier les paramètres.</footer>
    </CommandPanel>
  );
}

export function AuditTimelinePanel({ audit }: { audit: CommandCenterView["audit"] }) {
  return (
    <CommandPanel code="C" title="Chronologie d’audit" className="cc-panel--audit" action={<Link to="/events">Voir tout</Link>}>
      {audit.length ? <ol className="cc-audit-list">{audit.map((event) => <li key={event.id}><time>{displayTime(event.at)}</time><i className={`cc-audit-dot cc-audit-dot--${statusTone(event.status)}`} aria-hidden="true" /><strong>{operatorCode(event.eventType)}</strong><span>{operatorCopy(event.detail)}</span><small>{operatorCopy(event.actor)}</small><PanelStatus tone={statusTone(event.status)}>{statusLabel(event.status)}</PanelStatus></li>)}</ol> : <EmptyPanelState label="Aucun événement corrélé publié" />}
    </CommandPanel>
  );
}
