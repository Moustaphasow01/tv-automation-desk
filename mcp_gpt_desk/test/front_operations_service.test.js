import assert from "node:assert/strict";
import test from "node:test";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { FixedClock } from "@tv-automation/desk-time";
import { PersistentDeskStore } from "../src/store.js";
import {
  InMemorySimulationRunRegistryRepository,
  SimulationRunRegistryService,
} from "../src/simulation-run-registry-service.js";
import { ACTIVE_STRATEGY_RUNTIME_VERSIONS } from "../src/strategy-runtime-versioning.js";
import { InMemoryDeskPersistence } from "./support/in-memory-desk-persistence.js";

const C = DESK_COLLECTIONS;
const clock = new FixedClock(Date.parse("2026-07-16T12:00:00.000Z"));
const V4_REPLAY_CONTRACT = {
  replay_schema_version: "2.0.0",
  cadence: "15m",
  pinned_contracts: {
    master_contract: {
      contract_id: "DeskMasterAnalysisContract_v4_0_0",
      schema_version: "4.0.0",
    },
  },
};
const ACTIVE_REPLAY_RUNTIME_PINS = Object.freeze({
  strategy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.strategy_version,
  autopilot_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.autopilot_version,
  replay_execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
  execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
  monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
  condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
  deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
  condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
});

function createStore() {
  const persistence = new InMemoryDeskPersistence();
  const store = new PersistentDeskStore(clock, persistence);
  return { store, persistence };
}

function canonicalSimulationResult(overrides = {}) {
  return {
    schema_version: "canonical_simulation_result_v1",
    simulation_engine: "desk-replay-engine",
    simulation_engine_version: "1.0.0",
    run_id: "run-sim-a",
    strategy_version_id: "33333333-3333-4333-8333-333333333333",
    dataset_id: "44444444-4444-4444-8444-444444444444",
    dataset_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    parameters_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    reproducibility_seed: "seed-front-simulation",
    cutoff: "2026-07-16T21:45:00+02:00",
    run_started_at_utc: clock.now().utc,
    status: "COMPLETED",
    metrics: { schema_version: "canonical_simulation_metrics_v1", trade_count: 1, total_r: 1.5 },
    metrics_hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    positions: [{ position_id: "p1", status: "CLOSED", r_result: 1.5 }],
    events: [{ type: "POSITION_CLOSED" }],
    content_hash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    ...overrides,
  };
}

test("operations summary exposes only Autopilot V4 replay runs and GPT work", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskJobs, "job-1", {
    job_id: "job-1", job_type: "LIVE_MONITOR", status: "RUNNING", trading_date: "2026-07-16",
    session: "ny_open", revision: 2, created_at_utc: "2026-07-16T11:00:00.000Z", updated_at_utc: "2026-07-16T11:30:00.000Z",
  });
  await persistence.setDocument(C.deskReplayRuns, "run-1", {
    ...V4_REPLAY_CONTRACT,
    backtest_id: "run-1", replay_run_id: "run-1", replay_mode: "orchestrated_gpt_in_the_loop",
    strategy_version: "autopilot_v4", autopilot_version: "4.0.0",
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
  assert.equal(summary.totals.workflows, 1);
  assert.equal(summary.totals.running, 0);
  assert.equal(summary.totals.waitingGpt, 1);
  assert.equal(summary.totals.gptInProgress, 1);
});

test("operations summary includes active V5.1 GPT processes without an explicit run filter", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskReplayRuns, "run-v5-active", {
    replay_schema_version: "2.0.0",
    cadence: "5m",
    ...ACTIVE_REPLAY_RUNTIME_PINS,
    pinned_contracts: {
      master_contract: {
        contract_id: "DeskMasterAnalysisContract_v5_1_0",
        schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract,
      },
      monitor_contract: {
        contract_id: "DeskHourlyThesisMonitorContract_v2_1_0",
        schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
      },
    },
    backtest_id: "run-v5-active",
    replay_run_id: "run-v5-active",
    replay_mode: "orchestrated_gpt_in_the_loop",
    status: "WAITING_GPT_MASTER",
    revision: 1,
    strategy_id: "asia_open",
    session: "asia_open",
    trading_date: "2026-07-16",
    current_step_id: "step-v5-active",
    current_work_item_id: "work-v5-active",
    automation_enabled: true,
    created_at_utc: "2026-07-16T00:00:00.000Z",
    updated_at_utc: "2026-07-16T01:00:00.000Z",
  });
  await persistence.setDocument(C.deskAgentWorkItems, "work-v5-active", {
    ...ACTIVE_REPLAY_RUNTIME_PINS,
    work_item_id: "work-v5-active",
    automation_scope: "replay",
    backtest_id: "run-v5-active",
    step_id: "step-v5-active",
    workflow: "REPLAY_MASTER",
    status: "READY",
    attempt_count: 0,
    max_attempts: 3,
    created_at_utc: "2026-07-16T01:00:00.000Z",
    updated_at_utc: "2026-07-16T01:00:00.000Z",
  });

  const processes = await store.listOperationsGptProcesses();
  const summary = await store.getOperationsSummary();

  assert.equal(processes.count, 1);
  assert.equal(processes.items[0].id, "work-v5-active");
  assert.equal(summary.totals.workflows, 1);
  assert.equal(summary.totals.waitingGpt, 1);
  assert.equal(summary.totals.gptInProgress, 1);
});

test("front projects a failed current work item as blocked and uses its own failure timestamp", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskReplayRuns, "run-projected-failure", {
    replay_schema_version: "2.0.0",
    cadence: "15m",
    ...ACTIVE_REPLAY_RUNTIME_PINS,
    pinned_contracts: {
      master_contract: {
        contract_id: `DeskMasterAnalysisContract_v${ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract.replaceAll(".", "_")}`,
        schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract,
      },
    },
    backtest_id: "run-projected-failure",
    replay_run_id: "run-projected-failure",
    replay_mode: "orchestrated_gpt_in_the_loop",
    status: "WAITING_GPT_MONITOR",
    revision: 9,
    strategy_id: "full_day",
    session: "full_day",
    trading_date: "2026-06-11",
    current_work_item_id: "work-projected-failure",
    created_at_utc: "2026-06-10T22:00:00.000Z",
    updated_at_utc: "2026-06-11T08:15:00.000Z",
  });
  await persistence.setDocument(C.deskAgentWorkItems, "work-projected-failure", {
    ...ACTIVE_REPLAY_RUNTIME_PINS,
    work_item_id: "work-projected-failure",
    automation_scope: "replay",
    backtest_id: "run-projected-failure",
    step_id: "step-monitor-1015",
    workflow: "REPLAY_MONITOR",
    status: "FAILED",
    attempt_count: 1,
    max_attempts: 3,
    claimed_at_utc: "2026-06-11T08:15:05.000Z",
    failed_at_utc: "2026-06-11T08:17:42.000Z",
    last_error: {
      code: "SETUP_ID_IMMUTABLE",
      message: "Replacement identity rejected.",
      retryable: false,
      occurred_at_utc: "2026-06-11T08:17:42.000Z",
    },
    created_at_utc: "2026-06-11T08:15:00.000Z",
    updated_at_utc: "2026-06-11T08:17:42.000Z",
  });

  const workflows = await store.listOperationsWorkflows({ limit: 100 });
  const processes = await store.listOperationsGptProcesses({
    runId: "run-projected-failure",
    limit: 100,
  });
  const workflow = workflows.items.find((item) => item.sourceId === "run-projected-failure");
  assert.equal(workflow.status, "blocked");
  assert.equal(workflow.rawStatus, "WORK_FAILED_REQUIRES_OPERATOR");
  assert.equal(workflow.backendRawStatus, "WAITING_GPT_MONITOR");
  assert.equal(workflow.error.code, "SETUP_ID_IMMUTABLE");
  assert.equal(processes.items[0].status, "failed");
  assert.equal(processes.items[0].completedAt, "2026-06-11T08:17:42.000Z");
});

test("operations excludes imported history while History keeps it readable", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskReplayRuns, "imported-run", {
    ...V4_REPLAY_CONTRACT,
    backtest_id: "imported-run",
    replay_run_id: "imported-run",
    replay_mode: "orchestrated_gpt_in_the_loop",
    status: "WAITING_GPT_MONITOR",
    trading_date: "2026-06-01",
    session: "asia_open",
    operational_visibility: "history",
    research_visibility: "replay_lab",
    strategy_version: "autopilot_v4",
    autopilot_version: "4.0.0",
    data_origin: "prod_import",
    read_only: true,
    created_at_utc: "2026-06-01T00:00:00.000Z",
    updated_at_utc: "2026-06-01T01:00:00.000Z",
  });
  await persistence.setDocument(C.deskAgentWorkItems, "imported-work", {
    work_item_id: "imported-work",
    backtest_id: "imported-run",
    workflow: "REPLAY_MONITOR",
    status: "READY",
    operational_visibility: "history",
    data_origin: "prod_import",
    read_only: true,
    updated_at_utc: "2026-06-01T01:00:00.000Z",
  });
  await persistence.setDocument("desk_live_run_cursor", "imported-live-cursor", {
    cursor_id: "imported-live-cursor",
    workflow: "LIVE_MASTER",
    status: "READY",
    operational_visibility: "history",
    data_origin: "prod_import",
    read_only: true,
    updated_at_utc: "2026-06-01T01:00:00.000Z",
  });

  const summary = await store.getOperationsSummary();
  assert.equal(summary.totals.workflows, 0);
  assert.equal(summary.totals.waitingGpt, 0);
  assert.equal(summary.totals.gptInProgress, 0);
  const observability = await store.getOperationsObservability();
  assert.equal(observability.summary.processes, 0);
  assert.equal((await store.listOperationsGptProcesses()).count, 0);
  assert.equal((await store.listOperationsGptProcesses({ runId: "imported-run" })).count, 1);

  const history = await store.getOperationsHistory({ date: "2026-06-01" });
  assert.equal(history.summary.workflows, 1);
  assert.equal(history.summary.sessions, 1);
});

