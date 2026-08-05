import {
  DETERMINISTIC_COMPILER_VERSION_V1,
  MASTER_PLAN_SCHEMA_VERSION_V1,
  MONITOR_COMMAND_SCHEMA_VERSION_V1,
  OPPORTUNITY_SEEKING_CONTROLLED,
  canonicalSha256,
  compileMasterPlanV1,
  compileMonitorCommandV1,
  evaluateOpportunitySeekingControlledV1,
} from "@tv-automation/desk-domain";
import { deskError } from "./desk-errors.js";
import {
  assertCompiledExecutionPlanV1,
  assertCompiledMonitorCommandV1,
  assertMasterV5ContractOutput,
  assertMonitorV2ContractOutput,
} from "./strategy-contract-validator.js";
import {
  ACTIVE_STRATEGY_RUNTIME_VERSIONS,
} from "./strategy-runtime-versioning.js";

export const STRATEGY_RUNTIME_VERSIONS = ACTIVE_STRATEGY_RUNTIME_VERSIONS;

export function usesDeterministicStrategyV5(payload = {}, run = null) {
  return policyVersion(payload, run) === STRATEGY_RUNTIME_VERSIONS.execution_policy
    || String(payload.schema_version || "") === STRATEGY_RUNTIME_VERSIONS.master_contract
    || String(payload.contract_version || "") === STRATEGY_RUNTIME_VERSIONS.master_contract;
}

