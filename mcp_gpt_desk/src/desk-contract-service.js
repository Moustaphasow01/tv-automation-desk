import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registry as BUNDLED_CONTRACT_REGISTRY } from "@tv-automation/desk-contracts";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { SystemClock } from "@tv-automation/desk-time";
import { stableVNextId } from "./desk-ids.js";

export const CANONICAL_CONTRACTS_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../packages/desk-contracts/contracts",
);
const CANONICAL_SCHEMAS_ROOT = resolve(CANONICAL_CONTRACTS_ROOT, "..", "schemas", "entities");
const ACTIVE_CONTRACTS_ID = "active_contracts";
const COLLECTIONS = DESK_COLLECTIONS;

export const RUNTIME_CONTRACT_MATRIX = Object.freeze({
  master_contract: Object.freeze({ contract_name: "DeskMasterAnalysisContract", schema_version: "5.4.0", contract_id: "DeskMasterAnalysisContract_v5_4_0" }),
  monitor_contract: Object.freeze({ contract_name: "DeskHourlyThesisMonitorContract", schema_version: "2.4.0", contract_id: "DeskHourlyThesisMonitorContract_v2_4_0" }),
  execution_plan_contract: Object.freeze({ contract_name: "DeskExecutionPlanContract", schema_version: "1.4.0", contract_id: "DeskExecutionPlanContract_v1_4_0" }),
  monitor_command_contract: Object.freeze({ contract_name: "DeskMonitorCommandContract", schema_version: "1.4.0", contract_id: "DeskMonitorCommandContract_v1_4_0" }),
  condition_catalog_contract: Object.freeze({ contract_name: "DeskConditionCatalogContract", schema_version: "1.2.0", contract_id: "DeskConditionCatalogContract_v1_2_0" }),
  front_projection_contract: Object.freeze({ contract_name: "DeskFrontProjectionContract", schema_version: "1.0.0", contract_id: "DeskFrontProjectionContract_v1_0_0" }),
  execution_policy_contract: Object.freeze({ contract_name: "DeskDeterministicExecutionPolicy", schema_version: "4.3.0", contract_id: "DeskDeterministicExecutionPolicy_v4_3_0" }),
});

export function assertRuntimeContractMatrix(contracts, { operation = "runtime" } = {}) {
  const mismatches = [];
  for (const [slot, expected] of Object.entries(RUNTIME_CONTRACT_MATRIX)) {
    const actual = contracts?.[slot] || null;
    for (const field of ["contract_name", "schema_version", "contract_id"]) {
      if (String(actual?.[field] || "") !== expected[field]) {
        mismatches.push({ slot, field, expected: expected[field], actual: actual?.[field] || null });
      }
    }
    if (actual?.status !== "active") {
      mismatches.push({ slot, field: "status", expected: "active", actual: actual?.status || null });
    }
    if (actual?.is_active !== true) {
      mismatches.push({ slot, field: "is_active", expected: true, actual: actual?.is_active ?? null });
    }
  }
  if (mismatches.length > 0) {
    const error = new Error(`runtime_contract_matrix_mismatch:${operation}`);
    error.code = "RUNTIME_CONTRACT_MATRIX_MISMATCH";
    error.details = { operation, mismatches };
    throw error;
  }
  return contracts;
}

export class DeskContractService {
  constructor({ persistence, clock = new SystemClock() } = {}) {
    if (!persistence) throw new Error("document_persistence_required");
    this.persistence = persistence;
    this.clock = clock;
  }

