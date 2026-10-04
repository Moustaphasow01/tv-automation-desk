import test from "node:test";
import assert from "node:assert/strict";
import { ResearchCycle } from "../src/application/research-cycle.js";
import { ResearchHypotheses } from "../src/application/research-hypotheses.js";
import { ResearchDiscovery } from "../src/application/research-discovery.js";
import { ResearchApi } from "../src/application/research-api.js";
import { ResearchRunner } from "../src/application/research-runner.js";
import { createScenarioSelfAudit } from "../src/domain/scenario-self-audit.js";
import { validateResearcherAnswer } from "../src/domain/research-role-contract.js";
import { callResearchModel } from "../src/application/research-model-call.js";
import { fingerprint, clock, identity, packet, MemoryFixture, unknownAnswers } from "./research-fixtures.js";

const proposal = { description: "Synthetic exploratory test observation", target_component: "CONFIRMATION", mechanism: "TEST_ONLY",
  feature_rule: { feature: "confirmation_step_count", operator: "GTE", value: 2 },
  outcome_rule: { metric: "PUBLISHED_REAL_R", operator: "GT", value: 0 }, testable_change: "TEST_NOT_EXECUTABLE",
  expected_benefit: "Unknown", expected_risk: "Unknown", winner_risk: "Unknown" };
async function fixture(real_R = 2) {
  const memory = new MemoryFixture(), observer = { pages: async () => [{ date: identity.date }] };
  const cycle = new ResearchCycle({ memory, observer, fingerprint, clock });
  await memory.beginCycle({ cycle_id: "C", definition: { budget: { maximum_model_calls: 10 } } });
  const trades = real_R === null ? [] : [{ trade_id: "T", real_R }];
  const audit = createScenarioSelfAudit({ identity, packet: packet(), events: [], trades, fingerprint });
  await cycle.save("C", "scenario_audit", audit.case_id, audit);
  const hypotheses = new ResearchHypotheses({ cycle, memory, fingerprint, clock });
  return { memory, cycle, audit, hypotheses };
}

test("a model cannot inject cases and replace persisted historical evidence", async () => {
  const { hypotheses, audit } = await fixture(null);
  const fake = { ...audit, observations: { trades: [{ trade_id: "fabricated", real_R: 10 }] } };
  await assert.rejects(hypotheses.register({ cycle_id: "C", proposal: { ...proposal, cases: [fake] } }), /OUTPUT_FIELDS_INVALID/);
  await assert.rejects(hypotheses.register({ cycle_id: "C", proposal }), /SUPPORT_REQUIRED/);
});
test("unsupported discovery is persisted WEAK and does not permanently trap the cycle", async () => {
  const f = await fixture(null);
  await f.memory.transition({ cycle_id: "C", expected_revision: 0, status: "HYPOTHESIZING" });
  await f.cycle.save("C", "finding", fingerprint("C|DISCOVERY|0"), { proposals: [proposal] });
  const discovery = new ResearchDiscovery({ ...f, model: {}, fingerprint });
  assert.equal((await discovery.discover({ cycle_id: "C" })).status, "COUNTEREXAMPLES");
  const weak = (await f.cycle.all("C", "finding")).find(r => r.payload.reason === "NO_PERSISTED_SUPPORT");
  assert.equal(weak.payload.status, "WEAK");
  assert.equal((await discovery.registerProposal("C", proposal, "0|0")).status, "WEAK");
  assert.equal((await f.cycle.all("C", "hypothesis")).length, 0);
});
test("nested unknown model fields cannot masquerade as FACT_ENGINE or execution authority", async () => {
  const { audit } = await fixture();
  const output = unknownAnswers(); output.answers[0].cases = [{ real_R: 10 }];
  assert.throws(() => validateResearcherAnswer({ output, audit }), /OUTPUT_FIELDS_INVALID/);
  const another = unknownAnswers(); another.hypothesis = { order: "BUY" };
  assert.throws(() => validateResearcherAnswer({ output: another, audit }), /OUTPUT_TYPE_INVALID/);
});
test("identical experiment submission returns original timestamp and one immutable artifact", async () => {
  const f = await fixture(), hypothesis = await f.hypotheses.register({ cycle_id: "C", proposal });
  const protocol = { split: { discovery: [identity.date], validation: ["2026-09-01"], test: ["2026-10-01"] },
    primary_metric: "expectancy_R", stopping_rule: "Fixed preregistered sample", false_discovery_control: "Multiplicity correction declared before collection" };
  const args = { cycle_id: "C", hypothesis_id: hypothesis.hypothesis_id, protocol };
  const first = await f.hypotheses.experiment(args);
  f.hypotheses.clock = () => "2026-10-05T09:00:00Z";
  assert.deepEqual(await f.hypotheses.experiment(args), first);
  const reordered = { false_discovery_control: protocol.false_discovery_control, stopping_rule: protocol.stopping_rule,
    primary_metric: protocol.primary_metric, split: { test: protocol.split.test, validation: protocol.split.validation, discovery: protocol.split.discovery } };
  assert.deepEqual(await f.hypotheses.experiment({ ...args, protocol: reordered }), first);
  assert.equal((await f.cycle.all("C", "experiment")).length, 1);
  assert.equal(first.challenger.executable, false); assert.equal(first.validated_edge, false);
});
test("empty/whitespace experiment rules cannot produce READY_FOR_EXPERIMENT", async () => {
  const f = await fixture(), hypothesis = await f.hypotheses.register({ cycle_id: "C", proposal });
  for (const field of ["primary_metric", "stopping_rule", "false_discovery_control"]) {
    const protocol = { split: { discovery: [identity.date], validation: ["2026-09-01"], test: ["2026-10-01"] },
      primary_metric: "expectancy_R", stopping_rule: "Fixed sample", false_discovery_control: "Predeclared correction", [field]: "   " };
    await assert.rejects(f.hypotheses.experiment({ cycle_id: "C", hypothesis_id: hypothesis.hypothesis_id, protocol }), /PROTOCOL_REQUIRED/);
  }
});
test("a model change inside a research cycle halts rather than silently changing method", async () => {
  const f = await fixture();
  await f.memory.addEvent({ cycle_id: "C", event_id: "old", type: "MODEL_REQUESTED",
    payload: { model: { identifier: "ACTUAL_PREVIOUS_MODEL", reasoning_effort: "xhigh" } } });
  await assert.rejects(callResearchModel({ ...f, fingerprint, model: { analyze: () => assert.fail("must not invoke") },
    cycle: await f.memory.getCycle("C"), requestId: "new", request: { selection: { identifier: "DIFFERENT", reasoning_effort: "xhigh" } } }), /MODEL_DRIFT/);
});
test("complete bounded research cycle persists reviewed dossier without executing a challenger", async () => {
  const f = await fixture();
  f.cycle.observer = { read: async () => ({ index_hash: "corpus" }), pages: async () => [{ date: identity.date }],
    assertCorpus: async () => {}, day: async () => ({ identity, cases: [f.audit], coverage: { scenario_count: 1, observed_attempt_count: 1, expected_attempt_count: 1 } }) };
  const model = { capabilities: async () => [{ identifier: "TEST_MODEL", available: true, reasoning: true,
    reasoning_efforts: ["xhigh"], capability_rank: 1, capability_source: "TEST" }], analyze: async req => ({
    model_identifier: req.selection.identifier, reasoning_effort: "xhigh", output: req.output_schema.properties.answers
      ? unknownAnswers() : req.output_schema.properties.proposals ? { proposals: [proposal] }
        : { verdict: "WEAK", objections: ["Synthetic single-day evidence only"], evidence_refs: ["plan-ref"] } }) };
  f.cycle.model = model; f.hypotheses.model = model;
  const discovery = new ResearchDiscovery({ ...f, model, fingerprint });
  const api = new ResearchApi({ ...f, discovery });
  const cycle = await api.start({ dates: [identity.date], budget: { maximum_model_calls: 3 } });
  assert.equal((await new ResearchRunner({ api }).run({ cycle_id: cycle.cycle_id, maximum_steps: 6 })).state, "COMPLETED");
  const status = await api.status({ cycle_id: cycle.cycle_id });
  assert.equal(status.status, "COMPLETED"); assert.equal(status.model_requests, 3);
  assert.equal(status.reports.scenario_audit, 1); assert.equal(status.reports.critique, 1);
  assert.equal(status.reports.experiment, 0); assert.equal(status.checkpoint.edge_validated, false);
  assert.equal((await api.advance({ cycle_id: cycle.cycle_id })).action, "NO_AUTOMATIC_EXPERIMENT_OR_PROMOTION");
});

