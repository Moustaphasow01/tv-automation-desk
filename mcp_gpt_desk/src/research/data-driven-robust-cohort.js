export const DATA_DRIVEN_ROBUST_PASS_COHORT_SCHEMA_VERSION = "data_driven_robust_pass_cohort_v1";

export const DATA_DRIVEN_ROBUST_PASS_COHORT_POLICY_V1 = Object.freeze({
  selection_policy: "ALL_ROBUSTNESS_PASS_NO_TOP_K_CAP",
  min_candidate_count: 1,
  min_family_count_for_portfolio_review: 4,
  min_aggregate_trade_count_for_portfolio_review: 30,
  min_aggregate_total_r: 0,
  min_pair_active_dates_for_correlation: 4,
  max_abs_daily_correlation_review: 0.75,
});

export function buildDataDrivenRobustPassCohort({
  batchId = null,
  datasetKey = null,
  candidates = [],
  generatedAtUtc = new Date().toISOString(),
  brokerProviderCommandCount = 0,
  policy = DATA_DRIVEN_ROBUST_PASS_COHORT_POLICY_V1,
} = {}) {
  const retainedCandidates = normalizeCandidates(candidates)
    .filter((candidate) => candidate.robustness.verdict === "PASS")
    .sort(compareCandidates);
  const families = buildFamilyDistribution(retainedCandidates);
  const dailySeries = buildDailySeries(retainedCandidates);
  const aggregate = buildAggregateMetrics(retainedCandidates, dailySeries);
  const correlation = buildDailyCorrelation(retainedCandidates, dailySeries, policy);
  const diversification = buildDiversificationClusters(retainedCandidates, correlation);
  const blockers = buildBlockerSummary(retainedCandidates);
  const gate = evaluateCohortGate({
    retainedCandidates,
    families,
    aggregate,
    correlation,
    brokerProviderCommandCount,
    policy,
  });

  return {
    schema_version: DATA_DRIVEN_ROBUST_PASS_COHORT_SCHEMA_VERSION,
    generated_at_utc: generatedAtUtc,
    batch_id: batchId,
    dataset_key: datasetKey,
    selection: {
      policy: policy.selection_policy,
      top_k_cap: null,
      retained_all_robustness_pass: true,
      retained_count: retainedCandidates.length,
      robustness_pass_count: retainedCandidates.length,
      oos_pass_count: retainedCandidates.filter((candidate) => candidate.oos.verdict === "PASS").length,
      oos_not_pass_count: retainedCandidates.filter((candidate) => candidate.oos.verdict !== "PASS").length,
      promotion_ready_count: retainedCandidates.filter((candidate) => candidate.promotion.decision === "APPROVED_FOR_PROMOTION").length,
      promotion_operator_review_count: retainedCandidates.filter((candidate) => candidate.promotion.decision === "NEEDS_OPERATOR_APPROVAL").length,
    },
    safety: {
      broker_execution_enabled: false,
      automatic_promotion_enabled: false,
      broker_provider_commands_matching_batch: integer(brokerProviderCommandCount),
      execution_mode: "RESEARCH_ONLY",
    },
    aggregate,
    family_distribution: families,
    daily_correlation: correlation,
    diversification,
    blocker_summary: blockers,
    cohort_gate: gate,
    retained_candidates: retainedCandidates.map(candidateSummary),
  };
}

