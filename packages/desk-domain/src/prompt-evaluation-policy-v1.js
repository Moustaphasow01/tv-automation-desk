import { canonicalSha256 } from "./execution-scope.js";

export const PROMPT_EVALUATION_POLICY_VERSION_V1 = "1.0.0";
export const PROMPT_EVALUATION_REPORT_SCHEMA_VERSION_V1 = "prompt_evaluation_report_v1";
export const PROMPT_EVALUATION_STATUSES_V1 = Object.freeze(["PASS", "FAIL", "REVIEW"]);

export function evaluatePromptCandidateV1(input = {}) {
  const thresholds = normalizeThresholds(input.thresholds);
  const checks = [
    identityCheck(input),
    securityCheck(input.security_scan),
    contractCheck(input.contract_validation),
    regressionCheck(input.regression, thresholds),
    qualityCheck(input.metrics, thresholds),
    latencyCheck(input.metrics, thresholds),
    costCheck(input.metrics, thresholds),
    tokenCheck(input.metrics, thresholds),
  ];
  const status = aggregateStatus(checks);
  const evaluation = buildEvaluationRecord(input, checks, status, thresholds);
  return {
    ok: status === "PASS",
    status,
    reasons: checks.filter((check) => check.status !== "PASS").map((check) => check.reason),
    evaluation,
  };
}

export function buildPromptEvaluationRecordV1(input = {}) {
  return evaluatePromptCandidateV1(input).evaluation;
}

function identityCheck(input) {
  if (!text(input.prompt_composition_id)) return fail("PROMPT_COMPOSITION_REQUIRED");
  if (!hash(input.rendered_sha256)) return fail("RENDERED_HASH_REQUIRED");
  if (!text(input.dataset_id) && input.require_dataset !== false) return fail("EVALUATION_DATASET_REQUIRED");
  return pass("identity");
}

function securityCheck(scan = {}) {
  if (status(scan.status) !== "PASS") return fail("SECURITY_EVALUATION_REQUIRED");
  const findings = Array.isArray(scan.findings) ? scan.findings : [];
  if (findings.some((finding) => severity(finding.severity) === "CRITICAL")) return fail("PROMPT_SECURITY_CRITICAL_FINDING");
  if (findings.some((finding) => severity(finding.severity) === "HIGH")) return review("PROMPT_SECURITY_HIGH_FINDING");
  return pass("security");
}

function contractCheck(validation = {}) {
  if (status(validation.status) !== "PASS") return fail("CONTRACT_EVALUATION_REQUIRED");
  const violations = Array.isArray(validation.violations) ? validation.violations : [];
  if (violations.length) return fail("PROMPT_CONTRACT_VIOLATION");
  return pass("contract");
}

function regressionCheck(regression = {}, thresholds = {}) {
  if (status(regression.status) !== "PASS") return fail("REGRESSION_EVALUATION_REQUIRED");
  const delta = numeric(regression.quality_score_delta);
  if (delta === null) return fail("REGRESSION_DELTA_REQUIRED");
  if (delta < -thresholds.max_quality_drop) return fail("PROMPT_REGRESSION_TOO_LARGE");
  return pass("regression");
}

function qualityCheck(metrics = {}, thresholds = {}) {
  const score = numeric(metrics.quality_score);
  if (score === null) return fail("QUALITY_SCORE_REQUIRED");
  if (score < thresholds.min_quality_score) return fail("QUALITY_SCORE_BELOW_THRESHOLD");
  return pass("quality");
}

function latencyCheck(metrics = {}, thresholds = {}) {
  const latency = numeric(metrics.latency_ms);
  if (latency === null) return fail("LATENCY_REQUIRED");
  if (latency > thresholds.max_latency_ms) return review("LATENCY_ABOVE_BUDGET");
  return pass("latency");
}

function costCheck(metrics = {}, thresholds = {}) {
  const cost = numeric(metrics.cost_usd);
  if (cost === null) return fail("COST_REQUIRED");
  if (cost > thresholds.max_cost_usd) return review("COST_ABOVE_BUDGET");
  return pass("cost");
}

function tokenCheck(metrics = {}, thresholds = {}) {
  const inputTokens = numeric(metrics.input_token_count);
  const outputTokens = numeric(metrics.output_token_count);
  if (inputTokens === null || outputTokens === null) return fail("TOKEN_COUNTS_REQUIRED");
  if (inputTokens + outputTokens > thresholds.max_total_tokens) return review("TOKEN_BUDGET_EXCEEDED");
  return pass("tokens");
}

function buildEvaluationRecord(input, checks, statusValue, thresholds) {
  const report = {
    schema_version: PROMPT_EVALUATION_REPORT_SCHEMA_VERSION_V1,
    policy_version: PROMPT_EVALUATION_POLICY_VERSION_V1,
    status: statusValue,
    checks,
    thresholds,
    generated_at_utc: text(input.generated_at_utc),
  };
  return {
    prompt_composition_id: text(input.prompt_composition_id),
    dataset_id: text(input.dataset_id),
    evaluation_status: statusValue,
    quality_score: numeric(input.metrics?.quality_score),
    security_status: statusFromChecks(checks, "security"),
    regression_status: statusFromChecks(checks, "regression"),
    input_token_count: numeric(input.metrics?.input_token_count),
    output_token_count: numeric(input.metrics?.output_token_count),
    latency_ms: numeric(input.metrics?.latency_ms),
    cost_usd: numeric(input.metrics?.cost_usd),
    report_hash: `sha256:${canonicalSha256(report)}`,
    report,
  };
}

function aggregateStatus(checks) {
  if (checks.some((check) => check.status === "FAIL")) return "FAIL";
  if (checks.some((check) => check.status === "REVIEW")) return "REVIEW";
  return "PASS";
}

function statusFromChecks(checks, group) {
  return checks.find((check) => check.group === group)?.status || "FAIL";
}

function normalizeThresholds(value = {}) {
  return {
    min_quality_score: numeric(value.min_quality_score) ?? 0.8,
    max_quality_drop: numeric(value.max_quality_drop) ?? 0.03,
    max_latency_ms: numeric(value.max_latency_ms) ?? 120000,
    max_cost_usd: numeric(value.max_cost_usd) ?? 1,
    max_total_tokens: numeric(value.max_total_tokens) ?? 120000,
  };
}

function pass(group) {
  return { group, status: "PASS", reason: null };
}

function fail(reason) {
  return { group: groupFromReason(reason), status: "FAIL", reason };
}

function review(reason) {
  return { group: groupFromReason(reason), status: "REVIEW", reason };
}

function groupFromReason(reason) {
  if (reason.includes("SECURITY")) return "security";
  if (reason.includes("CONTRACT")) return "contract";
  if (reason.includes("REGRESSION")) return "regression";
  if (reason.includes("QUALITY")) return "quality";
  if (reason.includes("LATENCY")) return "latency";
  if (reason.includes("COST")) return "cost";
  if (reason.includes("TOKEN")) return "tokens";
  return "identity";
}

function status(value) {
  return String(value || "").toUpperCase();
}

function severity(value) {
  return String(value || "").toUpperCase();
}

function hash(value) {
  return /^sha256:[a-f0-9]{64}$/.test(text(value) || "");
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
