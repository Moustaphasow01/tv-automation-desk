import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeMasterStrategyPayload,
  canonicalizeMonitorStrategyPayload,
} from "../src/canonical-strategy-runtime.js";
import { projectDeskSession } from "../src/front-session-projection.js";
import {
  makeNativeMasterV5,
  makeNativeMonitorV2,
} from "./support/native-strategy-fixtures.js";

test("native Master V5 keeps its contract output authoritative and fills the Master cards", () => {
  const source = makeNativeMasterV5({
    mode: "LIVE",
    runId: "front-live-v5",
    analysisId: "front-master-v5",
    setupId: "front-setup-v5",
  });
  const master = canonicalizeMasterStrategyPayload({
    schema_version: "5.4.0",
    execution_policy_version: "4.3.0",
    analysis_id: source.source.analysis_id,
    created_at_paris: source.scope.cutoff_paris,
    analysis_output: source,
  }, {
    workflow: "LIVE_MASTER",
    sourceMode: "live",
  });

  assert.deepEqual(master.analysis_output, source);
  assert.equal(master.primary_setup_id, master.deterministic_execution_plan.thesis_plan.primary_setup_id);
  assert.equal(master.full_analysis.primary_setup_id, master.primary_setup_id);
  assert.equal(
    master.front_read_projection.executive_summary.summary,
    source.analysis_sections.decision_summary,
  );
  assert.deepEqual(master.front_read_projection.observable_facts, [
    source.analysis_sections.facts[0].statement,
  ]);

  const session = projectDeskSession({
    live: {
      trading_date: source.scope.trading_date,
      strategy_id: "asia_open",
      session: source.scope.session,
      mode: "live",
      desk_status: "WAIT_MONITORED",
    },
    masterAnalysis: master,
    setups: master.setups,
  });

  assert.equal(session.master.id, "front-master-v5");
  assert.equal(session.master.summary, source.analysis_sections.decision_summary);
  assert.equal(session.master.macroThesis, "Neutral");
  assert.equal(session.master.assetSelection, "MNQ retained");
  assert.equal(session.master.confidence, 50);
  assert.equal(session.setup.id, "front-setup-v5");
  assert.equal(session.deskReading.facts.includes(source.analysis_sections.facts[0].statement), true);
  assert.equal(session.deskReading.interpretation.includes(source.analysis_sections.interpretations[0].statement), true);
});

test("native Monitor V2 keeps its contract output authoritative and fills Delta Monitor cards", () => {
  const { master, source: masterSource } = canonicalMaster();
  const source = makeNativeMonitorV2({
    mode: "LIVE",
    runId: "front-live-v5",
    masterId: "front-master-v5",
    setupId: "front-setup-v5",
  });
  const monitor = canonicalMonitor(source, master);

  assert.deepEqual(monitor.monitor_output, source);
  assert.equal(monitor.front_read_projection.monitor_decision.summary, "Stable");
  assert.equal(monitor.front_read_projection.thesis_health_score.current_score, 70);
  assert.equal(monitor.front_read_projection.expected_vs_realized.length, 1);
  assert.deepEqual(monitor.front_read_projection.context_transmission.facts, source.delta_summary.facts);

  const session = projectDeskSession({
    live: {
      trading_date: source.scope.trading_date,
      strategy_id: "asia_open",
      session: source.scope.session,
      mode: "live",
      desk_status: "WAIT_MONITORED",
      active_thesis: master.front_read_projection.active_thesis,
    },
    masterAnalysis: master,
    monitors: [monitor],
    setups: master.setups,
  });

  assert.equal(session.monitors.length, 1);
  assert.equal(session.monitors[0].id, source.source.monitor_id);
  assert.equal(session.monitors[0].summary, "Stable");
  assert.equal(session.monitors[0].detailedReason, source.assessment.causality_summary);
  assert.equal(session.monitors[0].healthAfter, 70);
  assert.equal(session.monitors[0].expectedVsRealized.length, 1);
  assert.equal(session.monitors[0].expectedVsRealized[0].expected, source.assessment.expected_path[0]);
  assert.equal(session.monitors[0].expectedVsRealized[0].realized, source.assessment.realized_path[0]);
  assert.notEqual(session.monitors[0].nextFocus, "Aucun focus matérialisé.");
  assert.equal(session.deskReading.thesisEvolution.includes("Stable"), true);
  assert.equal(session.master.summary, masterSource.analysis_sections.decision_summary);
});

test("native replan stays orthogonal in the compiled command and exposes REPLAN_FULL only to legacy readers", () => {
  const { master } = canonicalMaster();
  const source = makeNativeMonitorV2({
    mode: "LIVE",
    runId: "front-live-v5",
    masterId: "front-master-v5",
    setupId: "front-setup-v5",
    requestReplan: true,
  });
  const monitor = canonicalMonitor(source, master);

  assert.equal(monitor.deterministic_monitor_command.canonical_action, "ORTHOGONAL_COMMANDS");
  assert.equal(monitor.deterministic_monitor_command.replan_request.type, "REQUEST");
  assert.equal(monitor.monitor_decision.action, "REPLAN_FULL");
  assert.equal(monitor.monitor_decision.decision, "REPLAN_FULL");
  assert.equal(monitor.front_read_projection.monitor_decision.action, "REPLAN_FULL");
});

function canonicalMaster() {
  const source = makeNativeMasterV5({
    mode: "LIVE",
    runId: "front-live-v5",
    analysisId: "front-master-v5",
    setupId: "front-setup-v5",
  });
  const master = canonicalizeMasterStrategyPayload({
    schema_version: "5.4.0",
    execution_policy_version: "4.3.0",
    analysis_id: source.source.analysis_id,
    created_at_paris: source.scope.cutoff_paris,
    analysis_output: source,
  }, {
    workflow: "LIVE_MASTER",
    sourceMode: "live",
  });
  return { master, source };
}

function canonicalMonitor(source, master) {
  return canonicalizeMonitorStrategyPayload({
    schema_version: "2.4.0",
    execution_policy_version: "4.3.0",
    monitor_id: source.source.monitor_id,
    timestamp_paris: source.checkpoint.checkpoint_paris,
    monitor_output: source,
  }, {
    workflow: "LIVE_M5_MONITOR",
    sourceMode: "live",
    currentState: {
      thesis: master.active_thesis,
      setup: master.setups[0],
      position: null,
      replan: { state: "IDLE" },
    },
  });
}