export function renderDataDrivenRobustPassCohortMarkdown(cohort = {}) {
  const selection = cohort.selection || {};
  const aggregate = cohort.aggregate || {};
  const gate = cohort.cohort_gate || {};
  const correlation = cohort.daily_correlation || {};
  const blockers = cohort.blocker_summary || {};
  const diversification = cohort.diversification || {};
  const candidates = Array.isArray(cohort.retained_candidates) ? cohort.retained_candidates : [];
  const families = Array.isArray(cohort.family_distribution) ? cohort.family_distribution : [];

  return [
    `# Data-driven robust pass cohort — ${cohort.batch_id || "unknown batch"}`,
    "",
    "## Verdict",
    "",
    `- Cohort gate: **${gate.verdict || "UNKNOWN"}**`,
    `- Decision: **${gate.decision || "UNKNOWN"}**`,
    `- Selection policy: \`${selection.policy || "UNKNOWN"}\``,
    `- Top-K cap: **${selection.top_k_cap === null ? "none" : selection.top_k_cap ?? "unknown"}**`,
    `- Retained candidates: **${selection.retained_count ?? 0}**`,
    `- OOS PASS inside retained cohort: **${selection.oos_pass_count ?? 0}/${selection.retained_count ?? 0}**`,
    `- Broker commands matching batch: **${cohort.safety?.broker_provider_commands_matching_batch ?? 0}**`,
    "",
    "## Aggregate metrics",
    "",
    markdownTable([
      ["Metric", "Value"],
      ["Total R", formatNumber(aggregate.total_r)],
      ["Closed trades", String(aggregate.closed_trade_count ?? 0)],
      ["Open/marked positions", String(aggregate.open_or_marked_position_count ?? 0)],
      ["Win rate", percent(aggregate.win_rate)],
      ["Profit factor", aggregate.profit_factor === null ? "n/a" : formatNumber(aggregate.profit_factor)],
      ["Max drawdown R", formatNumber(aggregate.max_drawdown_r)],
      ["Trading days with activity", String(aggregate.trading_days_with_activity ?? 0)],
      ["Max same-day candidate activity", String(aggregate.max_same_day_candidate_activity ?? 0)],
    ]),
    "",
    "## Gate reasons",
    "",
    gate.reasons?.length ? gate.reasons.map((reason) => `- ${reason}`).join("\n") : "- none",
    "",
    "## Daily correlation",
    "",
    markdownTable([
      ["Metric", "Value"],
      ["Candidate pairs", String(correlation.pair_count ?? 0)],
      ["Computable pairs", String(correlation.computable_pair_count ?? 0)],
      ["Skipped sparse pairs", String(correlation.skipped_sparse_pair_count ?? 0)],
      ["Min active dates per pair", String(correlation.min_pair_active_dates_for_correlation ?? "n/a")],
      ["Max abs correlation", correlation.max_abs_correlation === null ? "n/a" : formatNumber(correlation.max_abs_correlation)],
      ["Average abs correlation", correlation.avg_abs_correlation === null ? "n/a" : formatNumber(correlation.avg_abs_correlation)],
      ["High-correlation pairs", String(correlation.high_correlation_pair_count ?? correlation.high_correlation_pairs?.length ?? 0)],
    ]),
    "",
    "## Diversification clusters",
    "",
    markdownTable([
      ["Metric", "Value"],
      ["Cluster count", String(diversification.cluster_count ?? 0)],
      ["Clustered candidates", String(diversification.clustered_candidate_count ?? 0)],
      ["Unclustered candidates", String(diversification.unclustered_candidate_count ?? 0)],
      ["Largest cluster size", String(diversification.largest_cluster_size ?? 0)],
    ]),
    "",
    markdownTable([
      ["Cluster", "Candidates", "Families", "Total R", "Representative"],
      ...(diversification.clusters || []).map((cluster) => [
        cluster.cluster_id,
        String(cluster.candidate_count),
        cluster.family_ids.join(", "),
        formatNumber(cluster.total_r),
        cluster.representative_candidate_key,
      ]),
    ]),
    "",
    "## Main blockers",
    "",
    markdownTable([
      ["Blocker", "Count"],
      ...Object.entries(blockers.reason_counts || {}).sort((left, right) => right[1] - left[1]).map(([reason, count]) => [reason, String(count)]),
    ]),
    "",
    "## Family distribution",
    "",
    markdownTable([
      ["Family", "Candidates", "Trades", "Total R", "OOS PASS"],
      ...families.map((family) => [
        family.family_id,
        String(family.candidate_count),
        String(family.closed_trade_count),
        formatNumber(family.total_r),
        `${family.oos_pass_count}/${family.candidate_count}`,
      ]),
    ]),
    "",
    "## Retained candidates — all robustness PASS",
    "",
    markdownTable([
      ["#", "Candidate", "Family", "Variant", "Robust", "OOS", "Trades", "R", "PF", "Promotion"],
      ...candidates.map((candidate, index) => [
        String(index + 1),
        candidate.candidate_key,
        candidate.family_id,
        String(candidate.variant_index ?? ""),
        formatNumber(candidate.robustness_score),
        candidate.oos_verdict || "UNKNOWN",
        String(candidate.closed_trade_count ?? 0),
        formatNumber(candidate.total_r),
        candidate.profit_factor === null ? "n/a" : formatNumber(candidate.profit_factor),
        candidate.promotion_decision || candidate.promotion_verdict || "UNKNOWN",
      ]),
    ]),
    "",
    "## Safety note",
    "",
    "This cohort report is research-only. It retains every candidate that passed ROBUSTNESS, but it does not authorize live execution, broker submission, or automatic promotion.",
    "",
  ].join("\n");
}