export function canonicalizeMasterStrategyPayload(payload = {}, {
  workflow = "MASTER",
  run = null,
  sourceMode = null,
} = {}) {
  if (!usesDeterministicStrategyV5(payload, run)) return payload;
  const sourceOutput = requiredNativeSourceOutput(payload, "analysis_output", {
    code: "MASTER_V5_CANONICAL_SOURCE_REQUIRED",
    artifact: "Master V5",
  });
  assertMasterV5ContractOutput(sourceOutput, payload);
  const rawHash = canonicalSha256(sourceOutput);
  const proposedPlan = sourceOutput.execution_plan_proposal
    || sourceOutput.proposed_execution_plan
    || sourceOutput.deterministic_execution_plan
    || sourceOutput.execution_plan
    || null;
  const compilerSourceOutput = canonicalizeTargetFractionsAtRuntimeBoundary(sourceOutput);
  const compiled = compileMasterPlanV1(compilerSourceOutput, {
    scope: strategyScope(sourceOutput, run, payload),
    sourceMode: sourceMode || payload.mode || run?.mode || null,
    policy: OPPORTUNITY_SEEKING_CONTROLLED,
  });
  assertCompiledStrategy(compiled, {
    workflow,
    artifact: "DETERMINISTIC_EXECUTION_PLAN",
    code: "DETERMINISTIC_EXECUTION_PLAN_INVALID",
  });
  assertCompiledExecutionPlanV1(compiled);
  const executableSetups = (compiled.ranked_setups || [])
    .filter((setup) => setup.compile_status === "COMPILED")
    .map(canonicalSetupForPersistence);
  const fullAnalysis = payload.full_analysis && typeof payload.full_analysis === "object"
    ? payload.full_analysis
    : {};
  const sourceThesis = sourceOutput.active_thesis && typeof sourceOutput.active_thesis === "object"
    ? sourceOutput.active_thesis
    : null;
  const pinnedPlan = pinnedMasterPlanSnapshot(sourceOutput);
  const canonicalThesis = canonicalActiveThesisFromCompiled(compiled, sourceThesis, pinnedPlan);
  const sourceTransmission = sourceOutput.monitor_handoff?.context_transmission || null;
  const primarySetupId = compiled.thesis_plan?.primary_setup_id
    || compiled.primary_setup_id
    || proposedPlan?.primary_setup_id
    || null;
  const frontReadProjection = masterFrontReadProjection({
    sourceOutput,
    compiled,
    executableSetups,
    primarySetupId,
  });
  return {
    ...payload,
    analysis_output: sourceOutput,
    schema_version: STRATEGY_RUNTIME_VERSIONS.master_contract,
    execution_policy_version: STRATEGY_RUNTIME_VERSIONS.execution_policy,
    ...(payload.replay_execution_policy_version !== undefined || sourceMode === "replay"
      ? { replay_execution_policy_version: STRATEGY_RUNTIME_VERSIONS.execution_policy }
      : {}),
    execution_plan_version: STRATEGY_RUNTIME_VERSIONS.execution_plan,
    condition_catalog_version: STRATEGY_RUNTIME_VERSIONS.condition_catalog,
    deterministic_compiler_version: STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
    condition_engine_version: STRATEGY_RUNTIME_VERSIONS.condition_engine,
    strategy_profile: OPPORTUNITY_SEEKING_CONTROLLED.policy_id,
    gpt_execution_plan_proposal: proposedPlan,
    deterministic_execution_plan: compiled,
    plan_id: compiled.plan_id || proposedPlan?.plan_id || payload.plan_id || null,
    primary_setup_id: primarySetupId,
    setups: executableSetups,
    full_analysis: {
      ...fullAnalysis,
      contract_output: sourceOutput,
      analysis_sections: sourceOutput.analysis_sections || fullAnalysis.analysis_sections || null,
      market_context: sourceOutput.market_context || fullAnalysis.market_context || null,
      hypotheses: sourceOutput.hypotheses || fullAnalysis.hypotheses || null,
      selected_hypothesis: sourceOutput.selected_hypothesis || fullAnalysis.selected_hypothesis || null,
      plan_id: compiled.plan_id || proposedPlan?.plan_id || fullAnalysis.plan_id || null,
      primary_setup_id: primarySetupId || fullAnalysis.primary_setup_id || null,
      setups: executableSetups,
      no_setup_proof: compiled.no_setup_proof || fullAnalysis.no_setup_proof || payload.no_setup_proof || null,
    },
    ...(canonicalThesis ? { active_thesis: canonicalThesis } : {}),
    ...(sourceTransmission ? { context_transmission: sourceTransmission } : {}),
    front_read_projection: frontReadProjection,
    strategy_normalization_audit: normalizationAudit({
      workflow,
      rawHash,
      compiled,
      sourceContract: sourceOutput.contract?.name || payload.contract_name || "DeskMasterAnalysisContract",
      sourceVersion: sourceOutput.contract?.version || payload.schema_version || payload.contract_version || STRATEGY_RUNTIME_VERSIONS.master_contract,
    }),
  };
}

