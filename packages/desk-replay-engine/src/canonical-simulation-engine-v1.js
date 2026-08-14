import {
  OPPORTUNITY_SEEKING_CONTROLLED,
  canonicalSha256,
  evaluateDeterministicConditionSetV1,
  evaluateOpportunitySeekingControlledV1,
} from "@tv-automation/desk-domain";
import {
  buildMetrics,
  emptyMetrics,
  event,
  fallbackSimulationRunId,
  finalizeResult,
  firstText,
  isObject,
  number,
  parseTime,
  positionEventProjection,
  round,
  text,
} from "./canonical-simulation-result-v1.js";
import {
  ORDER_SIMULATOR_VERSION_V1,
  normalizeOrderSimulationPolicyV1,
  simulateEntryOrderV1,
  simulateExitOrderV1,
} from "./order-simulator-v1.js";

export const CANONICAL_SIMULATION_SCHEMA_VERSION_V1 = "canonical_simulation_result_v1";
export const CANONICAL_SIMULATION_ENGINE_VERSION_V1 = "1.0.0";

export function runCanonicalSimulationV1({
  run_id = null,
  strategy_version_id = null,
  compiled_artifact = null,
  deterministic_execution_plan = null,
  dataset = {},
  rows = null,
  rowsByInstrument = null,
  parameters = {},
  reproducibility_seed = "default-seed-v1",
  scope = {},
  cutoff_paris = null,
  cutoff_utc = null,
  run_started_at_utc = null,
  policy = OPPORTUNITY_SEEKING_CONTROLLED,
} = {}) {
  const context = buildSimulationContext({
    run_id,
    strategy_version_id,
    compiled_artifact,
    deterministic_execution_plan,
    dataset,
    rows,
    parameters,
    reproducibility_seed,
    scope,
    cutoff_paris,
    cutoff_utc,
    run_started_at_utc,
    policy,
  });
  const issues = validateSimulationInput(context);
  if (issues.length) return finalizeResult({ ...context.base, status: "REJECTED", reasons: issues, events: [], positions: [], metrics: emptyMetrics() });

  const prepared = prepareSimulationInput(context, rowsByInstrument);
  const replay = replayPreparedRows({ ...prepared, policy });
  const positions = closeOpenPositionAtCutoff(replay.positions, replay.openPosition, prepared.usableRows, replay.events, prepared.simulationPolicy);
  return finalizeResult({
    ...context.base,
    status: replay.status,
    data_quality: {
      input_rows: context.normalizedRows.length,
      consumed_rows: prepared.usableRows.length,
      ignored_post_cutoff_rows: prepared.ignoredRows,
      cutoff_enforced: true,
    },
    order_simulator_version: ORDER_SIMULATOR_VERSION_V1,
    order_simulation_policy: context.orderSimulationPolicy,
    simulation_policy: context.simulationPolicy,
    events: replay.events,
    positions,
    metrics: buildMetrics(positions, { rows: prepared.usableRows }),
  });
}

function buildSimulationContext(input) {
  const dataset = isObject(input.dataset) ? input.dataset : {};
  const plan = selectPlan(input.deterministic_execution_plan, input.compiled_artifact);
  const normalizedRows = normalizeRows(selectDatasetRows(input.rows, dataset));
  const cutoff = selectCutoff(input.scope, dataset, input.cutoff_paris, input.cutoff_utc);
  return {
    plan,
    dataset,
    normalizedRows,
    cutoff,
    orderSimulationPolicy: selectOrderSimulationPolicy(input.parameters, dataset, plan),
    simulationPolicy: selectSimulationPolicy(input.parameters, dataset, plan),
    telemetryPolicy: selectSimulationTelemetryPolicy(input.parameters),
    base: buildResultBase({ input, dataset, plan, cutoff }),
    policy: input.policy,
  };
}

function selectPlan(plan, artifact) {
  if (isObject(plan)) return plan;
  if (isObject(artifact) && isObject(artifact.deterministic_execution_plan)) return artifact.deterministic_execution_plan;
  return null;
}

function selectDatasetRows(rows, dataset) {
  if (Array.isArray(rows)) return rows;
  if (Array.isArray(dataset.rows)) return dataset.rows;
  if (Array.isArray(dataset.candles)) return dataset.candles;
  return [];
}

function selectCutoff(scope, dataset, cutoffParis, cutoffUtc) {
  const timeRange = isObject(dataset.time_range) ? dataset.time_range : {};
  return firstText([
    cutoffParis,
    cutoffUtc,
    isObject(scope) ? scope.cutoff_paris : null,
    isObject(scope) ? scope.cutoff_utc : null,
    dataset.cutoff_paris,
    dataset.cutoff_utc,
    timeRange.to_paris,
    timeRange.to_utc,
  ]);
}

