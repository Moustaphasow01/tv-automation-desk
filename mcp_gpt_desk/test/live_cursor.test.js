import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FixedClock } from "@tv-automation/desk-time";
import {
  CADENCE_SECONDS,
  DEFAULT_LIVE_LEASE_SECONDS,
  LEASE_HARD_CAP_SECONDS,
  LIVE_CURSOR_TTL_DAYS,
  LIVENESS_STALE_MINUTES,
  armLiveCursorEventMonitor,
  claimLiveCursor,
  completeLiveCursor,
  failLiveCursor,
  heartbeatLiveCursor,
  initLiveRunCursor,
  liveRunCursorId,
  reconcileLiveCursorTick,
} from "../src/live-cursor.js";
import {
  claimNextLiveSchema,
  completeLiveSchema,
  failLiveSchema,
  heartbeatLiveSchema,
} from "../src/schemas.js";
import { ACTIVE_STRATEGY_RUNTIME_VERSIONS } from "../src/strategy-runtime-versioning.js";

const DATE = "2026-07-14";
const SESSION = "asia_open";

test("live cursor initializes the exact desired-state identity and locked constants", () => {
  const cursor = initLiveRunCursor({ trading_date: DATE, session: SESSION }, tick("2026-07-13T22:30:00Z"));
  assert.equal(cursor.cursor_id, "livecur__2026-07-14");
  assert.equal(liveRunCursorId(DATE, SESSION), cursor.cursor_id);
  assert.equal(cursor.run_id, "front_live_2026-07-14");
  assert.equal(cursor.run_scope, "full_day");
  assert.equal(cursor.window.master_cutoff_paris, "2026-07-14T00:15:00+02:00");
  assert.equal(cursor.window.open_paris, "2026-07-14T00:30:00+02:00");
  assert.equal(cursor.window.ny_master_cutoff_paris, "2026-07-14T15:30:00+02:00");
  assert.equal(cursor.window.close_paris, "2026-07-14T22:00:00+02:00");
  assert.equal(DEFAULT_LIVE_LEASE_SECONDS, 660);
  assert.equal(LEASE_HARD_CAP_SECONDS, 780);
  assert.equal(CADENCE_SECONDS, 900);
  assert.equal(cursor.cadence_minutes, 15);
  assert.equal(LIVENESS_STALE_MINUTES, 20);
  assert.equal(LIVE_CURSOR_TTL_DAYS, 90);
  assert.equal(cursor.expires_at_utc, null);
});

test("LIVE claim preserves the bundle-ready timestamp prepared before the worker lease", () => {
  const cursor = {
    ...readyCursor(),
    attempt: {
      workflow: "LIVE_M15_MONITOR",
      phase: "asia_open",
      checkpoint: "2026-07-14T13:15:00+02:00",
      bundle_id: "live_m15_monitor__2026-07-14T13:15:00+02:00",
      status: "PENDING",
      worker_id: null,
      lease_token: null,
      started_at_utc: null,
      lease_expires_at_utc: null,
      attempt_count: 0,
      available_at_utc: "2026-07-14T11:15:05.000Z",
      bundle_ready_at_utc: "2026-07-14T11:15:05.000Z",
      last_error: null,
    },
  };

  const claimed = claimAt(cursor, "2026-07-14T11:15:30Z", "lease-prewarmed");

  assert.equal(claimed.cursor.attempt.bundle_ready_at_utc, "2026-07-14T11:15:05.000Z");
  assert.equal(claimed.cursor.attempt.started_at_utc, "2026-07-14T11:15:30.000Z");
});

test("scenario 1 — transient failure rolls 13:15 forward to 13:30 and records the gap", () => {
  let cursor = readyCursor();
  const first = claimAt(cursor, "2026-07-14T11:15:00Z", "lease-s1-1");
  cursor = first.cursor;
  cursor = failLiveCursor(cursor, failArgs(cursor, "transient"), tick("2026-07-14T11:15:05Z")).cursor;

  const rolled = claimAt(cursor, "2026-07-14T11:30:00Z", "lease-s1-2");

  assert.equal(rolled.result.status, "WORK_CLAIMED");
  assert.equal(rolled.result.claim_handle.checkpoint, "2026-07-14T13:30:00+02:00");
  assert.deepEqual(rolled.result.rolled_forward_from, [
    "2026-07-14T13:15:00+02:00",
  ]);
  assert.deepEqual(rolled.cursor.gap_ledger.at(-1), {
    from_checkpoint: "2026-07-14T13:15:00+02:00",
    to_checkpoint: "2026-07-14T13:30:00+02:00",
    skipped_checkpoints: [
      "2026-07-14T13:15:00+02:00",
    ],
    skipped_checkpoint_count: 1,
    reason: "stale_checkpoint_rolled_forward",
    at_utc: "2026-07-14T11:30:00.000Z",
  });
});

