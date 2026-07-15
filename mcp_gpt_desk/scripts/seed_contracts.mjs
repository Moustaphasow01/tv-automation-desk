import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { createDeskStoreFromEnv, PACKAGE_ROOT } from "../src/store.js";

const CONTRACTS = [
  {
    contract_id: "DeskMasterAnalysisContract_v4_0_0",
    contract_name: "DeskMasterAnalysisContract",
    schema_version: "4.0.0",
    file: "DeskMasterAnalysisContract_v4_0_0.md",
  },
  {
    contract_id: "DeskHourlyThesisMonitorContract_v1_0_0",
    contract_name: "DeskHourlyThesisMonitorContract",
    schema_version: "1.0.0",
    file: "DeskHourlyThesisMonitorContract_v1_0_0.md",
  },
];

async function main() {
  const store = createDeskStoreFromEnv();
  const results = [];

  for (const contract of CONTRACTS) {
    const content_markdown = await readFile(join(PACKAGE_ROOT, "contracts", contract.file), "utf8");
    const hash = createHash("sha256").update(content_markdown).digest("hex");
    const saved = await store.saveContract({
      ...contract,
      status: "active",
      is_active: true,
      content_markdown,
      schema_json: {},
      hash,
    });
    await store.activateContractVersion({
      contract_name: contract.contract_name,
      schema_version: contract.schema_version,
    });
    results.push(saved);
  }

  const active = await store.getActiveContracts();
  console.log(JSON.stringify({
    ok: true,
    seeded: results,
    active: {
      master_contract: {
        contract_id: active.master_contract.contract_id,
        schema_version: active.master_contract.schema_version,
        hash: active.master_contract.hash,
      },
      monitor_contract: {
        contract_id: active.monitor_contract.contract_id,
        schema_version: active.monitor_contract.schema_version,
        hash: active.monitor_contract.hash,
      },
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