function selectOrderSimulationPolicy(parameters, dataset, plan) {
  const parameterSource = isObject(parameters) ? parameters : {};
  return normalizeOrderSimulationPolicyV1(firstObject([
    parameterSource.order_simulation_policy,
    parameterSource.order_simulation,
    isObject(dataset) ? dataset.order_simulation_policy : null,
    isObject(plan) ? plan.order_simulation_policy : null,
  ]));
}

function selectSimulationPolicy(parameters, dataset, plan) {
  const parameterSource = isObject(parameters) ? parameters : {};
  const source = firstObject([
    parameterSource.simulation_policy,
    parameterSource.simulation,
    isObject(dataset) ? dataset.simulation_policy : null,
    isObject(plan) ? plan.simulation_policy : null,
  ]);
  return {
    schema_version: "canonical_simulation_policy_v1",
    position_at_cutoff: normalizePositionAtCutoffPolicy(firstText([
      source.position_at_cutoff,
      source.open_position_at_cutoff,
      parameterSource.position_at_cutoff,
    ])),
  };
}

function selectSimulationTelemetryPolicy(parameters) {
  const parameterSource = isObject(parameters) ? parameters : {};
  const telemetry = firstObject([
    parameterSource.simulation_telemetry,
    parameterSource.telemetry,
    parameterSource.event_policy,
  ]);
  return {
    record_condition_evaluations: telemetry?.record_condition_evaluations !== false,
  };
}

function buildResultBase({ input, dataset, plan, cutoff }) {
  const strategyVersionId = firstText([
    input.strategy_version_id,
    isObject(input.compiled_artifact) ? input.compiled_artifact.strategy_version_id : null,
    isObject(plan) ? plan.strategy_version_id : null,
  ]);
  const datasetId = firstText([dataset.dataset_id, dataset.id]);
  const startedAt = firstText([input.run_started_at_utc, dataset.sealed_at_utc, dataset.created_at, cutoff]) || "1970-01-01T00:00:00.000Z";
  return {
    schema_version: CANONICAL_SIMULATION_SCHEMA_VERSION_V1,
    simulation_engine: "desk-replay-engine",
    simulation_engine_version: CANONICAL_SIMULATION_ENGINE_VERSION_V1,
    run_id: text(input.run_id) || fallbackSimulationRunId(strategyVersionId, datasetId, input.parameters, input.reproducibility_seed),
    strategy_version_id: strategyVersionId,
    dataset_id: datasetId,
    dataset_hash: datasetContentHash(dataset),
    parameters_hash: `sha256:${canonicalSha256(input.parameters || {})}`,
    reproducibility_seed: input.reproducibility_seed,
    cutoff,
    run_started_at_utc: startedAt,
  };
}

function prepareSimulationInput(context, rowsByInstrument) {
  const cutoffMs = parseTime(context.cutoff);
  const usableRows = context.normalizedRows.filter((row) => parseTime(row.time) <= cutoffMs);
  return {
    usableRows,
    ignoredRows: context.normalizedRows.length - usableRows.length,
    rowsByInstrumentInput: rowsByInstrument || groupRowsByInstrument(usableRows),
    setups: normalizeSetups(selectPlanSetups(context.plan)),
    orderSimulationPolicy: context.orderSimulationPolicy,
    simulationPolicy: context.simulationPolicy,
    telemetryPolicy: context.telemetryPolicy,
    startedAt: context.base.run_started_at_utc,
  };
}

function replayPreparedRows({ usableRows, ignoredRows, rowsByInstrumentInput, setups, orderSimulationPolicy, telemetryPolicy, startedAt, policy }) {
  const simulation = createReplayState({ startedAt, setups, usableRows, ignoredRows, orderSimulationPolicy });
  const setupStates = new Map(setups.map((setup) => [setup.setup_id, createSetupState(setup)]));
  for (let index = 0; index < usableRows.length; index += 1) {
    advanceSimulationRow({ simulation, setupStates, row: usableRows[index], index, usableRows, rowsByInstrumentInput, orderSimulationPolicy, telemetryPolicy, policy });
    if (simulation.status === "REVIEW_REQUIRED") break;
  }
  return simulation;
}

function createReplayState({ startedAt, setups, usableRows, ignoredRows, orderSimulationPolicy }) {
  return {
    events: [event("SIMULATION_STARTED", { at: startedAt, setup_count: setups.length, row_count: usableRows.length, ignored_post_cutoff_rows: ignoredRows, order_simulator_version: ORDER_SIMULATOR_VERSION_V1, order_simulation_policy: orderSimulationPolicy })],
    positions: [],
    openPosition: null,
    status: "COMPLETED",
  };
}

function createSetupState(setup) {
  return { setup, predicateStates: {}, confirmationMs: null, confirmationIndex: null, terminal: false };
}

