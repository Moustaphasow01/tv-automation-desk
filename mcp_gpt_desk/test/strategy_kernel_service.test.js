import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import {
  STRATEGY_DSL_SCHEMA_VERSION_V1,
  STRATEGY_PATTERN_BREAKOUT_RETEST_V1,
  canonicalJson,
} from "@tv-automation/desk-domain";
import {
  InMemoryStrategyKernelRepository,
  StrategyKernelService,
} from "../src/strategy-kernel-service.js";
import {
  fromSqlExecutionMode,
  fromSqlRuntimeState,
  fromSqlVersionStatus,
  toSqlExecutionMode,
  toSqlRuntimeState,
  toSqlVersionStatus,
} from "../src/strategy-kernel-repository.js";

const NOW = "2026-08-09T08:00:00.000Z";
const LATER = "2026-08-09T08:15:00.000Z";
const definitionId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
const instanceId = "33333333-3333-4333-8333-333333333333";
const metricsId = "44444444-4444-4444-8444-444444444444";
const riskBudgetId = "55555555-5555-4555-8555-555555555555";

describe("Strategy Kernel service", () => {
  test("registers Definition, Version and Instance transactionally with audit", async () => {
    const repository = new InMemoryStrategyKernelRepository();
    const service = serviceFor(repository);

    const definition = await service.registerDefinition(definitionFixture(), {
      idempotency_key: "register-definition-1",
      actor: "codex",
      reason: "TD2-102",
    });
    const version = await service.registerVersion(versionFixture(), {
      idempotency_key: "register-version-1",
      actor: "codex",
    });
    const instance = await service.registerInstance(instanceFixture(), {
      idempotency_key: "register-instance-1",
      actor: "codex",
    });

    assert.equal(definition.status, "CREATED");
    assert.equal(version.version.status, "DRAFT");
    assert.equal(instance.instance.execution_mode, "SHADOW");
    assert.deepEqual(repository.transactionCalls, [
      `strategy-definition:${definitionId}`,
      `strategy-version:${versionId}`,
      `strategy-instance:${instanceId}`,
    ]);
    assert.equal(repository.auditEvents.length, 3);
    assert.equal(repository.auditEvents[0].event_type, "STRATEGY_DEFINITION_REGISTERED");
    assert.match(repository.auditEvents[2].next_hash, /^sha256:[a-f0-9]{64}$/);
  });

  test("returns idempotent result when the same command is replayed", async () => {
    const repository = new InMemoryStrategyKernelRepository();
    const service = serviceFor(repository);

    await service.registerDefinition(definitionFixture(), { idempotency_key: "register-definition-repeat", actor: "codex" });
    const replayed = await service.registerDefinition(definitionFixture(), { idempotency_key: "register-definition-repeat", actor: "codex" });

    assert.equal(replayed.status, "IDEMPOTENT");
    assert.equal(repository.auditEvents.length, 2);
    assert.equal(repository.auditEvents[1].event_type, "STRATEGY_DEFINITION_REGISTERED_IDEMPOTENT");
  });

  test("blocks invalid version transitions and preserves the previous aggregate", async () => {
    const repository = new InMemoryStrategyKernelRepository();
    const service = serviceFor(repository);
    await service.registerVersion(versionFixture({ status: "DRAFT" }), { idempotency_key: "register-version-2", actor: "codex" });

    await assert.rejects(
      () => service.transitionVersion({
        strategy_version_id: versionId,
        next_status: "PUBLISHED",
        validated_metrics_ref: metricsId,
      }, { actor: "codex" }),
      (error) => error.code === "STRATEGY_KERNEL_VALIDATION_FAILED"
        && error.details.reasons.includes("STRATEGY_VERSION_TRANSITION_FORBIDDEN"),
    );
    assert.equal((await repository.findVersion(versionId)).status, "DRAFT");
  });

  test("publishes a validated version and writes transition audit", async () => {
    const repository = new InMemoryStrategyKernelRepository();
    const service = serviceFor(repository);
    await service.registerVersion(versionFixture({ status: "VALIDATED", validated_metrics_ref: metricsId }), {
      idempotency_key: "register-version-3",
      actor: "codex",
    });

    const result = await service.transitionVersion({
      strategy_version_id: versionId,
      next_status: "PUBLISHED",
      updated_at: LATER,
    }, {
      idempotency_key: "publish-version-3",
      actor: "operator",
      reason: "validated by replay gate",
    });

    assert.equal(result.status, "UPDATED");
    assert.equal(result.previous.status, "VALIDATED");
    assert.equal(result.version.status, "PUBLISHED");
    assert.equal(result.version.published_at, LATER);
    assert.equal(result.audit.previous_status, "VALIDATED");
    assert.equal(result.audit.next_status, "PUBLISHED");
  });

  test("compiles a validated Strategy DSL version into a deterministic artifact", async () => {
    const repository = new InMemoryStrategyKernelRepository();
    const service = serviceFor(repository);
    const dsl = breakoutRetestDsl();
    await service.registerDefinition(definitionFixture(), { idempotency_key: "compile-definition-1", actor: "codex" });
    await service.registerVersion(versionFixture({
      status: "VALIDATED",
      dsl_source_hash: sha256Text(canonicalJson(dsl)),
      compiled_artifact_hash: null,
      validated_metrics_ref: metricsId,
    }), { idempotency_key: "compile-version-1", actor: "codex" });

    const result = await service.compileVersion({
      strategy_version_id: versionId,
      dsl_source: dsl,
      runtime_bindings: runtimeBindings(),
      scope: replayScope(),
      source_mode: "PAPER",
    }, {
      idempotency_key: "compile-dsl-1",
      actor: "codex",
      reason: "TD2-300",
    });

    assert.equal(result.status, "COMPILED");
    assert.equal(result.compilation.ok, true);
    assert.equal(result.compilation.deterministic_execution_plan.schema_version, "deterministic_execution_plan_v1_4");
    assert.match(result.compilation.evidence.compiled_artifact_hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(result.audit.event_type, "STRATEGY_VERSION_COMPILED");
    assert.equal(result.audit.payload.compiler_version, "strategy-dsl-compiler-v1");
    assert.equal(result.audit.payload.compiled_artifact_hash, result.compilation.evidence.compiled_artifact_hash);
  });

  test("rejects incomplete Strategy DSL bindings with an auditable result", async () => {
    const repository = new InMemoryStrategyKernelRepository();
    const service = serviceFor(repository);
    const dsl = breakoutRetestDsl();
    await service.registerDefinition(definitionFixture(), { actor: "codex" });
    await service.registerVersion(versionFixture({
      status: "VALIDATED",
      dsl_source_hash: sha256Text(canonicalJson(dsl)),
      compiled_artifact_hash: null,
      validated_metrics_ref: metricsId,
    }), { actor: "codex" });

    const result = await service.compileVersion({
      strategy_version_id: versionId,
      dsl_source: dsl,
      runtime_bindings: { valid_from_paris: "2026-06-11T15:30:00+02:00" },
      scope: replayScope(),
    }, { idempotency_key: "compile-dsl-reject-1", actor: "codex" });

    assert.equal(result.status, "REJECTED");
    assert.equal(result.compilation.ok, false);
    assert.ok(result.compilation.reasons.includes("STRATEGY_RUNTIME_BINDING_PRICE_REQUIRED"));
    assert.equal(result.audit.event_type, "STRATEGY_VERSION_COMPILE_REJECTED");
    assert.equal(result.audit.payload.compiled_artifact_hash, null);
  });

  test("keeps runtime state and execution mode independent and requires approval for PAPER to LIVE", async () => {
    const repository = new InMemoryStrategyKernelRepository();
    const service = serviceFor(repository);
    await service.registerInstance(instanceFixture({
      execution_mode: "PAPER",
      account_scope: "ninjatrader_sim101_local",
    }), { actor: "codex" });

    await assert.rejects(
      () => service.transitionInstance({
        strategy_instance_id: instanceId,
        next_execution_mode: "LIVE",
        triple_lock_validated: true,
      }, { actor: "codex" }),
      (error) => error.code === "STRATEGY_KERNEL_VALIDATION_FAILED"
        && error.details.reasons.includes("STRATEGY_INSTANCE_LIVE_OPERATOR_APPROVAL_REQUIRED"),
    );

    const promoted = await service.transitionInstance({
      strategy_instance_id: instanceId,
      next_execution_mode: "LIVE",
      triple_lock_validated: true,
      operator_approval_id: "operator-approval-123",
    }, { actor: "operator", idempotency_key: "paper-to-live" });

    assert.equal(promoted.instance.execution_mode, "LIVE");
    assert.equal(promoted.instance.runtime_state, "CREATED");
    assert.equal(promoted.audit.previous_execution_mode, "PAPER");
    assert.equal(promoted.audit.next_execution_mode, "LIVE");
  });

  test("requires explicit operator approval to promote SHADOW to PAPER", async () => {
    const repository = new InMemoryStrategyKernelRepository();
    const service = serviceFor(repository);
    await service.registerInstance(instanceFixture(), { actor: "codex" });

    await assert.rejects(
      () => service.transitionInstance({
        strategy_instance_id: instanceId,
        next_execution_mode: "PAPER",
        account_scope: "ninjatrader_sim101_local",
      }, { actor: "strategy-metrics-agent", reason: "metrics_above_threshold" }),
      (error) => error.code === "STRATEGY_INSTANCE_OPERATOR_ACTION_REQUIRED"
        && error.details.reasons.includes("STRATEGY_INSTANCE_PAPER_OPERATOR_APPROVAL_REQUIRED"),
    );

    const promoted = await service.transitionInstance({
      strategy_instance_id: instanceId,
      next_execution_mode: "PAPER",
      account_scope: "ninjatrader_sim101_local",
      operator_approval_id: "operator-approval-paper-1",
    }, { actor: "operator", idempotency_key: "shadow-to-paper", reason: "manual paper pilot approved" });

    assert.equal(promoted.instance.execution_mode, "PAPER");
    assert.equal(promoted.instance.operator_approval_id, "operator-approval-paper-1");
    assert.equal(promoted.audit.actor, "operator");
  });

  test("requires an operator reason to rollback PAPER to SHADOW and clears the paper approval", async () => {
    const repository = new InMemoryStrategyKernelRepository();
    const service = serviceFor(repository);
    await service.registerInstance(instanceFixture({
      execution_mode: "PAPER",
      account_scope: "ninjatrader_sim101_local",
      operator_approval_id: "operator-approval-paper-1",
    }), { actor: "operator" });

    await assert.rejects(
      () => service.transitionInstance({
        strategy_instance_id: instanceId,
        next_execution_mode: "SHADOW",
      }, { actor: "operator" }),
      (error) => error.code === "STRATEGY_INSTANCE_OPERATOR_ACTION_REQUIRED"
        && error.details.reasons.includes("STRATEGY_INSTANCE_ROLLBACK_REASON_REQUIRED"),
    );

    const rollback = await service.transitionInstance({
      strategy_instance_id: instanceId,
      next_execution_mode: "SHADOW",
    }, { actor: "operator", idempotency_key: "paper-to-shadow", reason: "rollback after shadow parity drift" });

    assert.equal(rollback.instance.execution_mode, "SHADOW");
    assert.equal(rollback.instance.operator_approval_id, null);
    assert.equal(rollback.audit.reason, "rollback after shadow parity drift");
  });

  test("blocks LIVE conflicts unless triple-lock evidence is present", async () => {
    const repository = new InMemoryStrategyKernelRepository();
    const service = serviceFor(repository);
    await service.registerInstance(instanceFixture({
      strategy_instance_id: instanceId,
      execution_mode: "LIVE",
      account_scope: "ninjatrader_live_demo",
      triple_lock_validated: true,
    }), { actor: "operator" });

    await assert.rejects(
      () => service.registerInstance(instanceFixture({
        strategy_instance_id: "66666666-6666-4666-8666-666666666666",
        execution_mode: "LIVE",
        account_scope: "ninjatrader_live_demo",
        triple_lock_validated: false,
      }), { actor: "codex" }),
      (error) => error.code === "STRATEGY_KERNEL_VALIDATION_FAILED"
        && error.details.reasons.includes("STRATEGY_INSTANCE_TRIPLE_LOCK_REQUIRED"),
    );
  });

  test("plans due Strategy Instances with idempotent scheduler audit", async () => {
    const repository = new InMemoryStrategyKernelRepository();
    const service = serviceFor(repository);
    await service.registerInstance(instanceFixture({
      runtime_state: "RUNNING",
      execution_mode: "PAPER",
      account_scope: "ninjatrader_sim101_local",
      created_at: "2026-08-09T07:55:00.000Z",
      started_at: "2026-08-09T07:59:00.000Z",
      last_heartbeat_at: NOW,
      metadata: { scheduler: { cadence_seconds: 60 } },
    }), { actor: "codex" });

    const first = await service.planInstanceSchedulerCycle({
      now_utc: "2026-08-09T08:01:00.000Z",
      last_scheduled_at_by_instance: { [instanceId]: NOW },
    }, { actor: "strategy-scheduler", idempotency_key: "cycle-1" });
    const replayed = await service.planInstanceSchedulerCycle({
      now_utc: "2026-08-09T08:01:00.000Z",
      last_scheduled_at_by_instance: { [instanceId]: NOW },
    }, { actor: "strategy-scheduler", idempotency_key: "cycle-1" });

    assert.equal(first.status, "PLANNED");
    assert.equal(first.plan.summary.due, 1);
    assert.equal(first.audit[0].event_type, "STRATEGY_INSTANCE_SCHEDULER_TICK_DUE");
    assert.equal(first.audit[0].idempotency_key, replayed.audit[0].idempotency_key);
    assert.equal(repository.auditEvents.filter((event) => event.event_type === "STRATEGY_INSTANCE_SCHEDULER_TICK_DUE").length, 1);
  });

  test("does not schedule paused Strategy Instances", async () => {
    const repository = new InMemoryStrategyKernelRepository();
    const service = serviceFor(repository);
    await service.registerInstance(instanceFixture({
      runtime_state: "PAUSED",
      execution_mode: "PAPER",
      account_scope: "ninjatrader_sim101_local",
      last_heartbeat_at: NOW,
    }), { actor: "codex" });

    const result = await service.planInstanceSchedulerCycle({ now_utc: LATER }, { actor: "strategy-scheduler" });

    assert.equal(result.plan.summary.paused, 1);
    assert.equal(result.plan.due.length, 0);
    assert.equal(result.audit.length, 0);
  });

  test("maps domain enums to SQL enum values and back", () => {
    assert.equal(toSqlVersionStatus("IN_SIMULATION"), "in_simulation");
    assert.equal(fromSqlVersionStatus("published"), "PUBLISHED");
    assert.equal(toSqlRuntimeState("FAILED_TO_START"), "failed_to_start");
    assert.equal(fromSqlRuntimeState("errored"), "ERRORED");
    assert.equal(toSqlExecutionMode("PAPER"), "paper");
    assert.equal(fromSqlExecutionMode("live"), "LIVE");
  });
});

function serviceFor(repository) {
  return new StrategyKernelService({
    repository,
    clock: { now: () => NOW },
  });
}

function sha256Text(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function definitionFixture(overrides = {}) {
  return {
    strategy_definition_id: definitionId,
    external_key: "breakout-retest-mnq",
    name: "Breakout Retest MNQ",
    owner: "strategy-lab",
    asset_class: "futures",
    default_instruments: ["mnq", "mes"],
    tags: ["Breakout", "Retest"],
    metadata: { source: "TD2-102" },
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function versionFixture(overrides = {}) {
  return {
    strategy_version_id: versionId,
    strategy_definition_id: definitionId,
    version_label: "1.0.0",
    status: "DRAFT",
    dsl_source_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    compiled_artifact_ref: "artifact://strategy/breakout-retest/1.0.0",
    compiled_artifact_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    runtime_contract_bundle_version: "runtime-bundle-v1",
    metadata: { compiler: "desk-deterministic-v1" },
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function breakoutRetestDsl() {
  return {
    schema_version: STRATEGY_DSL_SCHEMA_VERSION_V1,
    pattern: STRATEGY_PATTERN_BREAKOUT_RETEST_V1,
    setup_templates: [{
      template_id: "mnq_long_breakout_retest",
      direction: "long",
      instrument: "MNQ",
      timeframe: "M1",
      entry_mode: "RETEST_ZONE_AFTER_CONFIRMATION",
      order_type: "LIMIT",
      rank: 1,
      status: "ARMED_CONDITIONAL",
      tolerance_points: 1,
      max_bars: 12,
      rr_minimum: 2,
      risk_pct: 0.25,
      break_even_at_r: 0.7,
      tp1_close_fraction: 0.5,
    }],
    metadata: { compiler_target: "deterministic_execution_plan_v1_4" },
  };
}

function runtimeBindings() {
  return {
    plan_id: "strategy_plan__breakout_retest_mnq__2026_06_11_1530",
    thesis_id: "strategy_thesis__breakout_retest_mnq__2026_06_11_1530",
    analysis_id: "strategy_analysis__breakout_retest_mnq__2026_06_11_1530",
    decision_id: "strategy_decision__breakout_retest_mnq__2026_06_11_1530",
    setup_id_prefix: "strategy_setup",
    valid_from_paris: "2026-06-11T15:30:00+02:00",
    expires_at_paris: "2026-06-11T16:15:00+02:00",
    setups: [{
      template_id: "mnq_long_breakout_retest",
      setup_id: "strategy_setup__mnq_long_breakout_retest__2026_06_11_1530",
      break_level: 22000,
      retest_level: 22002,
      entry_zone: { lower: 22000.5, upper: 22004.5 },
      stop_loss: 21980,
      take_profit_1: 22060,
      invalidation_level: 21980,
    }],
  };
}

function replayScope() {
  return {
    strategy_id: "breakout-retest-mnq",
    session: "ny_open",
    trading_date: "2026-06-11",
    timezone: "Europe/Paris",
    cutoff_paris: "2026-06-11T15:30:00+02:00",
    pack_id: "pack_2026_06_11_1530",
    pack_build_id: "packbuild_2026_06_11_1530",
  };
}

function instanceFixture(overrides = {}) {
  return {
    strategy_instance_id: instanceId,
    strategy_version_id: versionId,
    runtime_state: "CREATED",
    execution_mode: "SHADOW",
    instrument_scope: ["MNQ"],
    session_scope: ["ny_open"],
    risk_budget_ref: riskBudgetId,
    triple_lock_validated: false,
    metadata: { lane: "shadow" },
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}
