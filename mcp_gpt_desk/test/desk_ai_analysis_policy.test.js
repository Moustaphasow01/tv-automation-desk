import assert from "node:assert/strict";
import test from "node:test";

import {
  DESK_AI_CONVERSATION_POLICY,
  routineMonitorEffort,
  selectDeskAiAnalysisPolicy,
  setupWatchEffort,
} from "../src/desk-ai-analysis-policy.js";

test("routine Monitor keeps the operator-configured reasoning effort", () => {
  const replay = selectDeskAiAnalysisPolicy({
    scope: "replay",
    workflow: "REPLAY_MONITOR",
    bundle: { replay_position: null, replay_setups: [] },
  }, {
    configuredReasoningEffort: "xhigh",
  });
  const live = selectDeskAiAnalysisPolicy({
    scope: "live",
    workflow: "LIVE_M5_MONITOR",
    bundle: { active_position: null, candidate_setups: [] },
  }, {
    configuredReasoningEffort: "xhigh",
  });

  assert.equal(replay.profile, "MONITOR_ROUTINE_DELTA");
  assert.equal(replay.effective_reasoning_effort, "xhigh");
  assert.equal(replay.context_depth, "overview");
  assert.equal(replay.context_tool_policy, "MANDATORY_ONLY");
  assert.equal(replay.optional_context_deepening, false);
  assert.equal(replay.conversation_policy, DESK_AI_CONVERSATION_POLICY);
  assert.equal(live.profile, replay.profile);
  assert.equal(live.effective_reasoning_effort, replay.effective_reasoning_effort);
});

test("Master and an armed setup retain the configured effort", () => {
  const master = selectDeskAiAnalysisPolicy({
    workflow: "REPLAY_MASTER",
    bundle: {},
  }, {
    configuredReasoningEffort: "xhigh",
  });
  const monitor = selectDeskAiAnalysisPolicy({
    workflow: "REPLAY_MONITOR",
    bundle: {
      replay_lineage: {
        replay_setups: [{ setup_id: "setup-1", state: "ARMED_CONDITIONAL" }],
      },
    },
  }, {
    configuredReasoningEffort: "xhigh",
  });

  assert.equal(master.profile, "MASTER_FULL_RESEARCH");
  assert.equal(master.effective_reasoning_effort, "xhigh");
  assert.equal(master.context_depth, "standard");
  assert.equal(monitor.profile, "MONITOR_SETUP_WATCH");
  assert.equal(monitor.effective_reasoning_effort, "xhigh");
  assert.equal(monitor.context_depth, "standard");
  assert.equal(monitor.context_tool_policy, "ADAPTIVE_DEEPENING");
  assert.equal(monitor.critical, false);
  assert.equal(monitor.setup_watch, true);
  assert.deepEqual(monitor.critical_reasons, ["SETUP_ARMED_CONDITIONAL"]);
});

test("a compact agentic bootstrap watches an armed setup at the configured effort", () => {
  const policy = selectDeskAiAnalysisPolicy({
    workflow: "LIVE_M5_MONITOR",
    bundle: {
      runtime_state_hint: {
        source: "CANONICAL_POSTGRES",
        setups: [{ setup_id: "setup-live-1", status: "ARMED_CONDITIONAL" }],
        active_position: null,
      },
    },
  }, {
    configuredReasoningEffort: "xhigh",
  });

  assert.equal(policy.profile, "MONITOR_SETUP_WATCH");
  assert.equal(policy.effective_reasoning_effort, "xhigh");
  assert.equal(policy.context_depth, "standard");
  assert.deepEqual(policy.critical_reasons, ["SETUP_ARMED_CONDITIONAL"]);
});

test("an active position or triggered setup retains configured critical effort", () => {
  const activePosition = selectDeskAiAnalysisPolicy({
    workflow: "REPLAY_MONITOR",
    bundle: {
      runtime_state_hint: {
        active_position: { position_id: "position-1", status: "OPEN" },
      },
    },
  }, {
    configuredReasoningEffort: "xhigh",
  });
  const triggeredSetup = selectDeskAiAnalysisPolicy({
    workflow: "LIVE_M5_MONITOR",
    bundle: {
      runtime_state_hint: {
        setups: [{ setup_id: "setup-1", status: "TRIGGERED" }],
      },
    },
  }, {
    configuredReasoningEffort: "xhigh",
  });

  assert.equal(activePosition.profile, "MONITOR_CRITICAL");
  assert.equal(activePosition.effective_reasoning_effort, "xhigh");
  assert.equal(activePosition.critical, true);
  assert.equal(triggeredSetup.profile, "MONITOR_CRITICAL");
  assert.equal(triggeredSetup.effective_reasoning_effort, "xhigh");
});

test("a pre-armed candidate stays on the routine profile at the configured effort", () => {
  const policy = selectDeskAiAnalysisPolicy({
    workflow: "REPLAY_MONITOR",
    bundle: {
      runtime_state_hint: {
        source: "CANONICAL_POSTGRES",
        setups: [{ setup_id: "setup-replay-1", status: "PRE_ARMED" }],
        active_position: null,
      },
    },
  }, {
    configuredReasoningEffort: "xhigh",
  });

  assert.equal(policy.profile, "MONITOR_ROUTINE_DELTA");
  assert.equal(policy.effective_reasoning_effort, "xhigh");
  assert.equal(policy.context_depth, "overview");
  assert.equal(policy.optional_context_deepening, false);
});

test("routine effort mapping is deterministic and preserves the operator setting", () => {
  assert.equal(routineMonitorEffort("ultra"), "ultra");
  assert.equal(routineMonitorEffort("max"), "max");
  assert.equal(routineMonitorEffort("xhigh"), "xhigh");
  assert.equal(routineMonitorEffort("high"), "high");
  assert.equal(routineMonitorEffort("medium"), "medium");
  assert.equal(routineMonitorEffort("low"), "low");
  assert.equal(setupWatchEffort("xhigh"), "xhigh");
  assert.equal(setupWatchEffort("high"), "high");
});