  async getActiveContracts() {
    const registry = await this.persistence.getDocument(COLLECTIONS.deskContractRegistry, ACTIVE_CONTRACTS_ID)
      .catch(() => null);
    if (!registry) return bundledActiveContracts(this.clock);
    assertRuntimeContractMatrix(registry, { operation: "get_active_contract_registry" });

    const [master, monitor, executionPlan, monitorCommand, conditionCatalog, frontProjection, executionPolicy] = await Promise.all([
      resolveRegisteredContract(this.persistence, registry.master_contract, "DeskMasterAnalysisContract", "5.4.0", this.clock),
      resolveRegisteredContract(this.persistence, registry.monitor_contract, "DeskHourlyThesisMonitorContract", "2.4.0", this.clock),
      resolveRegisteredContract(this.persistence, registry.execution_plan_contract, "DeskExecutionPlanContract", "1.4.0", this.clock),
      resolveRegisteredContract(this.persistence, registry.monitor_command_contract, "DeskMonitorCommandContract", "1.4.0", this.clock),
      resolveRegisteredContract(this.persistence, registry.condition_catalog_contract, "DeskConditionCatalogContract", "1.2.0", this.clock),
      resolveRegisteredContract(this.persistence, registry.front_projection_contract, "DeskFrontProjectionContract", "1.0.0", this.clock),
      resolveRegisteredContract(this.persistence, registry.execution_policy_contract, "DeskDeterministicExecutionPolicy", "4.3.0", this.clock),
    ]);

    return assertRuntimeContractMatrix({
      ok: true,
      master_contract: master,
      monitor_contract: monitor,
      execution_plan_contract: executionPlan,
      monitor_command_contract: monitorCommand,
      condition_catalog_contract: conditionCatalog,
      front_projection_contract: frontProjection,
      execution_policy_contract: executionPolicy,
    }, { operation: "get_active_contracts" });
  }

  async getContract({ contract_name, schema_version }) {
    return this.persistence.getDocument(COLLECTIONS.deskContracts, contractDocumentId(contract_name, schema_version))
      .catch(async () => {
        const bundled = await bundledContract(contract_name, schema_version, this.clock);
        if (!bundled) throw new Error(`contract_not_found:${contract_name}:${schema_version}`);
        return bundled;
      });
  }

  async listContractVersions({ contract_name }) {
    const docs = await this.persistence.listDocuments(COLLECTIONS.deskContracts, 200).catch(() => []);
    const bundled = await bundledContracts(this.clock);
    const merged = [...docs, ...bundled]
      .filter((contract) => contract.contract_name === contract_name)
      .filter((contract, index, all) => all.findIndex((item) => item.contract_id === contract.contract_id) === index)
      .sort((left, right) => String(right.schema_version).localeCompare(String(left.schema_version)));
    return { ok: true, contract_name, versions: merged.map(compactContract) };
  }

  async saveContract(contract) {
    const doc = normalizeContract(contract, this.clock);
    const existing = await this.persistence.getDocument(COLLECTIONS.deskContracts, doc.contract_id).catch(() => null);
    const contentChanged = contractContentChanged(existing, doc);
    if (existing && contentChanged && contract.force !== true) {
      throw new Error(`contract_version_immutable:${doc.contract_id}:use_force_true_or_new_version`);
    }
    await this.persistence.setDocument(COLLECTIONS.deskContracts, doc.contract_id, preserveContractCreation(doc, existing));
    if (existing && contentChanged && contract.force === true) {
      const audit = contractUpdateAuditDoc({ existing, next: doc, tick: this.clock.now() });
      await this.persistence.setDocument(COLLECTIONS.deskContractUpdateAudit, audit.audit_id, audit);
    }
    return {
      ok: true,
      contract_id: doc.contract_id,
      hash: doc.hash,
      unchanged_content: Boolean(existing && !contentChanged),
      forced: contract.force === true,
    };
  }

  async activateContractVersion({ contract_name, schema_version }) {
    assertRuntimeActivationTarget(contract_name, schema_version);
    const contract = await this.getContract({ contract_name, schema_version });
    const activated = { ...contract, status: "active", is_active: true };
    await this.saveContract(activated);
    const current = await this.getActiveContracts().catch(() => bundledActiveContracts(this.clock));
    const registry = buildContractRegistry({
      master_contract: contract_name === "DeskMasterAnalysisContract" ? activated : current.master_contract,
      monitor_contract: contract_name === "DeskHourlyThesisMonitorContract" ? activated : current.monitor_contract,
      execution_plan_contract: contract_name === "DeskExecutionPlanContract" ? activated : current.execution_plan_contract,
      monitor_command_contract: contract_name === "DeskMonitorCommandContract" ? activated : current.monitor_command_contract,
      condition_catalog_contract: contract_name === "DeskConditionCatalogContract" ? activated : current.condition_catalog_contract,
      front_projection_contract: contract_name === "DeskFrontProjectionContract" ? activated : current.front_projection_contract,
      execution_policy_contract: contract_name === "DeskDeterministicExecutionPolicy" ? activated : current.execution_policy_contract,
    }, this.clock);
    await this.persistence.setDocument(COLLECTIONS.deskContractRegistry, ACTIVE_CONTRACTS_ID, registry);
    const archived_contract_ids = await archiveSiblingContractVersions({
      persistence: this.persistence,
      contractName: contract_name,
      activeContractId: contract.contract_id,
      replacementContractId: contract.contract_id,
      clock: this.clock,
    });
    return {
      ok: true,
      contract_name,
      schema_version,
      contract_id: contract.contract_id,
      archived_contract_ids,
    };
  }

