import { canonicalSha256 } from "@tv-automation/desk-domain";

export const ROBUSTNESS_REPORT_SCHEMA_VERSION_V1 = "strategy_robustness_report_v1";
export const ROBUSTNESS_REPORT_ARTIFACT_SCHEMA_VERSION_V1 = "strategy_robustness_artifact_v1";
export const ROBUSTNESS_ENGINE_VERSION_V1 = "1.0.0";
export const ROBUSTNESS_POLICY_ID_V1 = "desk_robustness_policy_core_v1";
export const ROBUSTNESS_POLICY_VERSION_V1 = "1.0.0";

export const DEFAULT_ROBUSTNESS_POLICY_V1 = Object.freeze({
  policy_id: ROBUSTNESS_POLICY_ID_V1,
  policy_version: ROBUSTNESS_POLICY_VERSION_V1,
  min_total_r: 0,
  min_profit_factor: 1,
  max_drawdown_floor_r: -5,
  min_walk_forward_pass_rate: 0.6,
  min_parameter_pass_rate: 0.6,
  min_cost_stress_pass_rate: 0.6,
  max_cost_stress_degradation_r: 2,
  min_bootstrap_p05_total_r: 0,
  max_bootstrap_loss_probability: 0.35,
  min_monte_carlo_p05_total_r: 0,
  max_monte_carlo_drawdown_p95_abs_r: 8,
  bootstrap_sample_count: 64,
  monte_carlo_sample_count: 64,
  sample_seed: "desk-robustness-v1",
});

export function buildRobustnessReportV1(input = {}) {
  const policy = normalizePolicy(input.policy);
  const baseline = summarizeSimulationResultV1(input.baseline_result);
  const generated = generateSamples(input, baseline, policy);
  const tests = {
    baseline_acceptance: evaluateBaselineAcceptance(baseline, policy),
    walk_forward: evaluateResultPassRate("walk_forward", resultItems(input.walk_forward_results || input.candidate_results), policy, policy.min_walk_forward_pass_rate),
    bootstrap: evaluateBootstrap(generated.bootstrap_samples, policy),
    monte_carlo: evaluateMonteCarlo(generated.monte_carlo_samples, policy),
    cost_slippage_stress: evaluateCostStress(resultItems(input.stress_results || input.cost_stress_results), baseline, policy),
    parameter_perturbation: evaluateResultPassRate("parameter_perturbation", resultItems(input.parameter_perturbation_results || input.parameter_results), policy, policy.min_parameter_pass_rate),
  };
  const gate = evaluateRobustnessGateV1({ baseline, tests, policy });
  return sealReport({
    schema_version: ROBUSTNESS_REPORT_SCHEMA_VERSION_V1,
    robustness_engine_version: ROBUSTNESS_ENGINE_VERSION_V1,
    strategy_version_id: text(input.strategy_version_id || baseline.strategy_version_id),
    candidate_strategy_version_ids: candidateStrategyVersionIds(input, baseline),
    checked_at_utc: text(input.checked_at_utc),
    policy_snapshot: policy,
    policy_hash: `sha256:${canonicalSha256(policy)}`,
    baseline,
    tests,
    gate,
    observability: observability(input, generated),
  });
}

export function evaluateRobustnessGateV1(input = {}) {
  const policy = normalizePolicy(input.policy);
  const tests = objectOrEmpty(input.tests);
  const blocking = gateBlockingReasons(input.baseline, tests, policy);
  const review = gateReviewReasons(tests);
  const status = blocking.length ? "FAIL" : review.length ? "REVIEW" : "PASS";
  return {
    status,
    promotion_allowed: status === "PASS",
    reasons: [...blocking, ...review],
    policy_id: policy.policy_id,
    policy_version: policy.policy_version,
  };
}

export function summarizeSimulationResultV1(result = {}) {
  const metrics = objectOrEmpty(result.metrics);
  const positions = Array.isArray(result.positions) ? result.positions : [];
  const rSeries = rSeriesFromResult(result);
  return {
    run_id: text(result.run_id || result.source_run_id || result.simulation_run_id),
    simulation_run_id: text(result.simulation_run_id),
    strategy_version_id: text(result.strategy_version_id),
    dataset_id: text(result.dataset_id),
    status: text(result.status) || "UNKNOWN",
    result_hash: text(result.content_hash || result.result_hash),
    metrics_hash: text(result.metrics_hash),
    dataset_hash: text(result.dataset_hash),
    parameters_hash: text(result.parameters_hash),
    trade_count: number(metrics.trade_count) ?? rSeries.length,
    total_r: round(number(metrics.total_r) ?? sum(rSeries)),
    profit_factor: number(metrics.profit_factor),
    max_drawdown_r: round(number(metrics.max_drawdown_r) ?? maxDrawdown(cumulative(rSeries))),
    expectancy_r: number(metrics.expectancy_r),
    win_rate: number(metrics.win_rate),
    r_series: rSeries,
    position_count: positions.length,
  };
}

