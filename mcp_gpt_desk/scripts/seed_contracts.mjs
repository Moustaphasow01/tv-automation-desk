import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { createDeskStoreFromEnv, PACKAGE_ROOT } from "../src/store.js";
import { canonicalSchemaHash } from "../src/desk-contract-service.js";

const CONTRACTS_ROOT = join(PACKAGE_ROOT, "..", "packages", "desk-contracts", "contracts");
const SCHEMAS_ROOT = join(PACKAGE_ROOT, "..", "packages", "desk-contracts", "schemas", "entities");

export const ACTIVE_CONTRACTS = [
  contractSpec("DeskMasterAnalysisContract", "5.4.0", "master-analysis-v5-4.schema.json", {
    expected_hash: "000f5bf0ac0602f5c1fb298350b6a0ce2447abba8112202fef198d37f7e6da7d",
  }),
  contractSpec("DeskHourlyThesisMonitorContract", "2.4.0", "hourly-monitor-v2-4.schema.json", {
    expected_hash: "f3a57d05711d96bc1de73f84fc00e098c07468b7f3aaab279e9dc878d3961f17",
  }),
  contractSpec("DeskExecutionPlanContract", "1.4.0", "execution-plan-v1-4.schema.json", {
    expected_hash: "a1e40d10c891b9f2df47f30b35dd7be7e0f4e59aaecf75d9dbc1f685e207c828",
  }),
  contractSpec("DeskMonitorCommandContract", "1.4.0", "monitor-command-v1-4.schema.json", {
    expected_hash: "aae4dde166a9702fae80a49172afcb950833ab938b2eeaca79f2554275bc5ebb",
  }),
  contractSpec("DeskConditionCatalogContract", "1.2.0", "condition-catalog-v1-2.schema.json", {
    expected_hash: "2af8d5325a0a14a533944a3763b4a288346512c2886441b24a50f1ca2919eb61",
  }),
  contractSpec("DeskFrontProjectionContract", "1.0.0", "desk-front-projection.schema.json", {
    expected_hash: "f1109aa76401e53da560d682ff03fedeef12bc12717c47e67ce2b107ccd399d6",
  }),
  contractSpec("DeskDeterministicExecutionPolicy", "4.3.0", "execution-plan-v1-4.schema.json", {
    expected_hash: "f8861200515007771e9f79dc4bce5e6d908fa8b2444932fa917ab0bd9d3bdc22",
  }),
];

