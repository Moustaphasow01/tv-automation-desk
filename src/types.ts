export type SessionId = "asia_open" | "ny_open";
export type Severity = "info" | "watch" | "warning" | "action" | "critical" | "positive";
export type Trend = "up" | "down" | "flat";

export interface MarketItem {
  symbol: string;
  price: string;
  change: string;
  trend: Trend;
  note: string;
  ohlc?: { open: string; high: string; low: string; close: string };
  marketDate?: string;
  asOf?: string;
  source?: string;
  rsi?: string;
  atr?: string;
  seriesTimeframe?: string;
  availability?: string;
  series?: Array<{
    time: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number;
  }>;
}

export interface ConditionItem {
  label: string;
  status: "validated" | "failed" | "triggered" | "not_triggered" | "previously_validated" | string;
  proof: string;
  impact: string;
  deterministic: boolean;
}

export interface MonitorItem {
  id: string;
  time: string;
  sequence: number;
  decision: string;
  severity: Severity;
  statusBefore: string;
  statusAfter: string;
  healthBefore: number;
  healthAfter: number;
  summary: string;
  detailedReason: string;
  nextAction: string;
  nextFocus: string;
  expectedVsRealized: Array<{
    element: string;
    expected: string;
    realized: string;
    verdict: "confirm" | "invalidate" | "partial" | string;
    impact: string;
  }>;
  weakSignals: string[];
  goConditions: ConditionItem[];
  invalidationConditions: ConditionItem[];
}

export interface TimelineEvent {
  time: string;
  type: string;
  title: string;
  status: string;
  detail: string;
  severity: Severity;
  summary: string;
  sourceType: string;
}

export interface OperationalTimelineItem {
  id: string;
  type: "MASTER" | "MONITOR" | string;
  label: string;
  plannedAt: string | null;
  actualAt: string | null;
  plannedTime: string;
  actualTime: string;
  status: string;
  latencySeconds: number | null;
  summary: string;
  detail: string;
}

export interface DeskSession {
  id: SessionId;
  strategyId: string;
  label: string;
  shortLabel: string;
  date: string;
  mode: string;
  status: string;
  severity: Severity;
  lastDataAt: string;
  lastMonitorAt: string;
  currentCheckpointAt: string;
  lastCompletedCheckpointAt: string;
  nextCheckpointAt: string;
  nextMonitorAt: string;
  claim: {
    lastClaimAt: string;
    lastClaimAtUtc: string | null;
    workerId: string | null;
    nextTaskStatus: "waiting" | "in_progress" | "executed" | "late" | "unavailable";
    nextTaskStatusLabel: string;
    nextTaskWorkflow: string | null;
    nextTaskLabel: string;
    nextTaskCheckpoint: string;
    followingTaskCheckpoint: string;
    followingTaskWorkflow: string | null;
    lastCompletedCheckpoint: string;
    dueCheckpoint: string;
    readyAt: string;
    bundleReadyAt: string;
    latencySeconds: number | null;
    latencyTargetSeconds: number;
    latencyStatus: "on_target" | "late" | "unavailable" | string;
    bundleClaimLatencySeconds: number | null;
    bundleClaimLatencyStatus: "on_target" | "late" | "unavailable" | string;
  };
  nextMacro: string;
  dataQuality: {
    label: string;
    status: "ready" | "degraded" | string;
    antiLookahead: boolean;
    warnings: string[];
    executionReady: boolean;
    contextLimited: boolean;
  };
  automation: { status: string; worker: string; cadence: string };
  liveBrief: {
    eyebrow: string; headline: string; action: string; summary: string;
    why: string; nextAction: string; decision: string;
  };
  thesis: {
    id: string; instrument: string; direction: string; status: string; previousStatus: string;
    dominantScenario: string; secondaryScenario: string; confidence: number; initialConfidence: number;
    health: number; initialHealth: number; validUntil: string; nextFocus: string;
    scoreDriversPositive: string[]; scoreDriversNegative: string[];
  };
  marketBrief: { headline: string; text: string; verdict: string };
  deskReading: {
    facts: string[];
    interpretation: string[];
    thesisEvolution: string[];
  };
  market: MarketItem[];
  crossAssetBrief: { headline: string; text: string; verdict: string };
  latestChange: {
    title: string;
    items: Array<{ tone: string; text: string }>;
    consequence: string;
  };
  master: {
    id: string; createdAt: string; decision: string; instrument: string; direction: string;
    confidence: number; summary: string; regime: string; macroThesis: string; assetSelection: string;
    expectedPath: string[]; failurePath: string[]; monitoringPlaybook: string[];
    sections: Array<{ title: string; content: string }>;
  };
  setup: {
    id: string; label: string; instrument: string; direction: string; status: string; statusLabel: string;
    requestedStatus: string; geometryReady: boolean; backendCanTrigger: boolean; missingFields: string[];
    entryFrom: number | null; entryTo: number | null;
    entryLower: number | null; entryUpper: number | null;
    executionEntry: number | null; executionRule: string; stop: number | null;
    tp1: number | null; tp2: number | null; tp3: number | null;
    risk: number | null; confidence: number | null; rr: number | null; minimumRr: number | null;
    resultR?: number | null; reason: string;
  };
  position: {
    active: boolean; status: string; instrument: string; direction: string;
    entry: number | null; current: number | null; unrealizedR: number | null;
    executionMode: string; brokerExecution: boolean; note: string;
  };
  monitors: MonitorItem[];
  timeline: TimelineEvent[];
  operationalTimeline: OperationalTimelineItem[];
  activity: Array<{ time: string; title: string; detail: string; status: string }>;
  levels: Array<{ price: string; role: string; state: string }>;
  macro: Array<{
    time: string; title: string; importance: string; impactText: string;
    scheduledAt?: string; date?: string; currency?: string;
    previous?: string; forecast?: string; actual?: string; isNext?: boolean;
  }>;
  news: {
    digestUpdatedAt: string;
    digest: string;
    status: string;
    provider: string;
    freshness: { status: string; ageMinutes: number | null };
    headlines: Array<{
      time: string; title: string; source: string; impact: string;
      scheduledAt?: string; date?: string; currency?: string; importance?: string;
      previous?: string; forecast?: string; actual?: string; isNext?: boolean;
      url?: string; provider?: string; publishedAt?: string; assets?: string[]; topics?: string[];
    }>;
  };
  alerts: Array<{ level: Severity; title: string; message: string; time: string }>;
  audit: {
    contracts: Array<{ name: string; version: string; status: string }>;
    checks: Array<{ label: string; status: string }>;
    apiMap: Array<{ view: string; endpoint: string }>;
  };
}