  async activateRuntimeContractMatrix() {
    if (typeof this.persistence.writeDocuments !== "function") {
      const error = new Error("runtime_contract_matrix_atomic_write_required");
      error.code = "RUNTIME_CONTRACT_MATRIX_ATOMIC_WRITE_REQUIRED";
      throw error;
    }
    const slots = await Promise.all(
      Object.entries(RUNTIME_CONTRACT_MATRIX).map(async ([slot, expected]) => {
        const persisted = await this.persistence
          .getDocument(COLLECTIONS.deskContracts, expected.contract_id)
          .catch(() => null);
        if (!persisted) {
          const error = new Error(`runtime_contract_matrix_document_missing:${expected.contract_id}`);
          error.code = "RUNTIME_CONTRACT_MATRIX_DOCUMENT_MISSING";
          throw error;
        }
        const activated = {
          ...persisted,
          status: "active",
          is_active: true,
        };
        return [slot, activated];
      }),
    );
    const activeContracts = Object.fromEntries(slots);
    assertRuntimeContractMatrix(activeContracts, { operation: "activate_runtime_contract_matrix" });

    const tick = this.clock.now();
    const activeIds = new Set(slots.map(([, contract]) => contract.contract_id));
    const activeNames = new Set(slots.map(([, contract]) => contract.contract_name));
    const siblings = (await this.persistence.listDocuments(COLLECTIONS.deskContracts, 1000).catch(() => []))
      .filter((candidate) => (
        activeNames.has(candidate?.contract_name)
        && !activeIds.has(candidate?.contract_id)
      ));
    const registry = buildContractRegistry(activeContracts, this.clock);
    const writes = [
      ...slots.map(([, contract]) => ({
        collection: COLLECTIONS.deskContracts,
        documentId: contract.contract_id,
        data: {
          ...contract,
          status: "active",
          is_active: true,
          updated_at: tick.utc,
          updated_at_utc: tick.utc,
          updated_at_paris: tick.paris,
        },
        merge: false,
      })),
      ...siblings.map((contract) => ({
        collection: COLLECTIONS.deskContracts,
        documentId: contract.contract_id,
        data: {
          status: "archived",
          is_active: false,
          updated_at: tick.utc,
          updated_at_utc: tick.utc,
          updated_at_paris: tick.paris,
        },
        merge: true,
      })),
      {
        collection: COLLECTIONS.deskContractRegistry,
        documentId: ACTIVE_CONTRACTS_ID,
        data: registry,
        merge: false,
      },
    ];
    await this.persistence.writeDocuments(writes);
    return {
      ok: true,
      registry,
      activated: slots.map(([slot, contract]) => ({
        slot,
        contract_name: contract.contract_name,
        schema_version: contract.schema_version,
        contract_id: contract.contract_id,
      })),
      archived_contract_ids: siblings.map((contract) => contract.contract_id).sort(),
      atomic_write_count: writes.length,
    };
  }

  async archiveContractVersion({ contract_name, schema_version }) {
    const tick = this.clock.now();
    const contract = await this.getContract({ contract_name, schema_version });
    await this.persistence.setDocument(COLLECTIONS.deskContracts, contract.contract_id, {
      status: "archived",
      is_active: false,
      updated_at: tick.utc,
    }, { merge: true });
    return { ok: true, contract_id: contract.contract_id, status: "archived" };
  }
}

function assertRuntimeActivationTarget(contractName, schemaVersion) {
  const expected = Object.values(RUNTIME_CONTRACT_MATRIX).find((entry) => entry.contract_name === contractName);
  if (!expected) return;
  if (String(schemaVersion || "") !== expected.schema_version) {
    const error = new Error(`runtime_contract_activation_forbidden:${contractName}:${schemaVersion}`);
    error.code = "RUNTIME_CONTRACT_ACTIVATION_FORBIDDEN";
    error.details = {
      contract_name: contractName,
      requested_schema_version: schemaVersion || null,
      required_schema_version: expected.schema_version,
      historical_read_remains_available: true,
    };
    throw error;
  }
}

