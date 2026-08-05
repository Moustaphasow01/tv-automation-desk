import { deskDetailScope, useTimelineDetail } from "@/hooks/useDesk";
import { TimelineTab } from "@/screens/live/tabs/TimelineTab";
import type { DeskSession, TimelineEvent } from "@/types";

export function TimelineTabContainer({ data: initialData, onSelect }: { data: DeskSession; onSelect: (event: TimelineEvent) => void }) {
  const query = useTimelineDetail(deskDetailScope(initialData));
  const sourceTimeline = query.data?.timeline || initialData.timeline;
  return <TimelineTab data={initialData} sourceTimeline={sourceTimeline} onRefetch={() => query.refetch()} onSelect={onSelect}/>;
}
