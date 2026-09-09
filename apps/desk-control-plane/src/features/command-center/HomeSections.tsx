import { Link } from "react-router-dom";
import { FiArrowUpRight } from "react-icons/fi";
import type { CommandCenterView } from "@/domains/front-api/viewModels";
import { operatorCode, operatorCopy, operatorDuration } from "@/design-system/operatorVocabulary";
import { JourneyLink } from "@/features/trading-journey/JourneyNavigation";
import { JourneyDisclosure, JourneySection } from "@/features/trading-journey/JourneySurface";
import { displayTime, statusLabel } from "./mapper";
import { homeDecisionMessage } from "./homeModel";
import { parisTime, timeframeLabel } from "@/features/live-trading/workspace/workspaceModel";

export function HomeAttention({ data, current }: { data: CommandCenterView; current: boolean }) {
  return <JourneySection title="À examiner" action={<JourneyLink to="/orders">Ouvrir les décisions</JourneyLink>}>
    <div className="dh-decision"><h3>{current && data.humanGate.available && data.summary.pendingCommands === 0 ? "Le desk veille" : "File de décision"}</h3><p>{current ? homeDecisionMessage(data) : "Cette lecture est ancienne ou incomplète. Actualisez avant de prendre une décision."}</p></div>
    <div className="dh-attention-list">{data.incidents.slice(0, 3).map((incident) => <JourneyLink key={incident.id} to={`/operations/incidents/${encodeURIComponent(incident.id)}`} className="dh-attention-row"><span className="dj-status" data-tone="warning">{operatorCode(incident.severity)}</span><strong>{operatorCopy(incident.title)}</strong><span>Détecté le {parisTime(incident.detectedAt, true)} Paris</span><FiArrowUpRight aria-hidden="true" /></JourneyLink>)}</div>
    {!data.incidents.length ? <p className="dj-empty">Aucun incident détaillé dans cette réponse. Le compteur de séance indique le périmètre global.</p> : <Link className="dh-more" to="/execution/incidents">Consulter tous les incidents</Link>}
  </JourneySection>;
}

export function HomeMarkets({ market }: { market: CommandCenterView["market"] }) {
  return <JourneySection title="Marchés du desk" action={<Link to="/live">Ouvrir le Live</Link>}>
    <p className="dh-source-note">Dernières bougies publiées · chaque source conserve son horodatage.</p>
    <div className="dh-markets">{market.rows.map((row) => <Link key={row.id} to={`/live?${new URLSearchParams({ focus: "1", instrument: row.instrument, timeframe: row.timeframe })}`} className="dh-market-row"><strong>{row.instrument}</strong><span>{timeframeLabel(row.timeframe)}</span><time dateTime={row.asOf}>{displayTime(row.asOf)}</time><span>{operatorDuration(row.freshnessSeconds)}</span><FiArrowUpRight aria-hidden="true" /></Link>)}</div>
    {!market.rows.length ? <p className="dj-empty">Aucune bougie publiée dans cette vue. Le catalogue complet reste accessible dans Live et Focus.</p> : null}
    <JourneyDisclosure title="Source et qualité des marchés"><p>État publié : {statusLabel(market.status)}. Ancienneté globale : {operatorDuration(market.freshnessSeconds)}.</p>{market.rows.map((row) => <p key={row.id}>{row.instrument} · {operatorCode(row.source)} · {statusLabel(row.status)}</p>)}</JourneyDisclosure>
  </JourneySection>;
}

export function HomeActivity({ data }: { data: CommandCenterView }) {
  return <JourneySection title="Derniers dossiers publiés" action={<JourneyLink to="/orders">Tous les dossiers</JourneyLink>}>
    <p className="dh-source-note">Historique de la file d’exécution. Un dossier reçu n’est pas nécessairement une décision encore ouverte.</p>
    {data.humanGate.available ? <div className="dh-recent">{data.humanGate.rows.slice(0, 4).map((row) => <JourneyLink key={row.orderIntentId} to={`/execution/orders/${encodeURIComponent(row.orderIntentId)}`}><span><strong>{row.instrument} · {operatorCode(row.side)}</strong><small>{row.quantity === null ? "Quantité non publiée" : row.quantity + " contrat(s)"}</small></span><span>{statusLabel(row.status)}<small>{operatorDuration(row.ageSeconds)}</small></span><FiArrowUpRight aria-hidden="true" /></JourneyLink>)}</div> : <p className="dj-empty">La source des dossiers n’est pas disponible.</p>}
    {data.humanGate.available && !data.humanGate.rows.length ? <p className="dj-empty">Aucun dossier publié dans cette file.</p> : null}
  </JourneySection>;
}
