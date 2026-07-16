import assert from "node:assert/strict";
import test from "node:test";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { FixedClock } from "@tv-automation/desk-time";
import { PersistentDeskStore } from "../src/store.js";
import { InMemoryDeskPersistence } from "./support/in-memory-desk-persistence.js";

const C = DESK_COLLECTIONS;
const clock = new FixedClock(Date.parse("2026-07-16T12:00:00.000Z"));

function createStore() {
  const persistence = new InMemoryDeskPersistence();
  const store = new PersistentDeskStore(clock, persistence);
  return { store, persistence };
}

test("operations summary normalizes jobs, replay runs and GPT work", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskJobs, "job-1", {
    job_id: "job-1", job_type: "LIVE_MONITOR", status: "RUNNING", trading_date: "2026-07-16",
    session: "ny_open", revision: 2, created_at_utc: "2026-07-16T11:00:00.000Z", updated_at_utc: "2026-07-16T11:30:00.000Z",
  });
  await persistence.setDocument(C.deskReplayRuns, "run-1", {
    backtest_id: "run-1", replay_run_id: "run-1", replay_mode: "orchestrated_gpt_in_the_loop",
    status: "WAITING_GPT_MASTER", revision: 3, strategy_id: "asia_open", session: "asia_open",
    trading_date: "2026-07-16", cadence: "15m", steps_done: 1, steps_total: 4,
    created_at_utc: "2026-07-16T00:00:00.000Z", updated_at_utc: "2026-07-16T01:00:00.000Z",
  });
  await persistence.setDocument(C.deskAgentWorkItems, "work-1", {
    work_item_id: "work-1", backtest_id: "run-1", step_id: "step-1", workflow: "REPLAY_MASTER",
    status: "READY", attempt_count: 0, max_attempts: 3, updated_at_utc: "2026-07-16T01:00:00.000Z",
  });

  const summary = await store.getOperationsSummary();
  assert.equal(summary.contract, "DeskOperationsSummary");
  assert.equal(summary.totals.workflows, 2);
  assert.equal(summary.totals.running, 1);
  assert.equal(summary.totals.waitingGpt, 1);
  assert.equal(summary.totals.gptInProgress, 1);
});

test("replay day keeps multiple session executions, variants and attempts", async () => {
  const { store, persistence } = createStore();
  for (const [id, session, cadence, created] of [
    ["run-a1", "asia_open", "15m", "2026-07-16T00:00:00.000Z"],
    ["run-a2", "asia_open", "15m", "2026-07-16T00:05:00.000Z"],
    ["run-ny", "ny_open", "30m", "2026-07-16T13:30:00.000Z"],
  ]) {
    await persistence.setDocument(C.deskReplayRuns, id, {
      backtest_id: id, replay_run_id: id, replay_mode: "orchestrated_gpt_in_the_loop", status: "COMPLETED",
      revision: 4, strategy_id: session, session, trading_date: "2026-07-16", cadence,
      steps_done: 4, steps_total: 4, created_at_utc: created, updated_at_utc: created,
    });
  }
  const day = await store.operations.getReplayDay("run-a1", "2026-07-16");
  assert.equal(day.sessions.length, 3);
  assert.equal(day.variants.length, 2);
  assert.deepEqual(day.sessions.filter((item) => item.session === "asia_open").map((item) => item.attempt), [1, 2]);
});