async function archiveSiblingContractVersions({
  persistence,
  contractName,
  activeContractId,
  replacementContractId,
  clock,
}) {
  const tick = clock.now();
  const siblings = await persistence.listDocuments(COLLECTIONS.deskContracts, 500).catch(() => []);
  const staleActive = siblings.filter((candidate) => (
    candidate?.contract_name === contractName
    && candidate?.contract_id !== activeContractId
    && (candidate?.is_active === true || candidate?.status === "active")
  ));

  for (const candidate of staleActive) {
    await persistence.setDocument(COLLECTIONS.deskContracts, candidate.contract_id, {
      status: "archived",
      is_active: false,
      replaced_by: replacementContractId,
      updated_at: tick.utc,
      updated_at_utc: tick.utc,
      updated_at_paris: tick.paris,
    }, { merge: true });
  }

  return staleActive.map((candidate) => candidate.contract_id);
}

async function bundledActiveContracts(clock = new SystemClock()) {
  const [master, monitor, executionPlan, monitorCommand, conditionCatalog, frontProjection, executionPolicy] = await Promise.all([
    bundledContract("DeskMasterAnalysisContract", "5.4.0", clock),
    bundledContract("DeskHourlyThesisMonitorContract", "2.4.0", clock),
    bundledContract("DeskExecutionPlanContract", "1.4.0", clock),
    bundledContract("DeskMonitorCommandContract", "1.4.0", clock),
    bundledContract("DeskConditionCatalogContract", "1.2.0", clock),
    bundledContract("DeskFrontProjectionContract", "1.0.0", clock),
    bundledContract("DeskDeterministicExecutionPolicy", "4.3.0", clock),
  ]);
  return assertRuntimeContractMatrix({
    ok: true,
    master_contract: master,
    monitor_contract: monitor,
    execution_plan_contract: executionPlan,
    monitor_command_contract: monitorCommand,
    condition_catalog_contract: conditionCatalog,
    front_projection_contract: frontProjection,
    execution_policy_contract: executionPolicy,
    registry: buildContractRegistry({
      master_contract: master,
      monitor_contract: monitor,
      execution_plan_contract: executionPlan,
      monitor_command_contract: monitorCommand,
      condition_catalog_contract: conditionCatalog,
      front_projection_contract: frontProjection,
      execution_policy_contract: executionPolicy,
    }, clock),
    source: "bundled_contracts",
  }, { operation: "bundled_active_contracts" });
}

async function resolveRegisteredContract(persistence, reference, fallbackName, fallbackVersion, clock) {
  if (reference?.contract_id) {
    const persisted = await persistence.getDocument(COLLECTIONS.deskContracts, reference.contract_id).catch(() => null);
    if (persisted) return persisted;
  }
  return bundledContract(fallbackName, fallbackVersion, clock);
}

async function bundledContracts(clock = new SystemClock()) {
  const specs = [
    ["DeskMasterAnalysisContract", "5.4.0"],
    ["DeskMasterAnalysisContract", "5.3.0"],
    ["DeskMasterAnalysisContract", "5.2.0"],
    ["DeskMasterAnalysisContract", "5.1.0"],
    ["DeskMasterAnalysisContract", "5.0.0"],
    ["DeskMasterAnalysisContract", "4.0.0"],
    ["DeskHourlyThesisMonitorContract", "2.4.0"],
    ["DeskHourlyThesisMonitorContract", "2.3.0"],
    ["DeskHourlyThesisMonitorContract", "2.2.0"],
    ["DeskHourlyThesisMonitorContract", "2.1.0"],
    ["DeskHourlyThesisMonitorContract", "2.0.0"],
    ["DeskHourlyThesisMonitorContract", "1.0.0"],
    ["DeskExecutionPlanContract", "1.4.0"],
    ["DeskExecutionPlanContract", "1.3.0"],
    ["DeskExecutionPlanContract", "1.2.0"],
    ["DeskExecutionPlanContract", "1.1.0"],
    ["DeskExecutionPlanContract", "1.0.0"],
    ["DeskMonitorCommandContract", "1.4.0"],
    ["DeskMonitorCommandContract", "1.3.0"],
    ["DeskMonitorCommandContract", "1.2.0"],
    ["DeskMonitorCommandContract", "1.1.0"],
    ["DeskMonitorCommandContract", "1.0.0"],
    ["DeskConditionCatalogContract", "1.2.0"],
    ["DeskConditionCatalogContract", "1.1.0"],
    ["DeskConditionCatalogContract", "1.0.0"],
    ["DeskFrontProjectionContract", "1.0.0"],
    ["DeskDeterministicExecutionPolicy", "4.3.0"],
    ["DeskDeterministicExecutionPolicy", "4.2.0"],
    ["DeskDeterministicExecutionPolicy", "4.1.0"],
    ["DeskDeterministicExecutionPolicy", "4.0.0"],
    ["DeskDeterministicExecutionPolicy", "3.0.0"],
    ["DeskDeterministicExecutionPolicy", "2.0.0"],
  ];
  return (await Promise.all(specs.map(([name, version]) => bundledContract(name, version, clock))))
    .filter(Boolean);
}

