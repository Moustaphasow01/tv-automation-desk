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
export interface WorkflowDetail {
  contract: string; schemaVersion: string; workflow: WorkflowSummary; steps: WorkflowStep[];
  events: OperationsEvent[]; allowedActions: Array<"retry" | "resume" | "pause" | "cancel">;
  relations: Record<string, unknown>;
}

export interface ReplayDaySummary {
  date: string;
  status: WorkflowStatus;
  sessionCount: number;
  running: number;
  failed: number;
  totalProgress: number;
  totalR: number;
  sessions: WorkflowSummary[];
}

export interface ReplayList { contract: string; schemaVersion: string; count: number; days: ReplayDaySummary[]; items: WorkflowSummary[] }
export interface ReplayDayDetail {
  contract: string; schemaVersion: string; runId: string; date: string; status: WorkflowStatus;
  metrics: { totalR: number; progress: number; sessionCount: number };
  sessions: WorkflowSummary[]; variants: string[];
}

export interface PricePoint { time: string; open: number | null; high: number | null; low: number | null; close: number; volume?: number | null; source?: string }

export interface GptProcess {
  id: string; runId: string | null; stepId: string | null; workflow: string; status: WorkflowStatus; rawStatus: string;
  revision: number; attempt: number; maxAttempts: number; worker: string | null; leaseExpiresAt: string | null;
  createdAt: string | null; startedAt: string | null; completedAt: string | null; updatedAt: string | null;
  durationMs: number | null; events: OperationsEvent[]; conclusion: string | null; decision: string | null;
  error: WorkflowSummary["error"]; bundle: { bundleId: string; manifest: unknown; dataQuality: unknown } | null;
}

export interface GptProcessList { contract: string; schemaVersion: string; count: number; items: GptProcess[] }
export interface GptProcessDetail { contract: string; schemaVersion: string; process: GptProcess; manifest: unknown; prompt: string | null; saveTarget: unknown; error: unknown; raw: unknown }

export interface ReplayRunDetail {
  contract: string; schemaVersion: string; run: WorkflowSummary; canonicalState: Record<string, unknown>;
  timeline: OperationsEvent[]; priceSeries: PricePoint[]; gptProcesses: GptProcess[];
  conclusions: Array<{ processId: string; conclusion: string; at: string | null }>;
}

export interface ReplaySessionDetail extends ReplayRunDetail { parentRunId: string; sessionExecutionId: string }

export interface Incident {
  id: string; sourceId: string; sourceCollection: string; kind: string; title: string; message: string;
  severity: string; lifecycleStatus: "open" | "acknowledged" | "snoozed" | "resolved" | "archived";
  revision: number; tradingDate: string | null; session: string | null; runId: string | null;
  createdAt: string | null; updatedAt: string | null; snoozedUntil: string | null;
}

export interface IncidentList { contract: string; schemaVersion: string; count: number; items: Incident[] }
export interface PerformanceOverview { contract: string; schemaVersion: string; totals: Record<string, number | null>; stats: unknown[]; daily: Array<Record<string, unknown>>; replayDays: ReplayDaySummary[]; breakdowns: Array<{ dimension: string; items: Array<Record<string, unknown>> }> }
export interface DeskHistory { contract: string; schemaVersion: string; sessions: Array<{ id: string; tradingDate: string | null; session: string | null; status: WorkflowStatus; workflowCount: number; workflows: WorkflowSummary[] }>; incidents: Incident[]; audit: Array<Record<string, unknown>>; performance: PerformanceOverview }
export interface StrategyList { contract: string; schemaVersion: string; count: number; items: Array<{ id: string; catalog: Record<string, unknown> | null; config: Record<string, unknown> | null; runtime: Record<string, unknown> | null; versions: Array<Record<string, unknown>>; activeContracts: Array<{ name: string; version: string; status: string }> }> }

export interface OperationsCommandInput {
  action: "retry" | "resume" | "pause" | "cancel" | "acknowledge" | "snooze" | "resolve" | "reopen";
  expectedRevision: number;
  idempotencyKey: string;
  confirmationPhrase: string;
  reason: string;
  snoozedUntilUtc?: string;
}
