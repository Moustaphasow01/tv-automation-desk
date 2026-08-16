import { SystemClock } from "@tv-automation/desk-time";

export const AI_CONTEXT_FRONT_CONTRACT = "DeskAiContextOverview";
export const AI_CONTEXT_FRONT_SCHEMA_VERSION = "ai_context_front_v1";
const AI_CONTEXT_FRONT_CLOCK = new SystemClock();

export async function buildAiContextOverviewFromStore(store, args = {}) {
  const limit = boundedLimit(args.limit, 100, 500);
  const generatedAt = nowUtc(store);
  const [tasksResult, metricsResult, dlqResult] = await Promise.allSettled([
    callStore(store, "listAgentRuntimeTasks", { limit }),
    callStore(store, "listAgentRuntimeMetrics", { limit }),
    callStore(store, "listAgentRuntimeDeadLetters", { limit, status: "OPEN" }),
  ]);
  const gateResult = await Promise.resolve(
    typeof store?.listAiContextGateDecisions === "function"
      ? callStore(store, "listAiContextGateDecisions", { limit })
      : { items: [], optional_missing: true },
  ).then((value) => ({ status: "fulfilled", value }), (reason) => ({ status: "rejected", reason }));
  const tasks = contextItems(items(tasksResult));
  const metrics = contextItems(items(metricsResult));
  const deadLetters = contextItems(items(dlqResult));
  const gateDecisions = items(gateResult);
  const decisions = [...gateDecisionRows(gateDecisions), ...decisionRows(tasks, metrics)];
  return {
    contract: AI_CONTEXT_FRONT_CONTRACT,
    schemaVersion: AI_CONTEXT_FRONT_SCHEMA_VERSION,
    generatedAt: generatedAt,
    source: {
      status: sourceStatus([tasksResult, metricsResult, dlqResult]),
      reads: [
        readState("ai_context_gate_decisions", gateResult, gateDecisions.length),
        readState("agent_tasks", tasksResult, tasks.length),
        readState("agent_task_run_metrics", metricsResult, metrics.length),
        readState("agent_task_dead_letters", dlqResult, deadLetters.length),
      ],
    },
    summary: summary(decisions, metrics, deadLetters),
    decisions,
    metrics: metrics.map(metricRow),
    dead_letters: deadLetters.map(deadLetterRow),
    controls: controls(decisions, [tasksResult, metricsResult, dlqResult]),
  };
}

function gateDecisionRows(decisions) {
  return decisions.map((item) => {
    const payload = object(item.payload);
    const advisory = object(payload.advisory);
    const decision = object(payload.decision);
    const retry = object(payload.retry);
    return {
      decision_id: text(item.ai_context_gate_decision_id || item.decision_id),
      signal_id: text(item.signal_id || payload.signal_id || decision.signal_id || advisory.signal_id),
      task_id: text(item.agent_task_id),
      mission_key: text(payload.mission_key),
      task_type: text(payload.task_type || "AI_CONTEXT_GATE"),
      lane: text(payload.lane || "ai-context"),
      status: text(item.status || payload.status),
      mode: text(item.mode || payload.mode),
      recommendation: text(item.recommendation || advisory.recommendation || decision.recommendation || "UNKNOWN"),
      confidence: numberOrNull(item.confidence ?? advisory.confidence ?? decision.confidence),
      risk_multiplier: numberOrNull(item.risk_multiplier ?? advisory.risk_multiplier ?? decision.risk_multiplier),
      reason_codes: array(item.reason_codes?.length ? item.reason_codes : advisory.reason_codes || decision.reason_codes),
      anomalies: array(item.anomalies?.length ? item.anomalies : advisory.anomalies || decision.anomalies),
      invalidation: object(advisory.invalidation || decision.invalidation),
      recommendation_effect: text(payload.recommendation_effect || "READ_ONLY_ADVISORY"),
      binding_action: text(payload.binding_decision?.portfolio_action || "OBSERVE_ONLY"),
      fallback_applied: item.fallback_applied === true || payload.fallback_applied === true,
      fallback_reason: nullableText(item.fallback_reason || payload.fallback_reason),
      fallback_detail: payload.fallback_applied ? text(payload.fallback_reason || item.fallback_reason, "AI_CONTEXT_FALLBACK") : null,
      rationale: text(item.rationale || advisory.rationale || payload.rationale || "Aucune explication persistée dans payload AI Context Gate."),
      policy_version: text(item.policy_version || payload.policy_version),
      model_policy_version: text(item.model_policy_version || payload.model_policy_version),
      model: safeModelRef(item.model_ref || advisory.model_ref),
      reasoning_effort: "UNAVAILABLE",
      data_cutoff: nullableText(payload.data_cutoff || payload.dataCutoff || advisory.data_cutoff),
      decided_at_utc: nullableText(item.decided_at_utc || payload.as_of_utc),
      latency_ms: numberOrNull(payload.latency_ms),
      tokens: "UNAVAILABLE",
      token_input: "UNAVAILABLE",
      token_output: "UNAVAILABLE",
      measured_cost: "UNAVAILABLE",
      retry_allowed: retry.retry_allowed === true || item.retry_allowed === true,
      updated_at_utc: nullableText(item.decided_at_utc || payload.as_of_utc),
      availability: "KNOWN",
    };
  });
}

