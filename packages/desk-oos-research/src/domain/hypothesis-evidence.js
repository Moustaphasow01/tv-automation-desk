import { missing, requireResearch } from "./research-evidence.js";

const compare = { GT: (a, b) => a > b, GTE: (a, b) => a >= b, LT: (a, b) => a < b,
  LTE: (a, b) => a <= b, EQ: (a, b) => a === b };

function ruleValue(audit, rule) {
  const feature = audit.features[rule.feature];
  if (!feature?.available) return null;
  requireResearch(Object.hasOwn(compare, rule.operator), "RESEARCH_OPERATOR_UNSUPPORTED");
  requireResearch(typeof feature.value === typeof rule.value, "RESEARCH_RULE_TYPE_MISMATCH");
  return compare[rule.operator](feature.value, rule.value);
}

function outcomeValue(audit, outcome) {
  requireResearch(outcome.metric === "PUBLISHED_REAL_R", "RESEARCH_OUTCOME_UNSUPPORTED");
  requireResearch(Object.hasOwn(compare, outcome.operator) && Number.isFinite(outcome.value), "RESEARCH_OUTCOME_INVALID");
  const trades = audit.observations.trades;
  if (trades.length !== 1 || !Number.isFinite(trades[0].real_R)) return null;
  return compare[outcome.operator](trades[0].real_R, outcome.value);
}

/** Tests an implication on known published observations. Missing/no-fill outcomes are UNKNOWN, not losses. */
export function searchHypothesisEvidence({ cases, feature_rule, outcome_rule }) {
  const supporting = [], counterexamples = [], unrelated = [], unknown = [];
  for (const audit of cases) {
    if (!audit.identity.scorable || audit.identity.sample_purpose !== "OOS") continue;
    const rule = ruleValue(audit, feature_rule), outcome = outcomeValue(audit, outcome_rule);
    if (rule === null || outcome === null) unknown.push(audit.case_id);
    else if (!rule) unrelated.push(audit.case_id);
    else (outcome ? supporting : counterexamples).push(audit.case_id);
  }
  return { completed: true, supporting_cases: supporting, counterexamples, unrelated_cases: unrelated,
    unknown_cases: unknown, searched_case_ids: cases.map(c => c.case_id),
    independent_days: new Set(cases.filter(c => [...supporting, ...counterexamples].includes(c.case_id)).map(c => c.identity.date)).size,
    statistical_significance: missing("multiple_testing_corrected_pre_registered_test"), causal_inference: false };
}

export function winnerRegressionSet({ cases, feature_rule }) {
  const winners = cases.filter(c => c.identity.scorable && c.identity.sample_purpose === "OOS"
    && c.observations.trades.some(t => Number.isFinite(t.real_R) && t.real_R > 0));
  return { complete: true, all_published_winners: winners.map(c => c.case_id),
    at_risk: winners.filter(c => ruleValue(c, feature_rule) === true).map(c => c.case_id),
    unknown_exposure: winners.filter(c => ruleValue(c, feature_rule) === null).map(c => c.case_id),
    classification: "DERIVED_LOCAL", definition: "Winners exposed to the candidate predicate, not simulated deleted winners",
    actual_challenger_winner_preservation: missing("authorized_challenger_experiment") };
}
