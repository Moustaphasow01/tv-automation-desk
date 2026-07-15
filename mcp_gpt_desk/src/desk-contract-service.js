import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { SystemClock } from "@tv-automation/desk-time";
import { stableVNextId } from "./desk-ids.js";

const CONTRACTS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../contracts");
const ACTIVE_CONTRACTS_ID = "active_contracts";
const COLLECTIONS = DESK_COLLECTIONS;

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

    const [master, monitor, frontProjection] = await Promise.all([
      resolveRegisteredContract(this.persistence, registry.master_contract, "DeskMasterAnalysisContract", "4.0.0", this.clock),
      resolveRegisteredContract(this.persistence, registry.monitor_contract, "DeskHourlyThesisMonitorContract", "1.0.0", this.clock),
      resolveRegisteredContract(this.persistence, registry.front_projection_contract, "DeskFrontProjectionContract", "1.0.0", this.clock),
    ]);

    return {
      ok: true,
      master_contract: master,
      monitor_contract: monitor,
      front_projection_contract: frontProjection,
    };
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
    const contract = await this.getContract({ contract_name, schema_version });
    const activated = { ...contract, status: "active", is_active: true };
    await this.saveContract(activated);
    const current = await this.getActiveContracts().catch(() => bundledActiveContracts(this.clock));
    const registry = buildContractRegistry({
      master_contract: contract_name === "DeskMasterAnalysisContract" ? activated : current.master_contract,
      monitor_contract: contract_name === "DeskHourlyThesisMonitorContract" ? activated : current.monitor_contract,
      front_projection_contract: contract_name === "DeskFrontProjectionContract" ? activated : current.front_projection_contract,
    }, this.clock);
    await this.persistence.setDocument(COLLECTIONS.deskContractRegistry, ACTIVE_CONTRACTS_ID, registry);
    return { ok: true, contract_name, schema_version, contract_id: contract.contract_id };
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

async function bundledActiveContracts(clock = new SystemClock()) {
  const [master, monitor, frontProjection] = await Promise.all([
    bundledContract("DeskMasterAnalysisContract", "4.0.0", clock),
    bundledContract("DeskHourlyThesisMonitorContract", "1.0.0", clock),
    bundledContract("DeskFrontProjectionContract", "1.0.0", clock),
  ]);
  return {
    ok: true,
    master_contract: master,
    monitor_contract: monitor,
    front_projection_contract: frontProjection,
    registry: buildContractRegistry({ master_contract: master, monitor_contract: monitor, front_projection_contract: frontProjection }, clock),
    source: "bundled_contracts",
  };
}

async function resolveRegisteredContract(persistence, reference, fallbackName, fallbackVersion, clock) {
  if (reference?.contract_id) {
    const persisted = await persistence.getDocument(COLLECTIONS.deskContracts, reference.contract_id).catch(() => null);
    if (persisted) return persisted;
  }
  return bundledContract(fallbackName, fallbackVersion, clock);
}

async function bundledContracts(clock = new SystemClock()) {
  return [
    await bundledContract("DeskMasterAnalysisContract", "4.0.0", clock),
    await bundledContract("DeskHourlyThesisMonitorContract", "1.0.0", clock),
    await bundledContract("DeskFrontProjectionContract", "1.0.0", clock),
  ].filter(Boolean);
}

async function bundledContract(contractName, schemaVersion, clock = new SystemClock()) {
  const contract_id = contractDocumentId(contractName, schemaVersion);
  try {
    const content_markdown = await readFile(join(CONTRACTS_ROOT, `${contract_id}.md`), "utf8");
    return normalizeContract({
      contract_id,
      contract_name: contractName,
      schema_version: schemaVersion,
      status: "active",
      content_markdown,
      schema_json: {},
      is_active: true,
      source: "bundled_contracts",
    }, clock);
  } catch {
    return null;
  }
}

function contractDocumentId(contractName, schemaVersion) {
  return `${contractName}_v${String(schemaVersion).replaceAll(".", "_")}`;
}

function normalizeContract(contract, clock = new SystemClock()) {
  const tick = clock.now();
  const { force, ...persisted } = contract;
  const contract_id = contract.contract_id || contractDocumentId(contract.contract_name, contract.schema_version);
  const content_markdown = contract.content_markdown || "";
  const hash = contract.hash || createHash("sha256").update(content_markdown).digest("hex");
  return {
    ...persisted,
    contract_id,
    content_markdown,
    schema_json: contract.schema_json || {},
    status: contract.status || "active",
    hash,
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
    || String(existing.content_markdown || "") !== String(next.content_markdown || "");
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

function buildContractRegistry({ master_contract, monitor_contract, front_projection_contract }, clock = new SystemClock()) {
  const tick = clock.now();
  return {
    master_contract: compactContract(master_contract),
    monitor_contract: compactContract(monitor_contract),
    front_projection_contract: compactContract(front_projection_contract),
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
}
