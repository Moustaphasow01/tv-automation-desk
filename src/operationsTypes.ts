export type WorkflowStatus = "queued" | "running" | "waiting_gpt" | "blocked" | "failed" | "completed" | "cancelled" | "paused" | "unknown";

export interface WorkflowSummary {
  id: string;
  sourceId: string;
  kind: "replay" | "backtest" | "job" | "feature" | string;
  name: string;
  status: WorkflowStatus;
  rawStatus: string;
  revision: number;
  tradingDate: string | null;
  session: string | null;
  strategyId: string | null;
  variantId: string | null;
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  durationMs: number | null;
  error: { code?: string | null; message: string; retryable?: boolean | null } | null;
  metrics: { totalR?: number | null; stepsDone?: number; stepsTotal?: number; gptProcesses?: number; [key: string]: unknown };
  currentStepId: string | null;
  currentWorkItemId: string | null;
  nextAction: string | null;
  automationEnabled: boolean;
  engineVersion?: "autopilot_v4" | "legacy" | string;
  replaySchemaVersion?: string | null;
  masterContractId?: string | null;
  masterContractVersion?: string | null;
  v4Certified?: boolean;
  replayClassification?: "v4_certified" | "v4_contractual" | "legacy" | string;
  resultEligible?: boolean;
  resultEligibleCandidate?: boolean;
  resultEligibilityReason?: string | null;
  runScope?: "full_day" | "session" | string;
  currentPhase?: string | null;
  executionId?: string | null;
  runFamilyId?: string | null;
  runNumber?: number;
  aggregateRole?: "primary" | "comparison" | string | null;
  aggregateEligible?: boolean;
  startTime?: string | null;
  endTime?: string | null;
  currentReplayTime?: string | null;
  attempt?: number;
  sessionExecutionId?: string;
}

export interface WorkflowStep {
  id: string;
  sequence: number;
  type: string;
  status: WorkflowStatus;
  rawStatus: string;
  at: string | null;
  durationMs: number | null;
  inputRef: unknown;
  outputRef: unknown;
  error: WorkflowSummary["error"];
}

export interface OperationsEvent {
  id: string;
  type: string;
  status: WorkflowStatus;
  at: string | null;
  title: string;
  detail: string;
  actor: unknown;
  ref: unknown;
  layer?: "decision" | "step" | "gpt" | string;
  processId?: string | null;
  decision?: string | null;
  conclusion?: string | null;
  price?: number | null;
  severity?: string;
  workflowId?: string;
  workflowName?: string;
  runId?: string | null;
  stepId?: string | null;
}

export interface OperationsSummary {
  contract: "DeskOperationsSummary";
  schemaVersion: "1.0.0";
  generatedAt: string;
  totals: {
    workflows: number; running: number; waitingGpt: number; blocked: number; failed: number;
    completed: number; openIncidents: number; gptInProgress: number;
  };
  health: { status: string; label: string };
  recent: WorkflowSummary[];
}

export interface WorkflowList { contract: string; schemaVersion: string; count: number; items: WorkflowSummary[] }
export type WorkflowCommandAction = "retry" | "resume" | "pause" | "cancel";
export interface WorkflowActionDescriptor {
  action: WorkflowCommandAction;
  label: string;
  tone: string;
  enabled: boolean;
  recommended: boolean;
  confirmationPhrase: string;
  expectedRevision: number;
  reason: string;
  disabledReason: string | null;
  href: string;
}
export interface WorkflowCommandHistoryItem {
  id: string;
  action: string;
  status: string;
  expectedRevision: number;
  idempotencyKey: string | null;
  actor: string;
  reason: string | null;
  error: WorkflowSummary["error"];
  resultStatus: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  events: Array<{ id: string; type: string; at: string | null; actor: string; reason: string | null; status: string; error: WorkflowSummary["error"] }>;
}
export interface WorkflowCommandCenter {
  status: WorkflowStatus;
  expectedRevision: number;
  recommendedAction: WorkflowCommandAction | null;
  actions: WorkflowActionDescriptor[];
  commandBus: {
    targetType: "workflow";
    targetId: string;
    pending: number;
    applied: number;
    failed: number;
    lastCommandAt: string | null;
    lastAction: string | null;
    history: WorkflowCommandHistoryItem[];
  };
  audit: { events: OperationsEvent[]; eventCount: number };
  links: Array<OperationsLink & { action?: string }>;
}
export interface WorkflowDetail {
  contract: string; schemaVersion: string; workflow: WorkflowSummary; steps: WorkflowStep[];
  events: OperationsEvent[]; allowedActions: Array<"retry" | "resume" | "pause" | "cancel">;
  relations: Record<string, unknown>;
  commandCenter: WorkflowCommandCenter;
}

