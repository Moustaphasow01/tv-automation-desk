export const TD2_420_VERDICTS = Object.freeze({
  GO_SEMI_MANUAL: "GO — RESEARCH + LIVE SIGNALS + SEMI_MANUAL",
  GO_WITH_EXTERNAL_BLOCKERS: "GO WITH EXTERNAL BLOCKERS — RESEARCH + LIVE SIGNALS + SEMI_MANUAL",
  NO_GO: "NO-GO",
});

const REQUIRED_TABLES = Object.freeze([
  "desk_schema_migrations",
  "desk_service_heartbeats",
  "agent_missions",
  "agent_tasks",
  "datasets",
  "strategy_definitions",
  "strategy_versions",
  "strategy_instances",
  "simulation_runs",
  "research_experiments",
  "research_candidates",
  "research_evaluation_reports",
  "strategy_signal_outbox",
  "portfolio_order_intent_lineage",
  "trade_order_intents",
  "broker_provider_commands",
  "assistant_tasks",
  "assistant_outbox",
]);

const MANDATORY_CHECKS = Object.freeze([
  "safety.auto_execution_off",
  "safety.live_auto_off",
  "safety.zero_broker_side_effect_delta",
  "cold_start.schema_present",
  "cold_start.critical_services_healthy",
  "workers.topology_known",
  "workers.heartbeats_fresh",
  "research.strategy_sample_size",
  "research.pipeline_artifacts",
  "research.gates_audited",
  "data.historical_lineage",
  "strategy.artifact_lineage",
  "live_runtime.scheduler_observed",
  "signal_pipeline.safe_proof",
  "front.vnext_truthful",
  "front.realtime_resume",
  "observability.no_critical_errors",
  "chaos.worker_recovery",
  "chaos.backend_restart_recovery",
  "restart.full_restart_recovered",
]);

const RESEARCH_GATE_IDS = Object.freeze(["G0_DATA_READY", "G1_SCREENED", "G2_CANONICAL_VALID", "G3_ROBUST", "G4_PORTFOLIO_FIT"]);

export function evaluateFullSystemDressRehearsalEvidence(evidence = {}, options = {}) {
  const policy = { minStrategies: positiveInteger(options.minStrategies, 10), maxStrategies: positiveInteger(options.maxStrategies, 20) };
  const strategyIds = unique(rows(at(evidence, "research.strategy_ids")).map(String).filter(Boolean));
  const checks = [
    ...safetyChecks(evidence),
    schemaCheck(evidence),
    servicesCheck(evidence),
    ...workerChecks(evidence),
    ...researchChecks(evidence, strategyIds, policy),
    dataLineageCheck(evidence),
    strategyLineageCheck(evidence),
    liveRuntimeCheck(evidence),
    signalPipelineCheck(evidence),
    ...frontChecks(evidence),
    assistantCheck(evidence),
    observabilityCheck(evidence),
    ...chaosChecks(evidence),
    restartCheck(evidence),
    telegramCheck(evidence),
    sim101Check(evidence),
  ];
  return finalReport({ checks, options: policy });
}

export function buildDressRehearsalEvidenceFromRuntimeSnapshot(snapshot = {}) {
  const services = rows(snapshot.services).map(normalizeService);
  const strategyIds = unique([
    ...rows(at(snapshot, "research.strategy_ids")),
    ...rows(at(snapshot, "research.strategyIds")),
    ...rows(at(snapshot, "research.definitions")).map(strategyIdFromDefinition),
  ].map(String).filter(Boolean));
  return {
    safety: object(snapshot.safety),
    schema: object(snapshot.schema),
    services,
    workers: object(snapshot.workers),
    research: { ...object(snapshot.research), strategy_ids: strategyIds },
    data: object(snapshot.data),
    strategy: object(snapshot.strategy),
    live_runtime: object(snapshot.live_runtime || snapshot.liveRuntime),
    signal_pipeline: object(snapshot.signal_pipeline || snapshot.signalPipeline),
    front: object(snapshot.front),
    assistants: object(snapshot.assistants),
    observability: object(snapshot.observability),
    chaos: object(snapshot.chaos),
    restart: object(snapshot.restart),
    telegram: object(snapshot.telegram),
    sim101: object(snapshot.sim101),
  };
}

function safetyChecks(evidence) {
  const safety = object(evidence.safety);
  return [
    check("safety.auto_execution_off", safety.auto_execution_enabled === false, { auto_execution_enabled: value(safety.auto_execution_enabled) }),
    check("safety.live_auto_off", safety.live_auto_enabled === false, { live_auto_enabled: value(safety.live_auto_enabled) }),
    check("safety.zero_broker_side_effect_delta", safety.broker_provider_side_effect_delta === 0, {
      broker_provider_side_effect_delta: value(safety.broker_provider_side_effect_delta),
      before: safety.side_effect_counts_before || null,
      after: safety.side_effect_counts_after || null,
    }),
  ];
}