function advanceSimulationRow({ simulation, setupStates, row, index, usableRows, rowsByInstrumentInput, orderSimulationPolicy, telemetryPolicy, policy }) {
  if (simulation.openPosition) {
    advanceOpenPosition(simulation, row, orderSimulationPolicy);
    return;
  }
  evaluateSetupStatesForRow({ simulation, setupStates, row, index, usableRows, rowsByInstrumentInput, orderSimulationPolicy, telemetryPolicy, policy });
}

function advanceOpenPosition(simulation, row, orderSimulationPolicy) {
  const exit = evaluatePositionExit(simulation.openPosition, row, orderSimulationPolicy);
  if (exit.review_required) {
    simulation.status = "REVIEW_REQUIRED";
    simulation.events.push(event("POSITION_REVIEW_REQUIRED", { row, position_id: simulation.openPosition.position_id, reason: exit.reason }));
    simulation.openPosition.review_required = true;
    return;
  }
  if (!exit.closed) return;
  const closed = closePosition(simulation.openPosition, exit, row);
  simulation.positions.push(closed);
  simulation.events.push(event("ORDER_FILLED", { row, order: exit.order, fill: exit.fill }));
  simulation.events.push(event("POSITION_CLOSED", { row, position: positionEventProjection(closed) }));
  simulation.openPosition = null;
}

function evaluateSetupStatesForRow({ simulation, setupStates, row, index, usableRows, rowsByInstrumentInput, orderSimulationPolicy, telemetryPolicy, policy }) {
  for (const state of orderedSetupStates(setupStates)) {
    if (state.terminal) continue;
    if (setupIsNotYetValidAtRow(state.setup, row)) continue;
    const context = evaluationContextForRow({ state, row, index, usableRows, rowsByInstrumentInput });
    const outcome = evaluateSetupAtRow({
      state,
      row,
      rows: context.rows,
      rowsByInstrument: context.rowsByInstrument,
      policy,
    });
    state.predicateStates = outcome.predicateStates;
    if (telemetryPolicy?.record_condition_evaluations !== false) {
      recordConditionEvaluation(simulation.events, row, state, outcome);
    }
    const opened = applySetupOutcome({ state, outcome, row, index, events: simulation.events, orderSimulationPolicy });
    if (opened) {
      simulation.openPosition = opened;
      break;
    }
  }
}

function setupIsNotYetValidAtRow(setup, row) {
  const validFromMs = parseTime(setup.valid_from_paris || setup.valid_from);
  const rowMs = parseTime(row.time);
  return validFromMs !== null && rowMs !== null && rowMs < validFromMs;
}

function evaluationContextForRow({ state, row, index, usableRows, rowsByInstrumentInput }) {
  if (canEvaluateSetupIncrementally(state.setup)) {
    return {
      rows: [row],
      rowsByInstrument: { [row.instrument || "UNKNOWN"]: [row] },
    };
  }
  return {
    rows: usableRows.slice(0, index + 1),
    rowsByInstrument: boundRowsByInstrument(rowsByInstrumentInput, row.time),
  };
}

function canEvaluateSetupIncrementally(setup) {
  return (Array.isArray(setup.conditions) ? setup.conditions : [])
    .every((condition) => incrementallySupportedPredicate(condition));
}

function incrementallySupportedPredicate(condition = {}) {
  const predicateType = String(condition.predicate_type || "").trim().toUpperCase();
  if (predicateType === "BREAK_RETEST_SEQUENCE") return true;
  if (["ZONE_TOUCH", "REJECTION_PATTERN"].includes(predicateType)) {
    if (condition.atomic_component === true || Boolean(condition.subsumed_by_condition_id)) return true;
    return condition.required_for_trigger !== true
      && !["PRIMARY", "MANDATORY"].includes(String(condition.importance || "").trim().toUpperCase());
  }
  if (predicateType !== "PRICE_RELATION") return false;
  const role = String(condition.role || "").trim().toUpperCase();
  const effect = String(condition.effect || "").trim().toUpperCase();
  return role === "INVALIDATION" || effect === "BLOCK_IF_TRUE";
}

function orderedSetupStates(setupStates) {
  return [...setupStates.values()].sort((left, right) => left.setup.rank - right.setup.rank);
}

function recordConditionEvaluation(events, row, state, outcome) {
  events.push(event("CONDITIONS_EVALUATED", {
    row_time: row.time,
    setup_id: state.setup.setup_id,
    trigger_eligible: outcome.opportunity.trigger_eligible,
    reason: outcome.reason,
    required_satisfied: outcome.conditionEvaluation.required_satisfied,
    required_total: outcome.conditionEvaluation.required_total,
    hard_blockers_active: outcome.conditionEvaluation.hard_blockers_active,
  }));
}

