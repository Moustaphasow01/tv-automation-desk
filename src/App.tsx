import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout";
import { OverlayProvider } from "@/context/OverlayContext";

const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const LiveDeskPage = lazy(() => import("@/pages/LiveDeskPage"));
const SessionsPage = lazy(() => import("@/pages/SessionsPage"));
const MasterPage = lazy(() => import("@/pages/MasterPage"));
const MonitorsPage = lazy(() => import("@/pages/MonitorsPage"));
const ThesisPage = lazy(() => import("@/pages/ThesisPage"));
const SetupPage = lazy(() => import("@/pages/SetupPage"));
const TimelinePage = lazy(() => import("@/pages/TimelinePage"));
const NewsPage = lazy(() => import("@/pages/NewsPage"));
const AuditPage = lazy(() => import("@/pages/AuditPage"));
const AlertsPage = lazy(() => import("@/pages/AlertsPage"));
const MorePage = lazy(() => import("@/pages/MorePage"));
const PerformanceCalendarPage = lazy(() => import("@/pages/PerformanceCalendarPage"));
const OperationsPage = lazy(() => import("@/pages/OperationsPage"));
const WorkflowDetailPage = lazy(() => import("@/pages/WorkflowDetailPage"));
const ReplayLabPage = lazy(() => import("@/pages/ReplayLabPage"));
const ReplayRunPage = lazy(() => import("@/pages/ReplayRunPage"));
const ReplayDayPage = lazy(() => import("@/pages/ReplayDayPage"));
const ReplaySessionPage = lazy(() => import("@/pages/ReplaySessionPage"));
const GptProcessPage = lazy(() => import("@/pages/GptProcessPage"));
const IncidentsPage = lazy(() => import("@/pages/IncidentsPage"));
const IncidentZoomPage = lazy(() =>
  import("@/pages/IncidentsPage").then((module) => ({ default: module.IncidentZoomPage })),
);
const PerformanceAnalysisPage = lazy(() => import("@/pages/PerformanceAnalysisPage"));
const ReplayComparePage = lazy(() => import("@/pages/ReplayComparePage"));
const HistoryPage = lazy(() => import("@/pages/HistoryPage"));
const StrategiesPage = lazy(() => import("@/pages/StrategiesPage"));
const WorkflowEventPage = lazy(() => import("@/pages/WorkflowEventPage"));
const StrategyDetailPage = lazy(() => import("@/pages/StrategyDetailPage"));
const HistorySessionPage = lazy(() => import("@/pages/HistorySessionPage"));
const ObservabilityPage = lazy(() => import("@/pages/ObservabilityPage"));
const NotificationsPage = lazy(() => import("@/pages/NotificationsPage"));
const NotificationZoomPage = lazy(() =>
  import("@/pages/NotificationsPage").then((module) => ({ default: module.NotificationZoomPage })),
);
const RunbooksPage = lazy(() => import("@/pages/RunbooksPage"));
const RunbookZoomPage = lazy(() =>
  import("@/pages/RunbooksPage").then((module) => ({ default: module.RunbookZoomPage })),
);
const ExecutionConsolePage = lazy(() => import("@/pages/ExecutionConsolePage"));
const PortfolioRiskPage = lazy(() => import("@/pages/PortfolioRiskPage"));
const AiContextPage = lazy(() => import("@/pages/AiContextPage"));
const ClaimLanesPage = lazy(() => import("@/pages/ClaimLanesPage"));
const AgentRuntimePage = lazy(() => import("@/pages/AgentRuntimePage"));
const DataFoundationPage = lazy(() => import("@/pages/DataFoundationPage"));
const PromptRegistryPage = lazy(() => import("@/pages/PromptRegistryPage"));
const ResearchLabPage = lazy(() => import("@/pages/ResearchLabPage"));
const ResearchExperimentZoomPage = lazy(() =>
  import("@/pages/ResearchLabPage").then((module) => ({ default: module.ResearchExperimentZoomPage })),
);
const ResearchCandidateZoomPage = lazy(() =>
  import("@/pages/ResearchLabPage").then((module) => ({ default: module.ResearchCandidateZoomPage })),
);

function RouteFallback() {
  return (
    <section className="route-fallback" aria-live="polite" aria-busy="true">
      <span className="route-fallback__pulse" />
      <div>
        <p>Chargement écran</p>
        <small>Découpage route actif · bundle optimisé</small>
      </div>
    </section>
  );
}

