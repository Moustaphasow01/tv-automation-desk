import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidateAllocationPortfolioV1 } from "../src/portfolio-candidate-allocation-v1.js";
import { evaluatePortfolioRiskBudgetV1 } from "../src/portfolio-risk-budget-v1.js";
import { buildPortfolioTargetPositionPlanV1 } from "../src/portfolio-target-position-v1.js";
import { normalizeProposedTradePlanV1 } from "../src/trade-plan-economics-v1.js";

const now = "2026-09-04T15:00:00Z";
function signal(id, overrides = {}) {
  return { signal_id: id, strategy_instance_id: `instance-${id}`, account_id: "shadow",
    instrument: "ZW", direction: "LONG", proposed_size: 1, confidence: 0.7,
    generated_at_utc: now, expires_at_utc: "2026-09-04T15:30:00Z",
    proposed_trade_plan: { entry: { price: 500 }, stop: { price: 498 }, targets: [{price:503}],
      order_type: "LIMIT", instrument_contract: { point_value: 50, tick_size: 0.25, currency: "USD" } }, ...overrides };
}
function allocate(signals, policy = "BEST_COMPLETE_PLAN_V1") {
  return buildCandidateAllocationPortfolioV1({ signals, account_id: "shadow", as_of_utc: now,
    policy: { sizing_mode: "MONETARY_RISK_BUDGET", conflict_resolution: policy } });
}

test("competing complete plans select one proposal without merging prices or inflating size", () => {
  const weak = signal("weak", {confidence:0.6});
  const strong = signal("strong", {confidence:0.9});
  const before = structuredClone([weak,strong]);
  const result = allocate([weak,strong]);
  assert.deepEqual([weak,strong],before);
  assert.equal(result.candidate_allocations.length,1);
  assert.deepEqual(result.candidate_allocations[0].signal_ids,["strong"]);
  assert.equal(result.candidate_allocations[0].proposed_size,1);
  assert.equal(result.rejected_signals[0].issues[0].selected_signal_id,"strong");
  const risk = evaluatePortfolioRiskBudgetV1({ candidate_allocations:result.candidate_allocations,
    budget:{sizing_mode:"MONETARY_RISK_BUDGET",monetary_risk_scope:"PER_ALLOCATION",
      max_monetary_risk:500,max_monetary_risk_currency:"USD",max_portfolio_abs_size:20} });
  assert.equal(risk.allocation_evaluations[0].status,"PASS");
  const targets=buildPortfolioTargetPositionPlanV1({as_of_utc:now,account_id:"shadow",
    candidate_allocations:result.candidate_allocations,risk_budget_evaluation:risk});
  assert.equal(targets.target_positions[0].approved_trade_plan.availability,"KNOWN");
  assert.equal(targets.target_positions[0].approved_trade_plan.source_signal_id,"strong");
  assert.equal(targets.target_positions[0].approved_trade_plan.stop.price,498);
});

test("selection and audit are independent of incoming order including confidence ties", () => {
  const rows=[signal("c"),signal("b"),signal("a")];
  assert.deepEqual(allocate(rows),allocate(rows.toReversed()));
  assert.deepEqual(allocate(rows).candidate_allocations[0].signal_ids,["a"]);
});

test("opposite directions never create simultaneous long and short targets", () => {
  const short=signal("short",{confidence:0.8,direction:"SHORT",proposed_trade_plan:{
    entry:{price:500},stop:{price:502},targets:[{price:497}],order_type:"LIMIT"}});
  const result=allocate([signal("long"),short]);
  assert.equal(result.candidate_allocations.length,1);
  assert.equal(result.candidate_allocations[0].net_direction,"SHORT");
  assert.equal(result.rejected_signals[0].signal_id,"long");
});

test("a higher confidence incomplete plan cannot displace a complete proposal", () => {
  const result=allocate([signal("bad",{confidence:1,proposed_trade_plan:null}),signal("good")]);
  assert.deepEqual(result.candidate_allocations[0].signal_ids,["good"]);
  assert.equal(result.rejected_signals[0].issues[0].code,"PORTFOLIO_TRADE_PLAN_INCOMPLETE");
});

test("versioned plans are revalidated and inconsistent contracts fail closed", () => {
  const canonical = normalizeProposedTradePlanV1({ instrument: "ZW", direction: "LONG",
    entry: { price: 500 }, stop: { price: 498 }, targets: [{ price: 503 }], order_type: "LIMIT" });
  const wrongVersion = { ...canonical.proposed_trade_plan, schema_version: "strategy_signal_trade_plan_v2" };
  const staleHash = { ...canonical.proposed_trade_plan, stop: { availability: "KNOWN", price: 499 } };
  const forgedEconomics = { ...canonical.economics, risk_per_contract: 1 };
  const forgedPlan = { ...canonical.proposed_trade_plan, economics: forgedEconomics };
  const result = allocate([
    signal("wrong-version", { confidence: 1, proposed_trade_plan: wrongVersion,
      trade_plan_economics: canonical.economics }),
    signal("stale-hash", { confidence: 0.9, proposed_trade_plan: staleHash,
      trade_plan_economics: canonical.economics }),
    signal("forged-economics", { confidence: 0.8, proposed_trade_plan: forgedPlan }),
    signal("good"),
  ]);
  assert.deepEqual(result.candidate_allocations[0].signal_ids, ["good"]);
  assert.deepEqual(result.rejected_signals.map(item => item.issues[0].code),
    ["PORTFOLIO_TRADE_PLAN_INCOMPLETE", "PORTFOLIO_TRADE_PLAN_INCOMPLETE",
      "PORTFOLIO_TRADE_PLAN_INCOMPLETE"]);
});

test("strict selection deduplicates identical signal ids and rejects divergent duplicates", () => {
  const identical = signal("same");
  const deduplicated = allocate([identical, structuredClone(identical)]);
  assert.equal(deduplicated.candidate_allocations[0].proposed_size, 1);
  assert.equal(deduplicated.rejected_signals.length, 0);

  const divergent = [signal("collision", { confidence: 0.6 }), signal("collision", { confidence: 0.9 })];
  const rejected = allocate(divergent);
  assert.deepEqual(rejected, allocate(divergent.toReversed()));
  assert.equal(rejected.candidate_allocations.length, 0);
  assert.equal(rejected.rejected_signals[0].issues[0].code, "PORTFOLIO_DUPLICATE_SIGNAL_DIVERGENT");
  assert.equal(rejected.rejected_signals[0].issues[0].duplicate_count, 2);
  assert.equal(rejected.rejected_signals[0].issues[0].signal_hashes.length, 2);
});

test("account and instrument groups remain independent", () => {
  const result=allocate([signal("a"),signal("b",{account_id:"second"}),signal("c",{instrument:"ZC"})]);
  assert.equal(result.candidate_allocations.length,3);
});

test("unsupported selection policy fails closed, while legacy netting remains unchanged", () => {
  const rows=[signal("a"),signal("b")];
  assert.equal(allocate(rows,"NOT_REAL").candidate_allocations.length,0);
  assert.equal(allocate(rows,"NET_BY_DIRECTION").candidate_allocations[0].proposed_size,2);
  const duplicate = signal("legacy-duplicate");
  assert.equal(allocate([duplicate, structuredClone(duplicate)],"NET_BY_DIRECTION")
    .candidate_allocations[0].proposed_size,2);
});
