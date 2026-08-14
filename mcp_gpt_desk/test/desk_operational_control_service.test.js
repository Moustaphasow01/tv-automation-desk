import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDeskOperationalResult,
  evaluateDeskOperationalState,
  executeDeskOperationalControl,
} from "../src/desk-operational-control-service.js";

const NOW = "2026-08-14T08:00:00.000Z";

test("desk operational control marks a healthy semi-manual PAPER desk as paper-ready", () => {
  const snapshot = evaluateDeskOperationalState({
    health: healthyPaperHealth(),
    environment: "PAPER",
    nowUtc: NOW,
    releaseVersion: "test-release",
    aiWorkerMode: "shadow",
  });

  assert.equal(snapshot.state, "PAPER_READY");
  assert.equal(snapshot.ready, true);
  assert.equal(snapshot.fail_closed, false);
  assert.equal(snapshot.sensitive_actions_enabled, true);
  assert.deepEqual(snapshot.blockers, []);
  assert.equal(snapshot.allowed_actions.includes("desk.restart"), true);
  assert.equal(snapshot.forbidden_actions.find((item) => item.action === "broker.live.enable")?.reason.includes("cutover"), true);
});

test("desk operational control fails closed when PostgreSQL is not the active source of truth", () => {
  const snapshot = evaluateDeskOperationalState({
    health: {
      ...healthyPaperHealth(),
      mode: "memory",
    },
    environment: "PAPER",
    nowUtc: NOW,
  });

  assert.equal(snapshot.state, "FAILED");
  assert.equal(snapshot.ready, false);
  assert.equal(snapshot.fail_closed, true);
  assert.deepEqual(snapshot.blockers.map((item) => item.id), ["api.postgres_mode"]);
  assert.equal(snapshot.allowed_actions.includes("desk.start"), true);
  assert.equal(snapshot.forbidden_actions.some((item) => item.action === "research.paper.promote"), true);
});

test("desk start is audited as plan-only until the Windows service actuator is explicitly enabled", () => {
  const result = buildDeskOperationalResult({
    action: "desk.start",
    environment: "PAPER",
    health: healthyPaperHealth(),
    idempotencyKey: "idem-cold-start-001",
    correlationId: "corr-cold-start-001",
    actor: { kind: "test-operator", email: "operator@example.com" },
    actuatorMode: "plan_only",
    nowUtc: NOW,
    releaseVersion: "test-release",
    aiWorkerMode: "shadow",
  });

  assert.equal(result.status, "PLAN_ONLY");
  assert.equal(result.plan.outcome, "PLAN_ONLY_FAIL_CLOSED");
  assert.equal(result.plan.sideEffectsEnabled, false);
  assert.equal(result.plan.broker_execution, false);
  assert.equal(result.broker_execution, false);
  assert.equal(result.live_execution, false);
  assert.equal(result.auto_execution, false);
  assert.equal(result.plan.steps.includes("verify_portfolio_risk"), true);
});

test("desk doctor reports blockers without opening execution side effects", async () => {
  const result = await executeDeskOperationalControl({
    store: {
      clock: { now: () => ({ utc: NOW }) },
      async health() {
        return {
          ...healthyPaperHealth(),
          data_readiness: {
            ok: false,
            state: "stale",
            core_age_seconds: 720,
            source_health: { durable: false },
          },
        };
      },
    },
    command: "desk.doctor",
    environment: "PAPER",
    idempotencyKey: "idem-doctor-001",
    correlationId: "corr-doctor-001",
    actor: { kind: "test-operator", email: "operator@example.com" },
  });

  assert.equal(result.status, "DEGRADED");
  assert.equal(result.state.state, "DEGRADED");
  assert.equal(result.doctor.summary.blockers, 1);
  assert.deepEqual(result.state.blockers.map((item) => item.id), ["data.live_fresh"]);
  assert.equal(result.plan.outcome, "OBSERVE_ONLY");
  assert.equal(result.plan.sideEffectsEnabled, false);
  assert.equal(result.broker_execution, false);
});

