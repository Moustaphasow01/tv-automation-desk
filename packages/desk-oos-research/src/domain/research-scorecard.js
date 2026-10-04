import { missing, requireResearch, uniqueResearchCases } from "./research-evidence.js";

/** Aggregates published REAL values; never simulates a new fill, exit or management rule. */
export function researchScorecard(cases) {
  const eligible = uniqueResearchCases(cases).filter(c => c.identity.scorable && c.identity.sample_purpose === "OOS");
  const trades = [...new Map(eligible.flatMap(c => c.observations.trades).map(t => [t.trade_id, t])).values()];
  const published = trades.filter(t => Number.isFinite(t.real_R));
  const wins = published.filter(t => t.real_R > 0), losses = published.filter(t => t.real_R < 0);
  const netR = published.reduce((n, t) => n + t.real_R, 0);
  const grossProfit = wins.reduce((n, t) => n + t.real_R, 0), grossLoss = -losses.reduce((n, t) => n + t.real_R, 0);
  return { classification: "DERIVED_LOCAL", source: "ENGINE_PUBLISHED_ONLY", financial_recalculation: false,
    scenarios: new Set(eligible.map(c => `${c.identity.date}|${c.scenario_id}`)).size,
    audited_cases: eligible.length, observed_attempts: eligible.filter(c => c.attempt !== null).length,
    unique_days: new Set(eligible.map(c => c.identity.date)).size,
    filled_scenarios: eligible.filter(c => c.observations.filled).length, trades: trades.length,
    trades_with_published_R: published.length, missing_R: trades.length - published.length,
    wins: wins.length, losses: losses.length, flat: published.length - wins.length - losses.length,
    net_R: published.length ? netR : missing("REAL_R"),
    expectancy_R_per_published_trade: published.length ? netR / published.length : missing("REAL_R"),
    profit_factor_R: grossLoss > 0 ? grossProfit / grossLoss : missing("profit_factor_no_published_loss"),
    R_distribution: published.map(t => ({ trade_id: t.trade_id, R: t.real_R })),
    net_USD: usdSummary(trades), fill_rate: eligible.length ? eligible.filter(c => c.observations.filled).length / eligible.length : null,
    fill_rate_basis: "CASES_WITH_PUBLISHED_FILL_DIVIDED_BY_AUDITED_CASES_NOT_AN_INFERRED_MARKET_FACT",
    realized_closed_trade_drawdown_R: closedTradeDrawdown(published),
    portfolio_equity_drawdown: missing("continuous_portfolio_equity"), opportunity_cost: missing("untaken_counterfactual_returns"),
    excluded_cases: uniqueResearchCases(cases).length - eligible.length,
    limitations: ["Scenario cases are correlated within a day; sample size is not independent evidence.",
      "Incomplete published R coverage is not full-corpus performance.", "No hypothetical profits for refused/non-filled tickets."] };
}

function usdSummary(trades) {
  const known = trades.filter(t => Number.isFinite(t.real_USD));
  return { available: known.length === trades.length && trades.length > 0,
    published_sum: known.length ? known.reduce((n, t) => n + t.real_USD, 0) : null, coverage: `${known.length}/${trades.length}` };
}

function closedTradeDrawdown(trades) {
  if (!trades.length || trades.some(t => !t.exit_time)) return missing("ordered_exit_times");
  const times = trades.map(t => t.exit_time);
  if (new Set(times).size !== times.length) return missing("simultaneous_exit_order");
  let total = 0, peak = 0, drawdown = 0;
  for (const trade of [...trades].sort((a, b) => a.exit_time.localeCompare(b.exit_time))) {
    total += trade.real_R; peak = Math.max(peak, total); drawdown = Math.max(drawdown, peak - total);
  }
  return { available: true, value: drawdown, definition: "Realized closed trades only, not intraday equity drawdown" };
}

export function researchCohorts({ cases, rule }) {
  const keys = new Set(cases.flatMap(c => Object.keys(c.features)));
  requireResearch(keys.has(rule.feature), "RESEARCH_FEATURE_UNKNOWN");
  requireResearch(["GT", "GTE", "LT", "LTE", "EQ"].includes(rule.operator), "RESEARCH_OPERATOR_UNSUPPORTED");
  const compare = { GT: (a, b) => a > b, GTE: (a, b) => a >= b, LT: (a, b) => a < b,
    LTE: (a, b) => a <= b, EQ: (a, b) => a === b }[rule.operator];
  const known = cases.filter(c => c.features[rule.feature]?.available);
  requireResearch(known.every(c => typeof c.features[rule.feature].value === typeof rule.value), "RESEARCH_RULE_TYPE_MISMATCH");
  const match = c => compare(c.features[rule.feature].value, rule.value);
  return { classification: "DERIVED_LOCAL", rule, hypotheses_are_not_trading_filters: true,
    rule_true: researchScorecard(known.filter(match)), rule_false: researchScorecard(known.filter(c => !match(c))),
    unknown_count: cases.length - known.length, significance: missing("pre_registered_statistical_test"),
    causal_inference: false };
}

export function planQualityAudit({ identity, cases }) {
  const count = predicate => cases.filter(predicate).length;
  return { audit_type: "PLAN_QUALITY_AUDIT", identity, classification: "DERIVED_LOCAL",
    scenarios_created: new Set(cases.map(c => c.scenario_id)).size,
    scenarios_activated: new Set(cases.filter(c => c.observations.activated).map(c => c.scenario_id)).size,
    scenarios_confirmed: new Set(cases.filter(c => c.observations.confirmed).map(c => c.scenario_id)).size,
    scenarios_traded: new Set(cases.filter(c => c.observations.filled).map(c => c.scenario_id)).size,
    cases_without_published_attempt: count(c => c.attempt === null),
    scenarios_relevant: missing("independent_relevance_rubric"), mapped_valid_moves: missing("predefined_valid_move_and_market_series"),
    unmapped_valid_moves: missing("predefined_valid_move_and_market_series"), false_maps: missing("independent_map_audit"),
    redundant_scenarios: missing("semantic_redundancy_review"), contradictory_scenarios: missing("semantic_relation_review"),
    directionally_correct_but_unmonetized: missing("post_confirmation_path"),
    no_trade_autopsy: cases.some(c => c.observations.filled) ? null : { conclusion: "UNKNOWN", not_good_selectivity_by_default: true } };
}