function normalizeCandidates(candidates) {
  return (Array.isArray(candidates) ? candidates : []).map((candidate) => {
    const positions = normalizePositions(candidate.positions || candidate.position_items || []);
    const robustnessMetrics = object(candidate.robustness_metrics || candidate.robustness?.metrics || candidate.metric_snapshot);
    const validationMetrics = object(candidate.validation_metrics || {});
    const metrics = {
      ...validationMetrics,
      ...robustnessMetrics,
      ...object(candidate.metrics),
    };
    const derived = metricsFromPositions(positions);
    const totalR = numberOrNull(metrics.total_r ?? metrics.net_r ?? candidate.total_r) ?? derived.total_r;
    const closedTradeCount = integer(metrics.trade_count ?? metrics.closed_trade_count ?? candidate.trade_count, derived.closed_trade_count);
    const profitFactor = numberOrNull(metrics.profit_factor ?? candidate.profit_factor) ?? derived.profit_factor;
    const maxDrawdownR = numberOrNull(metrics.max_drawdown_r ?? candidate.max_drawdown_r) ?? derived.max_drawdown_r;
    return {
      research_candidate_id: text(candidate.research_candidate_id),
      candidate_key: text(candidate.candidate_key) || text(candidate.research_candidate_id) || "unknown-candidate",
      strategy_version_id: text(candidate.strategy_version_id),
      simulation_run_id: text(candidate.simulation_run_id),
      family_id: text(candidate.family_id) || "unknown_family",
      variant_index: integer(candidate.variant_index, null),
      robustness: {
        verdict: upper(candidate.robustness_verdict || candidate.robustness?.verdict || "PASS"),
        score: numberOrNull(candidate.robustness_score ?? candidate.robustness?.score),
        metrics: robustnessMetrics,
      },
      oos: {
        verdict: upper(candidate.oos_verdict || candidate.oos?.verdict || "UNKNOWN"),
        score: numberOrNull(candidate.oos_score ?? candidate.oos?.score),
        metrics: object(candidate.oos_metrics || candidate.oos?.metrics),
      },
      promotion: {
        verdict: upper(candidate.promotion_verdict || candidate.promotion?.verdict || "UNKNOWN"),
        score: numberOrNull(candidate.promotion_score ?? candidate.promotion?.score),
        decision: text(candidate.promotion_decision || candidate.promotion?.decision),
        reasons: normalizeReasons(candidate.promotion_reasons || candidate.promotion?.reasons),
        portfolio_fit_reasons: normalizeReasons(candidate.portfolio_fit_reasons || candidate.promotion?.portfolio_fit_reasons),
      },
      metrics: {
        total_r: round4(totalR),
        closed_trade_count: closedTradeCount,
        profit_factor: profitFactor === null ? null : round4(profitFactor),
        max_drawdown_r: round4(maxDrawdownR),
      },
      positions,
    };
  });
}

function normalizePositions(positions) {
  return (Array.isArray(positions) ? positions : []).map((position, index) => ({
    position_id: text(position.position_id || position.id) || `position-${index + 1}`,
    status: upper(position.status || "UNKNOWN"),
    direction: lower(position.direction || position.side || position.market_position),
    instrument: text(position.instrument || position.symbol),
    entry_time: text(position.entry_time || position.entry_time_utc || position.opened_at_utc || position.created_at_utc),
    exit_time: text(position.exit_time || position.exit_time_utc || position.closed_at_utc || position.updated_at_utc),
    trading_date: tradingDate(position),
    r_result: numberOrNull(position.r_result ?? position.net_r ?? position.result_r ?? position.gross_r),
  })).filter((position) => position.r_result !== null || position.status);
}

function metricsFromPositions(positions) {
  const closed = positions.filter((position) => position.status === "CLOSED" && position.r_result !== null);
  const results = closed.map((position) => position.r_result);
  const totalR = sum(results);
  return {
    total_r: round4(totalR),
    closed_trade_count: closed.length,
    profit_factor: profitFactor(results),
    max_drawdown_r: maxDrawdown(results),
  };
}