function decisionRows(tasks, metrics) {
  const metricByTask = new Map(metrics.map((item) => [item.task_id, item]));
  return tasks.map((task) => {
    const output = outputObject(task.output_ref);
    const advisory = object(output.advisory);
    const binding = object(output.binding_decision);
    const metric = metricByTask.get(task.task_id) || {};
    return {
      decision_id: text(output.execution_hash || task.task_id),
      signal_id: text(output.signal_id || advisory.signal_id || binding.signal_id),
      task_id: task.task_id,
      mission_key: text(task.mission_key),
      task_type: text(task.task_type),
      lane: text(task.lane),
      status: text(output.status || task.status),
      mode: text(output.mode || inferredMode(task)),
      recommendation: text(advisory.recommendation || output.recommendation || "UNKNOWN"),
      confidence: numberOrNull(advisory.confidence),
      risk_multiplier: numberOrNull(advisory.risk_multiplier),
      reason_codes: array(advisory.reason_codes),
      anomalies: array(advisory.anomalies),
      invalidation: object(advisory.invalidation),
      recommendation_effect: text(output.recommendation_effect || "UNKNOWN"),
      binding_action: text(binding.portfolio_action || "OBSERVE_ONLY"),
      fallback_applied: Boolean(output.fallback_applied),
      fallback_reason: nullableText(output.fallback_reason),
      rationale: text(advisory.rationale || output.rationale || refText(task.output_ref) || "Aucune explication persistée dans output_ref."),
      policy_version: text(output.policy_version),
      model_policy_version: text(output.model_policy_version),
      model: safeModelRef(metric.model || advisory.model_ref),
      reasoning_effort: text(metric.reasoning_effort),
      data_cutoff: nullableText(output.data_cutoff || advisory.data_cutoff),
      decided_at_utc: nullableText(output.as_of_utc),
      latency_ms: numberOrNull(output.latency_ms ?? metric.total_latency_ms),
      tokens: numberOrNull(metric.total_tokens),
      token_input: "UNAVAILABLE",
      token_output: "UNAVAILABLE",
      measured_cost: metric.cost_micros_usd === null || metric.cost_micros_usd === undefined ? "UNAVAILABLE" : numberOrNull(metric.cost_micros_usd),
      updated_at_utc: nullableText(task.updated_at_utc || metric.finished_at_utc),
      availability: "PARTIAL",
    };
  });
}

function summary(decisions, metrics, deadLetters) {
  const latest = decisions.map((item) => item.updated_at_utc).filter(Boolean).sort().at(-1) || null;
  return {
    status: decisions.length ? (deadLetters.length ? "DEGRADED" : "READY") : "NO_CONTEXT_DECISIONS",
    total_decisions: decisions.length,
    shadow_count: decisions.filter((item) => item.mode === "SHADOW").length,
    enforced_count: decisions.filter((item) => item.mode === "ENFORCED").length,
    fallback_count: decisions.filter((item) => item.fallback_applied).length,
    open_dead_letters: deadLetters.length,
    recent_runs: metrics.length,
    latest_decision_at_utc: latest,
  };
}

