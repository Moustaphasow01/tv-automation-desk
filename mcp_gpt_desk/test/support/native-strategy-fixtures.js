const HARD_GATE_PHASES = Object.freeze({
  ANTI_LOOKAHEAD_FAILED: "PLAN_COMPILE",
  SCOPE_CONTRACT_MISMATCH: "PLAN_COMPILE",
  CANONICAL_TRIGGER_DATA_MISSING: "ENTRY_TRIGGER",
  GEOMETRY_INVALID: "SETUP_ARM",
  RR_BELOW_MINIMUM: "SETUP_ARM",
  STOP_INVALID: "SETUP_ARM",
  TARGET_INVALID: "SETUP_ARM",
  SETUP_EXPIRED_OR_TERMINAL: "ENTRY_TRIGGER",
  DETERMINISTIC_VETO_ACTIVE: "ENTRY_TRIGGER",
  BROKER_SAFETY_FAILED: "BROKER_SUBMIT",
  MAJOR_EVENT_ENTRY_BLOCK: "ENTRY_TRIGGER",
  MANDATORY_INDICATOR_MISSING: "ENTRY_TRIGGER",
});

export function makeNativeMasterV5({
  mode = "REPLAY",
  tradingDate = "2026-07-30",
  session = "asia_open",
  runId = "run-native",
  cutoffParis = "2026-07-30T09:00:00+02:00",
  analysisId = "analysis-native-v5",
  bundleId = "bundle-native",
  packId = "pack-native",
  packBuildId = "packbuild-native",
  planId = "plan-native-v1",
  thesisId = "thesis-native",
  setupId = null,
} = {}) {
  const planScope = scope({ mode, tradingDate, session, runId, cutoffParis });
  const masterScope = { ...planScope, analysis_phase: "ASIA_OPEN" };
  const setup = setupId ? nativeSetup({ setupId, cutoffParis }) : null;
  const selectedHypothesisId = setup ? "hyp-0" : "hyp-5";
  const selectedKind = setup ? "BULL" : "WAIT";
  const validUntilParis = plusMinutes(cutoffParis, 30);
  const audit = auditContext("master", bundleId);
  const watchConditionIds = setup ? setup.conditions.map((condition) => condition.condition_id) : [];

  return {
    contract: { name: "DeskMasterAnalysisContract", version: "5.4.0" },
    profile: "OPPORTUNITY_SEEKING_CONTROLLED",
    source: { analysis_id: analysisId, bundle_id: bundleId, pack_id: packId, pack_build_id: packBuildId },
    scope: masterScope,
    analysis_sections: {
      facts: [{ fact_id: "fact-1", category: "PRICE", statement: setup ? "MNQ has a deterministic long opportunity." : "MNQ remains inside its canonical range.", evidence_refs: [bundleId] }],
      interpretations: [{ interpretation_id: "interp-1", statement: setup ? "The setup can be monitored by the backend." : "Wait for a cleaner opportunity.", fact_ids: ["fact-1"], confidence: 0.6 }],
      macro: assessment("Neutral"),
      cross_asset: assessment("Neutral"),
      technical: assessment(setup ? "Long opportunity" : "Range"),
      levels: assessment("Canonical levels available"),
      asset_selection: assessment("MNQ retained"),
      opportunities: setup ? ["Controlled MNQ long setup"] : [],
      risks: ["Invalidation remains protected by a structural stop"],
      decision_summary: setup ? "Publish one conditional setup." : "Management only until a better price appears.",
    },
    market_context: { global_regime: setup ? "RISK_ON_EXPANSION" : "RANGE", regime_status: "DOMINANT", volatility_regime: "NORMAL", primary_bias: setup ? "BULLISH" : "NEUTRAL", cross_asset_reading: "Neutral", macro_reading: "Neutral" },
    hypotheses: ["BULL", "BEAR", "RANGE", "BEST_LONG", "BEST_SHORT", "WAIT"].map(hypothesis),
    selected_hypothesis: { hypothesis_id: selectedHypothesisId, kind: selectedKind, reason: setup ? "Canonical geometry and activation condition are available." : "No clean geometry at the cutoff." },
    execution_plan: {
      contract: { name: "DeskExecutionPlanContract", version: "1.4.0" },
      profile: "OPPORTUNITY_SEEKING_CONTROLLED",
      catalog_id: "condition_catalog_v1_2",
      plan_id: planId,
      source: { master_analysis_id: analysisId, bundle_id: bundleId, pack_id: packId, pack_build_id: packBuildId },
      scope: planScope,
      disposition: setup ? "SETUP_CONDITIONAL" : "MANAGEMENT_ONLY",
      primary_setup_id: setupId,
      execution_authority: "BACKEND_ONLY",
      validity: { valid_from_paris: cutoffParis, expires_at_paris: validUntilParis },
      gates: { hard: hardGates(), soft: [] },
      risk: { capital_basis: "NET_EQUITY", risk_pct_requested: 0.25, min_rr: 2, min_weighted_confirmation_ratio: 0.55 },
      setups: setup ? [setup] : [],
      no_setup_proof: null,
      monitoring: { engine_cadence: "M1", gpt_cadence: "M15", next_checkpoint_paris: plusMinutes(cutoffParis, 15), watch_condition_ids: watchConditionIds },
      audit,
    },
    active_thesis: {
      thesis_id: thesisId,
      plan_id: planId,
      selected_hypothesis_id: selectedHypothesisId,
      primary_setup_id: setupId,
      state: setup ? "CONDITIONAL" : "WAIT_MONITORED",
      bias: setup ? "BULLISH" : "NEUTRAL",
      instrument: "MNQ",
      direction: setup ? "long" : "wait",
      valid_from_paris: cutoffParis,
      valid_until_paris: validUntilParis,
      requires_replan_after_paris: validUntilParis,
      health_state: "VALID",
      summary: setup ? "Controlled opportunity under deterministic monitoring." : "Waiting for a controlled opportunity.",
      expected_path: [{ sequence: 1, condition: "Canonical conditions remain valid", implication: "Continue deterministic monitoring" }],
      failure_path: [{ sequence: 1, condition: "Structure invalidates", implication: "Cancel or replan" }],
      scenario_transformations: [],
      level_watchlist: setup ? [{ instrument: "MNQ", label: "Entry", price: 101, purpose: "ACTIVATION" }] : [],
      invalidation_condition_ids: [],
    },
    monitor_handoff: {
      gpt_cadence: "M15",
      engine_cadence: "M1",
      next_checkpoint_paris: plusMinutes(cutoffParis, 15),
      watch_condition_ids: watchConditionIds,
      thesis_health_baseline: 70,
      context_transmission: { facts: [setup ? "Conditional setup published" : "Range retained"], interpretations: [setup ? "Backend must evaluate conditions" : "Wait"], thesis_state: setup ? "CONDITIONAL" : "WAIT_MONITORED", open_questions: [] },
      session_matrix: [],
      allowed_windows: [],
      update_agenda: [],
      monitoring_priorities: ["Watch canonical price conditions"],
      monitoring_playbook: [{ condition_id: watchConditionIds[0] || "watch-price", on_state: "UNKNOWN", requested_command: "NOOP" }],
      handoff_summary: "Monitor the next scheduled M15 cutoff while the backend evaluates every M1.",
    },
    audit,
  };
}

