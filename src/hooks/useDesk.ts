import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { deskApi } from "@/api/deskApi";
import { refreshPolicyMs } from "@/api/endpoints";
import type {
  DeskActivityResource,
  DeskAlertsResource,
  DeskAuditResource,
  DeskDetailScope,
  DeskMacroResource,
  DeskMarketResource,
  DeskNewsDigestResource,
  DeskNewsHeadlinesResource,
  DeskPositionResource,
  DeskSession,
  SessionId
} from "@/types";

export const deskKeys = {
  session: (id: SessionId) => ["desk-session", id] as const,
  market: (id: SessionId) => ["desk-market", id] as const,
  position: (id: SessionId) => ["desk-position", id] as const,
  macro: (id: SessionId, date = "current") => ["desk-macro", id, date] as const,
  newsDigest: (id: SessionId, date = "current") => ["desk-news-digest", id, date] as const,
  newsHeadlines: (id: SessionId, date = "current") => ["desk-news-headlines", id, date] as const,
  activity: (id: SessionId) => ["desk-activity", id] as const,
  alerts: (id: SessionId) => ["desk-alerts", id] as const,
  audit: (id: SessionId) => ["desk-audit", id] as const,
  timeline: (scope: DeskDetailScope) => ["desk-timeline", scope.session, scope.strategyId, scope.date] as const,
  master: (id: string, scope: DeskDetailScope) => ["desk-master", id, scope.session, scope.date] as const,
  monitor: (id: string, scope: DeskDetailScope) => ["desk-monitor", id, scope.session, scope.date] as const,
  thesis: (id: string, scope: DeskDetailScope) => ["desk-thesis", id, scope.session, scope.date] as const,
  thesisConditions: (id: string, scope: DeskDetailScope) => ["desk-thesis-conditions", id, scope.session, scope.date] as const,
  setup: (id: string, scope: DeskDetailScope) => ["desk-setup", id, scope.session, scope.date] as const
};

interface DeskSessionResources {
  market?: DeskMarketResource;
  position?: DeskPositionResource;
  macro?: DeskMacroResource;
  newsDigest?: DeskNewsDigestResource;
  newsHeadlines?: DeskNewsHeadlinesResource;
  activity?: DeskActivityResource;
  alerts?: DeskAlertsResource;
  audit?: DeskAuditResource;
}

const liveQueryDefaults = {
  retry: 0,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchOnMount: false
} as const;

/**
 * Merge independently refreshed read models over the initial aggregate.
 * Missing optional resources keep the last aggregate value, while canonical
 * execution resources override it whenever a fresher response is available.
 */
export function mergeDeskSessionResources(session: DeskSession, resources: DeskSessionResources): DeskSession {
  const resourceWarnings = Object.values(resources).flatMap(resource => resource?.warnings || []);
  const news = resources.newsDigest?.news || session.news;
  return {
    ...session,
    ...(resources.market && {
      lastDataAt: resources.market.lastDataAt,
      market: resources.market.market,
      marketBrief: resources.market.marketBrief,
      crossAssetBrief: resources.market.crossAssetBrief,
      levels: resources.market.levels
    }),
    ...(resources.position && { position: resources.position.position }),
    ...(resources.macro && { nextMacro: resources.macro.nextMacro, macro: resources.macro.macro }),
    news: {
      ...news,
      headlines: resources.newsHeadlines?.headlines || news.headlines
    },
    ...(resources.activity && { automation: resources.activity.automation, activity: resources.activity.activity }),
    ...(resources.alerts && { alerts: resources.alerts.alerts }),
    ...(resources.audit && { audit: resources.audit.audit }),
    dataQuality: {
      ...(resources.audit?.dataQuality || session.dataQuality),
      warnings: [...new Set([
        ...(resources.audit?.dataQuality.warnings || session.dataQuality.warnings),
        ...resourceWarnings
      ])]
    }
  };
}

interface DeskSessionQueryOptions {
  enabled?: boolean;
  refetchInterval?: number | false;
  retry?: number;
  refetchOnMount?: boolean | "always";
  refetchOnReconnect?: boolean;
}

export function useDeskSessionBase(id: SessionId, options: DeskSessionQueryOptions = {}) {
  return useQuery({
    ...liveQueryDefaults,
    queryKey: deskKeys.session(id),
    queryFn: () => deskApi.getSession(id),
    enabled: options.enabled ?? true,
    staleTime: 30_000,
    refetchInterval: options.refetchInterval ?? refreshPolicyMs.projection,
    retry: options.retry ?? 1,
    refetchOnMount: options.refetchOnMount ?? true,
    refetchOnReconnect: options.refetchOnReconnect ?? true
  });
}

export function useDeskMarketSnapshot(id: SessionId, options: { enabled?: boolean; refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: deskKeys.market(id),
    queryFn: () => deskApi.getMarketSnapshot(id),
    enabled: options.enabled ?? true,
    staleTime: 15_000,
    refetchInterval: options.refetchInterval ?? refreshPolicyMs.market,
    ...liveQueryDefaults
  });
}

