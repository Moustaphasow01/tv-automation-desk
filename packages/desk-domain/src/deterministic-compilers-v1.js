import { canonicalSha256 } from "./execution-scope.js";
import {
  normalizeContractOrderTypeV1,
  normalizeEntryModeV1,
  validateEntryOrderSemanticsV1,
} from "./entry-order-semantics-v1.js";
import {
  acceptCanonicalMasterPlanV1,
  isCanonicalMasterPlanV1,
  normalizeTransportMode,
} from "./canonical-plan-ingress-v1.js";
import {
  HARD_GATE_CODES_V5,
  HARD_GATE_ENFORCEMENT_PHASES_V5,
  SOFT_GATE_CODES_V5,
  canonicalOpportunityGateCodeV1,
  classifyOpportunityGateV1,
  evaluateCanonicalGeometry,
  evaluateOpportunitySeekingControlledV1,
  OPPORTUNITY_SEEKING_CONTROLLED,
} from "./opportunity-policy-v1.js";
import {
  SETUP_COMMANDS_V1,
  transitionSetupStateV1,
} from "./setup-state-machine-v1.js";
import {
  THESIS_COMMANDS_V1,
  normalizeThesisStateV1,
  transitionThesisStateV1,
} from "./thesis-state-machine-v1.js";
import {
  POSITION_REQUESTS_V1,
} from "./position-state-machine-v1.js";
import {
  REPLAN_EVENTS_V1,
  transitionReplanStateV1,
} from "./replan-state-machine-v1.js";
import { numberOrNull } from "./setup-shape.js";

export const MASTER_PLAN_SCHEMA_VERSION_V1 = "deterministic_execution_plan_v1_4";
export const MONITOR_COMMAND_SCHEMA_VERSION_V1 = "desk_monitor_command_v1_4";
export const DETERMINISTIC_COMPILER_VERSION_V1 = "1.4.0";

const HARD_GATE_CODE_SET_V1 = new Set(HARD_GATE_CODES_V5);
const SOFT_GATE_CODE_SET_V1 = new Set(SOFT_GATE_CODES_V5);
const BLOCKING_GATE_STATES_V1 = new Set(["FAIL", "UNKNOWN"]);

const MASTER_SETUP_ARRAY_PATHS = Object.freeze([
  ["setups"],
  ["ranked_setups"],
  ["setup_candidates"],
  ["deterministic_execution_plan", "setups"],
  ["execution_plan", "setups"],
  ["final_decision", "setups"],
  ["decision_executable", "setups"],
]);

const MONITOR_ACTION_ALIASES = Object.freeze({
  MAINTAIN: "MAINTAIN_THESIS",
  MAINTAIN_THESIS: "MAINTAIN_THESIS",
  WAIT: "WAIT_MORE",
  WAIT_MORE: "WAIT_MORE",
  SETUP_CANDIDATE: "SETUP_CANDIDATE",
  PRE_ARM: "PRE_ARM",
  PRE_ARMED: "PRE_ARM",
  ARM: "ARM_SETUP",
  ARMED: "ARM_SETUP",
  SETUP_ARMED: "ARM_SETUP",
  ARM_SETUP: "ARM_SETUP",
  TRIGGER_GO: "ARM_SETUP",
  CANCEL: "CANCEL_SETUP",
  CANCEL_SETUP: "CANCEL_SETUP",
  WEAKEN: "WEAKEN_THESIS",
  WEAKEN_THESIS: "WEAKEN_THESIS",
  MARK_AT_RISK: "MARK_AT_RISK",
  INVALIDATE: "INVALIDATE_THESIS",
  INVALIDATE_THESIS: "INVALIDATE_THESIS",
  TRANSFORM: "TRANSFORM_SCENARIO",
  TRANSFORM_SCENARIO: "TRANSFORM_SCENARIO",
  REDUCE: "REDUCE_RISK",
  REDUCE_RISK: "REDUCE_RISK",
  MOVE_STOP_BE: "MOVE_STOP_BE",
  BREAK_EVEN: "MOVE_STOP_BE",
  TAKE_PARTIAL: "TAKE_PARTIAL",
  PARTIAL: "TAKE_PARTIAL",
  EXIT: "EXIT_POSITION",
  EXIT_POSITION: "EXIT_POSITION",
  REPLAN: "REPLAN_FULL",
  REPLAN_REQUIRED: "REPLAN_FULL",
  REPLAN_FULL: "REPLAN_FULL",
  EXPIRE: "EXPIRE_SETUP",
  EXPIRE_SETUP: "EXPIRE_SETUP",
  NO_ACTION: "NO_ACTION",
  NOOP: "NO_ACTION",
});

