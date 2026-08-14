import assert from "node:assert/strict";
import test from "node:test";
import {
  TD2_420_VERDICTS,
  buildDressRehearsalEvidenceFromRuntimeSnapshot,
  evaluateFullSystemDressRehearsalEvidence,
} from "../src/full-system-dress-rehearsal-certifier.js";

test("TD2-420 certifier returns NO-GO when the real dress rehearsal evidence is missing", () => {
  const report = evaluateFullSystemDressRehearsalEvidence({});

  assert.equal(report.verdict, TD2_420_VERDICTS.NO_GO);
  assert.equal(report.ok, false);
  assert.ok(report.blockers.some((item) => item.id === "research.strategy_sample_size"));
  assert.ok(report.blockers.some((item) => item.id === "safety.zero_broker_side_effect_delta"));
});

test("TD2-420 certifier allows GO when all mandatory system proofs are present", () => {
  const report = evaluateFullSystemDressRehearsalEvidence(completeEvidence({
    assistants: { available: true, read_only: true, answer_grounded: true, no_sensitive_authority: true },
    telegram: { available: true, operator_notification_sent: true, not_a_broker_order: true },
    sim101: { available: true, paper_smoke_passed: true, live_account_forbidden: true },
  }));

  assert.equal(report.verdict, TD2_420_VERDICTS.GO_SEMI_MANUAL);
  assert.equal(report.ok, true);
  assert.equal(report.summary.mandatory_failures, 0);
  assert.equal(report.summary.blocked_external, 0);
});

test("TD2-420 certifier distinguishes optional external blockers from mandatory NO-GO blockers", () => {
  const report = evaluateFullSystemDressRehearsalEvidence(completeEvidence({
    assistants: { available: false },
    telegram: { available: false },
    sim101: { available: false },
  }));

  assert.equal(report.verdict, TD2_420_VERDICTS.GO_WITH_EXTERNAL_BLOCKERS);
  assert.equal(report.ok, true);
  assert.equal(report.summary.mandatory_failures, 0);
  assert.ok(report.external_blockers.some((item) => item.id === "telegram.notification_operator_safe"));
  assert.ok(report.external_blockers.some((item) => item.id === "sim101.paper_smoke"));
});

test("TD2-420 runtime snapshot builder normalizes strategy ids and service fields", () => {
  const evidence = buildDressRehearsalEvidenceFromRuntimeSnapshot({
    services: [{ serviceId: "research-worker-01", serviceKind: "worker", status: "healthy" }],
    research: {
      strategyIds: ["STR-A", "STR-A"],
      definitions: [{ external_key: "STR-B" }],
    },
  });

  assert.deepEqual(evidence.research.strategy_ids.sort(), ["STR-A", "STR-B"]);
  assert.equal(evidence.services[0].service_id, "research-worker-01");
  assert.equal(evidence.services[0].service_kind, "worker");
});

function completeEvidence(overrides = {}) {
  const strategyIds = Array.from({ length: 10 }, (_, index) => `TD2_STRATEGY_${String(index + 1).padStart(2, "0")}`);
  return {
    safety: {
      auto_execution_enabled: false,
      live_auto_enabled: false,
      broker_provider_side_effect_delta: 0,
      side_effect_counts_before: { broker_provider_commands: 0 },
      side_effect_counts_after: { broker_provider_commands: 0 },
    },
    schema: {
      present_tables: [
        "desk_schema_migrations",
        "desk_service_heartbeats",
        "agent_missions",
        "agent_tasks",
        "datasets",
        "strategy_definitions",
        "strategy_versions",
        "strategy_instances",
        "simulation_runs",
        "research_experiments",
        "research_candidates",
        "research_evaluation_reports",
        "strategy_signal_outbox",
        "portfolio_order_intent_lineage",
        "trade_order_intents",
        "broker_provider_commands",
        "assistant_tasks",
        "assistant_outbox",
      ],
    },
    services: [
      { service_id: "api", service_kind: "api", status: "healthy", heartbeat_age_seconds: 3 },
      { service_id: "research-worker-01", service_kind: "worker", status: "healthy", heartbeat_age_seconds: 4 },
    ],
    workers: {
      expected_research_workers: 1,
      active_research_workers: 1,
      active_simulation_workers: 1,
      queue_depth: 0,
      max_heartbeat_age_seconds: 180,
      heartbeats: [{ service_id: "research-worker-01", status: "healthy", heartbeat_age_seconds: 4 }],
    },
    research: {
      strategy_ids: strategyIds,
      missions: 10,
      tasks: 10,
      datasets: 10,
      simulation_runs: 10,
      evaluation_reports: 10,
      gates: {
        G0_DATA_READY: 10,
        G1_SCREENED: 10,
        G2_CANONICAL_VALID: 10,
        G3_ROBUST: 10,
        G4_PORTFOLIO_FIT: 10,
      },
    },
    data: {
      ready_datasets: 10,
      lineage_complete_datasets: 10,
      no_lookahead_declared: true,
      synthetic_data_declared: true,
    },
    strategy: {
      immutable_versions: 10,
      compiled_artifacts: 10,
      shadow_instances: 2,
    },
    live_runtime: {
      instances_evaluated: 2,
      last_evaluation_progressed: true,
      feed_state: "fresh",
    },
    signal_pipeline: {
      signal_to_order_intent_proven: true,
      portfolio_risk_lineage_proven: true,
      human_gate_required: true,
      broker_auto_send: false,
    },
    front: {
      vnext_available: true,
      bff_single_source: true,
      no_front_risk_recalc: true,
      degraded_states_visible: true,
      sse_connected: true,
      cursor_resume_proven: true,
      browser_reopen_truth_preserved: true,
    },
    assistants: overrides.assistants || { available: false },
    observability: {
      critical_errors: 0,
      unexplained_errors: 0,
      warnings: 0,
    },
    chaos: {
      worker_kill_recovered: true,
      no_duplicate_result_after_recovery: true,
      backend_restart_recovered: true,
      tasks_persisted_after_restart: true,
      sse_resume_recovered: true,
      feed_stale_fail_closed: true,
    },
    restart: {
      full_restart_recovered: true,
      auto_execution_enabled: false,
      live_auto_enabled: false,
    },
    telegram: overrides.telegram || { available: false },
    sim101: overrides.sim101 || { available: false },
  };
}
