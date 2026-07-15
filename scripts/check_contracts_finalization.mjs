#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CONTRACTS_FINALIZATION_SCHEMA_VERSION = "v2_contracts_finalization_v1";

export const REQUIRED_ENTITY_CONTRACTS = [
  {
    key: "decision_audit_contract",
    contract_name: "DeskDecisionAuditContract",
    schema_file: "decision-audit.schema.json",
    example_file: "decision-audit.example.json",
  },
  {
    key: "simulation_run_contract",
    contract_name: "DeskSimulationRun",
    schema_file: "simulation-run.schema.json",
    example_file: "simulation-run.example.json",
  },
  {
    key: "simulation_step_contract",
    contract_name: "DeskSimulationStep",
    schema_file: "simulation-step.schema.json",
    example_file: "simulation-step.example.json",
  },
  {
    key: "worker_mission_contract",
    contract_name: "DeskWorkerMission",
    schema_file: "worker-mission.schema.json",
    example_file: "worker-mission.example.json",
  },
  {
    key: "dashboard_state_contract",
    contract_name: "DeskDashboardState",
    schema_file: "dashboard-state.schema.json",
    example_file: "dashboard-state.example.json",
  },
];

const ALLOWED_RUNTIME_ENTITY_CONTRACTS = new Set(["front_projection_contract"]);

function repoRoot(cwd = process.cwd()) {
  if (existsSync(path.join(cwd, "packages", "desk-contracts", "registry.json"))) {
    return cwd;
  }
  if (path.basename(cwd) === "desk-contracts" && existsSync(path.join(cwd, "registry.json"))) {
    return path.dirname(path.dirname(cwd));
  }
  return cwd;
}

function readJson(root, relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

function schemaFileName(schemaPath) {
  return schemaPath.split("/").at(-1);
}

function addViolation(violations, type, message, details = {}) {
  violations.push({ type, message, details });
}

export async function evaluateContractsFinalization(options = {}) {
  const root = options.root || repoRoot();
  const registry = readJson(root, "packages/desk-contracts/registry.json");
  const generatedUrl = pathToFileURL(path.join(root, "packages/desk-contracts/generated/runtime-data.js"));
  generatedUrl.searchParams.set("contracts_finalization_check", String(Date.now()));
  const generated = await import(generatedUrl.href);
  const violations = [];
  const contracts = [];

  if (!["master_monitor_only", "all_active_contracts"].includes(registry.lifecycle_policy?.runtime_exposed)) {
    addViolation(
      violations,
      "runtime_exposed_false_guard",
      "The contract registry declares an unsupported runtime exposure policy.",
      { runtime_exposed: registry.lifecycle_policy?.runtime_exposed },
    );
  }

  const requiredKeys = new Set(REQUIRED_ENTITY_CONTRACTS.map((contract) => contract.key));
  for (const key of Object.keys(registry.entity_contracts || {})) {
    if (!requiredKeys.has(key) && !ALLOWED_RUNTIME_ENTITY_CONTRACTS.has(key)) {
      addViolation(violations, "unexpected_entity_contract", `${key} is not part of the finalized entity contract set`, { key });
    }
  }

  for (const contract of REQUIRED_ENTITY_CONTRACTS) {
    const entry = registry.entity_contracts?.[contract.key];
    const item = { ...contract, ok: true };
    contracts.push(item);

    if (!entry) {
      item.ok = false;
      addViolation(violations, "missing_entity_contract", `${contract.key} is missing from registry.json`, contract);
      continue;
    }

    if (entry.status !== "active") {
      item.ok = false;
      addViolation(
        violations,
        "no_unpromoted_entity_contracts",
        `${contract.key} must be active before the Contracts CDC gap can close.`,
        { key: contract.key, status: entry.status },
      );
    }

    if (entry.runtime_exposed !== false) {
      item.ok = false;
      addViolation(
        violations,
        "runtime_exposed_false_guard",
        `${contract.key} must stay non-executable at runtime.`,
        { key: contract.key, runtime_exposed: entry.runtime_exposed },
      );
    }

    if (entry.contract_name !== contract.contract_name) {
      item.ok = false;
      addViolation(
        violations,
        "contract_name_mismatch",
        `${contract.key} contract_name does not match the required finalized contract.`,
        { key: contract.key, expected: contract.contract_name, actual: entry.contract_name },
      );
    }

    const schemaPath = `packages/desk-contracts/schemas/entities/${contract.schema_file}`;
    const examplePath = `packages/desk-contracts/examples/${contract.example_file}`;
    if (!existsSync(path.join(root, schemaPath))) {
      item.ok = false;
      addViolation(violations, "missing_contract_schema", `${contract.key} schema file is missing`, { key: contract.key, path: schemaPath });
    }
    if (!existsSync(path.join(root, examplePath))) {
      item.ok = false;
      addViolation(violations, "missing_contract_example", `${contract.key} example file is missing`, { key: contract.key, path: examplePath });
    }

    if (schemaFileName(entry.schema_path) !== contract.schema_file) {
      item.ok = false;
      addViolation(
        violations,
        "contract_schema_path_mismatch",
        `${contract.key} schema_path does not point to the finalized schema file.`,
        { key: contract.key, expected: contract.schema_file, actual: entry.schema_path },
      );
    }

    if (entry.example_path !== `examples/${contract.example_file}`) {
      item.ok = false;
      addViolation(
        violations,
        "contract_example_path_mismatch",
        `${contract.key} example_path does not point to the finalized example file.`,
        { key: contract.key, expected: `examples/${contract.example_file}`, actual: entry.example_path },
      );
    }

    const generatedEntry = generated.registry?.entity_contracts?.[contract.key];
    if (JSON.stringify(generatedEntry) !== JSON.stringify(entry)) {
      item.ok = false;
      addViolation(
        violations,
        "generated_registry_not_synced",
        `${contract.key} generated runtime registry is not synchronized with registry.json.`,
        { key: contract.key },
      );
    }

    const generatedSchema = generated.entitySchemas?.[contract.schema_file];
    if (!generatedSchema || generatedSchema.title !== contract.contract_name) {
      item.ok = false;
      addViolation(
        violations,
        "generated_schema_not_exposed",
        `${contract.key} schema is not exposed by generated runtime data.`,
        { key: contract.key, schema_file: contract.schema_file },
      );
    }
  }

  return {
    ok: violations.length === 0,
    schema_version: CONTRACTS_FINALIZATION_SCHEMA_VERSION,
    contracts,
    violations,
  };
}

export function formatContractsFinalization(result) {
  const lines = [
    `[contracts-finalization] ok=${result.ok} schema=${result.schema_version} active_entity_contracts=${result.contracts.length} violations=${result.violations.length}`,
  ];
  for (const contract of result.contracts) {
    lines.push(`[contracts-finalization] contract=${contract.key} name=${contract.contract_name} schema=${contract.schema_file} ok=${contract.ok}`);
  }
  for (const violation of result.violations) {
    lines.push(`[contracts-finalization] violation type=${violation.type} message=${violation.message}`);
  }
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await evaluateContractsFinalization();
  console.log(formatContractsFinalization(result));
  if (!result.ok) {
    process.exitCode = 1;
  }
}