export function useDeskSession(id: SessionId) {
  const sessionQuery = useDeskSessionBase(id, {
    refetchInterval: Math.max(refreshPolicyMs.projection, 45_000),
    retry: 2,
    refetchOnMount: "always",
    refetchOnReconnect: true
  });
  const criticalResourcesEnabled = useDeferredEnabled(Boolean(sessionQuery.data), 800);
  const backgroundResourcesEnabled = useDeferredEnabled(Boolean(sessionQuery.data), 2_500);
  const marketQuery = useDeskMarketSnapshot(id, {
    enabled: criticalResourcesEnabled,
    refetchInterval: refreshPolicyMs.market
  });
  const positionQuery = useQuery({
    queryKey: deskKeys.position(id),
    queryFn: () => deskApi.getPosition(id),
    enabled: criticalResourcesEnabled,
    staleTime: 15_000,
    refetchInterval: query => query.state.data?.position.active ? Math.max(refreshPolicyMs.activePosition, 15_000) : 60_000,
    ...liveQueryDefaults
  });
  const macroQuery = useQuery({
    queryKey: deskKeys.macro(id, sessionQuery.data?.date),
    queryFn: () => deskApi.getMacroCalendar(id),
    enabled: backgroundResourcesEnabled,
    staleTime: 120_000,
    refetchInterval: query => query.state.data?.nearEvent ? Math.max(refreshPolicyMs.macroNearEvent, 90_000) : refreshPolicyMs.macro,
    ...liveQueryDefaults
  });
  const newsDigestQuery = useQuery({
    queryKey: deskKeys.newsDigest(id, sessionQuery.data?.date),
    queryFn: () => deskApi.getNewsDigest(id),
    enabled: backgroundResourcesEnabled,
    staleTime: 300_000,
    refetchInterval: refreshPolicyMs.newsDigest,
    ...liveQueryDefaults
  });
  const newsHeadlinesQuery = useQuery({
    queryKey: deskKeys.newsHeadlines(id, sessionQuery.data?.date),
    queryFn: () => deskApi.getNewsHeadlines(id),
    enabled: backgroundResourcesEnabled,
    staleTime: 120_000,
    refetchInterval: Math.max(refreshPolicyMs.news, 180_000),
    ...liveQueryDefaults
  });
  const activityQuery = useQuery({
    queryKey: deskKeys.activity(id),
    queryFn: () => deskApi.getDeskActivity(id),
    enabled: criticalResourcesEnabled,
    staleTime: 15_000,
    refetchInterval: query => isRunning(query.state.data?.automation.status) ? Math.max(refreshPolicyMs.deskActivityRunning, 15_000) : 60_000,
    ...liveQueryDefaults
  });
  const alertsQuery = useQuery({
    queryKey: deskKeys.alerts(id),
    queryFn: () => deskApi.getAlerts(id),
    enabled: criticalResourcesEnabled,
    staleTime: 30_000,
    refetchInterval: Math.max(refreshPolicyMs.alerts, 30_000),
    ...liveQueryDefaults
  });
  const auditQuery = useQuery({
    queryKey: deskKeys.audit(id),
    queryFn: () => deskApi.getAudit(id),
    enabled: backgroundResourcesEnabled,
    staleTime: 300_000,
    refetchInterval: Math.max(refreshPolicyMs.audit, 300_000),
    ...liveQueryDefaults
  });

  const data = useMemo(() => {
    if (!sessionQuery.data) return undefined;
    return mergeDeskSessionResources(sessionQuery.data, {
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
    queryKey: deskKeys.timeline(scope),
    queryFn: () => deskApi.getTimeline(scope),
    enabled: Boolean(scope.strategyId && scope.date),
    staleTime: 15_000,
    refetchInterval: refreshPolicyMs.projection,
    retry: 1
  });
}

export function useMasterDetail(masterId: string, scope: DeskDetailScope) {
  return useQuery({
    queryKey: deskKeys.master(masterId, scope),
    queryFn: () => deskApi.getMaster(masterId, scope),
    enabled: detailEnabled(masterId),
    staleTime: 30_000,
    refetchInterval: refreshPolicyMs.projection,
    retry: 1
  });
}

export function useMonitorDetail(monitorId: string, scope: DeskDetailScope) {
  return useQuery({
    queryKey: deskKeys.monitor(monitorId, scope),
    queryFn: () => deskApi.getMonitor(monitorId, scope),
    enabled: detailEnabled(monitorId),
    staleTime: 15_000,
    refetchInterval: refreshPolicyMs.projection,
    retry: 1
  });
}

export function useThesisDetail(thesisId: string, scope: DeskDetailScope) {
  return useQuery({
    queryKey: deskKeys.thesis(thesisId, scope),
    queryFn: () => deskApi.getThesis(thesisId, scope),
    enabled: detailEnabled(thesisId),
    staleTime: 30_000,
    refetchInterval: refreshPolicyMs.projection,
    retry: 1
  });
}

export function useThesisConditionsDetail(thesisId: string, scope: DeskDetailScope) {
  return useQuery({
    queryKey: deskKeys.thesisConditions(thesisId, scope),
    queryFn: () => deskApi.getThesisConditions(thesisId, scope),
    enabled: detailEnabled(thesisId),
    staleTime: 15_000,
    refetchInterval: refreshPolicyMs.projection,
    retry: 1
  });
}

export function useSetupDetail(setupId: string, scope: DeskDetailScope) {
  return useQuery({
    queryKey: deskKeys.setup(setupId, scope),
    queryFn: () => deskApi.getSetup(setupId, scope),
    enabled: detailEnabled(setupId),
    staleTime: 30_000,
    refetchInterval: refreshPolicyMs.projection,
    retry: 1
  });
}

function isRunning(status: string | undefined) {
  return Boolean(status && !["idle", "unknown", "done", "failed", "cancelled"].includes(status.toLowerCase()));
}

function detailEnabled(id: string) {
  return Boolean(id) && !id.startsWith("no-");
}