function buildFamilyDistribution(candidates) {
  const byFamily = new Map();
  for (const candidate of candidates) {
    if (!byFamily.has(candidate.family_id)) {
      byFamily.set(candidate.family_id, {
        family_id: candidate.family_id,
        candidate_count: 0,
        closed_trade_count: 0,
        total_r: 0,
        oos_pass_count: 0,
      });
    }
    const row = byFamily.get(candidate.family_id);
    row.candidate_count += 1;
    row.closed_trade_count += candidate.metrics.closed_trade_count;
    row.total_r += candidate.metrics.total_r;
    if (candidate.oos.verdict === "PASS") row.oos_pass_count += 1;
  }
  return [...byFamily.values()]
    .map((family) => ({ ...family, total_r: round4(family.total_r) }))
    .sort((left, right) => right.total_r - left.total_r || left.family_id.localeCompare(right.family_id));
}

function buildDailySeries(candidates) {
  const series = new Map();
  for (const candidate of candidates) {
    const daily = new Map();
    for (const position of candidate.positions) {
      if (position.status !== "CLOSED" || position.r_result === null) continue;
      const date = position.trading_date;
      if (!date) continue;
      daily.set(date, round4((daily.get(date) || 0) + position.r_result));
    }
    series.set(candidate.candidate_key, daily);
  }
  return series;
}

function buildAggregateMetrics(candidates, dailySeries) {
  const allClosedResults = candidates.flatMap((candidate) => candidate.positions
    .filter((position) => position.status === "CLOSED" && position.r_result !== null)
    .map((position) => position.r_result));
  const fallbackTotalR = sum(candidates.map((candidate) => candidate.metrics.total_r));
  const fallbackTradeCount = sum(candidates.map((candidate) => candidate.metrics.closed_trade_count));
  const dailyActivity = new Map();
  for (const daily of dailySeries.values()) {
    for (const [date, value] of daily.entries()) {
      if (value === 0) continue;
      dailyActivity.set(date, (dailyActivity.get(date) || 0) + 1);
    }
  }
  return {
    total_r: round4(allClosedResults.length ? sum(allClosedResults) : fallbackTotalR),
    closed_trade_count: allClosedResults.length || fallbackTradeCount,
    open_or_marked_position_count: candidates.flatMap((candidate) => candidate.positions).filter((position) => position.status !== "CLOSED").length,
    win_rate: allClosedResults.length ? round4(allClosedResults.filter((value) => value > 0).length / allClosedResults.length) : null,
    profit_factor: allClosedResults.length ? profitFactor(allClosedResults) : null,
    max_drawdown_r: allClosedResults.length ? maxDrawdown(allClosedResults) : round4(Math.min(...candidates.map((candidate) => candidate.metrics.max_drawdown_r), 0)),
    trading_days_with_activity: dailyActivity.size,
    max_same_day_candidate_activity: dailyActivity.size ? Math.max(...dailyActivity.values()) : 0,
  };
}

function buildDailyCorrelation(candidates, dailySeries, policy = DATA_DRIVEN_ROBUST_PASS_COHORT_POLICY_V1) {
  const keys = candidates.map((candidate) => candidate.candidate_key);
  const dates = [...new Set([...dailySeries.values()].flatMap((daily) => [...daily.keys()]))].sort();
  const pairs = [];
  for (let leftIndex = 0; leftIndex < keys.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < keys.length; rightIndex += 1) {
      const leftKey = keys[leftIndex];
      const rightKey = keys[rightIndex];
      const leftDaily = dailySeries.get(leftKey) || new Map();
      const rightDaily = dailySeries.get(rightKey) || new Map();
      const activeDates = dates.filter((date) => (leftDaily.get(date) || 0) !== 0 || (rightDaily.get(date) || 0) !== 0);
      const correlation = pearson(
        activeDates.map((date) => leftDaily.get(date) || 0),
        activeDates.map((date) => rightDaily.get(date) || 0),
      );
      if (activeDates.length < policy.min_pair_active_dates_for_correlation || correlation === null) continue;
      pairs.push({ left: leftKey, right: rightKey, active_dates: activeDates.length, correlation: round4(correlation), abs_correlation: round4(Math.abs(correlation)) });
    }
  }
  const absValues = pairs.map((pair) => pair.abs_correlation);
  const highPairs = pairs
    .filter((pair) => pair.abs_correlation >= policy.max_abs_daily_correlation_review)
    .sort((left, right) => right.abs_correlation - left.abs_correlation);
  return {
    pair_count: keys.length * Math.max(0, keys.length - 1) / 2,
    computable_pair_count: pairs.length,
    skipped_sparse_pair_count: keys.length * Math.max(0, keys.length - 1) / 2 - pairs.length,
    min_pair_active_dates_for_correlation: policy.min_pair_active_dates_for_correlation,
    max_abs_correlation: absValues.length ? round4(Math.max(...absValues)) : null,
    avg_abs_correlation: absValues.length ? round4(sum(absValues) / absValues.length) : null,
    high_correlation_pair_count: highPairs.length,
    high_correlation_edges: highPairs,
    high_correlation_pairs: highPairs.slice(0, 50),
  };
}

