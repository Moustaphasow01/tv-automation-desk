import { useNavigate } from "react-router-dom";
import { useOverlay } from "@/context/OverlayContext";
import { useDeskContext } from "@/context/DeskContext";
import { DeskPage } from "@/pages/pageState";
import { LiveDeskScreen } from "@/screens/live";
import type { TimelineEvent } from "@/types";

export default function LiveDeskPage() {
  const navigate = useNavigate();
  const overlay = useOverlay();
  const { phaseLabel } = useDeskContext();

  const openTimelineEvent = (event: TimelineEvent) => {
    overlay.openModal(event.title, <div>
      <section className="drawer-section">
        <p>{event.summary}</p>
        <div className="detail-pairs">
          <div><span>Heure</span><strong>{event.time}</strong></div>
          <div><span>Type</span><strong>{event.type}</strong></div>
          <div><span>Statut</span><strong>{event.status}</strong></div>
        </div>
      </section>
      <section className="drawer-section"><h3>Détail</h3><p>{event.detail}</p></section>
    </div>);
  };

  return <DeskPage>{(data, meta) => <LiveDeskScreen
    data={data}
    phaseLabel={phaseLabel}
    refreshing={meta.isFetching}
    dataUpdatedAt={meta.dataUpdatedAt}
    onRefresh={() => void meta.refetch()}
    actions={{
      openJournal: () => navigate("/timeline"),
      openSetup: () => navigate("/setup"),
      openThesis: () => navigate("/thesis"),
      openAudit: () => navigate("/audit"),
      openNews: () => navigate("/news"),
      openTimelineEvent
    }}
  />}</DeskPage>;
}
