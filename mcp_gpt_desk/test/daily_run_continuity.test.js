import assert from "node:assert/strict";
import test from "node:test";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { FixedClock } from "@tv-automation/desk-time";
import {
  buildOrchestratedReplayRunDoc,
  buildReplayStepDoc,
} from "../src/desk-replay-orchestration-algorithms.js";
import { DAILY_PHASES } from "../src/daily-run-model.js";
import { createTestDeskStore } from "./support/test-desk-store.js";

test("continuous replay keeps one run and requires the New York Master at 15:30", async () => {
  const clock = new FixedClock(Date.parse("2026-07-26T12:00:00.000Z"));
  const tick = clock.now();
  const { store, persistence } = createTestDeskStore({ clock });
  const run = buildOrchestratedReplayRunDoc({
    backtest_id: "replay_2026-07-24_full_day_15m_test",
    replay_run_id: "replay_2026-07-24_full_day_15m_test",
    run_id: "replay_2026-07-24_full_day_15m_test",
    strategy_id: "asia_open",
    trading_date: "2026-07-24",
    session: "asia_open",
    run_scope: "full_day",
    phases: DAILY_PHASES,
    pack_id: "2026-07-24_full_day_replay_source",
    pack_build_id: "packbuild-test",
    start_time: "2026-07-24T00:15:00+02:00",
    cutoff_paris: "2026-07-24T00:15:00+02:00",
    end_time: "2026-07-24T22:00:00+02:00",
    cadence: "15m",
    idempotency_key: "daily-continuity-create",
  }, tick);
  const previousStep = buildReplayStepDoc(run, {
    sequence: 61,
    step_type: "MONITOR",
    status: "SIMULATION_UPDATED",
    timestamp_paris: "2026-07-24T15:15:00+02:00",
  }, tick);
  const ready = {
    ...run,
    status: "SIMULATION_UPDATED",
    revision: 0,
    current_replay_time: "2026-07-24T15:15:00+02:00",
    current_step_id: previousStep.step_id,
    linked_master_analysis_id: "master-asia",
    active_replay_thesis_id: "thesis-asia",
    current_phase: "asia_open",
    phase_master_ids: { asia_open: "master-asia" },
  };
  await persistence.setDocument(DESK_COLLECTIONS.deskReplayRuns, ready.backtest_id, ready);
  await persistence.setDocument(DESK_COLLECTIONS.deskReplaySteps, previousStep.step_id, previousStep);

  const result = await store.advanceReplayClock({
    backtest_id: ready.backtest_id,
    step_id: previousStep.step_id,
    expected_revision: 0,
    idempotency_key: "daily-continuity-advance-1530",
    minutes: 15,
  });
  const stored = await persistence.getDocument(DESK_COLLECTIONS.deskReplayRuns, ready.backtest_id);
  const timeline = await persistence.listDocuments(DESK_COLLECTIONS.deskReplayTimeline);

  assert.equal(result.status, "REPLAN_REQUIRED");
  assert.equal(Date.parse(result.current_replay_time), Date.parse("2026-07-24T15:30:00+02:00"));
  assert.equal(stored.run_id, ready.run_id);
  assert.equal(stored.current_phase, "ny_open");
  assert.equal(stored.pending_replan_reason, "DAILY_PHASE_BOUNDARY_NY_MASTER");
  assert.equal(timeline.at(-1).event_type, "PHASE_BOUNDARY_REPLAN_REQUIRED");
});