export function makeNativeMonitorV2({
  mode = "REPLAY",
  tradingDate = "2026-07-30",
  session = "asia_open",
  runId = "run-native",
  cutoffParis = "2026-07-30T09:15:00+02:00",
  windowStartParis = null,
  monitorId = "monitor-native-v2",
  bundleId = "bundle-monitor",
  packId = "pack-native",
  packBuildId = "packbuild-native",
  masterId = "analysis-native-v5",
  planId = "plan-native-v1",
  thesisId = "thesis-native",
  commandId = "command-native",
  expectedRevision = 1,
  setupId = null,
  requestReplan = false,
} = {}) {
  const monitorScope = scope({ mode, tradingDate, session, runId, cutoffParis });
  const start = windowStartParis || plusMinutes(cutoffParis, -15);
  const validUntilParis = plusMinutes(cutoffParis, 25);
  const audit = auditContext("monitor", bundleId);
  const replanRequest = requestReplan
    ? { command: "REQUEST", reason: "The replay test requests a fresh Master.", requested_at_paris: cutoffParis, dedupe_key: `replan:${monitorId}` }
    : null;
  return {
    contract: { name: "DeskHourlyThesisMonitorContract", version: "2.4.0" },
    profile: "OPPORTUNITY_SEEKING_CONTROLLED",
    catalog_id: "condition_catalog_v1_2",
    source: { monitor_id: monitorId, bundle_id: bundleId, pack_id: packId, pack_build_id: packBuildId },
    scope: monitorScope,
    links: { master_analysis_id: masterId, plan_id: planId, active_thesis_id: thesisId, previous_monitor_id: null, setup_id: setupId, position_id: null },
    checkpoint: { checkpoint_paris: cutoffParis, gpt_cadence: "M15", engine_cadence: "M1", window_start_paris: start, window_end_paris: cutoffParis },
    delta_summary: { facts: ["Canonical context remains available"], interpretations: ["Continue deterministic monitoring"], thesis_evolution: "Stable", new_risks: [], new_opportunities: [] },
    assessment: { expected_path: ["Stable context"], realized_path: ["Stable context"], failure_path: [], causality_summary: "Expected path retained." },
    checks: {
      expected_vs_realized: unchanged("Aligned"),
      macro_update: unchanged("Unchanged"),
      cross_asset_delta: unchanged("Unchanged"),
      technical_delta: unchanged("Unchanged"),
      weak_signals: unchanged("None"),
      scenario_transformation: unchanged("None"),
      time_decay: unchanged("Valid"),
      position: unchanged("Flat"),
    },
    condition_evaluations: [],
    thesis_health: { state: "VALID", score: 70, previous_score: 70, drivers: ["Stable structure"] },
    command: {
      contract: { name: "DeskMonitorCommandContract", version: "1.4.0" },
      profile: "OPPORTUNITY_SEEKING_CONTROLLED",
      catalog_id: "condition_catalog_v1_2",
      command_id: commandId,
      expected_revision: Number(expectedRevision),
      created_at_paris: cutoffParis,
      plan_id: planId,
      monitor_id: monitorId,
      scope: monitorScope,
      requested_action: requestReplan ? "APPLY_ORTHOGONAL_COMMANDS" : "NO_ACTION",
      setup_transition: null,
      transformation: null,
      replan_request: replanRequest,
      management_request: null,
      evidence: { facts: ["Canonical context remains available"], interpretations: ["Continue deterministic monitoring"], thesis_evolution: "Stable", source_references: [bundleId] },
      backend_authority: "BACKEND_ONLY",
      audit,
    },
    active_thesis_update: { thesis_id: thesisId, state: requestReplan ? "REPLAN_REQUIRED" : setupId ? "CONDITIONAL" : "WAIT_MONITORED", health_score: 70, summary: "Stable", valid_until_paris: validUntilParis, requires_replan_after_paris: validUntilParis },
    data_quality: { status: "CANONICAL", hard_gate_states: hardGates(), soft_gate_states: [], notes: [] },
    catchup: { policy: "LATEST_SETTLED_CLOSED_M15", cumulative_window_start_paris: start, cumulative_window_end_paris: cutoffParis, superseded_checkpoints: [] },
    alert: null,
    next_handoff: { next_checkpoint_paris: plusMinutes(cutoffParis, 15), watch_condition_ids: [], priorities: ["Price"], context_summary: "Continue monitoring." },
    audit,
  };
}

