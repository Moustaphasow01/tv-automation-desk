import assert from "node:assert/strict";
import test from "node:test";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { FixedClock } from "@tv-automation/desk-time";
import { createTestDeskStore } from "./support/test-desk-store.js";

const clock = new FixedClock(Date.parse("2026-07-15T12:00:00.000Z"));

test("contract service resolves bundled contracts through PersistentDeskStore", async () => {
  const { store } = createTestDeskStore({ clock });

  const active = await store.getActiveContracts();

  assert.equal(active.ok, true);
  assert.equal(active.source, "bundled_contracts");
  assert.equal(active.master_contract.contract_name, "DeskMasterAnalysisContract");
  assert.equal(active.monitor_contract.contract_name, "DeskHourlyThesisMonitorContract");
  assert.equal(active.front_projection_contract.contract_name, "DeskFrontProjectionContract");
  assert.equal(
    active.master_contract.schema_json.$id,
    "https://tv-automation.local/contracts/master-analysis-v5-4.schema.json",
  );
  assert.notDeepEqual(active.master_contract.schema_json, {});
  assert.match(active.master_contract.schema_hash, /^[a-f0-9]{64}$/);
});

test("contract service rejects a supplied id that disagrees with name and version", async () => {
  const { store } = createTestDeskStore({ clock });
  await assert.rejects(
    store.saveContract({
      contract_id: "DeskMasterAnalysisContract_v5_1_0",
      contract_name: "DeskMasterAnalysisContract",
      schema_version: "9.9.9",
      content_markdown: "# Mismatched identity\n",
      schema_json: {},
    }),
    (error) => error?.code === "CONTRACT_ID_MISMATCH",
  );
});

test("contract service protects versions and keeps activation readable with bundled fallbacks", async () => {
  const { store, persistence } = createTestDeskStore({ clock });
  const contract = {
    contract_name: "DeskMasterAnalysisContract",
    schema_version: "9.0.0",
    status: "draft",
    is_active: false,
    content_markdown: "# Master v9\n",
    schema_json: {},
  };

  const saved = await store.saveContract(contract);
  assert.equal(saved.contract_id, "DeskMasterAnalysisContract_v9_0_0");
  assert.equal(saved.forced, false);

  await assert.rejects(
    store.saveContract({ ...contract, content_markdown: "# Changed without force\n" }),
    /contract_version_immutable/,
  );
  await assert.rejects(
    store.saveContract({ ...contract, schema_json: { changed: true } }),
    /contract_version_immutable/,
  );

  const reordered = {
    ...contract,
    schema_json: { nested: { beta: 2, alpha: 1 }, root: true },
    schema_version: "9.1.0",
  };
  const reorderedSaved = await store.saveContract(reordered);
  const reorderedAgain = await store.saveContract({
    ...reordered,
    schema_json: { root: true, nested: { alpha: 1, beta: 2 } },
  });
  assert.equal(reorderedAgain.unchanged_content, true);
  const reorderedDocument = await persistence.getDocument(
    DESK_COLLECTIONS.deskContracts,
    reorderedSaved.contract_id,
  );
  assert.match(reorderedDocument.schema_hash, /^[a-f0-9]{64}$/);

  const forced = await store.saveContract({ ...contract, content_markdown: "# Master v9 forced\n", force: true });
  assert.equal(forced.forced, true);
  assert.equal(persistence.count(DESK_COLLECTIONS.deskContractUpdateAudit), 1);

  await assert.rejects(
    store.activateContractVersion({
      contract_name: contract.contract_name,
      schema_version: contract.schema_version,
    }),
    (error) => error?.code === "RUNTIME_CONTRACT_ACTIVATION_FORBIDDEN",
  );
  const active = await store.getActiveContracts();
  assert.equal(active.master_contract.contract_id, "DeskMasterAnalysisContract_v5_4_0");
  assert.equal(active.monitor_contract.contract_id, "DeskHourlyThesisMonitorContract_v2_4_0");
  assert.equal(active.execution_policy_contract.contract_id, "DeskDeterministicExecutionPolicy_v4_3_0");

  await store.archiveContractVersion({
    contract_name: contract.contract_name,
    schema_version: contract.schema_version,
  });
  const archived = await persistence.getDocument(DESK_COLLECTIONS.deskContracts, saved.contract_id);
  assert.equal(archived.status, "archived");
  assert.equal(archived.is_active, false);
});

test("activating a contract archives every persisted sibling version", async () => {
  const { store, persistence } = createTestDeskStore({ clock });
  const base = {
    contract_name: "DeskMasterAnalysisContract",
    schema_json: {},
  };

  await store.saveContract({
    ...base,
    schema_version: "4.0.0",
    content_markdown: "# Master v4 historical\n",
    status: "active",
    is_active: true,
  });
  await store.saveContract({
    ...base,
    schema_version: "5.4.0",
    content_markdown: "# Master v5.2 runtime\n",
    status: "draft",
    is_active: false,
  });

  const activation = await store.activateContractVersion({
    contract_name: base.contract_name,
    schema_version: "5.4.0",
  });

  assert.deepEqual(activation.archived_contract_ids, ["DeskMasterAnalysisContract_v4_0_0"]);
  const versions = await persistence.listDocuments(DESK_COLLECTIONS.deskContracts, 20);
  const activeVersions = versions.filter((entry) => (
    entry.contract_name === base.contract_name
    && entry.status === "active"
    && entry.is_active === true
  ));
  assert.equal(activeVersions.length, 1);
  assert.equal(activeVersions[0].contract_id, "DeskMasterAnalysisContract_v5_4_0");
  const archived = await persistence.getDocument(
    DESK_COLLECTIONS.deskContracts,
    "DeskMasterAnalysisContract_v4_0_0",
  );
  assert.equal(archived.status, "archived");
  assert.equal(archived.is_active, false);
  assert.equal(archived.replaced_by, "DeskMasterAnalysisContract_v5_4_0");

  const historical = await store.getContract({
    contract_name: "DeskMasterAnalysisContract",
    schema_version: "4.0.0",
  });
  assert.equal(historical.contract_id, "DeskMasterAnalysisContract_v4_0_0");
});