test("scenario 2 — same target may retry, but advancing target never replays the stale checkpoint", () => {
  let cursor = claimAt(readyCursor(), "2026-07-14T11:15:00Z", "lease-s2-1").cursor;
  cursor = failLiveCursor(cursor, failArgs(cursor, "transient"), tick("2026-07-14T11:15:01Z")).cursor;
  const sameTarget = claimAt(cursor, "2026-07-14T11:16:00Z", "lease-s2-2");
  assert.equal(sameTarget.result.claim_handle.checkpoint, "2026-07-14T13:15:00+02:00");
  assert.equal(sameTarget.cursor.attempt.attempt_count, 2);

  cursor = failLiveCursor(sameTarget.cursor, failArgs(sameTarget.cursor, "transient"), tick("2026-07-14T11:16:01Z")).cursor;
  const advanced = claimAt(cursor, "2026-07-14T11:30:00Z", "lease-s2-3");
  assert.equal(advanced.result.claim_handle.checkpoint, "2026-07-14T13:30:00+02:00");
  assert.equal(advanced.cursor.attempt.attempt_count, 1, "attempt budget is scoped to the new checkpoint");
});

test("scenario 3 — claim freshness abandons an older failed attempt", () => {
  let cursor = claimAt(readyCursor(), "2026-07-14T11:15:00Z", "lease-s3-1").cursor;
  cursor = failLiveCursor(cursor, failArgs(cursor, "transient"), tick("2026-07-14T11:15:01Z")).cursor;

  const claim = claimAt(cursor, "2026-07-14T11:30:00Z", "lease-s3-2");

  assert.notEqual(claim.cursor.attempt.checkpoint, "2026-07-14T13:15:00+02:00");
  assert.equal(claim.cursor.attempt.checkpoint, claim.cursor.target_checkpoint);
  assert.equal(claim.events.some((event) => event.event_type === "CURSOR_ROLLED_FORWARD"), true);
});

test("latest-wins claims 16:45 and audits the unmaterialized 16:30 Monitor", () => {
  const cursor = {
    ...readyCursor(),
    last_completed_checkpoint: "2026-07-14T16:15:00+02:00",
    attempt: {
      workflow: "LIVE_M15_MONITOR",
      phase: "ny_open",
      checkpoint: "2026-07-14T16:30:00+02:00",
      bundle_id: "monitor-1630",
      status: "FAILED",
      worker_id: null,
      lease_token: null,
      started_at_utc: null,
      lease_expires_at_utc: null,
      attempt_count: 1,
      available_at_utc: "2026-07-14T14:30:00.000Z",
      last_error: null,
    },
  };

  const claimed = claimAt(cursor, "2026-07-14T14:45:00Z", "lease-latest-wins");

  assert.equal(claimed.result.status, "WORK_CLAIMED");
  assert.equal(claimed.result.claim_handle.session, "ny_open");
  assert.equal(claimed.result.claim_handle.phase, "ny_open");
  assert.equal(claimed.result.claim_handle.checkpoint, "2026-07-14T16:45:00+02:00");
  assert.deepEqual(claimed.result.rolled_forward_from, [
    "2026-07-14T16:30:00+02:00",
  ]);
  assert.equal(claimed.result.catchup_context.latest_wins, true);
  assert.deepEqual(claimed.result.catchup_context.skipped_checkpoints, [
    "2026-07-14T16:30:00+02:00",
  ]);
  assert.deepEqual(claimed.result.catchup_context.analysis_window, {
    from_paris: "2026-07-14T16:15:00+02:00",
    to_paris: "2026-07-14T16:45:00+02:00",
  });
  assert.equal(
    claimed.events.find((event) => event.event_type === "CURSOR_ROLLED_FORWARD")?.details.policy,
    "LATEST_SETTLED_CLOSED_M15",
  );
});

test("Asia to New York transition keeps claim, bundle and save scope aligned", () => {
  const cursor = readyCursor();
  const checkpoint = "2026-07-14T19:15:00+02:00";
  const baseWork = preparedWork(checkpoint, "LIVE_M15_MONITOR");
  const claimed = claimLiveCursor(cursor, {
    worker_id: "worker-live-ny",
    lease_token: "lease-live-ny-1915",
    work: {
      ...baseWork,
      phase: "ny_open",
      bundle: {
        ...baseWork.bundle,
        bundle_args: {
          ...baseWork.bundle.bundle_args,
          session: "ny_open",
        },
      },
      save_target: {
        ...baseWork.save_target,
        session: "ny_open",
      },
    },
  }, tick("2026-07-14T17:15:00Z"));

  assert.equal(cursor.session, "asia_open");
  assert.equal(claimed.result.status, "WORK_CLAIMED");
  assert.equal(claimed.result.claim_handle.session, "ny_open");
  assert.equal(claimed.result.claim_handle.phase, "ny_open");
  assert.equal(claimed.result.claim_handle.checkpoint, checkpoint);
  assert.equal(claimed.cursor.current_phase, "ny_open");
});

