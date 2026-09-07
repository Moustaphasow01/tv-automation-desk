import { useContext, useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { DeskConfigContext } from "@/app/AppProviders";
import { createDeskTransport, type DeskTransport, type OperatorLoginCredentials } from "@/shared/transport";
import type { CommandAccepted, SubmitDeskCommandInput } from "@/domains/realtime/commandRuntime";
import { assertViewEnvelope, type FrontViewName, type ViewEnvelope } from "@/shared/contracts";
import {
  isAdminAccessView,
  isAuthSessionView,
  isCommandCenterView,
  isDemoPaperReadinessView,
  isExecutionIncidentsView,
  isExecutionProvidersView,
  isEventsAuditView,
  isExplorerView,
  isJarvisWorkspaceView,
  isLiveSignalDetailView,
  isLiveNewsView,
  isLivePlanView,
  isLiveTimelineView,
  isLiveTradingView,
  isLiveFocusView,
  isOrderDetailView,
  isPositionDetailView,
  isIncidentDetailView,
  isOperationsQueueView,
  isOperationsObservabilityView,
  isOperatorSettingsView,
  isOrdersView,
  isPerformanceView,
  isReplayOverviewView,
  isResearchAgentFleetView,
  isResearchComputeSchedulerView,
  isResearchDataCatalogView,
  isResearchExperimentDetailView,
  isPortfolioView,
  isExecutionReconciliationView,
  isRiskView,
  isResearchLabView,
  isResearchRunDetailView,
  isStrategyCenterView,
  isStrategyCompareView,
  isStrategyDetailView,
  isSessionsView,
  type ControlPlaneViews
} from "@/domains/front-api/viewModels";

type ViewValidators = {
  [ViewName in keyof ControlPlaneViews]: (candidate: unknown) => candidate is ControlPlaneViews[ViewName];
};

const validators: ViewValidators = {
  "auth-session": isAuthSessionView,
  "operator-settings": isOperatorSettingsView,
  "admin-access": isAdminAccessView,
  "command-center": isCommandCenterView,
  "demo-paper-readiness": isDemoPaperReadinessView,
  "events-audit": isEventsAuditView,
  "operations-queue": isOperationsQueueView,
  "research-agent-fleet": isResearchAgentFleetView,
  "research-compute-scheduler": isResearchComputeSchedulerView,
  "research-data-catalog": isResearchDataCatalogView,
  "research-experiment-detail": isResearchExperimentDetailView,
  "research-run-detail": isResearchRunDetailView,
  "research-lab": isResearchLabView,
  "strategy-center": isStrategyCenterView,
  "strategy-detail": isStrategyDetailView,
  "strategy-compare": isStrategyCompareView,
  "live-trading": isLiveTradingView,
  "live-focus": isLiveFocusView,
  "live-plan": isLivePlanView,
  "live-news": isLiveNewsView,
  "live-timeline": isLiveTimelineView,
  "live-signal-detail": isLiveSignalDetailView,
  "order-detail": isOrderDetailView,
  "position-detail": isPositionDetailView,
  "incident-detail": isIncidentDetailView,
  orders: isOrdersView,
  risk: isRiskView,
  "execution-providers": isExecutionProvidersView,
  "execution-incidents": isExecutionIncidentsView,
  portfolio: isPortfolioView,
  sessions: isSessionsView,
  "execution-reconciliation": isExecutionReconciliationView,
  "operations-observability": isOperationsObservabilityView,
  "research-experiments": isExplorerView,
  "research-candidates": isExplorerView,
  "research-dataset-detail": isExplorerView,
  "strategy-deployments": isExplorerView,
  "replay-overview": isReplayOverviewView,
  "replay-runs": isExplorerView,
  "replay-run-detail": isExplorerView,
  "replay-compare": isExplorerView,
  "performance-overview": isPerformanceView,
  "performance-calendar": isExplorerView,
  "performance-day-detail": isExplorerView,
  "performance-strategies": isExplorerView,
  "performance-trades": isExplorerView,
  "workflow-detail": isExplorerView,
  "event-detail": isExplorerView,
  "operations-runbooks": isExplorerView,
  "governance-prompts": isExplorerView,
  "governance-policies": isExplorerView,
  "jarvis-workspace": isJarvisWorkspaceView
};

export class FrontViewRepository {
  constructor(private readonly transport: DeskTransport) {}

  async getView<ViewName extends keyof ControlPlaneViews & FrontViewName>(
    viewName: ViewName,
    params: Readonly<Record<string, string | undefined>> = {},
    signal?: AbortSignal,
  ): Promise<ViewEnvelope<ControlPlaneViews[ViewName]>> {
    const raw = await this.transport.getView<ControlPlaneViews[ViewName]>(viewName, params, signal);
    return assertViewEnvelope(raw, validators[viewName]);
  }

  async submitCommand(input: SubmitDeskCommandInput): Promise<CommandAccepted> {
    return this.transport.submitCommand(input);
  }

  async getCommand(commandId: string) {
    return this.transport.getCommand(commandId);
  }

  async getCapabilities() {
    return this.transport.getCapabilities();
  }

  async loginOperator(credentials: OperatorLoginCredentials | string) {
    return this.transport.loginOperator(credentials);
  }

  async logoutOperator() {
    return this.transport.logoutOperator();
  }
}

export function useFrontViewRepository() {
  const config = useContext(DeskConfigContext);

  return useMemo(() => {
    if (!config) {
      throw new Error("DESK_CONFIG_CONTEXT_MISSING");
    }

    return new FrontViewRepository(createDeskTransport(config));
  }, [config]);
}

export function useFrontView<ViewName extends keyof ControlPlaneViews & FrontViewName>(
  viewName: ViewName,
  params: Readonly<Record<string, string | undefined>> = {},
  options: { preservePreviousData?: boolean; queryScope?: string; refetchInterval?: number | false; enabled?: boolean } = {},
) {
  const repository = useFrontViewRepository();
  const stableParams = Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])).sort(([left], [right]) => left.localeCompare(right));

  return useQuery({
    queryKey: frontViewQueryKey(viewName, stableParams, options.queryScope),
    queryFn: ({ signal }) => repository.getView(viewName, Object.fromEntries(stableParams), signal),
    placeholderData: options.preservePreviousData ? keepPreviousData : undefined,
    refetchInterval: options.refetchInterval,
    enabled: options.enabled ?? true,
  });
}