export function compileMasterPlanV1(rawMaster = {}, {
  scope = {},
  sourceMode = null,
  policy = OPPORTUNITY_SEEKING_CONTROLLED,
} = {}) {
  const masterEnvelope = asObject(rawMaster);
  const embeddedPlan = asObject(masterEnvelope.deterministic_execution_plan);
  const master = isCanonicalMasterPlanV1(embeddedPlan) ? embeddedPlan : masterEnvelope;
  if (isCanonicalMasterPlanV1(master)) {
    return acceptCanonicalMasterPlanV1(master, { sourceMode, scope });
  }
  const diagnostics = diagnosticCollector();
  const sourceReference = {
    contract_name: text(master.contract_name) || "DeskMasterAnalysisContract",
    contract_version: text(master.schema_version || master.contract_version) || null,
    analysis_id: text(master.analysis_id || master.master_id || master.report_id) || null,
    decision_id: text(master.decision_id || master.final_decision?.decision_id) || null,
    timestamp_paris: text(
      master.timestamp_paris
        || master.decision_timestamp_paris
        || master.data_cutoff_paris
        || scope.cutoff_paris,
    ) || null,
  };
  const thesisSource = asObject(master.active_thesis || master.thesis || master.final_decision?.active_thesis);
  const thesisState = normalizeThesisStateV1(thesisSource.status || inferMasterThesisState(master));
  const thesisCommand = masterThesisCommand(thesisState);
  const primarySetupId = text(
    thesisSource.primary_setup_id
      || master.primary_setup_id
      || master.execution_plan?.primary_setup_id,
  ) || null;
  const gates = normalizeCanonicalGateSetV1(
    master.execution_plan?.gates
      || master.deterministic_execution_plan?.gates
      || master.gates
      || master.decision_gates
      || [],
    { source: "MASTER_EXECUTION_PLAN" },
  );
  assertCanonicalHardGateCoverageV1(gates, diagnostics, "MASTER");
  for (const gate of blockingCanonicalGatesAtPhase(gates, "PLAN_COMPILE")) {
    diagnostics.error("PLAN_HARD_GATE_BLOCKED", {
      gate_code: gate.code,
      gate_state: gate.state,
      enforcement_phase: gate.enforcement_phase,
    });
  }
  const setupSources = extractMasterSetups(master);
  if (setupSources.length > 5) {
    diagnostics.error("MASTER_SETUP_PORTFOLIO_LIMIT_EXCEEDED", {
      maximum: 5,
      actual: setupSources.length,
    });
  }
  const setups = setupSources
    .slice(0, 5)
    .map((setup, index) => compileCanonicalSetupV1(setup, {
      index,
      master,
      thesisSource,
      policy,
      diagnostics,
      sourceKind: "master",
      gates,
    }))
    .sort((left, right) => left.rank - right.rank || left.setup_id.localeCompare(right.setup_id));
  for (const setup of setups) {
    if (setup.compile_status !== "REJECTED") continue;
    const evidence = {
      setup_id: setup.setup_id,
      errors: setup.compilation_diagnostics.errors,
      hard_failures: setup.gate_evaluation.hard_failures,
    };
    if (setup.setup_id === primarySetupId) diagnostics.error("PRIMARY_SETUP_NOT_COMPILED", evidence);
    else diagnostics.warning("SECONDARY_SETUP_REJECTED", evidence);
  }
  const noSetupProof = normalizeNoSetupProof(
    master.no_setup_proof
      || master.final_decision?.no_setup_proof
      || master.final_sections?.no_setup_proof,
  );
  const proofValid = validateNoSetupProof(noSetupProof, diagnostics);
  const executableSetups = setups.filter((setup) => setup.compile_status === "COMPILED");
  const planId = text(
    master.plan_id
      || master.execution_plan?.plan_id
      || master.deterministic_execution_plan?.plan_id
      || thesisSource.plan_id,
  ) || null;
  const thesisPlanId = text(thesisSource.plan_id || master.plan_id) || null;
  if (!planId) diagnostics.error("PLAN_ID_MISSING");
  if (!thesisPlanId) diagnostics.error("THESIS_PLAN_ID_MISSING");
  if (planId && thesisPlanId && planId !== thesisPlanId) {
    diagnostics.error("THESIS_PLAN_ID_MISMATCH", {
      plan_id: planId,
      thesis_plan_id: thesisPlanId,
    });
  }

  if (setups.length === 0 && !proofValid) {
    diagnostics.error("MASTER_MISSING_SETUP_OR_NO_SETUP_PROOF");
  }
  if (setups.length > 0 && executableSetups.length === 0 && !proofValid) {
    diagnostics.error("MASTER_HAS_NO_EXECUTABLE_SETUP");
  }

  const canonical = {
    schema_version: MASTER_PLAN_SCHEMA_VERSION_V1,
    plan_id: planId,
    compiler_version: DETERMINISTIC_COMPILER_VERSION_V1,
    disposition: normalizeEnum(
      master.plan_disposition
        || master.execution_plan?.disposition
        || master.deterministic_execution_plan?.disposition
        || "MANAGEMENT_ONLY",
    ),
    source_reference: sourceReference,
    analytical_scope: canonicalAnalyticalScope(scope, master),
    policy: canonicalPolicy(policy),
    gates,
    thesis_plan: {
      thesis_id: text(thesisSource.thesis_id || master.thesis_id) || null,
      plan_id: thesisPlanId,
      primary_setup_id: primarySetupId,
      current_state: thesisState,
      command: thesisCommand,
      valid_from_paris: text(thesisSource.valid_from || thesisSource.valid_from_paris) || sourceReference.timestamp_paris,
      valid_until_paris: text(thesisSource.valid_until || thesisSource.valid_until_paris) || null,
      requires_replan_after_paris: text(thesisSource.requires_replan_after) || null,
      instrument: normalizeInstrument(thesisSource.instrument || master.instrument),
      direction: normalizeDirection(thesisSource.direction || master.direction),
    },
    ranked_setups: setups,
    no_setup_proof: proofValid ? noSetupProof : null,
    opportunity_diagnostic: setups.length === 0
      ? proofValid ? "VALID_NO_OPPORTUNITY_PROOF" : "INVALID_NO_EXECUTABLE_SETUP"
      : executableSetups.length > 0 ? "EXECUTABLE_OPPORTUNITIES_COMPILED" : "INVALID_NO_EXECUTABLE_SETUP",
    diagnostics: diagnostics.snapshot(),
  };
  const canonicalHash = canonicalSha256(canonical);
  return {
    ...canonical,
    canonical_hash: canonicalHash,
    valid: canonical.diagnostics.errors.length === 0,
    transport_context: {
      source_mode: normalizeTransportMode(sourceMode || scope.mode || master.mode),
    },
  };
}

