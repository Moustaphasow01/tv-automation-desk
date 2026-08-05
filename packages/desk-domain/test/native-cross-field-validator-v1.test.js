import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HARD_GATE_CODES_V5,
  compileMasterPlanV1,
  compileMonitorCommandV1,
} from "../index.js";

function condition(overrides = {}) {
  return {
    condition_id: "activation",
    label: "Activation",
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
    ...overrides,
  };
}

function setup(overrides = {}) {
  return {
    setup_id: "setup_1",
    rank: 1,
    requested_state: "ARMED_CONDITIONAL",
    pattern: "BREAKOUT_RETEST",
    instrument: "MNQ",
    direction: "long",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry: { price: 100 },
    stop: { type: "STRUCTURAL", price: 98 },
    targets: [{
      target_id: "tp1",
      price: 104,
      action: "PARTIAL_CLOSE",
      close_fraction: 0.5,
    }],
    rr_expected: 2,
    conditions: [condition()],
    management: { break_even_at_r: 0.7, tp1_close_fraction: 0.5 },
    validity: {
      valid_from_paris: "2026-06-11T09:00:00+02:00",
      expires_at_paris: "2026-06-11T12:00:00+02:00",
    },
    rationale: "test",
    evidence_refs: ["MNQ_M1"],
    ...overrides,
  };
}

function scope(mode = "REPLAY") {
  return {
    mode,
    trading_date: "2026-06-11",
    session: "full_day",
    run_id: "run_1",
    cutoff_paris: "2026-06-11T09:00:00+02:00",
    timezone: "Europe/Paris",
  };
}

function nativeMaster() {
  const planScope = scope();
  return {
    contract: { name: "DeskMasterAnalysisContract", version: "5.4.0" },
    source: {
      analysis_id: "master_1",
      bundle_id: "bundle_1",
      pack_id: "pack_1",
      pack_build_id: "packbuild_1",
    },
    scope: planScope,
    active_thesis: {
      thesis_id: "thesis_1",
      plan_id: "plan_1",
      primary_setup_id: "setup_1",
      state: "ACTIVE",
      instrument: "MNQ",
      direction: "long",
      valid_from_paris: "2026-06-11T09:00:00+02:00",
      valid_until_paris: "2026-06-11T12:00:00+02:00",
    },
    execution_plan: {
      contract: { name: "DeskExecutionPlanContract", version: "1.4.0" },
      scope: planScope,
      primary_setup_id: "setup_1",
      validity: {
        valid_from_paris: "2026-06-11T09:00:00+02:00",
        expires_at_paris: "2026-06-11T12:00:00+02:00",
      },
      gates: {
        hard: HARD_GATE_CODES_V5.map((code) => ({
          code,
          state: "PASS",
          reason: null,
          evidence_refs: [],
        })),
        soft: [],
      },
      risk: {
        risk_pct_requested: 0.25,
        min_rr: 2,
        min_weighted_confirmation_ratio: 0.55,
      },
      setups: [setup()],
      no_setup_proof: null,
    },
  };
}

function monitorWithCommand(command) {
  return {
    contract: { name: "DeskHourlyThesisMonitorContract", version: "2.4.0" },
    source: { monitor_id: "monitor_1" },
    scope: scope("LIVE"),
    links: {
      master_analysis_id: "master_1",
      active_thesis_id: "thesis_1",
      position_id: null,
    },
    checkpoint: { checkpoint_paris: "2026-06-11T09:05:00+02:00" },
    command: {
      contract: { name: "DeskMonitorCommandContract", version: "1.4.0" },
      ...command,
    },
    active_thesis_update: {
      thesis_id: "thesis_1",
      state: "ACTIVE",
      health_score: 80,
      summary: "valid",
    },
  };
}

