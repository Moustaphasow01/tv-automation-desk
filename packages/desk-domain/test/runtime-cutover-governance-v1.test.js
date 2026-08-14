import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  auditArchitectureProgramClosureV1,
  authorizeLiveActivationV1,
  evaluateRuntimeComparisonV1,
  planGptFirstLegacyRetirementV1,
  planStrategyInstanceCutoverV1,
} from "../src/runtime-cutover-governance-v1.js";

describe("runtime cutover governance V1", () => {
  it("passes runtime comparison only on identical scope and bounded divergence", () => {
    const pass = evaluateRuntimeComparisonV1(comparisonInput());
    const blocked = evaluateRuntimeComparisonV1({
      ...comparisonInput(),
      target_runtime: { ...comparisonInput().target_runtime, trade_count: 8 },
    });

    assert.equal(pass.schema_version, "runtime_comparison_v1");
    assert.equal(pass.status, "COMPARISON_PASS");
    assert.equal(blocked.status, "COMPARISON_BLOCKED");
    assert.ok(blocked.issues.some((item) => item.code === "TRADE_COUNT_DELTA_TOO_HIGH"));
  });

  it("plans a strategy instance cutover without affecting sibling instances", () => {
    const plan = planStrategyInstanceCutoverV1({
      strategy_instance_id: instanceId,
      current_stage: "SHADOW",
      target_stage: "PAPER",
      runtime_comparison: { status: "COMPARISON_PASS" },
    });

    assert.equal(plan.status, "CUTOVER_READY");
    assert.equal(plan.scope_lock_key, `strategy_instance:${instanceId}`);
    assert.equal(plan.feature_flags.target_runtime_enabled, true);
    assert.equal(plan.feature_flags.live_submit_enabled, false);
  });

  it("blocks live activation unless the operator approval is exact and unexpired", () => {
    const blocked = authorizeLiveActivationV1({
      now,
      strategy_instance_id: instanceId,
      provider_id: "pickmytrade",
      account_id: "paper-main",
      risk: { risk_per_trade_pct: 0.25 },
    });
    const authorized = authorizeLiveActivationV1({
      now,
      strategy_instance_id: instanceId,
      provider_id: "pickmytrade",
      account_id: "paper-main",
      risk: { risk_per_trade_pct: 0.25 },
      operator_approval: { approved: true, decision: "APPROVE_LIVE", strategy_instance_id: instanceId, expires_at_utc: "2026-08-10T09:00:00.000Z" },
    });

    assert.equal(blocked.status, "LIVE_BLOCKED");
    assert.equal(authorized.status, "LIVE_AUTHORIZED");
  });

  it("requires live authorization before a strategy instance can move to LIVE", () => {
    const plan = planStrategyInstanceCutoverV1({
      strategy_instance_id: instanceId,
      current_stage: "PAPER",
      target_stage: "LIVE",
      runtime_comparison: { status: "COMPARISON_PASS" },
      live_authorization: { status: "LIVE_BLOCKED" },
    });

    assert.equal(plan.status, "CUTOVER_BLOCKED");
    assert.ok(plan.issues.some((item) => item.code === "LIVE_AUTHORIZATION_REQUIRED"));
  });

  it("keeps GPT-first legacy retirement blocked until observation replacement and approval are proven", () => {
    const blocked = planGptFirstLegacyRetirementV1({ observation_days: 2, active_legacy_workflow_count: 1 });
    const ready = planGptFirstLegacyRetirementV1({
      observation_days: 7,
      active_legacy_workflow_count: 0,
      replacement_coverage_pct: 1,
      rollback_plan: { proven: true },
      operator_approval: { decision: "APPROVE_GPT_FIRST_RETIREMENT" },
    });

    assert.equal(blocked.status, "LEGACY_RETIREMENT_BLOCKED");
    assert.equal(ready.status, "LEGACY_RETIREMENT_READY");
  });

  it("keeps GPT-first legacy retirement blocked while direct order bypass families remain", () => {
    const blocked = planGptFirstLegacyRetirementV1({
      observation_days: 7,
      active_legacy_workflow_count: 0,
      replacement_coverage_pct: 1,
      rollback_plan: { proven: true },
      operator_approval: { decision: "APPROVE_GPT_FIRST_RETIREMENT" },
      bypass_counts: {
        llm_direct_order_path_count: 1,
        mcp_direct_order_path_count: 1,
        front_direct_order_path_count: 1,
        script_direct_order_path_count: 1,
      },
    });

    assert.equal(blocked.status, "LEGACY_RETIREMENT_BLOCKED");
    assert.deepEqual(
      blocked.issues.map((item) => item.code).sort(),
      [
        "FRONT_DIRECT_ORDER_PATHS_REMAIN",
        "LLM_DIRECT_ORDER_PATHS_REMAIN",
        "MCP_DIRECT_ORDER_PATHS_REMAIN",
        "SCRIPT_DIRECT_ORDER_PATHS_REMAIN",
      ],
    );
  });

  it("blocks final architecture closure while program tickets remain open", () => {
    const audit = auditArchitectureProgramClosureV1({
      guard_results: [{ name: "guard:architecture", ok: true }, { name: "guard:static-quality", ok: true }],
      active_exception_count: 0,
      open_tickets: ["TD2-1103", "TD2-1105"],
      excluded_tickets: [],
    });

    assert.equal(audit.status, "CLOSURE_BLOCKED");
    assert.ok(audit.blocking.some((item) => item.code === "OPEN_PROGRAM_TICKET" && item.ticket === "TD2-1103"));
    assert.ok(audit.blocking.some((item) => item.code === "OPEN_PROGRAM_TICKET" && item.ticket === "TD2-1105"));
  });

  it("allows final architecture closure when all program tickets and guards are clear", () => {
    const audit = auditArchitectureProgramClosureV1({
      guard_results: [
        { name: "guard:architecture", ok: true },
        { name: "guard:static-quality", ok: true },
        { name: "guard:front-vnext-data-mode", ok: true },
      ],
      active_exception_count: 0,
      open_tickets: [],
      excluded_tickets: [],
    });

    assert.equal(audit.status, "CLOSURE_READY");
    assert.deepEqual(audit.blocking, []);
  });
});

const now = "2026-08-10T08:00:00.000Z";
const instanceId = "strategy-instance-cutover-1";

function comparisonInput() {
  return {
    now,
    shadow_cutover_status: "CUTOVER_READY",
    legacy_runtime: { window: windowFixture(), net_r: 4.1, trade_count: 5, error_rate: 0, latency_ms: 900 },
    target_runtime: { window: windowFixture(), net_r: 4.0, trade_count: 5, error_rate: 0, latency_ms: 650 },
  };
}

function windowFixture() {
  return { from: "2026-06-11T00:00:00.000Z", to: "2026-06-11T22:00:00.000Z", dataset_id: "dataset-2026-06-11" };
}