export function canonicalizeMonitorStrategyPayload(payload = {}, {
  workflow = "MONITOR",
  run = null,
  sourceMode = null,
  currentState = {},
} = {}) {
  if (!usesDeterministicStrategyV5(payload, run)
    && policyVersion(payload, run) !== STRATEGY_RUNTIME_VERSIONS.execution_policy
    && String(payload.schema_version || "") !== STRATEGY_RUNTIME_VERSIONS.monitor_contract) {
    return payload;
  }
  const sourceOutput = requiredNativeSourceOutput(payload, "monitor_output", {
    code: "MONITOR_V2_CANONICAL_SOURCE_REQUIRED",
    artifact: "Monitor V2",
  });
  assertMonitorV2ContractOutput(sourceOutput, payload);
  const rawHash = canonicalSha256(sourceOutput);
  const proposedCommand = sourceOutput.command
    || sourceOutput.requested_command
    || sourceOutput.monitor_command
    || sourceOutput.deterministic_monitor_command
    || sourceOutput.monitor_decision
    || null;
  const compilerSourceOutput = canonicalizeTargetFractionsAtRuntimeBoundary(sourceOutput);
  const compiled = normalizeAcceptedNativeMonitorCarrierDiagnostics(
    compileMonitorCommandV1(compilerSourceOutput, {
      currentState,
      scope: strategyScope(sourceOutput, run, payload),
      sourceMode: sourceMode || payload.mode || run?.mode || null,
      policy: OPPORTUNITY_SEEKING_CONTROLLED,
    }),
  );
  assertCompiledStrategy(compiled, {
    workflow,
    artifact: "DETERMINISTIC_MONITOR_COMMAND",
    code: "DETERMINISTIC_MONITOR_COMMAND_INVALID",
  });
  assertCompiledMonitorCommandV1(compiled);
  const compatibility = monitorCompatibilityProjection(compiled, currentState);
  const frontReadProjection = monitorFrontReadProjection({
    sourceOutput,
    compiled,
    compatibility,
  });
  return {
    ...payload,
    monitor_output: sourceOutput,
    ...compatibility,
    schema_version: STRATEGY_RUNTIME_VERSIONS.monitor_contract,
    execution_policy_version: STRATEGY_RUNTIME_VERSIONS.execution_policy,
    ...(payload.replay_execution_policy_version !== undefined || sourceMode === "replay"
      ? { replay_execution_policy_version: STRATEGY_RUNTIME_VERSIONS.execution_policy }
      : {}),
    monitor_command_version: STRATEGY_RUNTIME_VERSIONS.monitor_command,
    condition_catalog_version: STRATEGY_RUNTIME_VERSIONS.condition_catalog,
    deterministic_compiler_version: STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
    condition_engine_version: STRATEGY_RUNTIME_VERSIONS.condition_engine,
    strategy_profile: OPPORTUNITY_SEEKING_CONTROLLED.policy_id,
    gpt_monitor_command_proposal: proposedCommand,
    deterministic_monitor_command: compiled,
    gates: compiled.gates || [],
    front_read_projection: frontReadProjection,
    strategy_normalization_audit: normalizationAudit({
      workflow,
      rawHash,
      compiled,
      sourceContract: sourceOutput.contract?.name || payload.contract_name || "DeskHourlyThesisMonitorContract",
      sourceVersion: sourceOutput.contract?.version || payload.schema_version || payload.contract_version || STRATEGY_RUNTIME_VERSIONS.monitor_contract,
    }),
  };
}

function canonicalizeTargetFractionsAtRuntimeBoundary(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeTargetFractionsAtRuntimeBoundary);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      canonicalizeTargetFractionsAtRuntimeBoundary(item),
    ]),
  );
  if (String(normalized.action || "").trim().toUpperCase() === "FULL_CLOSE") {
    normalized.close_fraction = 1;
  }
  return normalized;
}

export function canonicalSetupForPersistence(setup = {}) {
  return {
    ...setup,
    priority: setup.rank,
    lifecycle_status: setup.status,
    setup_status: setup.status,
    conditions: setup.conditions || [],
    trigger_policy: {
      ...(setup.trigger_policy || {}),
      min_score: OPPORTUNITY_SEEKING_CONTROLLED.weighted_confirmation_threshold,
      allow_entry_only: false,
      allow_same_bar_entry: false,
      backend_can_trigger: setup.trigger_policy?.backend_can_trigger === true,
    },
    execution_policy_version: STRATEGY_RUNTIME_VERSIONS.execution_policy,
    execution_plan_version: STRATEGY_RUNTIME_VERSIONS.execution_plan,
    condition_catalog_version: STRATEGY_RUNTIME_VERSIONS.condition_catalog,
    deterministic_compiler_version: STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
    condition_engine_version: STRATEGY_RUNTIME_VERSIONS.condition_engine,
    execution_authority: "BACKEND_ONLY",
    source_canonical_hash: setup.canonical_hash || null,
  };
}

