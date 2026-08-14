import { canonicalSha256 } from "./execution-scope.js";

export const RUNTIME_COMPARISON_SCHEMA_VERSION_V1 = "runtime_comparison_v1";
export const STRATEGY_INSTANCE_CUTOVER_SCHEMA_VERSION_V1 = "strategy_instance_cutover_plan_v1";
export const LIVE_ACTIVATION_AUTHORIZATION_SCHEMA_VERSION_V1 = "live_activation_authorization_v1";
export const GPT_FIRST_RETIREMENT_SCHEMA_VERSION_V1 = "gpt_first_retirement_plan_v1";
export const ARCHITECTURE_CLOSURE_AUDIT_SCHEMA_VERSION_V1 = "architecture_closure_audit_v1";

export function evaluateRuntimeComparisonV1(input = {}) {
  const windows = normalizeWindows(input);
  const thresholds = comparisonThresholds(input.thresholds);
  const metrics = metricDiffs(record(input.legacy_runtime), record(input.target_runtime));
  const issues = [
    ...requireIssue(windows.same_scope, "RUNTIME_SCOPE_MISMATCH"),
    ...requireIssue(Math.abs(metrics.net_r_delta) <= thresholds.max_net_r_delta, "NET_R_DELTA_TOO_HIGH"),
    ...requireIssue(Math.abs(metrics.trade_count_delta) <= thresholds.max_trade_count_delta, "TRADE_COUNT_DELTA_TOO_HIGH"),
    ...requireIssue(metrics.target_error_rate <= thresholds.max_error_rate, "TARGET_RUNTIME_ERROR_RATE_TOO_HIGH"),
    ...requireIssue(text(input.shadow_cutover_status || input.shadow_cutover?.status) === "CUTOVER_READY", "SHADOW_CUTOVER_NOT_READY"),
  ];
  const report = {
    schema_version: RUNTIME_COMPARISON_SCHEMA_VERSION_V1,
    evaluated_at_utc: evaluatedAt(input),
    status: issues.length ? "COMPARISON_BLOCKED" : "COMPARISON_PASS",
    windows,
    thresholds,
    metrics,
    issues,
  };
  return { ...report, comparison_hash: hash(report) };
}

export function planStrategyInstanceCutoverV1(input = {}) {
  const context = strategyCutoverContext(input);
  const issues = strategyCutoverIssues(input, context);
  const plan = {
    schema_version: STRATEGY_INSTANCE_CUTOVER_SCHEMA_VERSION_V1,
    evaluated_at_utc: evaluatedAt(input),
    strategy_instance_id: context.strategy_instance_id || null,
    current_stage: context.current_stage,
    target_stage: context.effective_target_stage,
    status: strategyCutoverStatus(context, issues),
    scope_lock_key: context.strategy_instance_id ? `strategy_instance:${context.strategy_instance_id}` : null,
    feature_flags: strategyCutoverFlags(context),
    issues,
  };
  return { ...plan, cutover_plan_hash: hash(plan) };
}

export function authorizeLiveActivationV1(input = {}) {
  const context = liveActivationContext(input);
  const issues = liveActivationIssues(context);
  const authorization = {
    schema_version: LIVE_ACTIVATION_AUTHORIZATION_SCHEMA_VERSION_V1,
    evaluated_at_utc: evaluatedAt(input),
    status: issues.length ? "LIVE_BLOCKED" : "LIVE_AUTHORIZED",
    strategy_instance_id: context.strategy_instance_id || null,
    provider_id: context.provider_id || null,
    account_id: context.account_id || null,
    risk_per_trade_pct: context.risk_per_trade_pct,
    issues,
  };
  return { ...authorization, authorization_hash: hash(authorization) };
}