test("GPT inspector exposes persisted conclusion and event lifecycle", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskAgentWorkItems, "work-1", {
    work_item_id: "work-1", backtest_id: "run-1", step_id: "step-1", workflow: "REPLAY_MONITOR",
    status: "COMPLETED", attempt_count: 1, max_attempts: 3, updated_at_utc: "2026-07-16T01:10:00.000Z",
  });
  await persistence.setDocument(C.deskAgentWorkEvents, "event-1", {
    event_id: "event-1", work_item_id: "work-1", backtest_id: "run-1", event_type: "COMPLETED", created_at_utc: "2026-07-16T01:10:00.000Z",
  });
  await persistence.setDocument(C.deskReplayMonitors, "monitor-1", {
    monitor_id: "monitor-1", backtest_id: "run-1", step_id: "step-1", work_item_id: "work-1",
    monitor_decision: { decision: "MAINTAIN", reason: "La thèse reste valide." }, created_at_utc: "2026-07-16T01:09:00.000Z",
  });
  const detail = await store.getOperationsGptProcess({ process_id: "work-1" });
  assert.equal(detail.process.status, "completed");
  assert.equal(detail.process.decision, "MAINTAIN");
  assert.equal(detail.process.conclusion, "La thèse reste valide.");
  assert.equal(detail.process.events.length, 1);
});

test("workflow actions enforce revision, confirmation and idempotency", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskJobs, "job-1", { job_id: "job-1", status: "RUNNING", revision: 5, updated_at_utc: "2026-07-16T11:00:00.000Z" });
  const input = { action: "cancel", expectedRevision: 5, idempotencyKey: "cancel-job-1", confirmationPhrase: "CONFIRM_CANCEL", reason: "Arrêt demandé par l’opérateur" };
  const first = await store.executeOperationsWorkflowAction({ workflow_id: "job:job-1", input, actor: { kind: "test" } });
  assert.equal(first.ok, true);
  assert.equal(first.workflow.status, "cancelled");
  const replayed = await store.executeOperationsWorkflowAction({ workflow_id: "job:job-1", input, actor: { kind: "test" } });
  assert.equal(replayed.idempotent, true);
  await assert.rejects(
    store.executeOperationsWorkflowAction({ workflow_id: "job:job-1", input: { ...input, idempotencyKey: "other-key", expectedRevision: 4 }, actor: {} }),
    (error) => error.code === "REVISION_CONFLICT",
  );
});

test("replay retry recovers a bounded GPT failure and advances the canonical revision", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskReplayRuns, "run-retry", {
    backtest_id: "run-retry",
    replay_run_id: "run-retry",
    replay_mode: "orchestrated_gpt_in_the_loop",
    status: "FAILED",
    automation_status: "failed",
    automation_enabled: false,
    current_work_item_id: "work-retry",
    revision: 7,
    strategy_id: "asia_open",
    session: "asia_open",
    trading_date: "2026-07-16",
    created_at_utc: "2026-07-16T00:00:00.000Z",
    updated_at_utc: "2026-07-16T01:00:00.000Z",
  });
  await persistence.setDocument(C.deskAgentWorkItems, "work-retry", {
    work_item_id: "work-retry",
    backtest_id: "run-retry",
    step_id: "step-retry",
    workflow: "REPLAY_MASTER",
    status: "FAILED",
    attempt_count: 1,
    failure_count: 1,
    max_attempts: 3,
    retryable: false,
    recovery_count: 0,
    last_error: {
      code: "WORK_ALREADY_CLAIMED_SAVE_BLOCKED",
      message: "Pause automation before using the manual Master save path.",
      retryable: false,
    },
    created_at_utc: "2026-07-16T00:30:00.000Z",
    updated_at_utc: "2026-07-16T01:00:00.000Z",
  });

  const input = {
    action: "retry",
    expectedRevision: 7,
    idempotencyKey: "retry-run-retry",
    confirmationPhrase: "CONFIRM_RETRY",
    reason: "Récupération opérateur après erreur de sauvegarde réclamée",
  };
  const result = await store.executeOperationsWorkflowAction({
    workflow_id: "replay:run-retry",
    input,
    actor: { kind: "test" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.workflow.status, "waiting_gpt");
  assert.equal(result.workflow.revision, 8);
  const recovered = await persistence.getDocument(C.deskAgentWorkItems, "work-retry");
  assert.equal(recovered.status, "READY");
  assert.equal(recovered.recovery_count, 1);
  assert.equal(recovered.last_error, null);
});

