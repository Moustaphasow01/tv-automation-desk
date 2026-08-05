import { deskError } from "./desk-errors.js";

export const ACTIVE_STRATEGY_RUNTIME_VERSIONS = Object.freeze({
  strategy_version: "autopilot_v5",
  autopilot_version: "5.4.0",
  master_contract: "5.4.0",
  monitor_contract: "2.4.0",
  execution_policy: "4.3.0",
  execution_plan: "1.4.0",
  monitor_command: "1.4.0",
  condition_catalog: "1.2.0",
  deterministic_compiler: "1.4.0",
  condition_engine: "1.2.0",
});

export const HISTORICAL_STRATEGY_RUNTIME_VERSIONS = Object.freeze({
  autopilot_version: Object.freeze(["5.0.0", "5.1.0", "5.2.0", "5.3.0"]),
  master_contract: Object.freeze(["4.0.0", "5.0.0", "5.1.0", "5.2.0", "5.3.0"]),
  monitor_contract: Object.freeze(["1.0.0", "2.0.0", "2.1.0", "2.2.0", "2.3.0"]),
  execution_policy: Object.freeze(["3.0.0", "4.0.0", "4.1.0", "4.2.0"]),
  execution_plan: Object.freeze(["1.0.0", "1.1.0", "1.2.0", "1.3.0"]),
  monitor_command: Object.freeze(["1.0.0", "1.1.0", "1.2.0", "1.3.0"]),
  condition_catalog: Object.freeze(["1.0.0", "1.1.0"]),
  deterministic_compiler: Object.freeze(["1.0.0", "1.1.0", "1.2.0", "1.3.0"]),
  condition_engine: Object.freeze(["1.0.0", "1.1.0"]),
});

const RUN_PIN_FIELDS = Object.freeze({
  strategy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.strategy_version,
  autopilot_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.autopilot_version,
  replay_execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
  execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
  monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
  condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
  deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
  condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
});

const LIVE_SAVE_PIN_FIELDS = Object.freeze({
  execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
  execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
  monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
  condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
  deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
  condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
});

const REPLAY_SAVE_PIN_FIELDS = Object.freeze({
  replay_execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
  execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
  monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
  condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
  deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
  condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
});

export function activeContractVersionForWorkflow(workflow) {
  return String(workflow || "").endsWith("MASTER")
    ? ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract
    : ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract;
}

export function activeContractNameForWorkflow(workflow) {
  return String(workflow || "").endsWith("MASTER")
    ? "DeskMasterAnalysisContract"
    : "DeskHourlyThesisMonitorContract";
}

export function assertActiveStrategyRuntimePins(value = {}, {
  operation = "strategy_runtime",
  allowMissing = false,
} = {}) {
  return assertPins(value, RUN_PIN_FIELDS, {
    operation,
    allowMissing,
    code: "STRATEGY_RUNTIME_VERSION_MISMATCH",
  });
}

export function isActiveStrategyRuntimePins(value = {}, options = {}) {
  try {
    assertActiveStrategyRuntimePins(value, options);
    return true;
  } catch {
    return false;
  }
}

export function assertActiveStrategyContractContext(context = {}, {
  workflow,
  operation = "strategy_contract_context",
} = {}) {
  const expectedContractName = activeContractNameForWorkflow(workflow);
  const expectedContractVersion = activeContractVersionForWorkflow(workflow);
  const mismatches = [];
  comparePin(mismatches, "contract_name", context.contract_name, expectedContractName);
  comparePin(mismatches, "schema_version", context.schema_version, expectedContractVersion);
  comparePin(
    mismatches,
    "execution_policy.schema_version",
    context.execution_policy?.schema_version,
    ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
  );
  comparePin(
    mismatches,
    "execution_plan.schema_version",
    context.execution_plan?.schema_version,
    ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
  );
  comparePin(
    mismatches,
    "monitor_command.schema_version",
    context.monitor_command?.schema_version,
    ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
  );
  comparePin(
    mismatches,
    "condition_catalog.schema_version",
    context.condition_catalog?.schema_version,
    ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
  );
  if (mismatches.length) {
    throw strategyVersionError("STRATEGY_CONTRACT_VERSION_MISMATCH", operation, mismatches, {
      workflow: workflow || null,
      historical_read_remains_available: true,
    });
  }
  return context;
}

export function isActiveStrategyContractContext(context = {}, options = {}) {
  try {
    assertActiveStrategyContractContext(context, options);
    return true;
  } catch {
    return false;
  }
}

export function assertActiveStrategySaveTarget(value = {}, {
  workflow,
  mode = "live",
  operation = "strategy_save",
  allowMissingPins = false,
} = {}) {
  const expectedContractName = activeContractNameForWorkflow(workflow);
  const expectedContractVersion = activeContractVersionForWorkflow(workflow);
  const mismatches = [];
  comparePin(mismatches, "contract_name", value.contract_name, expectedContractName);
  comparePin(mismatches, "schema_version", value.schema_version, expectedContractVersion);
  const pins = mode === "replay" ? REPLAY_SAVE_PIN_FIELDS : LIVE_SAVE_PIN_FIELDS;
  for (const [field, expected] of Object.entries(pins)) {
    if (allowMissingPins && isMissing(value[field])) continue;
    comparePin(mismatches, field, value[field], expected);
  }
  if (mismatches.length) {
    throw strategyVersionError("STRATEGY_SAVE_VERSION_MISMATCH", operation, mismatches, {
      workflow: workflow || null,
      mode,
      historical_read_remains_available: true,
      repin_forbidden: true,
    });
  }
  return value;
}

export function isHistoricalStrategyContractVersion(contractName, schemaVersion) {
  const versions = contractName === "DeskMasterAnalysisContract"
    ? HISTORICAL_STRATEGY_RUNTIME_VERSIONS.master_contract
    : contractName === "DeskHourlyThesisMonitorContract"
      ? HISTORICAL_STRATEGY_RUNTIME_VERSIONS.monitor_contract
      : [];
  return versions.includes(String(schemaVersion || ""));
}

function assertPins(value, expectedPins, { operation, allowMissing, code }) {
  const mismatches = [];
  for (const [field, expected] of Object.entries(expectedPins)) {
    if (allowMissing && isMissing(value[field])) continue;
    comparePin(mismatches, field, value[field], expected);
  }
  if (mismatches.length) {
    throw strategyVersionError(code, operation, mismatches, {
      historical_read_remains_available: true,
      repin_forbidden: true,
    });
  }
  return value;
}

function comparePin(mismatches, field, actual, expected) {
  if (String(actual || "") === expected) return;
  mismatches.push({
    field,
    expected,
    actual: isMissing(actual) ? null : actual,
  });
}

function isMissing(value) {
  return value === undefined || value === null || value === "";
}

function strategyVersionError(code, operation, mismatches, extra = {}) {
  return deskError(code, `The ${operation} payload is not pinned to the active deterministic strategy runtime.`, {
    operation,
    mismatches,
    ...extra,
  });
}