describe("Native Master cross-field validation", () => {
  it("rejects broken identity, uniqueness, scope, validity and dependency links", () => {
    const raw = nativeMaster();
    delete raw.active_thesis.plan_id;
    raw.scope = scope("LIVE");
    raw.execution_plan.primary_setup_id = "missing_setup";
    raw.active_thesis.primary_setup_id = "other_setup";
    raw.execution_plan.validity = {
      valid_from_paris: "2026-06-11T12:00:00+02:00",
      expires_at_paris: "2026-06-11T09:00:00+02:00",
    };
    const cyclic = condition({
      condition_id: "cycle",
      predicate_type: "BREAK_RETEST_SEQUENCE",
      operator: "REJECT_SUPPORT",
      parameters: {
        break_condition_id: "cycle",
        retest_level: 100,
        tolerance_points: 0.25,
        max_bars: 3,
        require_rejection_confirmation: true,
      },
    });
    const missing = condition({
      condition_id: "missing_ref",
      predicate_type: "BREAK_RETEST_SEQUENCE",
      operator: "REJECT_SUPPORT",
      parameters: {
        break_condition_id: "does_not_exist",
        retest_level: 100,
        tolerance_points: 0.25,
        max_bars: 3,
        require_rejection_confirmation: true,
      },
    });
    const brokenSetup = setup({
      validity: {
        valid_from_paris: "2026-06-11T12:00:00+02:00",
        expires_at_paris: "2026-06-11T09:00:00+02:00",
      },
      conditions: [cyclic, missing],
    });
    raw.execution_plan.setups = [
      brokenSetup,
      { ...brokenSetup },
    ];

    const compiled = compileMasterPlanV1(raw);
    const codes = new Set(compiled.diagnostics.errors.map((entry) => entry.code));
    assert.equal(compiled.valid, false);
    for (const code of [
      "PLAN_ID_MISSING",
      "SETUP_ID_DUPLICATE",
      "SETUP_RANK_DUPLICATE",
      "PRIMARY_SETUP_ID_NOT_FOUND",
      "PRIMARY_SETUP_LINK_MISMATCH",
      "PLAN_SCOPE_MISMATCH",
      "PLAN_VALIDITY_WINDOW_INVALID",
      "SETUP_VALIDITY_WINDOW_INVALID",
      "BREAK_CONDITION_REFERENCE_NOT_FOUND",
      "CONDITION_DEPENDENCY_CYCLE",
    ]) {
      assert.ok(codes.has(code), `${code} should be reported`);
    }
  });

  it("keeps V5.0/Plan V1.0 inputs historical and non-executable", () => {
    const raw = nativeMaster();
    raw.contract.version = "5.0.0";
    raw.execution_plan.contract.version = "1.0.0";

    const compiled = compileMasterPlanV1(raw);

    assert.equal(compiled.valid, false);
    assert.ok(compiled.diagnostics.errors.some(
      (entry) => entry.code === "HISTORICAL_NATIVE_CONTRACT_READ_ONLY",
    ));
  });
});

describe("Native Monitor cross-field validation", () => {
  it("rejects mismatched setup links and incoherent transformation targets", () => {
    const nested = setup({
      setup_id: "nested_new",
      replaces_setup_id: "legacy_old",
    });
    const command = {
      requested_action: "APPLY_ORTHOGONAL_COMMANDS",
      setup_transition: {
        command: "REPLACE",
        setup_id: "outer_new",
        replaces_setup_id: "outer_new",
        reason: "replace",
        setup: nested,
      },
      transformation: {
        command: "SUPERSEDE",
        target_state: "ACTIVE",
        reason: "bad target",
        payload: { summary: "bad", health_score: 50 },
      },
      replan_request: null,
      management_request: null,
    };
    const compiled = compileMonitorCommandV1(monitorWithCommand(command), {
      currentState: {
        thesis: { state: "ACTIVE" },
        setup: { state: "ARMED_CONDITIONAL", setup_id: "current_old", risk_pct: 0.25 },
        replan: { state: "IDLE" },
      },
    });
    const codes = new Set(compiled.diagnostics.errors.map((entry) => entry.code));
    assert.equal(compiled.valid, false);
    assert.equal(compiled.setup_command.replaces_setup_id, "outer_new");
    for (const code of [
      "MONITOR_SETUP_ID_MISMATCH",
      "REPLACE_SETUP_IDS_MUST_DIFFER",
      "REPLACE_LINK_MISMATCH",
      "REPLACE_CURRENT_SETUP_MISMATCH",
      "THESIS_COMMAND_TARGET_MISMATCH",
    ]) {
      assert.ok(codes.has(code), `${code} should be reported`);
    }
  });

  it("rejects NO_ACTION carrying any command payload", () => {
    const command = {
      requested_action: "NO_ACTION",
      setup_transition: {
        command: "CANCEL",
        setup_id: "setup_1",
        replaces_setup_id: null,
        reason: "not inert",
        setup: null,
      },
      transformation: null,
      replan_request: null,
      management_request: null,
    };
    const compiled = compileMonitorCommandV1(monitorWithCommand(command), {
      currentState: {
        thesis: { state: "ACTIVE" },
        setup: { state: "ARMED_CONDITIONAL", setup_id: "setup_1", risk_pct: 0.25 },
        replan: { state: "IDLE" },
      },
    });
    assert.equal(compiled.valid, false);
    assert.ok(
      compiled.diagnostics.errors.some((entry) => entry.code === "NO_ACTION_HAS_COMMAND_PAYLOAD"),
    );
  });

  it("keeps Monitor V2.0/Command V1.0 inputs historical and non-executable", () => {
    const raw = monitorWithCommand({
      contract: { name: "DeskMonitorCommandContract", version: "1.0.0" },
      requested_action: "NO_ACTION",
      setup_transition: null,
      transformation: null,
      replan_request: null,
      management_request: null,
    });
    raw.contract.version = "2.0.0";

    const compiled = compileMonitorCommandV1(raw, {
      currentState: {
        thesis: { state: "ACTIVE" },
        setup: { state: "NONE" },
        replan: { state: "IDLE" },
      },
    });

    assert.equal(compiled.valid, false);
    assert.ok(compiled.diagnostics.errors.some(
      (entry) => entry.code === "HISTORICAL_NATIVE_CONTRACT_READ_ONLY",
    ));
  });
});