export interface ReplayDaySummary {
  date: string;
  status: WorkflowStatus;
  sessionCount: number;
  resultEligibleSessions?: number;
  comparisonCount?: number;
  running: number;
  failed: number;
  totalProgress: number;
  totalR: number;
  provisionalR?: number | null;
  primaryRunId?: string | null;
  currentReplayTime?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  sessions: WorkflowSummary[];
}

export interface ReplayList {
  contract: string;
  schemaVersion: string;
  generatedAt?: string;
  filters?: Record<string, string | null>;
  count: number;
  summary: {
    executions: number; days: number; active: number; running: number; waitingGpt: number; blocked: number;
    failed: number; completed: number; averageProgress: number; totalR: number; gptProcesses: number;
    certified?: number; contractualV4?: number; legacy?: number; resultEligible?: number;
  };
  facets?: { statuses: string[]; sessions: string[]; strategies: string[]; variants: string[]; versions?: string[] };
  days: ReplayDaySummary[];
  items: WorkflowSummary[];
}
export interface ReplayDayDetail {
  contract: string; schemaVersion: string; runId: string; date: string; status: WorkflowStatus;
  metrics: { totalR: number; provisionalR?: number | null; progress: number; sessionCount: number; gptProcesses?: number; gptWaiting?: number; gptFailed?: number; events?: number };
  sessions: WorkflowSummary[]; variants: string[];
  gptProcesses?: GptProcess[];
  conclusions?: Array<{ processId: string; runId: string | null; conclusion: string; at: string | null }>;
  timeline?: OperationsEvent[];
}

export interface PricePoint { time: string; open: number | null; high: number | null; low: number | null; close: number; volume?: number | null; source?: string }

export type AnalyticalResearchPhaseName =
  | "CONTINUITY"
  | "CORE_MARKET"
  | "INDEX_CONFIRMATION"
  | "CROSS_ASSET"
  | "MEGACAPS"
  | "MACRO"
  | "NEWS"
  | "THESIS_EVOLUTION"
  | "OPPORTUNITY"
  | "CONCLUSION";

export type AnalyticalResearchStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "COMPLETE"
  | "DEGRADED"
  | "UNAVAILABLE"
  | "BLOCKED";

export interface AnalyticalResearchPhase {
  phase: AnalyticalResearchPhaseName;
  status: AnalyticalResearchStatus;
  required: boolean;
  evidenceCount: number;
  toolCallCount: number;
  startedAt: string | null;
  completedAt: string | null;
  degradedReasons: string[];
}

export interface AnalyticalResearchProgress {
  schemaVersion: "desk_analytical_research_progress_v1";
  status: AnalyticalResearchStatus;
  currentPhase: AnalyticalResearchPhaseName | null;
  startedAt: string | null;
  updatedAt: string | null;
  phases: AnalyticalResearchPhase[];
  coverage: {
    required: number;
    total: number;
    complete: number;
    percent: number;
  };
  toolCallsCount: number;
  evidenceReceiptsCount: number;
}

export interface GptProcess {
  id: string; runId: string | null; stepId: string | null; workflow: string; status: WorkflowStatus; rawStatus: string;
  revision: number; attempt: number; maxAttempts: number; worker: string | null; leaseExpiresAt: string | null;
  createdAt: string | null; startedAt: string | null; completedAt: string | null; updatedAt: string | null;
  durationMs: number | null; events: OperationsEvent[]; conclusion: string | null; decision: string | null;
  error: WorkflowSummary["error"]; telemetry: GptTelemetry; bundle: { bundleId: string; manifest: unknown; dataQuality: unknown } | null;
  researchProgress?: AnalyticalResearchProgress | null;
}

export interface GptProcessList { contract: string; schemaVersion: string; count: number; items: GptProcess[] }
export interface GptTransportContract {
  saveTool: string | null;
  suggestedPayload: Record<string, unknown> | null;
  workItemId: string | null;
  workerId: string | null;
  leaseToken: string | null;
  leaseProtected?: boolean;
  hasLeaseHandle: boolean;
  lease: { state: "none" | "active" | "expiring" | "expired"; expiresAt: string | null; remainingMs: number | null };
  manifestAvailable: boolean;
  saveTargetAvailable: boolean;
  promptAvailable: boolean;
}

export interface GptTransportHealth {
  state: "saved" | "ready_to_save" | "attention" | "lease_expired" | "waiting";
  canSave: boolean;
  blockedReasons: string[];
  hasLeaseHandle: boolean;
  leaseState: GptTransportContract["lease"]["state"];
  leaseExpiresAt: string | null;
  leaseRemainingMs: number | null;
  saveReady: boolean;
  promptReady: boolean;
  manifestReady: boolean;
}

