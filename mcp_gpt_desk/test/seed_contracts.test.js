import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { FixedClock } from "@tv-automation/desk-time";
import { canonicalSchemaHash } from "../src/desk-contract-service.js";
import {
  ACTIVE_CONTRACTS,
  LEGACY_CONTRACTS,
  isSeedContractsEntrypoint,
  seedContractRegistry,
} from "../scripts/seed_contracts.mjs";
import { createTestDeskStore } from "./support/test-desk-store.js";

const clock = new FixedClock(Date.parse("2026-07-30T16:00:00.000Z"));

test("contract seeding saves every version before atomically activating the complete V5.3 matrix", async () => {
  const { store, persistence } = createTestDeskStore({ clock });
  const events = [];
  const originalSaveContract = store.saveContract.bind(store);
  const originalActivateMatrix = store.contracts.activateRuntimeContractMatrix.bind(store.contracts);
  store.saveContract = async (contract) => {
    events.push(`save:${contract.contract_id}`);
    return originalSaveContract(contract);
  };
  store.contracts.activateRuntimeContractMatrix = async () => {
    events.push("activate");
    return originalActivateMatrix();
  };

  const first = await seedContractRegistry({ store });
  assert.equal(first.ok, true);
  assert.equal(first.seeded.length, ACTIVE_CONTRACTS.length);
  assert.equal(first.archived.length, LEGACY_CONTRACTS.length);
  assert.equal(events.filter((event) => event.startsWith("save:")).length, LEGACY_CONTRACTS.length + ACTIVE_CONTRACTS.length);
  assert.equal(events.at(-1), "activate");

  const active = await store.getActiveContracts();
  assert.equal(active.master_contract.contract_id, "DeskMasterAnalysisContract_v5_4_0");
  assert.equal(active.monitor_contract.contract_id, "DeskHourlyThesisMonitorContract_v2_4_0");
  assert.equal(active.execution_plan_contract.contract_id, "DeskExecutionPlanContract_v1_4_0");
  assert.equal(active.monitor_command_contract.contract_id, "DeskMonitorCommandContract_v1_4_0");
  assert.equal(active.condition_catalog_contract.contract_id, "DeskConditionCatalogContract_v1_2_0");
  assert.equal(active.execution_policy_contract.contract_id, "DeskDeterministicExecutionPolicy_v4_3_0");
  assert.equal(active.front_projection_contract.contract_id, "DeskFrontProjectionContract_v1_0_0");

  for (const spec of LEGACY_CONTRACTS) {
    const historical = persistence.peek(DESK_COLLECTIONS.deskContracts, spec.contract_id);
    assert.equal(historical.status, "archived", spec.contract_id);
    assert.equal(historical.is_active, false, spec.contract_id);
    assert.equal(historical.hash, spec.expected_hash, spec.contract_id);
    assert.match(historical.schema_hash, /^[a-f0-9]{64}$/, spec.contract_id);
    assert.equal(historical.replaced_by, spec.replaced_by, spec.contract_id);
  }

  const second = await seedContractRegistry({ store });
  assert.equal(second.ok, true);
  assert.equal(persistence.count(DESK_COLLECTIONS.deskContractUpdateAudit), 0);
  assert.equal((await store.getActiveContracts()).master_contract.contract_id, "DeskMasterAnalysisContract_v5_4_0");
});

