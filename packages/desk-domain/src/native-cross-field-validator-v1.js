import { validateEntryOrderSemanticsV1 } from "./entry-order-semantics-v1.js";

const SETUP_COMMANDS_REQUIRING_PAYLOAD = new Set([
  "UPSERT_CANDIDATE",
  "PRE_ARM",
  "ARM",
  "REPLACE",
]);

const THESIS_TARGETS = Object.freeze({
  CREATE_WAIT: "WAIT_MONITORED",
  MAKE_CONDITIONAL: "CONDITIONAL",
  ACTIVATE: "ACTIVE",
  WEAKEN: "WEAKENED",
  MARK_AT_RISK: "AT_RISK",
  MARK_POST_EVENT: "POST_EVENT",
  INVALIDATE: "INVALIDATED",
  EXPIRE: "EXPIRED",
  REQUIRE_REPLAN: "REPLAN_REQUIRED",
  SUPERSEDE: "SUPERSEDED",
});

const ACTIVE_NATIVE_CONTRACT_VERSIONS = Object.freeze({
  master: "5.4.0",
  execution_plan: "1.4.0",
  monitor: "2.4.0",
  monitor_command: "1.4.0",
});

const HISTORICAL_NATIVE_CONTRACT_VERSIONS = Object.freeze({
  master: new Set(["5.0.0", "5.1.0", "5.2.0", "5.3.0"]),
  execution_plan: new Set(["1.0.0", "1.1.0", "1.2.0", "1.3.0"]),
  monitor: new Set(["2.0.0", "2.1.0", "2.2.0", "2.3.0"]),
  monitor_command: new Set(["1.0.0", "1.1.0", "1.2.0", "1.3.0"]),
});

export function validateNativeMasterCrossFieldsV1(rawMaster = {}, compiledPlan = {}) {
  const master = object(rawMaster);
  const plan = object(master.execution_plan);
  const runtimeIssue = validateNativeMasterRuntimeVersion(master, plan);
  if (runtimeIssue) return [runtimeIssue];
  if (!isNativeMaster(master, plan)) return [];

  const errors = [];
  const setups = array(plan.setups);
  const activeThesis = object(master.active_thesis);
  const planPlanId = text(plan.plan_id);
  const thesisPlanId = text(activeThesis.plan_id);
  if (!planPlanId || !thesisPlanId) {
    errors.push(issue("PLAN_ID_MISSING", {
      execution_plan_plan_id: planPlanId || null,
      active_thesis_plan_id: thesisPlanId || null,
    }));
  } else if (planPlanId !== thesisPlanId) {
    errors.push(issue("PLAN_ID_MISMATCH", {
      execution_plan_plan_id: planPlanId,
      active_thesis_plan_id: thesisPlanId,
    }));
  }

  const hypotheses = array(master.hypotheses);
  const selectedHypothesis = object(master.selected_hypothesis);
  const selectedHypothesisId = text(selectedHypothesis.hypothesis_id);
  const thesisHypothesisId = text(activeThesis.selected_hypothesis_id);
  const hypothesisIds = new Set(hypotheses.map((hypothesis) => text(hypothesis?.hypothesis_id)).filter(Boolean));
  if (selectedHypothesisId && !hypothesisIds.has(selectedHypothesisId)) {
    errors.push(issue("SELECTED_HYPOTHESIS_NOT_FOUND", {
      selected_hypothesis_id: selectedHypothesisId,
    }));
  }
  if (selectedHypothesisId && thesisHypothesisId && selectedHypothesisId !== thesisHypothesisId) {
    errors.push(issue("SELECTED_HYPOTHESIS_LINK_MISMATCH", {
      selected_hypothesis_id: selectedHypothesisId,
      active_thesis_selected_hypothesis_id: thesisHypothesisId,
    }));
  }

  validateUniqueValues(
    setups.map((setup) => text(setup?.setup_id)),
    "SETUP_ID",
    errors,
  );
  validateUniqueValues(
    setups.map((setup) => setup?.rank),
    "SETUP_RANK",
    errors,
  );

  const setupIds = new Set(setups.map((setup) => text(setup?.setup_id)).filter(Boolean));
  const primarySetupId = text(plan.primary_setup_id);
  if (primarySetupId && !setupIds.has(primarySetupId)) {
    errors.push(issue("PRIMARY_SETUP_ID_NOT_FOUND", { primary_setup_id: primarySetupId }));
  }
  const thesisPrimarySetupId = text(activeThesis.primary_setup_id);
  const planPrimaryPresent = Object.hasOwn(plan, "primary_setup_id");
  const thesisPrimaryPresent = Object.hasOwn(activeThesis, "primary_setup_id");
  if (planPrimaryPresent && thesisPrimaryPresent && primarySetupId !== thesisPrimarySetupId) {
    errors.push(issue("PRIMARY_SETUP_LINK_MISMATCH", {
      plan_primary_setup_id: primarySetupId || null,
      thesis_primary_setup_id: thesisPrimarySetupId || null,
    }));
  }

  validateMasterSourceCoherence(master.source, plan.source, errors);
  validateScopeCoherence(master.scope, plan.scope, errors);
  validateWindow(plan.validity, "PLAN", errors);
  if (compiledPlan.disposition
    && plan.disposition
    && enumValue(compiledPlan.disposition) !== enumValue(plan.disposition)) {
    errors.push(issue("PLAN_DISPOSITION_MISMATCH", {
      source_disposition: plan.disposition,
      compiled_disposition: compiledPlan.disposition,
    }));
  }

  const primarySetupFound = setups.some((setup) => text(setup?.setup_id) === primarySetupId);
  for (const setup of setups) {
    const setupErrors = [];
    validateNativeSetup(setup, setupErrors);
    if (!primarySetupFound || text(setup?.setup_id) === primarySetupId) errors.push(...setupErrors);
  }
  for (const setup of array(compiledPlan.ranked_setups)) {
    if (setup.compile_status !== "COMPILED" && text(setup.setup_id) === primarySetupId) {
      errors.push(issue("NATIVE_SETUP_NOT_COMPILED", {
        setup_id: setup.setup_id || null,
        geometry_errors: setup.geometry_evaluation?.hard_failures || [],
        compilation_errors: setup.compilation_diagnostics?.errors || [],
      }));
    }
  }
  return dedupe(errors);
}