async function bundledContract(contractName, schemaVersion, clock = new SystemClock()) {
  const contract_id = contractDocumentId(contractName, schemaVersion);
  try {
    const registryEntry = bundledContractRegistryEntry(contractName, schemaVersion);
    if (!registryEntry?.schema_path) return null;
    const [content_markdown, schemaText] = await Promise.all([
      readFile(join(CANONICAL_CONTRACTS_ROOT, `${contract_id}.md`), "utf8"),
      readFile(join(CANONICAL_SCHEMAS_ROOT, registryEntry.schema_path.split("/").at(-1)), "utf8"),
    ]);
    return normalizeContract({
      contract_id,
      contract_name: contractName,
      schema_version: schemaVersion,
      status: isRuntimeContractVersion(contractName, schemaVersion) ? "active" : "archived",
      content_markdown,
      schema_json: JSON.parse(schemaText),
      is_active: isRuntimeContractVersion(contractName, schemaVersion),
      source: "bundled_contracts",
    }, clock);
  } catch {
    return null;
  }
}

function bundledContractRegistryEntry(contractName, schemaVersion) {
  return [
    ...Object.values(BUNDLED_CONTRACT_REGISTRY.active_contracts || {}),
    ...Object.values(BUNDLED_CONTRACT_REGISTRY.legacy_contracts || {}),
  ].find((entry) => (
    entry.contract_name === contractName
    && entry.schema_version === String(schemaVersion)
  )) || null;
}

function isRuntimeContractVersion(contractName, schemaVersion) {
  return Object.values(RUNTIME_CONTRACT_MATRIX).some((entry) => (
    entry.contract_name === contractName && entry.schema_version === String(schemaVersion)
  ));
}

function contractDocumentId(contractName, schemaVersion) {
  return `${contractName}_v${String(schemaVersion).replaceAll(".", "_")}`;
}