function buildDiversificationClusters(candidates, correlation = {}) {
  const candidateByKey = new Map(candidates.map((candidate) => [candidate.candidate_key, candidate]));
  const edges = Array.isArray(correlation.high_correlation_edges)
    ? correlation.high_correlation_edges
    : Array.isArray(correlation.high_correlation_pairs)
      ? correlation.high_correlation_pairs
      : [];
  const parent = new Map(candidates.map((candidate) => [candidate.candidate_key, candidate.candidate_key]));
  for (const edge of edges) {
    if (!candidateByKey.has(edge.left) || !candidateByKey.has(edge.right)) continue;
    union(parent, edge.left, edge.right);
  }
  const grouped = new Map();
  for (const candidate of candidates) {
    const root = find(parent, candidate.candidate_key);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(candidate);
  }
  const clusters = [...grouped.values()]
    .filter((items) => items.length > 1)
    .map((items, index) => {
      const sorted = [...items].sort(compareCandidates);
      return {
        cluster_id: `corr_cluster_${String(index + 1).padStart(3, "0")}`,
        candidate_count: sorted.length,
        family_ids: [...new Set(sorted.map((candidate) => candidate.family_id))].sort(),
        total_r: round4(sum(sorted.map((candidate) => candidate.metrics.total_r))),
        representative_candidate_key: sorted[0]?.candidate_key || null,
        representative_robustness_score: sorted[0]?.robustness.score ?? null,
        candidate_keys: sorted.map((candidate) => candidate.candidate_key),
      };
    })
    .sort((left, right) => right.candidate_count - left.candidate_count || right.total_r - left.total_r);
  const clustered = sum(clusters.map((cluster) => cluster.candidate_count));
  return {
    policy: "HIGH_CORRELATION_CLUSTERING_REVIEW_ONLY_NO_DISCARD",
    cluster_count: clusters.length,
    clustered_candidate_count: clustered,
    unclustered_candidate_count: candidates.length - clustered,
    largest_cluster_size: clusters.length ? Math.max(...clusters.map((cluster) => cluster.candidate_count)) : 0,
    clusters,
  };
}

function buildBlockerSummary(candidates) {
  const reasonCounts = {};
  for (const candidate of candidates) {
    if (candidate.oos.verdict !== "PASS") increment(reasonCounts, `OOS_${candidate.oos.verdict || "UNKNOWN"}`);
    for (const reason of candidate.promotion.reasons) increment(reasonCounts, reason);
    for (const reason of candidate.promotion.portfolio_fit_reasons) increment(reasonCounts, reason);
    if (!candidate.promotion.decision) increment(reasonCounts, "PROMOTION_DECISION_MISSING");
  }
  return { reason_counts: reasonCounts };
}

function evaluateCohortGate({ retainedCandidates, families, aggregate, correlation, brokerProviderCommandCount, policy }) {
  const fails = [];
  const reviews = [];
  if (retainedCandidates.length < policy.min_candidate_count) fails.push("ROBUST_PASS_COHORT_EMPTY");
  if (aggregate.total_r <= policy.min_aggregate_total_r) fails.push("COHORT_TOTAL_R_NOT_POSITIVE");
  if (integer(brokerProviderCommandCount) !== 0) fails.push("BROKER_COMMANDS_FOUND_IN_RESEARCH_BATCH");
  if (aggregate.closed_trade_count < policy.min_aggregate_trade_count_for_portfolio_review) reviews.push("COHORT_AGGREGATE_TRADE_COUNT_BELOW_PORTFOLIO_REVIEW_POLICY");
  if (families.length < policy.min_family_count_for_portfolio_review) reviews.push("COHORT_FAMILY_DIVERSITY_BELOW_PORTFOLIO_REVIEW_POLICY");
  if (retainedCandidates.some((candidate) => candidate.oos.verdict !== "PASS")) reviews.push("COHORT_HAS_ROBUSTNESS_PASS_CANDIDATES_WITHOUT_OOS_PASS");
  if (correlation.max_abs_correlation === null) reviews.push("COHORT_DAILY_CORRELATION_NOT_COMPUTABLE");
  else if (correlation.max_abs_correlation >= policy.max_abs_daily_correlation_review) reviews.push("COHORT_DAILY_CORRELATION_REQUIRES_CLUSTERING_REVIEW");

  const verdict = fails.length ? "FAIL" : reviews.length ? "NEEDS_REVIEW" : "PASS";
  return {
    verdict,
    decision: verdict === "PASS" ? "READY_FOR_OPERATOR_PORTFOLIO_REVIEW" : verdict === "NEEDS_REVIEW" ? "PORTFOLIO_COHORT_REVIEW_REQUIRED" : "PORTFOLIO_COHORT_REJECTED",
    reasons: [...fails, ...reviews],
    policy,
  };
}

