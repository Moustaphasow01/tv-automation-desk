import { Link } from "react-router-dom";
import { FiArrowUpRight, FiRefreshCw } from "react-icons/fi";
import { useFrontView } from "@/domains/front-api/repositories";
import { operatorCode } from "@/design-system/operatorVocabulary";
import { JourneyFreshness, JourneyMessage, useJourneySurface } from "@/features/trading-journey/JourneySurface";
import { JourneyLink } from "@/features/trading-journey/JourneyNavigation";
import { homeSummary } from "./homeModel";
import { HomeAttention, HomeMarkets, HomeActivity } from "./HomeSections";
import "./desk-home.css";

export function DeskHome() {
  useJourneySurface();
  const query = useFrontView("command-center", undefined, { refetchInterval: 15_000 });
  const envelope = query.data;
  return <div className="desk-journey desk-home" data-testid="desk-home">
    <header className="dj-header"><div><h1>Accueil</h1><p>Votre séance, en un regard.</p></div><div className="dj-header-actions">
      <button type="button" aria-label="Actualiser l’accueil" disabled={query.isFetching} onClick={() => void query.refetch()}><FiRefreshCw aria-hidden="true" /></button>
      <Link className="dj-primary" to="/live?focus=1">Entrer en Focus <FiArrowUpRight aria-hidden="true" /></Link>
    </div></header>
    {query.isLoading ? <div className="dj-loading" role="status" aria-busy="true">Chargement de votre séance…</div> : null}
    {query.isError ? <JourneyMessage title="Accueil momentanément indisponible" retry={() => void query.refetch()}>Les dernières informations n’ont pas pu être vérifiées. Le Live et les dossiers restent accessibles depuis la navigation.</JourneyMessage> : null}
    {envelope && !query.isError ? <>
      <div className="dj-policy"><strong>{operatorCode(envelope.data.mode.environment)}</strong><span>{operatorCode(envelope.data.mode.executionMode)}</span><span>{envelope.data.mode.liveBroker === "OFF" ? "Exécution réelle désactivée" : envelope.data.mode.liveBroker === "ON" ? "Exécution réelle activée" : "Exécution réelle · état non publié"}</span></div>
      <JourneyFreshness meta={envelope.meta} />
      <nav className="dh-summary" aria-label="Priorités de séance">{homeSummary(envelope).map((metric) => <JourneyLink key={metric.label} to={metric.to} data-tone={metric.tone}><span>{metric.label}</span><strong>{metric.value}</strong><FiArrowUpRight aria-hidden="true" /></JourneyLink>)}</nav>
      <div className="dh-main"><HomeAttention data={envelope.data} current={!query.isError && !envelope.meta.stale && envelope.meta.availability === "AVAILABLE"} /><HomeMarkets market={envelope.data.market} /></div>
      <HomeActivity data={envelope.data} />
    </> : null}
    <nav className="dh-destinations" aria-label="Prolonger la séance"><Link to="/live"><strong>Live</strong><span>Vue d’ensemble des marchés et de l’activité</span><FiArrowUpRight aria-hidden="true" /></Link><JourneyLink to="/portfolio"><strong>Portefeuille</strong><span>Positions, exposition et protection</span><FiArrowUpRight aria-hidden="true" /></JourneyLink><Link to="/command-center?view=supervision"><strong>Supervision détaillée</strong><span>Services, recherche, données et journal technique</span><FiArrowUpRight aria-hidden="true" /></Link></nav>
  </div>;
}