function schemaCheck(evidence) {
  const present = rows(at(evidence, "schema.present_tables"));
  const missing = REQUIRED_TABLES.filter((table) => !present.includes(table));
  return check("cold_start.schema_present", missing.length === 0, { required_tables: REQUIRED_TABLES, missing_tables: missing });
}

function servicesCheck(evidence) {
  const critical = rows(evidence.services).filter((item) => item.critical !== false);
  const unhealthy = critical.filter((item) => !["healthy", "degraded"].includes(lower(item.status)));
  return check("cold_start.critical_services_healthy", critical.length > 0 && unhealthy.length === 0, { critical_services: critical.length, unhealthy_services: unhealthy.map(serviceSummary) });
}

function workerChecks(evidence) {
  const workers = object(evidence.workers);
  const stale = rows(workers.heartbeats).filter((item) => item.stale === true || number(item.heartbeat_age_seconds) > number(workers.max_heartbeat_age_seconds, 180));
  return [
    check("workers.topology_known", integer(workers.expected_research_workers) > 0 && integer(workers.expected_research_workers) === integer(workers.active_research_workers), {
      expected_research_workers: integer(workers.expected_research_workers),
      active_research_workers: integer(workers.active_research_workers),
      active_simulation_workers: integer(workers.active_simulation_workers),
      queue_depth: integer(workers.queue_depth),
    }),
    check("workers.heartbeats_fresh", rows(workers.heartbeats).length > 0 && stale.length === 0, { heartbeats: rows(workers.heartbeats).length, stale_workers: stale.map(serviceSummary), max_heartbeat_age_seconds: number(workers.max_heartbeat_age_seconds, 180) }),
  ];
}

function researchChecks(evidence, strategyIds, policy) {
  const research = object(evidence.research);
  const missingGates = RESEARCH_GATE_IDS.filter((gate) => integer(at(research, `gates.${gate}`)) <= 0);
  return [
    check("research.strategy_sample_size", strategyIds.length >= policy.minStrategies && strategyIds.length <= policy.maxStrategies, { strategy_count: strategyIds.length, min_required: policy.minStrategies, max_allowed: policy.maxStrategies, strategy_ids: strategyIds }),
    check("research.pipeline_artifacts", researchArtifactsPresent(research, strategyIds.length), { missions: integer(research.missions), tasks: integer(research.tasks), datasets: integer(research.datasets), simulation_runs: integer(research.simulation_runs), evaluation_reports: integer(research.evaluation_reports) }),
    check("research.gates_audited", missingGates.length === 0, { required_gates: RESEARCH_GATE_IDS, missing_gates: missingGates, gates: object(research.gates) }),
  ];
}

function dataLineageCheck(evidence) {
  const data = object(evidence.data);
  return check("data.historical_lineage", integer(data.ready_datasets) > 0 && integer(data.lineage_complete_datasets) === integer(data.ready_datasets) && data.no_lookahead_declared === true && data.synthetic_data_declared === true, {
    ready_datasets: integer(data.ready_datasets),
    lineage_complete_datasets: integer(data.lineage_complete_datasets),
    no_lookahead_declared: value(data.no_lookahead_declared),
    synthetic_data_declared: value(data.synthetic_data_declared),
  });
}

function strategyLineageCheck(evidence) {
  const strategy = object(evidence.strategy);
  return check("strategy.artifact_lineage", integer(strategy.immutable_versions) > 0 && integer(strategy.compiled_artifacts) >= integer(strategy.immutable_versions) && integer(strategy.shadow_instances) > 0, { immutable_versions: integer(strategy.immutable_versions), compiled_artifacts: integer(strategy.compiled_artifacts), shadow_instances: integer(strategy.shadow_instances) });
}

function liveRuntimeCheck(evidence) {
  const live = object(evidence.live_runtime);
  return check("live_runtime.scheduler_observed", integer(live.instances_evaluated) > 0 && live.last_evaluation_progressed === true && ["fresh", "closed_market_expected"].includes(lower(live.feed_state)), { instances_evaluated: integer(live.instances_evaluated), last_evaluation_progressed: value(live.last_evaluation_progressed), feed_state: live.feed_state || null });
}