export function validateNativeMonitorCrossFieldsV1(rawMonitor = {}, currentState = {}) {
  const monitor = object(rawMonitor);
  const command = object(monitor.command);
  const runtimeIssue = validateNativeMonitorRuntimeVersion(monitor, command);
  if (runtimeIssue) return [runtimeIssue];
  if (Object.keys(command).length === 0) return [];
  const errors = [];
  const source = object(monitor.source);
  const links = object(monitor.links);
  validateExactLink("MONITOR_PLAN_LINK_MISMATCH", "plan_id", links.plan_id, command.plan_id, errors);
  validateMonitorScopeCoherence(monitor.scope, command.scope, errors);
  validateExactLink("MONITOR_ID_LINK_MISMATCH", "monitor_id", source.monitor_id, command.monitor_id, errors);
  validateExactLink(
    "MONITOR_THESIS_LINK_MISMATCH",
    "active_thesis_id",
    links.active_thesis_id,
    monitor.active_thesis_update?.thesis_id,
    errors,
  );
  const currentThesis = object(currentState.thesis);
  if (currentThesis.plan_id) {
    validateExactLink(
      "MONITOR_ACTIVE_PLAN_MISMATCH",
      "plan_id",
      links.plan_id,
      currentThesis.plan_id,
      errors,
    );
  }
  if (currentThesis.thesis_id) {
    validateExactLink(
      "MONITOR_ACTIVE_THESIS_MISMATCH",
      "active_thesis_id",
      links.active_thesis_id,
      currentThesis.thesis_id,
      errors,
    );
  }
  const requestedAction = enumValue(command.requested_action);
  const payloads = [
    command.setup_transition,
    command.transformation,
    command.replan_request,
    command.management_request,
  ];
  const presentCount = payloads.filter((value) => value !== null && value !== undefined).length;
  if (requestedAction === "NO_ACTION" && presentCount > 0) {
    errors.push(issue("NO_ACTION_HAS_COMMAND_PAYLOAD"));
  }
  if (requestedAction === "APPLY_ORTHOGONAL_COMMANDS" && presentCount === 0) {
    errors.push(issue("ORTHOGONAL_COMMAND_PAYLOAD_MISSING"));
  }

  const transition = object(command.setup_transition);
  if (Object.keys(transition).length > 0) {
    const setupCommand = enumValue(transition.command);
    const nestedSetup = object(transition.setup);
    const outerSetupId = text(transition.setup_id);
    const nestedSetupId = text(nestedSetup.setup_id);
    if (outerSetupId && nestedSetupId && outerSetupId !== nestedSetupId) {
      errors.push(issue("MONITOR_SETUP_ID_MISMATCH", {
        outer_setup_id: outerSetupId,
        nested_setup_id: nestedSetupId,
      }));
    }
    if (SETUP_COMMANDS_REQUIRING_PAYLOAD.has(setupCommand)
      && Object.keys(nestedSetup).length === 0) {
      errors.push(issue("MONITOR_SETUP_PAYLOAD_REQUIRED", { command: setupCommand }));
    }
    if (!SETUP_COMMANDS_REQUIRING_PAYLOAD.has(setupCommand)
      && Object.keys(nestedSetup).length > 0) {
      errors.push(issue("MONITOR_SETUP_PAYLOAD_FORBIDDEN", { command: setupCommand }));
    }
    if (setupCommand === "REPLACE") {
      const oldSetupId = text(transition.replaces_setup_id);
      if (!oldSetupId) {
        errors.push(issue("REPLACE_OLD_SETUP_ID_MISSING"));
      } else if (oldSetupId === outerSetupId) {
        errors.push(issue("REPLACE_SETUP_IDS_MUST_DIFFER", { setup_id: outerSetupId }));
      }
      if (nestedSetup.replaces_setup_id
        && text(nestedSetup.replaces_setup_id) !== oldSetupId) {
        errors.push(issue("REPLACE_LINK_MISMATCH", {
          transition_replaces_setup_id: oldSetupId,
          nested_replaces_setup_id: nestedSetup.replaces_setup_id,
        }));
      }
      const currentSetupId = text(currentState?.setup?.setup_id);
      if (currentSetupId && oldSetupId && currentSetupId !== oldSetupId) {
        errors.push(issue("REPLACE_CURRENT_SETUP_MISMATCH", {
          current_setup_id: currentSetupId,
          replaces_setup_id: oldSetupId,
        }));
      }
    }
  }

  const transformation = object(command.transformation);
  if (Object.keys(transformation).length > 0) {
    const thesisCommand = enumValue(transformation.command);
    const expectedTarget = THESIS_TARGETS[thesisCommand];
    const targetState = enumValue(transformation.target_state);
    if (expectedTarget && targetState !== expectedTarget) {
      errors.push(issue("THESIS_COMMAND_TARGET_MISMATCH", {
        command: thesisCommand,
        expected_target_state: expectedTarget,
        target_state: targetState,
      }));
    }
  }
  return dedupe(errors);
}