test("replay projections synchronize persisted candles, decisions and GPT layers", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskReplayBundles, "bundle-1", {
    bundle_id: "bundle-1", backtest_id: "run-1", step_id: "step-1",
    market: { candles: [
      { time: "2026-07-16T00:00:00.000Z", open: 100, high: 103, low: 99, close: 102 },
      { time: "2026-07-16T00:15:00.000Z", open: 102, high: 106, low: 101, close: 105 },
    ] },
  });
  await persistence.setDocument(C.deskReplayTimeline, "decision-1", {
    event_id: "decision-1", backtest_id: "run-1", step_id: "step-1", event_type: "MONITOR_SAVED",
    action: "MAINTAIN", status: "MONITOR_SAVED", price: 105, timestamp_paris: "2026-07-16T02:15:00+02:00",
  });
  await persistence.setDocument(C.deskAgentWorkEvents, "gpt-1", {
    event_id: "gpt-1", work_item_id: "work-1", backtest_id: "run-1", event_type: "CLAIMED", created_at_utc: "2026-07-16T00:14:00.000Z",
  });
  const prices = await store.getOperationsReplayPriceSeries({ run_id: "run-1" });
  const timeline = await store.getOperationsReplayTimeline({ run_id: "run-1" });
  assert.deepEqual(prices.items.map((item) => item.close), [102, 105]);
  assert.deepEqual(new Set(timeline.items.map((item) => item.layer)), new Set(["decision", "gpt"]));
});

test("incident lifecycle is revisioned, confirmed, idempotent and audited", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskAlerts, "alert-1", {
    alert_id: "alert-1", title: "Lease expiré", severity: "warning", lifecycle_status: "open", revision: 2,
    created_at_utc: "2026-07-16T01:00:00.000Z", updated_at_utc: "2026-07-16T01:00:00.000Z",
  });
  const input = { action: "resolve", expectedRevision: 2, idempotencyKey: "resolve-alert-1", confirmationPhrase: "CONFIRM_RESOLVE", reason: "Lease récupéré et workflow relancé" };
  const result = await store.executeOperationsIncidentAction({ incident_id: "alert:alert-1", input, actor: { kind: "test" } });
  assert.equal(result.incident.lifecycleStatus, "resolved");
  assert.equal(result.incident.revision, 3);
  const replayed = await store.executeOperationsIncidentAction({ incident_id: "alert:alert-1", input, actor: { kind: "test" } });
  assert.equal(replayed.idempotent, true);
  assert.equal(persistence.count(C.deskOperationsEvents), 1);
});

test("performance and strategy version comparison use canonical persisted documents", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskStrategyTrades, "trade-1", { trade_id: "trade-1", trading_date: "2026-07-16", session: "asia_open", instrument: "MNQ", direction: "long", status: "CLOSED", result_R: 1.5 });
  await persistence.setDocument(C.strategyCatalog, "strategy-1", { strategy_id: "strategy-1", name: "Momentum" });
  await persistence.setDocument(C.deskStrategyVersions, "strategy-1-v1", { version_id: "strategy-1-v1", strategy_id: "strategy-1", version: "1.0.0", config: { cadence: "30m", threshold: 60 } });
  await persistence.setDocument(C.deskStrategyVersions, "strategy-1-v2", { version_id: "strategy-1-v2", strategy_id: "strategy-1", version: "2.0.0", config: { cadence: "15m", threshold: 65 } });
  const performance = await store.getOperationsPerformance({ date: "2026-07-16" });
  const comparison = await store.compareOperationsStrategyVersions({ strategy_id: "strategy-1", left: "1.0.0", right: "2.0.0" });
  assert.equal(performance.totals.totalR, 1.5);
  assert.equal(performance.totals.winRate, 1);
  assert.ok(comparison.changes.some((change) => change.path === "config.cadence"));
  assert.ok(comparison.changes.some((change) => change.path === "config.threshold"));
});