function applySetupOutcome({ state, outcome, row, index, events, orderSimulationPolicy }) {
  if (invalidateSetupIfNeeded(state, outcome, row, events)) return null;
  if (expireSetupIfNeeded(state, outcome, row, events)) return null;
  if (!outcome.opportunity.trigger_eligible) return resetSetupConfirmation(state);
  if (state.confirmationMs === null) return markSetupTriggerEligible(state, row, index, events);
  if (parseTime(row.time) <= state.confirmationMs) return null;
  return openPositionIfEntryTouched(state, row, index, events, orderSimulationPolicy);
}

function invalidateSetupIfNeeded(state, outcome, row, events) {
  if (!outcome.terminalInvalidation) return false;
  if (!activationSequenceStarted(state.predicateStates)) return false;
  state.terminal = true;
  state.setup = { ...state.setup, status: "INVALIDATED" };
  events.push(event("SETUP_INVALIDATED", { row, setup_id: state.setup.setup_id, condition_id: outcome.terminalInvalidation.condition_id }));
  return true;
}

function activationSequenceStarted(predicateStates = {}) {
  const activationStates = Object.values(predicateStates).filter((result) => result?.predicate_type === "BREAK_RETEST_SEQUENCE");
  if (!activationStates.length) return true;
  return activationStates.some((result) => (
    result.state === "SATISFIED"
    || result.machine_state === "WAITING_RETEST"
    || result.machine_state === "RETEST_TOUCHED"
    || result.break_at_paris
  ));
}

function expireSetupIfNeeded(state, outcome, row, events) {
  if (!outcome.expired) return false;
  state.terminal = true;
  state.setup = { ...state.setup, status: "EXPIRED" };
  events.push(event("SETUP_EXPIRED", { row, setup_id: state.setup.setup_id }));
  return true;
}

function resetSetupConfirmation(state) {
  if (state.confirmationMs !== null) state.confirmationMs = null;
  return null;
}

function markSetupTriggerEligible(state, row, index, events) {
  state.confirmationMs = parseTime(row.time);
  state.confirmationIndex = index;
  events.push(event("SETUP_TRIGGER_ELIGIBLE", { row, setup_id: state.setup.setup_id }));
  return null;
}

function openPositionIfEntryTouched(state, row, index, events, orderSimulationPolicy) {
  const entry = evaluateEntry(state.setup, row, index, state.confirmationIndex, orderSimulationPolicy);
  if (entry.review_required) {
    events.push(event("ORDER_REVIEW_REQUIRED", { row, setup_id: state.setup.setup_id, reason: entry.reason, order: entry.order }));
    return null;
  }
  if (entry.rejected) {
    state.terminal = true;
    state.setup = { ...state.setup, status: "REJECTED" };
    events.push(event("ORDER_REJECTED", {
      row,
      setup_id: state.setup.setup_id,
      reason: entry.reason,
      order: entry.order,
      fill: entry.fill,
      geometry: entry.geometry,
    }));
    return null;
  }
  if (!entry.triggered) return null;
  state.terminal = true;
  state.setup = { ...state.setup, status: "TRIGGERED" };
  const position = openSimulatedPosition({ setup: state.setup, entry, row, index });
  if (!position) {
    events.push(event("ORDER_REJECTED", {
      row,
      setup_id: state.setup.setup_id,
      reason: "ENTRY_RISK_GEOMETRY_INVALID",
      order: entry.order,
      fill: entry.fill,
    }));
    return null;
  }
  events.push(event("ORDER_FILLED", { row, order: entry.order, fill: entry.fill }));
  events.push(event("SETUP_TRIGGERED", { row, setup_id: state.setup.setup_id, entry }));
  events.push(event("POSITION_OPENED", { row, position: positionEventProjection(position) }));
  return position;
}

function closeOpenPositionAtCutoff(positions, openPosition, usableRows, events, simulationPolicy = {}) {
  if (!openPosition) return positions;
  const last = usableRows.at(-1) || openPosition.entry_row;
  if (simulationPolicy.position_at_cutoff === "MARK_TO_MARKET_CLOSE") {
    const exit = cutoffMarkToMarketExit(openPosition, last);
    const closed = closePosition(openPosition, exit, last);
    events.push(event("ORDER_FILLED", { row: last, order: exit.order, fill: exit.fill }));
    events.push(event("POSITION_CLOSED_AT_CUTOFF", { row: last, position: positionEventProjection(closed) }));
    events.push(event("POSITION_CLOSED", { row: last, position: positionEventProjection(closed) }));
    return [...positions, closed];
  }
  const marked = markOpenPosition(openPosition, last);
  events.push(event("POSITION_MARKED_OPEN", { row: last, position: positionEventProjection(marked) }));
  return [...positions, marked];
}