function validateNativeSetup(rawSetup, errors) {
  const setup = object(rawSetup);
  const setupId = text(setup.setup_id) || null;
  validateWindow(setup.validity, "SETUP", errors, setupId);
  const entry = object(setup.entry);
  const entryOrder = validateEntryOrderSemanticsV1({
    entryMode: setup.entry_mode,
    orderType: setup.order_type,
    limitPrice: entry.limit_price,
    stopPrice: entry.stop_price,
  });
  for (const error of entryOrder.errors) {
    errors.push(issue(error.code, {
      setup_id: setupId,
      ...error,
    }));
  }
  const conditions = array(setup.conditions);
  const activationCount = conditions.filter((condition) => {
    const role = enumValue(condition?.role);
    const importance = enumValue(condition?.importance);
    return role === "ACTIVATION"
      || importance === "MANDATORY"
      || condition?.required_for_trigger === true;
  }).length;
  if (activationCount === 0) {
    errors.push(issue("STRUCTURED_ACTIVATION_CONDITION_MISSING", { setup_id: setupId }));
  }

  validateUniqueValues(
    conditions.map((condition) => text(condition?.condition_id)),
    "CONDITION_ID",
    errors,
    { setup_id: setupId },
  );
  const byId = new Map(
    conditions
      .map((condition) => [text(condition?.condition_id), object(condition)])
      .filter(([conditionId]) => conditionId),
  );
  const dependency = new Map();
  for (const condition of conditions) {
    if (enumValue(condition?.predicate_type) !== "BREAK_RETEST_SEQUENCE") continue;
    const conditionId = text(condition.condition_id);
    const breakConditionId = text(
      condition.break_condition_id || condition.parameters?.break_condition_id,
    );
    if (!breakConditionId || !byId.has(breakConditionId)) {
      errors.push(issue("BREAK_CONDITION_REFERENCE_NOT_FOUND", {
        setup_id: setupId,
        condition_id: conditionId,
        break_condition_id: breakConditionId || null,
      }));
      continue;
    }
    dependency.set(conditionId, breakConditionId);
  }
  for (const conditionId of dependency.keys()) {
    if (hasCycle(conditionId, dependency)) {
      errors.push(issue("CONDITION_DEPENDENCY_CYCLE", {
        setup_id: setupId,
        condition_id: conditionId,
      }));
    }
  }
}