describe("Native V5/V2 pinned identity graph", () => {
  it("rejects plan, hypothesis and source-link mismatches atomically", () => {
    const raw = nativeMaster();
    raw.hypotheses = [
      { hypothesis_id: "hyp_selected", kind: "BULL" },
      { hypothesis_id: "hyp_other", kind: "WAIT" },
    ];
    raw.selected_hypothesis = { hypothesis_id: "hyp_missing", kind: "BULL" };
    raw.active_thesis.selected_hypothesis_id = "hyp_other";
    raw.execution_plan.plan_id = "plan_other";
    raw.execution_plan.source = {
      master_analysis_id: "master_other",
      bundle_id: "bundle_other",
      pack_id: "pack_other",
      pack_build_id: "packbuild_other",
    };
    const compiled = compileMasterPlanV1(raw);
    const codes = new Set(compiled.diagnostics.errors.map((entry) => entry.code));
    assert.equal(compiled.valid, false);
    for (const code of [
      "PLAN_ID_MISMATCH",
      "SELECTED_HYPOTHESIS_NOT_FOUND",
      "SELECTED_HYPOTHESIS_LINK_MISMATCH",
      "MASTER_PLAN_SOURCE_MISMATCH",
    ]) {
      assert.ok(codes.has(code), code + " should be reported");
    }
  });

  it("rejects Monitor source/plan/thesis identifiers that diverge from its command graph", () => {
    const raw = monitorWithCommand({
      requested_action: "NO_ACTION",
      plan_id: "command_plan_other",
      monitor_id: "monitor_other",
      scope: { ...scope("LIVE"), session: "ny_open" },
      setup_transition: null,
      transformation: null,
      replan_request: null,
      management_request: null,
    });
    raw.links.plan_id = "plan_1";
    raw.links.active_thesis_id = "thesis_1";
    raw.active_thesis_update.thesis_id = "thesis_other";
    const compiled = compileMonitorCommandV1(raw, {
      currentState: {
        thesis: { state: "ACTIVE", thesis_id: "thesis_1", plan_id: "plan_1" },
        setup: { state: "ARMED_CONDITIONAL", setup_id: "setup_1", risk_pct: 0.25 },
        replan: { state: "IDLE" },
      },
    });
    const codes = new Set(compiled.diagnostics.errors.map((entry) => entry.code));
    assert.equal(compiled.valid, false);
    for (const code of [
      "MONITOR_PLAN_LINK_MISMATCH",
      "MONITOR_ID_LINK_MISMATCH",
      "MONITOR_THESIS_LINK_MISMATCH",
      "MONITOR_SCOPE_MISMATCH",
    ]) {
      assert.ok(codes.has(code), code + " should be reported");
    }
  });
});