test("a late phase-one save failure never invokes matrix activation or replaces the registry", async () => {
  const existingRegistry = { marker: "registry-before-seed" };
  const { store, persistence } = createTestDeskStore({
    clock,
    documents: {
      [DESK_COLLECTIONS.deskContractRegistry]: {
        active_contracts: existingRegistry,
      },
    },
  });
  const originalSaveContract = store.saveContract.bind(store);
  let saveAttempts = 0;
  let activationCalls = 0;
  store.saveContract = async (contract) => {
    saveAttempts += 1;
    if (contract.contract_id === ACTIVE_CONTRACTS.at(-1).contract_id) {
      const error = new Error("simulated_late_phase_one_failure");
      error.code = "SIMULATED_LATE_PHASE_ONE_FAILURE";
      throw error;
    }
    return originalSaveContract(contract);
  };
  store.contracts.activateRuntimeContractMatrix = async () => {
    activationCalls += 1;
    throw new Error("matrix_activation_must_not_run");
  };

  await assert.rejects(
    seedContractRegistry({ store }),
    (error) => error?.code === "SIMULATED_LATE_PHASE_ONE_FAILURE",
  );
  assert.equal(saveAttempts, LEGACY_CONTRACTS.length + ACTIVE_CONTRACTS.length);
  assert.equal(activationCalls, 0);
  assert.deepEqual(
    persistence.peek(DESK_COLLECTIONS.deskContractRegistry, "active_contracts"),
    existingRegistry,
  );
});

test("seed preserves valid persisted historical bytes and schema without repinning them", async () => {
  const legacy = LEGACY_CONTRACTS.find((entry) => entry.contract_id === "DeskMasterAnalysisContract_v5_0_0");
  const content_markdown = "# Historical production V5.0\n";
  const schema_json = { historical: true };
  const persistedLegacy = {
    contract_id: legacy.contract_id,
    contract_name: legacy.contract_name,
    schema_version: legacy.schema_version,
    content_markdown,
    schema_json,
    hash: createHash("sha256").update(content_markdown).digest("hex"),
    schema_hash: canonicalSchemaHash(schema_json),
    status: "active",
    is_active: true,
  };
  const { store, persistence } = createTestDeskStore({
    clock,
    documents: {
      [DESK_COLLECTIONS.deskContracts]: {
        [legacy.contract_id]: persistedLegacy,
      },
    },
  });

  const result = await seedContractRegistry({ store });
  assert.equal(result.ok, true);
  const historical = persistence.peek(DESK_COLLECTIONS.deskContracts, legacy.contract_id);
  assert.equal(historical.content_markdown, persistedLegacy.content_markdown);
  assert.deepEqual(historical.schema_json, persistedLegacy.schema_json);
  assert.equal(historical.hash, persistedLegacy.hash);
  assert.equal(historical.schema_hash, persistedLegacy.schema_hash);
  assert.equal(historical.status, "archived");
  assert.equal(historical.is_active, false);
  assert.equal(
    result.archived.find((item) => item.contract_id === legacy.contract_id)?.preserved_existing,
    true,
  );
  assert.equal(persistence.count(DESK_COLLECTIONS.deskContractUpdateAudit), 0);
});

test("seed rejects internally corrupt persisted historical content before any registry write", async () => {
  const legacy = LEGACY_CONTRACTS.find((entry) => entry.contract_id === "DeskMasterAnalysisContract_v5_0_0");
  const persistedLegacy = {
    contract_id: legacy.contract_id,
    contract_name: legacy.contract_name,
    schema_version: legacy.schema_version,
    content_markdown: "# Corrupt historical production V5.0\n",
    schema_json: { historical: true },
    hash: "invalid-stored-hash",
    status: "archived",
    is_active: false,
  };
  const { store, persistence } = createTestDeskStore({
    clock,
    documents: {
      [DESK_COLLECTIONS.deskContracts]: {
        [legacy.contract_id]: persistedLegacy,
      },
    },
  });

  await assert.rejects(
    seedContractRegistry({ store }),
    (error) => error?.code === "PERSISTED_HISTORICAL_CONTRACT_CORRUPT",
  );
  assert.deepEqual(
    persistence.peek(DESK_COLLECTIONS.deskContracts, legacy.contract_id),
    persistedLegacy,
  );
  assert.equal(persistence.peek(DESK_COLLECTIONS.deskContractRegistry, "active_contracts"), null);
  assert.equal(persistence.count(DESK_COLLECTIONS.deskContractUpdateAudit), 0);
});