export function frontViewQueryKey(
  viewName: FrontViewName,
  stableParams: readonly (readonly [string, string])[] = [],
  queryScope?: string,
) {
  return queryScope
    ? frontViewQueryKeys.scoped(queryScope, viewName, stableParams)
    : frontViewQueryKeys.view(viewName, stableParams);
}

export const frontViewQueryKeys = {
  view: (viewName: FrontViewName, stableParams: readonly (readonly [string, string])[] = []) =>
    ["front-view", viewName, stableParams] as const,
  scoped: (queryScope: string, viewName: FrontViewName, stableParams: readonly (readonly [string, string])[] = []) =>
    ["front-view-scope", queryScope, viewName, stableParams] as const,
};

export type FrontViewScopeMatch = "DESK_ONLY" | "INCLUDING_MARKET_SERIES";

export function matchesFrontViewQuery(
  queryKey: readonly unknown[],
  viewNames: readonly FrontViewName[],
  scopeMatch: FrontViewScopeMatch = "DESK_ONLY",
): boolean {
  if (queryKey[0] === "front-view") return viewNames.includes(queryKey[1] as FrontViewName);
  if (queryKey[0] !== "front-view-scope") return false;
  if (scopeMatch === "DESK_ONLY" && queryKey[1] === "market-series") return false;
  return viewNames.includes(queryKey[2] as FrontViewName);
}

export function useCommandStatus(commandId: string | null) {
  const repository = useFrontViewRepository();
  return useQuery({
    queryKey: ["front-command", commandId],
    queryFn: () => repository.getCommand(commandId as string),
    enabled: Boolean(commandId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ["SUCCEEDED", "FAILED", "CANCELLED", "CONFLICT", "REJECTED", "TIMED_OUT"].includes(status) ? false : 1_000;
    }
  });
}

export function useCapabilityCatalog() {
  const repository = useFrontViewRepository();
  return useQuery({
    queryKey: ["front-capabilities"],
    queryFn: () => repository.getCapabilities(),
    staleTime: 30_000,
  });
}