export interface GptRiskFlag {
  code: string;
  label: string;
  tone: "positive" | "warning" | "critical" | "info" | "muted" | string;
}

export interface GptOperationsContext {
  workflow: WorkflowSummary | null;
  workflowCommand: WorkflowActionDescriptor | null;
  incidents: Incident[];
  runbooks: OperationsRunbook[];
  links: Array<OperationsLink & { action?: string }>;
  riskFlags: GptRiskFlag[];
  transportHealth: GptTransportHealth;
}

export interface GptProcessDetail {
  contract: string; schemaVersion: string; process: GptProcess; manifest: unknown; prompt: string | null;
  saveTarget: unknown; transport: GptTransportContract; operationsContext: GptOperationsContext; error: unknown; raw: unknown;
  researchProgress?: AnalyticalResearchProgress | null;
}

export interface GptTelemetry {
  available: boolean;
  provider: string | null;
  model: string | null;
  requestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  reasoningEffort: CodexReasoningEffort | null;
  runtimeSettingsRevision: number | null;
  costUsd: number | null;
  apiLatencyMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ObservabilityProcess {
  id: string;
  scope: "live" | "replay" | string;
  workflow: string;
  runId: string | null;
  workItemId: string | null;
  cursorId: string | null;
  checkpoint: string | null;
  tradingDate: string | null;
  session: string | null;
  strategyId: string | null;
  status: WorkflowStatus;
  rawStatus: string;
  worker: string | null;
  attempts: number;
  maxAttempts: number;
  failureCount: number;
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  leaseExpiresAt: string | null;
  queueMs: number | null;
  executionMs: number | null;
  endToEndMs: number | null;
  lease: { state: "none" | "active" | "expiring" | "expired"; expiresAt: string | null; remainingMs: number | null };
  telemetry: GptTelemetry;
  sla: { queueBreached: boolean; executionBreached: boolean; leaseBreached: boolean };
  error: WorkflowSummary["error"];
  researchProgress?: AnalyticalResearchProgress | null;
}

export interface ObservabilityBreakdown {
  label: string;
  processes: number;
  running: number;
  failed: number;
  successRate: number | null;
  avgExecutionMs: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  costCoverage: { available: number; total: number; percent: number };
}

export interface ObservabilityPolicy {
  id: string;
  revision: number;
  enabled: boolean;
  queueWarningMs: number;
  executionWarningMs: number;
  leaseExpiringMs: number;
  telemetryCoverageWarningPct: number;
  costCoverageMinimumPct: number;
  failureRateWarningPct: number;
  dailyCostBudgetUsd: number | null;
  monthlyCostBudgetUsd: number | null;
  updatedAt: string | null;
}

export interface GuardrailSignal {
  id: string;
  type: string;
  severity: "critical" | "warning";
  title: string;
  message: string;
  targetId: string;
  processId?: string | null;
  runId?: string | null;
  observedValue: number | null;
  thresholdValue: number | null;
  unit: "ms" | "percent" | "usd" | string;
  observedAt: string | null;
}

export interface BudgetPeriod {
  period: string;
  measuredCostUsd: number;
  limitUsd: number | null;
  coveragePct: number;
  state: "not_configured" | "breached" | "insufficient_data" | "within";
}

export interface ObservabilityPolicyActionInput {
  action: "update";
  expectedRevision: number;
  idempotencyKey: string;
  confirmationPhrase: "CONFIRM_UPDATE";
  reason: string;
  policy: Omit<ObservabilityPolicy, "id" | "revision" | "updatedAt">;
}

export interface ObservabilityPolicyResponse {
  contract: "DeskObservabilityPolicy";
  schemaVersion: "1.0.0";
  policy: ObservabilityPolicy;
  persisted: boolean;
}

export type CodexReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export interface AiRuntimeSettings {
  id: string;
  revision: number;
  reasoningEffort: CodexReasoningEffort;
  source: "database" | "environment" | "default" | string;
  supportedReasoningEfforts: CodexReasoningEffort[];
  appliesTo: "next_analysis";
  updatedAt: string | null;
  updatedBy: unknown;
}

export interface AiRuntimeSettingsResponse {
  contract: "DeskAiRuntimeSettings";
  schemaVersion: "1.0.0";
  settings: AiRuntimeSettings;
  persisted: boolean;
}

export interface AiRuntimeSettingsActionInput {
  action: "update_reasoning_effort";
  expectedRevision: number;
  reasoningEffort: CodexReasoningEffort;
  idempotencyKey: string;
  confirmationPhrase: "CONFIRM_UPDATE_REASONING_EFFORT";
  reason: string;
}

export interface ObservabilityOverview {
  contract: "DeskObservabilityOverview";
  schemaVersion: "1.0.0";
  generatedAt: string;
  filters: Record<string, string | null>;
  sla: { queueWarningMs: number; executionWarningMs: number; leaseExpiringMs: number };
  summary: {
    processes: number; queued: number; running: number; failed: number; completed: number; retries: number;
    successRate: number | null; avgQueueMs: number | null; avgExecutionMs: number | null; p95ExecutionMs: number | null;
    inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; costUsd: number | null; slaBreaches: number;
  };
  coverage: {
    telemetry: { available: number; total: number; percent: number };
    tokens: { available: number; total: number; percent: number };
    cost: { available: number; total: number; percent: number };
  };
  guardrails: {
    policy: ObservabilityPolicy;
    enabled: boolean;
    summary: {
      signals: number; critical: number; warning: number; telemetryCoveragePct: number;
      costCoveragePct: number; failureRatePct: number | null;
    };
    budgets: { daily: BudgetPeriod[]; monthly: BudgetPeriod[] };
    signals: GuardrailSignal[];
  };
  leases: { active: number; expiring: number; expired: number };
  queue: { depth: number; oldestQueuedMs: number | null };
  aiWorkers: {
    expected: number;
    registered: number;
    healthy: number;
    active: number;
    shadow: number;
    degraded: number;
    items: Array<{
      serviceId: string;
      workerId: string;
      scope: string | null;
      mode: string;
      status: string;
      healthy: boolean;
      releaseVersion: string | null;
      heartbeatAt: string | null;
      ageMs: number | null;
      lastResult: Record<string, unknown> | null;
      latestRun: {
        id: string;
        workerId: string | null;
        scope: string | null;
        workflow: string | null;
        status: string;
        decisionSummary: string | null;
        dataQualityStatus: string | null;
        startedAt: string | null;
        completedAt: string | null;
        error: Record<string, unknown> | null;
      } | null;
    }>;
    recentRuns: Array<{
      id: string;
      workerId: string | null;
      scope: string | null;
      workflow: string | null;
      status: string;
      decisionSummary: string | null;
      dataQualityStatus: string | null;
      startedAt: string | null;
      completedAt: string | null;
      error: Record<string, unknown> | null;
    }>;
  };
  aiRuntimeSettings: AiRuntimeSettings;
  facets: {
    scopes: string[]; workflows: string[]; workers: string[]; sessions: string[]; models: string[]; providers: string[];
    statuses: string[]; dateRange: { from: string | null; to: string | null };
  };
  breakdowns: { workflows: ObservabilityBreakdown[]; workers: ObservabilityBreakdown[]; models: ObservabilityBreakdown[] };
  daily: Array<{ date: string; processes: number; completed: number; failed: number; totalTokens: number | null; costUsd: number | null }>;
  count: number;
  items: ObservabilityProcess[];
}

export interface ReplayRunDetail {
  contract: string; schemaVersion: string; run: WorkflowSummary; canonicalState: Record<string, unknown>;
  timeline: OperationsEvent[]; priceSeries: PricePoint[]; gptProcesses: GptProcess[];
  conclusions: Array<{ processId: string; conclusion: string; at: string | null }>;
}

export interface ReplaySessionDetail extends ReplayRunDetail { parentRunId: string; sessionExecutionId: string }

export interface ReplayComparisonItem {
  id: string;
  baseline: boolean;
  rank: number | null;
  run: WorkflowSummary;
  summary: Record<string, unknown>;
  metrics: {
    resultR: number;
    deltaR: number;
    progress: number;
    stepsDone: number;
    stepsTotal: number;
    stepCompletionPct: number;
    gptProcesses: number;
    gptWaiting: number;
    gptFailed: number;
    telemetryAvailable: number;
    telemetryCoveragePct: number | null;
    costUsd: number | null;
    totalTokens: number | null;
    timelineEvents: number;
    decisions: number;
    pricePoints: number;
    durationMs: number | null;
  };
  conclusion: { processId: string | null; runId: string | null; conclusion: string | null; decision: string | null; at: string | null } | null;
  riskFlags: string[];
  priceRange: { from: string | null; to: string | null; firstClose: number | null; lastClose: number | null };
  timelineSample: OperationsEvent[];
  gptProcesses: GptProcess[];
  conclusions: Array<{ processId: string; conclusion: string; at: string | null }>;
}

export interface ReplayComparison {
  contract: "DeskReplayComparison";
  schemaVersion: string;
  ids: string[];
  baselineRunId: string | null;
  dimensions: string[];
  summary: {
    count: number;
    baselineRunId: string | null;
    bestRunId: string | null;
    worstRunId: string | null;
    bestR: number;
    worstR: number;
    averageR: number;
    spreadR: number;
    completed: number;
    failed: number;
    waitingGpt: number;
    gptProcesses: number;
    telemetryCoveragePct: number | null;
    costUsd: number | null;
    totalTokens: number | null;
    timelineEvents: number;
    decisions: number;
    riskFlags: string[];
  };
  items: ReplayComparisonItem[];
}

export interface Incident {
  id: string; sourceId: string; sourceCollection: string; kind: string; title: string; message: string;
  severity: string; lifecycleStatus: "open" | "acknowledged" | "snoozed" | "resolved" | "archived";
  revision: number; tradingDate: string | null; session: string | null; runId: string | null;
  processId?: string | null; targetId?: string | null; workflow?: string | null; worker?: string | null;
  source?: string | null; guardrailType?: string | null; fingerprint?: string | null; owner?: string | null;
  occurrenceCount?: number; observedValue?: number | null; thresholdValue?: number | null; unit?: string | null;
  policyRevision?: number | null; policySnapshot?: Record<string, unknown> | null; evidence?: Record<string, unknown> | null;
  timeline?: IncidentTimelineEvent[];
  createdAt: string | null; firstObservedAt?: string | null; lastObservedAt?: string | null; resolvedAt?: string | null;
  updatedAt: string | null; snoozedUntil: string | null;
  triage?: IncidentTriage;
  sla?: IncidentSla;
  recommendedActions?: IncidentRecommendedAction[];
  links?: OperationsLink[];
  blastRadius?: IncidentBlastRadius;
}

export interface OperationsLink { label: string; href: string; kind: string }

export interface IncidentTriage {
  score: number;
  queue: "page" | "action" | "watch" | "backlog" | "closed" | string;
  nextAction: string;
  ownerRequired: boolean;
  reasonCodes: string[];
}

export interface IncidentSla {
  ageMs: number | null;
  targetMs: number;
  dueAt: string | null;
  remainingMs: number | null;
  breached: boolean;
}

export interface IncidentRecommendedAction {
  action: "acknowledge" | "assign" | "snooze" | "resolve" | "reopen" | string;
  label: string;
  tone: string;
  reason: string;
  confirmationPhrase: string;
}

export interface IncidentBlastRadius {
  scope: string;
  count: number;
  impacted: Array<{ kind: string; id: string; label: string }>;
}

export interface IncidentTimelineEvent {
  id: string;
  type: string;
  at: string | null;
  title: string;
  message: string;
  severity: string;
  actor: unknown;
  evidence: Record<string, unknown> | null;
}

export interface IncidentList {
  contract: string;
  schemaVersion: string;
  generatedAt?: string;
  filters?: Record<string, string | null>;
  count: number;
  summary?: {
    open: number; critical: number; warning: number; acknowledged: number; snoozed: number; resolved: number; guardrails: number;
    unowned?: number; slaBreached?: number; page?: number; action?: number;
  };
  triage?: {
    active: number; page: number; action: number; watch: number; backlog: number; closed: number;
    top: Array<{ id: string; title: string; score: number; queue: string; href: string }>;
  };
  items: Incident[];
}

export interface ObservabilityIncidentSync {
  contract: "DeskObservabilityIncidentSync";
  schemaVersion: "1.0.0";
  generatedAt: string;
  evaluatedSignals: number;
  opened: number;
  updated: number;
  unchanged: number;
  resolved: number;
  active: number;
  incidents: Incident[];
  notifications?: NotificationSync | { ok: false; error: unknown } | null;
}

export type NotificationStatus = "pending" | "read" | "dismissed" | "cleared";
export type EscalationLevel = "page" | "action" | "watch" | "muted" | "cleared";

export interface OperationsNotification {
  id: string;
  sourceId: string;
  source: string | null;
  channel: string;
  deliveryState: string;
  status: NotificationStatus;
  escalationLevel: EscalationLevel;
  priority: number;
  reasonCodes: string[];
  title: string;
  message: string;
  severity: string;
  revision: number;
  incidentId: string | null;
  incidentSourceId: string | null;
  incidentKind: string | null;
  incidentRevision: number;
  incidentLifecycleStatus: string | null;
  owner: string | null;
  runId: string | null;
  processId: string | null;
  workflow: string | null;
  worker: string | null;
  tradingDate: string | null;
  session: string | null;
  targetId: string | null;
  targetUrl: string | null;
  dedupeKey: string | null;
  fingerprint: string | null;
  evidence: Record<string, unknown> | null;
  timeline: IncidentTimelineEvent[];
  firstNotifiedAt: string | null;
  lastEvaluatedAt: string | null;
  readAt: string | null;
  dismissedAt: string | null;
  clearedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  allowedActions: NotificationAction[];
}

export interface NotificationList {
  contract: "DeskNotificationList";
  schemaVersion: "1.0.0";
  generatedAt: string;
  filters: Record<string, string | null>;
  count: number;
  summary: {
    active: number; pending: number; read: number; dismissed: number; cleared: number;
    page: number; action: number; watch: number; muted: number;
  };
  items: OperationsNotification[];
}

export interface NotificationSync {
  contract: "DeskNotificationSync";
  schemaVersion: "1.0.0";
  generatedAt: string;
  evaluatedIncidents: number;
  opened: number;
  updated: number;
  unchanged: number;
  cleared: number;
  active: number;
  notifications: OperationsNotification[];
}

export interface TelegramDelivery {
  deliveryId: string;
  profile: "admin" | "trading";
  sourceKind: string;
  status: "pending" | "sending" | "sent" | "failed" | "suppressed" | "uncertain";
  message: string;
  attemptCount: number;
  telegramMessageId: string | null;
  sentAt: string | null;
  lastError: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TelegramStatus {
  ok: true;
  contract: "DeskTelegramStatus";
  schemaVersion: "1.0.0";
  generatedAt: string;
  config: {
    enabled: boolean;
    adminEnabled: boolean;
    tradingEnabled: boolean;
    commandsEnabled: boolean;
    mutedUntil: string | null;
    baselineCompletedAt: string | null;
    revision: number;
    updatedBy: string | null;
    updatedAt: string | null;
  };
  effective: {
    enabled: boolean;
    muted: boolean;
    adminReady: boolean;
    tradingReady: boolean;
    commandsReady: boolean;
  };
  environment: {
    workerEnabled: boolean;
    adminConfigured: boolean;
    tradingConfigured: boolean;
    commandsRequested: boolean;
    pollMs: number;
  };
  bots: {
    admin: { configured: boolean; username: string | null; displayName: string | null; verifiedAt: string | null };
    trading: { configured: boolean; username: string | null; displayName: string | null; verifiedAt: string | null };
  };
  worker: {
    status: string;
    details: Record<string, unknown>;
    heartbeatAt: string | null;
    releaseVersion: string | null;
  } | null;
  outbox: {
    counts: Record<string, number>;
    recent: TelegramDelivery[];
  };
}

export type TelegramActionInput =
  | {
      action: "configure";
      expectedRevision: number;
      enabled: boolean;
      adminEnabled: boolean;
      tradingEnabled: boolean;
      commandsEnabled: boolean;
      idempotencyKey: string;
      confirmationPhrase: "CONFIRM_TELEGRAM_CONFIGURATION";
      reason: string;
    }
  | {
      action: "mute";
      expectedRevision: number;
      minutes: number;
      idempotencyKey: string;
      confirmationPhrase: "CONFIRM_TELEGRAM_MUTE";
      reason: string;
    }
  | {
      action: "resume";
      expectedRevision: number;
      idempotencyKey: string;
      confirmationPhrase: "CONFIRM_TELEGRAM_RESUME";
      reason: string;
    }
  | {
      action: "test";
      profile: "admin" | "trading";
      idempotencyKey: string;
      confirmationPhrase: "CONFIRM_TELEGRAM_TEST";
      reason: string;
    };

export type NotificationAction = "mark_read" | "dismiss";
export interface NotificationActionInput {
  action: NotificationAction;
  expectedRevision: number;
  idempotencyKey: string;
  confirmationPhrase: string;
  reason: string;
}

export type RunbookStatus = "action_required" | "waiting" | "watching" | "resolved";
export type RunbookKind = "lease_expired" | "workflow_blocked" | "gpt_failure" | "telemetry_missing" | "cost_budget_breach" | "data_quality_issue" | "incident_response" | string;

export interface RunbookStep {
  id: string;
  index: number;
  kind: "investigation" | "operator_action" | string;
  title: string;
  description: string;
  href?: string;
  commandAction?: string;
}

export interface RunbookLink {
  label: string;
  href: string;
  kind: string;
}

export interface OperationsRunbook {
  id: string;
  sourceId: string;
  kind: RunbookKind;
  title: string;
  summary: string;
  severity: string;
  status: RunbookStatus;
  priority: number;
  reasonCodes: string[];
  notificationId: string | null;
  incidentId: string | null;
  workflowId: string | null;
  runId: string | null;
  processId: string | null;
  owner: string | null;
  session: string | null;
  tradingDate: string | null;
  updatedAt: string | null;
  context: Record<string, string | number | boolean | null>;
  steps: RunbookStep[];
  nextAction: RunbookStep | null;
  links: RunbookLink[];
  timeline: Array<IncidentTimelineEvent & { source?: string }>;
  triage?: IncidentTriage | null;
  sla?: IncidentSla | null;
  recommendedActions?: IncidentRecommendedAction[];
  blastRadius?: IncidentBlastRadius | null;
}

export interface RunbookList {
  contract: "DeskRunbookList";
  schemaVersion: "1.0.0";
  generatedAt: string;
  filters: Record<string, string | null>;
  count: number;
  summary: {
    actionRequired: number; waiting: number; watching: number; critical: number; warning: number;
    leaseExpired: number; workflowBlocked: number; gptFailure: number; dataQuality: number;
  };
  items: OperationsRunbook[];
}

export interface RunbookDetail {
  contract: "DeskRunbookDetail";
  schemaVersion: "1.0.0";
  generatedAt: string;
  runbook: OperationsRunbook;
  related: { incidentId: string | null; notificationId: string | null; workflowId: string | null; processId: string | null };
}
export interface PerformanceTotals {
  totalR: number; trades: number; wins: number; losses: number; flats: number; winRate: number | null; expectancyR: number | null;
  grossProfitR: number; grossLossR: number; profitFactor: number | null; maxDrawdownR: number; currentDrawdownR: number;
  bestTradeR: number | null; worstTradeR: number | null; bestDayR: number | null; worstDayR: number | null;
  activeDays: number; winningDays: number; losingDays: number;
}
export interface PerformanceDailyPoint {
  date: string; totalR: number; trades: number; wins: number; losses: number; winRate: number | null;
  runIds: string[]; strategyIds: string[]; sessions: string[]; source: string;
}
export interface PerformanceEquityPoint {
  sequence: number; date: string | null; at: string | null; tradeId: string | null; runId: string | null;
  strategyId: string | null; resultR: number; cumulativeR: number; drawdownR: number;
}
export interface PerformanceBreakdownItem {
  label: string; totalR: number; trades: number; wins?: number; losses?: number; winRate?: number | null; expectancyR?: number | null;
}
export interface PerformanceAttributionItem extends PerformanceBreakdownItem {
  bestTradeR: number | null;
  worstTradeR: number | null;
  avgR: number | null;
  days: string[];
  runIds: string[];
  sessionIds: string[];
  strategyIds: string[];
  contributionPct: number | null;
  tone: "positive" | "negative" | "neutral" | string;
}
export interface PerformanceDayDrilldown extends PerformanceDailyPoint {
  cumulativeR: number | null;
  drawdownR: number | null;
  bestTrade: PerformanceTradeItem | null;
  worstTrade: PerformanceTradeItem | null;
  tradeItems: PerformanceTradeItem[];
  relatedRuns: Array<{ id: string; sourceId: string; session: string | null; strategyId: string | null; status: WorkflowStatus; totalR: number }>;
}
export interface PerformanceTradeItem {
  id: string;
  runId: string | null;
  strategyId: string | null;
  session: string | null;
  instrument: string | null;
  direction: string | null;
  status: string | null;
  resultR: number | null;
  at: string | null;
}
export interface PerformanceOverview {
  contract: string; schemaVersion: string; generatedAt: string; filters: Record<string, string | null>;
  totals: PerformanceTotals; risk: Pick<PerformanceTotals, "maxDrawdownR" | "currentDrawdownR" | "profitFactor" | "bestTradeR" | "worstTradeR" | "bestDayR" | "worstDayR">;
  facets: { strategies: string[]; sessions: string[]; instruments: string[]; directions: string[]; dateRange: { from: string | null; to: string | null } };
  stats: Array<Record<string, unknown>>; daily: Array<Record<string, unknown>>; dailySeries: PerformanceDailyPoint[];
  equity: PerformanceEquityPoint[]; relatedRuns: WorkflowSummary[]; replayDays: ReplayDaySummary[];
  breakdowns: Array<{ dimension: string; items: PerformanceBreakdownItem[] }>;
  attribution: Array<{ dimension: string; best: PerformanceAttributionItem | null; worst: PerformanceAttributionItem | null; items: PerformanceAttributionItem[] }>;
  dayDrilldowns: PerformanceDayDrilldown[];
}
export interface HistorySessionSummary {
  id: string; tradingDate: string | null; session: string | null; status: WorkflowStatus; workflowCount: number;
  progress: number; totalR: number; gptProcesses: number; incidentCount: number; kinds: string[]; strategies: string[];
  startedAt: string | null; completedAt: string | null; updatedAt: string | null; durationMs: number;
  performance: PerformanceDailyPoint | null; workflows: WorkflowSummary[];
  statusCounts: Record<string, number>; kindCounts: Record<string, number>; riskFlags: string[]; automationScore: number;
  links: Array<{ label: string; href: string; kind: string }>;
}
export interface HistoryMatrixItem {
  label: string; count: number; totalR: number; gptProcesses: number; incidents: number; progress: number;
  statuses: Record<string, number>; kinds: string[]; sessions: string[]; strategies: string[]; updatedAt: string | null;
  href: string | null; tone: string;
}
export interface HistoryIncidentMatrixItem {
  label: string; count: number; critical: number; warning: number; sessions: string[]; updatedAt: string | null; tone: string;
}
export interface HistoryAuditItem {
  id: string; at: string | null; type: string; title: string; message: string; status: string; severity: string;
  actor: string; workflowId: string | null; runId: string | null; processId: string | null; href: string | null;
}
export interface HistoryDecisionFlowItem {
  id: string; at: string | null; type: string; title: string; status: WorkflowStatus; layer: string;
  workflowId: string | null; workflowName: string | null; runId: string | null; processId: string | null;
  decision: string | null; conclusion: string | null; detail: string; href: string | null;
  telemetry: { model: string | null; totalTokens: number | null; costUsd: number | null } | null;
}
export interface DeskHistory {
  contract: string; schemaVersion: string; generatedAt: string; filters: Record<string, string | null>;
  summary: {
    sessions: number; workflows: number; running: number; waitingGpt: number; blocked: number; failed: number; completed: number;
    openIncidents: number; totalR: number; gptProcesses: number; activeDays: number; strategies: number;
  };
  facets: {
    statuses: string[]; sessions: string[]; kinds: string[]; strategies: string[];
    dateRange: { from: string | null; to: string | null };
  };
  governance: {
    statusMatrix: HistoryMatrixItem[]; kindMatrix: HistoryMatrixItem[]; sessionMatrix: HistoryMatrixItem[];
    strategyMatrix: HistoryMatrixItem[]; incidentMatrix: HistoryIncidentMatrixItem[]; auditTrail: HistoryAuditItem[];
    riskFlags: string[]; automationScore: number;
    sessions: Array<Pick<HistorySessionSummary, "id" | "tradingDate" | "session" | "status" | "workflowCount" | "progress" | "totalR" | "gptProcesses" | "incidentCount" | "updatedAt" | "riskFlags"> & { href: string }>;
  };
  sessions: HistorySessionSummary[]; incidents: Incident[]; audit: Array<Record<string, unknown>>; performance: PerformanceOverview;
}
export interface HistorySessionDetail {
  contract: string; schemaVersion: string; generatedAt: string; session: HistorySessionSummary;
  summary: {
    workflows: number; running: number; waitingGpt: number; blocked: number; failed: number; completed: number;
    progress: number; totalR: number; gptProcesses: number; incidents: number; events: number; strategies: number;
  };
  workflows: WorkflowSummary[]; gptProcesses: GptProcess[]; incidents: Incident[]; timeline: OperationsEvent[];
  matrix: {
    statuses: HistoryMatrixItem[]; kinds: HistoryMatrixItem[]; gptStatuses: HistoryMatrixItem[];
    eventLayers: HistoryMatrixItem[]; incidentLifecycle: HistoryIncidentMatrixItem[];
  };
  decisionFlow: HistoryDecisionFlowItem[]; auditTrail: HistoryAuditItem[];
  links: Array<{ label: string; href: string; kind: string }>;
  performance: PerformanceOverview;
}
export interface StrategyList {
  contract: string; schemaVersion: string; count: number;
  items: Array<{
    id: string; catalog: Record<string, unknown> | null; config: Record<string, unknown> | null; runtime: Record<string, unknown> | null;
    stats: Record<string, unknown> | null; performance: PerformanceTotals; replayCount: number;
    versions: Array<Record<string, unknown>>; activeContracts: Array<{ name: string; version: string; status: string }>;
  }>;
}
export interface StrategyVersionChange { path: string; before: unknown; after: unknown }
export interface StrategyVersionComparison {
  contract: string; schemaVersion: string; strategyId: string;
  left: Record<string, unknown> | null; right: Record<string, unknown> | null; changes: StrategyVersionChange[];
}

export interface OperationsCommandInput {
  action: "retry" | "resume" | "pause" | "cancel" | "acknowledge" | "assign" | "snooze" | "resolve" | "reopen";
  expectedRevision: number;
  idempotencyKey: string;
  confirmationPhrase: string;
  reason: string;
  snoozedUntilUtc?: string;
  owner?: string;
}