export function compileMonitorCommandV1(rawMonitor = {}, {
  currentState = {},
  scope = {},
  sourceMode = null,
  policy = OPPORTUNITY_SEEKING_CONTROLLED,
} = {}) {
  const monitor = asObject(rawMonitor);
  const diagnostics = diagnosticCollector();
  const gates = normalizeCanonicalGateSetV1(
    monitor.gates
      || (monitor.data_quality && typeof monitor.data_quality === "object"
        ? {
          hard: monitor.data_quality.hard_gate_states,
          soft: monitor.data_quality.soft_gate_states,
        }
        : monitor.decision_gates)
      || [],
    { source: "MONITOR_DATA_QUALITY" },
  );
  assertCanonicalHardGateCoverageV1(gates, diagnostics, "MONITOR");
  for (const gate of blockingCanonicalGatesAtPhase(gates, "PLAN_COMPILE")) {
    diagnostics.error("MONITOR_HARD_GATE_BLOCKED", {
      gate_code: gate.code,
      gate_state: gate.state,
      enforcement_phase: gate.enforcement_phase,
    });
  }
  const actionResolution = resolveMonitorAction(monitor, diagnostics);
  const sourceAction = actionResolution.source_action;
  const action = actionResolution.canonical_action;
  if (sourceAction === "TRIGGER_GO") {
    diagnostics.normalization("GPT_TRIGGER_GO_NORMALIZED_TO_ARM_SETUP", {
      requested_action: sourceAction,
      canonical_action: action,
    });
  }

  const thesisCommand = monitorThesisCommand(action, monitor);
  const setupCommand = monitorSetupCommand(action, monitor);
  const positionRequest = monitorPositionRequest(action, monitor);
  const replanRequest = monitorReplanRequest(action, monitor);
  const currentThesisState = normalizeThesisStateV1(
    currentState.thesis?.state || currentState.thesis?.status || currentState.thesis_state || "NO_ACTIVE",
  );
  const currentSetupState = normalizeSetupState(
    currentState.setup?.state || currentState.setup?.status || currentState.setup_state || "NONE",
  );
  const currentReplanState = normalizeEnum(
    currentState.replan?.state || currentState.replan_state || "IDLE",
  );
  const thesisTransition = transitionThesisStateV1({
    currentState: currentThesisState,
    command: thesisCommand.type,
  });
  const setupTransition = transitionSetupStateV1({
    currentState: currentSetupState,
    command: setupCommand.type,
    authority: "GPT",
  });
  const replanTransition = transitionReplanStateV1({
    currentState: currentReplanState,
    event: replanRequest.type,
  });
  for (const transition of [thesisTransition, setupTransition, replanTransition]) {
    if (!transition.accepted) {
      diagnostics.error("STATE_TRANSITION_REJECTED", {
        domain: transition.domain,
        reason: transition.reason,
        previous_state: transition.previous_state,
        command: transition.command || transition.event,
      });
    }
  }
  if (positionRequest.type !== POSITION_REQUESTS_V1.NONE && !hasActivePosition(currentState.position)) {
    diagnostics.error("POSITION_REQUEST_WITHOUT_ACTIVE_POSITION", {
      request: positionRequest.type,
    });
  }

  const monitorSetupSource = extractMonitorSetup(monitor);
  const compiledSetup = Object.keys(monitorSetupSource).length > 0
    ? compileCanonicalSetupV1(monitorSetupSource, {
      index: 0,
      master: monitor,
      thesisSource: asObject(monitor.active_thesis_update || monitor.thesis_update),
      policy,
      diagnostics,
      sourceKind: "monitor",
      existingSetup: asObject(currentState.setup),
      forcedStatus: setupCommand.type === SETUP_COMMANDS_V1.ARM ? "ARMED_CONDITIONAL" : null,
      gates,
    })
    : null;
  if ([SETUP_COMMANDS_V1.UPSERT_CANDIDATE, SETUP_COMMANDS_V1.PRE_ARM, SETUP_COMMANDS_V1.ARM].includes(setupCommand.type)
    && !compiledSetup) {
    diagnostics.error("SETUP_COMMAND_PAYLOAD_MISSING", { command: setupCommand.type });
  }

  const thesisUpdate = normalizeThesisUpdate(monitor, diagnostics);
  const planId = text(
    monitor.plan_id
      || monitor.links?.plan_id
      || monitor.command?.plan_id,
  ) || null;
  if (!planId) diagnostics.error("PLAN_ID_MISSING");
  const canonical = {
    schema_version: MONITOR_COMMAND_SCHEMA_VERSION_V1,
    plan_id: planId,
    compiler_version: DETERMINISTIC_COMPILER_VERSION_V1,
    source_reference: {
      contract_name: text(monitor.contract_name) || "DeskHourlyThesisMonitorContract",
      contract_version: text(monitor.schema_version || monitor.contract_version) || null,
      monitor_id: text(monitor.monitor_id) || null,
      linked_master_analysis_id: text(monitor.linked_master_analysis_id || monitor.master_id) || null,
      linked_active_thesis_id: text(monitor.linked_active_thesis_id || monitor.thesis_id) || null,
      timestamp_paris: text(monitor.timestamp_paris || monitor.checkpoint_paris || scope.cutoff_paris) || null,
    },
    analytical_scope: canonicalAnalyticalScope(scope, monitor),
    policy: canonicalPolicy(policy),
    gates,
    source_action: sourceAction,
    canonical_action: action,
    thesis_command: {
      ...thesisCommand,
      payload: thesisUpdate,
    },
    setup_command: {
      ...setupCommand,
      setup_id: compiledSetup?.setup_id
        || text(currentState.setup?.setup_id || monitor.monitor_decision?.setup_id)
        || null,
      replaces_setup_id: compiledSetup?.replaces_setup_id
        || text(monitor.monitor_decision?.replaces_setup_id)
        || null,
      setup: compiledSetup,
    },
    position_request: positionRequest,
    replan_request: replanRequest,
    transitions: {
      thesis: thesisTransition,
      setup: setupTransition,
      replan: replanTransition,
    },
    alert: normalizeAliasedObject(monitor, "alert_payload", "alert", diagnostics),
    context_transmission: normalizeAliasedObject(
      monitor,
      "monitor_context_transmission",
      "context_transmission",
      diagnostics,
    ),
    diagnostics: diagnostics.snapshot(),
  };
  const canonicalHash = canonicalSha256(canonical);
  return {
    ...canonical,
    canonical_hash: canonicalHash,
    valid: canonical.diagnostics.errors.length === 0,
    transport_context: {
      source_mode: normalizeTransportMode(sourceMode || scope.mode || monitor.mode),
    },
  };
}