export function bootstrapRSeriesV1(rSeries = [], options = {}) {
  const values = cleanNumbers(rSeries);
  return buildSamples(values, options, "bootstrap", bootstrapPick);
}

export function monteCarloRSeriesV1(rSeries = [], options = {}) {
  const values = cleanNumbers(rSeries);
  return buildSamples(values, options, "monte_carlo", shufflePick);
}

export function buildRobustnessReportArtifactV1(report = {}, input = {}) {
  const payload = objectOrEmpty(report);
  const contentHash = text(payload.content_hash) || `sha256:${canonicalSha256(payload)}`;
  const strategyVersionId = text(input.strategy_version_id || payload.strategy_version_id) || "unknown";
  return {
    schema_version: ROBUSTNESS_REPORT_ARTIFACT_SCHEMA_VERSION_V1,
    artifact_kind: "ROBUSTNESS_REPORT",
    strategy_version_id: strategyVersionId,
    simulation_run_id: text(input.simulation_run_id || payload.baseline?.simulation_run_id),
    content_hash: contentHash,
    storage_ref: text(input.storage_ref) || `artifact://strategy-versions/${strategyVersionId}/robustness/${contentHash}`,
    payload,
    created_at_utc: text(input.created_at_utc || payload.checked_at_utc),
  };
}

function normalizePolicy(policy = {}) {
  return {
    ...DEFAULT_ROBUSTNESS_POLICY_V1,
    ...objectOrEmpty(policy),
    policy_id: text(policy.policy_id) || DEFAULT_ROBUSTNESS_POLICY_V1.policy_id,
    policy_version: text(policy.policy_version) || DEFAULT_ROBUSTNESS_POLICY_V1.policy_version,
  };
}

function generateSamples(input, baseline, policy) {
  const rSeries = baseline.r_series || [];
  const bootstrapSupplied = Array.isArray(input.bootstrap_samples);
  const monteCarloSupplied = Array.isArray(input.monte_carlo_samples);
  return {
    bootstrap_generated: !bootstrapSupplied && rSeries.length > 0,
    monte_carlo_generated: !monteCarloSupplied && rSeries.length > 0,
    bootstrap_samples: bootstrapSupplied ? sampleItems(input.bootstrap_samples) : bootstrapRSeriesV1(rSeries, sampleOptions(policy, "bootstrap")),
    monte_carlo_samples: monteCarloSupplied ? sampleItems(input.monte_carlo_samples) : monteCarloRSeriesV1(rSeries, sampleOptions(policy, "monte_carlo")),
  };
}

function sampleOptions(policy, suffix) {
  return {
    sample_count: policy[`${suffix}_sample_count`],
    seed: `${policy.sample_seed}:${suffix}`,
  };
}

function evaluateBaselineAcceptance(baseline, policy) {
  if (!baseline || !baseline.run_id) return testResult("FAIL", ["BASELINE_RESULT_REQUIRED"]);
  return passFailTest(baseline, policy);
}

function evaluateResultPassRate(testName, items, policy, minPassRate) {
  if (!items.length) return testResult("REVIEW", [`${screaming(testName)}_SAMPLES_REQUIRED`], { sample_count: 0, pass_rate: 0 });
  const evaluated = items.map((item) => ({ ...item, evaluation: passFailTest(item.summary, policy) }));
  const passed = evaluated.filter((item) => item.evaluation.status === "PASS").length;
  const passRate = ratio(passed, evaluated.length);
  const reasons = passRate >= minPassRate ? [] : [`${screaming(testName)}_PASS_RATE_BELOW_POLICY`];
  return testResult(reasons.length ? "FAIL" : "PASS", reasons, {
    sample_count: evaluated.length,
    pass_count: passed,
    pass_rate: passRate,
    min_pass_rate: minPassRate,
    worst_total_r: min(evaluated.map((item) => item.summary.total_r)),
    worst_max_drawdown_r: min(evaluated.map((item) => item.summary.max_drawdown_r)),
    samples: evaluated.map(compactEvaluatedItem),
  });
}

function evaluateBootstrap(samples, policy) {
  if (!samples.length) return testResult("REVIEW", ["BOOTSTRAP_SAMPLES_REQUIRED"], { sample_count: 0 });
  const totals = samples.map((sample) => sample.total_r);
  const p05 = percentile(totals, 0.05);
  const lossProbability = ratio(totals.filter((value) => value < 0).length, totals.length);
  const reasons = [];
  if (p05 < policy.min_bootstrap_p05_total_r) reasons.push("BOOTSTRAP_P05_TOTAL_R_BELOW_POLICY");
  if (lossProbability > policy.max_bootstrap_loss_probability) reasons.push("BOOTSTRAP_LOSS_PROBABILITY_ABOVE_POLICY");
  return testResult(reasons.length ? "FAIL" : "PASS", reasons, {
    sample_count: samples.length,
    percentile_05_total_r: p05,
    percentile_50_total_r: percentile(totals, 0.5),
    percentile_95_total_r: percentile(totals, 0.95),
    loss_probability: lossProbability,
  });
}