function monitorCompatibilityProjection(compiled, currentState) {
  const setupCommand = compiled.setup_command || {};
  const thesisCommand = compiled.thesis_command || {};
  const action = compiled.canonical_action || "NO_ACTION";
  const replanRequested = compiled.replan_request?.type === "REQUEST";
  const legacyAction = replanRequested ? "REPLAN_FULL" : action;
  const currentSetup = currentState.setup && typeof currentState.setup === "object"
    ? currentState.setup
    : {};
  const setupStatus = requestedSetupStatus(setupCommand.type, currentSetup.status);
  const canonicalGates = Array.isArray(compiled.gates) ? compiled.gates : [];
  let compiledSetup = setupCommand.setup
    ? canonicalSetupForPersistence(setupCommand.setup)
    : setupCommand.setup_id && setupStatus
      ? {
        ...currentSetup,
        setup_id: setupCommand.setup_id,
        status: setupStatus,
        lifecycle_status: setupStatus,
        setup_status: setupStatus,
      }
      : null;
  if (!compiledSetup
    && setupCommand.type === "NOOP"
    && currentSetup.setup_id
    && canonicalGates.length > 0) {
    compiledSetup = {
      ...currentSetup,
      gates: canonicalGates,
      gate_snapshot_update_only: true,
    };
  } else if (compiledSetup && canonicalGates.length > 0) {
    compiledSetup = {
      ...compiledSetup,
      gates: canonicalGates,
      ...(setupCommand.type === "NOOP" ? { gate_snapshot_update_only: true } : {}),
    };
  }
  if (compiledSetup && canonicalGates.length > 0) {
    compiledSetup.entry_gate_evaluation = evaluateOpportunitySeekingControlledV1({
      setup: compiledSetup,
      conditionEvaluation: {},
      gates: canonicalGates,
      phase: "ENTRY_TRIGGER",
    });
  }
  const monitorDecision = {
    ...(compiled.source_monitor_decision || {}),
    action: legacyAction,
    decision: legacyAction,
    setup_id: setupCommand.setup_id || null,
    thesis_status_after: thesisCommand.payload?.status || thesisCommand.target_state || null,
    reason_summary: setupCommand.reason || thesisCommand.reason || null,
    execution_authority: "BACKEND_ONLY",
  };
  return {
    monitor_decision: monitorDecision,
    ...(compiledSetup ? { setup_transition: compiledSetup } : {}),
    active_thesis_update: thesisCommand.payload || null,
    thesis_update: thesisCommand.payload || null,
    position_request: compiled.position_request || null,
    replan_request: compiled.replan_request || null,
  };
}

function requestedSetupStatus(command, fallback) {
  const map = {
    UPSERT_CANDIDATE: "SETUP_CANDIDATE",
    PRE_ARM: "PRE_ARMED",
    ARM: "ARMED_CONDITIONAL",
    CANCEL: "CANCELLED",
    EXPIRE: "EXPIRED",
    INVALIDATE: "INVALIDATED",
    REPLACE: "SETUP_CANDIDATE",
  };
  return map[String(command || "").toUpperCase()] || fallback || null;
}