test("seed preserves a pre-PostgreSQL historical projection only when its stored hash pins the bundled contract", async () => {
  const legacy = LEGACY_CONTRACTS.find((entry) => entry.contract_id === "DeskMasterAnalysisContract_v4_0_0");
  const persistedLegacy = {
    contract_id: legacy.contract_id,
    contract_name: legacy.contract_name,
    schema_version: legacy.schema_version,
    content_markdown: "# Historical normalized projection\n",
    schema_json: { historical_projection: true },
    hash: legacy.expected_hash,
    status: "archived",
    is_active: false,
  };
  const { store, persistence } = createTestDeskStore({
    clock,
    documents: {
      [DESK_COLLECTIONS.deskContracts]: {
        [legacy.contract_id]: persistedLegacy,
      },
    },
  });

  const result = await seedContractRegistry({ store });
  assert.equal(result.ok, true);
  const historical = persistence.peek(DESK_COLLECTIONS.deskContracts, legacy.contract_id);
  assert.equal(historical.content_markdown, persistedLegacy.content_markdown);
  assert.deepEqual(historical.schema_json, persistedLegacy.schema_json);
  assert.equal(historical.hash, persistedLegacy.hash);
  assert.equal(historical.status, "archived");
  assert.equal(historical.is_active, false);
  assert.equal(persistence.count(DESK_COLLECTIONS.deskContractUpdateAudit), 0);
});

test("seed rejects divergent persisted active V5.3 content before activation", async () => {
  const active = ACTIVE_CONTRACTS.find((entry) => entry.contract_id === "DeskMasterAnalysisContract_v5_4_0");
  const persistedActive = {
    contract_id: active.contract_id,
    contract_name: active.contract_name,
    schema_version: active.schema_version,
    content_markdown: "# Divergent persisted V5.3\n",
    schema_json: { divergent: true },
    hash: "divergent-active-v5-4-hash",
    status: "draft",
    is_active: false,
  };
  const { store, persistence } = createTestDeskStore({
    clock,
    documents: {
      [DESK_COLLECTIONS.deskContracts]: {
        [active.contract_id]: persistedActive,
      },
    },
  });

  await assert.rejects(
    seedContractRegistry({ store }),
    (error) => error?.code === "PERSISTED_CONTRACT_IMMUTABLE_MISMATCH",
  );
  assert.equal(persistence.peek(DESK_COLLECTIONS.deskContractRegistry, "active_contracts"), null);
  assert.equal(persistence.count(DESK_COLLECTIONS.deskContractUpdateAudit), 0);
});

test("atomic matrix activation failure never publishes a partial active registry", async () => {
  const { store, persistence } = createTestDeskStore({ clock });
  persistence.writeDocuments = async () => {
    const error = new Error("simulated_atomic_activation_failure");
    error.code = "SIMULATED_ATOMIC_ACTIVATION_FAILURE";
    throw error;
  };

  await assert.rejects(
    seedContractRegistry({ store }),
    (error) => error?.code === "SIMULATED_ATOMIC_ACTIVATION_FAILURE",
  );
  assert.equal(persistence.peek(DESK_COLLECTIONS.deskContractRegistry, "active_contracts"), null);
  for (const spec of ACTIVE_CONTRACTS) {
    const prepared = persistence.peek(DESK_COLLECTIONS.deskContracts, spec.contract_id);
    assert.equal(prepared.status, "draft", spec.contract_id);
    assert.equal(prepared.is_active, false, spec.contract_id);
  }
});

test("seed entrypoint remains direct through a Windows current junction", () => {
  assert.equal(isSeedContractsEntrypoint(
    "C:\\DeskFutures\\current\\app\\mcp_gpt_desk\\scripts\\seed_contracts.mjs",
    "file:///C:/DeskFutures/releases/2026.07.30-engine-v5-hold.5/app/mcp_gpt_desk/scripts/seed_contracts.mjs",
  ), true);
  assert.equal(isSeedContractsEntrypoint(
    "C:\\DeskFutures\\current\\app\\mcp_gpt_desk\\test\\seed_contracts.test.js",
    "file:///C:/DeskFutures/releases/2026.07.30-engine-v5-hold.5/app/mcp_gpt_desk/scripts/seed_contracts.mjs",
  ), false);
});
