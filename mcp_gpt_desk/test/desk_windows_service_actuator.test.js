import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWindowsServiceActuatorPlan,
  DESK_WINDOWS_SERVICE_TOPOLOGY,
  executeWindowsServiceActuator,
} from "../src/desk-windows-service-actuator.js";

test("Windows actuator dry-run certifies allowlist and never mutates a service", async () => {
  const runner = fakeRunner(allRunningServices());
  const result = await executeWindowsServiceActuator({ action: "restart", dryRun: true, runner });

  assert.equal(result.status, "DRY_RUN_PASSED");
  assert.equal(result.ok, true);
  assert.equal(result.dry_run, true);
  assert.equal(result.operations.length, DESK_WINDOWS_SERVICE_TOPOLOGY.managed_services.length * 2);
  assert.equal(result.operations.every((item) => item.status === "DRY_RUN" && item.mutated === false), true);
  assert.equal(runner.mutations.length, 0);
  assert.equal(result.broker_execution, false);
  assert.equal(result.live_execution, false);
  assert.equal(result.auto_execution, false);
  assert.equal(result.plan.safety.control_plane_services_mutable, false);
});

test("Windows actuator real START is idempotent when services are already running", async () => {
  const runner = fakeRunner(allRunningServices());
  const result = await executeWindowsServiceActuator({ action: "start", dryRun: false, runner });

  assert.equal(result.status, "PASSED");
  assert.equal(result.operations.every((item) => item.status === "NOOP" && item.mutated === false), true);
  assert.equal(runner.mutations.length, 0);
});

test("Windows actuator real STOP is idempotent when services are already stopped", async () => {
  const runner = fakeRunner(allStoppedServices());
  const result = await executeWindowsServiceActuator({ action: "stop", dryRun: false, runner });

  assert.equal(result.status, "PASSED");
  assert.equal(result.operations.every((item) => item.status === "NOOP" && item.mutated === false), true);
  assert.equal(runner.mutations.length, 0);
});

test("Windows actuator fails closed when a service is missing from certified topology", async () => {
  const runner = fakeRunner(allRunningServices().filter((item) => item.name !== "DeskFuturesLiveRuntime"));
  const result = await executeWindowsServiceActuator({ action: "start", dryRun: false, runner });

  assert.equal(result.status, "FAILED");
  assert.equal(result.validation.ok, false);
  assert.deepEqual(result.validation.missing_services, ["DeskFuturesLiveRuntime"]);
  assert.equal(result.operations.length, 0);
  assert.equal(runner.mutations.length, 0);
});

test("Windows actuator stops on timeout and keeps rollback metadata", async () => {
  const runner = fakeRunner(allStoppedServices(), {
    failOn: { operation: "start", serviceName: "DeskFuturesBrokerManagement", code: "WINDOWS_SERVICE_TIMEOUT" },
  });
  const result = await executeWindowsServiceActuator({ action: "start", dryRun: false, runner });

  assert.equal(result.status, "FAILED");
  assert.equal(result.failures[0].type, "operation_failed");
  assert.equal(result.failures[0].service_name, "DeskFuturesBrokerManagement");
  assert.equal(result.rollback.available, true);
  assert.equal(result.rollback.order[0], "DeskFuturesCodexReplay01");
});

test("Windows actuator restart handles partial startup with deterministic stop then start order", async () => {
  const runner = fakeRunner(mixedServiceState());
  const result = await executeWindowsServiceActuator({ action: "restart", dryRun: false, runner });

  assert.equal(result.status, "PASSED");
  assert.deepEqual(result.operations.slice(0, 3).map((item) => item.service_name), [
    "DeskFuturesCodexReplay01",
    "DeskFuturesCodexLive02",
    "DeskFuturesCodexLive01",
  ]);
  assert.equal(result.operations.some((item) => item.operation === "stop" && item.status === "OK"), true);
  assert.equal(result.operations.some((item) => item.operation === "start" && item.status === "OK"), true);
});

test("Windows actuator plan keeps API, Caddy and PostgreSQL non mutable", () => {
  const plan = buildWindowsServiceActuatorPlan({ action: "start", dryRun: false });

  assert.deepEqual(plan.control_plane_services.map((item) => item.name), ["postgresql-x64-16", "DeskFuturesApi", "DeskFuturesCaddy"]);
  assert.equal(plan.control_plane_services.every((item) => item.mutable === false), true);
  assert.equal(plan.sequence.some((item) => item.service_name === "DeskFuturesApi"), false);
  assert.equal(plan.safety.provider_command_allowed, false);
});

function fakeRunner(initial, options = {}) {
  const services = new Map(initial.map((item) => [item.name, { ...item }]));
  return {
    mutations: [],
    async inspect({ serviceNames }) {
      return serviceNames.map((name) => services.get(name) || { name, status: "Missing", start_type: "Missing", display_name: null });
    },
    async mutate({ operation, serviceName }) {
      this.mutations.push({ operation, serviceName });
      if (options.failOn?.operation === operation && options.failOn?.serviceName === serviceName) {
        throw Object.assign(new Error(options.failOn.code), { code: options.failOn.code });
      }
      const current = services.get(serviceName);
      const before = current?.status || "Missing";
      const after = operation === "start" ? "Running" : "Stopped";
      services.set(serviceName, { ...current, name: serviceName, status: after, start_type: current?.start_type || "Automatic" });
      return { name: serviceName, operation, ok: true, before_status: before, after_status: after, mutated: before !== after };
    },
  };
}

function allRunningServices() {
  return allServices("Running");
}

function allStoppedServices() {
  return allServices("Stopped");
}

function allServices(status) {
  return [
    ...DESK_WINDOWS_SERVICE_TOPOLOGY.control_plane_services,
    ...DESK_WINDOWS_SERVICE_TOPOLOGY.managed_services,
  ].map((item) => ({ name: item.name, status, start_type: "Automatic", display_name: item.name }));
}

function mixedServiceState() {
  return allServices("Stopped").map((item) => (
    item.name === "DeskFuturesBrokerManagement" || item.name === "DeskFuturesLiveRuntime"
      ? { ...item, status: "Running" }
      : item
  ));
}