export const LEGACY_CONTRACTS = [
  contractSpec("DeskMasterAnalysisContract", "5.3.0", "master-analysis-v5-3.schema.json", {
    replaced_by: "DeskMasterAnalysisContract_v5_4_0",
    expected_hash: "dba0104015c09da8d3f95ee5e295efba17a88b224ff76c589be576b4e7036c86",
  }),
  contractSpec("DeskHourlyThesisMonitorContract", "2.3.0", "hourly-monitor-v2-3.schema.json", {
    replaced_by: "DeskHourlyThesisMonitorContract_v2_4_0",
    expected_hash: "94001989fe1a91b69c26321c65f14bd957d51fee38875c4a2c4a0127ca57e743",
  }),
  contractSpec("DeskExecutionPlanContract", "1.3.0", "execution-plan-v1-3.schema.json", {
    replaced_by: "DeskExecutionPlanContract_v1_4_0",
    expected_hash: "de2512c53637e31983a4502d9e26cb5edb99d3479c1359c3b5e7de8df446cab3",
  }),
  contractSpec("DeskMonitorCommandContract", "1.3.0", "monitor-command-v1-3.schema.json", {
    replaced_by: "DeskMonitorCommandContract_v1_4_0",
    expected_hash: "c083ea2b6051cef9ca82c74d7e074ae6669d62f8282a362e77d569ecf48ecb36",
  }),
  contractSpec("DeskDeterministicExecutionPolicy", "4.2.0", "execution-plan-v1-2.schema.json", {
    replaced_by: "DeskDeterministicExecutionPolicy_v4_3_0",
    expected_hash: "5118ad4fa7d0239662157064701f1c7a8611b0fd52cb3e22a4f0cbfb25f18e4c",
  }),
  contractSpec("DeskMasterAnalysisContract", "5.2.0", "master-analysis-v5-2.schema.json", {
    replaced_by: "DeskMasterAnalysisContract_v5_3_0",
    expected_hash: "186c15d03b1c83a9f03f9a1d87c39c3091645693c1ba26818f7691d7a0bcf883",
  }),
  contractSpec("DeskHourlyThesisMonitorContract", "2.2.0", "hourly-monitor-v2-2.schema.json", {
    replaced_by: "DeskHourlyThesisMonitorContract_v2_3_0",
    expected_hash: "bfa857d69792f0d2291f24f7ed2f0bb363f727628d4e947a7b4d3899146989a6",
  }),
  contractSpec("DeskExecutionPlanContract", "1.2.0", "execution-plan-v1-2.schema.json", {
    replaced_by: "DeskExecutionPlanContract_v1_3_0",
    expected_hash: "f303073fdb069afd103e315b82fea15c2feaf8c9141204787f06f10d15079221",
  }),
  contractSpec("DeskMonitorCommandContract", "1.2.0", "monitor-command-v1-2.schema.json", {
    replaced_by: "DeskMonitorCommandContract_v1_3_0",
    expected_hash: "3503a6cba7323cf677604aa99685dc2c25b19e43d82d8edbdd0475d58419b6fd",
  }),
  contractSpec("DeskMasterAnalysisContract", "5.1.0", "master-analysis-v5-1.schema.json", {
    replaced_by: "DeskMasterAnalysisContract_v5_2_0",
    expected_hash: "772065b34de26ffaf9bafaf54bc87bbb73766551c64890444f7b9d6db7828a37",
  }),
  contractSpec("DeskHourlyThesisMonitorContract", "2.1.0", "hourly-monitor-v2-1.schema.json", {
    replaced_by: "DeskHourlyThesisMonitorContract_v2_2_0",
    expected_hash: "c0e66252286628a86c6bdd0f9c3323dadeacc76db1262b6bd053d7429bf778a5",
  }),
  contractSpec("DeskExecutionPlanContract", "1.1.0", "execution-plan-v1-1.schema.json", {
    replaced_by: "DeskExecutionPlanContract_v1_2_0",
    expected_hash: "993fd94b08129165f0de2c88cea0699ebacd1ebf3a7636fd07618301d880acaf",
  }),
  contractSpec("DeskMonitorCommandContract", "1.1.0", "monitor-command-v1-1.schema.json", {
    replaced_by: "DeskMonitorCommandContract_v1_2_0",
    expected_hash: "7b29c0af28be04e4facf8da84691c44c2bb6a3d3acc3b98985dd31b69249c258",
  }),
  contractSpec("DeskConditionCatalogContract", "1.1.0", "condition-catalog-v1-1.schema.json", {
    replaced_by: "DeskConditionCatalogContract_v1_2_0",
    expected_hash: "777913b4f18c5ae2ef62e3bb164bb462bd187d3072f652667b6248d63310c80e",
  }),
  contractSpec("DeskDeterministicExecutionPolicy", "4.1.0", "execution-plan-v1-1.schema.json", {
    replaced_by: "DeskDeterministicExecutionPolicy_v4_2_0",
    expected_hash: "8722e6eba6b83c50aa6f96a7feef1854458987e7bc5b2e4ff76b27ee867b6e9e",
  }),
  contractSpec("DeskMasterAnalysisContract", "4.0.0", "master-analysis.schema.json", {
    replaced_by: "DeskMasterAnalysisContract_v5_0_0",
    expected_hash: "702f9fe325f61fdb53e913592da268b5a4aa2bafe5dd879ece915adc64d1c8e8",
  }),
  contractSpec("DeskMasterAnalysisContract", "5.0.0", "master-analysis-v5.schema.json", {
    replaced_by: "DeskMasterAnalysisContract_v5_1_0",
    expected_hash: "0bbf5334c0e68559edd72f6f309d5fae8cb0a085ca26b4a8158d668e1fca5e6b",
  }),
  contractSpec("DeskHourlyThesisMonitorContract", "1.0.0", "hourly-monitor.schema.json", {
    replaced_by: "DeskHourlyThesisMonitorContract_v2_0_0",
    expected_hash: "d190ae37f96a5fab1fb545c2477816e6f7f252e6e3500f96014b56f7117acc59",
  }),
  contractSpec("DeskHourlyThesisMonitorContract", "2.0.0", "hourly-monitor-v2.schema.json", {
    replaced_by: "DeskHourlyThesisMonitorContract_v2_1_0",
    expected_hash: "8a4fb14b6e7b4bb19a7b3e0cb726b81861dfdc5f3a4fc889a9624c1b09b0ea8c",
  }),
  contractSpec("DeskExecutionPlanContract", "1.0.0", "execution-plan-v1.schema.json", {
    replaced_by: "DeskExecutionPlanContract_v1_1_0",
    expected_hash: "df8ba73e27d8cd0bd4e14094d4b307e6a1ecf346f13ed4d097924514611cb738",
  }),
  contractSpec("DeskMonitorCommandContract", "1.0.0", "monitor-command-v1.schema.json", {
    replaced_by: "DeskMonitorCommandContract_v1_1_0",
    expected_hash: "08757f2e272fea75865a6d02b92502fbb1b3d269eefe0f2043c9a6ab3f5a273c",
  }),
  contractSpec("DeskConditionCatalogContract", "1.0.0", "condition-catalog-v1.schema.json", {
    replaced_by: "DeskConditionCatalogContract_v1_1_0",
    expected_hash: "27008c0ff43fc188b4b24ecea391fca3f2ac0d595db2b8f8da5d345405587e6c",
  }),
  contractSpec("DeskDeterministicExecutionPolicy", "2.0.0", "deterministic-execution-setup-v2.schema.json", {
    replaced_by: "DeskDeterministicExecutionPolicy_v3_0_0",
    expected_hash: "e618e504cfea21454bbadfc20fc6955ed74843b978eb227053fd0e195d7ef740",
  }),
  contractSpec("DeskDeterministicExecutionPolicy", "3.0.0", "deterministic-execution-setup-v3.schema.json", {
    replaced_by: "DeskDeterministicExecutionPolicy_v4_0_0",
    expected_hash: "db71341c38658a9b6924c3077e18d2f0a28cac62bba6395d5892489cca58939c",
  }),
  contractSpec("DeskDeterministicExecutionPolicy", "4.0.0", "execution-plan-v1.schema.json", {
    replaced_by: "DeskDeterministicExecutionPolicy_v4_1_0",
    expected_hash: "57a0e827fb3a8898974650ca2b358930d69ec9f82892766c285c354fc3300399",
  }),
];

