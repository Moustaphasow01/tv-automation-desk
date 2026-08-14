import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  isRunningAutomationStatus,
  liveDeskDataAccess,
  liveDeskKeys,
  liveDeskQueryDefaults,
  liveDeskRefreshPolicy,
  mergeLiveDeskSessionResources
} from "@/features/live-desk/dataAccess";
import type {
  DeskDetailScope,
  DeskSession,
  SessionId
} from "@/types";

export const deskKeys = liveDeskKeys;
export const mergeDeskSessionResources = mergeLiveDeskSessionResources;

interface DeskSessionQueryOptions {
  enabled?: boolean;
  refetchInterval?: number | false;
  retry?: number;
  refetchOnMount?: boolean | "always";
  refetchOnReconnect?: boolean;
}

export function useDeskSessionBase(id: SessionId, options: DeskSessionQueryOptions = {}) {
  return useQuery({
    ...liveDeskQueryDefaults,
    queryKey: liveDeskKeys.session(id),
    queryFn: () => liveDeskDataAccess.getSession(id),
    enabled: options.enabled ?? true,
    staleTime: 30_000,
    refetchInterval: options.refetchInterval ?? liveDeskRefreshPolicy.projection,
    retry: options.retry ?? 1,
    refetchOnMount: options.refetchOnMount ?? true,
    refetchOnReconnect: options.refetchOnReconnect ?? true
  });
}

export function useDeskMarketSnapshot(id: SessionId, options: { enabled?: boolean; refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: liveDeskKeys.market(id),
    queryFn: () => liveDeskDataAccess.getMarketSnapshot(id),
    enabled: options.enabled ?? true,
    staleTime: 15_000,
    refetchInterval: options.refetchInterval ?? liveDeskRefreshPolicy.market,
    ...liveDeskQueryDefaults
  });
}

export function useDeskSession(id: SessionId) {
  const sessionQuery = useDeskSessionBase(id, {
    refetchInterval: Math.max(liveDeskRefreshPolicy.projection, 45_000),
    retry: 2,
    refetchOnMount: "always",
    refetchOnReconnect: true
  });
  const criticalResourcesEnabled = useDeferredEnabled(Boolean(sessionQuery.data), 800);
  const backgroundResourcesEnabled = useDeferredEnabled(Boolean(sessionQuery.data), 2_500);
  const marketQuery = useDeskMarketSnapshot(id, {
    enabled: criticalResourcesEnabled,
    refetchInterval: liveDeskRefreshPolicy.market
  });
  const positionQuery = useQuery({
    queryKey: liveDeskKeys.position(id),
    queryFn: () => liveDeskDataAccess.getPosition(id),
    enabled: criticalResourcesEnabled,
    staleTime: 15_000,
    refetchInterval: query => query.state.data?.position.active ? Math.max(liveDeskRefreshPolicy.activePosition, 15_000) : 60_000,
    ...liveDeskQueryDefaults
  });
  const macroQuery = useQuery({
    queryKey: liveDeskKeys.macro(id, sessionQuery.data?.date),
    queryFn: () => liveDeskDataAccess.getMacroCalendar(id),
    enabled: backgroundResourcesEnabled,
    staleTime: 120_000,
    refetchInterval: query => query.state.data?.nearEvent ? Math.max(liveDeskRefreshPolicy.macroNearEvent, 90_000) : liveDeskRefreshPolicy.macro,
    ...liveDeskQueryDefaults
  });
  const newsDigestQuery = useQuery({
    queryKey: liveDeskKeys.newsDigest(id, sessionQuery.data?.date),
    queryFn: () => liveDeskDataAccess.getNewsDigest(id),
    enabled: backgroundResourcesEnabled,
    staleTime: 300_000,
    refetchInterval: liveDeskRefreshPolicy.newsDigest,
    ...liveDeskQueryDefaults
  });
  const newsHeadlinesQuery = useQuery({
    queryKey: liveDeskKeys.newsHeadlines(id, sessionQuery.data?.date),
    queryFn: () => liveDeskDataAccess.getNewsHeadlines(id),
    enabled: backgroundResourcesEnabled,
    staleTime: 120_000,
    refetchInterval: Math.max(liveDeskRefreshPolicy.news, 180_000),
    ...liveDeskQueryDefaults
  });
  const activityQuery = useQuery({
    queryKey: liveDeskKeys.activity(id),
    queryFn: () => liveDeskDataAccess.getDeskActivity(id),
    enabled: criticalResourcesEnabled,
    staleTime: 15_000,
    refetchInterval: query => isRunningAutomationStatus(query.state.data?.automation.status) ? Math.max(liveDeskRefreshPolicy.deskActivityRunning, 15_000) : 60_000,
    ...liveDeskQueryDefaults
  });
  const alertsQuery = useQuery({
    queryKey: liveDeskKeys.alerts(id),
    queryFn: () => liveDeskDataAccess.getAlerts(id),
    enabled: criticalResourcesEnabled,
    staleTime: 30_000,
    refetchInterval: Math.max(liveDeskRefreshPolicy.alerts, 30_000),
    ...liveDeskQueryDefaults
  });
  const auditQuery = useQuery({
    queryKey: liveDeskKeys.audit(id),
    queryFn: () => liveDeskDataAccess.getAudit(id),
    enabled: backgroundResourcesEnabled,
    staleTime: 300_000,
    refetchInterval: Math.max(liveDeskRefreshPolicy.audit, 300_000),
    ...liveDeskQueryDefaults
  });

  const data = useMemo(() => {
    if (!sessionQuery.data) return undefined;
    return mergeLiveDeskSessionResources(sessionQuery.data, {
      market: marketQuery.data,
      position: positionQuery.data,
      macro: macroQuery.data,
      newsDigest: newsDigestQuery.data,
      newsHeadlines: newsHeadlinesQuery.data,
      activity: activityQuery.data,
      alerts: alertsQuery.data,
      audit: auditQuery.data
    });
  }, [
    sessionQuery.data,
    marketQuery.data,
    positionQuery.data,
    macroQuery.data,
    newsDigestQuery.data,
    newsHeadlinesQuery.data,
    activityQuery.data,
    alertsQuery.data,
    auditQuery.data
  ]);

  return {
    ...sessionQuery,
    data,
    isFetching: [
      sessionQuery,
      marketQuery,
      positionQuery,
      macroQuery,
      newsDigestQuery,
      newsHeadlinesQuery,
      activityQuery,
      alertsQuery,
      auditQuery
    ].some(query => query.isFetching),
    dataUpdatedAt: Math.max(
      sessionQuery.dataUpdatedAt,
      marketQuery.dataUpdatedAt,
      positionQuery.dataUpdatedAt,
      macroQuery.dataUpdatedAt,
      newsDigestQuery.dataUpdatedAt,
      newsHeadlinesQuery.dataUpdatedAt,
      activityQuery.dataUpdatedAt,
      alertsQuery.dataUpdatedAt,
      auditQuery.dataUpdatedAt
    ),
    refetch: async () => {
      const refetches: Array<() => Promise<unknown>> = [
        () => sessionQuery.refetch(),
        () => marketQuery.refetch(),
        () => positionQuery.refetch(),
        () => macroQuery.refetch(),
        () => newsDigestQuery.refetch(),
        () => newsHeadlinesQuery.refetch(),
        () => activityQuery.refetch(),
        () => alertsQuery.refetch(),
        () => auditQuery.refetch()
      ];
      await Promise.all(refetches.map(refetch => refetch()));
    }
  };
}