function masterFrontReadProjection({ sourceOutput, compiled, executableSetups, primarySetupId }) {
  const sections = frontObject(sourceOutput.analysis_sections);
  const thesis = frontObject(sourceOutput.active_thesis);
  const handoff = frontObject(sourceOutput.monitor_handoff);
  const marketContext = frontObject(sourceOutput.market_context);
  const selectedHypothesis = frontObject(sourceOutput.selected_hypothesis);
  const hypotheses = frontArray(sourceOutput.hypotheses);
  const selected = hypotheses.find((item) => (
    frontText(item?.hypothesis_id) === frontText(selectedHypothesis.hypothesis_id)
  )) || {};
  const primarySetup = executableSetups.find((setup) => (
    frontText(setup.setup_id) === frontText(primarySetupId)
  )) || executableSetups[0] || {};
  const instrument = frontText(primarySetup.instrument || thesis.instrument) || null;
  const direction = frontText(primarySetup.direction || thesis.direction) || "wait";
  const confidence = frontConfidencePct(selected.confidence);
  const decisionSummary = frontText(sections.decision_summary || selectedHypothesis.reason)
    || "Analyse Master native matérialisée.";
  const thesisReadAlias = Object.keys(thesis).length ? {
    ...thesis,
    status: frontText(thesis.state) || null,
    dominant_scenario: frontText(thesis.summary) || null,
    valid_from: frontText(thesis.valid_from_paris) || null,
    valid_until: frontText(thesis.valid_until_paris) || null,
    requires_replan_after: frontText(thesis.requires_replan_after_paris) || null,
    health_score: frontNumber(handoff.thesis_health_baseline),
    monitoring_playbook: frontArray(handoff.monitoring_playbook),
  } : null;

  return {
    source_contract: `DeskMasterAnalysisContract@${STRATEGY_RUNTIME_VERSIONS.master_contract}`,
    executive_summary: {
      summary: decisionSummary,
      final_decision: frontText(compiled.disposition) || "MANAGEMENT_ONLY",
      final_instrument: instrument,
      final_direction: direction,
      confidence_pct: confidence,
      primary_setup_id: frontText(primarySetupId) || null,
    },
    decision: {
      action: frontText(compiled.disposition) || "MANAGEMENT_ONLY",
      instrument,
      direction,
      confidence_pct: confidence,
      reason: decisionSummary,
      execution_allowed: executableSetups.length > 0,
    },
    observable_facts: frontArray(sections.facts)
      .map((fact) => frontText(fact?.statement))
      .filter(Boolean),
    interpretations: frontArray(sections.interpretations)
      .map((interpretation) => frontText(interpretation?.statement))
      .filter(Boolean),
    macro_thesis: frontObject(sections.macro),
    cross_asset_analysis: frontObject(sections.cross_asset),
    technical_analysis: frontObject(sections.technical),
    levels_analysis: frontObject(sections.levels),
    asset_selection: frontObject(sections.asset_selection),
    opportunities: frontArray(sections.opportunities),
    risks: frontArray(sections.risks),
    market_regime: marketContext,
    active_thesis: thesisReadAlias,
    expected_path: frontArray(thesis.expected_path),
    failure_path: frontArray(thesis.failure_path),
    monitoring_playbook: frontArray(handoff.monitoring_playbook),
    update_agenda: frontArray(handoff.update_agenda),
  };
}

