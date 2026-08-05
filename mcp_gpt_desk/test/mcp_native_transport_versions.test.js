import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { callDeskTool, createDeskToolRegistry, listDeskTools } from "../src/tools.js";

const liveScope = {
  strategy_id: "asia_open",
  session: "asia_open",
  mode: "live",
  trading_date: "2026-07-30",
  run_id: "live_transport_v5",
  as_of_utc: "2026-07-30T07:00:00Z",
  timezone: "Europe/Paris",
};
const hardGatePhases = {
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
};

function sourceScope(mode = "LIVE") {
  return { mode, trading_date: "2026-07-30", session: "asia_open", run_id: "run-native", cutoff_paris: "2026-07-30T09:00:00+02:00", timezone: "Europe/Paris" };
}

function auditContext(kind) {
  return {
    anti_lookahead_verified: true,
    contract_context: kind === "master"
      ? { master_contract: "5.4.0", execution_plan_contract: "1.4.0", execution_policy_contract: "4.3.0", condition_catalog_contract: "1.2.0" }
      : { monitor_contract: "2.4.0", monitor_command_contract: "1.4.0", execution_policy_contract: "4.3.0", condition_catalog_contract: "1.2.0" },
    source_references: ["bundle-native"],
  };
}

function hardGates() {
  return Object.entries(hardGatePhases).map(([code, enforcement_phase]) => ({
    code,
    state: "PASS",
    reason: null,
    evidence_refs: [],
    enforcement_phase,
    pass_semantics: "FAILURE_ABSENT",
  }));
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

function masterOutput(mode = "LIVE") {
  const scope = sourceScope(mode);
  const masterScope = { ...scope, analysis_phase: "ASIA_OPEN" };
  const analysisAudit = auditContext("master");
  return {
    contract: { name: "DeskMasterAnalysisContract", version: "5.4.0" },
    profile: "OPPORTUNITY_SEEKING_CONTROLLED",
    source: { analysis_id: "analysis-native-v5", bundle_id: "bundle-native", pack_id: "pack-native", pack_build_id: "packbuild-native" },
    scope: masterScope,
    analysis_sections: {
      facts: [{ fact_id: "fact-1", category: "PRICE", statement: "MNQ remains inside its canonical range.", evidence_refs: ["bundle-native"] }],
      interpretations: [{ interpretation_id: "interp-1", statement: "Wait for a cleaner opportunity.", fact_ids: ["fact-1"], confidence: 0.6 }],
      macro: { summary: "Neutral", findings: [], evidence_refs: [] },
      cross_asset: { summary: "Neutral", findings: [], evidence_refs: [] },
      technical: { summary: "Range", findings: [], evidence_refs: [] },
      levels: { summary: "Levels available", findings: [], evidence_refs: [] },
      asset_selection: { summary: "MNQ retained", findings: [], evidence_refs: [] },
      opportunities: [], risks: ["Mid-range"], decision_summary: "Management only until a better price appears.",
    },
    market_context: { global_regime: "RANGE", regime_status: "DOMINANT", volatility_regime: "NORMAL", primary_bias: "NEUTRAL", cross_asset_reading: "Neutral", macro_reading: "Neutral" },
    hypotheses: ["BULL", "BEAR", "RANGE", "BEST_LONG", "BEST_SHORT", "WAIT"].map(hypothesis),
    selected_hypothesis: { hypothesis_id: "hyp-5", kind: "WAIT", reason: "No clean geometry at the cutoff." },
    execution_plan: {
      contract: { name: "DeskExecutionPlanContract", version: "1.4.0" },
      profile: "OPPORTUNITY_SEEKING_CONTROLLED",
      catalog_id: "condition_catalog_v1_2",
      plan_id: "plan-native-v1",
      source: { master_analysis_id: "analysis-native-v5", bundle_id: "bundle-native", pack_id: "pack-native", pack_build_id: "packbuild-native" },
      scope,
      disposition: "MANAGEMENT_ONLY",
      primary_setup_id: null,
      execution_authority: "BACKEND_ONLY",
      validity: { valid_from_paris: "2026-07-30T09:00:00+02:00", expires_at_paris: "2026-07-30T09:30:00+02:00" },
      gates: { hard: hardGates(), soft: [] },
      risk: { capital_basis: "NET_EQUITY", risk_pct_requested: 0.25, min_rr: 2, min_weighted_confirmation_ratio: 0.55 },
      setups: [], no_setup_proof: null,
      monitoring: { engine_cadence: "M1", gpt_cadence: "M15", next_checkpoint_paris: "2026-07-30T09:15:00+02:00", watch_condition_ids: [] },
      audit: analysisAudit,
    },
    active_thesis: {
      thesis_id: "thesis-native", plan_id: "plan-native-v1", selected_hypothesis_id: "hyp-5", primary_setup_id: null,
      state: "WAIT_MONITORED", bias: "NEUTRAL", instrument: "MNQ", direction: "wait",
      valid_from_paris: "2026-07-30T09:00:00+02:00", valid_until_paris: "2026-07-30T09:30:00+02:00", requires_replan_after_paris: "2026-07-30T09:30:00+02:00",
      health_state: "VALID", summary: "Waiting for a controlled opportunity.",
      expected_path: [{ sequence: 1, condition: "Range continues", implication: "Remain monitored" }],
      failure_path: [{ sequence: 1, condition: "Structure breaks", implication: "Replan" }],
      scenario_transformations: [], level_watchlist: [], invalidation_condition_ids: [],
    },
    monitor_handoff: {
      gpt_cadence: "M15", engine_cadence: "M1", next_checkpoint_paris: "2026-07-30T09:15:00+02:00", watch_condition_ids: [], thesis_health_baseline: 70,
      context_transmission: { facts: ["Range"], interpretations: ["Wait"], thesis_state: "WAIT_MONITORED", open_questions: [] },
      session_matrix: [], allowed_windows: [], update_agenda: [], monitoring_priorities: ["Watch price"],
      monitoring_playbook: [{ condition_id: "watch-price", on_state: "UNKNOWN", requested_command: "NOOP" }], handoff_summary: "Monitor the next M5 cutoff.",
    },
    audit: analysisAudit,
  };
}

function check(summary) {
  return { status: "UNCHANGED", summary, evidence_refs: [] };
}

function monitorOutput(mode = "LIVE") {
  const scope = sourceScope(mode);
  const monitorAudit = auditContext("monitor");
  return {
    contract: { name: "DeskHourlyThesisMonitorContract", version: "2.4.0" }, profile: "OPPORTUNITY_SEEKING_CONTROLLED", catalog_id: "condition_catalog_v1_2",
    source: { monitor_id: "monitor-native-v2", bundle_id: "bundle-monitor", pack_id: "pack-native", pack_build_id: "packbuild-native" }, scope,
    links: { master_analysis_id: "analysis-native-v5", plan_id: "plan-native-v1", active_thesis_id: "thesis-native", previous_monitor_id: null, setup_id: null, position_id: null },
    checkpoint: { checkpoint_paris: "2026-07-30T09:15:00+02:00", gpt_cadence: "M15", engine_cadence: "M1", window_start_paris: "2026-07-30T09:00:00+02:00", window_end_paris: "2026-07-30T09:15:00+02:00" },
    delta_summary: { facts: ["Range unchanged"], interpretations: ["Continue waiting"], thesis_evolution: "Stable", new_risks: [], new_opportunities: [] },
    assessment: { expected_path: ["Range"], realized_path: ["Range"], failure_path: [], causality_summary: "Expected path retained." },
    checks: { expected_vs_realized: check("Aligned"), macro_update: check("Unchanged"), cross_asset_delta: check("Unchanged"), technical_delta: check("Unchanged"), weak_signals: check("None"), scenario_transformation: check("None"), time_decay: check("Valid"), position: check("Flat") },
    condition_evaluations: [], thesis_health: { state: "VALID", score: 70, previous_score: 70, drivers: ["Stable structure"] },
    command: {
      contract: { name: "DeskMonitorCommandContract", version: "1.4.0" }, profile: "OPPORTUNITY_SEEKING_CONTROLLED", catalog_id: "condition_catalog_v1_2",
      command_id: "command-native", expected_revision: 1, created_at_paris: "2026-07-30T09:15:00+02:00", plan_id: "plan-native-v1", monitor_id: "monitor-native-v2", scope,
      requested_action: "NO_ACTION", setup_transition: null, transformation: null, replan_request: null, management_request: null,
      evidence: { facts: ["Range unchanged"], interpretations: ["Continue waiting"], thesis_evolution: "Stable", source_references: ["bundle-monitor"] },
      backend_authority: "BACKEND_ONLY", audit: monitorAudit,
    },
    active_thesis_update: { thesis_id: "thesis-native", state: "WAIT_MONITORED", health_score: 70, summary: "Stable", valid_until_paris: "2026-07-30T09:30:00+02:00", requires_replan_after_paris: "2026-07-30T09:30:00+02:00" },
    data_quality: { status: "CANONICAL", hard_gate_states: hardGates(), soft_gate_states: [], notes: [] },
    catchup: { policy: "LATEST_SETTLED_CLOSED_M15", cumulative_window_start_paris: "2026-07-30T09:00:00+02:00", cumulative_window_end_paris: "2026-07-30T09:15:00+02:00", superseded_checkpoints: [] },
    alert: null, next_handoff: { next_checkpoint_paris: "2026-07-30T09:30:00+02:00", watch_condition_ids: [], priorities: ["Price"], context_summary: "Continue monitoring." }, audit: monitorAudit,
  };
}

function normativeValidators() {
  const read = (name) => JSON.parse(readFileSync(new URL(`../../packages/desk-contracts/schemas/entities/${name}`, import.meta.url), "utf8"));
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(read("execution-plan-v1-4.schema.json"));
  ajv.addSchema(read("monitor-command-v1-4.schema.json"));
  return {
    master: ajv.compile(read("master-analysis-v5-4.schema.json")),
    monitor: ajv.compile(read("hourly-monitor-v2-4.schema.json")),
  };
}

function writerStore() {
  const calls = [];
  const capture = (tool) => async (args) => { calls.push({ tool, args }); return { ok: true }; };
  return { calls, logTool: async () => {}, saveMasterAnalysis: capture("save_master_analysis"), saveManualMonitor: capture("save_manual_monitor"), saveReplayMasterAnalysis: capture("save_replay_master_analysis"), saveReplayMonitor: capture("save_replay_monitor") };
}

test("normative Master V5 and Monitor V2 documents pass transport without flattening", async () => {
  const master = masterOutput();
  const monitor = monitorOutput();
  const validators = normativeValidators();
  assert.equal(validators.master(master), true, JSON.stringify(validators.master.errors));
  assert.equal(validators.monitor(monitor), true, JSON.stringify(validators.monitor.errors));

  const store = writerStore();
  const tools = createDeskToolRegistry(store);
  const lease = { work_item_id: "work-native-1", worker_id: "worker-native-1", lease_token: "lease-native-token" };
  assert.equal((await callDeskTool(tools, "save_master_analysis", { ...liveScope, ...lease, analysis_id: "analysis-native-v5", contract_name: "DeskMasterAnalysisContract", schema_version: "5.4.0", contract_hash: "hash-v5", pack_id: "pack-native", date: "2026-07-30", created_at_paris: "2026-07-30T09:00:00+02:00", analysis_output: master })).isError, false);
  assert.equal((await callDeskTool(tools, "save_manual_monitor", { ...liveScope, as_of_utc: "2026-07-30T07:15:00Z", ...lease, monitor_id: "monitor-native-v2", contract_name: "DeskHourlyThesisMonitorContract", schema_version: "2.4.0", contract_hash: "hash-v2", timestamp_paris: "2026-07-30T09:15:00+02:00", monitor_output: monitor })).isError, false);
  assert.deepEqual(store.calls[0].args.analysis_output, master);
  assert.deepEqual(store.calls[1].args.monitor_output.command, monitor.command);
  assert.equal(store.calls[1].args.lease_token, "lease-native-token");
});

test("replay native branches accept V5/V2 and preserve work leases", async () => {
  const store = writerStore();
  const tools = createDeskToolRegistry(store);
  const lease = { work_item_id: "work-replay-1", worker_id: "worker-replay-1", lease_token: "lease-replay-token" };
  const replayMaster = masterOutput("REPLAY");
  const replayMonitor = monitorOutput("REPLAY");
  const common = { backtest_id: "backtest-native", expected_revision: 3, contract_hash: "hash-native", pack_build_id: "packbuild-native", ...lease };
  assert.equal((await callDeskTool(tools, "save_replay_master_analysis", { ...common, step_id: "step-master-native", idempotency_key: "idem-master-native", analysis_id: "analysis-native-v5", contract_name: "DeskMasterAnalysisContract", schema_version: "5.4.0", analysis_output: replayMaster })).isError, false);
  assert.equal((await callDeskTool(tools, "save_replay_monitor", { ...common, step_id: "step-monitor-native", idempotency_key: "idem-monitor-native", monitor_id: "monitor-native-v2", master_id: "analysis-native-v5", thesis_id: "thesis-native", sequence: 2, scheduled_for_utc: "2026-07-30T07:15:00Z", as_of_utc: "2026-07-30T07:15:00Z", contract_name: "DeskHourlyThesisMonitorContract", schema_version: "2.4.0", monitor_output: replayMonitor })).isError, false);
  assert.deepEqual(store.calls.at(-2).args.analysis_output, replayMaster);
  assert.deepEqual(store.calls.at(-1).args.monitor_output.command, replayMonitor.command);
});

test("native transport rejects flattened, malformed and arbitrary-version payloads", async () => {
  const store = writerStore();
  const tools = createDeskToolRegistry(store);
  const baseMaster = { ...liveScope, analysis_id: "analysis-native-v5", contract_name: "DeskMasterAnalysisContract", contract_hash: "hash-v5", pack_id: "pack-native", date: "2026-07-30", created_at_paris: "2026-07-30T09:00:00+02:00" };
  assert.equal((await callDeskTool(tools, "save_master_analysis", { ...baseMaster, schema_version: "5.4.0", execution_plan: {} })).isError, true);
  assert.equal((await callDeskTool(tools, "save_master_analysis", { ...baseMaster, schema_version: "9.0.0", analysis_output: masterOutput() })).isError, true);
  const malformedMonitor = monitorOutput();
  delete malformedMonitor.command;
  assert.equal((await callDeskTool(tools, "save_manual_monitor", { ...liveScope, monitor_id: "monitor-native-v2", contract_name: "DeskHourlyThesisMonitorContract", schema_version: "2.4.0", contract_hash: "hash-v2", timestamp_paris: "2026-07-30T09:15:00+02:00", monitor_output: malformedMonitor })).isError, true);
  assert.equal(store.calls.length, 0);
});

test("historical Master V4 and Monitor V1 branches remain readable but cannot be written", async () => {
  const store = writerStore();
  const tools = createDeskToolRegistry(store);
  assert.equal((await callDeskTool(tools, "save_master_analysis", { ...liveScope, analysis_id: "master-legacy-v4", contract_name: "DeskMasterAnalysisContract", schema_version: "4.0.0", contract_hash: "hash-v4", pack_id: "pack-legacy", date: "2026-07-30", created_at_paris: "2026-07-30T09:00:00+02:00", full_analysis: {} })).isError, true);
  assert.equal((await callDeskTool(tools, "save_manual_monitor", { ...liveScope, as_of_utc: "2026-07-30T07:15:00Z", monitor_id: "monitor-legacy-v1", contract_name: "DeskHourlyThesisMonitorContract", schema_version: "1.0.0", contract_hash: "hash-v1", timestamp_paris: "2026-07-30T09:15:00+02:00", monitor_decision: {} })).isError, true);
  assert.equal(store.calls.length, 0);
  const listed = listDeskTools(tools);
  const version = (name) => listed.find((tool) => tool.name === name).inputSchema.properties.schema_version.const;
  assert.equal(version("save_master_analysis"), "5.4.0");
  assert.equal(version("save_manual_monitor"), "2.4.0");
  assert.equal(version("save_replay_master_analysis"), "5.4.0");
  assert.equal(version("save_replay_monitor"), "2.4.0");
});