function validateSimulationInput({ plan, dataset, normalizedRows, cutoff }) {
  const issues = [];
  const planIssue = planValidationIssue(plan);
  if (planIssue) issues.push(planIssue);
  if (!isObject(dataset)) issues.push("SEALED_DATASET_REQUIRED");
  if (isObject(dataset) && !datasetIsSealed(dataset)) issues.push("DATASET_NOT_SEALED");
  if (!datasetContentHash(dataset)) issues.push("DATASET_HASH_REQUIRED");
  if (!Array.isArray(normalizedRows) || normalizedRows.length === 0) issues.push("DATASET_ROWS_REQUIRED");
  if (parseTime(cutoff) === null) issues.push("CUTOFF_REQUIRED");
  return [...new Set(issues)];
}

function planValidationIssue(plan) {
  if (!isObject(plan)) return "DETERMINISTIC_PLAN_REQUIRED";
  if (plan.valid !== true) return "DETERMINISTIC_PLAN_NOT_COMPILABLE";
  if (!hasPlanSetupArray(plan)) return "DETERMINISTIC_PLAN_NOT_COMPILABLE";
  return null;
}

function hasPlanSetupArray(plan) {
  return Array.isArray(plan.ranked_setups) || Array.isArray(plan.setups);
}

function selectPlanSetups(plan) {
  if (!isObject(plan)) return [];
  if (Array.isArray(plan.ranked_setups)) return plan.ranked_setups;
  if (Array.isArray(plan.setups)) return plan.setups;
  return [];
}

function datasetIsSealed(dataset) {
  if (dataset.sealed === true) return true;
  return String(dataset.status || "").toUpperCase() === "READY";
}

function datasetContentHash(dataset) {
  if (!isObject(dataset)) return null;
  return firstText([dataset.dataset_hash, dataset.provenance_hash, dataset.content_hash]);
}

function evaluateSetupAtRow({ state, row, rows, rowsByInstrument, policy }) {
  const setup = state.setup;
  const nowMs = parseTime(row.time);
  const expiresMs = parseTime(setup.expires_at_paris || setup.expires_at || setup.valid_until_paris || setup.valid_until);
  const rawConditionEvaluation = normalizeAtomicSequenceEvaluation(evaluateDeterministicConditionSetV1({
    conditions: setup.conditions || [],
    rows,
    rowsByInstrument,
    previousStates: state.predicateStates,
    setup,
    nowParis: row.time,
  }));
  const conditionEvaluation = causalConditionEvaluation(rawConditionEvaluation);
  const opportunity = evaluateOpportunitySeekingControlledV1({
    setup,
    conditionEvaluation,
    gates: setup.gates || setup.decision_gates || [],
    nowParis: row.time,
    policy,
    phase: "ENTRY_TRIGGER",
  });
  const terminalInvalidation = conditionEvaluation.results.find((result) => (
    result.state === "INVALIDATED"
    || (result.effect === "BLOCK_IF_TRUE" && result.memory_policy === "INVALIDATE_TERMINAL" && result.state === "SATISFIED")
  )) || null;
  return {
    conditionEvaluation,
    opportunity,
    terminalInvalidation,
    expired: expiresMs !== null && nowMs !== null && nowMs >= expiresMs && !opportunity.trigger_eligible,
    predicateStates: Object.fromEntries(conditionEvaluation.results.map((result) => [result.condition_id, result])),
    reason: opportunity.trigger_eligible ? "TRIGGER_ELIGIBLE" : blockingReason(opportunity),
  };
}

function causalConditionEvaluation(evaluation) {
  const predicateStates = Object.fromEntries((evaluation.results || []).map((result) => [result.condition_id, result]));
  if (activationSequenceStarted(predicateStates)) return evaluation;
  const results = (evaluation.results || []).map((result) => {
    if (!(result.effect === "BLOCK_IF_TRUE" && result.memory_policy === "INVALIDATE_TERMINAL")) return result;
    if (!["SATISFIED", "INVALIDATED"].includes(result.state)) return result;
    return {
      ...result,
      state: "PENDING",
      predicate_true: false,
      reason: "INVALIDATION_ARMED_AFTER_BREAKOUT_SEQUENCE",
    };
  });
  return recomputeConditionEvaluation(evaluation, results);
}