function compileCanonicalSetupV1(source, {
  index,
  master,
  thesisSource,
  policy,
  diagnostics,
  sourceKind,
  existingSetup = {},
  forcedStatus = null,
  gates = null,
}) {
  const raw = asObject(source);
  const setupId = text(raw.setup_id || raw.id || existingSetup.setup_id)
    || `setup_${index + 1}`;
  const direction = normalizeDirection(raw.direction || raw.side || existingSetup.direction);
  const entry = normalizeEntry(raw, existingSetup);
  const entryMode = normalizeEntryModeV1(raw.entry_mode || existingSetup.entry_mode);
  const orderType = normalizeContractOrderTypeV1(raw.order_type || existingSetup.order_type);
  const explicitOrderStopPrice = numberOrNull(
    raw.entry_stop_price ?? raw.order_stop_price ?? existingSetup.order_stop_price,
  );
  const explicitOrderLimitPrice = numberOrNull(
    raw.entry_limit_price ?? raw.order_limit_price ?? existingSetup.order_limit_price,
  );
  const orderStopPrice = orderType === "STOP"
    ? explicitOrderStopPrice ?? entry.entry_price
    : explicitOrderStopPrice;
  const orderLimitPrice = orderType === "LIMIT"
    ? explicitOrderLimitPrice ?? entry.entry_price
    : explicitOrderLimitPrice;
  const entryOrderSemantics = validateEntryOrderSemanticsV1({
    entryMode,
    orderType,
    stopPrice: orderStopPrice,
    limitPrice: orderLimitPrice,
  });
  const stopLoss = numberOrNull(raw.stop_loss ?? raw.stop ?? raw.sl ?? existingSetup.stop_loss);
  const takeProfit1 = normalizeTarget(raw, existingSetup);
  const targets = normalizeTargets(raw, existingSetup);
  const rawConditions = extractSetupConditions(raw, thesisSource);
  const compiledConditions = [];
  for (let conditionIndex = 0; conditionIndex < rawConditions.length; conditionIndex += 1) {
    const condition = rawConditions[conditionIndex];
    if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
      diagnostics.warning("UNSTRUCTURED_CONDITION_NOT_COMPILED", {
        setup_id: setupId,
        index: conditionIndex,
      });
      continue;
    }
    compiledConditions.push(compileCondition(condition, conditionIndex, raw, policy, diagnostics));
  }
  const explicitInvalidations = firstArray(
    raw.invalidation_conditions,
    raw.invalidations,
    thesisSource?.invalidation_conditions,
  );
  for (let conditionIndex = 0; conditionIndex < explicitInvalidations.length; conditionIndex += 1) {
    const condition = explicitInvalidations[conditionIndex];
    if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
      diagnostics.warning("UNSTRUCTURED_INVALIDATION_NOT_COMPILED", {
        setup_id: setupId,
        index: conditionIndex,
      });
      continue;
    }
    compiledConditions.push(compileCondition({
      ...condition,
      role: "INVALIDATION",
      effect: "BLOCK_IF_TRUE",
      importance: "HARD_BLOCKER",
      required_for_trigger: false,
      memory_policy: "INVALIDATE_TERMINAL",
    }, compiledConditions.length, raw, policy, diagnostics));
  }
  const atomicConditions = normalizeAtomicSequenceConditions(
    compiledConditions,
    diagnostics,
    setupId,
  );
  const requestedStatus = forcedStatus || normalizeSetupState(
    raw.status || raw.lifecycle_status || raw.setup_status || raw.decision,
  );
  const structuredActivationCount = atomicConditions.filter((condition) => (
    condition.effect === "REQUIRE_TRUE"
      && (condition.role === "ACTIVATION" || condition.required_for_trigger === true)
  )).length;
  const setupCompilationErrors = [
    ...(structuredActivationCount === 0
      ? [{ code: "STRUCTURED_ACTIVATION_CONDITION_MISSING", evidence: { setup_id: setupId } }]
      : []),
    ...entryOrderSemantics.errors.map((error) => ({ code: error.code, evidence: { setup_id: setupId, ...error } })),
  ];
  const validFrom = text(
    existingSetup.valid_from_paris
      || raw.valid_from_paris
      || raw.valid_from
      || thesisSource?.valid_from_paris
      || thesisSource?.valid_from
      || master.timestamp_paris
      || master.data_cutoff_paris,
  ) || null;
  if (existingSetup.setup_id === setupId
    && existingSetup.valid_from_paris
    && raw.valid_from_paris
    && existingSetup.valid_from_paris !== raw.valid_from_paris) {
    diagnostics.normalization("SETUP_VALID_FROM_PRESERVED", {
      setup_id: setupId,
      ignored_value: raw.valid_from_paris,
      preserved_value: existingSetup.valid_from_paris,
    });
  }
  const expiresAt = text(
    raw.expires_at_paris
      || raw.expires_at
      || raw.valid_until
      || thesisSource?.setup_expiry_time
      || thesisSource?.valid_until
      || existingSetup.expires_at_paris,
  ) || null;
  const canonical = {
    setup_id: setupId,
    rank: positiveInteger(raw.rank ?? raw.priority, index + 1),
    status: requestedStatus,
    instrument: normalizeInstrument(raw.instrument || raw.contract || existingSetup.instrument),
    direction,
    order_type: orderType,
    entry_mode: entryMode,
    order_limit_price: orderLimitPrice,
    order_stop_price: orderStopPrice,
    ...(entry.entry_price !== null ? { entry_price: entry.entry_price } : {}),
    ...(entry.entry_zone ? { entry_zone: entry.entry_zone } : {}),
    stop_loss: stopLoss,
    take_profit_1: targets[0]?.price ?? takeProfit1,
    targets,
    rr_minimum: numberOrNull(raw.rr_minimum ?? raw.rr ?? existingSetup.rr_minimum) ?? policy.min_rr,
    risk_pct: numberOrNull(raw.risk_pct ?? raw.risk_percent ?? existingSetup.risk_pct),
    valid_from_paris: validFrom,
    expires_at_paris: expiresAt,
    conditions: atomicConditions,
    trigger_policy: {
      min_score: policy.weighted_confirmation_threshold,
      allow_entry_only: false,
      backend_can_trigger: false,
      threshold_tolerance_points: Math.max(
        0,
        numberOrNull(raw.trigger_policy?.threshold_tolerance_points ?? raw.tolerance_points) ?? 0,
      ),
    },
    management_policy: normalizeManagementPolicy(raw.management_policy || raw.management_rules),
    replaces_setup_id: text(raw.replaces_setup_id) || null,
    source_kind: sourceKind,
  };
  const requestedMinScore = numberOrNull(raw.trigger_policy?.min_score ?? raw.min_score);
  if (requestedMinScore !== null && requestedMinScore !== policy.weighted_confirmation_threshold) {
    diagnostics.normalization("GPT_MIN_SCORE_OVERRIDDEN_BY_POLICY", {
      setup_id: setupId,
      requested: requestedMinScore,
      applied: policy.weighted_confirmation_threshold,
    });
  }
  const geometry = evaluateCanonicalGeometry(canonical, policy);
  const canonicalGates = Array.isArray(gates)
    ? gates
    : normalizeCanonicalGateSetV1(
      raw.gates || raw.decision_gates || master.gates || master.decision_gates || [],
      { source: sourceKind === "monitor" ? "MONITOR_DATA_QUALITY" : "MASTER_EXECUTION_PLAN" },
    );
  const gateEvaluation = evaluateOpportunitySeekingControlledV1({
    setup: canonical,
    conditionEvaluation: {},
    gates: canonicalGates,
    policy,
    phase: "PLAN_COMPILE",
  });
  const armEvaluation = evaluateOpportunitySeekingControlledV1({
    setup: canonical,
    conditionEvaluation: {},
    gates: canonicalGates,
    policy,
    phase: "SETUP_ARM",
  });
  const compiled = gateEvaluation.eligible && setupCompilationErrors.length === 0;
  const appliedStatus = requestedStatus === "ARMED_CONDITIONAL" && compiled && armEvaluation.eligible
    ? "ARMED_CONDITIONAL"
    : requestedStatus === "SETUP_CANDIDATE"
      ? "SETUP_CANDIDATE"
      : "PRE_ARMED";
  return {
    ...canonical,
    gates: canonicalGates,
    status: appliedStatus,
    trigger_policy: {
      ...canonical.trigger_policy,
      backend_can_trigger: appliedStatus === "ARMED_CONDITIONAL" && compiled,
    },
    compile_status: compiled ? "COMPILED" : "REJECTED",
    compilation_diagnostics: {
      errors: setupCompilationErrors,
      warnings: [],
      normalizations: [],
    },
    geometry_evaluation: geometry,
    gate_evaluation: gateEvaluation,
    arm_gate_evaluation: armEvaluation,
  };
}