test("claim rejects prepared LIVE work whose phase disagrees with the current checkpoint", () => {
  const cursor = readyCursor();
  const checkpoint = "2026-07-14T19:15:00+02:00";
  const work = preparedWork(checkpoint, "LIVE_M15_MONITOR");

  assert.throws(
    () => claimLiveCursor(cursor, {
      worker_id: "worker-live-bad-scope",
      lease_token: "lease-live-bad-scope",
      work: {
        ...work,
        phase: "asia_open",
        bundle: {
          ...work.bundle,
          bundle_args: {
            ...work.bundle.bundle_args,
            session: "asia_open",
          },
        },
        save_target: {
          ...work.save_target,
          session: "asia_open",
        },
      },
    }, tick("2026-07-14T17:15:00Z")),
    (error) => error?.code === "LIVE_WORK_PHASE_MISMATCH",
  );
});

test("claim keeps historical LIVE work readable but refuses to lease it", () => {
  const cursor = readyCursor();
  const checkpoint = "2026-07-14T13:15:00+02:00";
  const work = preparedWork(checkpoint, "LIVE_M15_MONITOR");

  assert.throws(
    () => claimLiveCursor(cursor, {
      worker_id: "worker-live-historical",
      lease_token: "lease-live-historical",
      work: {
        ...work,
        contract_context: {
          ...work.contract_context,
          schema_version: "2.0.0",
        },
      },
    }, tick("2026-07-14T11:15:00Z")),
    (error) => error?.code === "STRATEGY_CONTRACT_VERSION_MISMATCH",
  );
});

test("scenario 4 — a valid stale-checkpoint lease is allowed to finish without preemption", () => {
  const leased = claimAt(readyCursor(), "2026-07-14T11:18:00Z", "lease-s4-1", 780);

  const concurrent = claimAt(leased.cursor, "2026-07-14T11:30:00Z", "lease-s4-2");

  assert.equal(concurrent.result.status, "NO_WORK");
  assert.equal(concurrent.result.reason, "in_progress");
  assert.equal(concurrent.cursor.attempt.checkpoint, "2026-07-14T13:15:00+02:00");
  assert.equal(concurrent.cursor.gap_ledger.length, 0);
});

test("scenario 5 — heartbeat at the hard cap force-expires the lease into RETRY", () => {
  const started = claimAt(readyCursor(), "2026-07-14T11:15:00Z", "lease-s5-1", 840);
  const startMs = Date.parse(started.cursor.attempt.started_at_utc);
  const expiryMs = Date.parse(started.cursor.attempt.lease_expires_at_utc);
  assert.equal(expiryMs - startMs, LEASE_HARD_CAP_SECONDS * 1000);
  assert.ok(expiryMs - startMs < CADENCE_SECONDS * 1000, "GPT lease remains bounded inside one scheduled M15 interval");

  const capped = heartbeatLiveCursor(
    started.cursor,
    leaseArgs(started.cursor),
    tick("2026-07-14T11:28:00Z"),
  );

  assert.equal(capped.result.status, "LEASE_CAPPED");
  assert.equal(capped.cursor.cursor_status, "RETRY");
  assert.equal(capped.cursor.attempt.status, "FAILED");
  assert.equal(capped.cursor.attempt.lease_token, null);
  assert.equal(capped.events[0].event_type, "CURSOR_LEASE_CAPPED");
});

test("scenario 6 — deterministic failure dead-letters once and the next checkpoint continues", () => {
  let cursor = claimAt(readyCursor(), "2026-07-14T11:15:00Z", "lease-s6-1").cursor;
  const failed = failLiveCursor(cursor, failArgs(cursor, "deterministic"), tick("2026-07-14T11:15:05Z"));
  cursor = failed.cursor;

  assert.equal(cursor.cursor_status, "DEGRADED");
  assert.equal(failed.dead_letters.length, 1);
  assert.equal(failed.dead_letters[0].error.class, "deterministic");
  assert.equal(failed.events.some((event) => event.event_type === "CURSOR_RETRY_SCHEDULED"), false);

  const next = claimAt(cursor, "2026-07-14T11:30:00Z", "lease-s6-2");
  assert.equal(next.result.status, "WORK_CLAIMED");
  assert.equal(next.result.claim_handle.checkpoint, "2026-07-14T13:30:00+02:00");
});