test("Replay Lab and Performance expose V4 research only", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskReplayRuns, "legacy-run", {
    backtest_id: "legacy-run",
    replay_run_id: "legacy-run",
    replay_mode: "orchestrated_gpt_in_the_loop",
    replay_schema_version: "2.0.0",
    status: "COMPLETED",
    cadence: "60m",
    trading_date: "2026-06-01",
    session: "asia_open",
    strategy_id: "legacy-strategy",
    operational_visibility: "history",
    research_visibility: "replay_lab",
    read_only: true,
  });
  await persistence.setDocument(C.deskReplayRuns, "v4-run", {
    ...V4_REPLAY_CONTRACT,
    backtest_id: "v4-run",
    replay_run_id: "v4-run",
    replay_mode: "orchestrated_gpt_in_the_loop",
    replay_schema_version: "2.0.0",
    strategy_version: "autopilot_v4",
    autopilot_version: "4.0.0",
    status: "COMPLETED",
    cadence: "15m",
    trading_date: "2026-06-02",
    session: "asia_open",
    strategy_id: "asia_open",
    operational_visibility: "history",
    research_visibility: "replay_lab",
    read_only: true,
  });
  await persistence.setDocument(C.deskStrategyTrades, "legacy-trade", {
    trade_id: "legacy-trade",
    strategy_id: "legacy-strategy",
    trading_date: "2026-06-01",
    status: "CLOSED",
    result_R: 9,
  });
  await persistence.setDocument(C.deskReplayPositions, "v4-position", {
    position_id: "v4-position",
    backtest_id: "v4-run",
    strategy_id: "asia_open",
    trading_date: "2026-06-02",
    session: "asia_open",
    instrument: "MNQ",
    direction: "long",
    status: "CLOSED",
    entry_price: 100,
    initial_stop_loss: 90,
    exit_price: 120,
    closed_at_utc: "2026-06-02T10:00:00.000Z",
  });
  await persistence.setDocument(C.deskReplayPositions, "v4-cancelled-position", {
    position_id: "v4-cancelled-position",
    backtest_id: "v4-run",
    strategy_version: "autopilot_v4",
    strategy_id: "asia_open",
    trading_date: "2026-06-02",
    session: "asia_open",
    instrument: "MNQ",
    direction: "short",
    status: "CANCELLED",
    entry_price: 100,
    initial_stop_loss: 110,
    exit_price: 110,
    realized_r: -1,
    excluded_from_results: true,
    invalid_position_record: true,
    closed_at_utc: "2026-06-02T11:00:00.000Z",
  });

  const replays = await store.listOperationsReplays();
  const performance = await store.getOperationsPerformance();
  const history = await store.getOperationsHistory();
  assert.deepEqual(replays.items.map((item) => item.sourceId), ["v4-run"]);
  assert.equal(performance.totals.totalR, 2);
  assert.equal(performance.totals.trades, 1);
  assert.equal(replays.items[0].metrics.positions, 1);
  assert.equal(replays.items[0].metrics.pricedPositions, 1);
  assert.equal(replays.items[0].metrics.unpricedPositions, 0);
  assert.deepEqual(performance.facets.strategies, ["asia_open"]);
  assert.equal(history.summary.totalR, 2);
  assert.equal(history.sessions[0].totalR, 2);
});

test("Replay Lab separates certified, active, contractual V4 and legacy results", async () => {
  const { store, persistence } = createStore();
  for (const run of [
    {
      ...V4_REPLAY_CONTRACT,
      backtest_id: "v4-certified",
      strategy_version: "autopilot_v4",
      autopilot_version: "4.0.0",
      v4_history_eligible: true,
      status: "COMPLETED",
      summary: { total_R: 2 },
    },
    {
      ...V4_REPLAY_CONTRACT,
      backtest_id: "v4-contractual",
      status: "COMPLETED",
      summary: { total_R: 1 },
    },
    {
      ...V4_REPLAY_CONTRACT,
      backtest_id: "v4-active",
      strategy_version: "autopilot_v4",
      status: "WAITING_GPT_MONITOR",
      summary: { total_R: 100 },
    },
    {
      backtest_id: "legacy-run",
      replay_mode: "orchestrated_gpt_in_the_loop",
      cadence: "15m",
      status: "COMPLETED",
      summary: { total_R: 9 },
    },
  ]) {
    await persistence.setDocument(C.deskReplayRuns, run.backtest_id, {
      replay_run_id: run.backtest_id,
      replay_schema_version: "2.0.0",
      trading_date: "2026-06-01",
      session: "asia_open",
      strategy_id: "asia_open",
      ...run,
    });
  }

  const v4 = await store.listOperationsReplays();
  const certified = await store.listOperationsReplays({ versionScope: "certified" });
  const active = await store.listOperationsReplays({ versionScope: "active" });
  const legacy = await store.listOperationsReplays({ versionScope: "legacy" });
  const all = await store.listOperationsReplays({ versionScope: "all" });

  assert.equal(v4.count, 3);
  assert.equal(v4.summary.totalR, 2);
  assert.equal(v4.summary.resultEligible, 1);
  assert.equal(v4.summary.certified, 1);
  assert.equal(v4.summary.contractualV4, 2);
  assert.equal(certified.count, 1);
  assert.equal(certified.summary.totalR, 2);
  assert.equal(active.count, 1);
  assert.equal(active.summary.totalR, 0);
  assert.equal(legacy.count, 1);
  assert.equal(legacy.summary.totalR, 0);
  assert.equal(legacy.items[0].replayClassification, "legacy");
  assert.equal(all.count, 4);
  assert.equal(all.summary.totalR, 2);
});


test("Replay Lab exposes V5 distinctly from historical V4", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskReplayRuns, "v5-current", {
    backtest_id: "v5-current",
    replay_run_id: "v5-current",
    replay_schema_version: "2.0.0",
    replay_mode: "orchestrated_gpt_in_the_loop",
    cadence: "5m",
    strategy_version: "autopilot_v5",
    autopilot_version: "5.0.0",
    status: "COMPLETED",
    trading_date: "2026-06-11",
    session: "full_day",
    strategy_id: "autopilot_v5",
    summary: { total_R: 1.25 },
    pinned_contracts: {
      master_contract: {
        contract_id: "DeskMasterAnalysisContract_v5_0_0",
        schema_version: "5.0.0",
      },
    },
  });
  await persistence.setDocument(C.deskReplayRuns, "v4-history", {
    ...V4_REPLAY_CONTRACT,
    backtest_id: "v4-history",
    replay_run_id: "v4-history",
    replay_mode: "orchestrated_gpt_in_the_loop",
    strategy_version: "autopilot_v4",
    autopilot_version: "4.0.0",
    status: "COMPLETED",
    trading_date: "2026-06-11",
    session: "full_day",
    strategy_id: "autopilot_v4",
    summary: { total_R: 2 },
  });

  const v5 = await store.listOperationsReplays({ versionScope: "v5" });
  const v4 = await store.listOperationsReplays({ versionScope: "v4" });
  const day = await store.getOperationsReplayDays({ run_id: "v5-current" });

  assert.equal(v5.count, 1);
  assert.equal(v5.items[0].engineVersion, "autopilot_v5");
  assert.equal(v5.items[0].replayClassification, "v5_contractual");
  assert.equal(v4.count, 1);
  assert.equal(v4.items[0].engineVersion, "autopilot_v4");
  assert.equal(day.items[0].sessions.length, 1);
  assert.equal(day.items[0].sessions[0].sourceId, "v5-current");
});

