import { useEffect, useState } from "react";
import type { LiveFocusView } from "@/domains/front-api/viewModels";
import type { LiveTradingModel } from "../model";
import type { FocusQueueItem } from "../focusJournalModel";
import type { RealtimeStatus } from "@/domains/realtime/RealtimeProvider";
import { ageLabel, parisTime, workspaceCopy } from "./workspaceModel";
import { publishedCalendar } from "./workspaceSources";

export function WorkspaceNow({ focus, model, tickets, realtime, compact, onSelect, onSources }: {
  focus: LiveFocusView; model: LiveTradingModel; tickets: readonly FocusQueueItem[]; realtime: RealtimeStatus | null;
  compact: boolean;
  onSelect(item: FocusQueueItem): void; onSources(): void;
}) {
  const actionable = tickets.filter((item) => item.actionable && !item.terminal);
  const now = realtime?.now.getTime() ?? Date.now();
  const nextEvent = publishedCalendar(focus).find((event) => Date.parse(event.at) >= now);
  const latest = [...model.timeline].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  const compactChrome = useCompactChrome();
  if (compact || compactChrome) return <section className="tw-now-mobile" aria-label="Maintenant"><div>
    <details><summary><strong>Maintenant</strong><span>{actionable.length ? actionable.length + " décision(s)" : "Aucune décision en attente"}</span></summary><p>{workspaceCopy(focus.marketDeskBrief.headline) || "Lecture non publiée."}</p><p>{nextEvent ? nextEvent.title + " · " + parisTime(nextEvent.at, true) : latest ? workspaceCopy(latest.title) + " · " + parisTime(latest.at, true) : "Aucun changement reçu."}</p></details><button onClick={onSources}>Données</button></div>
    {actionable[0] ? <button className="tw-primary" onClick={() => onSelect(actionable[0])}>Examiner {actionable[0].instrument}</button> : null}
  </section>;
  return <section className="tw-now" aria-label="Maintenant">
    <div className="tw-now__reading"><h2>Maintenant</h2><p>{workspaceCopy(focus.marketDeskBrief.headline) || "Lecture de séance non publiée."}</p></div>
    <div className="tw-now__attention"><strong>{actionable.length ? actionable.length + " décision(s) à examiner" : "Aucune décision en attente"}</strong>
      {actionable[0] ? <button onClick={() => onSelect(actionable[0])}>Examiner {actionable[0].instrument}</button> : <span>Sur les tickets reçus</span>}
    </div>
    <div className="tw-now__event"><span>{nextEvent ? "Prochain événement publié" : "Dernier changement publié"}</span><p>{nextEvent ? nextEvent.title + " · " + parisTime(nextEvent.at) : latest ? workspaceCopy(latest.title) + " · " + parisTime(latest.at, true) : "Aucun changement reçu pour ce périmètre."}</p></div>
    <button className="tw-now__source" onClick={onSources}><span>État des données</span><small>{ageLabel(model.dataQuality.marketAsOf ?? undefined, now)}</small></button>
  </section>;
}

function useCompactChrome() {
  const media = "(max-width: 1180px), (max-height: 720px)";
  const [compact, setCompact] = useState(() => window.matchMedia(media).matches);
  useEffect(() => {
    const query = window.matchMedia(media);
    const update = () => setCompact(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return compact;
}

export function WorkspaceSources({ focus, model, realtime }: { focus: LiveFocusView; model: LiveTradingModel; realtime: RealtimeStatus | null }) {
  const events = publishedCalendar(focus);
  return <div className="tw-source-details">
    <p>Une connexion au desk ne garantit pas des prix récents. Cotations reçues, dernières bougies clôturées et historique sont horodatés séparément.</p>
    <dl className="tw-detail-lines"><div><dt>Dernier événement reçu par le poste</dt><dd>{parisTime(realtime?.lastEventAt, true)}</dd></div><div><dt>Données de marché publiées</dt><dd>{parisTime(model.dataQuality.marketAsOf, true)}</dd></div><div><dt>Dossiers de décision</dt><dd>{parisTime(focus.asOf, true)}</dd></div><div><dt>Contexte de marché</dt><dd>{parisTime(focus.marketContext.sourceDataCutoff, true)}</dd></div></dl>
    <h3>Calendrier publié par le desk</h3>
    {events.length ? <ol className="tw-published-events">{events.map((event) => <li key={event.id}><time>{parisTime(event.at, true)} · Paris</time><strong>{event.title}</strong></li>)}</ol> : <p>Aucun événement horodaté exploitable n’est fourni par le desk. Cela ne signifie pas qu’aucune annonce n’est prévue.</p>}
    <details><summary>Détail des sources publiées</summary><ul>{model.dataQuality.sources.map((source) => <li key={source.source}>{source.source} · {source.rows} enregistrement(s) · {parisTime(source.latestAt, true)}</li>)}</ul></details>
  </div>;
}