test("scenario 7 — a sixth transient failure is dead-lettered as transient_exhausted", () => {
  let cursor = claimAt(readyCursor(), "2026-07-14T11:15:00Z", "lease-s7-6").cursor;
  cursor.attempt.attempt_count = 6;
  const failed = failLiveCursor(
    cursor,
    failArgs(cursor, "transient"),
    tick("2026-07-14T11:15:01Z"),
    { jitterSeconds: 0 },
  );
  cursor = failed.cursor;

  assert.equal(cursor.cursor_status, "DEGRADED");
  assert.equal(failed.dead_letters.length, 1);
  assert.equal(failed.dead_letters[0].error.class, "transient_exhausted");
  assert.equal(failed.dead_letters[0].attempt_count, 6);
});

test("a degraded LIVE Master is rearmed exactly once after a LIVE prompt upgrade", () => {
  const initial = initLiveRunCursor({ trading_date: DATE, session: SESSION }, tick("2026-07-13T22:30:00Z"));
  const checkpoint = "2026-07-14T00:15:00+02:00";
  const first = claimLiveCursor(initial, {
    worker_id: "worker-master-recovery",
    lease_token: "lease-master-recovery-v1",
    recovery_prompt_version: "1.3.0",
    work: { ...preparedWork(checkpoint, "LIVE_MASTER"), prompt_version: "1.3.0" },
  }, tick("2026-07-14T11:15:00Z"));
  const degraded = failLiveCursor(
    first.cursor,
    failArgs(first.cursor, "deterministic"),
    tick("2026-07-14T11:15:05Z"),
  ).cursor;

  const sameVersion = claimLiveCursor(
    degraded,
    { worker_id: "worker-master-recovery", recovery_prompt_version: "1.3.0" },
    tick("2026-07-14T11:30:00Z"),
  );
  assert.equal(sameVersion.result.status, "NO_WORK");

  const upgradedPreview = claimLiveCursor(
    degraded,
    { worker_id: "worker-master-recovery", recovery_prompt_version: "1.4.0" },
    tick("2026-07-14T11:30:00Z"),
  );
  assert.equal(upgradedPreview.result.status, "WORK_DUE");
  assert.equal(upgradedPreview.result.workflow, "LIVE_MASTER");

  const recovered = claimLiveCursor(degraded, {
    worker_id: "worker-master-recovery",
    lease_token: "lease-master-recovery-v2",
    recovery_prompt_version: "1.4.0",
    work: { ...preparedWork(checkpoint, "LIVE_MASTER"), prompt_version: "1.4.0" },
  }, tick("2026-07-14T11:30:00Z"));
  assert.equal(recovered.result.status, "WORK_CLAIMED");
  assert.equal(recovered.result.recovery_reason, "live_prompt_version_upgraded");
  assert.equal(recovered.cursor.attempt.prompt_version, "1.4.0");
  assert.equal(recovered.cursor.attempt.attempt_count, 2);
});

test("scenario 8 — complete is idempotent and last_completed never advances twice", () => {
  const claimed = claimAt(readyCursor(), "2026-07-14T11:15:00Z", "lease-s8-1");
  const args = leaseArgs(claimed.cursor);
  const completed = completeLiveCursor(claimed.cursor, {
    ...args,
    telemetry: {
      provider: "openai",
      model: "gpt-5",
      input_tokens: 900,
      output_tokens: 180,
      cost_usd: 0.031,
    },
  }, tick("2026-07-14T11:16:00Z"), { outputMaterialized: true });
  const replayed = completeLiveCursor(completed.cursor, args, tick("2026-07-14T11:17:00Z"), { outputMaterialized: true });

  assert.equal(completed.result.idempotent, false);
  assert.equal(completed.cursor.attempt.gpt_telemetry.total_tokens, 1080);
  assert.equal(completed.cursor.attempt.gpt_telemetry.cost_usd, 0.031);
  assert.equal(completed.events[0].details.telemetry.model, "gpt-5");
  assert.equal(replayed.result.idempotent, true);
  assert.equal(replayed.cursor.last_completed_checkpoint, "2026-07-14T13:15:00+02:00");
  assert.equal(replayed.events.length, 0);
  const next = claimAt(replayed.cursor, "2026-07-14T11:30:00Z", "lease-s8-2");
  assert.equal(next.result.claim_handle.checkpoint, "2026-07-14T13:30:00+02:00");
  assert.equal(next.cursor.gap_ledger.length, 0, "normal progression after DONE is not a gap");
});