test("replay day keeps multiple session executions, variants and attempts", async () => {
  const { store, persistence } = createStore();
  for (const [id, session, cadence, created, totalR] of [
    ["run-a1", "asia_open", "15m", "2026-07-16T00:00:00.000Z", 0.25],
    ["run-a2", "asia_open", "15m", "2026-07-16T00:05:00.000Z", 1.25],
    ["run-ny", "ny_open", "15m", "2026-07-16T13:30:00.000Z", -0.5],
  ]) {
    await persistence.setDocument(C.deskReplayRuns, id, {
      ...V4_REPLAY_CONTRACT,
      backtest_id: id, replay_run_id: id, replay_mode: "orchestrated_gpt_in_the_loop", status: "COMPLETED",
      strategy_version: "autopilot_v4", autopilot_version: "4.0.0",
      revision: 4, strategy_id: session, session, trading_date: "2026-07-16", cadence,
      steps_done: 4, steps_total: 4, summary: { total_R: totalR }, created_at_utc: created, updated_at_utc: created,
    });
    await persistence.setDocument(C.deskAgentWorkItems, `${id}-work`, {
      work_item_id: `${id}-work`, backtest_id: id, workflow: "REPLAY_MONITOR", status: "COMPLETED",
      attempt_count: 1, max_attempts: 3, updated_at_utc: created,
      gpt_telemetry: { provider: "openai", model: "gpt-5", total_tokens: 1000, cost_usd: 0.01 },
    });
    await persistence.setDocument(C.deskReplayTimeline, `${id}-decision`, {
      event_id: `${id}-decision`, backtest_id: id, event_type: "MONITOR_SAVED", action: "MAINTAIN",
      status: "COMPLETED", note: `${session} decision`, created_at_utc: created,
    });
  }
  const overview = await store.listOperationsReplays();
  assert.equal(overview.summary.executions, 3);
  assert.equal(overview.summary.days, 1);
  assert.deepEqual(overview.facets.sessions, ["asia_open", "ny_open"]);
  assert.deepEqual(overview.facets.variants, ["asia_open:15m", "ny_open:15m"]);
  const day = await store.operations.getReplayDay("run-a1", "2026-07-16");
  assert.equal(day.sessions.length, 3);
  assert.equal(day.variants.length, 2);
  assert.deepEqual(day.sessions.filter((item) => item.session === "asia_open").map((item) => item.attempt), [1, 2]);
  assert.deepEqual([...new Set(day.timeline.map((item) => item.runId))].sort(), ["run-a1", "run-a2", "run-ny"]);
  assert.deepEqual([...new Set(day.timeline.map((item) => item.workflowId))].sort(), ["replay:run-a1", "replay:run-a2", "replay:run-ny"]);
  const comparison = await store.operations.compareReplays(["run-a1", "run-a2", "run-ny"]);
  assert.equal(comparison.contract, "DeskReplayComparison");
  assert.equal(comparison.summary.bestRunId, "run-a2");
  assert.equal(comparison.summary.worstRunId, "run-ny");
  assert.equal(comparison.summary.gptProcesses, 3);
  assert.equal(comparison.summary.telemetryCoveragePct, 100);
  assert.equal(comparison.items.find((item) => item.id === "run-a2").metrics.deltaR, 1);
  assert.equal(comparison.items.find((item) => item.id === "run-ny").rank, 3);
});

test("Replay Compare exposes canonical Simulation Run proofs and artifacts", async () => {
  const { store, persistence } = createStore();
  store.simulationRuns = new SimulationRunRegistryService({
    repository: new InMemorySimulationRunRegistryRepository(),
    clock: { now: () => ({ utc: clock.now().utc }) },
  });
  for (const [runId, simulationRunId, totalR] of [
    ["run-sim-a", "11111111-1111-4111-8111-111111111111", 1.5],
    ["run-sim-b", "22222222-2222-4222-8222-222222222222", 1.5],
  ]) {
    await persistence.setDocument(C.deskReplayRuns, runId, {
      ...V4_REPLAY_CONTRACT,
      backtest_id: runId, replay_run_id: runId, replay_mode: "orchestrated_gpt_in_the_loop",
      status: "COMPLETED", strategy_version: "autopilot_v4", autopilot_version: "4.0.0",
      revision: 1, strategy_id: "asia_open", session: "asia_open", trading_date: "2026-07-16",
      steps_done: 4, steps_total: 4, summary: { total_R: totalR },
      created_at_utc: "2026-07-16T00:00:00.000Z", updated_at_utc: "2026-07-16T01:00:00.000Z",
    });
    await store.simulationRuns.recordSimulationResult({
      simulation_run_id: simulationRunId,
      result: canonicalSimulationResult({ run_id: runId }),
      metadata: { backtest_id: runId },
    }, { actor: "codex", idempotency_key: `record-${runId}` });
  }

  const listResult = await store.operations.listSimulationRuns();
  const detail = await store.operations.getSimulationRun("11111111-1111-4111-8111-111111111111");
  const simulationComparison = await store.operations.compareSimulationRuns([
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ]);
  const replayComparison = await store.operations.compareReplays(["run-sim-a", "run-sim-b"]);

  assert.equal(listResult.available, true);
  assert.equal(listResult.count, 2);
  assert.equal(detail.artifactCount, 6);
  assert.equal(detail.artifacts.some((artifact) => artifact.artifactKind === "ORDER_SIMULATION_POLICY"), true);
  assert.equal(simulationComparison.summary.reproducible, 2);
  assert.equal(simulationComparison.items[1].proof.ok, true);
  assert.equal(replayComparison.summary.simulationProofs, 2);
  assert.equal(replayComparison.items[0].simulationEvidence.count, 1);
  assert.equal(replayComparison.items[0].simulationEvidence.artifacts.some((artifact) => artifact.artifactKind === "METRICS"), true);
});

test("Replay Lab projects the primary full-day clock instead of averaging a legacy comparison", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskReplayRuns, "run-primary", {
    ...V4_REPLAY_CONTRACT,
    backtest_id: "run-primary",
    replay_run_id: "run-primary",
    replay_mode: "orchestrated_gpt_in_the_loop",
    status: "WAITING_GPT_MONITOR",
    trading_date: "2026-06-11",
    session: "asia_open",
    strategy_id: "asia_open",
    run_scope: "full_day",
    aggregate_role: "primary",
    aggregate_eligible: true,
    run_number: 1,
    start_time: "2026-06-11T00:15:00+02:00",
    end_time: "2026-06-11T22:00:00+02:00",
    current_replay_time: "2026-06-11T19:30:00+02:00",
    steps_done: 89,
    steps_total: 90,
    created_at_utc: "2026-07-16T00:00:00.000Z",
    updated_at_utc: "2026-07-16T11:00:00.000Z",
  });
  await persistence.setDocument(C.deskReplayRuns, "run-comparison", {
    ...V4_REPLAY_CONTRACT,
    backtest_id: "run-comparison",
    replay_run_id: "run-comparison",
    replay_mode: "orchestrated_gpt_in_the_loop",
    status: "COMPLETED",
    trading_date: "2026-06-11",
    session: "asia_open",
    strategy_id: "asia_open",
    run_scope: "session",
    aggregate_role: "comparison",
    aggregate_eligible: false,
    run_number: 2,
    summary: { total_R: 9 },
    created_at_utc: "2026-07-15T00:00:00.000Z",
    updated_at_utc: "2026-07-15T01:00:00.000Z",
  });
  await persistence.setDocument(C.deskReplayPositions, "run-primary-position", {
    position_id: "run-primary-position",
    backtest_id: "run-primary",
    status: "CLOSED",
    instrument: "MNQ",
    direction: "short",
    entry_price: 28440,
    initial_stop_loss: 28520,
    exit_price: 28340,
  });

  const overview = await store.listOperationsReplays();
  const day = overview.days[0];
  const primary = overview.items.find((item) => item.sourceId === "run-primary");

  assert.equal(day.primaryRunId, "run-primary");
  assert.equal(day.sessions[0].sourceId, "run-primary");
  assert.equal(day.totalProgress, 89);
  assert.equal(day.provisionalR, 1.25);
  assert.equal(day.totalR, 0);
  assert.equal(day.resultEligibleSessions, 0);
  assert.equal(primary.metrics.processProgress, 99);
  assert.equal(primary.metrics.timelineProgress, 89);
  assert.equal(overview.summary.averageProgress, 89);
});

test("Replay Lab promotes a completed replacement when the explicit primary was cancelled", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskReplayRuns, "run-cancelled-primary", {
    ...V4_REPLAY_CONTRACT,
    backtest_id: "run-cancelled-primary",
    replay_run_id: "run-cancelled-primary",
    replay_mode: "orchestrated_gpt_in_the_loop",
    status: "CANCELLED",
    trading_date: "2026-06-12",
    session: "asia_open",
    strategy_id: "asia_open",
    run_scope: "full_day",
    aggregate_role: "primary",
    aggregate_eligible: true,
    run_number: 1,
    created_at_utc: "2026-07-16T00:00:00.000Z",
    updated_at_utc: "2026-07-16T11:00:00.000Z",
  });
  await persistence.setDocument(C.deskReplayRuns, "run-clean-replacement", {
    ...V4_REPLAY_CONTRACT,
    backtest_id: "run-clean-replacement",
    replay_run_id: "run-clean-replacement",
    replay_mode: "orchestrated_gpt_in_the_loop",
    status: "COMPLETED",
    trading_date: "2026-06-12",
    session: "asia_open",
    strategy_id: "asia_open",
    run_scope: "full_day",
    aggregate_role: "comparison",
    aggregate_eligible: false,
    run_number: 2,
    summary: { total_R: 4.5 },
    created_at_utc: "2026-07-17T00:00:00.000Z",
    updated_at_utc: "2026-07-17T11:00:00.000Z",
  });

  const overview = await store.listOperationsReplays();
  const day = overview.days.find((item) => item.date === "2026-06-12");
  const replacement = overview.items.find((item) => item.sourceId === "run-clean-replacement");
  const cancelled = overview.items.find((item) => item.sourceId === "run-cancelled-primary");

  assert.equal(day.primaryRunId, "run-clean-replacement");
  assert.equal(day.resultEligibleSessions, 1);
  assert.equal(replacement.resultEligible, true);
  assert.equal(replacement.resultEligibilityReason, "selected_daily_primary");
  assert.equal(cancelled.resultEligible, false);
  assert.equal(cancelled.resultEligibilityReason, "run_not_completed_v4");
});

