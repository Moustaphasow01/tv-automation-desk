import test from "node:test";
import assert from "node:assert/strict";
import { createOosRuntimeContracts } from "../index.js";
import { sha256, jsonBytes } from "../src/adapter/artifact-archive.js";
import { readRuntimeContractSource, pineSourceFacts } from "../src/adapter/runtime-contract-source.js";
import { validateSmc3Syntax } from "../src/domain/smc3-syntax.js";

const contracts = async () => {
  const basis = await readRuntimeContractSource();
  return createOosRuntimeContracts({ readInstalled: async () => structuredClone(basis.snapshot.installed) });
};
const validate = example => validateSmc3Syntax({ ...example, schema: "SMC3", engine_version: "V3.9.8", plan_sha256: sha256(example.plan_text) });

test("every published record has a complete indexed definition and a currently valid syntax example", async () => {
  const contract = await (await contracts()).smc3Contract();
  assert.equal(Object.keys(contract.records).length, 18);
  for (const example of contract.valid_examples) {
    assert.equal(validate(example).syntax_valid, true, example.record_type);
    const spec = contract.records[example.record_type];
    assert.equal(spec.field_count, example.record_text.split("|").length);
    assert.deepEqual(spec.fields.map(field => field.index), Array.from({ length: spec.field_count }, (_, index) => index));
    assert.equal(spec.example, example.record_text);
    const invalid = { ...example, plan_text: example.plan_text.replace(example.record_text, example.record_text + "|EXTRA") };
    assert.throws(() => validate(invalid), { code: "PLAN_FIELD_COUNT" }, example.record_type);
  }
});

test("all advertised condition operators pass actual validator and constrain TF/count/from_step correctly", async () => {
  const contract = await (await contracts()).smc3Contract(), basis = contract.valid_examples.find(item => item.record_type === "STEP");
  for (const op of contract.enums.condition) {
    const zoned = ["TOUCH_ZONE", "SWEEP_HIGH", "SWEEP_LOW", "RETEST_UP", "RETEST_DOWN"].includes(op);
    const line = `STEP|S1|${op}|15|${zoned ? "-|99|100" : "100|-|-"}|1|1|0`;
    assert.equal(validate({ ...basis, plan_text: basis.plan_text.replace(basis.record_text, line) }).syntax_valid, true);
  }
  for (const invalid of ["STEP|S1|RETEST_UP|60|-|99|100|1|1|0", "STEP|S1|CROSS_UP|15|100|-|-|1|2|0",
    "STEP|S1|CLOSE_GTE|15|100|-|-|1|1|1"]) {
    assert.throws(() => validate({ ...basis, plan_text: basis.plan_text.replace(basis.record_text, invalid) }));
  }
});

test("constraints derive numbers from actual Pine constants and active installed inputs, never an old analyst policy", async () => {
  const basis = await readRuntimeContractSource(), facts = pineSourceFacts(basis);
  const contract = await (await contracts()).engineConstraints();
  assert.equal(contract.engine_version, `V${facts.version}`); assert.equal(contract.execution_timeframe, `${facts.execution_period}m`);
  assert.equal(contract.intrabar_timeframe, `${facts.intrabar_period}m`); assert.equal(contract.timezone, facts.timezone);
  assert.equal(contract.rr.minimum_gross, facts.rr_gross); assert.equal(contract.rr.minimum_net, facts.rr_net);
  assert.equal(contract.entry_window.start, facts.entry_start); assert.equal(contract.entry_window.end, facts.entry_end);
  assert.equal(contract.stop.minimum_ticks, facts.inputs.minStopTicks.value);
  assert.equal(contract.stop.atr_min, facts.inputs.minStopAtr.value); assert.equal(contract.stop.atr_max, facts.inputs.maxStopAtr.value);
  assert.equal(contract.stop.dynamic_buffer_atr, facts.stop_atr_buffer);
  assert.equal(contract.costs.max_cost_to_risk, facts.inputs.maxCostRisk.value);
  assert.equal(contract.orders.limit_penetration_ticks, facts.inputs.limitPenTicks.value);
  assert.equal(contract.capacities.plan_text_characters, facts.max_text);
  assert.equal(contract.capacities.scenarios_business_limit, null);
  assert.match(basis.source, /s\.rr < 2 - 1e-8/);
  assert.ok(contract.filters.includes("RR_NET")); assert.ok(contract.filters.includes("OPEN_RR_COST"));
  for (const evidence of contract.source_evidence) assert.ok(basis.source.replaceAll("\r\n", "\n").includes(evidence.source));
});

test("both hashes verify deterministically and returned objects cannot mutate canonical contracts", async () => {
  const q = await contracts(), first = await q.runtimeContract();
  for (const [contract, ownHash] of [[first.engine_constraints, "engine_constraints_sha256"], [first.smc3_contract, "contract_sha256"]]) {
    const { [ownHash]: hash, ...content } = contract; assert.equal(hash, sha256(jsonBytes(content)));
  }
  first.engine_constraints.rr.minimum_gross = 999;
  first.smc3_contract.records.SCN.fields.pop();
  const second = await q.runtimeContract();
  assert.equal(second.engine_constraints.rr.minimum_gross, 2); assert.equal(second.smc3_contract.records.SCN.field_count, 18);
  assert.equal(second.engine_constraints_sha256, (await q.engineConstraints()).engine_constraints_sha256);
});

test("live metadata drift HALTs without any write; display/plan changes do not change contractual hashes", async () => {
  const basis = await readRuntimeContractSource(), current = structuredClone(basis.snapshot.installed);
  const q = await createOosRuntimeContracts({ readInstalled: async () => current });
  const first = await q.runtimeContract();
  current.values.find(item => item.id === "in_17").value = "AUTO";
  current.values.push({ id: "in_0", value: "POST_CUTOFF_PLAN_SECRET" });
  assert.deepEqual(await q.runtimeContract(), first);
  current.values.find(item => item.id === "in_13").value += 1;
  await assert.rejects(() => q.runtimeContract(), { code: "CONTRACT_DRIFT" });
  current.values.find(item => item.id === "in_13").value -= 1; current.pine.digest = "changed-source";
  await assert.rejects(() => q.smc3Contract(), { code: "CONTRACT_DRIFT" });
});

test("read path excludes market, previous plan, replay, logs and results even if provider includes them", async () => {
  const basis = await readRuntimeContractSource(), installed = structuredClone(basis.snapshot.installed);
  for (const name of ["plan", "prices", "logs", "replay", "results"]) installed[name] = "FORBIDDEN_POST_CUTOFF_SENTINEL";
  const q = await createOosRuntimeContracts({ readInstalled: async () => installed });
  assert.doesNotMatch(JSON.stringify(await q.runtimeContract()), /FORBIDDEN_POST_CUTOFF_SENTINEL/);
});
