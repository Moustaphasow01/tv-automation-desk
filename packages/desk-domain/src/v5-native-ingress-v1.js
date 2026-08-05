export function normalizeV5MasterIngressV1(rawMaster = {}) {
  const master = object(rawMaster);
  const deterministicPlan = object(master.deterministic_execution_plan);
  const executionPlan = object(master.execution_plan);
  const plan = Object.keys(deterministicPlan).length > 0 ? deterministicPlan : executionPlan;
  const risk = object(plan.risk || plan.risk_policy || master.risk || master.risk_policy);
  const setups = firstArray(plan.setups, plan.ranked_setups, master.setups, master.setup_candidates);
  const planGates = firstArray(plan.gates?.hard, executionPlan.gates?.hard)
    .concat(firstArray(plan.gates?.soft, executionPlan.gates?.soft));
  return {
    ...master,
    plan_id: master.plan_id || plan.plan_id || null,
    contract_name: master.contract_name || master.contract?.name,
    contract_version: master.contract_version || master.contract?.version,
    analysis_id: master.analysis_id || master.source?.master_analysis_id || master.source?.analysis_id || master.source?.master_id,
    pack_id: master.pack_id || master.source?.pack_id || plan.source?.pack_id,
    pack_build_id: master.pack_build_id || master.source?.pack_build_id || plan.source?.pack_build_id,
    timestamp_paris: master.timestamp_paris
      || master.checkpoint?.checkpoint_paris
      || master.source?.timestamp_paris,
    setups: setups.map((setup) => normalizeV5SetupIngressV1(setup, { planRisk: risk })),
    no_setup_proof: master.no_setup_proof
      || plan.no_setup_proof
      || executionPlan.no_setup_proof
      || deterministicPlan.no_setup_proof
      || null,
    active_thesis: normalizeNativeThesis(
      master.active_thesis
        || master.thesis
        || plan.thesis_plan
        || executionPlan.thesis_plan
        || null,
    ),
    decision_gates: planGates.length > 0 ? planGates : master.decision_gates,
    plan_disposition: plan.disposition || master.plan_disposition || null,
    primary_setup_id: plan.primary_setup_id || master.primary_setup_id || null,
  };
}

export function normalizeV5SetupIngressV1(
  rawSetup = {},
  { planRisk = {}, riskAuthority = "SETUP_OR_PLAN" } = {},
) {
  const source = object(rawSetup);
  const order = object(source.order || source.execution?.order);
  const entry = object(source.entry || order.entry);
  const protection = object(source.protection || source.execution?.protection);
  const stop = object(source.stop || protection.stop);
  const parameters = object(source.parameters || source.execution?.parameters);
  const validity = object(source.validity || parameters.validity);
  const risk = object(source.risk || source.risk_policy || parameters.risk || planRisk);
  const management = source.management
    || source.management_policy
    || protection.management
    || protection.management_policy
    || parameters.management;
  const conditions = firstArray(
    source.conditions,
    parameters.conditions,
    source.activation_conditions,
    source.confirmation_conditions,
    source.execution?.conditions,
  ).map(normalizeV5ConditionIngressV1);
  const invalidations = firstArray(
    source.invalidation_conditions,
    source.veto_conditions,
    protection.invalidation_conditions,
  ).map((condition) => normalizeV5ConditionIngressV1({
    ...object(condition),
    role: "INVALIDATION",
    effect: "BLOCK_IF_TRUE",
    importance: "HARD_BLOCKER",
    required_for_trigger: false,
    memory_policy: "INVALIDATE_TERMINAL",
  }));
  const zone = source.entry_zone
    || order.entry_zone
    || entry.zone
    || (entry.zone_lower !== undefined || entry.zone_upper !== undefined
      ? { lower: entry.zone_lower, upper: entry.zone_upper }
      : null)
    || (order.zone_lower !== undefined || order.zone_upper !== undefined
      ? { lower: order.zone_lower, upper: order.zone_upper }
      : null)
    || parameters.entry_zone;
  const targets = firstArray(
    source.targets,
    source.take_profits,
    protection.targets,
    source.execution?.targets,
  );
  return {
    ...source,
    status: source.requested_state || source.status || source.lifecycle_status,
    instrument: source.instrument || order.instrument || order.contract || entry.instrument,
    direction: source.direction || source.side || order.direction || order.side,
    order_type: source.order_type || order.order_type || order.type,
    entry_mode: source.entry_mode || order.entry_mode || entry.mode,
    entry_price: source.entry_price
      ?? order.entry_price
      ?? order.price
      ?? entry.price
      ?? entry.stop_price
      ?? parameters.entry_price,
    entry_stop_price: source.entry_stop_price
      ?? source.order_stop_price
      ?? order.stop_price
      ?? entry.stop_price
      ?? parameters.entry_stop_price,
    entry_limit_price: source.entry_limit_price
      ?? source.order_limit_price
      ?? order.limit_price
      ?? entry.limit_price
      ?? parameters.entry_limit_price,
    entry_zone: normalizeZone(zone),
    stop_loss: source.stop_loss
      ?? protection.stop_loss
      ?? protection.stop_price
      ?? stop.price
      ?? stop.level,
    take_profit_1: source.take_profit_1
      ?? protection.take_profit_1
      ?? parameters.take_profit_1
      ?? targetPrice(targets[0]),
    take_profits: targets,
    rr_minimum: source.rr_minimum
      ?? source.rr_expected
      ?? parameters.rr_minimum
      ?? parameters.min_rr
      ?? risk.rr_minimum
      ?? risk.min_rr,
    risk_pct: riskAuthority === "PINNED_PLAN"
      ? planRisk.risk_pct_requested
      : source.risk_pct
        ?? parameters.risk_pct
        ?? parameters.risk_percent
        ?? risk.risk_pct_requested
        ?? risk.risk_pct
        ?? risk.max_risk_pct,
    valid_from_paris: source.valid_from_paris
      || parameters.valid_from_paris
      || order.valid_from_paris
      || validity.valid_from_paris
      || validity.valid_from,
    expires_at_paris: source.expires_at_paris
      || parameters.expires_at_paris
      || order.expires_at_paris
      || validity.expires_at_paris
      || validity.expires_at
      || validity.valid_until_paris
      || validity.valid_until,
    conditions,
    invalidation_conditions: invalidations,
    trigger_policy: {
      ...object(source.trigger_policy),
      threshold_tolerance_points: source.trigger_policy?.threshold_tolerance_points
        ?? source.tolerance_points
        ?? parameters.tolerance_points,
      min_score: source.trigger_policy?.min_score ?? parameters.min_score,
    },
    management_policy: management,
  };
}