test("Replay Lab shows an active replacement immediately when the explicit primary was cancelled", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskReplayRuns, "run-cancelled-primary", {
    ...V4_REPLAY_CONTRACT,
    backtest_id: "run-cancelled-primary",
    replay_run_id: "run-cancelled-primary",
    replay_mode: "orchestrated_gpt_in_the_loop",
    status: "CANCELLED",
    trading_date: "2026-06-12",
    session: "asia_open",
    strategy_id: "asia_open",
    run_scope: "full_day",
    aggregate_role: "primary",
    aggregate_eligible: true,
    run_number: 1,
    created_at_utc: "2026-07-16T00:00:00.000Z",
    updated_at_utc: "2026-07-16T11:00:00.000Z",
  });
  await persistence.setDocument(C.deskReplayRuns, "run-active-replacement", {
    ...V4_REPLAY_CONTRACT,
    backtest_id: "run-active-replacement",
    replay_run_id: "run-active-replacement",
    replay_mode: "orchestrated_gpt_in_the_loop",
    status: "WAITING_GPT_MONITOR",
    trading_date: "2026-06-12",
    session: "asia_open",
    strategy_id: "asia_open",
    run_scope: "full_day",
    aggregate_role: "comparison",
    aggregate_eligible: false,
    run_number: 2,
    current_replay_time: "2026-06-12T00:30:00+02:00",
    created_at_utc: "2026-07-17T00:00:00.000Z",
    updated_at_utc: "2026-07-17T00:30:00.000Z",
  });

  const overview = await store.listOperationsReplays();
  const day = overview.days.find((item) => item.date === "2026-06-12");

  assert.equal(day.primaryRunId, "run-active-replacement");
  assert.equal(day.sessions[0].sourceId, "run-active-replacement");
  assert.equal(day.resultEligibleSessions, 0);
});

test("GPT inspector exposes persisted conclusion and event lifecycle", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskReplayRuns, "run-1", {
    ...V4_REPLAY_CONTRACT,
    backtest_id: "run-1", replay_run_id: "run-1", replay_mode: "orchestrated_gpt_in_the_loop",
    strategy_version: "autopilot_v4", autopilot_version: "4.0.0",
    status: "WAITING_GPT_MONITOR", revision: 6, strategy_id: "asia_open", session: "asia_open",
    trading_date: "2026-07-16", cadence: "15m", steps_done: 2, steps_total: 4,
    current_step_id: "step-1", current_work_item_id: "work-1", automation_enabled: true,
    created_at_utc: "2026-07-16T00:00:00.000Z", updated_at_utc: "2026-07-16T01:10:00.000Z",
  });
  await persistence.setDocument(C.deskAgentWorkItems, "work-1", {
    work_item_id: "work-1", backtest_id: "run-1", step_id: "step-1", workflow: "REPLAY_MONITOR",
    status: "COMPLETED", attempt_count: 1, max_attempts: 3, updated_at_utc: "2026-07-16T01:10:00.000Z",
    worker_id: "worker-1", claimed_by: "worker-1", lease_expires_at_utc: "2026-07-16T01:30:00.000Z",
    execution_prompt: "Inspecter le bundle et sauvegarder la décision.",
    save_target: { tool: "save_replay_monitor", suggested_payload: { work_item_id: "work-1", worker_id: "worker-1", lease_token: "lease-token-1" } },
    gpt_telemetry: { provider: "openai", model: "gpt-5", input_tokens: 1200, output_tokens: 300, total_tokens: 1500, cost_usd: 0.0425 },
  });
  await persistence.setDocument(C.deskAgentWorkEvents, "event-1", {
    event_id: "event-1", work_item_id: "work-1", backtest_id: "run-1", event_type: "COMPLETED", created_at_utc: "2026-07-16T01:10:00.000Z",
  });
  await persistence.setDocument(C.deskReplayMonitors, "monitor-1", {
    monitor_id: "monitor-1", backtest_id: "run-1", step_id: "step-1", work_item_id: "work-1",
    monitor_decision: { decision: "MAINTAIN", reason: "La thèse reste valide." }, created_at_utc: "2026-07-16T01:09:00.000Z",
  });
  await persistence.setDocument(C.deskReplayBundles, "bundle-1", {
    bundle_id: "bundle-1", backtest_id: "run-1", step_id: "step-1",
    manifest: { sections: ["market", "monitor"] }, data_quality: { status: "ready" },
  });
  await persistence.setDocument(C.deskAlerts, "alert-1", {
    alert_id: "alert-1", title: "Lease GPT proche de l’expiration", message: "Le connecteur doit terminer ou renouveler son lease.",
    severity: "warning", lifecycle_status: "open", revision: 1, backtest_id: "run-1", process_id: "work-1",
    trading_date: "2026-07-16", session: "asia_open", created_at_utc: "2026-07-16T01:11:00.000Z", updated_at_utc: "2026-07-16T01:11:00.000Z",
  });
  const detail = await store.getOperationsGptProcess({ process_id: "work-1" });
  assert.equal(detail.process.status, "completed");
  assert.equal(detail.process.decision, "MAINTAIN");
  assert.equal(detail.process.conclusion, "La thèse reste valide.");
  assert.equal(detail.process.events.length, 1);
  assert.equal(detail.process.telemetry.totalTokens, 1500);
  assert.equal(detail.process.telemetry.costUsd, 0.0425);
  assert.equal(detail.transport.saveTool, "save_replay_monitor");
  assert.equal(detail.transport.workItemId, "work-1");
  assert.equal(detail.transport.workerId, "worker-1");
  assert.equal(detail.transport.leaseToken, null);
  assert.equal(detail.transport.leaseProtected, true);
  assert.equal(detail.transport.suggestedPayload.lease_token, undefined);
  assert.equal(detail.saveTarget.suggested_payload.lease_token, undefined);
  assert.equal(detail.raw.save_target.suggested_payload.lease_token, undefined);
  assert.equal(JSON.stringify(detail).includes("lease-token-1"), false);
  assert.equal(detail.transport.hasLeaseHandle, true);
  assert.equal(detail.transport.promptAvailable, true);
  assert.equal(detail.transport.manifestAvailable, true);
  assert.equal(detail.transport.saveTargetAvailable, true);
  assert.equal(detail.operationsContext.workflow.id, "replay:run-1");
  assert.equal(detail.operationsContext.workflowCommand.action, "pause");
  assert.equal(detail.operationsContext.transportHealth.state, "saved");
  assert.equal(detail.operationsContext.incidents[0].title, "Lease GPT proche de l’expiration");
  assert.ok(detail.operationsContext.runbooks.some((item) => item.runId === "run-1"));
  assert.ok(detail.operationsContext.links.some((link) => link.kind === "workflow_action" && link.action === "pause"));
  assert.ok(detail.operationsContext.riskFlags.some((flag) => flag.code === "OUTPUT_SAVED"));
  assert.equal((await store.listOperationsIncidents({ process: "work-1" })).count, 1);
  assert.equal((await store.listOperationsRunbooks({ process: "work-1" })).items.length, 2);
  assert.equal((await store.getOperationsObservability({ process: "work-1" })).count, 1);
});