test("critical M1 event arms an exact off-grid Monitor without moving the M15 schedule", () => {
  const checkpoint = "2026-07-14T13:22:00+02:00";
  const armed = armLiveCursorEventMonitor({
    ...readyCursor(),
    last_completed_checkpoint: "2026-07-14T13:15:00+02:00",
  }, {
    checkpoint,
    reason: "PAPER_SETUP_TRIGGERED",
    event_types: ["PAPER_SETUP_TRIGGERED"],
  }, tick("2026-07-14T11:22:00Z"));

  assert.equal(armed.result.status, "EVENT_MONITOR_ARMED");
  assert.equal(armed.cursor.event_monitor_checkpoint, checkpoint);
  assert.equal(armed.events[0].event_type, "CURSOR_EVENT_MONITOR_REQUESTED");

  const claimed = claimLiveCursor(armed.cursor, {
    worker_id: "worker-event-monitor",
    lease_token: "lease-event-monitor",
    work: preparedWork(checkpoint, "LIVE_M15_MONITOR"),
  }, tick("2026-07-14T11:22:05Z"));

  assert.equal(claimed.result.claim_handle.checkpoint, checkpoint);
  assert.deepEqual(claimed.result.event_monitor_context, {
    trigger: "CRITICAL_ENGINE_EVENT",
    checkpoint,
    reason: "PAPER_SETUP_TRIGGERED",
    event_types: ["PAPER_SETUP_TRIGGERED"],
  });

  const completed = completeLiveCursor(
    claimed.cursor,
    leaseArgs(claimed.cursor),
    tick("2026-07-14T11:23:00Z"),
    { outputMaterialized: true },
  );
  assert.equal(completed.cursor.event_monitor_checkpoint, null);

  const scheduled = claimLiveCursor(
    completed.cursor,
    { worker_id: "worker-event-monitor" },
    tick("2026-07-14T11:30:00Z"),
  );
  assert.equal(scheduled.result.status, "WORK_DUE");
  assert.equal(scheduled.result.checkpoint, "2026-07-14T13:30:00+02:00");
  assert.equal(scheduled.result.event_monitor_context, null);
});

test("clarification — missing Master or thesis is served as LIVE_MASTER instead of blocking", () => {
  const cursor = initLiveRunCursor({ trading_date: DATE, session: SESSION }, tick("2026-07-13T22:30:00Z"));
  const target = "2026-07-14T00:15:00+02:00";
  const claimed = claimLiveCursor(cursor, {
    worker_id: "worker-master",
    lease_token: "lease-master-1",
    work: preparedWork(target, "LIVE_MASTER"),
  }, tick("2026-07-14T11:15:00Z"));

  assert.equal(claimed.result.status, "WORK_CLAIMED");
  assert.equal(claimed.cursor.attempt.workflow, "LIVE_MASTER");
  assert.equal(claimed.result.claim_handle.workflow, "LIVE_MASTER");
  assert.equal(claimed.result.claim_handle.checkpoint, target);
  assert.equal(claimed.result.bundle.bundle_tool, "get_master_cutoff_bundle");
  assert.equal(claimed.cursor.last_claimed_at_utc, "2026-07-14T11:15:00.000Z");
  assert.equal(claimed.cursor.last_claimed_checkpoint, target);
  assert.equal(claimed.cursor.last_claimed_workflow, "LIVE_MASTER");
  assert.equal(claimed.cursor.last_claimed_worker_id, "worker-master");

  const notDue = claimLiveCursor(
    initLiveRunCursor({ trading_date: DATE, session: SESSION }, tick("2026-07-13T22:00:00Z")),
    { worker_id: "worker-master" },
    tick("2026-07-13T22:14:59Z"),
  );
  assert.equal(notDue.result.status, "NO_WORK");
  assert.equal(notDue.result.reason, "master_not_due");
});

test("clarification — completing LIVE_MASTER activates prerequisites and consumes its own checkpoint", () => {
  const initial = initLiveRunCursor({ trading_date: DATE, session: SESSION }, tick("2026-07-13T22:30:00Z"));
  const checkpoint = "2026-07-14T00:15:00+02:00";
  const masterClaim = claimLiveCursor(initial, {
    worker_id: "worker-master",
    lease_token: "lease-master-2",
    work: preparedWork(checkpoint, "LIVE_MASTER"),
  }, tick("2026-07-14T11:15:00Z"));
  const masterComplete = completeLiveCursor(
    masterClaim.cursor,
    leaseArgs(masterClaim.cursor),
    tick("2026-07-14T11:16:00Z"),
    {
      outputMaterialized: true,
      materializedMasterId: "master-materialized",
      materializedThesisId: "thesis-materialized",
    },
  );

  assert.equal(masterComplete.cursor.last_completed_checkpoint, checkpoint);
  assert.equal(masterComplete.cursor.master_state, "READY");
  assert.equal(masterComplete.cursor.thesis_state, "ACTIVE");
  const monitorClaim = claimLiveCursor(masterComplete.cursor, {
    worker_id: "worker-monitor",
    lease_token: "lease-monitor-after-master",
    work: preparedWork("2026-07-14T13:15:00+02:00", "LIVE_M15_MONITOR"),
  }, tick("2026-07-14T11:16:01Z"));
  assert.equal(monitorClaim.cursor.attempt.workflow, "LIVE_M15_MONITOR");
  assert.equal(monitorClaim.result.claim_handle.checkpoint, "2026-07-14T13:15:00+02:00");
});