function evaluateMonteCarlo(samples, policy) {
  if (!samples.length) return testResult("REVIEW", ["MONTE_CARLO_SAMPLES_REQUIRED"], { sample_count: 0 });
  const totals = samples.map((sample) => sample.total_r);
  const drawdowns = samples.map((sample) => Math.abs(sample.max_drawdown_r));
  const p05 = percentile(totals, 0.05);
  const drawdownP95 = percentile(drawdowns, 0.95);
  const reasons = [];
  if (p05 < policy.min_monte_carlo_p05_total_r) reasons.push("MONTE_CARLO_P05_TOTAL_R_BELOW_POLICY");
  if (drawdownP95 > policy.max_monte_carlo_drawdown_p95_abs_r) reasons.push("MONTE_CARLO_DRAWDOWN_P95_ABOVE_POLICY");
  return testResult(reasons.length ? "FAIL" : "PASS", reasons, {
    sample_count: samples.length,
    percentile_05_total_r: p05,
    percentile_50_total_r: percentile(totals, 0.5),
    percentile_95_drawdown_abs_r: drawdownP95,
  });
}

function evaluateCostStress(items, baseline, policy) {
  if (!items.length) return testResult("REVIEW", ["COST_STRESS_SCENARIOS_REQUIRED"], { scenario_count: 0 });
  const evaluated = items.map((item) => costStressItem(item, baseline, policy));
  const passed = evaluated.filter((item) => item.status === "PASS").length;
  const passRate = ratio(passed, evaluated.length);
  const reasons = passRate >= policy.min_cost_stress_pass_rate ? [] : ["COST_STRESS_PASS_RATE_BELOW_POLICY"];
  return testResult(reasons.length ? "FAIL" : "PASS", reasons, {
    scenario_count: evaluated.length,
    pass_count: passed,
    pass_rate: passRate,
    worst_total_r: min(evaluated.map((item) => item.total_r)),
    max_degradation_r: max(evaluated.map((item) => item.degradation_r)),
    scenarios: evaluated,
  });
}

function costStressItem(item, baseline, policy) {
  const summary = item.summary;
  const degradation = round((baseline.total_r ?? 0) - (summary.total_r ?? 0));
  const baseEvaluation = passFailTest(summary, policy);
  const reasons = [...baseEvaluation.reasons];
  if (degradation > policy.max_cost_stress_degradation_r) reasons.push("COST_STRESS_DEGRADATION_ABOVE_POLICY");
  return {
    scenario_id: item.scenario_id,
    run_id: summary.run_id,
    total_r: summary.total_r,
    degradation_r: degradation,
    status: reasons.length ? "FAIL" : "PASS",
    reasons,
  };
}

function passFailTest(summary, policy) {
  const reasons = [];
  if ((summary.trade_count ?? 0) <= 0) reasons.push("NO_CLOSED_TRADES");
  if ((summary.total_r ?? 0) < policy.min_total_r) reasons.push("TOTAL_R_BELOW_POLICY");
  if (summary.profit_factor !== null && summary.profit_factor < policy.min_profit_factor) reasons.push("PROFIT_FACTOR_BELOW_POLICY");
  if ((summary.max_drawdown_r ?? 0) < policy.max_drawdown_floor_r) reasons.push("MAX_DRAWDOWN_BELOW_POLICY");
  return testResult(reasons.length ? "FAIL" : "PASS", reasons, {
    total_r: summary.total_r,
    trade_count: summary.trade_count,
    profit_factor: summary.profit_factor,
    max_drawdown_r: summary.max_drawdown_r,
  });
}

function gateBlockingReasons(baseline, tests) {
  const reasons = [];
  if (!baseline?.run_id) reasons.push("BASELINE_RESULT_REQUIRED");
  for (const [name, test] of Object.entries(tests)) {
    if (test.status === "FAIL") reasons.push(`${screaming(name)}_FAILED`);
  }
  return reasons;
}

function gateReviewReasons(tests) {
  return Object.entries(tests)
    .filter(([, test]) => test.status === "REVIEW")
    .map(([name]) => `${screaming(name)}_REVIEW_REQUIRED`);
}

function sealReport(report) {
  return {
    ...report,
    input_hash: `sha256:${canonicalSha256(reportInputFingerprint(report))}`,
    content_hash: `sha256:${canonicalSha256(report)}`,
  };
}