function contractSpec(contract_name, schema_version, schema_file, extra = {}) {
  const normalizedVersion = schema_version.replaceAll(".", "_");
  return {
    contract_id: `${contract_name}_v${normalizedVersion}`,
    contract_name,
    schema_version,
    file: `${contract_name}_v${normalizedVersion}.md`,
    schema_file,
    ...extra,
  };
}

async function loadContract(spec, { active }) {
  const [content_markdown, schemaText] = await Promise.all([
    readFile(join(CONTRACTS_ROOT, spec.file), "utf8"),
    readFile(join(SCHEMAS_ROOT, spec.schema_file), "utf8"),
  ]);
  const hash = createHash("sha256").update(content_markdown).digest("hex");
  if (spec.expected_hash && hash !== spec.expected_hash) {
    throw contractSeedIntegrityError("BUNDLED_MARKDOWN_HASH_MISMATCH", spec, {
      expected_hash: spec.expected_hash,
      actual_hash: hash,
    });
  }
  return {
    ...spec,
    file: undefined,
    schema_file: undefined,
    expected_hash: undefined,
    status: active ? "active" : "archived",
    is_active: active,
    content_markdown,
    schema_json: JSON.parse(schemaText),
    hash,
  };
}

export async function seedContractRegistry({ store, load = loadContract } = {}) {
  if (!store) throw new Error("contract_seed_store_required");
  const archived = [];
  const seeded = [];
  const preparedLegacy = await Promise.all(
    LEGACY_CONTRACTS.map(async (spec) => ({
      spec,
      contract: await load(spec, { active: false }),
      existing: await persistedContract(store, spec.contract_id),
    })),
  );
  const preparedActive = await Promise.all(
    ACTIVE_CONTRACTS.map(async (spec) => ({
      spec,
      contract: await load(spec, { active: false }),
      existing: await persistedContract(store, spec.contract_id),
    })),
  );

  // Persisted historical versions are the immutable source of truth. They may
  // predate the bundled snapshot (and the schema_hash field), so validate their
  // own integrity without rewriting or repinning them to newer bundled bytes.
  for (const item of preparedLegacy) {
    if (item.existing) assertPersistedHistoricalContractIntegrity(item.existing, item.contract);
  }
  // Active runtime versions must match the release byte-for-byte before any
  // registry write can occur.
  for (const item of preparedActive) {
    if (item.existing) assertPersistedContractMatches(item.existing, item.contract);
  }

  // Phase 1: persist every version while leaving the active registry untouched.
  for (const { contract, existing } of preparedLegacy) {
    if (existing) {
      archived.push({
        ok: true,
        contract_id: existing.contract_id,
        hash: existing.hash,
        preserved_existing: true,
        bundled_hash: contract.hash,
        schema_hash: existing.schema_hash || canonicalSchemaHash(existing.schema_json || {}),
      });
      continue;
    }
    const saved = await store.saveContract({
      ...contract,
      status: "archived",
      is_active: false,
    });
    archived.push({
      ...saved,
      preserved_existing: false,
      expected_hash: contract.hash,
      schema_hash: canonicalSchemaHash(contract.schema_json),
    });
  }
  for (const { contract, existing } of preparedActive) {
    await store.saveContract({
      ...contract,
      status: existing?.is_active === true ? "active" : "draft",
      is_active: existing?.is_active === true,
    });
  }

  // Phase 2: publish the complete runtime matrix in one persistence transaction.
  if (typeof store.contracts?.activateRuntimeContractMatrix !== "function") {
    throw new Error("contract_seed_atomic_matrix_activation_required");
  }
  const activation = await store.contracts.activateRuntimeContractMatrix();
  seeded.push(...activation.activated);

  const active = await store.getActiveContracts();
  const activeSummary = Object.fromEntries(
    Object.entries(active)
      .filter(([key, value]) => key.endsWith("_contract") && value?.contract_id)
      .map(([key, value]) => [key, {
        contract_id: value.contract_id,
        schema_version: value.schema_version,
        hash: value.hash,
        status: value.status,
        is_active: value.is_active,
      }]),
  );

  return { ok: true, seeded, archived, active: activeSummary };
}

