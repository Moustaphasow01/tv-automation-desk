export type AiContextTone = "neutral" | "positive" | "warning" | "critical" | "info";

export interface AiContextOverview {
  contract: "DeskAiContextOverview";
  schemaVersion: "ai_context_front_v1";
  generatedAt: string;
  source: {
    status: "ready" | "partial" | "unavailable";
    reads: Array<{ source: string; status: "ok" | "error"; count: number; error_code: string | null; error_message: string | null }>;
  };
  summary: {
    status: "READY" | "DEGRADED" | "NO_CONTEXT_DECISIONS";
    total_decisions: number;
    shadow_count: number;
    enforced_count: number;
    fallback_count: number;
    open_dead_letters: number;
    recent_runs: number;
    latest_decision_at_utc: string | null;
  };
  decisions: AiContextDecision[];
  metrics: AiContextMetric[];
  dead_letters: AiContextDeadLetter[];
  controls: AiContextControl[];
}

export interface AiContextDecision {
  decision_id: string;
  task_id: string;
  mission_key: string;
  task_type: string;
  lane: string;
  status: string;
  mode: string;
  recommendation: "TAKE" | "TAKE_REDUCED" | "WAIT" | "REJECT" | "UNKNOWN" | string;
  recommendation_effect: string;
  binding_action: string;
  fallback_applied: boolean;
  fallback_reason: string | null;
  rationale: string;
  model: string;
  reasoning_effort: string;
  latency_ms: number | null;
  tokens: number | null;
  updated_at_utc: string | null;
}

export interface AiContextMetric {
  metric_id: string;
  task_id: string;
  task_type: string;
  lane: string;
  worker_id: string | null;
  model: string | null;
  reasoning_effort: string | null;
  outcome: string;
  total_latency_ms: number | null;
  total_tokens: number | null;
  cost_micros_usd: number | null;
  finished_at_utc: string | null;
}

export interface AiContextDeadLetter {
  dead_letter_id: string;
  task_id: string;
  task_type: string;
  lane: string;
  status: string;
  error_code: string;
  error_message: string | null;
  created_at_utc: string | null;
}

export interface AiContextControl {
  code: string;
  severity: AiContextTone;
  label: string;
  detail: string;
}
