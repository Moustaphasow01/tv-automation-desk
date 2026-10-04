import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { ForensicResearchObserver } from "../src/application/forensic-research-observer.js";
import { ResearchCycle } from "../src/application/research-cycle.js";
import { ResearchApi } from "../src/application/research-api.js";
import { ResearchHypotheses } from "../src/application/research-hypotheses.js";
import { createScenarioSelfAudit } from "../src/domain/scenario-self-audit.js";
import { fingerprint, clock, identity, packet, MemoryFixture, unknownAnswers } from "./research-fixtures.js";

const caps = [{ identifier: "EXPOSED_TEST_MODEL", available: true, reasoning: true, capability_rank: 1,
  reasoning_efforts: ["xhigh"], capability_source: "TEST_ONLY" }];
function scenarioReader({ drift = false } = {}) {
  const calls = [], scenarios = Array.from({ length: 8 }, (_, i) => ({ scenario_id: `S${i}`, attempt_count: i ? 0 : 2 }));
  let capReads = 0;
  return { calls, read: async (name, args) => {
    calls.push(name);
    if (name === "get_forensic_capabilities") return { index_hash: drift && ++capReads > 1 ? "changed" : "index" };
    if (name === "get_forensic_index") return { items: [{ ...identity, state: "COMPLETED", scenario_count: 8, attempt_count: 2, forensic_integrity_status: "PASS" }], next_cursor: null };
    if (name === "verify_forensic_integrity") return { status: "PASS" };
    if (name === "list_forensic_scenarios") return { items: scenarios, next_cursor: null };
    if (name === "list_scenario_attempts") return args.scenario_id === "S0" ? { items: [{ attempt: 1 }, { attempt: 2 }], next_cursor: null } : { available: false };
    if (name === "get_scenario_forensic_packet") return packet(args.scenario_id, args.attempt ?? null);
    if (name === "get_forensic_events") return { items: [], next_cursor: null };
    throw new Error(`Forbidden test read ${name}`);
  } };
}
test("observer audits >5 scenarios and ALL episodes, including unobserved scenarios; no commands", async () => {
  const source = scenarioReader(), observer = new ForensicResearchObserver({ readForensic: source.read, fingerprint });
  const result = await observer.day(identity.date, "index");
  assert.equal(result.cases.length, 9); assert.equal(result.coverage.scenario_count, 8);
  assert.deepEqual(result.cases.filter(c => c.scenario_id === "S0").map(c => c.attempt), [1, 2]);
  assert.equal(result.cases.filter(c => c.attempt === null).length, 7);
  assert.ok(source.calls.every(c => !/replay|prepare|submit|result/.test(c)));
  await assert.rejects(observer.read("request_replay", {}), /READ_FORBIDDEN/);
});
test("a corpus generation change during observation fails, never mixes source generations", async () => {
  const source = scenarioReader({ drift: true }), observer = new ForensicResearchObserver({ readForensic: source.read, fingerprint });
  await assert.rejects(observer.day(identity.date, "index"), /CORPUS_DRIFT/);
});
test("impossible dates fail before reading corpus or starting model work", async () => {
  const cycle = new ResearchCycle({ observer: { read: () => assert.fail("must not read") } });
  await assert.rejects(cycle.start({ dates: ["2026-07-32"] }), /DATE_INVALID/);
});
test("cycle observation is resumable/idempotent; metadata never mutates OOS corpus", async () => {
  const source = scenarioReader(), observer = new ForensicResearchObserver({ readForensic: source.read, fingerprint });
  const memory = new MemoryFixture(), cycle = new ResearchCycle({ observer, memory, fingerprint, clock });
  const first = await cycle.start({ dates: [identity.date], budget: { maximum_model_calls: 0 } });
  assert.equal((await cycle.start({ dates: [identity.date], budget: { maximum_model_calls: 0 } })).cycle_id, first.cycle_id);
  const stage = await cycle.observe({ cycle_id: first.cycle_id });
  assert.equal(stage.status, "DIAGNOSING"); assert.equal((await cycle.all(first.cycle_id, "scenario_audit")).length, 9);
  await assert.rejects(cycle.diagnose({ cycle_id: first.cycle_id }), /MODEL_NOT_CONFIGURED/);
});
test("LLM calls journal first, retain provenance, and never reuse a conversation", async () => {
  const memory = new MemoryFixture(), audit = createScenarioSelfAudit({ identity, packet: packet(), events: [], trades: [], fingerprint });
  const model = { capabilities: async () => caps, analyze: async request => {
    assert.equal(request.session_reuse, "FORBIDDEN"); assert.equal(memory.events.at(-1).type, "MODEL_REQUESTED");
    return { output: unknownAnswers(), model_identifier: request.selection.identifier, reasoning_effort: "xhigh" };
  } };
  const cycle = new ResearchCycle({ memory, model, fingerprint, clock });
  await memory.beginCycle({ cycle_id: "C", definition: { budget: { maximum_model_calls: 1 }, prompt_sha256: "prompt" } });
  await memory.transition({ cycle_id: "C", expected_revision: 0, status: "DIAGNOSING" });
  await cycle.save("C", "scenario_audit", audit.case_id, audit);
  assert.equal((await cycle.diagnose({ cycle_id: "C" })).status, "CLUSTERING");
  const finding = (await cycle.all("C", "finding"))[0].payload;
  assert.equal(finding.result.edge_validated, false); assert.equal(finding.model.identifier, "EXPOSED_TEST_MODEL");
  assert.equal(finding.status, "UNREVIEWED");
});
test("timeout/crash after MODEL_REQUESTED cannot silently call the model again or bypass budget", async () => {
  const memory = new MemoryFixture(), audit = createScenarioSelfAudit({ identity, packet: packet(), events: [], trades: [], fingerprint });
  let requests = 0;
  const model = { capabilities: async () => caps, analyze: async () => { requests++; throw new Error("MODEL_TIMEOUT"); } };
  const cycle = new ResearchCycle({ memory, model, fingerprint, clock });
  await memory.beginCycle({ cycle_id: "C", definition: { budget: { maximum_model_calls: 1 } } });
  await memory.transition({ cycle_id: "C", expected_revision: 0, status: "DIAGNOSING" });
  await cycle.save("C", "scenario_audit", audit.case_id, audit);
  await assert.rejects(cycle.diagnose({ cycle_id: "C" }), /MODEL_TIMEOUT/);
  await assert.rejects(cycle.diagnose({ cycle_id: "C" }), /MODEL_REQUEST_INDETERMINATE/); assert.equal(requests, 1);
});
test("research API serializes model work and a completed dossier has no executor", async () => {
  const memory = new MemoryFixture(); await memory.beginCycle({ cycle_id: "C", definition: {} });
  await memory.transition({ cycle_id: "C", expected_revision: 0, status: "EXPERIMENT_READY" });
  const api = new ResearchApi({ memory, cycle: { all: async () => [] } });
  assert.equal((await api.advance({ cycle_id: "C" })).action, "NO_AUTOMATIC_EXPERIMENT_OR_PROMOTION");
  assert.equal((await api.status({ cycle_id: "C" })).broker_capability, false);
});
test("recurring hypothesis deduplicates without rewriting prior discovery or rejected memory", async () => {
  const memory = new MemoryFixture(), cycle = new ResearchCycle({ memory, fingerprint, clock });
  const audit = createScenarioSelfAudit({ identity, packet: packet(), events: [], trades: [{ trade_id: "T", real_R: 2 }], fingerprint });
  await memory.beginCycle({ cycle_id: "C", definition: {} }); await cycle.save("C", "scenario_audit", audit.case_id, audit);
  const ledger = new ResearchHypotheses({ cycle, memory, fingerprint, clock });
  const proposal = { description: "Synthetic test observation only", mechanism: "TEST_ONLY", target_component: "CONFIRMATION",
    feature_rule: { feature: "confirmation_step_count", operator: "GTE", value: 2 },
    outcome_rule: { metric: "PUBLISHED_REAL_R", operator: "GT", value: 0 }, expected_risk: "Unknown", winner_risk: "Unknown", testable_change: "Not executable" };
  const first = await ledger.register({ cycle_id: "C", proposal });
  const again = await ledger.register({ cycle_id: "C", proposal });
  assert.equal(again.already_tested_or_registered, true); assert.equal(again.hypothesis_id, first.hypothesis_id);
});
test("domain/application cannot import trading runtimes, old analytical policies or filesystem/provider", async () => {
  for (const layer of ["domain", "application"]) for (const name of await readdir(new URL(`../src/${layer}/`, import.meta.url))) {
    const text = await readFile(new URL(`../src/${layer}/${name}`, import.meta.url), "utf8");
    const imports = text.match(/(?:import|from)\s+["'][^"']+["']/g) ?? [];
    assert.ok(imports.every(i => !/node:|Master|Monitor|AV4|strategy|risk|replay|codex|tradingview|pg["']/.test(i)), name);
  }
});