export function normalizeV5ConditionIngressV1(rawCondition = {}) {
  const condition = object(rawCondition);
  const parameters = object(condition.parameters);
  const temporal = object(condition.temporal_rule || parameters.temporal_rule);
  const eventWindow = object(parameters.event_window_ref || condition.event_window_ref);
  const zone = condition.zone
    || parameters.zone
    || (parameters.zone_lower !== undefined || parameters.zone_upper !== undefined
      ? { lower: parameters.zone_lower, upper: parameters.zone_upper }
      : null);
  return {
    ...condition,
    predicate_type: condition.predicate_type || condition.type,
    instrument: condition.instrument
      || parameters.instrument
      || parameters.reference_instrument,
    timeframe: condition.timeframe || parameters.timeframe,
    operator: condition.operator || parameters.operator,
    threshold: condition.threshold
      ?? parameters.threshold
      ?? parameters.retest_level,
    zone,
    lower_threshold: condition.lower_threshold ?? parameters.zone_lower,
    upper_threshold: condition.upper_threshold ?? parameters.zone_upper,
    break_condition_id: condition.break_condition_id ?? parameters.break_condition_id,
    retest_level: condition.retest_level ?? parameters.retest_level,
    tolerance_points: condition.tolerance_points ?? parameters.tolerance_points,
    max_bars: condition.max_bars ?? parameters.max_bars,
    require_rejection_confirmation: condition.require_rejection_confirmation
      ?? parameters.require_rejection_confirmation,
    reference_code: condition.reference_code ?? parameters.reference_code,
    indicator_period: condition.indicator_period ?? parameters.indicator_period,
    start_paris: condition.start_paris
      || condition.window_start_paris
      || parameters.window_start_paris,
    end_paris: condition.end_paris
      || condition.window_end_paris
      || parameters.window_end_paris,
    reference_instrument: condition.reference_instrument
      || parameters.reference_instrument,
    event_window_ref: condition.event_window_ref || parameters.event_window_ref,
    before_minutes: condition.before_minutes
      ?? parameters.before_minutes
      ?? eventWindow.before_minutes,
    after_minutes: condition.after_minutes
      ?? parameters.after_minutes
      ?? eventWindow.after_minutes,
    reference_time_paris: condition.reference_time_paris
      || parameters.reference_time_paris
      || eventWindow.reference_time_paris,
    temporal_rule: {
      ...temporal,
      mode: temporal.mode || parameters.temporal_mode || "LATEST_CLOSED",
    },
    parameters,
  };
}

function normalizeNativeThesis(value) {
  const thesis = object(value);
  if (Object.keys(thesis).length === 0) return null;
  return {
    ...thesis,
    status: thesis.status || thesis.state || thesis.current_state,
    valid_from: thesis.valid_from || thesis.valid_from_paris,
    valid_until: thesis.valid_until || thesis.valid_until_paris,
    requires_replan_after: thesis.requires_replan_after || thesis.requires_replan_after_paris,
  };
}

function normalizeZone(value) {
  const zone = object(value);
  if (Object.keys(zone).length === 0) return undefined;
  return {
    lower: zone.lower ?? zone.from ?? zone.min ?? zone.zone_lower,
    upper: zone.upper ?? zone.to ?? zone.max ?? zone.zone_upper,
  };
}

function targetPrice(target) {
  if (typeof target === "number") return target;
  const source = object(target);
  return source.price ?? source.target ?? source.level;
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length > 0)
    || values.find((value) => Array.isArray(value))
    || [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