export interface FrontResourceMeta {
  contract: string;
  schemaVersion: "1.0.0";
  scope: {
    strategyId: string;
    session: SessionId;
    tradingDate: string;
    mode: "live" | "paper";
  };
  warnings: string[];
}

export interface DeskMarketResource extends FrontResourceMeta {
  lastDataAt: DeskSession["lastDataAt"];
  market: DeskSession["market"];
  marketBrief: DeskSession["marketBrief"];
  crossAssetBrief: DeskSession["crossAssetBrief"];
  levels: DeskSession["levels"];
}

export interface DeskPositionResource extends FrontResourceMeta {
  position: DeskSession["position"];
}

export interface DeskMacroResource extends FrontResourceMeta {
  nextMacro: DeskSession["nextMacro"];
  nearEvent: boolean;
  macro: DeskSession["macro"];
}

export interface DeskNewsDigestResource extends FrontResourceMeta {
  news: DeskSession["news"];
}

export interface DeskNewsHeadlinesResource extends FrontResourceMeta {
  headlines: DeskSession["news"]["headlines"];
}

export interface DeskActivityResource extends FrontResourceMeta {
  automation: DeskSession["automation"];
  activity: DeskSession["activity"];
}

export interface DeskAlertsResource extends FrontResourceMeta {
  alerts: DeskSession["alerts"];
}

export interface DeskAuditResource extends FrontResourceMeta {
  dataQuality: DeskSession["dataQuality"];
  audit: DeskSession["audit"];
}

export type PerformancePricingMode = "conservative" | "middle" | "optimistic";

export interface PerformanceSummary {
  closed_trades?: number;
  wins?: number;
  losses?: number;
  win_rate?: number | null;
  total_R?: number;
  expectancy_R?: number;
  max_drawdown_R?: number;
}

export interface PerformanceCalendarDay {
  date: string;
  status: string;
  total_R: number;
  closed_trades: number;
  setup_count: number;
  has_master: boolean;
  has_trade: boolean;
  has_open_position: boolean;
  pack_status: string | null;
  master_decision: string | null;
  setup_status: string | null;
}

export interface PerformanceCalendar {
  strategy_id: string;
  pricing_mode: PerformancePricingMode;
  year: number;
  month: number;
  from_date: string;
  to_date: string;
  summary?: PerformanceSummary;
  days: PerformanceCalendarDay[];
}

export interface PerformanceDay {
  strategy_id: string;
  pricing_mode: PerformancePricingMode;
  date: string;
  master: Record<string, unknown> | null;
  thesis: Record<string, unknown> | null;
  setups: Array<Record<string, unknown>>;
  monitors: Array<Record<string, unknown>>;
  trades: Array<Record<string, unknown>>;
  performance: { summary?: PerformanceSummary; [key: string]: unknown };
  timeline: Array<Record<string, unknown>>;
}