function monitorFrontReadProjection({ sourceOutput, compiled, compatibility }) {
  const delta = frontObject(sourceOutput.delta_summary);
  const assessment = frontObject(sourceOutput.assessment);
  const checks = frontObject(sourceOutput.checks);
  const health = frontObject(sourceOutput.thesis_health);
  const handoff = frontObject(sourceOutput.next_handoff);
  const sourceThesisUpdate = frontObject(sourceOutput.active_thesis_update);
  const compiledThesisUpdate = frontObject(compatibility.active_thesis_update);
  const thesisUpdate = {
    ...sourceThesisUpdate,
    ...compiledThesisUpdate,
    status: frontText(compiledThesisUpdate.status || sourceThesisUpdate.state) || null,
    valid_until: frontText(
      compiledThesisUpdate.valid_until_paris || sourceThesisUpdate.valid_until_paris,
    ) || null,
    requires_replan_after: frontText(
      compiledThesisUpdate.requires_replan_after_paris
        || sourceThesisUpdate.requires_replan_after_paris,
    ) || null,
    next_focus: frontText(handoff.context_summary) || null,
  };
  const currentHealth = frontNumber(health.score ?? sourceThesisUpdate.health_score);
  const previousHealth = frontNumber(health.previous_score);
  const healthDelta = currentHealth == null || previousHealth == null
    ? null
    : currentHealth - previousHealth;
  const healthDrivers = frontArray(health.drivers).map(frontText).filter(Boolean);
  const positiveDrivers = healthDelta == null || healthDelta >= 0
    ? healthDrivers
    : [];
  const negativeDrivers = healthDelta != null && healthDelta < 0
    ? healthDrivers
    : [];
  const summary = frontText(delta.thesis_evolution || sourceThesisUpdate.summary)
    || "Monitor natif matérialisé.";
  const detailedReason = frontText(assessment.causality_summary)
    || frontArray(delta.interpretations).map(frontText).filter(Boolean).join(" · ")
    || summary;
  const weakSignals = uniqueFrontStrings([
    ...frontArray(delta.new_risks),
    ...frontWeakSignalSummaries(checks.weak_signals),
  ]);

  return {
    source_contract: `DeskHourlyThesisMonitorContract@${STRATEGY_RUNTIME_VERSIONS.monitor_contract}`,
    timestamp_paris: frontText(
      sourceOutput.checkpoint?.checkpoint_paris || sourceOutput.scope?.cutoff_paris,
    ) || null,
    monitor_decision: {
      ...frontObject(compatibility.monitor_decision),
      summary,
      reason_summary: detailedReason,
      detailed_reason: detailedReason,
      next_action: frontText(compiled.canonical_action) || "NO_ACTION",
      next_monitoring_focus: frontText(handoff.context_summary)
        || frontArray(handoff.priorities).map(frontText).filter(Boolean).join(" · ")
        || null,
      thesis_status_after: frontText(thesisUpdate.status) || null,
    },
    thesis_health_score: {
      previous_score: previousHealth,
      current_score: currentHealth,
      score: currentHealth,
      delta: healthDelta,
      state: frontText(health.state) || null,
      drivers: healthDrivers,
      score_drivers_positive: positiveDrivers,
      score_drivers_negative: negativeDrivers,
    },
    expected_vs_realized: frontExpectedVsRealized(assessment, checks.expected_vs_realized),
    weak_signals: weakSignals,
    context_transmission: {
      facts: frontArray(delta.facts).map(frontText).filter(Boolean),
      interpretations: frontArray(delta.interpretations).map(frontText).filter(Boolean),
      thesis_state: frontText(sourceThesisUpdate.state || thesisUpdate.status) || null,
      open_questions: frontArray(handoff.priorities).map(frontText).filter(Boolean),
      next_checkpoint_paris: frontText(handoff.next_checkpoint_paris) || null,
      watch_condition_ids: frontArray(handoff.watch_condition_ids).map(frontText).filter(Boolean),
      summary: frontText(handoff.context_summary) || null,
    },
    active_thesis_update: thesisUpdate,
    thesis_update: thesisUpdate,
  };
}

function frontExpectedVsRealized(assessmentValue, checkValue) {
  const assessment = frontObject(assessmentValue);
  const check = frontObject(checkValue);
  const expected = frontArray(assessment.expected_path).map(frontText).filter(Boolean);
  const realized = frontArray(assessment.realized_path).map(frontText).filter(Boolean);
  const count = Math.max(expected.length, realized.length);
  return Array.from({ length: count }, (_, index) => ({
    element: `Étape ${index + 1}`,
    expected: expected[index] || null,
    realized: realized[index] || null,
    verdict: frontText(check.status).toLowerCase() || "unknown",
    impact: frontText(check.summary || assessment.causality_summary) || null,
  }));
}

function frontWeakSignalSummaries(value) {
  const check = frontObject(value);
  const status = frontText(check.status).toUpperCase();
  const summary = frontText(check.summary);
  if (!summary || ["UNCHANGED", "NOT_APPLICABLE"].includes(status)) return [];
  return [summary];
}

function uniqueFrontStrings(values) {
  return [...new Set(values.map(frontText).filter(Boolean))];
}

function frontObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function frontArray(value) {
  return Array.isArray(value) ? value : [];
}

function frontText(value) {
  if (!["string", "number", "boolean"].includes(typeof value)) return "";
  return String(value).trim();
}

function frontNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function frontConfidencePct(value) {
  const parsed = frontNumber(value);
  if (parsed == null) return null;
  return parsed >= 0 && parsed <= 1 ? parsed * 100 : parsed;
}

