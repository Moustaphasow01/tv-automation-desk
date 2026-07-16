import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout";
import { OverlayProvider } from "@/context/OverlayContext";
import LiveDeskPage from "@/pages/LiveDeskPage";
import SessionsPage from "@/pages/SessionsPage";
import MasterPage from "@/pages/MasterPage";
import MonitorsPage from "@/pages/MonitorsPage";
import ThesisPage from "@/pages/ThesisPage";
import SetupPage from "@/pages/SetupPage";
import TimelinePage from "@/pages/TimelinePage";
import NewsPage from "@/pages/NewsPage";
import AuditPage from "@/pages/AuditPage";
import AlertsPage from "@/pages/AlertsPage";
import MorePage from "@/pages/MorePage";
import PerformanceCalendarPage from "@/pages/PerformanceCalendarPage";
import OperationsPage from "@/pages/OperationsPage";
import WorkflowDetailPage from "@/pages/WorkflowDetailPage";
import ReplayLabPage from "@/pages/ReplayLabPage";
import ReplayRunPage from "@/pages/ReplayRunPage";
import ReplayDayPage from "@/pages/ReplayDayPage";
import ReplaySessionPage from "@/pages/ReplaySessionPage";
import GptProcessPage from "@/pages/GptProcessPage";
import IncidentsPage from "@/pages/IncidentsPage";
import PerformanceAnalysisPage from "@/pages/PerformanceAnalysisPage";
import ReplayComparePage from "@/pages/ReplayComparePage";
import HistoryPage from "@/pages/HistoryPage";
import StrategiesPage from "@/pages/StrategiesPage";
import WorkflowEventPage from "@/pages/WorkflowEventPage";
import StrategyDetailPage from "@/pages/StrategyDetailPage";
import HistorySessionPage from "@/pages/HistorySessionPage";

export default function App() {
  return <OverlayProvider><Routes>
    <Route element={<AppShell/>}>
      <Route index element={<Navigate to="/live" replace/>}/>
      <Route path="/live" element={<LiveDeskPage/>}/>
      <Route path="/sessions" element={<SessionsPage/>}/>
      <Route path="/master" element={<MasterPage/>}/>
      <Route path="/monitors" element={<MonitorsPage/>}/>
      <Route path="/thesis" element={<ThesisPage/>}/>
      <Route path="/setup" element={<SetupPage/>}/>
      <Route path="/timeline" element={<TimelinePage/>}/>
      <Route path="/news" element={<NewsPage/>}/>
      <Route path="/audit" element={<AuditPage/>}/>
      <Route path="/alerts" element={<AlertsPage/>}/>
      <Route path="/performance" element={<PerformanceCalendarPage/>}/>
      <Route path="/operations" element={<OperationsPage/>}/>
      <Route path="/operations/incidents" element={<IncidentsPage/>}/>
      <Route path="/operations/workflows/:workflowId" element={<WorkflowDetailPage/>}/>
      <Route path="/operations/workflows/:workflowId/events/:eventId" element={<WorkflowEventPage/>}/>
      <Route path="/replay" element={<ReplayLabPage/>}/>
      <Route path="/replay/compare" element={<ReplayComparePage/>}/>
      <Route path="/replay/runs/:runId" element={<ReplayRunPage/>}/>
      <Route path="/replay/runs/:runId/days/:date" element={<ReplayDayPage/>}/>
      <Route path="/replay/runs/:runId/days/:date/sessions/:sessionExecutionId" element={<ReplaySessionPage/>}/>
      <Route path="/replay/runs/:runId/gpt/:processId" element={<GptProcessPage/>}/>
      <Route path="/performance/analysis" element={<PerformanceAnalysisPage/>}/>
      <Route path="/history" element={<HistoryPage/>}/>
      <Route path="/history/sessions/:sessionId" element={<HistorySessionPage/>}/>
      <Route path="/strategies" element={<StrategiesPage/>}/>
      <Route path="/strategies/:strategyId" element={<StrategyDetailPage/>}/>
      <Route path="/more" element={<MorePage/>}/>
      <Route path="*" element={<Navigate to="/live" replace/>}/>
    </Route>
  </Routes></OverlayProvider>;
}
