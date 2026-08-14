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

export const liveDeskKeys = {
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

export const liveDeskQueryDefaults = {
  retry: 0,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchOnMount: false
} as const;

export const liveDeskRefreshPolicy = refreshPolicyMs;

export const liveDeskDataAccess = {
  getSession: (id: SessionId) => deskApi.getSession(id),
  getMarketSnapshot: (id: SessionId) => deskApi.getMarketSnapshot(id),
  getPosition: (id: SessionId) => deskApi.getPosition(id),
  getMacroCalendar: (id: SessionId) => deskApi.getMacroCalendar(id),
  getNewsDigest: (id: SessionId) => deskApi.getNewsDigest(id),
  getNewsHeadlines: (id: SessionId) => deskApi.getNewsHeadlines(id),
  getDeskActivity: (id: SessionId) => deskApi.getDeskActivity(id),
  getAlerts: (id: SessionId) => deskApi.getAlerts(id),
  getAudit: (id: SessionId) => deskApi.getAudit(id),
  getTimeline: (scope: DeskDetailScope) => deskApi.getTimeline(scope),
  getMaster: (id: string, scope: DeskDetailScope) => deskApi.getMaster(id, scope),
  getMonitor: (id: string, scope: DeskDetailScope) => deskApi.getMonitor(id, scope),
  getThesis: (id: string, scope: DeskDetailScope) => deskApi.getThesis(id, scope),
  getThesisConditions: (id: string, scope: DeskDetailScope) => deskApi.getThesisConditions(id, scope),
  getSetup: (id: string, scope: DeskDetailScope) => deskApi.getSetup(id, scope),
};

export interface LiveDeskSessionResources {
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
export function mergeLiveDeskSessionResources(session: DeskSession, resources: LiveDeskSessionResources): DeskSession {
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

export function isRunningAutomationStatus(status: string | undefined) {
  return Boolean(status && !["idle", "unknown", "done", "failed", "cancelled"].includes(status.toLowerCase()));
}