function useDeferredEnabled(enabled: boolean, delayMs: number) {
  const [deferred, setDeferred] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setDeferred(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setDeferred(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, enabled]);
  return deferred;
}

export function deskDetailScope(session: DeskSession): DeskDetailScope {
  return { session: session.id, strategyId: session.strategyId, date: session.date };
}

export function useTimelineDetail(scope: DeskDetailScope) {
  return useQuery({
    queryKey: liveDeskKeys.timeline(scope),
    queryFn: () => liveDeskDataAccess.getTimeline(scope),
    enabled: Boolean(scope.strategyId && scope.date),
    staleTime: 15_000,
    refetchInterval: liveDeskRefreshPolicy.projection,
    retry: 1
  });
}

export function useMasterDetail(masterId: string, scope: DeskDetailScope) {
  return useQuery({
    queryKey: liveDeskKeys.master(masterId, scope),
    queryFn: () => liveDeskDataAccess.getMaster(masterId, scope),
    enabled: detailEnabled(masterId),
    staleTime: 30_000,
    refetchInterval: liveDeskRefreshPolicy.projection,
    retry: 1
  });
}

export function useMonitorDetail(monitorId: string, scope: DeskDetailScope) {
  return useQuery({
    queryKey: liveDeskKeys.monitor(monitorId, scope),
    queryFn: () => liveDeskDataAccess.getMonitor(monitorId, scope),
    enabled: detailEnabled(monitorId),
    staleTime: 15_000,
    refetchInterval: liveDeskRefreshPolicy.projection,
    retry: 1
  });
}

export function useThesisDetail(thesisId: string, scope: DeskDetailScope) {
  return useQuery({
    queryKey: liveDeskKeys.thesis(thesisId, scope),
    queryFn: () => liveDeskDataAccess.getThesis(thesisId, scope),
    enabled: detailEnabled(thesisId),
    staleTime: 30_000,
    refetchInterval: liveDeskRefreshPolicy.projection,
    retry: 1
  });
}

export function useThesisConditionsDetail(thesisId: string, scope: DeskDetailScope) {
  return useQuery({
    queryKey: liveDeskKeys.thesisConditions(thesisId, scope),
    queryFn: () => liveDeskDataAccess.getThesisConditions(thesisId, scope),
    enabled: detailEnabled(thesisId),
    staleTime: 15_000,
    refetchInterval: liveDeskRefreshPolicy.projection,
    retry: 1
  });
}

export function useSetupDetail(setupId: string, scope: DeskDetailScope) {
  return useQuery({
    queryKey: liveDeskKeys.setup(setupId, scope),
    queryFn: () => liveDeskDataAccess.getSetup(setupId, scope),
    enabled: detailEnabled(setupId),
    staleTime: 30_000,
    refetchInterval: liveDeskRefreshPolicy.projection,
    retry: 1
  });
}

function detailEnabled(id: string) {
  return Boolean(id) && !id.startsWith("no-");
}
