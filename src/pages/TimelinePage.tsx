import { useMemo, useState } from "react";
import { Card } from "@/components/common";
import { Icon } from "@/components/common";
import { PageHeading } from "@/components/operations";
import { Timeline } from "@/components/deskCards";
import { useOverlay } from "@/context/OverlayContext";
import { deskDetailScope, useTimelineDetail } from "@/hooks/useDesk";
import { DeskPage } from "@/pages/pageState";
import type { DeskSession } from "@/types";

export default function TimelinePage() {
  const overlay = useOverlay();
  return <DeskPage>{data => <TimelineWorkspace initialData={data} onSelect={event => overlay.openDrawer(event.title, <div>
    <section className="drawer-section"><p>{event.summary}</p></section>
    <section className="drawer-section"><div className="detail-pairs"><div><span>Heure</span><strong>{event.time}</strong></div><div><span>Source</span><strong>{event.sourceType}</strong></div><div><span>Statut</span><strong>{event.status}</strong></div></div></section>
    <section className="drawer-section"><h3>Trace</h3><p>{event.detail}</p></section>
  </div>)}/>}</DeskPage>;
}

function TimelineWorkspace({ initialData, onSelect }: { initialData: DeskSession; onSelect: (event: DeskSession["timeline"][number]) => void }) {
  const query = useTimelineDetail(deskDetailScope(initialData));
  const [search, setSearch] = useState("");
  const [depth, setDepth] = useState(80);
  const sourceTimeline = query.data?.timeline || initialData.timeline;
  const filteredTimeline = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? sourceTimeline.filter(event => [event.title, event.summary, event.detail, event.type, event.status, event.sourceType].filter(Boolean).join(" ").toLowerCase().includes(q)) : sourceTimeline;
    return filtered.slice(-depth);
  }, [sourceTimeline, search, depth]);
  const data = { ...initialData, timeline: filteredTimeline };
  return <section className="view">
    <PageHeading eyebrow="Traçabilité" title="Journal de décision" subtitle="Master → Thèse → Monitor → Setup → Position"/>
    <Card className="timeline-command-bar">
      <label><span>Recherche timeline</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Décision, source, statut…"/></label>
      <label><span>Zoom historique</span><input type="range" min="20" max="300" step="20" value={depth} onChange={event => setDepth(Number(event.target.value))}/></label>
      <strong>{filteredTimeline.length}/{sourceTimeline.length} événements</strong>
      <button className="secondary-btn" type="button" onClick={() => query.refetch()}><Icon name="refresh" size={14}/>Actualiser</button>
    </Card>
    <Card className="timeline-page-card">
      <Timeline data={data} onSelect={onSelect}/>
    </Card>
  </section>;
}
