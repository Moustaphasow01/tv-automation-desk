import { useMemo } from "react";
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
  macro: (_id: SessionId) => ["desk-macro", "daily"] as const,
  newsDigest: (_id: SessionId) => ["desk-news-digest", "daily"] as const,
  newsHeadlines: (_id: SessionId) => ["desk-news-headlines", "daily"] as const,
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

export function useDeskSession(id: SessionId) {
  const sessionQuery = useQuery({
    queryKey: deskKeys.session(id),
    queryFn: () => deskApi.getSession(id),
    staleTime: 15_000,
    refetchInterval: refreshPolicyMs.projection,
    retry: 1
  });
  const dedicatedResourcesEnabled = Boolean(sessionQuery.data);
  const marketQuery = useQuery({
    queryKey: deskKeys.market(id),
    queryFn: () => deskApi.getMarketSnapshot(id),
    enabled: dedicatedResourcesEnabled,
    staleTime: 30_000,
    refetchInterval: refreshPolicyMs.market,
    retry: 1
  });
  const positionQuery = useQuery({
    queryKey: deskKeys.position(id),
    queryFn: () => deskApi.getPosition(id),
    enabled: dedicatedResourcesEnabled,
    staleTime: 5_000,
    refetchInterval: query => query.state.data?.position.active ? refreshPolicyMs.activePosition : refreshPolicyMs.projection,
    retry: 1
  });
  const macroQuery = useQuery({
    queryKey: deskKeys.macro(id),
    queryFn: () => deskApi.getMacroCalendar(id),
    enabled: dedicatedResourcesEnabled,
    staleTime: 30_000,
    refetchInterval: query => query.state.data?.nearEvent ? refreshPolicyMs.macroNearEvent : refreshPolicyMs.macro,
    retry: 1
  });
  const newsDigestQuery = useQuery({
    queryKey: deskKeys.newsDigest(id),
    queryFn: () => deskApi.getNewsDigest(id),
    enabled: dedicatedResourcesEnabled,
    staleTime: 60_000,
    refetchInterval: refreshPolicyMs.newsDigest,
    retry: 1
  });
  const newsHeadlinesQuery = useQuery({
    queryKey: deskKeys.newsHeadlines(id),
    queryFn: () => deskApi.getNewsHeadlines(id),
    enabled: dedicatedResourcesEnabled,
    staleTime: 30_000,
    refetchInterval: refreshPolicyMs.news,
    retry: 1
  });
  const activityQuery = useQuery({
    queryKey: deskKeys.activity(id),
    queryFn: () => deskApi.getDeskActivity(id),
    enabled: dedicatedResourcesEnabled,
    staleTime: 5_000,
    refetchInterval: query => isRunning(query.state.data?.automation.status) ? refreshPolicyMs.deskActivityRunning : refreshPolicyMs.deskActivityIdle,
    retry: 1
  });
  const alertsQuery = useQuery({
    queryKey: deskKeys.alerts(id),
    queryFn: () => deskApi.getAlerts(id),
    enabled: dedicatedResourcesEnabled,
    staleTime: 5_000,
    refetchInterval: refreshPolicyMs.alerts,
    retry: 1
  });
  const auditQuery = useQuery({
    queryKey: deskKeys.audit(id),
    queryFn: () => deskApi.getAudit(id),
    enabled: dedicatedResourcesEnabled,
    staleTime: 30_000,
    refetchInterval: refreshPolicyMs.audit,
    retry: 1
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