function signalPipelineCheck(evidence) {
  const signal = object(evidence.signal_pipeline);
  const noSignalSafe = signal.no_signal_observed === true && signal.no_signal_is_valid === true;
  const chainSafe = signal.signal_to_order_intent_proven === true && signal.portfolio_risk_lineage_proven === true && signal.human_gate_required === true && signal.broker_auto_send === false;
  return check("signal_pipeline.safe_proof", noSignalSafe || chainSafe, { no_signal_observed: value(signal.no_signal_observed), signal_to_order_intent_proven: value(signal.signal_to_order_intent_proven), portfolio_risk_lineage_proven: value(signal.portfolio_risk_lineage_proven), human_gate_required: value(signal.human_gate_required), broker_auto_send: value(signal.broker_auto_send) });
}

function frontChecks(evidence) {
  const front = object(evidence.front);
  return [
    check("front.vnext_truthful", front.vnext_available === true && front.bff_single_source === true && front.no_front_risk_recalc === true && front.degraded_states_visible === true, { vnext_available: value(front.vnext_available), bff_single_source: value(front.bff_single_source), no_front_risk_recalc: value(front.no_front_risk_recalc), degraded_states_visible: value(front.degraded_states_visible) }),
    check("front.realtime_resume", front.sse_connected === true && front.cursor_resume_proven === true && front.browser_reopen_truth_preserved === true, { sse_connected: value(front.sse_connected), cursor_resume_proven: value(front.cursor_resume_proven), browser_reopen_truth_preserved: value(front.browser_reopen_truth_preserved) }),
  ];
}

function assistantCheck(evidence) {
  const assistants = object(evidence.assistants);
  if (assistants.available !== true) return blocked("assistants.read_only_truthful", { available: value(assistants.available), reason: "TD2-419 runtime assistant worker/realtime proof not available in this rehearsal." });
  return check("assistants.read_only_truthful", assistants.read_only === true && assistants.answer_grounded === true && assistants.no_sensitive_authority === true, { available: true, read_only: value(assistants.read_only), answer_grounded: value(assistants.answer_grounded), no_sensitive_authority: value(assistants.no_sensitive_authority), reason: null }, false);
}

function observabilityCheck(evidence) {
  const observability = object(evidence.observability);
  const present = Object.prototype.hasOwnProperty.call(observability, "critical_errors") && Object.prototype.hasOwnProperty.call(observability, "unexplained_errors");
  return check("observability.no_critical_errors", present && integer(observability.critical_errors) === 0 && integer(observability.unexplained_errors) === 0, { critical_errors: integer(observability.critical_errors), unexplained_errors: integer(observability.unexplained_errors), warnings: integer(observability.warnings), evidence_present: present });
}

function chaosChecks(evidence) {
  const chaos = object(evidence.chaos);
  return [
    check("chaos.worker_recovery", chaos.worker_kill_recovered === true && chaos.no_duplicate_result_after_recovery === true, { worker_kill_recovered: value(chaos.worker_kill_recovered), no_duplicate_result_after_recovery: value(chaos.no_duplicate_result_after_recovery) }),
    check("chaos.backend_restart_recovery", chaos.backend_restart_recovered === true && chaos.tasks_persisted_after_restart === true, { backend_restart_recovered: value(chaos.backend_restart_recovered), tasks_persisted_after_restart: value(chaos.tasks_persisted_after_restart) }),
    check("chaos.sse_resume", chaos.sse_resume_recovered === true, { sse_resume_recovered: value(chaos.sse_resume_recovered) }, false),
    check("chaos.feed_stale_fail_closed", chaos.feed_stale_fail_closed === true, { feed_stale_fail_closed: value(chaos.feed_stale_fail_closed) }, false),
  ];
}

function restartCheck(evidence) {
  const restart = object(evidence.restart);
  return check("restart.full_restart_recovered", restart.full_restart_recovered === true && restart.auto_execution_enabled === false && restart.live_auto_enabled === false, { full_restart_recovered: value(restart.full_restart_recovered), auto_execution_enabled: value(restart.auto_execution_enabled), live_auto_enabled: value(restart.live_auto_enabled) });
}

function telegramCheck(evidence) {
  const telegram = object(evidence.telegram);
  if (telegram.available !== true) return blocked("telegram.notification_operator_safe", { available: value(telegram.available), reason: "Telegram unavailable/not authorized for this rehearsal." });
  return check("telegram.notification_operator_safe", telegram.operator_notification_sent === true && telegram.not_a_broker_order === true, { available: true, operator_notification_sent: value(telegram.operator_notification_sent), not_a_broker_order: value(telegram.not_a_broker_order), reason: null }, false);
}

