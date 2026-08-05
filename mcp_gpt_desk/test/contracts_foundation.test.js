import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";
import {
  getEntityContractDefinition,
  getCatalog,
  getEntitySchema,
  listActiveEntityContracts,
  registry,
} from "@tv-automation/desk-contracts";

const Ajv2020 = Ajv2020Module.default || Ajv2020Module;

const runtimeContractVersions = {
  master_contract: ["DeskMasterAnalysisContract_v5_4_0", "5.4.0", "master-analysis-v5-4.schema.json"],
  monitor_contract: ["DeskHourlyThesisMonitorContract_v2_4_0", "2.4.0", "hourly-monitor-v2-4.schema.json"],
  execution_plan_contract: ["DeskExecutionPlanContract_v1_4_0", "1.4.0", "execution-plan-v1-4.schema.json"],
  monitor_command_contract: ["DeskMonitorCommandContract_v1_4_0", "1.4.0", "monitor-command-v1-4.schema.json"],
  condition_catalog_contract: ["DeskConditionCatalogContract_v1_2_0", "1.2.0", "condition-catalog-v1-2.schema.json"],
  execution_policy_contract: ["DeskDeterministicExecutionPolicy_v4_3_0", "4.3.0", "execution-plan-v1-4.schema.json"],
  front_projection_contract: ["DeskFrontProjectionContract_v1_0_0", "1.0.0", "desk-front-projection.schema.json"],
};

const immutableLegacyMarkdownHashes = {
  DeskMasterAnalysisContract_v5_0_0: "0bbf5334c0e68559edd72f6f309d5fae8cb0a085ca26b4a8158d668e1fca5e6b",
  DeskHourlyThesisMonitorContract_v2_0_0: "8a4fb14b6e7b4bb19a7b3e0cb726b81861dfdc5f3a4fc889a9624c1b09b0ea8c",
  DeskExecutionPlanContract_v1_0_0: "df8ba73e27d8cd0bd4e14094d4b307e6a1ecf346f13ed4d097924514611cb738",
  DeskMonitorCommandContract_v1_0_0: "08757f2e272fea75865a6d02b92502fbb1b3d269eefe0f2043c9a6ab3f5a273c",
  DeskConditionCatalogContract_v1_0_0: "27008c0ff43fc188b4b24ecea391fca3f2ac0d595db2b8f8da5d345405587e6c",
  DeskDeterministicExecutionPolicy_v4_0_0: "57a0e827fb3a8898974650ca2b358930d69ec9f82892766c285c354fc3300399",
};

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
  assert.equal(registry.registry_version, "3.1.0");
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

test("runtime registry pins only the immutable V5.4 contract matrix", async () => {
  for (const [slot, [contractId, version, schemaFile]] of Object.entries(runtimeContractVersions)) {
    const entry = registry.active_contracts[slot];
    assert.equal(entry.contract_id, contractId, slot);
    assert.equal(entry.schema_version, version, slot);
    assert.equal(entry.schema_path, `schemas/entities/${schemaFile}`, slot);
    assert.equal(entry.status, "active", slot);
    assert.equal(entry.runtime_exposed, true, slot);
    const markdown = await readFile(
      new URL(`../../packages/desk-contracts/${entry.markdown_path}`, import.meta.url),
    );
    assert.equal(createHash("sha256").update(markdown).digest("hex"), entry.hash, slot);
  }
});

test("V5.0/V2.0/V1.0/V4.0 Markdown remains byte-identical and registered as legacy", async () => {
  const legacyEntries = Object.values(registry.legacy_contracts);
  for (const [contractId, expectedHash] of Object.entries(immutableLegacyMarkdownHashes)) {
    const entry = legacyEntries.find((candidate) => candidate.contract_id === contractId);
    assert.ok(entry, contractId);
    assert.equal(entry.hash, expectedHash, contractId);
    assert.equal(entry.status, "archived", contractId);
    assert.equal(entry.runtime_exposed, false, contractId);
    const bytes = await readFile(
      new URL(`../../packages/desk-contracts/${entry.markdown_path}`, import.meta.url),
    );
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash, contractId);
  }
});

test("V5.4 schemas and condition catalog expose the new immutable pins", () => {
  const master = getEntitySchema("master-analysis-v5-4.schema.json");
  const monitor = getEntitySchema("hourly-monitor-v2-4.schema.json");
  const plan = getEntitySchema("execution-plan-v1-4.schema.json");
  const command = getEntitySchema("monitor-command-v1-4.schema.json");
  const compiledPlan = getEntitySchema("compiled-execution-plan-v1-4.schema.json");
  const compiledCommand = getEntitySchema("compiled-monitor-command-v1-4.schema.json");
  const catalog = getCatalog("condition-catalog-v1-2.json");

  assert.equal(master.version, "5.4.0");
  assert.equal(monitor.version, "2.4.0");
  assert.equal(plan.version, "1.4.0");
  assert.equal(command.version, "1.4.0");
  assert.equal(catalog.schema_version, "1.2.0");
  assert.equal(catalog.catalog_id, "condition_catalog_v1_2");
  assert.equal(compiledPlan.properties.schema_version.const, "deterministic_execution_plan_v1_4");
  assert.equal(compiledPlan.properties.compiler_version.const, "1.4.0");
  assert.equal(compiledPlan.$defs.policy.properties.policy_version.const, "1.2.0");
  assert.equal(compiledCommand.properties.schema_version.const, "desk_monitor_command_v1_4");
  assert.equal(compiledCommand.properties.compiler_version.const, "1.4.0");
});

test("condition catalog artifacts are byte-pinned for active and legacy contract lines", async () => {
  const catalogEntries = [
    registry.active_contracts.condition_catalog_contract,
    registry.legacy_contracts.condition_catalog_contract_v1_0,
  ];
  for (const entry of catalogEntries) {
    const bytes = await readFile(
      new URL(`../../packages/desk-contracts/${entry.catalog_path}`, import.meta.url),
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      entry.catalog_hash,
      entry.contract_id,
    );
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
