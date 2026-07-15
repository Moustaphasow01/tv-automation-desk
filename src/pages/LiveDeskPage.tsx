import { useNavigate } from "react-router-dom";
import { Icon } from "@/components/common";
import {
  ActivityCard, BriefCard, DeltaCard, HeroCard, LiveSectionHeading, MacroNewsCard,
  MarketStrip, PositionCard, SetupCard, StatusRibbon, ThesisCard, Timeline
} from "@/components/deskCards";
import { useOverlay } from "@/context/OverlayContext";
import { DeskPage } from "@/pages/pageState";

export default function LiveDeskPage() {
  const navigate = useNavigate();
  const overlay = useOverlay();
  return <DeskPage>{data => <section className="view view--live">
    <StatusRibbon data={data}/>
    <HeroCard data={data}/>
    <LiveSectionHeading title="Prix & évolution" subtitle="MNQ, MES, MCL et mega caps · OHLC quotidien, RSI et ATR"/>
    <MarketStrip data={data}/>

    <LiveSectionHeading title="Lecture du Desk" subtitle="Faits, interprétation et évolution de la thèse"/>
    <div className="content-grid content-grid--briefs">
      <BriefCard eyebrow="Marché" headline={data.marketBrief.headline} text={data.marketBrief.text} verdict={data.marketBrief.verdict} icon="chart"/>
      <BriefCard eyebrow="Cross-asset" headline={data.crossAssetBrief.headline} text={data.crossAssetBrief.text} verdict={data.crossAssetBrief.verdict} icon="globe"/>
    </div>

    <DeltaCard data={data}/>
    <div className="content-grid">
      <ThesisCard data={data}/>
      <SetupCard data={data}/>
    </div>
    <PositionCard data={data}/>
    <MacroNewsCard data={data}/>

    <LiveSectionHeading title="Activité & journal" subtitle="Traçabilité des décisions et des workers" action={
      <button className="text-btn" onClick={() => navigate("/timeline")}>Tout voir <Icon name="arrow" size={15}/></button>
    }/>
    <div className="content-grid">
      <ActivityCard data={data}/>
      <article className="card timeline-card">
        <Timeline data={data} compact onSelect={event => overlay.openDrawer(event.title, <div>
          <section className="drawer-section"><p>{event.summary}</p><div className="detail-pairs"><div><span>Heure</span><strong>{event.time}</strong></div><div><span>Type</span><strong>{event.type}</strong></div><div><span>Statut</span><strong>{event.status}</strong></div></div></section>
          <section className="drawer-section"><h3>Détail</h3><p>{event.detail}</p></section>
        </div>)}/>
      </article>
    </div>
  </section>}</DeskPage>;
}
