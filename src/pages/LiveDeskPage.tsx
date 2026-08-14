import { useNavigate, useParams } from "react-router-dom";
import { useOverlay } from "@/context/OverlayContext";
import { useDeskContext } from "@/context/DeskContext";
import { useExecutionOverview } from "@/hooks/useExecution";
import { DeskPage } from "@/pages/pageState";
import { MasterTabContainer } from "@/pages/live/MasterTabContainer";
import { MonitorsTabContainer } from "@/pages/live/MonitorsTabContainer";
import { SessionsTabContainer } from "@/pages/live/SessionsTabContainer";
import { SetupExecutionContainer } from "@/pages/live/SetupExecutionContainer";
import { ThesisTabContainer } from "@/pages/live/ThesisTabContainer";
import { TimelineTabContainer } from "@/pages/live/TimelineTabContainer";
import { NewsTab } from "@/screens/live/tabs/NewsTab";
import { LiveDeskScreen } from "@/screens/live";
import type { LiveTabDefinition } from "@/screens/live/LiveDeskScreen.types";
import type { DeskSession, TimelineEvent } from "@/types";

const liveTabs: LiveTabDefinition[] = [
  { id: "thesis", label: "Lecture" },
  { id: "master", label: "Master" },
  { id: "monitors", label: "Monitors" },
  { id: "news", label: "Risque" },
  { id: "timeline", label: "Journal" },
  { id: "sessions", label: "Sessions" }
];

function activeTabContentFor(activeTab: string, data: DeskSession, onSelectTimelineEvent: (event: TimelineEvent) => void) {
  if (activeTab === "master") return <MasterTabContainer data={data}/>;
  if (activeTab === "monitors") return <MonitorsTabContainer data={data}/>;
  if (activeTab === "news") return <NewsTab data={data}/>;
  if (activeTab === "timeline") return <TimelineTabContainer data={data} onSelect={onSelectTimelineEvent}/>;
  if (activeTab === "sessions") return <SessionsTabContainer/>;
  return <ThesisTabContainer data={data}/>;
}

export default function LiveDeskPage() {
  const navigate = useNavigate();
  const overlay = useOverlay();
  const { phaseLabel } = useDeskContext();
  const { tab } = useParams<{ tab?: string }>();
  const activeTab = tab || "thesis";
  const executionOverview = useExecutionOverview();

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
    refreshing={meta.isFetching || executionOverview.isFetching}
    dataUpdatedAt={Math.max(meta.dataUpdatedAt, executionOverview.dataUpdatedAt)}
    executionOverview={executionOverview.data}
    onRefresh={() => void Promise.all([meta.refetch(), executionOverview.refetch()])}
    tabs={liveTabs}
    activeTab={activeTab}
    activeTabContent={activeTabContentFor(activeTab, data, openTimelineEvent)}
    executionContent={<SetupExecutionContainer data={data}/>}
    actions={{
      openJournal: () => navigate("/live/timeline"),
      openSetup: () => document.getElementById("live-execution")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      openThesis: () => navigate("/live/thesis"),
      openAudit: () => navigate("/audit"),
      openTimelineEvent,
      onChangeTab: id => navigate(`/live/${id}`)
    }}
  />}</DeskPage>;
}
