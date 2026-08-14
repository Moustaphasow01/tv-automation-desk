import { randomUUID } from "node:crypto";
import { buildAgentTaskRunMetricV1 } from "@tv-automation/desk-domain";

const UPSERT_AGENT_TASK_RUN_METRICS_SQL = `
  INSERT INTO agent_task_run_metrics (
    agent_task_run_metric_id, agent_task_id, agent_mission_id, agent_conversation_id,
    agent_execution_policy_snapshot_id, agent_task_dead_letter_id, worker_id, lane,
    task_type, model, reasoning_effort, outcome, queue_latency_ms, run_duration_ms,
    total_latency_ms, input_tokens, output_tokens, total_tokens, cost_micros_usd,
    output_ref, error_code, metric, metric_hash, started_at_utc, finished_at_utc
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8,
    $9, $10, $11, $12, $13, $14,
    $15, $16, $17, $18, $19,
    $20, $21, $22::jsonb, $23, $24::timestamptz, $25::timestamptz
  )
  ON CONFLICT (agent_task_id) DO UPDATE
    SET agent_conversation_id = EXCLUDED.agent_conversation_id,
        agent_execution_policy_snapshot_id = EXCLUDED.agent_execution_policy_snapshot_id,
        agent_task_dead_letter_id = EXCLUDED.agent_task_dead_letter_id,
        worker_id = EXCLUDED.worker_id,
        outcome = EXCLUDED.outcome,
        queue_latency_ms = EXCLUDED.queue_latency_ms,
        run_duration_ms = EXCLUDED.run_duration_ms,
        total_latency_ms = EXCLUDED.total_latency_ms,
        input_tokens = EXCLUDED.input_tokens,
        output_tokens = EXCLUDED.output_tokens,
        total_tokens = EXCLUDED.total_tokens,
        cost_micros_usd = EXCLUDED.cost_micros_usd,
        output_ref = EXCLUDED.output_ref,
        error_code = EXCLUDED.error_code,
        metric = EXCLUDED.metric,
        metric_hash = EXCLUDED.metric_hash,
        finished_at_utc = EXCLUDED.finished_at_utc
  RETURNING *`;

export async function recordTaskRunMetrics(repository, input = {}) {
  const metric = buildAgentTaskRunMetricV1(input);
  return repository.withTransaction(async (client) => {
    const result = await client.query(UPSERT_AGENT_TASK_RUN_METRICS_SQL, metricParams(metric));
    return { metric, row: result.rows[0] };
  });
}

function metricParams(metric) {
  return [
    randomUUID(),
    metric.task_id,
    metric.mission_id,
    metric.conversation_id,
    metric.execution_policy_snapshot_id,
    metric.dead_letter_id,
    metric.worker_id,
    metric.lane,
    metric.task_type,
    metric.model,
    metric.reasoning_effort,
    metric.outcome,
    metric.queue_latency_ms,
    metric.run_duration_ms,
    metric.total_latency_ms,
    metric.input_tokens,
    metric.output_tokens,
    metric.total_tokens,
    metric.cost_micros_usd,
    metric.output_ref,
    metric.error_code,
    JSON.stringify(metric),
    metric.metric_hash,
    metric.started_at_utc,
    metric.finished_at_utc,
  ];
}