test("GPT projections expose the latest Codex research progress joined by claim handle", async () => {
  const { store, persistence } = createStore();
  const latestProgress = {
    schema_version: "desk_analytical_research_progress_v1",
    status: "IN_PROGRESS",
    current_phase: "NEWS",
    coverage: { required: 10, total: 10, complete: 7, percent: 70 },
    phases: [],
    tool_calls_count: 14,
    evidence_receipts_count: 28,
  };
  const latestValidation = {
    status: "APPROVED_DEGRADED",
    decision_allowed: true,
    blockers: [],
  };
  await persistence.setDocument(C.deskReplayRuns, "run-research", {
    ...V4_REPLAY_CONTRACT,
    backtest_id: "run-research",
    replay_run_id: "run-research",
    replay_mode: "orchestrated_gpt_in_the_loop",
    strategy_version: "autopilot_v4",
    autopilot_version: "4.0.0",
    status: "WAITING_GPT_MASTER",
    strategy_id: "asia_open",
    session: "asia_open",
    trading_date: "2026-07-16",
    created_at_utc: "2026-07-16T10:00:00.000Z",
    updated_at_utc: "2026-07-16T11:00:00.000Z",
  });
  await persistence.setDocument(C.deskAgentWorkItems, "work-research", {
    work_item_id: "work-research",
    backtest_id: "run-research",
    step_id: "step-research",
    workflow: "REPLAY_MASTER",
    status: "CLAIMED",
    attempt_count: 1,
    max_attempts: 3,
    created_at_utc: "2026-07-16T10:55:00.000Z",
    updated_at_utc: "2026-07-16T11:00:00.000Z",
  });
  await persistence.setDocument("desk_ai_worker_runs", "ai-run-old", {
    ai_run_id: "ai-run-old",
    claim_handle: { work_item_id: "work-research" },
    research_progress: {
      schema_version: "desk_analytical_research_progress_v1",
      status: "IN_PROGRESS",
      current_phase: "CORE_MARKET",
      coverage: { required: 10, total: 10, complete: 2, percent: 20 },
    },
    analytical_validation: { status: "BLOCKED", decision_allowed: false },
    updated_at_utc: "2026-07-16T10:58:00.000Z",
  });
  await persistence.setDocument("desk_ai_worker_runs", "ai-run-latest", {
    ai_run_id: "ai-run-latest",
    claim_handle: { work_item_id: "work-research" },
    research_progress: latestProgress,
    analytical_validation: latestValidation,
    updated_at_utc: "2026-07-16T11:05:00.000Z",
  });
  await persistence.setDocument("desk_ai_worker_runs", "ai-run-unrelated", {
    ai_run_id: "ai-run-unrelated",
    claim_handle: { work_item_id: "another-work-item" },
    research_progress: {
      schema_version: "desk_analytical_research_progress_v1",
      status: "COMPLETE",
      coverage: { required: 10, total: 10, complete: 10, percent: 100 },
    },
    analytical_validation: { status: "APPROVED", decision_allowed: true },
    updated_at_utc: "2026-07-16T11:10:00.000Z",
  });

  const listed = await store.listOperationsGptProcesses({ runId: "run-research" });
  assert.equal(listed.count, 1);
  assert.deepEqual(listed.items[0].researchProgress, latestProgress);
  assert.deepEqual(listed.items[0].analyticalValidation, latestValidation);

  const detail = await store.getOperationsGptProcess({ process_id: "work-research" });
  assert.deepEqual(detail.process.researchProgress, latestProgress);
  assert.deepEqual(detail.process.analyticalValidation, latestValidation);
  assert.deepEqual(detail.researchProgress, latestProgress);
  assert.deepEqual(detail.analyticalValidation, latestValidation);

  const observability = await store.getOperationsObservability({ process: "work-research" });
  assert.equal(observability.count, 1);
  assert.deepEqual(observability.items[0].researchProgress, latestProgress);
  assert.deepEqual(observability.items[0].analyticalValidation, latestValidation);
});

test("observability exposes queue, leases and measured GPT cost coverage without estimates", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskAgentWorkItems, "work-completed", {
    work_item_id: "work-completed",
    backtest_id: "run-1",
    step_id: "step-1",
    automation_scope: "replay",
    workflow: "REPLAY_MASTER",
    status: "COMPLETED",
    attempt_count: 1,
    max_attempts: 3,
    trading_date: "2026-07-16",
    session: "asia_open",
    claimed_by: "worker-a",
    created_at_utc: "2026-07-16T10:58:00.000Z",
    claimed_at_utc: "2026-07-16T11:00:00.000Z",
    completed_at_utc: "2026-07-16T11:04:00.000Z",
    updated_at_utc: "2026-07-16T11:04:00.000Z",
    gpt_telemetry: {
      provider: "openai",
      model: "gpt-5",
      input_tokens: 1200,
      output_tokens: 300,
      total_tokens: 1500,
      cost_usd: 0.0425,
      api_latency_ms: 4200,
    },
  });
  await persistence.setDocument(C.deskAgentWorkItems, "work-expired", {
    work_item_id: "work-expired",
    backtest_id: "run-2",
    step_id: "step-2",
    automation_scope: "replay",
    workflow: "REPLAY_MONITOR",
    status: "CLAIMED",
    attempt_count: 2,
    max_attempts: 3,
    trading_date: "2026-07-16",
    session: "ny_open",
    claimed_by: "worker-b",
    created_at_utc: "2026-07-16T11:40:00.000Z",
    claimed_at_utc: "2026-07-16T11:45:00.000Z",
    lease_expires_at_utc: "2026-07-16T11:59:00.000Z",
    updated_at_utc: "2026-07-16T11:45:00.000Z",
  });

  const overview = await store.getOperationsObservability();

  assert.equal(overview.contract, "DeskObservabilityOverview");
  assert.equal(overview.summary.processes, 2);
  assert.equal(overview.summary.completed, 1);
  assert.equal(overview.summary.running, 1);
  assert.equal(overview.summary.retries, 1);
  assert.equal(overview.summary.totalTokens, 1500);
  assert.equal(overview.summary.costUsd, 0.0425);
  assert.deepEqual(overview.coverage.cost, { available: 1, total: 2, percent: 50 });
  assert.equal(overview.leases.expired, 1);
  assert.equal(overview.guardrails.policy.revision, 0);
  assert.equal(overview.guardrails.summary.critical, 2);
  assert.equal(overview.guardrails.signals.some((item) => item.type === "LEASE_EXPIRED"), true);
  assert.equal(overview.guardrails.signals.some((item) => item.type === "TELEMETRY_COVERAGE_LOW"), true);
  assert.equal(overview.items.find((item) => item.id === "work-expired").telemetry.costUsd, null);
  assert.equal((await store.getOperationsObservability({ worker: "worker-a" })).count, 1);
});

test("Codex reasoning effort defaults to xhigh and can be changed with revision control", async () => {
  const { store, persistence } = createStore();

  const initial = await store.getOperationsAiRuntimeSettings();
  assert.equal(initial.settings.reasoningEffort, "xhigh");
  assert.equal(initial.settings.revision, 0);
  assert.equal(initial.persisted, false);

  const updated = await store.executeOperationsAiRuntimeSettingsAction({
    input: {
      action: "update_reasoning_effort",
      expectedRevision: 0,
      reasoningEffort: "max",
      idempotencyKey: "codex-effort-max-1",
      confirmationPhrase: "CONFIRM_UPDATE_REASONING_EFFORT",
      reason: "Valider la configuration dynamique",
    },
    actor: { kind: "test-operator" },
  });

  assert.equal(updated.settings.reasoningEffort, "max");
  assert.equal(updated.settings.revision, 1);
  const stored = await persistence.getDocument(C.deskAiRuntimeSettings, "default");
  assert.equal(stored.reasoning_effort, "max");
  const overview = await store.getOperationsObservability();
  assert.equal(overview.aiRuntimeSettings.reasoningEffort, "max");

  await assert.rejects(
    () => store.executeOperationsAiRuntimeSettingsAction({
      input: {
        action: "update_reasoning_effort",
        expectedRevision: 0,
        reasoningEffort: "high",
        idempotencyKey: "codex-effort-high-1",
        confirmationPhrase: "CONFIRM_UPDATE_REASONING_EFFORT",
        reason: "Tester le contrôle de révision",
      },
      actor: { kind: "test-operator" },
    }),
    (error) => error.code === "REVISION_CONFLICT",
  );
});

test("observability incident evaluator persists, deduplicates and auto-resolves guardrail incidents", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskObservabilityPolicies, "default", {
    policy_id: "default",
    revision: 4,
    enabled: true,
    queue_warning_ms: 3_600_000,
    execution_warning_ms: 3_600_000,
    lease_expiring_ms: 120_000,
    telemetry_coverage_warning_pct: 0,
    cost_coverage_minimum_pct: 0,
    failure_rate_warning_pct: 100,
  });
  await persistence.setDocument(C.deskAgentWorkItems, "work-expired", {
    work_item_id: "work-expired",
    backtest_id: "run-incident",
    automation_scope: "replay",
    workflow: "REPLAY_MONITOR",
    status: "CLAIMED",
    attempt_count: 1,
    max_attempts: 3,
    trading_date: "2026-07-16",
    session: "ny_open",
    claimed_by: "worker-incident",
    created_at_utc: "2026-07-16T11:58:00.000Z",
    claimed_at_utc: "2026-07-16T11:59:00.000Z",
    lease_expires_at_utc: "2026-07-16T11:59:30.000Z",
    updated_at_utc: "2026-07-16T11:59:00.000Z",
  });

  const first = await store.evaluateOperationsObservabilityIncidents({
    input: { autoResolve: true, reason: "Test guardrail materializer" },
    actor: { kind: "test-scheduler" },
  });
  assert.equal(first.contract, "DeskObservabilityIncidentSync");
  assert.equal(first.evaluatedSignals, 1);
  assert.equal(first.opened, 1);
  assert.equal(first.resolved, 0);

  const incidents = await store.listOperationsIncidents({ kind: "guardrail" });
  assert.equal(incidents.count, 1);
  assert.equal(incidents.summary.guardrails, 1);
  assert.equal(incidents.items[0].kind, "guardrail");
  assert.equal(incidents.items[0].guardrailType, "LEASE_EXPIRED");
  assert.equal(incidents.items[0].processId, "work-expired");
  assert.equal(incidents.items[0].policyRevision, 4);
  assert.equal(incidents.items[0].timeline.length, 2);
  const revision = incidents.items[0].revision;

  const second = await store.evaluateOperationsObservabilityIncidents({
    input: { autoResolve: true, reason: "Test guardrail materializer" },
    actor: { kind: "test-scheduler" },
  });
  assert.equal(second.opened, 0);
  assert.equal(second.updated, 0);
  assert.equal(second.unchanged, 1);
  assert.equal((await store.listOperationsIncidents({ kind: "guardrail" })).items[0].revision, revision);

  const current = await persistence.getDocument(C.deskAgentWorkItems, "work-expired");
  await persistence.setDocument(C.deskAgentWorkItems, "work-expired", {
    ...current,
    status: "COMPLETED",
    completed_at_utc: "2026-07-16T12:00:00.000Z",
    updated_at_utc: "2026-07-16T12:00:00.000Z",
    gpt_telemetry: { provider: "openai", model: "gpt-5", total_tokens: 100, cost_usd: 0.001 },
  });
  const third = await store.evaluateOperationsObservabilityIncidents({
    input: { autoResolve: true, reason: "Signal healthy" },
    actor: { kind: "test-scheduler" },
  });
  assert.equal(third.evaluatedSignals, 0);
  assert.equal(third.resolved, 1);
  assert.equal((await store.listOperationsIncidents({ kind: "guardrail" })).items[0].lifecycleStatus, "resolved");
});