function compileCondition(condition, index, setup, policy, diagnostics) {
  const importance = normalizeEnum(
    condition.importance
      || condition.priority_class
      || (condition.required_for_trigger === true ? "MANDATORY" : "SECONDARY"),
  );
  const rawEffect = normalizeEnum(condition.effect);
  const rawRole = normalizeEnum(condition.role);
  const isBlocker = importance === "HARD_BLOCKER"
    || ["INVALIDATION", "VETO"].includes(rawRole)
    || rawEffect === "BLOCK_IF_TRUE";
  if (isBlocker && condition.required_for_trigger === true) {
    diagnostics.normalization("CONTRADICTORY_BLOCKER_REQUIRED_FLAG_REMOVED", {
      condition_id: condition.condition_id || condition.id || `condition_${index + 1}`,
    });
  }
  const operator = normalizeEnum(condition.operator || condition.comparator || condition.kind);
  const predicateType = normalizeEnum(condition.predicate_type || inferPredicateType(operator));
  const threshold = numberOrNull(condition.threshold ?? condition.level ?? condition.price ?? condition.value);
  return {
    condition_id: text(condition.condition_id || condition.id) || `condition_${index + 1}`,
    label: text(condition.label || condition.name || condition.description) || null,
    predicate_type: predicateType,
    role: isBlocker ? rawRole || "VETO" : rawRole || (importance === "MANDATORY" ? "ACTIVATION" : "CONFIRMATION"),
    effect: isBlocker ? "BLOCK_IF_TRUE" : "REQUIRE_TRUE",
    instrument: normalizeInstrument(condition.instrument || condition.contract || setup.instrument),
    timeframe: normalizeEnum(condition.timeframe || condition.interval || "M1"),
    operator,
    threshold,
    parameters: asObject(condition.parameters),
    evidence_refs: arrayOfValues(condition.evidence_refs),
    importance: isBlocker ? "HARD_BLOCKER" : normalizeImportance(importance),
    required_for_trigger: isBlocker
      ? false
      : condition.required_for_trigger === true || importance === "MANDATORY" || rawRole === "ACTIVATION",
    memory_policy: isBlocker
      ? normalizeBlockerMemoryPolicy(condition.memory_policy, rawRole)
      : normalizeMemoryPolicy(condition.memory_policy),
    weight: isBlocker ? 0 : Math.max(0, numberOrNull(condition.weight) ?? defaultConditionWeight(importance)),
    sequence: positiveIntegerOrNull(condition.sequence),
    tolerance_points: Math.max(
      0,
      numberOrNull(condition.tolerance_points ?? condition.tolerance ?? setup.trigger_policy?.threshold_tolerance_points) ?? 0,
    ),
    temporal_rule: normalizeTemporalRule(condition.temporal_rule),
    break_condition_id: text(condition.break_condition_id) || null,
    max_bars: positiveIntegerOrNull(condition.max_bars || condition.temporal_rule?.max_bars),
    policy_threshold: policy.weighted_confirmation_threshold,
  };
}

function normalizeAtomicSequenceConditions(conditions, diagnostics, setupId) {
  const sequences = conditions.filter((condition) => (
    condition.predicate_type === "BREAK_RETEST_SEQUENCE"
      && condition.effect === "REQUIRE_TRUE"
  ));
  if (!sequences.length) return conditions;

  return conditions.map((condition) => {
    if (condition.effect !== "REQUIRE_TRUE") return condition;
    if (!["ZONE_TOUCH", "REJECTION_PATTERN", "PRICE_RELATION"].includes(condition.predicate_type)) {
      return condition;
    }
    const sequence = sequences.find((candidate) => atomicSequenceSubsumesCondition(
      candidate,
      condition,
    ));
    if (!sequence) return condition;
    diagnostics.normalization("ATOMIC_SEQUENCE_COMPONENT_SUBSUMED", {
      setup_id: setupId,
      condition_id: condition.condition_id,
      subsumed_by_condition_id: sequence.condition_id,
    });
    return {
      ...condition,
      required_for_trigger: false,
      importance: "ADVISORY",
      weight: 0,
      memory_policy: "LATCH_UNTIL_TRIGGER",
      atomic_component: true,
      subsumed_by_condition_id: sequence.condition_id,
    };
  });
}

function atomicSequenceSubsumesCondition(sequence, condition) {
  if (sequence.instrument !== condition.instrument
    || sequence.timeframe !== condition.timeframe) {
    return false;
  }
  if (condition.predicate_type === "REJECTION_PATTERN"
    && sequence.parameters?.require_rejection_confirmation === false) {
    return false;
  }
  const sequenceLevel = numberOrNull(
    sequence.parameters?.retest_level
      ?? sequence.threshold,
  );
  const componentLower = numberOrNull(
    condition.parameters?.zone_lower
      ?? condition.parameters?.threshold
      ?? condition.threshold,
  );
  const componentUpper = numberOrNull(
    condition.parameters?.zone_upper
      ?? condition.parameters?.threshold
      ?? condition.threshold,
  );
  if (sequenceLevel === null || (componentLower === null && componentUpper === null)) {
    return false;
  }
  const tolerance = Math.max(
    0,
    numberOrNull(sequence.parameters?.tolerance_points ?? sequence.tolerance_points) ?? 0,
    numberOrNull(condition.parameters?.tolerance_points ?? condition.tolerance_points) ?? 0,
  );
  const lower = Math.min(componentLower ?? componentUpper, componentUpper ?? componentLower);
  const upper = Math.max(componentLower ?? componentUpper, componentUpper ?? componentLower);
  return sequenceLevel >= lower - tolerance && sequenceLevel <= upper + tolerance;
}

function resolveMonitorAction(monitor, diagnostics) {
  const values = [
    ["monitor_decision.action", monitor.monitor_decision?.action],
    ["monitor_decision.decision", monitor.monitor_decision?.decision],
    ["monitor_decision.status", monitor.monitor_decision?.status],
    ["action", monitor.action],
    ["decision", monitor.decision],
    ["action_now", monitor.action_now],
    ["setup_action", monitor.setup_action],
  ]
    .map(([path, value]) => [path, normalizeEnum(value)])
    .filter(([, value]) => value);
  const distinct = [...new Set(values.map(([, value]) => value))];
  if (distinct.length === 0) {
    diagnostics.error("MONITOR_ACTION_MISSING");
    return { source_action: "NO_ACTION", canonical_action: "NO_ACTION" };
  }
  const canonicalDistinct = [...new Set(distinct.map((value) => MONITOR_ACTION_ALIASES[value] || value))];
  if (canonicalDistinct.length > 1) {
    diagnostics.error("CONFLICTING_ACTION_ALIASES", {
      values: values.map(([path, value]) => ({ path, value })),
    });
    return { source_action: distinct[0], canonical_action: "NO_ACTION" };
  }
  const sourceAction = distinct[0];
  const canonicalAction = MONITOR_ACTION_ALIASES[sourceAction];
  if (!canonicalAction) {
    diagnostics.error("MONITOR_ACTION_UNSUPPORTED", { action: sourceAction });
    return { source_action: sourceAction, canonical_action: "NO_ACTION" };
  }
  return { source_action: sourceAction, canonical_action: canonicalAction };
}

