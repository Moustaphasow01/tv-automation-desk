import assert from "node:assert/strict";
import test from "node:test";
import {
  compileMasterPlanV1,
  compileMonitorCommandV1,
} from "@tv-automation/desk-domain";
import {
  assertCompiledExecutionPlanV1,
  assertCompiledMonitorCommandV1,
} from "../src/strategy-contract-validator.js";
import {
  makeNativeMasterV5,
  makeNativeMonitorV2,
} from "./support/native-strategy-fixtures.js";

test("native V5/V2 compiler artifacts satisfy their pinned strict JSON Schemas", () => {
  const setupId = "setup-native-schema-parity";
  const plan = compileMasterPlanV1(makeNativeMasterV5({ setupId }));
  assert.equal(plan.valid, true, JSON.stringify(plan.diagnostics));
  assert.doesNotThrow(() => assertCompiledExecutionPlanV1(plan));
  assert.equal(plan.thesis_plan.plan_id, plan.plan_id);
  assert.equal(plan.thesis_plan.primary_setup_id, setupId);
  assert.deepEqual(plan.ranked_setups[0].conditions[0].parameters, { threshold: 100 });
  assert.deepEqual(plan.ranked_setups[0].conditions[0].evidence_refs, ["MNQ_M1"]);
  assert.equal(plan.ranked_setups[0].gate_evaluation.evaluation_phase, "PLAN_COMPILE");
  assert.equal(
    typeof plan.ranked_setups[0].gate_evaluation.primary_confirmation_coverage_ready,
    "boolean",
  );
  assert.ok(Array.isArray(plan.ranked_setups[0].gate_evaluation.deferred_hard_gates));

  const command = compileMonitorCommandV1(makeNativeMonitorV2({ setupId }), {
    currentState: {
      thesis: { state: "CONDITIONAL" },
      setup: { state: "ARMED_CONDITIONAL", setup_id: setupId },
      replan: { state: "IDLE" },
    },
  });
  assert.equal(command.valid, true, JSON.stringify(command.diagnostics));
  assert.doesNotThrow(() => assertCompiledMonitorCommandV1(command));
  assert.equal(command.source_action, "REQUESTED_COMMAND");
  assert.equal(command.canonical_action, "ORTHOGONAL_COMMANDS");
  assert.equal(command.analytical_scope.pack_id, "pack-native");
  assert.equal(command.analytical_scope.pack_build_id, "packbuild-native");
  assert.equal(command.setup_command.replaces_setup_id, null);
  assert.equal(command.replan_request.requested_at_paris, null);
  assert.equal(command.alert, null);
  assert.equal(command.context_transmission, null);

  assert.throws(
    () => assertCompiledExecutionPlanV1({ ...plan, unexpected_field: true }),
    (error) => error?.code === "STRATEGY_CONTRACT_VALIDATION_FAILED",
  );
  assert.throws(
    () => assertCompiledMonitorCommandV1({ ...command, unexpected_field: true }),
    (error) => error?.code === "STRATEGY_CONTRACT_VALIDATION_FAILED",
  );
});