export interface DeskPerformanceCalendarResource extends FrontResourceMeta {
  calendar: PerformanceCalendar;
}

export interface DeskPerformanceDayResource extends FrontResourceMeta {
  day: PerformanceDay;
}

export interface DeskDetailScope {
  session: SessionId;
  strategyId: string;
  date: string;
}

export interface DeskTimelineResource extends FrontResourceMeta {
  timeline: DeskSession["timeline"];
}

export interface DeskMasterResource extends FrontResourceMeta {
  master: DeskSession["master"];
}

export interface DeskMonitorResource extends FrontResourceMeta {
  monitor: MonitorItem;
}

export interface DeskThesisResource extends FrontResourceMeta {
  thesis: DeskSession["thesis"];
  levels: DeskSession["levels"];
}

export interface DeskThesisConditionsResource extends FrontResourceMeta {
  thesisId: string;
  monitorId: string | null;
  go: ConditionItem[];
  invalidations: ConditionItem[];
}

export interface DeskSetupResource extends FrontResourceMeta {
  setup: DeskSession["setup"];
  position: DeskSession["position"];
  levels: DeskSession["levels"];
}

export type DeskOperatorCommandType =
  | "cancel_setup"
  | "confirm_trigger"
  | "move_break_even"
  | "take_partial"
  | "exit_position"
  | "request_replan";

export interface DeskOperatorScope {
  session: SessionId;
  strategyId: string;
  tradingDate: string;
  mode: "live" | "paper";
}

export interface DeskOperatorCapability {
  command: DeskOperatorCommandType;
  enabled: boolean;
  reason: string | null;
  targetId: string | null;
  confirmationPhrase: string;
  dangerLevel: "medium" | "high" | "critical";
}

export interface DeskOperatorState {
  contract: "DeskFrontOperatorState";
  schemaVersion: "1.0.0";
  scope: DeskOperatorScope;
  revision: number;
  setup: { id: string; status: string } | null;
  position: { id: string; status: string; entry: number | null } | null;
  thesis: { id: string; status: string } | null;
  allowedCommands: DeskOperatorCapability[];
  brokerExecution: false;
}

export interface DeskOperatorCommandInput extends DeskOperatorScope {
  command: DeskOperatorCommandType;
  expectedRevision: number;
  idempotencyKey: string;
  confirmationPhrase: string;
  targetId?: string;
  reason: string;
  partialFraction?: number;
}

export interface DeskOperatorCommandResult {
  contract: "DeskFrontOperatorCommandResult";
  schemaVersion: "1.0.0";
  ok: true;
  idempotent: boolean;
  command: {
    id: string;
    type: DeskOperatorCommandType;
    status: "APPLIED";
    revision: number;
    auditId: string;
    brokerExecution: false;
  };
  operatorState: DeskOperatorState;
  session: DeskSession;
}

export interface DeskApi {
  getSession(id: SessionId): Promise<DeskSession>;
  getMarketSnapshot(id: SessionId): Promise<DeskMarketResource>;
  getPosition(id: SessionId): Promise<DeskPositionResource>;
  getMacroCalendar(id: SessionId): Promise<DeskMacroResource>;
  getNewsDigest(id: SessionId): Promise<DeskNewsDigestResource>;
  getNewsHeadlines(id: SessionId): Promise<DeskNewsHeadlinesResource>;
  getDeskActivity(id: SessionId): Promise<DeskActivityResource>;
  getAlerts(id: SessionId): Promise<DeskAlertsResource>;
  getAudit(id: SessionId): Promise<DeskAuditResource>;
  getPerformanceCalendar(id: SessionId, year: number, month: number, pricingMode: PerformancePricingMode): Promise<DeskPerformanceCalendarResource>;
  getPerformanceDay(id: SessionId, date: string, pricingMode: PerformancePricingMode): Promise<DeskPerformanceDayResource>;
  getTimeline(scope: DeskDetailScope): Promise<DeskTimelineResource>;
  getMaster(masterId: string, scope: DeskDetailScope): Promise<DeskMasterResource>;
  getMonitor(monitorId: string, scope: DeskDetailScope): Promise<DeskMonitorResource>;
  getThesis(thesisId: string, scope: DeskDetailScope): Promise<DeskThesisResource>;
  getThesisConditions(thesisId: string, scope: DeskDetailScope): Promise<DeskThesisConditionsResource>;
  getSetup(setupId: string, scope: DeskDetailScope): Promise<DeskSetupResource>;
  getOperatorState(scope: DeskOperatorScope): Promise<DeskOperatorState>;
  executeOperatorCommand(input: DeskOperatorCommandInput): Promise<DeskOperatorCommandResult>;
}