test("desk start can certify Windows dry-run through injected runner without service mutation", async () => {
  const previous = process.env.DESK_OPERATIONAL_CONTROL_ACTUATOR;
  process.env.DESK_OPERATIONAL_CONTROL_ACTUATOR = "windows_service_dry_run";
  try {
    const result = await executeDeskOperationalControl({
      store: {
        clock: { now: () => ({ utc: NOW }) },
        async health() { return healthyPaperHealth(); },
      },
      command: "desk.start",
      environment: "PAPER",
      idempotencyKey: "idem-dry-run-001",
      correlationId: "corr-dry-run-001",
      actor: { kind: "test-operator", email: "operator@example.com" },
      windowsServiceRunner: dryRunRunner(),
    });

    assert.equal(result.status, "DRY_RUN");
    assert.equal(result.plan.outcome, "WINDOWS_SERVICE_DRY_RUN");
    assert.equal(result.plan.sideEffectsEnabled, false);
    assert.equal(result.actuator.status, "DRY_RUN_PASSED");
    assert.equal(result.actuator.operations.every((item) => item.mutated === false), true);
    assert.equal(result.broker_execution, false);
    assert.equal(result.live_execution, false);
    assert.equal(result.auto_execution, false);
  } finally {
    if (previous === undefined) delete process.env.DESK_OPERATIONAL_CONTROL_ACTUATOR;
    else process.env.DESK_OPERATIONAL_CONTROL_ACTUATOR = previous;
  }
});

test("desk start fails closed when Windows dry-run topology is incomplete", async () => {
  const previous = process.env.DESK_OPERATIONAL_CONTROL_ACTUATOR;
  process.env.DESK_OPERATIONAL_CONTROL_ACTUATOR = "windows_service_dry_run";
  try {
    const result = await executeDeskOperationalControl({
      store: {
        clock: { now: () => ({ utc: NOW }) },
        async health() { return healthyPaperHealth(); },
      },
      command: "desk.start",
      environment: "PAPER",
      idempotencyKey: "idem-dry-run-002",
      correlationId: "corr-dry-run-002",
      actor: { kind: "test-operator", email: "operator@example.com" },
      windowsServiceRunner: dryRunRunner(["DeskFuturesTelegram"]),
    });

    assert.equal(result.status, "FAILED");
    assert.equal(result.state.fail_closed, true);
    assert.equal(result.actuator.validation.missing_services.includes("DeskFuturesTelegram"), true);
    assert.equal(result.actuator.operations.length, 0);
  } finally {
    if (previous === undefined) delete process.env.DESK_OPERATIONAL_CONTROL_ACTUATOR;
    else process.env.DESK_OPERATIONAL_CONTROL_ACTUATOR = previous;
  }
});

function healthyPaperHealth() {
  return {
    ok: true,
    ready: true,
    mode: "postgres",
    data_readiness: {
      ok: true,
      state: "fresh",
      core_age_seconds: 20,
      source_health: { durable: true, non_durable_feeds: [] },
    },
    operations: {
      services: [
        {
          service_id: "live_runtime_scheduler",
          service_kind: "live_runtime_scheduler",
          status: "healthy",
          healthy: true,
          heartbeat_at_utc: NOW,
          details: { data_state: "fresh" },
        },
        {
          service_id: "broker_management",
          service_kind: "broker_management",
          status: "healthy",
          healthy: true,
          heartbeat_at_utc: NOW,
          details: {
            result: {
              paper_safety: {
                execution_enabled: false,
                execution_authority_mode: "semi_auto",
                entry_operator_approval_required: true,
                manual_telegram_execution_enabled: true,
                submission_possible: false,
                live_account_allowed: false,
              },
            },
          },
        },
        {
          service_id: "telegram_alerting",
          service_kind: "telegram_alerting",
          status: "healthy",
          healthy: true,
          heartbeat_at_utc: NOW,
          details: {
            environment: {
              workerEnabled: true,
              tradingConfigured: true,
            },
          },
        },
      ],
    },
  };
}

function dryRunRunner(missing = []) {
  const missingSet = new Set(missing);
  return {
    async inspect({ serviceNames }) {
      return serviceNames
        .filter((name) => !missingSet.has(name))
        .map((name) => ({ name, status: "Running", start_type: "Automatic", display_name: name }));
    },
    async mutate() {
      throw new Error("dry-run must not mutate");
    },
  };
}