function monitorThesisCommand(action, monitor) {
  const statusAfter = normalizeThesisStateV1(
    monitor.monitor_decision?.thesis_status_after
      || monitor.active_thesis_update?.status
      || monitor.thesis_update?.status
      || "",
  );
  const map = {
    MAINTAIN_THESIS: THESIS_COMMANDS_V1.MAINTAIN,
    WAIT_MORE: statusAfter === "CONDITIONAL"
      ? THESIS_COMMANDS_V1.MAKE_CONDITIONAL
      : THESIS_COMMANDS_V1.MAINTAIN,
    WEAKEN_THESIS: THESIS_COMMANDS_V1.WEAKEN,
    MARK_AT_RISK: THESIS_COMMANDS_V1.MARK_AT_RISK,
    INVALIDATE_THESIS: THESIS_COMMANDS_V1.INVALIDATE,
    TRANSFORM_SCENARIO: THESIS_COMMANDS_V1.SUPERSEDE,
    REPLAN_FULL: THESIS_COMMANDS_V1.REQUIRE_REPLAN,
  };
  return {
    type: map[action] || THESIS_COMMANDS_V1.NOOP,
    target_state: statusAfter || null,
    reason: text(monitor.monitor_decision?.reason_summary || monitor.monitor_decision?.detailed_reason) || null,
  };
}

function monitorSetupCommand(action, monitor) {
  const map = {
    SETUP_CANDIDATE: SETUP_COMMANDS_V1.UPSERT_CANDIDATE,
    PRE_ARM: SETUP_COMMANDS_V1.PRE_ARM,
    ARM_SETUP: SETUP_COMMANDS_V1.ARM,
    CANCEL_SETUP: SETUP_COMMANDS_V1.CANCEL,
    INVALIDATE_THESIS: SETUP_COMMANDS_V1.INVALIDATE,
    TRANSFORM_SCENARIO: SETUP_COMMANDS_V1.REPLACE,
    EXPIRE_SETUP: SETUP_COMMANDS_V1.EXPIRE,
  };
  return {
    type: map[action] || SETUP_COMMANDS_V1.NOOP,
    reason: text(monitor.monitor_decision?.reason_summary || monitor.monitor_decision?.detailed_reason) || null,
  };
}

function monitorPositionRequest(action, monitor) {
  const map = {
    REDUCE_RISK: POSITION_REQUESTS_V1.REDUCE_RISK,
    MOVE_STOP_BE: POSITION_REQUESTS_V1.MOVE_STOP_BE,
    TAKE_PARTIAL: POSITION_REQUESTS_V1.TAKE_PARTIAL,
    EXIT_POSITION: POSITION_REQUESTS_V1.EXIT_POSITION,
  };
  const type = map[action] || POSITION_REQUESTS_V1.NONE;
  return {
    type,
    position_id: text(
      monitor.position_check?.position_id
        || monitor.monitor_decision?.position_id
        || monitor.linked_position_id,
    ) || null,
    reduce_fraction: boundedFraction(
      monitor.position_check?.reduce_fraction
        ?? monitor.position_check?.partial_fraction
        ?? monitor.monitor_decision?.partial_fraction,
    ),
    requested_stop: numberOrNull(
      monitor.position_check?.requested_stop
        ?? monitor.position_check?.new_stop
        ?? monitor.monitor_decision?.requested_stop,
    ),
    reason: text(
      monitor.position_check?.reason
        || monitor.monitor_decision?.reason_summary
        || monitor.monitor_decision?.detailed_reason,
    ) || null,
    authority: "GPT_REQUEST_ONLY",
  };
}

function monitorReplanRequest(action, monitor) {
  if (!["REPLAN_FULL", "TRANSFORM_SCENARIO"].includes(action)) {
    return {
      type: REPLAN_EVENTS_V1.NOOP,
      reason: null,
      dedupe_key: null,
      requested_at_paris: null,
    };
  }
  const reason = text(monitor.monitor_decision?.reason_summary || monitor.monitor_decision?.detailed_reason)
    || action;
  return {
    type: REPLAN_EVENTS_V1.REQUEST,
    reason,
    dedupe_key: canonicalSha256({
      action,
      reason,
      thesis_id: monitor.linked_active_thesis_id || monitor.thesis_id || null,
    }),
    requested_at_paris: text(monitor.timestamp_paris || monitor.checkpoint_paris) || null,
  };
}

function normalizeThesisUpdate(monitor, diagnostics) {
  const active = asObject(monitor.active_thesis_update);
  const legacy = asObject(monitor.thesis_update);
  if (Object.keys(active).length > 0 && Object.keys(legacy).length > 0
    && canonicalSha256(active) !== canonicalSha256(legacy)) {
    diagnostics.error("CONFLICTING_THESIS_UPDATE_ALIASES");
  }
  const source = Object.keys(active).length > 0 ? active : legacy;
  const health = asObject(monitor.thesis_health_score);
  return {
    ...source,
    status: normalizeThesisStateV1(
      source.status || monitor.monitor_decision?.thesis_status_after || "NO_ACTIVE",
    ),
    health_score: numberOrNull(
      health.current_score ?? health.score ?? health.health_score ?? source.health_score,
    ),
  };
}

function normalizeAliasedObject(source, preferredKey, legacyKey, diagnostics) {
  const preferred = asObject(source[preferredKey]);
  const legacy = asObject(source[legacyKey]);
  if (Object.keys(preferred).length > 0 && Object.keys(legacy).length > 0
    && canonicalSha256(preferred) !== canonicalSha256(legacy)) {
    diagnostics.error("CONFLICTING_OBJECT_ALIASES", {
      preferred_key: preferredKey,
      legacy_key: legacyKey,
    });
  }
  if (Object.keys(preferred).length > 0) return preferred;
  if (Object.keys(legacy).length > 0) return legacy;
  return null;
}

function extractMasterSetups(master) {
  const candidates = MASTER_SETUP_ARRAY_PATHS.flatMap((path) => {
    const value = path.reduce((current, key) => current?.[key], master);
    return Array.isArray(value) ? value : [];
  });
  const singular = [
    master.primary_setup,
    master.selected_setup,
    master.final_decision?.setup,
    master.decision_executable?.setup_id ? master.decision_executable : null,
  ].filter((value) => value && typeof value === "object" && !Array.isArray(value));
  const dedupe = new Map();
  [...candidates, ...singular].forEach((setup, index) => {
    if (!setup || typeof setup !== "object" || Array.isArray(setup)) return;
    const key = text(setup.setup_id || setup.id) || `index_${index}`;
    if (!dedupe.has(key)) dedupe.set(key, setup);
  });
  return [...dedupe.values()];
}

function extractMonitorSetup(monitor) {
  return asObject(
    monitor.setup_update
      || monitor.setup
      || monitor.monitor_decision?.setup
      || monitor.setup_candidate
      || firstArray(monitor.setup_candidates)[0],
  );
}

function extractSetupConditions(setup, thesisSource) {
  return firstArray(
    setup.conditions,
    setup.trigger_conditions,
    setup.execution_conditions,
    setup.validation_conditions,
    setup.wait_to_go_conditions,
    setup.trigger_policy?.conditions,
    thesisSource?.wait_to_go_conditions,
  );
}

function normalizeNoSetupProof(source) {
  const proof = asObject(source);
  if (Object.keys(proof).length === 0) return null;
  return {
    best_long: asObject(proof.best_long),
    best_short: asObject(proof.best_short),
    blocking_reasons: arrayOfValues(proof.blocking_reasons),
    wait_to_go_conditions: arrayOfValues(proof.wait_to_go_conditions),
    revalidation_triggers: arrayOfValues(proof.revalidation_triggers),
  };
}

