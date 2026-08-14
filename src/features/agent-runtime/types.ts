export type AgentRuntimeLane = "live" | "safety" | "operations" | "replay" | "validation" | "research" | "default" | string;

export interface AgentRuntimeTaskLastRun {
  outcome: string;
  total_latency_ms?: number | null;
  total_tokens?: number | null;
  cost_micros_usd?: number | null;
}

export interface AgentRuntimeTask {
  task_id: string;
  mission_id: string;
  mission_key?: string | null;
  mission_type?: string | null;
  mission_status?: string | null;
  task_key: string;
  task_type: string;
  lane: AgentRuntimeLane;
  status: string;
  priority: number;
  assigned_worker_id?: string | null;
  lease_active?: boolean;
  lease_expires_at_utc?: string | null;
  attempt_count?: number;
  max_attempts?: number;
  not_before_utc?: string | null;
  input_ref?: unknown;
  output_ref?: unknown;
  payload_keys?: string[];
  last_error?: unknown;
  last_run?: AgentRuntimeTaskLastRun | null;
  created_at_utc?: string | null;
  updated_at_utc?: string | null;
}

export interface AgentRuntimeDeadLetter {
  dead_letter_id: string;
  task_id: string;
  mission_id: string;
  agent_id?: string | null;
  task_key?: string | null;
  task_type?: string | null;
  lane: AgentRuntimeLane;
  task_status?: string | null;
  status: string;
  error_code: string;
  error_message?: string | null;
  retryable?: boolean;
  attempt_count?: number;
  recovery_task_id?: string | null;
  operator_action_ref?: unknown;
  metadata?: Record<string, unknown>;
  created_at_utc?: string | null;
  resolved_at_utc?: string | null;
}

export interface AgentRuntimeMetric {
  metric_id: string;
  task_id: string;
  mission_id: string;
  conversation_id?: string | null;
  worker_id?: string | null;
  lane: AgentRuntimeLane;
  task_type: string;
  model?: string | null;
  reasoning_effort?: string | null;
  outcome: string;
  queue_latency_ms?: number | null;
  run_duration_ms?: number | null;
  total_latency_ms?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  cost_micros_usd?: number | null;
  output_ref?: unknown;
  error_code?: string | null;
  metric_hash?: string | null;
  finished_at_utc?: string | null;
}

export interface AgentRuntimePool {
  pool_id: AgentRuntimeLane;
  label: string;
  lane: AgentRuntimeLane;
  scheduler_lane: AgentRuntimeLane;
  enabled: boolean;
  rank: number;
  max_concurrent_workers: number;
  responsibilities: string[];
  task_status: Record<string, number>;
  task_count: number;
  active_count: number;
  failed_count: number;
  metrics: {
    run_count: number;
    completed_count: number;
    failed_count: number;
    total_tokens: number;
    cost_micros_usd: number;
  };
}

export interface AgentRuntimePoolOverview {
  ok: true;
  schema_version: string;
  policy_version: string;
  generated_at_utc: string;
  metrics_window_minutes: number;
  pools: AgentRuntimePool[];
  policy_hash: string;
  overview_hash: string;
}

export interface AgentRuntimeOverview {
  ok: true;
  schema: "agent_runtime_admin_overview_v1" | string;
  generated_at_utc: string;
  summary: {
    task_status: Array<{ lane: AgentRuntimeLane; status: string; count: number }>;
    dead_letter_status: Array<{ status: string; count: number }>;
  };
  recent_tasks: AgentRuntimeTask[];
  open_dead_letters: AgentRuntimeDeadLetter[];
  recent_metrics: AgentRuntimeMetric[];
}

export interface AgentRuntimeTaskList { ok: true; count: number; items: AgentRuntimeTask[] }
export interface AgentRuntimeDeadLetterList { ok: true; count: number; items: AgentRuntimeDeadLetter[] }
export interface AgentRuntimeMetricList { ok: true; count: number; items: AgentRuntimeMetric[] }

export interface AgentRuntimeSchedulerTaskDecision {
  task_id: string;
  task_key: string;
  task_type: string;
  lane: AgentRuntimeLane;
  status: string;
  priority: number;
  created_at_utc?: string | null;
  not_before_utc?: string | null;
  reason?: string;
}

export interface AgentRuntimeSchedulerPlan {
  ok: true;
  status: string;
  generated_at_utc: string;
  window_start_utc: string;
  policy: Record<string, unknown>;
  plan: {
    selected_tasks: AgentRuntimeSchedulerTaskDecision[];
    deferred_tasks: AgentRuntimeSchedulerTaskDecision[];
    rejected_tasks: AgentRuntimeSchedulerTaskDecision[];
    quota_state: Record<string, Record<string, unknown>>;
    summary: { selected_count: number; deferred_count: number; rejected_count: number; live_ready: boolean };
    plan_hash: string;
  };
}

export interface AgentRuntimeMutationInput {
  operator_id?: string;
  reason: string;
  idempotency_key: string;
}