function validateMasterSourceCoherence(masterSourceValue, planSourceValue, errors) {
  const masterSource = object(masterSourceValue);
  const planSource = object(planSourceValue);
  const pairs = [
    ["master_analysis_id", masterSource.analysis_id || masterSource.master_analysis_id, planSource.master_analysis_id],
    ["bundle_id", masterSource.bundle_id, planSource.bundle_id],
    ["pack_id", masterSource.pack_id, planSource.pack_id],
    ["pack_build_id", masterSource.pack_build_id, planSource.pack_build_id],
  ];
  for (const [field, masterValue, planValue] of pairs) {
    validateExactLink("MASTER_PLAN_SOURCE_MISMATCH", field, masterValue, planValue, errors);
  }
}

function validateExactLink(code, field, leftValue, rightValue, errors) {
  const left = text(leftValue);
  const right = text(rightValue);
  if (!left || !right || left === right) return;
  errors.push(issue(code, {
    field,
    left_value: left,
    right_value: right,
  }));
}

function validateMonitorScopeCoherence(monitorScopeValue, commandScopeValue, errors) {
  const monitorScope = object(monitorScopeValue);
  const commandScope = object(commandScopeValue);
  for (const field of [
    "mode",
    "trading_date",
    "session",
    "run_id",
    "cutoff_paris",
    "timezone",
  ]) {
    const monitorValue = monitorScope[field];
    const commandValue = commandScope[field];
    if (monitorValue !== undefined
      && commandValue !== undefined
      && String(monitorValue) !== String(commandValue)) {
      errors.push(issue("MONITOR_SCOPE_MISMATCH", {
        field,
        monitor_value: monitorValue,
        command_value: commandValue,
      }));
    }
  }
}

function validateScopeCoherence(outerScope, planScope, errors) {
  const outer = object(outerScope);
  const inner = object(planScope);
  for (const key of [
    "mode",
    "trading_date",
    "session",
    "run_id",
    "cutoff_paris",
    "timezone",
  ]) {
    if (outer[key] !== undefined
      && inner[key] !== undefined
      && String(outer[key]) !== String(inner[key])) {
      errors.push(issue("PLAN_SCOPE_MISMATCH", {
        field: key,
        outer_value: outer[key],
        plan_value: inner[key],
      }));
    }
  }
}