export function planGptFirstLegacyRetirementV1(input = {}) {
  const policy = { minimum_observation_days: number(input.policy?.minimum_observation_days ?? 5) };
  const bypass = legacyBypassCounts(input);
  const issues = [
    ...requireIssue(number(input.observation_days) >= policy.minimum_observation_days, "OBSERVATION_WINDOW_INSUFFICIENT"),
    ...requireIssue(number(input.active_legacy_workflow_count) === 0, "ACTIVE_LEGACY_WORKFLOWS_REMAIN"),
    ...requireIssue(bypass.llm_direct_order_path_count === 0, "LLM_DIRECT_ORDER_PATHS_REMAIN"),
    ...requireIssue(bypass.mcp_direct_order_path_count === 0, "MCP_DIRECT_ORDER_PATHS_REMAIN"),
    ...requireIssue(bypass.front_direct_order_path_count === 0, "FRONT_DIRECT_ORDER_PATHS_REMAIN"),
    ...requireIssue(bypass.script_direct_order_path_count === 0, "SCRIPT_DIRECT_ORDER_PATHS_REMAIN"),
    ...requireIssue(number(input.replacement_coverage_pct) >= 1, "REPLACEMENT_COVERAGE_INCOMPLETE"),
    ...requireIssue(record(input.rollback_plan)?.proven === true, "LEGACY_ROLLBACK_PLAN_REQUIRED"),
    ...requireIssue(record(input.operator_approval)?.decision === "APPROVE_GPT_FIRST_RETIREMENT", "OPERATOR_LEGACY_RETIREMENT_APPROVAL_REQUIRED"),
  ];
  const plan = {
    schema_version: GPT_FIRST_RETIREMENT_SCHEMA_VERSION_V1,
    evaluated_at_utc: evaluatedAt(input),
    status: issues.length ? "LEGACY_RETIREMENT_BLOCKED" : "LEGACY_RETIREMENT_READY",
    policy,
    bypass,
    issues,
  };
  return { ...plan, retirement_hash: hash(plan) };
}

function legacyBypassCounts(input) {
  const bypass = record(input.bypass_counts);
  return {
    llm_direct_order_path_count: number(input.llm_direct_order_path_count ?? bypass.llm_direct_order_path_count),
    mcp_direct_order_path_count: number(input.mcp_direct_order_path_count ?? bypass.mcp_direct_order_path_count),
    front_direct_order_path_count: number(input.front_direct_order_path_count ?? bypass.front_direct_order_path_count),
    script_direct_order_path_count: number(input.script_direct_order_path_count ?? bypass.script_direct_order_path_count),
  };
}

export function auditArchitectureProgramClosureV1(input = {}) {
  const guard_results = array(input.guard_results).map(normalizeGuardResult);
  const excluded_tickets = array(input.excluded_tickets).map(text).filter(Boolean);
  const blocking = [
    ...guard_results.filter((guard) => !guard.ok).map((guard) => ({ code: "GUARD_FAILED", guard: guard.name })),
    ...requireIssue(number(input.active_exception_count) === 0, "ACTIVE_ARCHITECTURE_EXCEPTIONS_REMAIN"),
    ...array(input.open_tickets).filter((ticket) => !excluded_tickets.includes(text(ticket))).map((ticket) => ({ code: "OPEN_PROGRAM_TICKET", ticket: text(ticket) })),
    ...excluded_tickets.map((ticket) => ({ code: "EXCLUDED_SCOPE_REMAINS", ticket })),
  ];
  const audit = {
    schema_version: ARCHITECTURE_CLOSURE_AUDIT_SCHEMA_VERSION_V1,
    evaluated_at_utc: evaluatedAt(input),
    status: blocking.length ? "CLOSURE_BLOCKED" : "CLOSURE_READY",
    guard_results,
    active_exception_count: number(input.active_exception_count),
    excluded_tickets,
    blocking,
  };
  return { ...audit, closure_hash: hash(audit) };
}

function normalizeWindows(input) {
  const legacy = record(input.legacy_runtime)?.window || record(input.legacy_window) || {};
  const target = record(input.target_runtime)?.window || record(input.target_window) || {};
  return {
    legacy,
    target,
    same_scope: text(legacy.from) === text(target.from) && text(legacy.to) === text(target.to) && text(legacy.dataset_id) === text(target.dataset_id),
  };
}

function metricDiffs(legacy = {}, target = {}) {
  return {
    legacy_net_r: number(legacy.net_r),
    target_net_r: number(target.net_r),
    net_r_delta: round(number(target.net_r) - number(legacy.net_r)),
    legacy_trade_count: number(legacy.trade_count),
    target_trade_count: number(target.trade_count),
    trade_count_delta: number(target.trade_count) - number(legacy.trade_count),
    target_error_rate: number(target.error_rate),
    latency_ms_delta: round(number(target.latency_ms) - number(legacy.latency_ms)),
  };
}

function comparisonThresholds(input = {}) {
  return {
    max_net_r_delta: number(input.max_net_r_delta ?? 0.25),
    max_trade_count_delta: number(input.max_trade_count_delta ?? 1),
    max_error_rate: number(input.max_error_rate ?? 0.01),
  };
}