function validateNoSetupProof(proof, diagnostics) {
  if (!proof) return false;
  const valid = Object.keys(proof.best_long).length > 0
    && Object.keys(proof.best_short).length > 0
    && proof.blocking_reasons.length > 0
    && proof.wait_to_go_conditions.length > 0
    && proof.revalidation_triggers.length > 0;
  if (!valid) diagnostics.error("NO_SETUP_PROOF_INCOMPLETE");
  return valid;
}

function masterThesisCommand(state) {
  if (state === "ACTIVE") return THESIS_COMMANDS_V1.ACTIVATE;
  if (state === "CONDITIONAL") return THESIS_COMMANDS_V1.MAKE_CONDITIONAL;
  if (state === "WAIT_MONITORED") return THESIS_COMMANDS_V1.CREATE_WAIT;
  if (state === "REPLAN_REQUIRED") return THESIS_COMMANDS_V1.REQUIRE_REPLAN;
  return THESIS_COMMANDS_V1.NOOP;
}

function inferMasterThesisState(master) {
  const decision = normalizeEnum(master.decision || master.final_decision?.decision);
  if (["WAIT", "NO_TRADE", "NE_PAS_PRENDRE"].includes(decision)) return "WAIT_MONITORED";
  return "THESIS_CONDITIONAL";
}

function canonicalAnalyticalScope(scope, source) {
  return {
    strategy_id: text(scope.strategy_id || source.strategy_id) || null,
    session: text(scope.session || source.session) || null,
    trading_date: text(scope.trading_date || source.trading_date || source.date) || null,
    timezone: text(scope.timezone || source.timezone) || "Europe/Paris",
    cutoff_paris: text(scope.cutoff_paris || source.data_cutoff_paris || source.timestamp_paris) || null,
    pack_id: text(scope.pack_id || source.pack_id) || null,
    pack_build_id: text(scope.pack_build_id || source.pack_build_id) || null,
  };
}

function canonicalPolicy(policy) {
  return {
    policy_id: policy.policy_id,
    policy_version: policy.policy_version,
    weighted_confirmation_threshold: policy.weighted_confirmation_threshold,
    max_risk_pct: policy.max_risk_pct,
    min_rr: policy.min_rr,
    gpt_may_trigger: false,
  };
}

export function normalizeCanonicalGateSetV1(value, {
  source: defaultSource = "MASTER_EXECUTION_PLAN",
} = {}) {
  const raw = asObject(value);
  const entries = Array.isArray(value)
    ? value.map((gate) => ({ gate, classification: null }))
    : [
      ...firstArray(raw.hard).map((gate) => ({ gate, classification: "HARD" })),
      ...firstArray(raw.soft).map((gate) => ({ gate, classification: "SOFT" })),
    ];
  const byCode = new Map();
  for (let gateIndex = 0; gateIndex < entries.length; gateIndex += 1) {
    const entry = entries[gateIndex];
    const gate = normalizeCanonicalGateV1(entry.gate, {
      fallbackCode: "GATE_" + (gateIndex + 1),
      forcedClassification: entry.classification,
      defaultSource,
    });
    byCode.set(gate.code, gate);
  }
  const order = new Map(
    [...HARD_GATE_CODES_V5, ...SOFT_GATE_CODES_V5].map((code, gateIndex) => [code, gateIndex]),
  );
  return [...byCode.values()].sort((left, right) => (
    (order.get(left.code) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(right.code) ?? Number.MAX_SAFE_INTEGER)
      || left.code.localeCompare(right.code)
  ));
}

function assertCanonicalHardGateCoverageV1(gates, diagnostics, sourceKind) {
  const codes = new Set(gates.map((gate) => gate.code));
  const missingHardGateCodes = HARD_GATE_CODES_V5.filter((code) => !codes.has(code));
  if (missingHardGateCodes.length > 0) {
    diagnostics.error("CANONICAL_HARD_GATE_SET_INCOMPLETE", {
      source_kind: sourceKind,
      missing_hard_gate_codes: missingHardGateCodes,
      expected_count: HARD_GATE_CODES_V5.length,
      actual_count: HARD_GATE_CODES_V5.length - missingHardGateCodes.length,
    });
  }
}

function normalizeCanonicalGateV1(value, {
  fallbackCode,
  forcedClassification,
  defaultSource,
}) {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const code = canonicalOpportunityGateCodeV1(
    raw.code || raw.gate_id || raw.name || fallbackCode,
    { classification: forcedClassification?.toLowerCase() || null },
  );
  const inferredClassification = forcedClassification
    || normalizeEnum(raw.classification)
    || (HARD_GATE_CODE_SET_V1.has(code)
      ? "HARD"
      : SOFT_GATE_CODE_SET_V1.has(code)
        ? "SOFT"
        : classifyOpportunityGateV1(raw).toUpperCase());
  const classification = inferredClassification === "SOFT" ? "SOFT" : "HARD";
  const rawState = typeof value === "boolean"
    ? value ? "PASS" : "FAIL"
    : typeof value === "string"
      ? value
      : raw.state || raw.status || raw.result || raw.verdict;
  const normalizedState = normalizeEnum(rawState);
  const state = ["PASS", "FAIL", "UNKNOWN", "NOT_APPLICABLE"].includes(normalizedState)
    ? normalizedState
    : raw.failed === true || raw.passed === false ? "FAIL" : "UNKNOWN";
  const expectedPhase = classification === "HARD"
    ? HARD_GATE_ENFORCEMENT_PHASES_V5[code] || "PLAN_COMPILE"
    : null;
  const sourceName = normalizeEnum(raw.source || defaultSource);
  return {
    code,
    state,
    classification,
    enforcement_phase: classification === "HARD"
      ? normalizeEnum(raw.enforcement_phase || expectedPhase)
      : null,
    effect: classification === "HARD"
      ? "BLOCK_ON_FAIL_OR_UNKNOWN_AT_PHASE"
      : "ADVISORY_ONLY",
    source: ["MASTER_EXECUTION_PLAN", "MONITOR_DATA_QUALITY"].includes(sourceName)
      ? sourceName
      : normalizeEnum(defaultSource),
    reason: text(raw.reason) || null,
    evidence_refs: [...new Set(arrayOfValues(raw.evidence_refs).map(text).filter(Boolean))],
    pass_semantics: classification === "HARD"
      ? normalizeEnum(raw.pass_semantics || "FAILURE_ABSENT")
      : null,
  };
}

function blockingCanonicalGatesAtPhase(gates, phase) {
  return gates.filter((gate) => (
    gate.classification === "HARD"
      && gate.enforcement_phase === phase
      && BLOCKING_GATE_STATES_V1.has(gate.state)
  ));
}