function nativeSetup({ setupId, cutoffParis }) {
  return {
    setup_id: setupId,
    rank: 1,
    requested_state: "ARMED_CONDITIONAL",
    pattern: "CONTINUATION",
    instrument: "MNQ",
    direction: "long",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry: { price: 101 },
    stop: { type: "STRUCTURAL", price: 99 },
    targets: [{ target_id: "tp1", price: 105, action: "FULL_CLOSE", close_fraction: 1 }],
    rr_expected: 2,
    conditions: [{
      condition_id: `${setupId}__activation`,
      label: "MNQ closes above activation level",
      predicate_type: "PRICE_RELATION",
      role: "ACTIVATION",
      effect: "REQUIRE_TRUE",
      instrument: "MNQ",
      timeframe: "M1",
      operator: "CLOSE_ABOVE",
      parameters: { threshold: 100 },
      importance: "MANDATORY",
      required_for_trigger: true,
      memory_policy: "LATCH_UNTIL_TRIGGER",
      weight: 0,
      sequence: 1,
      temporal_rule: { mode: "LATEST_CLOSED", count: null },
      evidence_refs: ["MNQ_M1"],
    }],
    management: { break_even_at_r: 0.7, tp1_close_fraction: 1 },
    validity: { valid_from_paris: cutoffParis, expires_at_paris: plusMinutes(cutoffParis, 30) },
    rationale: "Canonical continuation with deterministic activation.",
    evidence_refs: ["MNQ_M1"],
  };
}

function scope({ mode, tradingDate, session, runId, cutoffParis }) {
  return { mode: String(mode).toUpperCase(), trading_date: tradingDate, session, run_id: runId, cutoff_paris: cutoffParis, timezone: "Europe/Paris" };
}

function hardGates() {
  return Object.entries(HARD_GATE_PHASES).map(([code, enforcement_phase]) => ({ code, state: "PASS", reason: null, evidence_refs: [], enforcement_phase, pass_semantics: "FAILURE_ABSENT" }));
}

function auditContext(kind, sourceReference) {
  return {
    anti_lookahead_verified: true,
    contract_context: kind === "master"
      ? { master_contract: "5.4.0", execution_plan_contract: "1.4.0", execution_policy_contract: "4.3.0", condition_catalog_contract: "1.2.0" }
      : { monitor_contract: "2.4.0", monitor_command_contract: "1.4.0", execution_policy_contract: "4.3.0", condition_catalog_contract: "1.2.0" },
    source_references: [sourceReference],
  };
}

function hypothesis(kind, index) {
  return {
    hypothesis_id: `hyp-${index}`,
    kind,
    status: kind === "WAIT" ? "WAIT_PROVED" : "CANDIDATE",
    instrument: "MNQ",
    direction: kind === "BEAR" || kind === "BEST_SHORT" ? "short" : kind === "WAIT" || kind === "RANGE" ? "wait" : "long",
    confidence: 0.5,
    thesis: `${kind} hypothesis`,
    supporting_fact_ids: ["fact-1"],
    contradicting_fact_ids: [],
    invalidation: "Invalid if the canonical structure changes.",
  };
}

function assessment(summary) {
  return { summary, findings: [], evidence_refs: [] };
}

function unchanged(summary) {
  return { status: "UNCHANGED", summary, evidence_refs: [] };
}

function plusMinutes(value, minutes) {
  return new Date(Date.parse(value) + (minutes * 60_000)).toISOString();
}