test("LIVE Monitor REPLAN_FULL forces a new Master at the same cutoff before cadence resumes", () => {
  const monitorClaim = claimAt(
    readyCursor(),
    "2026-07-14T11:45:00Z",
    "lease-monitor-replan",
  );
  const monitorComplete = completeLiveCursor(
    monitorClaim.cursor,
    leaseArgs(monitorClaim.cursor),
    tick("2026-07-14T11:46:00Z"),
    {
      outputMaterialized: true,
      monitorAction: "REPLAN_FULL",
    },
  );

  assert.equal(monitorComplete.result.next_workflow, "LIVE_MASTER");
  assert.equal(monitorComplete.cursor.cursor_status, "DUE");
  assert.equal(monitorComplete.cursor.replan_checkpoint, "2026-07-14T13:45:00+02:00");
  assert.equal(monitorComplete.cursor.replan_action, "REPLAN_FULL");
  assert.equal(monitorComplete.cursor.master_state, "REPLAN_REQUIRED");
  assert.equal(monitorComplete.cursor.thesis_state, "REPLAN_REQUIRED");

  const masterPreview = claimLiveCursor(
    monitorComplete.cursor,
    { worker_id: "worker-replan-master" },
    tick("2026-07-14T11:46:01Z"),
  );
  assert.equal(masterPreview.result.status, "WORK_DUE");
  assert.equal(masterPreview.result.workflow, "LIVE_MASTER");
  assert.equal(masterPreview.result.phase, "asia_open");
  assert.equal(masterPreview.result.checkpoint, "2026-07-14T13:45:00+02:00");

  const masterClaim = claimLiveCursor(monitorComplete.cursor, {
    worker_id: "worker-replan-master",
    lease_token: "lease-replan-master",
    work: preparedWork("2026-07-14T13:45:00+02:00", "LIVE_MASTER"),
  }, tick("2026-07-14T11:46:01Z"));
  assert.equal(masterClaim.cursor.attempt.attempt_count, 1);

  const masterComplete = completeLiveCursor(
    masterClaim.cursor,
    leaseArgs(masterClaim.cursor),
    tick("2026-07-14T11:47:00Z"),
    {
      outputMaterialized: true,
      materializedMasterId: "master-replanned-1345",
      materializedThesisId: "thesis-replanned-1345",
    },
  );
  assert.equal(masterComplete.result.idempotent, false);
  assert.equal(masterComplete.cursor.replan_checkpoint, null);
  assert.equal(masterComplete.cursor.replan_action, null);
  assert.equal(masterComplete.cursor.phase_master_ids.asia_open, "master-replanned-1345");
  assert.equal(masterComplete.cursor.phase_thesis_ids.asia_open, "thesis-replanned-1345");

  const nextPreview = claimLiveCursor(
    masterComplete.cursor,
    { worker_id: "worker-after-replan" },
    tick("2026-07-14T12:00:00Z"),
  );
  assert.equal(nextPreview.result.status, "WORK_DUE");
  assert.equal(nextPreview.result.workflow, "LIVE_M15_MONITOR");
  assert.equal(nextPreview.result.checkpoint, "2026-07-14T14:00:00+02:00");
});

test("LIVE Monitor honors a deterministic future replan checkpoint", () => {
  const monitorClaim = claimAt(
    readyCursor(),
    "2026-07-14T11:45:00Z",
    "lease-monitor-delayed-replan",
  );
  const monitorComplete = completeLiveCursor(
    monitorClaim.cursor,
    leaseArgs(monitorClaim.cursor),
    tick("2026-07-14T11:46:00Z"),
    {
      outputMaterialized: true,
      monitorAction: "INVALIDATE_THESIS",
      monitorReplanCheckpoint: "2026-07-14T14:00:00+02:00",
    },
  );

  assert.equal(monitorComplete.cursor.replan_checkpoint, "2026-07-14T14:00:00+02:00");
  const notDue = claimLiveCursor(
    monitorComplete.cursor,
    { worker_id: "worker-delayed-replan" },
    tick("2026-07-14T11:46:01Z"),
  );
  assert.equal(notDue.result.status, "NO_WORK");
  assert.equal(notDue.result.reason, "master_not_due");

  const due = claimLiveCursor(
    monitorComplete.cursor,
    { worker_id: "worker-delayed-replan" },
    tick("2026-07-14T12:00:01Z"),
  );
  assert.equal(due.result.status, "WORK_DUE");
  assert.equal(due.result.workflow, "LIVE_MASTER");
  assert.equal(due.result.checkpoint, "2026-07-14T14:00:00+02:00");
});