test("bounded autonomous runner stops at uncertain model request rather than retrying forever", async () => {
  let calls = 0;
  const api = { status: async () => ({ status: "DIAGNOSING" }), advance: async () => {
    calls++; throw Object.assign(new Error("RESEARCH_MODEL_REQUEST_INDETERMINATE"), { code: "RESEARCH_MODEL_REQUEST_INDETERMINATE" }); } };
  const result = await new ResearchRunner({ api }).run({ cycle_id: "C", maximum_steps: 1000 });
  assert.equal(result.state, "BLOCKED"); assert.equal(calls, 1); assert.equal(result.automatic_paid_retry, false);
});

test("discovery chunks large corpora without dropping scenarios or reusing a model context", async () => {
  const f = await fixture(), seen = [], sizes = [];
  for (let i = 0; i < 205; i++) {
    const audit = { ...f.audit, case_id: fingerprint(`SYNTHETIC_CHUNK_${i}`), scenario_id: `TEST_S${i}` };
    await f.cycle.save("C", "scenario_audit", audit.case_id, audit);
  }
  await f.memory.transition({ cycle_id: "C", expected_revision: 0, status: "HYPOTHESIZING" });
  const model = { capabilities: async () => [{ identifier: "TEST_ONLY", available: true, reasoning: true,
    reasoning_efforts: ["xhigh"], capability_rank: 1, capability_source: "SYNTHETIC" }], analyze: async req => {
    assert.equal(req.session_reuse, "FORBIDDEN"); sizes.push(req.input.cases.length);
    seen.push(...req.input.cases.map(c => c.case_id));
    return { model_identifier: "TEST_ONLY", reasoning_effort: "xhigh", output: { proposals: [] } };
  } };
  const discovery = new ResearchDiscovery({ ...f, model, fingerprint });
  const result = await discovery.discover({ cycle_id: "C" });
  assert.equal(result.checkpoint.cases_compared, 206); assert.equal(result.checkpoint.discovery_chunks, 3);
  assert.equal(new Set(seen).size, 206); assert.ok(sizes.every(n => n <= 100));
  assert.equal(f.memory.events.filter(e => e.type === "MODEL_REQUESTED").length, 3);
});
