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

  const forced = await store.saveContract({ ...contract, content_markdown: "# Master v9 forced\n", force: true });
  assert.equal(forced.forced, true);
  assert.equal(persistence.count(DESK_COLLECTIONS.deskContractUpdateAudit), 1);

  await store.activateContractVersion({
    contract_name: contract.contract_name,
    schema_version: contract.schema_version,
  });
  const active = await store.getActiveContracts();
  assert.equal(active.master_contract.contract_id, saved.contract_id);
  assert.equal(active.master_contract.status, "active");
  assert.equal(active.master_contract.is_active, true);
  assert.equal(active.monitor_contract.contract_name, "DeskHourlyThesisMonitorContract");
  assert.equal(active.front_projection_contract.contract_name, "DeskFrontProjectionContract");

  await store.archiveContractVersion({
    contract_name: contract.contract_name,
    schema_version: contract.schema_version,
  });
  const archived = await persistence.getDocument(DESK_COLLECTIONS.deskContracts, saved.contract_id);
  assert.equal(archived.status, "archived");
  assert.equal(archived.is_active, false);
});