test("a pending replan remains priority even when the current target crossed into New York", () => {
  const cursor = {
    ...readyCursor(),
    last_completed_checkpoint: "2026-07-14T15:15:00+02:00",
    replan_checkpoint: "2026-07-14T15:15:00+02:00",
    replan_action: "REPLAN_REQUIRED",
    master_state: "REPLAN_REQUIRED",
    thesis_state: "REPLAN_REQUIRED",
  };
  const preview = claimLiveCursor(
    cursor,
    { worker_id: "worker-delayed-replan" },
    tick("2026-07-14T13:45:00Z"),
  );
  assert.equal(preview.result.status, "WORK_DUE");
  assert.equal(preview.result.workflow, "LIVE_MASTER");
  assert.equal(preview.result.phase, "asia_open");
  assert.equal(preview.result.checkpoint, "2026-07-14T15:15:00+02:00");
});

test("daily cursor requires the New York Master at 15:30 without changing run identity", () => {
  const cursor = readyCursor();
  delete cursor.phase_master_ids.ny_open;
  delete cursor.phase_thesis_ids.ny_open;
  cursor.last_completed_checkpoint = "2026-07-14T15:15:00+02:00";
  const preview = claimLiveCursor(cursor, { worker_id: "worker-ny" }, tick("2026-07-14T13:30:00Z"));
  assert.equal(preview.result.status, "WORK_DUE");
  assert.equal(preview.result.workflow, "LIVE_MASTER");
  assert.equal(preview.result.phase, "ny_open");
  assert.equal(preview.result.checkpoint, "2026-07-14T15:30:00+02:00");
  assert.equal(preview.result.run_id, "front_live_2026-07-14");
  assert.equal(preview.cursor.cursor_id, "livecur__2026-07-14");
});

test("clarification — close checkpoint is inclusive and cursor closes one cadence later", () => {
  const cursor = readyCursor("ny_open");
  const atClose = claimAt(cursor, "2026-07-14T20:00:00Z", "lease-close-1");
  assert.equal(atClose.result.status, "WORK_CLAIMED");
  assert.equal(atClose.result.claim_handle.checkpoint, "2026-07-14T22:00:00+02:00");

  const expired = structuredClone(atClose.cursor);
  expired.attempt.lease_expires_at_utc = "2026-07-14T20:14:59.000Z";
  const closed = claimAt(expired, "2026-07-14T20:15:00Z", "lease-close-2");
  assert.equal(closed.result.status, "NO_WORK");
  assert.equal(closed.result.reason, "market_closed");
  assert.equal(closed.cursor.cursor_status, "CLOSED");
  assert.equal(closed.cursor.closed_at_utc, "2026-07-14T20:15:00.000Z");
  assert.equal(closed.cursor.expires_at_utc, "2026-10-12T20:15:00.000Z");
});

test("phase 4 sweeper closes the cursor and assigns the conventional 90-day TTL", () => {
  const cursor = readyCursor("ny_open");
  const closed = reconcileLiveCursorTick(cursor, tick("2026-07-14T20:15:00Z"));
  assert.equal(closed.cursor.cursor_status, "CLOSED");
  assert.equal(closed.cursor.closed_at_utc, "2026-07-14T20:15:00.000Z");
  assert.equal(closed.cursor.expires_at_utc, "2026-10-12T20:15:00.000Z");
  assert.equal(closed.events.at(-1).event_type, "CURSOR_CLOSED");
});

test("phase 4 sweeper backfills TTL on a pre-TTL CLOSED cursor without a second close event", () => {
  const cursor = {
    ...readyCursor("ny_open"),
    cursor_status: "CLOSED",
    closed_at_utc: "2026-07-14T20:00:00.000Z",
  };
  delete cursor.expires_at_utc;
  const reconciled = reconcileLiveCursorTick(cursor, tick("2026-07-15T08:00:00Z"));
  assert.equal(reconciled.cursor.expires_at_utc, "2026-10-12T20:00:00.000Z");
  assert.deepEqual(reconciled.events, []);
});