function routeElement(Page: ComponentType): ReactNode {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Page />
    </Suspense>
  );
}

export default function App() {
  return <OverlayProvider><Routes>
    <Route element={<AppShell/>}>
      <Route index element={<Navigate to="/live" replace/>}/>
      <Route path="/dashboard" element={routeElement(DashboardPage)}/>
      <Route path="/live" element={<Navigate to="/live/thesis" replace/>}/>
      <Route path="/live/:tab" element={routeElement(LiveDeskPage)}/>
      <Route path="/sessions" element={routeElement(SessionsPage)}/>
      <Route path="/master" element={routeElement(MasterPage)}/>
      <Route path="/monitors" element={routeElement(MonitorsPage)}/>
      <Route path="/thesis" element={routeElement(ThesisPage)}/>
      <Route path="/setup" element={routeElement(SetupPage)}/>
      <Route path="/timeline" element={routeElement(TimelinePage)}/>
      <Route path="/news" element={routeElement(NewsPage)}/>
      <Route path="/audit" element={routeElement(AuditPage)}/>
      <Route path="/alerts" element={routeElement(AlertsPage)}/>
      <Route path="/performance" element={routeElement(PerformanceCalendarPage)}/>
      <Route path="/operations" element={routeElement(OperationsPage)}/>
      <Route path="/operations/observability" element={routeElement(ObservabilityPage)}/>
      <Route path="/operations/incidents" element={routeElement(IncidentsPage)}/>
      <Route path="/operations/incidents/:incidentId" element={routeElement(IncidentZoomPage)}/>
      <Route path="/operations/notifications" element={routeElement(NotificationsPage)}/>
      <Route path="/operations/notifications/:notificationId" element={routeElement(NotificationZoomPage)}/>
      <Route path="/operations/runbooks" element={routeElement(RunbooksPage)}/>
      <Route path="/operations/runbooks/:runbookId" element={routeElement(RunbookZoomPage)}/>
      <Route path="/operations/execution" element={routeElement(ExecutionConsolePage)}/>
      <Route path="/operations/portfolio-risk" element={routeElement(PortfolioRiskPage)}/>
      <Route path="/operations/portfolio-risk/:sectionId" element={routeElement(PortfolioRiskPage)}/>
      <Route path="/operations/ai-context" element={routeElement(AiContextPage)}/>
      <Route path="/operations/claim-lanes" element={routeElement(ClaimLanesPage)}/>
      <Route path="/operations/agents" element={routeElement(AgentRuntimePage)}/>
      <Route path="/operations/workflows/:workflowId" element={routeElement(WorkflowDetailPage)}/>
      <Route path="/operations/workflows/:workflowId/events/:eventId" element={routeElement(WorkflowEventPage)}/>
      <Route path="/replay" element={routeElement(ReplayLabPage)}/>
      <Route path="/replay/compare" element={routeElement(ReplayComparePage)}/>
      <Route path="/replay/runs/:runId" element={routeElement(ReplayRunPage)}/>
      <Route path="/replay/runs/:runId/days/:date" element={routeElement(ReplayDayPage)}/>
      <Route path="/replay/runs/:runId/days/:date/sessions/:sessionExecutionId" element={routeElement(ReplaySessionPage)}/>
      <Route path="/replay/runs/:runId/gpt/:processId" element={routeElement(GptProcessPage)}/>
      <Route path="/performance/analysis" element={routeElement(PerformanceAnalysisPage)}/>
      <Route path="/history" element={routeElement(HistoryPage)}/>
      <Route path="/history/sessions/:sessionId" element={routeElement(HistorySessionPage)}/>
      <Route path="/strategies" element={routeElement(StrategiesPage)}/>
      <Route path="/strategies/:strategyId" element={routeElement(StrategyDetailPage)}/>
      <Route path="/prompt-registry" element={routeElement(PromptRegistryPage)}/>
      <Route path="/data-foundation" element={routeElement(DataFoundationPage)}/>
      <Route path="/research" element={routeElement(ResearchLabPage)}/>
      <Route path="/research/experiments/:experimentId" element={routeElement(ResearchExperimentZoomPage)}/>
      <Route path="/research/candidates/:candidateId" element={routeElement(ResearchCandidateZoomPage)}/>
      <Route path="/more" element={routeElement(MorePage)}/>
    </Route>
    <Route path="*" element={<Navigate to="/live" replace/>}/>
  </Routes></OverlayProvider>;
}