function strategyScope(payload, run, transport = {}) {
  const embedded = payload.scope && typeof payload.scope === "object" ? payload.scope : {};
  const source = payload.source && typeof payload.source === "object" ? payload.source : {};
  return {
    mode: embedded.mode || payload.mode || transport.mode || run?.mode || (transport.backtest_id || run?.backtest_id ? "replay" : "live"),
    strategy_id: payload.strategy_id || transport.strategy_id || run?.strategy_id || null,
    session: embedded.session || payload.session || transport.session || run?.session || null,
    trading_date: embedded.trading_date || payload.trading_date || payload.date || transport.trading_date || transport.date || run?.trading_date || run?.date || null,
    timezone: embedded.timezone || payload.timezone || transport.timezone || run?.timezone || "Europe/Paris",
    cutoff_paris: embedded.cutoff_paris || payload.cutoff_paris || payload.timestamp_paris || payload.as_of_utc || transport.cutoff_paris || transport.timestamp_paris || transport.as_of_utc || run?.current_replay_time || null,
    pack_id: source.pack_id || payload.pack_id || transport.pack_id || run?.pack_id || null,
    pack_build_id: source.pack_build_id || payload.pack_build_id || transport.pack_build_id || run?.pack_build_id || null,
    run_id: embedded.run_id || payload.run_id || payload.replay_run_id || payload.backtest_id || transport.run_id || transport.replay_run_id || transport.backtest_id || run?.replay_run_id || run?.backtest_id || null,
  };
}

function requiredNativeSourceOutput(payload, field, { code, artifact }) {
  const source = payload?.[field];
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw deskError(code, `${artifact} requires an explicit ${field} envelope before deterministic compilation.`, {
      field,
      schema_version: payload?.schema_version || null,
      execution_policy_version: payload?.execution_policy_version || payload?.replay_execution_policy_version || null,
      legacy_read_only: true,
    });
  }
  return source;
}

function canonicalActiveThesisFromCompiled(compiled, sourceThesis, pinnedPlan) {
  const plan = compiled?.thesis_plan;
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw deskError("MASTER_V5_COMPILED_THESIS_MISSING", "Master V5 compiled plan must contain thesis_plan.");
  }
  if (!plan.thesis_id) {
    throw deskError("MASTER_V5_COMPILED_THESIS_ID_MISSING", "Master V5 compiled thesis_plan must contain thesis_id.");
  }
  const narrative = sourceThesis && typeof sourceThesis === "object" && !Array.isArray(sourceThesis)
    ? sourceThesis
    : {};
  return {
    thesis_id: plan.thesis_id,
    plan_id: compiled.plan_id || plan.plan_id || null,
    pinned_plan: pinnedPlan,
    primary_setup_id: plan.primary_setup_id || null,
    state: plan.current_state,
    status: plan.current_state,
    instrument: plan.instrument,
    direction: plan.direction,
    valid_from_paris: plan.valid_from_paris || null,
    valid_until_paris: plan.valid_until_paris || null,
    requires_replan_after_paris: plan.requires_replan_after_paris || null,
    selected_hypothesis_id: narrative.selected_hypothesis_id || null,
    summary: narrative.summary || narrative.dominant_scenario || null,
    expected_path: Array.isArray(narrative.expected_path) ? narrative.expected_path : [],
    failure_path: Array.isArray(narrative.failure_path) ? narrative.failure_path : [],
    scenario_transformations: Array.isArray(narrative.scenario_transformations)
      ? narrative.scenario_transformations
      : [],
  };
}

function pinnedMasterPlanSnapshot(sourceOutput) {
  const executionPlan = sourceOutput?.execution_plan;
  const scope = executionPlan?.scope;
  const risk = executionPlan?.risk;
  if (!executionPlan || typeof executionPlan !== "object"
    || !scope || typeof scope !== "object"
    || !risk || typeof risk !== "object") {
    throw deskError(
      "MASTER_V5_PINNED_PLAN_MISSING",
      "Master V5 must provide execution_plan scope and risk before the plan can be pinned.",
    );
  }
  return {
    plan_id: executionPlan.plan_id,
    scope: { ...scope },
    risk: {
      capital_basis: risk.capital_basis,
      risk_pct_requested: risk.risk_pct_requested,
      min_rr: risk.min_rr,
      min_weighted_confirmation_ratio: risk.min_weighted_confirmation_ratio,
    },
  };
}

