import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { deskError } from "./desk-errors.js";
import { ACTIVE_STRATEGY_RUNTIME_VERSIONS } from "./strategy-runtime-versioning.js";

const SCHEMAS_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../packages/desk-contracts/schemas/entities",
);

const SCHEMA_FILES = Object.freeze({
  executionPlan: "execution-plan-v1-4.schema.json",
  monitorCommand: "monitor-command-v1-4.schema.json",
  compiledExecutionPlan: "compiled-execution-plan-v1-4.schema.json",
  compiledMonitorCommand: "compiled-monitor-command-v1-4.schema.json",
  master: "master-analysis-v5-4.schema.json",
  monitor: "hourly-monitor-v2-4.schema.json",
});

const schemas = Object.fromEntries(
  Object.entries(SCHEMA_FILES).map(([key, file]) => [key, readJson(join(SCHEMAS_ROOT, file))]),
);

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
});
addFormats(ajv);
ajv.addSchema(schemas.executionPlan);
ajv.addSchema(schemas.monitorCommand);

const validateMaster = ajv.compile(schemas.master);
const validateMonitor = ajv.compile(schemas.monitor);
const validateCompiledExecutionPlan = ajv.compile(schemas.compiledExecutionPlan);
const validateCompiledMonitorCommand = ajv.compile(schemas.compiledMonitorCommand);

export function assertMasterV5ContractOutput(document, transport = {}) {
  assertContractOutput(validateMaster, document, {
    artifact: "MASTER_V5_1_OUTPUT",
    contractName: "DeskMasterAnalysisContract",
    schemaVersion: ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract,
  });
  assertTransportBinding(document, transport, "master");
  return document;
}

export function assertMonitorV2ContractOutput(document, transport = {}) {
  assertContractOutput(validateMonitor, document, {
    artifact: "MONITOR_V2_1_OUTPUT",
    contractName: "DeskHourlyThesisMonitorContract",
    schemaVersion: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
  });
  assertTransportBinding(document, transport, "monitor");
  return document;
}

export function assertCompiledExecutionPlanV1(document) {
  assertContractOutput(validateCompiledExecutionPlan, document, {
    artifact: "COMPILED_EXECUTION_PLAN_V1",
    contractName: "DeskCompiledDeterministicExecutionPlan",
    schemaVersion: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
  });
  return document;
}

export function assertCompiledMonitorCommandV1(document) {
  assertContractOutput(validateCompiledMonitorCommand, document, {
    artifact: "COMPILED_MONITOR_COMMAND_V1",
    contractName: "DeskCompiledMonitorCommand",
    schemaVersion: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
  });
  return document;
}

export function strategyContractSchemas() {
  return schemas;
}

function assertContractOutput(validate, document, { artifact, contractName, schemaVersion }) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw deskError("STRATEGY_CONTRACT_OUTPUT_REQUIRED", `${artifact} must be a JSON object.`, {
      artifact,
      contract_name: contractName,
      schema_version: schemaVersion,
    });
  }
  if (validate(document)) return;
  throw deskError("STRATEGY_CONTRACT_VALIDATION_FAILED", `${artifact} does not satisfy its pinned JSON Schema.`, {
    artifact,
    contract_name: contractName,
    schema_version: schemaVersion,
    validation_errors: compactErrors(validate.errors),
  });
}

function assertTransportBinding(document, transport, kind) {
  const source = document.source || {};
  const scope = document.scope || {};
  const bindings = kind === "master"
    ? [
        ["analysis_id", transport.analysis_id, source.analysis_id],
        ["bundle_id", transport.bundle_id, source.bundle_id],
        ["pack_id", transport.pack_id, source.pack_id],
        ["pack_build_id", transport.pack_build_id, source.pack_build_id],
        ["plan_id", transport.plan_id, document.execution_plan?.plan_id],
        ["thesis_id", transport.thesis_id, document.active_thesis?.thesis_id],
        ["thesis_plan_id", transport.plan_id, document.active_thesis?.plan_id],
      ]
    : [
        ["monitor_id", transport.monitor_id, source.monitor_id],
        ["bundle_id", transport.bundle_id, source.bundle_id],
        ["pack_id", transport.pack_id, source.pack_id],
        ["pack_build_id", transport.pack_build_id, source.pack_build_id],
        ["master_analysis_id", transport.master_id || transport.linked_master_analysis_id, document.links?.master_analysis_id],
        ["active_thesis_id", transport.thesis_id || transport.linked_active_thesis_id, document.links?.active_thesis_id],
        ["plan_id", transport.plan_id, document.links?.plan_id],
        ["command_plan_id", transport.plan_id, document.command?.plan_id],
        ["command_monitor_id", transport.monitor_id, document.command?.monitor_id],
        ["command_id", transport.command_id, document.command?.command_id],
        ["command_expected_revision", transport.expected_revision, document.command?.expected_revision],
      ];
  bindings.push(
    ["trading_date", transport.trading_date || transport.date, scope.trading_date],
    ["session", transport.session, scope.session],
    ["run_id", transport.run_id || transport.replay_run_id || transport.backtest_id, scope.run_id],
    ["pack_scope", transport.pack_build_id, source.pack_build_id],
  );

  for (const [field, protectedValue, contractValue] of bindings) {
    if (protectedValue === undefined || protectedValue === null || protectedValue === "") continue;
    if (contractValue === undefined || contractValue === null || contractValue === "") {
      throw deskError("STRATEGY_CONTRACT_SCOPE_MISMATCH", `${field} is pinned by the backend but missing from the contract output.`, {
        field,
        protected_value: protectedValue,
        contract_value: contractValue ?? null,
      });
    }
    if (normalizeBinding(field, protectedValue) === normalizeBinding(field, contractValue)) continue;
    throw deskError("STRATEGY_CONTRACT_SCOPE_MISMATCH", `${field} differs between the protected transport and contract output.`, {
      field,
      protected_value: protectedValue,
      contract_value: contractValue,
    });
  }

  assertPinnedSetupIds(document, transport, kind);
}

function assertPinnedSetupIds(document, transport, kind) {
  const allowed = new Set([
    ...(Array.isArray(transport.existing_setup_ids) ? transport.existing_setup_ids : []),
    ...(Array.isArray(transport.setup_id_candidates) ? transport.setup_id_candidates : []),
  ].filter(Boolean).map(String));
  if (!allowed.size) return;

  const used = kind === "master"
    ? [
        document.execution_plan?.primary_setup_id,
        document.active_thesis?.primary_setup_id,
        ...(document.execution_plan?.setups || []).map((setup) => setup?.setup_id),
      ]
    : [
        document.links?.setup_id,
        document.command?.setup_transition?.setup_id,
        document.command?.setup_transition?.replaces_setup_id,
        document.command?.setup_transition?.setup?.setup_id,
      ];

  const unauthorized = used.filter(Boolean).map(String).filter((setupId) => !allowed.has(setupId));
  if (!unauthorized.length) return;
  throw deskError("STRATEGY_CONTRACT_IDENTITY_MISMATCH", "The contract output used a setup identifier not pinned by the backend.", {
    kind,
    unauthorized_setup_ids: [...new Set(unauthorized)],
    allowed_setup_ids: [...allowed],
  });
}

function normalizeBinding(field, value) {
  if (field === "session") return String(value).trim().toLowerCase();
  return String(value).trim();
}

function compactErrors(errors = []) {
  return errors.slice(0, 50).map((error) => ({
    instance_path: error.instancePath || "/",
    schema_path: error.schemaPath || null,
    keyword: error.keyword || null,
    message: error.message || "invalid",
    params: error.params || {},
  }));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