function hasDoubleSendRisk(input) {
  return array(input.active_provider_commands).length > 0 || array(input.double_send_issues).length > 0 || String(input.circuit_breaker_route?.status || "").includes("DOUBLE_SEND");
}

function strategyCutoverContext(input) {
  const current_stage = upper(input.current_stage || input.instance?.execution_mode || "SHADOW");
  const target_stage = upper(input.target_stage || nextStage(current_stage));
  const rollback_requested = input.rollback_requested === true;
  return {
    strategy_instance_id: text(input.strategy_instance_id || input.instance?.strategy_instance_id),
    current_stage,
    target_stage,
    effective_target_stage: rollback_requested ? previousStage(current_stage) : target_stage,
    rollback_requested,
    comparison_status: text(input.runtime_comparison?.status),
    live_authorization_status: text(input.live_authorization?.status),
  };
}

function strategyCutoverIssues(input, context) {
  return [
    ...requireIssue(Boolean(context.strategy_instance_id), "STRATEGY_INSTANCE_ID_REQUIRED"),
    ...requireIssue(context.comparison_status === "COMPARISON_PASS" || context.rollback_requested, "RUNTIME_COMPARISON_REQUIRED"),
    ...requireIssue(context.target_stage !== "LIVE" || context.live_authorization_status === "LIVE_AUTHORIZED", "LIVE_AUTHORIZATION_REQUIRED"),
    ...requireIssue(!hasDoubleSendRisk(input), "DOUBLE_SEND_RISK_BLOCKS_CUTOVER"),
  ];
}

function strategyCutoverStatus(context, issues) {
  if (context.rollback_requested) return "ROLLBACK_READY";
  return issues.length ? "CUTOVER_BLOCKED" : "CUTOVER_READY";
}

function strategyCutoverFlags(context) {
  return {
    legacy_runtime_enabled: context.rollback_requested || context.target_stage === "SHADOW",
    target_runtime_enabled: !context.rollback_requested && ["PAPER", "LIVE"].includes(context.target_stage),
    live_submit_enabled: !context.rollback_requested && context.target_stage === "LIVE" && context.live_authorization_status === "LIVE_AUTHORIZED",
  };
}

function liveActivationContext(input) {
  const approval = record(input.operator_approval);
  const risk = record(input.risk);
  return {
    approval,
    strategy_instance_id: text(input.strategy_instance_id),
    provider_id: text(input.provider_id),
    account_id: text(input.account_ref?.account_id || input.account_id),
    risk_per_trade_pct: number(risk.risk_per_trade_pct),
    max_risk_per_trade_pct: number(input.policy?.max_risk_per_trade_pct ?? 0.25),
    now: input.now,
  };
}

function liveActivationIssues(context) {
  return [
    ...requireIssue(context.approval.approved === true && context.approval.decision === "APPROVE_LIVE", "EXPLICIT_LIVE_APPROVAL_REQUIRED"),
    ...requireIssue(text(context.approval.strategy_instance_id) === context.strategy_instance_id, "APPROVAL_INSTANCE_SCOPE_MISMATCH"),
    ...requireIssue(Boolean(context.account_id), "LIVE_ACCOUNT_REQUIRED"),
    ...requireIssue(Boolean(context.provider_id), "LIVE_PROVIDER_REQUIRED"),
    ...requireIssue(riskInsidePolicy(context), "LIVE_RISK_OUT_OF_POLICY"),
    ...requireIssue(!isExpired(context.approval.expires_at_utc, context.now), "LIVE_APPROVAL_EXPIRED"),
  ];
}

function riskInsidePolicy(context) {
  return context.risk_per_trade_pct > 0 && context.risk_per_trade_pct <= context.max_risk_per_trade_pct;
}

function nextStage(stage) { return stage === "SHADOW" ? "PAPER" : stage === "PAPER" ? "LIVE" : stage; }
function previousStage(stage) { return stage === "LIVE" ? "PAPER" : "SHADOW"; }
function normalizeGuardResult(guard) { return { name: text(guard.name || guard.script), ok: guard.ok === true }; }
function isExpired(value, now) { const expires = Date.parse(value || ""); const asOf = Date.parse(now || ""); return !Number.isFinite(expires) || !Number.isFinite(asOf) || expires <= asOf; }
function requireIssue(ok, code) { return ok ? [] : [{ code }]; }
function evaluatedAt(input) { return iso(input.evaluated_at_utc || input.now) || null; }
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function round(value) { return Math.round(Number(value || 0) * 10000) / 10000; }
function iso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function hash(value) { return `sha256:${canonicalSha256(value)}`; }