test("phase 1 Zod schemas are strict and preserve locked lease defaults", () => {
  const claim = claimNextLiveSchema.parse({ worker_id: "worker-1", session: "asia_open", trading_date: DATE });
  assert.equal(claim.lease_seconds, 660);
  assert.throws(() => claimNextLiveSchema.parse({ ...claim, lease_seconds: 841 }));
  assert.throws(() => claimNextLiveSchema.parse({ ...claim, unexpected: true }));

  const lease = {
    worker_id: "worker-1",
    cursor_id: liveRunCursorId(DATE, SESSION),
    checkpoint: "2026-07-14T13:15:00+02:00",
    lease_token: "lease-token-1",
  };
  assert.deepEqual(heartbeatLiveSchema.parse(lease), lease);
  assert.deepEqual(completeLiveSchema.parse(lease), lease);
  assert.equal(failLiveSchema.parse({
    ...lease,
    error_code: "MCP_TIMEOUT",
    error_message: "timeout",
    error_class: "transient",
  }).error_class, "transient");
  assert.throws(() => heartbeatLiveSchema.parse({ ...lease, lease_seconds: 660 }));
});

test("phase 1 PostgreSQL document and JSON indexes are declared", async () => {
  const schemaUrl = new URL("../../infra/postgres/init/001_schema.sql", import.meta.url);
  const schema = await readFile(schemaUrl, "utf8");
  assert.match(schema, /PRIMARY KEY \(collection, document_id\)/);
  assert.match(schema, /USING gin \(data\)/);
});

function readyCursor(session = SESSION) {
  const cursor = initLiveRunCursor({ trading_date: DATE, session }, tick("2026-07-13T22:30:00Z"));
  return {
    ...cursor,
    master_state: "READY",
    master_id: "master-2026-07-14",
    thesis_state: "ACTIVE",
    thesis_id: "thesis-2026-07-14",
    phase_master_ids: {
      asia_open: "master-2026-07-14-asia",
      ny_open: "master-2026-07-14-ny",
    },
    phase_thesis_ids: {
      asia_open: "thesis-2026-07-14-asia",
      ny_open: "thesis-2026-07-14-ny",
    },
  };
}

function claimAt(cursor, utc, leaseToken, leaseSeconds = 660) {
  const now = tick(utc);
  const target = targetAt(cursor.session, utc);
  return claimLiveCursor(cursor, {
    worker_id: "worker-live-1",
    lease_token: leaseToken,
    lease_seconds: leaseSeconds,
    work: preparedWork(target, "LIVE_M15_MONITOR"),
  }, now);
}

function preparedWork(checkpoint, workflow) {
  const master = workflow === "LIVE_MASTER";
  const contractName = master
    ? "DeskMasterAnalysisContract"
    : "DeskHourlyThesisMonitorContract";
  const schemaVersion = master
    ? ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract
    : ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract;
  return {
    workflow,
    checkpoint,
    master_id: master ? null : "master-2026-07-14",
    thesis_id: master ? null : "thesis-2026-07-14",
    data_quality: "ready",
    bundle: {
      bundle_id: `${workflow.toLowerCase()}__${checkpoint}`,
      bundle_tool: master ? "get_master_cutoff_bundle" : "get_manual_monitor_bundle",
      bundle_args: { checkpoint },
    },
    execution_prompt: `Execute ${workflow} at ${checkpoint}`,
    prompt_hash: `hash-${workflow}-${checkpoint}`,
    contract_context: {
      contract_name: contractName,
      schema_version: schemaVersion,
      contract_hash: `contract-hash-${workflow}`,
      execution_policy: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy },
      execution_plan: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan },
      monitor_command: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command },
      condition_catalog: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog },
    },
    runtime_versions: ACTIVE_STRATEGY_RUNTIME_VERSIONS,
    save_target: {
      tool: master ? "save_master_analysis" : "save_manual_monitor",
      contract_name: contractName,
      schema_version: schemaVersion,
      execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
      execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
      monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
      condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
      deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
      condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
    },
  };
}

function leaseArgs(cursor) {
  return {
    worker_id: cursor.attempt.worker_id,
    cursor_id: cursor.cursor_id,
    checkpoint: cursor.attempt.checkpoint,
    lease_token: cursor.attempt.lease_token,
  };
}

function failArgs(cursor, errorClass) {
  return {
    ...leaseArgs(cursor),
    error_code: errorClass === "deterministic" ? "INVALID_OUTPUT" : "MCP_TIMEOUT",
    error_message: errorClass === "deterministic" ? "invalid output" : "temporary timeout",
    error_class: errorClass,
  };
}

function targetAt(session, utc) {
  const paris = tick(utc).paris;
  const minute = Math.floor(Number(paris.slice(14, 16)) / 5) * 5;
  const floor = `${paris.slice(0, 13)}:${String(minute).padStart(2, "0")}:00${paris.slice(-6)}`;
  const open = `${DATE}T00:30:00+02:00`;
  const close = `${DATE}T22:00:00+02:00`;
  if (Date.parse(floor) <= Date.parse(open)) return open;
  if (Date.parse(floor) >= Date.parse(close)) return close;
  return floor;
}

function tick(utc) {
  return new FixedClock(Date.parse(utc)).now();
}