function recomputeConditionEvaluation(evaluation, results) {
  const blockers = results.filter((result) => (
    result.effect === "BLOCK_IF_TRUE"
    || result.role === "VETO"
    || result.role === "INVALIDATION"
    || result.importance === "HARD_BLOCKER"
  ));
  const required = results.filter((result) => (
    result.effect !== "BLOCK_IF_TRUE"
    && (result.required_for_trigger === true || result.role === "ACTIVATION" || result.importance === "MANDATORY")
  ));
  const scoreable = results.filter((result) => ["PRIMARY", "SECONDARY"].includes(result.importance) && Number(result.weight || 0) > 0);
  const scoreableKnown = scoreable.filter((result) => result.state !== "UNKNOWN");
  const configuredWeight = scoreable.reduce((sum, result) => sum + Number(result.weight || 0), 0);
  const knownWeight = scoreableKnown.reduce((sum, result) => sum + Number(result.weight || 0), 0);
  const satisfiedWeight = scoreableKnown
    .filter((result) => result.state === "SATISFIED")
    .reduce((sum, result) => sum + Number(result.weight || 0), 0);
  const primary = scoreable.filter((result) => result.importance === "PRIMARY");
  const primaryKnown = primary.filter((result) => result.state !== "UNKNOWN");
  return {
    ...evaluation,
    results,
    hard_blockers_active: blockers.filter((result) => ["SATISFIED", "INVALIDATED"].includes(result.state)).length,
    hard_blocker_condition_ids: blockers.filter((result) => ["SATISFIED", "INVALIDATED"].includes(result.state)).map((result) => result.condition_id),
    hard_blockers_unknown: blockers.filter((result) => result.state === "UNKNOWN").length,
    hard_blocker_unknown_condition_ids: blockers.filter((result) => result.state === "UNKNOWN").map((result) => result.condition_id),
    required_total: required.length,
    required_satisfied: required.filter((result) => result.state === "SATISFIED").length,
    required_failed: required.filter((result) => ["FAILED", "INVALIDATED", "EXPIRED"].includes(result.state)).length,
    required_failed_condition_ids: required.filter((result) => ["FAILED", "INVALIDATED", "EXPIRED"].includes(result.state)).map((result) => result.condition_id),
    required_unknown: required.filter((result) => result.state === "UNKNOWN").length,
    required_unknown_condition_ids: required.filter((result) => result.state === "UNKNOWN").map((result) => result.condition_id),
    required_not_started: required.filter((result) => result.state === "NOT_STARTED").length,
    required_not_started_condition_ids: required.filter((result) => result.state === "NOT_STARTED").map((result) => result.condition_id),
    required_pending: required.filter((result) => result.state === "PENDING").length,
    required_pending_condition_ids: required.filter((result) => result.state === "PENDING").map((result) => result.condition_id),
    scored_confirmation_count: scoreableKnown.length,
    configured_confirmation_count: scoreable.length,
    weighted_confirmation_score: configuredWeight > 0 ? round(satisfiedWeight / configuredWeight) : null,
    weighted_known_confirmation_score: knownWeight > 0 ? round(satisfiedWeight / knownWeight) : null,
    known_confirmation_coverage_ratio: configuredWeight > 0 ? round(knownWeight / configuredWeight) : null,
    score_weight_satisfied: satisfiedWeight,
    score_weight_known: knownWeight,
    score_weight_total: configuredWeight,
    primary_confirmation_total: primary.length,
    primary_confirmation_known: primaryKnown.length,
    primary_confirmation_satisfied: primaryKnown.filter((result) => result.state === "SATISFIED").length,
    soft_unknown_condition_ids: scoreable.filter((result) => result.state === "UNKNOWN").map((result) => result.condition_id),
  };
}

function evaluateEntry(setup, row, index, submittedIndex, orderSimulationPolicy) {
  const entryPrice = setup.geometry_evaluation?.entry_price ?? canonicalEntryPrice(setup);
  const outcome = simulateEntryOrderV1({ setup, row, index, submittedIndex: submittedIndex || 0, policy: orderSimulationPolicy, entry_price: entryPrice });
  const triggered = outcome.status === "FILLED" || outcome.status === "PARTIALLY_FILLED";
  const price = triggered ? outcome.fill.price : null;
  const geometry = triggered ? validateFilledEntryGeometry(setup, price) : { valid: true };
  if (triggered && !geometry.valid) {
    return {
      triggered: false,
      rejected: true,
      price,
      mode: setup.entry_mode || setup.order_type || "UNKNOWN",
      ...outcome,
      reason: geometry.reason,
      geometry,
    };
  }
  return { triggered, rejected: false, price, mode: setup.entry_mode || setup.order_type || "UNKNOWN", ...outcome, geometry };
}

function normalizeAtomicSequenceEvaluation(evaluation) {
  if (evaluation?.sequence_valid !== false) return evaluation;
  const byId = new Map((evaluation.results || []).map((result) => [result.condition_id, result]));
  const violations = evaluation.sequence_violation_condition_ids || [];
  const atomicOnly = violations.length > 0 && violations.every((conditionId) => {
    const result = byId.get(conditionId);
    const parent = byId.get(result?.subsumed_by_condition_id);
    return result?.atomic_component === true && parent?.state === "SATISFIED";
  });
  if (!atomicOnly) return evaluation;
  return {
    ...evaluation,
    sequence_valid: true,
    sequence_violation_condition_ids: [],
    atomic_sequence_normalized: true,
  };
}

