import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { NinjaTraderStartupControl } from "../src/ninjatrader-startup-control.js";

test("NinjaTrader startup control is disabled and explicit before first operator write", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "desk-ninja-startup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const control = new NinjaTraderStartupControl({ root, clock: () => "2026-07-22T20:00:00.000Z" });

  assert.deepEqual(await control.status(), {
    available: true,
    enabled: false,
    revision: 0,
    connectionName: "Simulation",
    connectionProvider: "NinjaTrader",
    autoConnectRequired: false,
    simulationOnly: true,
    supervisorInstalled: false,
    supervisorRunning: false,
    processRunning: false,
    processWindowTitle: null,
    loginRequired: false,
    platformReady: false,
    autoConnectConfigured: false,
    lastStartedAt: null,
    lastAppliedAt: null,
    lastError: null,
    state: "disabled",
  });
});

test("NinjaTrader startup control persists an audited and revisioned simulation-only setting", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "desk-ninja-startup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const control = new NinjaTraderStartupControl({ root, clock: () => "2026-07-22T20:00:00.000Z" });

  const enabled = await control.configure({
    enabled: true,
    expectedRevision: 0,
    idempotencyKey: "startup-idem-123",
    actor: "operator@example.test",
    reason: "enable unattended Sim101 restart",
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.revision, 1);
  assert.equal(enabled.state, "waiting_supervisor");

  const persisted = JSON.parse(await readFile(path.join(root, "startup-control.json"), "utf8"));
  assert.equal(persisted.connection.provider, "NinjaTrader");
  assert.equal(persisted.connection.connect_on_startup, true);
  assert.equal(persisted.connection.simulation_only, true);
  assert.equal(persisted.restart_policy.fail_closed_execution, true);
  assert.match(await readFile(path.join(root, "startup-audit.jsonl"), "utf8"), /ninjatrader_autostart_configured/);

  const replayed = await control.configure({
    enabled: true,
    expectedRevision: 0,
    idempotencyKey: "startup-idem-123",
    actor: "operator@example.test",
    reason: "retry",
  });
  assert.equal(replayed.revision, 1);
});

test("NinjaTrader startup control rejects stale revisions and reports supervisor runtime", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "desk-ninja-startup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const control = new NinjaTraderStartupControl({ root });
  await control.configure({ enabled: true, expectedRevision: 0, idempotencyKey: "startup-idem-456", actor: "test", reason: "enable" });
  await assert.rejects(
    () => control.configure({ enabled: false, expectedRevision: 0, idempotencyKey: "startup-idem-789", actor: "test", reason: "stale" }),
    (error) => error.code === "NINJATRADER_STARTUP_REVISION_CONFLICT",
  );

  await writeFile(path.join(root, "supervisor-status.json"), JSON.stringify({
    supervisor_installed: true,
    supervisor_running: true,
    process_running: true,
    auto_connect_configured: true,
    last_started_at: "2026-07-22T20:01:00.000Z",
    updated_at: new Date().toISOString(),
  }));
  const status = await control.status();
  assert.equal(status.state, "running");
  assert.equal(status.processRunning, true);
  assert.equal(status.autoConnectConfigured, true);
});

test("NinjaTrader startup control preserves the localized Simulator connection name", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "desk-ninja-startup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "startup-control.json"), JSON.stringify({
    schema_version: "desk_ninjatrader_startup_control_v1",
    enabled: false,
    revision: 0,
    connection: {
      provider: "Simulator",
      name: "Simulated Data Feed",
      connect_on_startup: true,
      simulation_only: true,
    },
  }));
  const control = new NinjaTraderStartupControl({
    root,
    connectionName: "Simulated Data Feed",
    connectionProvider: "Simulator",
  });

  await control.configure({
    enabled: true,
    expectedRevision: 0,
    idempotencyKey: "startup-idem-localized",
    actor: "test",
    reason: "enable localized simulator",
  });

  const persisted = JSON.parse(await readFile(path.join(root, "startup-control.json"), "utf8"));
  assert.equal(persisted.connection.name, "Simulated Data Feed");
  assert.equal(persisted.connection.provider, "Simulator");
});