function reportInputFingerprint(report) {
  return {
    strategy_version_id: report.strategy_version_id,
    candidate_strategy_version_ids: report.candidate_strategy_version_ids,
    baseline_result_hash: report.baseline?.result_hash,
    policy_hash: report.policy_hash,
    tests: report.tests,
  };
}

function candidateStrategyVersionIds(input, baseline) {
  const ids = [input.candidate_strategy_version_id, input.strategy_version_id, baseline.strategy_version_id];
  for (const item of resultItems(input.candidate_results || [])) ids.push(item.summary.strategy_version_id);
  return [...new Set(ids.map(text).filter(Boolean))].sort();
}

function resultItems(items) {
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const result = objectOrEmpty(item.result || item);
    return {
      scenario_id: text(item.scenario_id || item.window_id || item.parameter_set_id) || `sample_${index + 1}`,
      summary: summarizeSimulationResultV1(result),
    };
  });
}

function sampleItems(samples) {
  return (Array.isArray(samples) ? samples : []).map((sample, index) => {
    const summary = sample.metrics || sample.positions ? summarizeSimulationResultV1(sample) : sample;
    return {
      sample_id: text(sample.sample_id) || `sample_${index + 1}`,
      total_r: round(number(summary.total_r) ?? 0),
      max_drawdown_r: round(number(summary.max_drawdown_r) ?? 0),
      trade_count: number(summary.trade_count) ?? 0,
    };
  });
}

function buildSamples(values, options, mode, picker) {
  if (!values.length) return [];
  const count = Math.max(1, Math.trunc(number(options.sample_count) ?? 1));
  const rng = makeRng(text(options.seed) || `${mode}-seed`);
  return Array.from({ length: count }, (_, index) => sampleResult(values, picker(values, rng), mode, index));
}

function bootstrapPick(values, rng) {
  return values.map(() => values[Math.floor(rng() * values.length)]);
}

function shufflePick(values, rng) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function sampleResult(originalValues, sampledValues, mode, index) {
  return {
    sample_id: `${mode}_${String(index + 1).padStart(4, "0")}`,
    trade_count: originalValues.length,
    total_r: round(sum(sampledValues)),
    max_drawdown_r: maxDrawdown(cumulative(sampledValues)),
  };
}

function rSeriesFromResult(result) {
  const positions = Array.isArray(result.positions) ? result.positions : [];
  return positions
    .filter((position) => String(position.status || "CLOSED").toUpperCase() === "CLOSED")
    .map((position) => number(position.r_result))
    .filter((value) => value !== null);
}

function compactEvaluatedItem(item) {
  return {
    scenario_id: item.scenario_id,
    run_id: item.summary.run_id,
    total_r: item.summary.total_r,
    max_drawdown_r: item.summary.max_drawdown_r,
    status: item.evaluation.status,
    reasons: item.evaluation.reasons,
  };
}

function observability(input, generated) {
  const compute = objectOrEmpty(input.compute_observability);
  return {
    duration_ms: number(compute.duration_ms),
    estimated_cost_usd: number(compute.estimated_cost_usd),
    compute_worker_runs: number(compute.compute_worker_runs) ?? 0,
    simulation_run_count: resultItems(input.candidate_results || []).length + resultItems(input.stress_results || []).length + resultItems(input.parameter_perturbation_results || []).length + 1,
    bootstrap_sample_count: generated.bootstrap_samples.length,
    monte_carlo_sample_count: generated.monte_carlo_samples.length,
    bootstrap_generated: generated.bootstrap_generated,
    monte_carlo_generated: generated.monte_carlo_generated,
  };
}

function testResult(status, reasons, extra = {}) {
  return { status, reasons, ...extra };
}

function makeRng(seed) {
  let state = Number.parseInt(canonicalSha256(seed).slice(0, 8), 16) >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function percentile(values, percentileRank) {
  const sorted = cleanNumbers(values).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileRank) - 1));
  return round(sorted[index]);
}

function cleanNumbers(values) {
  return (Array.isArray(values) ? values : []).map(number).filter((value) => value !== null);
}

function cumulative(values) {
  let cursor = 0;
  return values.map((value) => {
    cursor = round(cursor + value);
    return cursor;
  });
}

function maxDrawdown(values) {
  let peak = 0;
  let drawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    drawdown = Math.min(drawdown, round(value - peak));
  }
  return drawdown;
}

function sum(values) {
  return cleanNumbers(values).reduce((total, value) => total + value, 0);
}

function ratio(value, total) {
  return total ? round(value / total) : 0;
}

function min(values) {
  const numbers = cleanNumbers(values);
  return numbers.length ? round(Math.min(...numbers)) : null;
}

function max(values) {
  const numbers = cleanNumbers(values);
  return numbers.length ? round(Math.max(...numbers)) : null;
}

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function screaming(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase();
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}