function validateWindow(value, domain, errors, setupId = null) {
  const window = object(value);
  const validFrom = Date.parse(window.valid_from_paris || "");
  const expiresAt = Date.parse(window.expires_at_paris || "");
  if (!Number.isFinite(validFrom) || !Number.isFinite(expiresAt) || validFrom >= expiresAt) {
    errors.push(issue(`${domain}_VALIDITY_WINDOW_INVALID`, {
      setup_id: setupId,
      valid_from_paris: window.valid_from_paris || null,
      expires_at_paris: window.expires_at_paris || null,
    }));
  }
}

function validateUniqueValues(values, label, errors, evidence = {}) {
  const seen = new Set();
  for (const value of values) {
    if (value === null || value === undefined || value === "") {
      errors.push(issue(`${label}_MISSING`, evidence));
      continue;
    }
    const key = String(value);
    if (seen.has(key)) errors.push(issue(`${label}_DUPLICATE`, { ...evidence, value }));
    seen.add(key);
  }
}

function hasCycle(start, dependency) {
  const visited = new Set();
  let current = start;
  while (dependency.has(current)) {
    if (visited.has(current)) return true;
    visited.add(current);
    current = dependency.get(current);
  }
  return false;
}

function isNativeMaster(master, plan) {
  return (
    master.contract?.name === "DeskMasterAnalysisContract"
      && master.contract?.version === ACTIVE_NATIVE_CONTRACT_VERSIONS.master
  ) || (
    plan.contract?.name === "DeskExecutionPlanContract"
      && plan.contract?.version === ACTIVE_NATIVE_CONTRACT_VERSIONS.execution_plan
  );
}

function validateNativeMasterRuntimeVersion(master, plan) {
  return validateNativeRuntimeVersion([
    {
      component: "master",
      recognized: master.contract?.name === "DeskMasterAnalysisContract",
      received: master.contract?.version,
    },
    {
      component: "execution_plan",
      recognized: plan.contract?.name === "DeskExecutionPlanContract",
      received: plan.contract?.version,
    },
  ]);
}

function validateNativeMonitorRuntimeVersion(monitor, command) {
  return validateNativeRuntimeVersion([
    {
      component: "monitor",
      recognized: monitor.contract?.name === "DeskHourlyThesisMonitorContract",
      received: monitor.contract?.version,
    },
    {
      component: "monitor_command",
      recognized: command.contract?.name === "DeskMonitorCommandContract",
      received: command.contract?.version,
    },
  ]);
}

function validateNativeRuntimeVersion(components) {
  const recognized = components.filter((component) => component.recognized);
  if (recognized.length === 0) return null;

  const historical = recognized.filter((component) => (
    HISTORICAL_NATIVE_CONTRACT_VERSIONS[component.component]?.has(String(component.received || ""))
  ));
  if (historical.length > 0) {
    return issue("HISTORICAL_NATIVE_CONTRACT_READ_ONLY", {
      received: Object.fromEntries(recognized.map((component) => [
        component.component,
        component.received || null,
      ])),
      expected: Object.fromEntries(recognized.map((component) => [
        component.component,
        ACTIVE_NATIVE_CONTRACT_VERSIONS[component.component],
      ])),
      historical_components: historical.map((component) => component.component),
    });
  }

  const unsupported = recognized.filter((component) => (
    String(component.received || "") !== ACTIVE_NATIVE_CONTRACT_VERSIONS[component.component]
  ));
  if (unsupported.length > 0) {
    return issue("NATIVE_CONTRACT_VERSION_UNSUPPORTED", {
      received: Object.fromEntries(recognized.map((component) => [
        component.component,
        component.received || null,
      ])),
      expected: Object.fromEntries(recognized.map((component) => [
        component.component,
        ACTIVE_NATIVE_CONTRACT_VERSIONS[component.component],
      ])),
      unsupported_components: unsupported.map((component) => component.component),
    });
  }
  return null;
}

function issue(code, evidence = null) {
  return { code, evidence };
}

function dedupe(errors) {
  const seen = new Set();
  return errors.filter((error) => {
    const key = `${error.code}:${JSON.stringify(error.evidence || null)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function enumValue(value) {
  return text(value).toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
}