function openSimulatedPosition({ setup, entry, row, index }) {
  const stop = number(setup.stop_loss ?? setup.stop);
  const target = firstTargetPrice(setup);
  const risk = signedRiskPoints(setup.direction, entry.price, stop);
  if (risk === null) return null;
  return {
    position_id: `simpos_${setup.setup_id}_${index}`,
    setup_id: setup.setup_id,
    instrument: setup.instrument,
    direction: setup.direction,
    status: "OPEN",
    entry_price: entry.price,
    entry_raw_price: entry.fill?.raw_price ?? entry.price,
    entry_time: row.time,
    entry_row: row,
    entry_order: entry.order,
    entry_fill: entry.fill,
    entry_commission_r: entry.fill?.commission_r || 0,
    quantity: entry.fill?.quantity || 1,
    stop_loss: stop,
    take_profit_1: target,
    risk_points: risk,
  };
}

function evaluatePositionExit(position, row, orderSimulationPolicy) {
  const outcome = simulateExitOrderV1({ position, row, policy: orderSimulationPolicy });
  if (outcome.review_required) return { closed: false, review_required: true, reason: outcome.reason, order: outcome.order, fill: outcome.fill };
  if (outcome.status !== "FILLED" && outcome.status !== "PARTIALLY_FILLED") return { closed: false };
  return { closed: true, reason: outcome.reason, price: outcome.fill.price, raw_price: outcome.fill.raw_price, order: outcome.order, fill: outcome.fill };
}

function cutoffMarkToMarketExit(position, row) {
  const price = number(row.close);
  const quantity = Number.isFinite(Number(position.quantity)) ? Number(position.quantity) : 1;
  const direction = normalizeDirection(position.direction);
  const side = direction === "short" ? "BUY" : "SELL";
  return {
    closed: true,
    reason: "CUTOFF_MARK_TO_MARKET",
    price,
    raw_price: price,
    order: {
      order_id: `simord_${text(position.position_id) || "position"}_cutoff_mark_to_market`,
      phase: "EXIT",
      setup_id: text(position.setup_id),
      instrument: text(position.instrument),
      direction,
      side,
      order_type: "MARKET",
      quantity,
      limit_price: null,
      stop_price: null,
      status: "FILLED",
    },
    fill: {
      status: price === null ? "PENDING" : "FILLED",
      reason: "CUTOFF_MARK_TO_MARKET",
      price,
      raw_price: price,
      quantity: price === null ? 0 : quantity,
      requested_quantity: quantity,
      commission_r: 0,
    },
  };
}

function closePosition(position, exit, row) {
  const grossR = priceToR(position, exit.price);
  const executionCostR = round((position.entry_commission_r || 0) + (exit.fill?.commission_r || 0));
  return {
    ...position,
    status: "CLOSED",
    exit_time: row.time,
    exit_price: exit.price,
    exit_raw_price: exit.raw_price ?? exit.price,
    exit_reason: exit.reason,
    exit_order: exit.order,
    exit_fill: exit.fill,
    gross_r: grossR,
    execution_cost_r: executionCostR,
    r_result: grossR === null ? null : round(grossR - executionCostR),
  };
}

function markOpenPosition(position, row) {
  return {
    ...position,
    status: "OPEN",
    mark_time: row.time,
    mark_price: number(row.close),
    unrealized_r: priceToR(position, number(row.close)),
  };
}

function normalizeSetups(setups) {
  return (Array.isArray(setups) ? setups : [])
    .filter((setup) => setup?.compile_status === "COMPILED")
    .map((setup, index) => ({
      ...setup,
      rank: Number.isInteger(setup.rank) ? setup.rank : index + 1,
      backend_can_trigger: setup.trigger_policy?.backend_can_trigger !== false,
    }))
    .sort((left, right) => left.rank - right.rank || String(left.setup_id).localeCompare(String(right.setup_id)));
}

function normalizeRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeRow)
    .filter(isUsableClosedRow)
    .sort(compareRows);
}

function normalizeRow(row) {
  const source = isObject(row) ? row : {};
  return {
    ...source,
    instrument: firstText([source.instrument, source.symbol, source.contract]),
    timeframe: firstText([source.timeframe, source.interval, "M1"]),
    time: firstText([source.timestamp_paris, source.close_time_paris, source.time_paris, source.timestamp, source.time, source.candle_close_utc, source.close_timestamp_utc]),
    open: number(source.open),
    high: number(source.high),
    low: number(source.low),
    close: number(source.close),
    closed: candleIsClosed(source),
  };
}

function candleIsClosed(row) {
  if (row.closed === false) return false;
  if (row.is_closed === false) return false;
  return String(row.status || "CLOSED").toUpperCase() !== "OPEN";
}

function isUsableClosedRow(row) {
  if (!row.closed) return false;
  if (parseTime(row.time) === null) return false;
  return [row.open, row.high, row.low, row.close].every((value) => value !== null);
}

function compareRows(left, right) {
  return parseTime(left.time) - parseTime(right.time) || String(left.instrument).localeCompare(String(right.instrument));
}