function candidateSummary(candidate) {
  return {
    research_candidate_id: candidate.research_candidate_id,
    candidate_key: candidate.candidate_key,
    strategy_version_id: candidate.strategy_version_id,
    simulation_run_id: candidate.simulation_run_id,
    family_id: candidate.family_id,
    variant_index: candidate.variant_index,
    robustness_score: candidate.robustness.score,
    oos_verdict: candidate.oos.verdict,
    oos_score: candidate.oos.score,
    promotion_verdict: candidate.promotion.verdict,
    promotion_decision: candidate.promotion.decision,
    portfolio_fit_reasons: candidate.promotion.portfolio_fit_reasons,
    total_r: candidate.metrics.total_r,
    closed_trade_count: candidate.metrics.closed_trade_count,
    profit_factor: candidate.metrics.profit_factor,
    max_drawdown_r: candidate.metrics.max_drawdown_r,
  };
}

function compareCandidates(left, right) {
  return (right.robustness.score ?? -1) - (left.robustness.score ?? -1)
    || right.metrics.total_r - left.metrics.total_r
    || left.candidate_key.localeCompare(right.candidate_key);
}

function pearson(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length < 2) return null;
  const leftAvg = sum(left) / left.length;
  const rightAvg = sum(right) / right.length;
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftAvg;
    const rightDelta = right[index] - rightAvg;
    numerator += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  if (leftVariance === 0 || rightVariance === 0) return null;
  return numerator / Math.sqrt(leftVariance * rightVariance);
}

function profitFactor(results) {
  const wins = sum(results.filter((value) => value > 0));
  const losses = Math.abs(sum(results.filter((value) => value < 0)));
  if (wins === 0 && losses === 0) return null;
  if (losses === 0) return null;
  return round4(wins / losses);
}

function maxDrawdown(results) {
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const result of results) {
    equity += result;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, equity - peak);
  }
  return round4(maxDd);
}

function tradingDate(position) {
  const explicit = text(position.trading_date || position.date);
  if (explicit) return explicit.slice(0, 10);
  const entry = text(position.entry_time || position.entry_time_utc || position.opened_at_utc || position.created_at_utc);
  if (entry) return entry.slice(0, 10);
  const exit = text(position.exit_time || position.exit_time_utc || position.closed_at_utc || position.updated_at_utc);
  if (exit) return exit.slice(0, 10);
  return null;
}

function normalizeReasons(value) {
  if (Array.isArray(value)) return value.flatMap(normalizeReasons).filter(Boolean);
  if (value && typeof value === "object") {
    if (Array.isArray(value.detail)) return normalizeReasons(value.detail);
    if (Array.isArray(value.reasons)) return normalizeReasons(value.reasons);
    return Object.values(value).flatMap(normalizeReasons).filter(Boolean);
  }
  const normalized = text(value);
  return normalized ? [normalized] : [];
}

function markdownTable(rows) {
  if (!rows.length) return "";
  const escaped = rows.map((row) => row.map((cell) => String(cell ?? "").replaceAll("|", "\\|")));
  const [header, ...body] = escaped;
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function percent(value) {
  return value === null || value === undefined ? "n/a" : `${formatNumber(Number(value) * 100)}%`;
}

function formatNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "n/a";
  return String(round4(parsed));
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function lower(value) {
  return String(value || "").trim().toLowerCase();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integer(value, fallback = 0) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : fallback;
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function increment(target, key) {
  if (!key) return;
  target[key] = (target[key] || 0) + 1;
}

function find(parent, key) {
  const current = parent.get(key) || key;
  if (current === key) return current;
  const root = find(parent, current);
  parent.set(key, root);
  return root;
}

function union(parent, left, right) {
  const leftRoot = find(parent, left);
  const rightRoot = find(parent, right);
  if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
}

function round4(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}