function sim101Check(evidence) {
  const sim101 = object(evidence.sim101);
  if (sim101.available !== true) return blocked("sim101.paper_smoke", { available: value(sim101.available), reason: "Sim101/PAPER provider unavailable or not explicitly armed." });
  return check("sim101.paper_smoke", sim101.paper_smoke_passed === true && sim101.live_account_forbidden === true, { available: true, paper_smoke_passed: value(sim101.paper_smoke_passed), live_account_forbidden: value(sim101.live_account_forbidden), reason: null }, false);
}

function finalReport({ checks, options }) {
  const mandatoryFailures = checks.filter((item) => item.required && !item.ok);
  const optionalExternalBlockers = checks.filter((item) => !item.required && item.status === "BLOCKED_EXTERNAL");
  const verdict = verdictFor(mandatoryFailures, optionalExternalBlockers);
  return {
    schema: "td2_420_full_system_dress_rehearsal_v1",
    ok: verdict !== TD2_420_VERDICTS.NO_GO,
    verdict,
    checks,
    summary: reportSummary(checks, mandatoryFailures, optionalExternalBlockers),
    blockers: mandatoryFailures.map(blockerSummary),
    external_blockers: optionalExternalBlockers.map(externalBlockerSummary),
    policy: { auto_execution_required: "OFF", live_auto_required: "OFF", broker_provider_side_effect_expected: "ZERO", mandatory_checks: MANDATORY_CHECKS, strategy_sample_size: { min: options.minStrategies, max: options.maxStrategies } },
  };
}

function check(id, passed, detail = {}, required = true) { const status = passed ? "PASS" : "FAIL"; return { id, status, required, ok: status === "PASS", detail: clean(detail) }; }
function blocked(id, detail = {}) { return { id, status: "BLOCKED_EXTERNAL", required: false, ok: true, detail: clean(detail) }; }
function verdictFor(mandatoryFailures, externalBlockers) { if (mandatoryFailures.length > 0) return TD2_420_VERDICTS.NO_GO; if (externalBlockers.length > 0) return TD2_420_VERDICTS.GO_WITH_EXTERNAL_BLOCKERS; return TD2_420_VERDICTS.GO_SEMI_MANUAL; }
function reportSummary(checks, mandatoryFailures, externalBlockers) { return { total: checks.length, pass: checks.filter(statusIs("PASS")).length, fail: checks.filter(statusIs("FAIL")).length, not_proven: checks.filter(statusIs("NOT_PROVEN")).length, blocked_external: checks.filter(statusIs("BLOCKED_EXTERNAL")).length, mandatory_failures: mandatoryFailures.length, optional_external_blockers: externalBlockers.length }; }
function researchArtifactsPresent(research, strategyCount) { return integer(research.missions) >= strategyCount && integer(research.tasks) >= strategyCount && integer(research.datasets) > 0 && integer(research.simulation_runs) >= strategyCount && integer(research.evaluation_reports) >= strategyCount; }
function normalizeService(item) { return { service_id: item.service_id || item.serviceId, service_kind: item.service_kind || item.serviceKind, status: item.status, critical: value(item.critical, true), heartbeat_age_seconds: item.heartbeat_age_seconds }; }
function strategyIdFromDefinition(item) { return item.external_key || item.strategy_id; }
function serviceSummary(item) { return { service_id: item.service_id || item.serviceId || item.worker_id || item.workerId || "unknown", service_kind: item.service_kind || item.serviceKind || item.kind || null, status: item.status || null, heartbeat_age_seconds: number(item.heartbeat_age_seconds) }; }
function blockerSummary(item) { return { id: item.id, status: item.status, detail: item.detail }; }
function externalBlockerSummary(item) { return { id: item.id, detail: item.detail }; }
function statusIs(status) { return (item) => item.status === status; }
function rows(source) { if (Array.isArray(source)) return source; if (Array.isArray(source && source.items)) return source.items; return []; }
function object(source) { if (source && typeof source === "object" && !Array.isArray(source)) return source; return {}; }
function unique(values) { return [...new Set(values)]; }
function lower(value) { return String(value || "").toLowerCase(); }
function integer(input, fallback = 0) { const parsed = Number.parseInt(input, 10); return Number.isFinite(parsed) ? parsed : fallback; }
function positiveInteger(input, fallback) { const parsed = integer(input, fallback); return parsed > 0 ? parsed : fallback; }
function number(input, fallback = 0) { const parsed = Number(input); return Number.isFinite(parsed) ? parsed : fallback; }
function value(input, fallback = null) { return input === undefined ? fallback : input; }
function at(source, path, fallback = undefined) { let current = source; for (const key of String(path).split(".")) { if (!current || typeof current !== "object" || !(key in current)) return fallback; current = current[key]; } return current; }
function clean(source) { return JSON.parse(JSON.stringify(source, (_key, item) => item === undefined ? null : item)); }