function controls(decisions, results) {
  return [
    ...results.filter((result) => result.status === "rejected").map((result, index) => ({ code: "AI_CONTEXT_SOURCE_UNAVAILABLE", severity: "warning", label: `Source ${index + 1} indisponible`, detail: message(result.reason) })),
    ...(!decisions.length ? [{ code: "AI_CONTEXT_NO_DECISION", severity: "info", label: "Aucune décision AI Context", detail: "Aucune tâche CONTEXT_DECISION ou AI_CONTEXT n’est visible dans l’agent-runtime réel." }] : []),
    ...decisions.filter((item) => item.fallback_applied).map((item) => ({ code: "AI_CONTEXT_FALLBACK", severity: "warning", label: `Fallback ${item.fallback_reason || "appliqué"}`, detail: `${item.task_type} · ${item.rationale}` })),
  ];
}

function metricRow(item) {
  return {
    metric_id: item.metric_id,
    task_id: item.task_id,
    task_type: item.task_type,
    lane: item.lane,
    worker_id: item.worker_id || null,
    model: item.model || null,
    reasoning_effort: item.reasoning_effort || null,
    outcome: item.outcome,
    total_latency_ms: numberOrNull(item.total_latency_ms),
    total_tokens: numberOrNull(item.total_tokens),
    cost_micros_usd: numberOrNull(item.cost_micros_usd),
    finished_at_utc: item.finished_at_utc || null,
  };
}

function deadLetterRow(item) {
  return {
    dead_letter_id: item.dead_letter_id,
    task_id: item.task_id,
    task_type: item.task_type,
    lane: item.lane,
    status: item.status,
    error_code: item.error_code,
    error_message: item.error_message || null,
    created_at_utc: item.created_at_utc || null,
  };
}

function contextItems(input) {
  return input.filter((item) => contextText(item).includes("CONTEXT_DECISION") || contextText(item).includes("AI_CONTEXT"));
}

function contextText(item) {
  return [
    item.task_type,
    item.task_key,
    item.mission_key,
    item.mission_type,
    item.output_ref && JSON.stringify(item.output_ref),
  ].filter(Boolean).join(" ").toUpperCase();
}

async function callStore(store, method, args) {
  if (typeof store?.[method] !== "function") throw Object.assign(new Error(`${method} unavailable`), { code: "AI_CONTEXT_SOURCE_METHOD_UNAVAILABLE" });
  return store[method](args);
}

function items(result) {
  if (result.status !== "fulfilled") return [];
  return Array.isArray(result.value?.items) ? result.value.items : [];
}

function readState(source, result, count) {
  if (result.status === "fulfilled" && result.value?.optional_missing) return { source, status: "optional_missing", count: 0, error_code: null, error_message: null };
  return result.status === "fulfilled"
    ? { source, status: "ok", count, error_code: null, error_message: null }
    : { source, status: "error", count: 0, error_code: result.reason?.code || "AI_CONTEXT_SOURCE_ERROR", error_message: message(result.reason) };
}

function sourceStatus(results) {
  const errors = results.filter((result) => result.status === "rejected").length;
  if (errors === 0) return "ready";
  return errors === results.length ? "unavailable" : "partial";
}

function outputObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return objectOrNull(value.payload) || objectOrNull(value.result) || value;
  return {};
}

function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function objectOrNull(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
function refText(value) { return typeof value === "string" ? value : value ? JSON.stringify(value).slice(0, 240) : ""; }
function inferredMode(task) { return contextText(task).includes("SHADOW") ? "SHADOW" : "UNKNOWN"; }
function boundedLimit(value, fallback, max) { const parsed = Number(value); return Number.isInteger(parsed) ? Math.max(1, Math.min(max, parsed)) : fallback; }
function nowUtc(store) { return store?.clock?.now?.().utc || AI_CONTEXT_FRONT_CLOCK.now().utc; }
function nullableText(value) { const normalized = text(value); return normalized || null; }
function text(value) { return String(value ?? "").trim(); }
function numberOrNull(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function message(error) { return String(error?.message || error || "unknown error"); }
function array(value) { return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []; }
function safeModelRef(value) {
  const normalized = text(value);
  if (!normalized) return "";
  return normalized.replace(/(sk-|pk_|bearer\s+)[a-z0-9._-]+/ig, "$1REDACTED");
}