function normalizeEntry(source, existing) {
  const direct = numberOrNull(source.entry_price ?? source.entry ?? existing.entry_price);
  if (direct !== null) return { entry_price: direct, entry_zone: null };
  const zone = source.entry_zone || source.entry_range || source.zone || existing.entry_zone;
  if (!zone || typeof zone !== "object") return { entry_price: null, entry_zone: null };
  const lower = numberOrNull(zone.lower ?? zone.from ?? zone.min);
  const upper = numberOrNull(zone.upper ?? zone.to ?? zone.max);
  if (lower === null || upper === null) return { entry_price: null, entry_zone: null };
  return {
    entry_price: null,
    entry_zone: {
      lower: Math.min(lower, upper),
      upper: Math.max(lower, upper),
    },
  };
}

function normalizeTarget(source, existing) {
  const direct = numberOrNull(
    source.take_profit_1
      ?? source.tp1
      ?? source.take_profit
      ?? source.target
      ?? existing.take_profit_1,
  );
  if (direct !== null) return direct;
  const values = source.targets || source.take_profits || existing.targets;
  if (Array.isArray(values) && values.length > 0) {
    return numberOrNull(values[0]?.target ?? values[0]?.price ?? values[0]?.level ?? values[0]);
  }
  if (values && typeof values === "object") {
    return numberOrNull(values.tp1 ?? values.take_profit_1 ?? values.target);
  }
  return null;
}

function normalizeTargets(source, existing) {
  const values = firstArray(source.targets, source.take_profits, existing.targets);
  return values.map((target, index) => {
    const item = asObject(target);
    const action = normalizeEnum(item.action || (index === values.length - 1 ? "FULL_CLOSE" : "PARTIAL_CLOSE"));
    const closeFraction = numberOrNull(item.close_fraction ?? item.partial_fraction);
    return {
      target_id: text(item.target_id || item.id) || "target_" + (index + 1),
      price: numberOrNull(item.price ?? item.target ?? item.level),
      action: ["PARTIAL_CLOSE", "MOVE_STOP_BE", "TRAIL", "FULL_CLOSE", "RUNNER"].includes(action)
        ? action
        : "PARTIAL_CLOSE",
      close_fraction: closeFraction !== null && closeFraction >= 0 && closeFraction <= 1
        ? closeFraction
        : action === "FULL_CLOSE" ? 1 : 0,
    };
  });
}

function normalizeSetupState(value) {
  const normalized = normalizeEnum(value || "NONE");
  const aliases = {
    CANDIDATE: "SETUP_CANDIDATE",
    CONDITIONAL: "PRE_ARMED",
    EXECUTABLE: "ARMED_CONDITIONAL",
    READY: "ARMED_CONDITIONAL",
    ACTIVE: "ARMED_CONDITIONAL",
    ARMED: "ARMED_CONDITIONAL",
    ARM_SETUP: "ARMED_CONDITIONAL",
    SETUP_ARMED: "ARMED_CONDITIONAL",
    TRIGGER_GO: "ARMED_CONDITIONAL",
    OPEN: "TRIGGERED",
    CANCELED: "CANCELLED",
  };
  return aliases[normalized] || normalized;
}

function normalizeManagementPolicy(value) {
  const source = Array.isArray(value) ? {} : asObject(value);
  return {
    break_even_at_r: numberOrNull(source.break_even_at_r ?? source.be_at_r) ?? 0.7,
    tp1_close_fraction: boundedFraction(source.tp1_close_fraction ?? source.partial_fraction) ?? 0.5,
  };
}

function normalizeImportance(value) {
  if (["MANDATORY", "PRIMARY", "SECONDARY", "OPTIONAL", "ADVISORY"].includes(value)) return value;
  return "SECONDARY";
}

function normalizeBlockerMemoryPolicy(_value, role) {
  return role === "INVALIDATION" ? "INVALIDATE_TERMINAL" : "LATEST_ONLY";
}

function normalizeMemoryPolicy(value) {
  const normalized = normalizeEnum(value);
  if (["LATEST_ONLY", "LATCH_UNTIL_TRIGGER"].includes(normalized)) return normalized;
  return "LATCH_UNTIL_TRIGGER";
}

function normalizeTemporalRule(value) {
  const source = asObject(value);
  const mode = normalizeEnum(source.mode || "LATEST_CLOSED");
  return {
    mode: ["LATEST_CLOSED", "ANY_SINCE_ARM", "CONSECUTIVE_CLOSED", "CROSS_AFTER_ARM"].includes(mode)
      ? mode
      : "LATEST_CLOSED",
    ...(positiveIntegerOrNull(source.count) ? { count: positiveIntegerOrNull(source.count) } : {}),
  };
}

function inferPredicateType(operator) {
  if (operator.includes("BREAK_RETEST")) return "BREAK_RETEST_SEQUENCE";
  if (operator.includes("CROSS")) return "PRICE_CROSS";
  if (operator.includes("TOUCH")) return "ZONE_TOUCH";
  if (operator.includes("BREAK")) return "BREAKOUT_CLOSE";
  if (operator.includes("REJECT")) return "REJECTION_PATTERN";
  if (operator.includes("VWAP")) return "VWAP_RELATION";
  if (operator.includes("RSI")) return "RSI_THRESHOLD";
  return "PRICE_RELATION";
}

function defaultConditionWeight(importance) {
  if (importance === "PRIMARY") return 2;
  if (importance === "SECONDARY") return 1;
  return 0;
}

function hasActivePosition(position) {
  const status = normalizeEnum(position?.state || position?.status);
  return ["OPEN", "PROTECTED", "PARTIAL_TAKEN", "REVIEW_REQUIRED"].includes(status);
}

function diagnosticCollector() {
  const errors = [];
  const warnings = [];
  const normalizations = [];
  return {
    error(code, evidence = null) {
      errors.push({ code, evidence });
    },
    warning(code, evidence = null) {
      warnings.push({ code, evidence });
    },
    normalization(code, evidence = null) {
      normalizations.push({ code, evidence });
    },
    snapshot() {
      return {
        errors: dedupeDiagnostics(errors),
        warnings: dedupeDiagnostics(warnings),
        normalizations: dedupeDiagnostics(normalizations),
      };
    },
  };
}

function dedupeDiagnostics(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = `${value.code}:${JSON.stringify(value.evidence || null)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length > 0)
    || values.find((value) => Array.isArray(value))
    || [];
}

function arrayOfValues(value) {
  return Array.isArray(value) ? value.filter((entry) => entry !== null && entry !== undefined) : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function boundedFraction(value) {
  const parsed = numberOrNull(value);
  return parsed !== null && parsed > 0 && parsed <= 1 ? parsed : null;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveIntegerOrNull(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDirection(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "buy") return "long";
  if (normalized === "sell") return "short";
  if (["long", "short", "neutral", "wait"].includes(normalized)) return normalized;
  return "unknown";
}

function normalizeInstrument(value) {
  return normalizeEnum(value) || null;
}

function normalizeEnum(value) {
  return String(value || "").trim().toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}