function groupRowsByInstrument(rows) {
  const grouped = {};
  for (const row of rows) {
    const key = row.instrument || "UNKNOWN";
    grouped[key] ||= [];
    grouped[key].push(row);
  }
  return grouped;
}

function boundRowsByInstrument(rowsByInstrument, cutoff) {
  const cutoffMs = parseTime(cutoff);
  const bound = (items) => (Array.isArray(items) ? items : []).filter((row) => parseTime(row.time || row.timestamp_paris || row.timestamp) <= cutoffMs);
  if (rowsByInstrument instanceof Map) return new Map([...rowsByInstrument.entries()].map(([key, items]) => [key, bound(items)]));
  return Object.fromEntries(Object.entries(rowsByInstrument || {}).map(([key, items]) => [key, bound(items)]));
}

function canonicalEntryPrice(setup) {
  const zone = entryZoneBounds(setup);
  if (zone.lower !== null && zone.upper !== null) return entryPriceFromZone(setup, zone);
  return firstSetupNumber([setup.entry_price, setup.entry, setup.order_limit_price]);
}

function entryZoneBounds(setup) {
  const zone = isObject(setup.entry_zone) ? setup.entry_zone : {};
  return {
    lower: firstSetupNumber([zone.lower, zone.from, zone.min]),
    upper: firstSetupNumber([zone.upper, zone.to, zone.max]),
  };
}

function entryPriceFromZone(setup, zone) {
  return String(setup.direction).toLowerCase() === "short" ? zone.lower : zone.upper;
}

function firstTargetPrice(setup) {
  const target = Array.isArray(setup.targets) ? setup.targets[0] : null;
  return number(setup.take_profit_1 ?? target?.price ?? target?.target ?? setup.tp1);
}

function firstObject(values) {
  return values.find((value) => isObject(value)) || {};
}

function firstSetupNumber(values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = number(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function priceToR(position, price) {
  if (price === null || position.entry_price === null || !position.risk_points) return null;
  if (!positionRiskGeometryIsValid(position)) return null;
  const direction = String(position.direction).toLowerCase();
  const pnl = direction === "short" ? position.entry_price - price : price - position.entry_price;
  return round(pnl / position.risk_points, 4);
}

function validateFilledEntryGeometry(setup, entryPrice) {
  const direction = normalizeDirection(setup.direction);
  const entry = number(entryPrice);
  const stop = number(setup.stop_loss ?? setup.stop);
  const target = firstTargetPrice(setup);
  if (entry === null) return geometryIssue("ENTRY_PRICE_REQUIRED", { direction, entry, stop, target });
  if (stop === null) return geometryIssue("STOP_LOSS_REQUIRED", { direction, entry, stop, target });
  if (!entryStopGeometryIsValid(direction, entry, stop)) {
    return geometryIssue("ENTRY_STOP_GEOMETRY_INVALID", { direction, entry, stop, target });
  }
  if (target !== null && !entryTargetGeometryIsValid(direction, entry, target)) {
    return geometryIssue("ENTRY_TARGET_GEOMETRY_INVALID", { direction, entry, stop, target });
  }
  return { valid: true, direction, entry, stop, target };
}

function signedRiskPoints(directionValue, entryPrice, stopPrice) {
  const direction = normalizeDirection(directionValue);
  const entry = number(entryPrice);
  const stop = number(stopPrice);
  if (entry === null || stop === null) return null;
  if (!entryStopGeometryIsValid(direction, entry, stop)) return null;
  return round(direction === "short" ? stop - entry : entry - stop, 4);
}

function positionRiskGeometryIsValid(position) {
  const direction = normalizeDirection(position.direction);
  const entry = number(position.entry_price);
  const stop = number(position.stop_loss);
  if (entry === null || stop === null) return false;
  return entryStopGeometryIsValid(direction, entry, stop);
}

function entryStopGeometryIsValid(direction, entry, stop) {
  return direction === "short" ? stop > entry : stop < entry;
}

function entryTargetGeometryIsValid(direction, entry, target) {
  return direction === "short" ? target < entry : target > entry;
}

function geometryIssue(reason, geometry) {
  return { valid: false, reason, ...geometry };
}

function normalizeDirection(value) {
  return String(value || "").toLowerCase() === "short" ? "short" : "long";
}

function normalizePositionAtCutoffPolicy(value) {
  const normalized = String(value || "").toUpperCase();
  if (["MARK_TO_MARKET_CLOSE", "CLOSE_MARK_TO_MARKET", "CLOSE_AT_LAST_CLOSE"].includes(normalized)) return "MARK_TO_MARKET_CLOSE";
  return "MARK_OPEN";
}

function blockingReason(opportunity) {
  return opportunity.hard_failures?.[0]?.evidence?.internal_gate_code || opportunity.hard_failures?.[0]?.code || "CONDITIONS_PENDING";
}