function policyVersion(payload, run) {
  return String(
    payload.execution_policy_version
      || payload.replay_execution_policy_version
      || run?.execution_policy_version
      || run?.replay_execution_policy_version
      || "",
  );
}

function assertCompiledStrategy(compiled, { workflow, artifact, code }) {
  if (compiled?.valid === true
    && compiled?.compiler_version === STRATEGY_RUNTIME_VERSIONS.deterministic_compiler) {
    return;
  }
  throw deskError(code, `${artifact} compilation failed at the save boundary.`, {
    workflow,
    artifact,
    compiler_version: compiled?.compiler_version || DETERMINISTIC_COMPILER_VERSION_V1,
    expected_compiler_version: STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
    schema_version: compiled?.schema_version
      || (artifact === "DETERMINISTIC_EXECUTION_PLAN" ? MASTER_PLAN_SCHEMA_VERSION_V1 : MONITOR_COMMAND_SCHEMA_VERSION_V1),
    errors: compiled?.diagnostics?.errors || [],
    warnings: compiled?.diagnostics?.warnings || [],
  });
}

function normalizeAcceptedNativeMonitorCarrierDiagnostics(compiled = {}) {
  const errors = Array.isArray(compiled?.diagnostics?.errors)
    ? compiled.diagnostics.errors
    : [];
  const dropped = [];
  const retained = errors.filter((entry) => {
    if (entry?.code !== "STATE_TRANSITION_REJECTED") return true;
    const domain = String(entry?.evidence?.domain || "").toLowerCase();
    const finalTransition = compiled?.transitions?.[domain];
    if (finalTransition?.accepted !== true) return true;
    dropped.push(entry);
    return false;
  });
  if (!dropped.length) return compiled;
  const normalized = {
    ...compiled,
    diagnostics: {
      ...(compiled.diagnostics || {}),
      errors: retained,
      normalizations: [
        ...(Array.isArray(compiled?.diagnostics?.normalizations)
          ? compiled.diagnostics.normalizations
          : []),
        {
          code: "NATIVE_CARRIER_TRANSITION_REJECTION_DROPPED",
          evidence: {
            dropped: dropped.map((entry) => ({
              domain: entry.evidence?.domain || null,
              command: entry.evidence?.command || null,
              previous_state: entry.evidence?.previous_state || null,
              reason: entry.evidence?.reason || null,
            })),
          },
        },
      ],
    },
    valid: retained.length === 0,
  };
  const {
    canonical_hash: _previousHash,
    valid,
    transport_context: transportContext,
    ...canonical
  } = normalized;
  return {
    ...canonical,
    canonical_hash: canonicalSha256(canonical),
    valid,
    transport_context: transportContext,
  };
}

function normalizationAudit({ workflow, rawHash, compiled, sourceContract, sourceVersion }) {
  return {
    schema_version: "strategy_normalization_audit_v1",
    workflow,
    profile: OPPORTUNITY_SEEKING_CONTROLLED.policy_id,
    source_contract: sourceContract,
    source_contract_version: sourceVersion,
    source_contract_output_hash: rawHash,
    canonical_hash: compiled.canonical_hash,
    compiler_version: compiled.compiler_version,
    raw_contract_fields_preserved: true,
    error_count: compiled.diagnostics?.errors?.length || 0,
    warning_count: compiled.diagnostics?.warnings?.length || 0,
    normalization_count: compiled.diagnostics?.normalizations?.length || 0,
    warnings: compiled.diagnostics?.warnings || [],
    normalizations: compiled.diagnostics?.normalizations || [],
  };
}
