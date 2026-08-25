import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppProviders } from "@/app/AppProviders";
import { vnextRoutes } from "@/app/routes";
import { OperatorLoginGate, PermissionGate } from "@/domains/permissions/PermissionGate";
import { DeskDensityViewport } from "@/shell/DeskDensityViewport";
import { DeskShell } from "@/shell/DeskShell";
import { CapabilityUnavailablePage } from "@/pages/CapabilityUnavailablePage";
import { DeskRouteErrorBoundary } from "@/app/RouteErrorBoundary";

type PageComponent = ComponentType<Record<string, never>>;
const page = <Module extends Record<string, unknown>>(loader: () => Promise<Module>, exportName: keyof Module) =>
  lazy(async () => ({ default: (await loader())[exportName] as PageComponent }));

const pages: Record<string, LazyExoticComponent<PageComponent>> = {
  auth: page(() => import("@/pages/AuthSessionPage"), "AuthSessionPage"),
  portfolio: page(() => import("@/pages/PortfolioPage"), "PortfolioPage"),
  "command-center": page(() => import("@/pages/CommandCenterPage"), "CommandCenterPage"),
  operations: page(() => import("@/pages/OperationsQueuePage"), "OperationsQueuePage"),
  events: page(() => import("@/pages/EventsAuditPage"), "EventsAuditPage"),
  research: page(() => import("@/pages/ResearchLabPage"), "ResearchLabPage"),
  "research/experiments/:experimentId": page(() => import("@/pages/ResearchExperimentDetailPage"), "ResearchExperimentDetailPage"),
  "research/runs/:runId": page(() => import("@/pages/ResearchRunDetailPage"), "ResearchRunDetailPage"),
  "research/agents": page(() => import("@/pages/ResearchAgentFleetPage"), "ResearchAgentFleetPage"),
  "research/data": page(() => import("@/pages/ResearchDataCatalogPage"), "ResearchDataCatalogPage"),
  "research/compute": page(() => import("@/pages/ResearchComputeSchedulerPage"), "ResearchComputeSchedulerPage"),
  "research/experiments": page(() => import("@/pages/ExplorerPages"), "ResearchExperimentsPage"),
  "research/candidates": page(() => import("@/pages/ExplorerPages"), "ResearchCandidatesPage"),
  "research/data/:datasetId": page(() => import("@/pages/ExplorerPages"), "ResearchDatasetDetailPage"),
  strategies: page(() => import("@/pages/StrategyCenterPage"), "StrategyCenterPage"),
  "strategies/:strategyId": page(() => import("@/pages/StrategyDetailPage"), "StrategyDetailPage"),
  "strategies/:strategyId/compare": page(() => import("@/pages/StrategyComparePage"), "StrategyComparePage"),
  "strategies/deployments": page(() => import("@/pages/ExplorerPages"), "StrategyDeploymentsPage"),
  live: page(() => import("@/pages/LiveTradingPage"), "LiveTradingPage"),
  "live/signals": page(() => import("@/pages/LiveSignalsPage"), "LiveSignalsPage"),
  sessions: page(() => import("@/pages/OperationalP0Pages"), "SessionsPage"),
  "live/plan": page(() => import("@/pages/OperationalP0Pages"), "LivePlanPage"),
  "live/news": page(() => import("@/pages/OperationalP0Pages"), "LiveNewsPage"),
  "live/timeline": page(() => import("@/pages/OperationalP0Pages"), "LiveTimelinePage"),
  "demo-paper-readiness": page(() => import("@/pages/DemoPaperReadinessPage"), "DemoPaperReadinessPage"),
  "live/signals/:signalId": page(() => import("@/pages/LiveSignalDetailPage"), "LiveSignalDetailPage"),
  "execution/orders/:orderId": page(() => import("@/pages/OrderDetailPage"), "OrderDetailPage"),
  "execution/portfolio/positions/:positionId": page(() => import("@/pages/PositionDetailPage"), "PositionDetailPage"),
  "operations/incidents/:incidentId": page(() => import("@/pages/IncidentDetailPage"), "IncidentDetailPage"),
  orders: page(() => import("@/pages/OrdersPage"), "OrdersPage"),
  risk: page(() => import("@/pages/RiskCenterPage"), "RiskCenterPage"),
  "execution/providers": page(() => import("@/pages/ExecutionProvidersPage"), "ExecutionProvidersPage"),
  "execution/incidents": page(() => import("@/pages/ExecutionIncidentsPage"), "ExecutionIncidentsPage"),
  "execution/reconciliation": page(() => import("@/pages/OperationalP0Pages"), "ExecutionReconciliationPage"),
  "operations/observability": page(() => import("@/pages/OperationalP0Pages"), "OperationsObservabilityPage"),
  replay: page(() => import("@/pages/ReplayPage"), "ReplayPage"),
  "replay/runs": page(() => import("@/pages/ExplorerPages"), "ReplayRunsPage"),
  "replay/runs/:runId": page(() => import("@/pages/ExplorerPages"), "ReplayRunDetailPage"),
  "replay/compare": page(() => import("@/pages/ExplorerPages"), "ReplayComparePage"),
  performance: page(() => import("@/pages/PerformancePage"), "PerformancePage"),
  "performance/calendar": page(() => import("@/pages/ExplorerPages"), "PerformanceCalendarPage"),
  "performance/days/:dayId": page(() => import("@/pages/ExplorerPages"), "PerformanceDayDetailPage"),
  "performance/strategies": page(() => import("@/pages/ExplorerPages"), "PerformanceStrategiesPage"),
  "performance/trades": page(() => import("@/pages/ExplorerPages"), "PerformanceTradesPage"),
  "operations/workflows/:workflowId": page(() => import("@/pages/ExplorerPages"), "WorkflowDetailPage"),
  "operations/events/:eventId": page(() => import("@/pages/ExplorerPages"), "EventDetailPage"),
  "operations/runbooks": page(() => import("@/pages/ExplorerPages"), "OperationsRunbooksPage"),
  "operations/incidents": page(() => import("@/pages/ExecutionIncidentsPage"), "ExecutionIncidentsPage"),
  "operations/events": page(() => import("@/pages/EventsAuditPage"), "EventsAuditPage"),
  "execution/orders": page(() => import("@/pages/OrdersPage"), "OrdersPage"),
  "execution/portfolio": page(() => import("@/pages/PortfolioPage"), "PortfolioPage"),
  "execution/risk": page(() => import("@/pages/RiskCenterPage"), "RiskCenterPage"),
  "governance/access": page(() => import("@/pages/AdminAccessPage"), "AdminAccessPage"),
  "governance/administration": page(() => import("@/pages/AdminAccessPage"), "AdminAccessPage"),
  "governance/prompts": page(() => import("@/pages/ExplorerPages"), "GovernancePromptsPage"),
  "governance/policies": page(() => import("@/pages/ExplorerPages"), "GovernancePoliciesPage"),
  settings: page(() => import("@/pages/OperatorSettingsPage"), "OperatorSettingsPage"),
  admin: page(() => import("@/pages/AdminAccessPage"), "AdminAccessPage"),
  jarvis: page(() => import("@/pages/JarvisWorkspacePage"), "JarvisWorkspacePage")
};
const SkeletonPage = lazy(async () => ({ default: (await import("@/pages/SkeletonPage")).SkeletonPage }));

function RouteLoading() {
  return <main className="route-loading" aria-busy="true" aria-live="polite"><span>Chargement de la vue…</span></main>;
}

export function App() {
  return (
    <AppProviders>
      <DeskDensityViewport>
        <HashRouter>
          <Suspense fallback={<RouteLoading />}>
            <OperatorLoginGate>
            <DeskRouteErrorBoundary>
            <Routes>
              <Route element={<DeskShell />}>
                <Route index element={<Navigate to="/command-center" replace />} />
                {vnextRoutes.map((route) => {
                  const Page = pages[route.path];
                  return <Route key={route.path} path={route.path} element={<PermissionGate capability={route.capability}>{Page ? <Page /> : <CapabilityUnavailablePage route={route} />}</PermissionGate>} />;
                })}
                <Route path="*" element={<SkeletonPage route={null} />} />
              </Route>
            </Routes>
            </DeskRouteErrorBoundary>
            </OperatorLoginGate>
          </Suspense>
        </HashRouter>
      </DeskDensityViewport>
    </AppProviders>
  );
}
