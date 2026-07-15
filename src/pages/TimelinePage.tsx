import { Card, SectionTitle } from "@/components/common";
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
  const data = { ...initialData, timeline: query.data?.timeline || initialData.timeline };
  return <section className="view">
    <SectionTitle title="Journal de décision" subtitle="Master → Thèse → Monitor → Setup → Position"/>
    <Card className="timeline-page-card">
      <Timeline data={data} onSelect={onSelect}/>
    </Card>
  </section>;
}
