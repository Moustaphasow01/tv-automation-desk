const pathPart = (value: string) => encodeURIComponent(value);

export const deskEndpoints = {
  liveDesk: "/live-desk/current",
  sessions: "/sessions",
  sessionOverview: (strategyId: string, date: string) => `/sessions/${pathPart(strategyId)}/${pathPart(date)}/overview`,
  timeline: (strategyId: string, date: string) => `/sessions/${pathPart(strategyId)}/${pathPart(date)}/timeline`,
  master: (masterId: string) => `/masters/${pathPart(masterId)}`,
  monitor: (monitorId: string) => `/monitors/${pathPart(monitorId)}`,
  thesis: (thesisId: string) => `/theses/${pathPart(thesisId)}`,
  thesisConditions: (thesisId: string) => `/theses/${pathPart(thesisId)}/conditions`,
  setup: (setupId: string) => `/setups/${pathPart(setupId)}`,
  position: "/positions/current",
  marketSnapshot: "/market/snapshot",
  macroCalendar: "/macro/calendar",
  newsHeadlines: "/news/headlines",
  newsDigest: "/news/digest",
  deskActivity: "/desk/activity",
  alerts: "/alerts",
  audit: "/audit",
  performanceCalendar: "/performance/calendar",
  performanceDay: "/performance/day",
  operatorState: "/operator/state",
  operatorCommands: "/operator/commands",
  openApi: "/openapi.json"
} as const;

export const refreshPolicyMs = {
  market: 30_000,
  news: 90_000,
  newsDigest: 300_000,
  macro: 300_000,
  macroNearEvent: 45_000,
  activePosition: 10_000,
  deskActivityRunning: 10_000,
  deskActivityIdle: 30_000,
  alerts: 15_000,
  audit: 60_000,
  projection: 30_000,
  performance: 60_000
} as const;