test("observability guardrail policy is revisioned, idempotent and detects measured budget breaches", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskAgentWorkItems, "work-cost", {
    work_item_id: "work-cost",
    backtest_id: "run-cost",
    automation_scope: "replay",
    workflow: "REPLAY_MASTER",
    status: "COMPLETED",
    attempt_count: 1,
    max_attempts: 3,
    trading_date: "2026-07-16",
    created_at_utc: "2026-07-16T10:00:00.000Z",
    claimed_at_utc: "2026-07-16T10:01:00.000Z",
    completed_at_utc: "2026-07-16T10:04:00.000Z",
    updated_at_utc: "2026-07-16T10:04:00.000Z",
    gpt_telemetry: { provider: "openai", model: "gpt-5", total_tokens: 1500, cost_usd: 0.0425 },
  });
  const initial = await store.getOperationsObservabilityPolicy();
  assert.equal(initial.persisted, false);
  assert.equal(initial.policy.dailyCostBudgetUsd, null);

  const input = {
    action: "update",
    expectedRevision: 0,
    idempotencyKey: "guardrail-policy-v1",
    confirmationPhrase: "CONFIRM_UPDATE",
    reason: "Définir les limites locales de la préproduction",
    policy: {
      enabled: true,
      queueWarningMs: 120_000,
      executionWarningMs: 600_000,
      leaseExpiringMs: 120_000,
      telemetryCoverageWarningPct: 50,
      costCoverageMinimumPct: 50,
      failureRateWarningPct: 20,
      dailyCostBudgetUsd: 0.04,
      monthlyCostBudgetUsd: 1,
    },
  };
  const updated = await store.executeOperationsObservabilityPolicyAction({ input, actor: { kind: "test" } });
  assert.equal(updated.policy.revision, 1);
  assert.equal(updated.policy.dailyCostBudgetUsd, 0.04);
  const replayed = await store.executeOperationsObservabilityPolicyAction({ input, actor: { kind: "test" } });
  assert.equal(replayed.idempotent, true);
  const overview = await store.getOperationsObservability();
  assert.equal(overview.sla.queueWarningMs, 120_000);
  assert.equal(overview.guardrails.signals.some((item) => item.type === "DAILY_COST_BUDGET_BREACH"), true);
  assert.equal(overview.guardrails.budgets.daily[0].state, "breached");
  await assert.rejects(
    store.executeOperationsObservabilityPolicyAction({
      input: { ...input, policy: { ...input.policy, dailyCostBudgetUsd: 0.03 } },
      actor: { kind: "test" },
    }),
    (error) => error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("workflow actions enforce revision, confirmation and idempotency", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskReplayRuns, "run-1", {
    ...V4_REPLAY_CONTRACT,
    backtest_id: "run-1", replay_run_id: "run-1", replay_mode: "orchestrated_gpt_in_the_loop",
    strategy_version: "autopilot_v4", autopilot_version: "4.0.0",
    status: "READY_FOR_NEXT_MONITOR", automation_enabled: true, revision: 5,
    updated_at_utc: "2026-07-16T11:00:00.000Z",
  });
  const before = await store.getOperationsWorkflow({ workflow_id: "replay:run-1" });
  assert.equal(before.commandCenter.expectedRevision, 5);
  assert.equal(before.commandCenter.actions.find((item) => item.action === "cancel").enabled, true);
  const input = { action: "cancel", expectedRevision: 5, idempotencyKey: "cancel-replay-1", confirmationPhrase: "CONFIRM_CANCEL", reason: "Arrêt demandé par l’opérateur" };
  const first = await store.executeOperationsWorkflowAction({ workflow_id: "replay:run-1", input, actor: { kind: "test" } });
  assert.equal(first.ok, true);
  assert.equal(first.workflow.status, "cancelled");
  const after = await store.getOperationsWorkflow({ workflow_id: "replay:run-1" });
  assert.equal(after.commandCenter.commandBus.applied, 1);
  assert.equal(after.commandCenter.commandBus.history[0].action, "cancel");
  assert.equal(after.commandCenter.commandBus.history[0].actor, "test");
  const replayed = await store.executeOperationsWorkflowAction({ workflow_id: "replay:run-1", input, actor: { kind: "test" } });
  assert.equal(replayed.idempotent, true);
  await assert.rejects(
    store.executeOperationsWorkflowAction({ workflow_id: "replay:run-1", input: { ...input, idempotencyKey: "other-key", expectedRevision: 4 }, actor: {} }),
    (error) => error.code === "REVISION_CONFLICT",
  );
});

test("active replay retry recovers a bounded GPT failure and advances the canonical revision", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskReplayRuns, "run-retry", {
    replay_schema_version: "2.0.0",
    cadence: "5m",
    ...ACTIVE_REPLAY_RUNTIME_PINS,
    pinned_contracts: {
      master_contract: {
        contract_id: "DeskMasterAnalysisContract_v5_1_0",
        schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract,
      },
      monitor_contract: {
        contract_id: "DeskHourlyThesisMonitorContract_v2_1_0",
        schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
      },
    },
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
    ...ACTIVE_REPLAY_RUNTIME_PINS,
    work_item_id: "work-retry",
    automation_scope: "replay",
    backtest_id: "run-retry",
    step_id: "step-retry",
    workflow: "REPLAY_MASTER",
    contract_context: activeReplayContractContext("REPLAY_MASTER"),
    expected_revision: 7,
    idempotency_key: "save-master:run-retry:step-retry",
    save_target: activeReplaySaveTarget("REPLAY_MASTER", 7),
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
  assert.equal(recovered.expected_revision, 8);
  assert.equal(recovered.save_target.expected_revision, 8);
  assert.equal(recovered.idempotency_key, "save-master:run-retry:step-retry");
  assert.equal(recovered.save_target.idempotency_key, "save-master:run-retry:step-retry");

  await persistence.setDocument(C.deskReplayRuns, "run-retry", {
    status: "FAILED",
    automation_status: "failed",
    automation_enabled: false,
    revision: 8,
  }, { merge: true });
  await persistence.setDocument(C.deskAgentWorkItems, "work-retry", {
    status: "FAILED",
    attempt_count: 1,
    failure_count: 1,
    retryable: false,
    last_error: {
      code: "DETERMINISTIC_MONITOR_COMMAND_INVALID",
      message: "DETERMINISTIC_MONITOR_COMMAND compilation failed at the save boundary.",
      retryable: false,
    },
  }, { merge: true });

  const compilerRecovery = await store.executeOperationsWorkflowAction({
    workflow_id: "replay:run-retry",
    input: {
      ...input,
      expectedRevision: 8,
      idempotencyKey: "retry-run-retry-after-compiler-patch",
      reason: "Récupération bornée après déploiement du correctif compilateur V5.1",
    },
    actor: { kind: "test" },
  });

  assert.equal(compilerRecovery.ok, true);
  assert.equal(compilerRecovery.workflow.status, "waiting_gpt");
  assert.equal(compilerRecovery.workflow.revision, 9);
  const compilerRecovered = await persistence.getDocument(C.deskAgentWorkItems, "work-retry");
  assert.equal(compilerRecovered.status, "READY");
  assert.equal(compilerRecovered.recovery_count, 2);
  assert.equal(compilerRecovered.last_error, null);
  assert.equal(compilerRecovered.expected_revision, 9);
  assert.equal(compilerRecovered.save_target.expected_revision, 9);

  await persistence.setDocument(C.deskReplayRuns, "run-retry", {
    status: "FAILED",
    automation_status: "failed",
    automation_enabled: false,
    revision: 9,
  }, { merge: true });
  await persistence.setDocument(C.deskAgentWorkItems, "work-retry", {
    status: "FAILED",
    attempt_count: 3,
    failure_count: 2,
    retryable: false,
    last_error: {
      code: "MONITOR_REVISION_CONFLICT",
      message: "Replay Monitor expected_revision no longer matches the canonical run.",
      retryable: false,
    },
  }, { merge: true });

  const casRecovery = await store.executeOperationsWorkflowAction({
    workflow_id: "replay:run-retry",
    input: {
      ...input,
      expectedRevision: 9,
      idempotencyKey: "retry-run-retry-after-cas-patch",
      reason: "Réalignement borné du compare-and-swap après récupération opérateur",
    },
    actor: { kind: "test" },
  });

  assert.equal(casRecovery.ok, true);
  assert.equal(casRecovery.workflow.status, "waiting_gpt");
  assert.equal(casRecovery.workflow.revision, 10);
  const casRecovered = await persistence.getDocument(C.deskAgentWorkItems, "work-retry");
  assert.equal(casRecovered.status, "READY");
  assert.equal(casRecovered.recovery_count, 3);
  assert.equal(casRecovered.last_error, null);
  assert.equal(casRecovered.expected_revision, 10);
  assert.equal(casRecovered.save_target.expected_revision, 10);
});

