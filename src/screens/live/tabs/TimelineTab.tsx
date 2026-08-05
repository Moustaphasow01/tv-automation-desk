import { useMemo, useState } from "react";
import { Card, Icon } from "@/components/common";
import { LiveSectionHeading, Timeline } from "@/components/deskCards";
import type { DeskSession, TimelineEvent } from "@/types";

export function TimelineTab({
  data: initialData,
  sourceTimeline,
  onRefetch,
  onSelect
}: {
  data: DeskSession;
  sourceTimeline: DeskSession["timeline"];
  onRefetch: () => void;
  onSelect: (event: TimelineEvent) => void;
}) {
  const [search, setSearch] = useState("");
  const [depth, setDepth] = useState(80);
  const filteredTimeline = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? sourceTimeline.filter(event => [event.title, event.summary, event.detail, event.type, event.status, event.sourceType].filter(Boolean).join(" ").toLowerCase().includes(q)) : sourceTimeline;
    return filtered.slice(-depth);
  }, [sourceTimeline, search, depth]);
  const data = { ...initialData, timeline: filteredTimeline };

  return <>
    <LiveSectionHeading title="Journal de décision" subtitle="Master → Thèse → Monitor → Setup → Position"/>
    <Card className="timeline-command-bar">
      <label><span>Recherche timeline</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Décision, source, statut…"/></label>
      <label><span>Zoom historique</span><input type="range" min="20" max="300" step="20" value={depth} onChange={event => setDepth(Number(event.target.value))}/></label>
      <strong>{filteredTimeline.length}/{sourceTimeline.length} événements</strong>
      <button className="secondary-btn" type="button" onClick={onRefetch}><Icon name="refresh" size={14}/>Actualiser</button>
    </Card>
    <Card className="timeline-page-card">
      <Timeline data={data} onSelect={onSelect}/>
    </Card>
  </>;
}
