import test from "node:test";
import assert from "node:assert/strict";
import { createScenarioSelfAudit } from "../src/domain/scenario-self-audit.js";
import { researchScorecard, researchCohorts } from "../src/domain/research-scorecard.js";
import { validateResearchSplit, selectResearchModel, evaluateExperimentReadiness } from "../src/domain/research-governance.js";
import { validateResearcherAnswer } from "../src/domain/research-role-contract.js";
import { searchHypothesisEvidence, winnerRegressionSet } from "../src/domain/hypothesis-evidence.js";
import { fingerprint, identity, packet, event, unknownAnswers } from "./research-fixtures.js";

const make = options => createScenarioSelfAudit({ identity, packet: packet(), events: [], trades: [], fingerprint, ...options });
test("every scenario has an audit, including without an observed attempt; no rationale invented", () => {
  const audit = make({ packet: packet("S900", null) });
  assert.equal(Object.keys(audit.questions).length, 7); assert.equal(audit.attempt, null);
  assert.equal(audit.planner_rationale.available, false); assert.equal(audit.attribution, "UNKNOWN");
  assert.equal(audit.features.htf_bias.reason, "NOT_PERSISTED");
  assert.match(audit.observations.lifecycle_flag_semantics, /FALSE_IS_NOT/);
});
test("temporal features derive only supplied events, missing stays unknown", () => {
  const audit = make({ events: [event("STEP_1", "2026-07-02T08:00:00Z"), event("CONFIRMED", "2026-07-02T08:15:00Z")] });
  assert.equal(audit.features.confirmation_duration_minutes.value, 15);
  assert.equal(audit.features.time_to_entry_minutes.available, false);
  assert.equal(audit.features.movement_consumed_before_confirmation.available, false);
});
test("smoke/unscorable excluded; duplicated case/trade does not inflate expectancy or independent days", () => {
  const trade = { trade_id: "T1", real_R: 2, real_USD: 20, exit_time: "2026-07-02T10:00:00Z" };
  const audit = make({ events: [event("FILLED", "2026-07-02T09:00:00Z")], trades: [trade] });
  const smoke = { ...audit, case_id: "smoke", identity: { ...identity, sample_purpose: "TECHNICAL_SMOKE" } };
  const gap = { ...audit, case_id: "gap", identity: { ...identity, scorable: false } };
  const card = researchScorecard([audit, audit, smoke, gap]);
  assert.equal(card.trades, 1); assert.equal(card.net_R, 2); assert.equal(card.unique_days, 1); assert.equal(card.excluded_cases, 2);
  assert.equal(card.portfolio_equity_drawdown.available, false);
});
test("loss and winner autopsies classified from published REAL only; no management diagnosis", () => {
  const audit = make({ trades: [{ trade_id: "a", real_R: -1 }, { trade_id: "b", real_R: 2 }, { trade_id: "c", real_R: null }] });
  assert.deepEqual(audit.trade_autopsy.map(t => t.kind), ["LOSER_AUTOPSY", "WINNER_AUTOPSY", "UNKNOWN_AUTOPSY"]);
  assert.ok(audit.trade_autopsy.every(t => t.interpretation === "UNKNOWN"));
});
test("unknown R is not zero and incomplete financial coverage is visible", () => {
  const card = researchScorecard([make({ trades: [{ trade_id: "a", real_R: null }] })]);
  assert.equal(card.net_R.available, false); assert.equal(card.missing_R, 1);
  assert.equal(card.net_USD.available, false);
});
test("simultaneous exits cannot manufacture an ordered drawdown", () => {
  const audit = make({ trades: [{ trade_id: "a", real_R: 2, exit_time: "2026-07-02T10:00:00Z" },
    { trade_id: "b", real_R: -1, exit_time: "2026-07-02T10:00:00Z" }] });
  assert.equal(researchScorecard([audit]).realized_closed_trade_drawdown_R.available, false);
});
test("holdouts must be disjoint, strictly later and not in already exposed research corpus", () => {
  const good = { discovery: ["2026-07-02"], validation: ["2026-09-02"], test: ["2026-10-02"] };
  assert.equal(validateResearchSplit(good).holdout_status, "RESERVED_NOT_ACCESSED");
  assert.throws(() => validateResearchSplit({ ...good, exposedDates: ["2026-09-02"] }), /HOLDOUT_CONTAMINATED/);
  assert.throws(() => validateResearchSplit({ ...good, test: good.validation }), /SPLIT_OVERLAP/);
  assert.throws(() => validateResearchSplit({ ...good, validation: ["2026-06-02"] }), /NOT_WALK_FORWARD/);
});
test("model selected from actually available capabilities, unavailable Astra is never asserted", () => {
  const caps = [{ identifier: "not-exposed", available: false, reasoning: true, capability_rank: 100 },
    { identifier: "exposed", available: true, reasoning: true, capability_rank: 2, reasoning_efforts: ["xhigh"], capability_source: "harness" }];
  assert.equal(selectResearchModel(caps).identifier, "exposed");
  assert.throws(() => selectResearchModel([]), /MODEL_UNAVAILABLE/);
});
test("all questions must be answered and citations resolve; no confidence-as-win-rate", () => {
  const audit = make(), output = unknownAnswers();
  assert.equal(validateResearcherAnswer({ audit, output }).confidence, "UNCALIBRATED");
  output.answers[0] = { ...output.answers[0], kind: "INTERPRETATION", evidence_refs: ["fake"] };
  assert.throws(() => validateResearcherAnswer({ audit, output }), /CITATION_UNKNOWN/);
  assert.throws(() => validateResearcherAnswer({ audit, output: { ...unknownAnswers(), answers: [] } }), /ANSWERS_REQUIRED/);
});
test("counterexamples are actively searched, unknown outcomes neither support nor refute", () => {
  const cases = [make({ trades: [{ trade_id: "a", real_R: 2 }] }), { ...make({ trades: [{ trade_id: "b", real_R: -1 }] }), case_id: "loss" },
    { ...make(), case_id: "unobserved" }];
  const feature_rule = { feature: "confirmation_step_count", operator: "GTE", value: 2 };
  const search = searchHypothesisEvidence({ cases, feature_rule, outcome_rule: { metric: "PUBLISHED_REAL_R", operator: "GT", value: 0 } });
  assert.equal(search.supporting_cases.length, 1); assert.deepEqual(search.counterexamples, ["loss"]);
  assert.deepEqual(search.unknown_cases, ["unobserved"]); assert.equal(search.independent_days, 1);
  assert.equal(winnerRegressionSet({ cases, feature_rule }).at_risk.length, 1);
});
test("readiness never implies promotion, execution or validated edge", () => {
  const result = evaluateExperimentReadiness({ hypothesis: {}, critique: {}, counterexampleSearch: {}, winnerRegression: {} });
  assert.equal(result.ready, false); assert.equal(result.automatic_promotion, false); assert.equal(result.replay_authorization, false);
  assert.equal(result.validated_edge, false);
});
test("cohorts disclose missing features and no statistical significance", () => {
  const card = researchCohorts({ cases: [make()], rule: { feature: "htf_bias", operator: "EQ", value: "LONG" } });
  assert.equal(card.unknown_count, 1); assert.equal(card.significance.available, false);
});