function assertPersistedContractMatches(existing, expected) {
  const actualHash = createHash("sha256").update(existing.content_markdown || "").digest("hex");
  const expectedSchemaHash = canonicalSchemaHash(expected.schema_json || {});
  const actualSchemaHash = canonicalSchemaHash(existing.schema_json || {});
  const mismatches = [];
  if (existing.contract_id !== expected.contract_id) {
    mismatches.push({ field: "contract_id", expected: expected.contract_id, actual: existing.contract_id || null });
  }
  if (existing.contract_name !== expected.contract_name) {
    mismatches.push({ field: "contract_name", expected: expected.contract_name, actual: existing.contract_name || null });
  }
  if (existing.schema_version !== expected.schema_version) {
    mismatches.push({ field: "schema_version", expected: expected.schema_version, actual: existing.schema_version || null });
  }
  if (existing.hash !== expected.hash || actualHash !== expected.hash) {
    mismatches.push({
      field: "markdown_hash",
      expected: expected.hash,
      stored: existing.hash || null,
      actual: actualHash,
    });
  }
  if (actualSchemaHash !== expectedSchemaHash) {
    mismatches.push({
      field: "schema_hash",
      expected: expectedSchemaHash,
      actual: actualSchemaHash,
    });
  }
  if (existing.schema_hash && existing.schema_hash !== expectedSchemaHash) {
    mismatches.push({
      field: "stored_schema_hash",
      expected: expectedSchemaHash,
      actual: existing.schema_hash,
    });
  }
  if (mismatches.length > 0) {
    throw contractSeedIntegrityError("PERSISTED_CONTRACT_IMMUTABLE_MISMATCH", expected, { mismatches });
  }
}