function normalizeContract(contract, clock = new SystemClock()) {
  const tick = clock.now();
  const { force, ...persisted } = contract;
  const contract_id = contract.contract_id || contractDocumentId(contract.contract_name, contract.schema_version);
  const expectedContractId = contractDocumentId(contract.contract_name, contract.schema_version);
  if (contract_id !== expectedContractId) {
    const error = new Error(`contract_id_mismatch:${contract_id}:${expectedContractId}`);
    error.code = "CONTRACT_ID_MISMATCH";
    error.details = { supplied: contract_id, expected: expectedContractId };
    throw error;
  }
  const content_markdown = contract.content_markdown || "";
  const hash = createHash("sha256").update(content_markdown).digest("hex");
  if (contract.hash && contract.hash !== hash) {
    const error = new Error(`contract_hash_mismatch:${contract_id}`);
    error.code = "CONTRACT_HASH_MISMATCH";
    error.details = { contract_id, expected: hash, supplied: contract.hash };
    throw error;
  }
  const schema_json = contract.schema_json || {};
  const schema_hash = canonicalSchemaHash(schema_json);
  return {
    ...persisted,
    contract_id,
    content_markdown,
    schema_json,
    status: contract.status || "active",
    hash,
    schema_hash,
    is_active: Boolean(contract.is_active),
    replaced_by: contract.replaced_by ?? null,
    created_at: contract.created_at ?? tick.utc,
    created_at_utc: contract.created_at_utc ?? tick.utc,
    created_at_paris: contract.created_at_paris ?? tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}

function contractContentChanged(existing, next) {
  if (!existing) return false;
  return String(existing.hash || "") !== String(next.hash || "")
    || String(existing.content_markdown || "") !== String(next.content_markdown || "")
    || canonicalSchemaHash(existing.schema_json || {}) !== String(next.schema_hash || "");
}

export function canonicalSchemaHash(schemaJson) {
  return createHash("sha256").update(canonicalJson(schemaJson)).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(",")}}`;
}

function preserveContractCreation(next, existing) {
  if (!existing) return next;
  return {
    ...next,
    created_at: existing.created_at ?? next.created_at,
    created_at_utc: existing.created_at_utc ?? next.created_at_utc,
    created_at_paris: existing.created_at_paris ?? next.created_at_paris,
  };
}

function contractUpdateAuditDoc({ existing, next, tick }) {
  const audit_id = stableVNextId("contract_update", next.contract_id, tick.utc);
  return {
    audit_id,
    event_type: "contract_update",
    contract_id: next.contract_id,
    contract_name: next.contract_name,
    schema_version: next.schema_version,
    previous_hash: existing?.hash || null,
    next_hash: next.hash || null,
    previous_schema_hash: canonicalSchemaHash(existing?.schema_json || {}),
    next_schema_hash: next.schema_hash || null,
    force: true,
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
  };
}

export function compactContract(contract) {
  if (!contract) return null;
  return {
    contract_name: contract.contract_name,
    schema_version: contract.schema_version,
    contract_id: contract.contract_id,
    status: contract.status,
    hash: contract.hash,
    schema_hash: contract.schema_hash || canonicalSchemaHash(contract.schema_json || {}),
    is_active: Boolean(contract.is_active),
    updated_at: contract.updated_at || null,
  };
}

export function contractHash(contract) {
  return contract?.contract_hash || contract?.hash || null;
}

function contractRef(contract, { backtestId } = {}) {
  if (!contract) return null;
  const ref = {
    collection: COLLECTIONS.deskContracts,
    document_id: contract.contract_id || contractDocumentId(contract.contract_name, contract.schema_version),
  };
  if (backtestId) ref.backtest_id = backtestId;
  return ref;
}

export function contractContext(contracts, kind, { tick, pinnedForReplay = false, backtestId = null } = {}) {
  const loadedAt = tick?.paris || new SystemClock().now().paris;
  const contract = kind === "master" ? contracts?.master_contract : contracts?.monitor_contract;
  return {
    contract_name: contract?.contract_name || null,
    schema_version: contract?.schema_version || null,
    contract_hash: contractHash(contract),
    contract_snapshot_ref: contractRef(contract, { backtestId: pinnedForReplay ? backtestId : null }),
    loaded_at_paris: loadedAt,
    is_active_at_bundle_build: Boolean(contract?.is_active || contract?.status === "active"),
    pinned_for_replay: Boolean(pinnedForReplay),
    execution_policy: compactContract(contracts?.execution_policy_contract),
    execution_plan: compactContract(contracts?.execution_plan_contract),
    monitor_command: compactContract(contracts?.monitor_command_contract),
    condition_catalog: compactContract(contracts?.condition_catalog_contract),
  };
}

export function contractSavePayload(context) {
  return {
    contract_name: context?.contract_name || null,
    schema_version: context?.schema_version || null,
    contract_hash: context?.contract_hash || null,
  };
}

export function contractHandshake(workflow, context, { saveTool, backtestId = null } = {}) {
  return {
    workflow,
    required_first_tool: "get_active_contracts",
    expected_contract: contractSavePayload(context),
    save_tool: saveTool,
    save_must_include: ["contract_name", "schema_version", "contract_hash"],
    replay_backtest_id: backtestId,
    pinned_for_replay: Boolean(context?.pinned_for_replay),
    mismatch_action: "stop_and_refresh_bundle_before_saving",
    direct_mcp_save_required: true,
    operator_json_handoff_allowed: false,
    missing_mcp_action: "stop_with_mcp_required",
  };
}

function buildContractRegistry({
  master_contract,
  monitor_contract,
  execution_plan_contract,
  monitor_command_contract,
  condition_catalog_contract,
  front_projection_contract,
  execution_policy_contract,
}, clock = new SystemClock()) {
  const tick = clock.now();
  return {
    master_contract: compactContract(master_contract),
    monitor_contract: compactContract(monitor_contract),
    execution_plan_contract: compactContract(execution_plan_contract),
    monitor_command_contract: compactContract(monitor_command_contract),
    condition_catalog_contract: compactContract(condition_catalog_contract),
    front_projection_contract: compactContract(front_projection_contract),
    execution_policy_contract: compactContract(execution_policy_contract),
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}