test("resuming paused Replay automation rebases the work CAS to the new run revision", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskReplayRuns, "run-resume", {
    replay_schema_version: "2.0.0",
    cadence: "5m",
    ...ACTIVE_REPLAY_RUNTIME_PINS,
    pinned_contracts: {
      master_contract: {
        contract_id: "DeskMasterAnalysisContract_v5_1_0",
        schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract,
      },
      monitor_contract: {
        contract_id: "DeskHourlyThesisMonitorContract_v2_1_0",
        schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
      },
    },
    backtest_id: "run-resume",
    replay_run_id: "run-resume",
    run_id: "run-resume",
    replay_mode: "orchestrated_gpt_in_the_loop",
    status: "WAITING_GPT_MONITOR",
    automation_status: "paused",
    automation_enabled: false,
    current_step_id: "step-resume",
    current_work_item_id: "work-resume",
    revision: 12,
    strategy_id: "asia_open",
    session: "asia_open",
    trading_date: "2026-07-16",
    created_at_utc: "2026-07-16T00:00:00.000Z",
    updated_at_utc: "2026-07-16T01:00:00.000Z",
  });
  await persistence.setDocument(C.deskAgentWorkItems, "work-resume", {
    ...ACTIVE_REPLAY_RUNTIME_PINS,
    work_item_id: "work-resume",
    automation_scope: "replay",
    backtest_id: "run-resume",
    replay_run_id: "run-resume",
    run_id: "run-resume",
    step_id: "step-resume",
    workflow: "REPLAY_MONITOR",
    contract_context: activeReplayContractContext("REPLAY_MONITOR"),
    expected_revision: 12,
    idempotency_key: "save-monitor:run-resume:step-resume",
    save_target: activeReplaySaveTarget("REPLAY_MONITOR", 12),
    status: "PAUSED",
    pause_reason: "validation_hold",
    attempt_count: 0,
    failure_count: 0,
    max_attempts: 3,
    created_at_utc: "2026-07-16T00:30:00.000Z",
    updated_at_utc: "2026-07-16T01:00:00.000Z",
  });

  const result = await store.setReplayAutomation({
    backtest_id: "run-resume",
    enabled: true,
    expected_revision: 12,
    reason: "Resume one protected Replay work item.",
  });

  const run = await persistence.getDocument(C.deskReplayRuns, "run-resume");
  const work = await persistence.getDocument(C.deskAgentWorkItems, "work-resume");
  assert.equal(result.automation_enabled, true);
  assert.equal(run.revision, 13);
  assert.equal(work.status, "READY");
  assert.equal(work.expected_revision, 13);
  assert.equal(work.save_target.expected_revision, 13);
});

function activeReplayContractContext(workflow) {
  const master = workflow.endsWith("MASTER");
  return {
    contract_name: master
      ? "DeskMasterAnalysisContract"
      : "DeskHourlyThesisMonitorContract",
    schema_version: master
      ? ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract
      : ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
    contract_hash: `active-contract-${workflow}`,
    execution_policy: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy },
    execution_plan: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan },
    monitor_command: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command },
    condition_catalog: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog },
  };
}

function activeReplaySaveTarget(workflow, expectedRevision = null) {
  const master = workflow.endsWith("MASTER");
  return {
    contract_name: master
      ? "DeskMasterAnalysisContract"
      : "DeskHourlyThesisMonitorContract",
    schema_version: master
      ? ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract
      : ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
    replay_execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
    execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
    monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
    condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
    deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
    condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
    ...(expectedRevision === null ? {} : {
      expected_revision: expectedRevision,
      idempotency_key: "save-master:run-retry:step-retry",
    }),
  };
}

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
  assert.equal(result.incident.triage.queue, "closed");
  assert.equal(result.incident.recommendedActions[0].action, "reopen");
  const replayed = await store.executeOperationsIncidentAction({ incident_id: "alert:alert-1", input, actor: { kind: "test" } });
  assert.equal(replayed.idempotent, true);
  assert.equal(persistence.count(C.deskOperationsEvents), 1);
});

test("incident notifications are deduplicated, actionable and cleared locally", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskAlerts, "alert-notif", {
    alert_id: "alert-notif",
    title: "Lease GPT expiré",
    message: "Le worker n’a plus de lease valide.",
    severity: "critical",
    lifecycle_status: "open",
    status: "OPEN",
    revision: 4,
    run_id: "run-notif",
    process_id: "work-notif",
    workflow: "REPLAY_MONITOR",
    created_at_utc: "2026-07-16T11:00:00.000Z",
    updated_at_utc: "2026-07-16T11:00:00.000Z",
  });

  const first = await store.syncOperationsNotifications({
    input: { autoClear: true, reason: "Sync notifications test" },
    actor: { kind: "test-scheduler" },
  });
  assert.equal(first.contract, "DeskNotificationSync");
  assert.equal(first.opened, 1);
  assert.equal(first.active, 1);

  const incidents = await store.listOperationsIncidents({ q: "lease" });
  assert.equal(incidents.summary.unowned, 1);
  assert.equal(incidents.summary.slaBreached, 1);
  assert.equal(incidents.triage.page, 1);
  assert.equal(incidents.items[0].triage.nextAction, "assign");
  assert.equal(incidents.items[0].links.some((link) => link.kind === "gpt"), true);

  const listed = await store.listOperationsNotifications({ status: "active" });
  assert.equal(listed.contract, "DeskNotificationList");
  assert.equal(listed.count, 1);
  assert.equal(listed.summary.page, 1);
  assert.equal(listed.items[0].status, "pending");
  assert.equal(listed.items[0].escalationLevel, "page");
  assert.equal(listed.items[0].incidentId, "alert:alert-notif");
  assert.equal(listed.items[0].allowedActions.includes("mark_read"), true);

  const notification = listed.items[0];
  const input = {
    action: "mark_read",
    expectedRevision: notification.revision,
    idempotencyKey: "notif-read-alert",
    confirmationPhrase: "CONFIRM_MARK_READ",
    reason: "Pris en compte par opérateur",
  };
  const action = await store.executeOperationsNotificationAction({
    notification_id: notification.id,
    input,
    actor: { kind: "test-operator" },
  });
  assert.equal(action.notification.status, "read");
  assert.equal(action.notification.revision, notification.revision + 1);
  const replayed = await store.executeOperationsNotificationAction({
    notification_id: notification.id,
    input,
    actor: { kind: "test-operator" },
  });
  assert.equal(replayed.idempotent, true);

  const alert = await persistence.getDocument(C.deskAlerts, "alert-notif");
  await persistence.setDocument(C.deskAlerts, "alert-notif", {
    ...alert,
    lifecycle_status: "resolved",
    status: "RESOLVED",
    revision: Number(alert.revision) + 1,
    resolved_at_utc: "2026-07-16T12:00:00.000Z",
    updated_at_utc: "2026-07-16T12:00:00.000Z",
  });
  const cleared = await store.syncOperationsNotifications({
    input: { autoClear: true, reason: "Incident résolu" },
    actor: { kind: "test-scheduler" },
  });
  assert.equal(cleared.cleared, 1);
  const history = await store.listOperationsNotifications({ status: "cleared" });
  assert.equal(history.count, 1);
  assert.equal(history.items[0].status, "cleared");
  assert.equal(history.items[0].escalationLevel, "cleared");
});

test("runbooks are generated from active notifications, incidents and blocked workflows", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskReplayRuns, "run-runbook", {
    backtest_id: "run-runbook",
    replay_run_id: "run-runbook",
    replay_mode: "orchestrated_gpt_in_the_loop",
    status: "FAILED",
    revision: 5,
    strategy_id: "asia_open",
    session: "asia_open",
    trading_date: "2026-07-16",
    current_work_item_id: "work-runbook",
    last_automation_error: { code: "WORK_FAILED_REQUIRES_OPERATOR", message: "GPT failure after retries" },
    created_at_utc: "2026-07-16T10:00:00.000Z",
    updated_at_utc: "2026-07-16T11:50:00.000Z",
  });
  await persistence.setDocument(C.deskAgentWorkItems, "work-runbook", {
    work_item_id: "work-runbook",
    backtest_id: "run-runbook",
    workflow: "REPLAY_MONITOR",
    status: "FAILED",
    attempt_count: 3,
    max_attempts: 3,
    last_error: { code: "GPT_FAILURE", message: "Tool save rejected" },
    updated_at_utc: "2026-07-16T11:50:00.000Z",
  });
  await persistence.setDocument(C.deskAlerts, "alert-runbook", {
    alert_id: "alert-runbook",
    title: "Lease GPT expirée",
    message: "Le lease du work item est expiré.",
    severity: "critical",
    lifecycle_status: "open",
    revision: 2,
    run_id: "run-runbook",
    process_id: "work-runbook",
    workflow: "REPLAY_MONITOR",
    created_at_utc: "2026-07-16T11:00:00.000Z",
    updated_at_utc: "2026-07-16T11:55:00.000Z",
  });
  await store.syncOperationsNotifications({ input: { autoClear: true, reason: "Sync runbooks" }, actor: { kind: "test" } });

  const list = await store.listOperationsRunbooks({ q: "lease" });
  assert.equal(list.contract, "DeskRunbookList");
  assert.equal(list.summary.actionRequired >= 1, true);
  assert.equal(list.summary.leaseExpired >= 1, true);
  assert.equal(list.items[0].kind, "lease_expired");
  assert.equal(list.items[0].triage.queue, "page");
  assert.equal(list.items[0].sla.breached, true);
  assert.equal(list.items[0].recommendedActions.some((action) => action.action === "assign"), true);
  assert.equal(list.items[0].steps.some((step) => step.id === "inspect_gpt_process"), true);
  assert.equal(list.items[0].links.some((link) => link.kind === "incident"), true);
  assert.equal(list.items[0].blastRadius.scope, "process");
  assert.equal(list.items[0].steps.find((step) => step.commandAction === "retry").href.includes("action=retry"), true);

  const detail = await store.getOperationsRunbook({ runbook_id: list.items[0].id });
  assert.equal(detail.contract, "DeskRunbookDetail");
  assert.equal(detail.runbook.id, list.items[0].id);
  assert.equal(detail.runbook.triage.nextAction, "assign");
});