function assertPersistedHistoricalContractIntegrity(existing, expected) {
  const actualHash = createHash("sha256").update(existing.content_markdown || "").digest("hex");
  const actualSchemaHash = canonicalSchemaHash(existing.schema_json || {});
  const mismatches = [];
  if (existing.contract_id !== expected.contract_id) {
    mismatches.push({ field: "contract_id", expected: expected.contract_id, actual: existing.contract_id || null });
  }
  if (existing.contract_name !== expected.contract_name) {
    mismatches.push({ field: "contract_name", expected: expected.contract_name, actual: existing.contract_name || null });
  }
  if (existing.schema_version !== expected.schema_version) {
    mismatches.push({ field: "schema_version", expected: expected.schema_version, actual: existing.schema_version || null });
  }
  // Some pre-PostgreSQL historical imports persisted a normalized/truncated
  // markdown projection while retaining the canonical bundled file hash. That
  // legacy provenance is accepted only when the stored hash is exactly the
  // release-pinned hash; arbitrary or unknown mismatches remain fail-closed.
  if (!existing.hash || (existing.hash !== actualHash && existing.hash !== expected.hash)) {
    mismatches.push({
      field: "markdown_hash",
      expected_actual_content_hash: actualHash,
      expected_bundled_contract_hash: expected.hash,
      stored: existing.hash || null,
    });
  }
  if (existing.schema_hash && existing.schema_hash !== actualSchemaHash) {
    mismatches.push({
      field: "schema_hash",
      expected: actualSchemaHash,
      stored: existing.schema_hash,
    });
  }
  if (mismatches.length > 0) {
    throw contractSeedIntegrityError("PERSISTED_HISTORICAL_CONTRACT_CORRUPT", expected, { mismatches });
  }
}

function contractSeedIntegrityError(code, contract, details) {
  const error = new Error(`contract_seed_integrity_failed:${contract.contract_id}:${code}`);
  error.code = code;
  error.details = {
    contract_id: contract.contract_id,
    contract_name: contract.contract_name,
    schema_version: contract.schema_version,
    ...details,
  };
  return error;
}

async function persistedContract(store, contractId) {
  if (!store.persistence?.getDocument) throw new Error("contract_seed_persistence_read_required");
  return store.persistence.getDocument(DESK_COLLECTIONS.deskContracts, contractId).catch(() => null);
}

async function main() {
  const store = createDeskStoreFromEnv();
  try {
    console.log(JSON.stringify(await seedContractRegistry({ store }), null, 2));
  } finally {
    await store.persistence.close?.();
  }
}

export function isSeedContractsEntrypoint(entryPath = process.argv[1], moduleUrl = import.meta.url) {
  if (!entryPath) return false;
  return portableBasename(entryPath) === portableBasename(fileURLToPath(moduleUrl));
}

function portableBasename(value) {
  return String(value).replaceAll("\\", "/").split("/").at(-1).toLowerCase();
}

if (isSeedContractsEntrypoint()) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
