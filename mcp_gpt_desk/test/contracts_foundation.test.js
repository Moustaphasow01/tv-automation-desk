import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";
import {
  getEntityContractDefinition,
  getEntitySchema,
  listActiveEntityContracts,
  registry,
} from "@tv-automation/desk-contracts";

const Ajv2020 = Ajv2020Module.default || Ajv2020Module;

const foundationContracts = [
  {
    key: "decision_audit_contract",
    schemaFile: "decision-audit.schema.json",
    exampleFile: "decision-audit.example.json",
    status: "active",
  },
  {
    key: "simulation_run_contract",
    schemaFile: "simulation-run.schema.json",
    exampleFile: "simulation-run.example.json",
    status: "active",
  },
  {
    key: "simulation_step_contract",
    schemaFile: "simulation-step.schema.json",
    exampleFile: "simulation-step.example.json",
    status: "active",
  },
  {
    key: "worker_mission_contract",
    schemaFile: "worker-mission.schema.json",
    exampleFile: "worker-mission.example.json",
    status: "active",
  },
  {
    key: "dashboard_state_contract",
    schemaFile: "dashboard-state.schema.json",
    exampleFile: "dashboard-state.example.json",
    status: "active",
    runtimeExposed: false,
  },
  {
    key: "front_projection_contract",
    schemaFile: "desk-front-projection.schema.json",
    exampleFile: "desk-front-projection.example.json",
    status: "active",
    runtimeExposed: true,
  },
];

function compile(schemaFile) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.compile(getEntitySchema(schemaFile));
}

async function loadExample(fileName) {
  const url = new URL(`../../packages/desk-contracts/examples/${fileName}`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

test("contracts registry declares the active entity lifecycle without exposing runtime tools", () => {
  const validate = compile("contract-registry.schema.json");
  assert.equal(validate(registry), true, JSON.stringify(validate.errors));
  assert.equal(registry.registry_version, "2.0.0");
  assert.equal(registry.lifecycle_policy.runtime_exposed, "all_active_contracts");

  for (const contract of foundationContracts) {
    const entry = registry.entity_contracts[contract.key];
    assert.ok(entry, `${contract.key} must be registered`);
    assert.equal(entry.schema_path, `schemas/entities/${contract.schemaFile}`);
    assert.equal(entry.example_path, `examples/${contract.exampleFile}`);
    assert.equal(entry.status, contract.status);
    assert.equal(entry.runtime_exposed, contract.runtimeExposed ?? false);
  }
});

test("active entity contracts are discoverable through the package runtime registry", () => {
  const active = listActiveEntityContracts();
  assert.equal(active.length, foundationContracts.length);

  for (const contract of foundationContracts) {
    const fromKey = getEntityContractDefinition(contract.key);
    const fromName = getEntityContractDefinition(fromKey.contract_name);
    assert.equal(fromKey.status, "active");
    assert.equal(fromKey.runtime_exposed, contract.runtimeExposed ?? false);
    assert.equal(fromKey.schema.title, fromKey.contract_name);
    assert.deepEqual(fromName.schema, fromKey.schema);
    assert.ok(active.find((entry) => entry.key === contract.key), `${contract.key} must be listed as active`);
  }
});

test("foundation contract examples validate against their schemas", async () => {
  for (const contract of foundationContracts) {
    const validate = compile(contract.schemaFile);
    const example = await loadExample(contract.exampleFile);
    assert.equal(validate(example), true, `${contract.schemaFile}: ${JSON.stringify(validate.errors)}`);
  }
});

test("Master and Monitor entity schemas accept the shared front projection contract", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(getEntitySchema("desk-front-projection.schema.json"));
  const projection = await loadExample("desk-front-projection.example.json");
  const validateMaster = ajv.compile(getEntitySchema("master-analysis.schema.json"));
  const validateMonitor = ajv.compile(getEntitySchema("hourly-monitor.schema.json"));

  assert.equal(validateMaster({
    contract_hash: "master-hash",
    pack_id: "pack-1",
    date: "2026-07-14",
    session: "asia_open",
    created_at_paris: "2026-07-14T08:00:00+02:00",
    full_analysis: {},
    front_projection: projection,
  }), true, JSON.stringify(validateMaster.errors));
  assert.equal(validateMonitor({
    contract_hash: "monitor-hash",
    timestamp_paris: "2026-07-14T08:15:00+02:00",
    linked_master_analysis_id: "master-1",
    linked_active_thesis_id: "thesis-1",
    monitor_decision: {},
    thesis_health_score: {},
    front_projection: projection,
  }), true, JSON.stringify(validateMonitor.errors));
});

test("simulation run requires a cutoff envelope", () => {
  const validate = compile("simulation-run.schema.json");
  const bad = {
    simulation_id: "sim_missing_cutoff",
    date: "2026-07-02",
    session: "asia_open",
    timezone: "Europe/Paris",
    mode: "simulation",
    status: "draft",
    source_pack_id: "2026-07-02_asia_open",
    current_cutoff_paris: "2026-07-02T10:15:00+02:00",
    created_at_paris: "2026-07-02T00:00:00+02:00",
    step_ids: [],
    decision_ids: [],
    audit_ids: [],
  };

  assert.equal(validate(bad), false);
});

test("simulation step requires an audit reference", () => {
  const validate = compile("simulation-step.schema.json");
  const bad = {
    step_id: "step_missing_audit",
    simulation_id: "sim_2026-07-02_asia_open_01",
    step_index: 1,
    step_type: "next_15m",
    status: "applied",
    started_at_paris: "2026-07-02T10:00:00+02:00",
    ended_at_paris: "2026-07-02T10:15:00+02:00",
    data_cutoff_paris: "2026-07-02T10:15:00+02:00",
    available_data_until: "2026-07-02T10:15:00+02:00",
    visible_dataset_refs: [],
    blocked_dataset_refs: [],
    action: { type: "wait" },
  };

  assert.equal(validate(bad), false);
});

test("worker mission requires expiration", () => {
  const validate = compile("worker-mission.schema.json");
  const bad = {
    mission_id: "mission_missing_expiration",
    objective: "Observe a setup.",
    allowed_window: {
      start_paris: "2026-07-02T10:00:00+02:00",
      end_paris: "2026-07-02T11:00:00+02:00",
      timezone: "Europe/Paris",
    },
    required_gates: [],
    dod: [],
    forbidden_actions: [],
    risk_rules: [],
    escalation_rules: [],
    status: "draft",
  };

  assert.equal(validate(bad), false);
});

test("dashboard state rejects unknown screens", () => {
  const validate = compile("dashboard-state.schema.json");
  const bad = {
    state_id: "state_unknown_screen",
    screen_id: "unknown_screen",
    as_of_paris: "2026-07-02T10:15:00+02:00",
    source_modules: [],
    required_data_status: [],
    audit_requirement: "blocking",
    refresh_rule: "manual",
  };

  assert.equal(validate(bad), false);
});