test("history projects filtered session aggregates and a real session detail", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskReplayRuns, "history-run", {
    ...V4_REPLAY_CONTRACT,
    backtest_id: "history-run", replay_run_id: "history-run", replay_mode: "orchestrated_gpt_in_the_loop",
    status: "COMPLETED", revision: 3, strategy_id: "strategy-history", session: "asia_open",
    strategy_version: "autopilot_v4", autopilot_version: "4.0.0",
    trading_date: "2026-07-16", steps_done: 4, steps_total: 4, total_R: 1.25,
    created_at_utc: "2026-07-16T00:00:00.000Z", updated_at_utc: "2026-07-16T01:00:00.000Z",
  });
  await persistence.setDocument(C.deskJobs, "history-job", {
    job_id: "history-job", job_type: "LIVE_MONITOR", status: "RUNNING", revision: 1,
    trading_date: "2026-07-17", session: "ny_open", strategy_id: "strategy-other",
    created_at_utc: "2026-07-17T13:00:00.000Z", updated_at_utc: "2026-07-17T13:30:00.000Z",
  });
  await persistence.setDocument(C.deskAgentWorkItems, "history-work", {
    work_item_id: "history-work", backtest_id: "history-run", step_id: "history-step",
    workflow: "REPLAY_MONITOR", status: "COMPLETED", attempt_count: 1,
    created_at_utc: "2026-07-16T00:30:00.000Z", completed_at_utc: "2026-07-16T00:45:00.000Z",
    updated_at_utc: "2026-07-16T00:45:00.000Z",
  });
  await persistence.setDocument(C.deskReplayTimeline, "history-event", {
    event_id: "history-event", backtest_id: "history-run", event_type: "MONITOR_SAVED",
    action: "MAINTAIN", status: "COMPLETED", timestamp_utc: "2026-07-16T00:45:00.000Z",
  });
  await persistence.setDocument(C.deskAlerts, "history-alert", {
    alert_id: "history-alert", title: "Contrôle historique", lifecycle_status: "open",
    severity: "warning", trading_date: "2026-07-16", session: "asia_open",
    created_at_utc: "2026-07-16T00:50:00.000Z", updated_at_utc: "2026-07-16T00:50:00.000Z",
  });

  const history = await store.getOperationsHistory({ date: "2026-07-16" });
  assert.equal(history.contract, "DeskHistory");
  assert.equal(history.summary.sessions, 1);
  assert.equal(history.summary.workflows, 1);
  assert.equal(history.summary.completed, 1);
  assert.equal(history.summary.openIncidents, 1);
  assert.deepEqual(history.facets.sessions, ["asia_open"]);
  assert.deepEqual(history.facets.dateRange, { from: "2026-07-16", to: "2026-07-16" });
  assert.equal(history.sessions[0].id, "2026-07-16:asia_open");
  assert.equal(history.sessions[0].progress, 100);
  assert.equal(history.sessions[0].incidentCount, 1);
  assert.deepEqual(history.sessions[0].strategies, ["strategy-history"]);
  assert.equal(history.sessions[0].automationScore, 88);
  assert.equal(history.governance.statusMatrix.find((item) => item.label === "completed").count, 1);
  assert.equal(history.governance.sessionMatrix.find((item) => item.label === "asia_open").incidents, 1);
  assert.equal(history.governance.auditTrail[0].title, "Contrôle historique");
  assert.equal(history.governance.riskFlags.includes("OPEN_INCIDENT"), true);

  const detail = await store.getOperationsHistorySession({ session_id: "2026-07-16:asia_open" });
  assert.equal(detail.contract, "DeskHistorySessionDetail");
  assert.equal(detail.summary.workflows, 1);
  assert.equal(detail.summary.gptProcesses, 1);
  assert.equal(detail.summary.incidents, 1);
  assert.equal(detail.timeline[0].workflowId, "replay:history-run");
  assert.equal(detail.timeline[0].runId, "history-run");
  assert.equal(detail.matrix.statuses.find((item) => item.label === "completed").count, 1);
  assert.equal(detail.matrix.gptStatuses.find((item) => item.label === "completed").count, 1);
  assert.equal(detail.decisionFlow.find((item) => item.decision === "MAINTAIN").runId, "history-run");
  assert.equal(detail.auditTrail[0].title, "Contrôle historique");
  assert.equal(detail.links.some((item) => item.kind === "performance"), true);
  assert.equal(detail.gptProcesses[0].id, "history-work");
});

test("performance and strategy version comparison use canonical persisted documents", async () => {
  const { store, persistence } = createStore();
  await persistence.setDocument(C.deskStrategyTrades, "trade-1", { trade_id: "trade-1", strategy_version: "autopilot_v4", strategy_id: "strategy-1", trading_date: "2026-07-16", session: "asia_open", instrument: "MNQ", direction: "long", status: "CLOSED", result_R: 1.5, closed_at_utc: "2026-07-16T08:00:00.000Z" });
  await persistence.setDocument(C.deskStrategyTrades, "trade-2", { trade_id: "trade-2", strategy_version: "autopilot_v4", strategy_id: "strategy-1", trading_date: "2026-07-17", session: "ny_open", instrument: "MNQ", direction: "short", status: "CLOSED", result_R: -0.5, closed_at_utc: "2026-07-17T14:00:00.000Z" });
  await persistence.setDocument(C.deskStrategyTrades, "trade-other", { trade_id: "trade-other", strategy_version: "autopilot_v4", strategy_id: "strategy-2", trading_date: "2026-07-17", session: "ny_open", instrument: "MES", direction: "long", status: "CLOSED", result_R: 2, closed_at_utc: "2026-07-17T15:00:00.000Z" });
  await persistence.setDocument(C.strategyCatalog, "strategy-1", { strategy_id: "strategy-1", strategy_version: "autopilot_v4", name: "Momentum" });
  await persistence.setDocument(C.deskStrategyVersions, "strategy-1-v1", { version_id: "strategy-1-v1", strategy_version: "autopilot_v4", strategy_id: "strategy-1", version: "1.0.0", config: { cadence: "30m", threshold: 60 } });
  await persistence.setDocument(C.deskStrategyVersions, "strategy-1-v2", { version_id: "strategy-1-v2", strategy_version: "autopilot_v4", strategy_id: "strategy-1", version: "2.0.0", config: { cadence: "15m", threshold: 65 } });
  const performance = await store.getOperationsPerformance({ date: "2026-07-16" });
  const research = await store.getOperationsPerformance({ strategyId: "strategy-1" });
  const strategies = await store.listOperationsStrategies();
  const comparison = await store.compareOperationsStrategyVersions({ strategy_id: "strategy-1", left: "1.0.0", right: "2.0.0" });
  assert.equal(performance.totals.totalR, 1.5);
  assert.equal(performance.totals.winRate, 1);
  assert.equal(research.totals.totalR, 1);
  assert.equal(research.totals.maxDrawdownR, -0.5);
  assert.equal(research.totals.profitFactor, 3);
  assert.deepEqual(research.equity.map((point) => point.cumulativeR), [1.5, 1]);
  assert.deepEqual(research.facets.strategies, ["strategy-1", "strategy-2"]);
  assert.equal(research.dailySeries.length, 2);
  assert.equal(research.attribution.find((group) => group.dimension === "session").items.find((item) => item.label === "asia_open").totalR, 1.5);
  assert.equal(research.attribution.find((group) => group.dimension === "session").items.find((item) => item.label === "ny_open").totalR, -0.5);
  assert.equal(research.dayDrilldowns.find((day) => day.date === "2026-07-16").tradeItems[0].id, "trade-1");
  assert.equal(research.dayDrilldowns.find((day) => day.date === "2026-07-17").drawdownR, -0.5);
  assert.equal(strategies.items.find((item) => item.id === "strategy-2").performance.totalR, 2);
  assert.ok(comparison.changes.some((change) => change.path === "config.cadence"));
  assert.ok(comparison.changes.some((change) => change.path === "config.threshold"));
});
