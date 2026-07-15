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

const DATE = "2026-07-14";
const SESSION = "asia_open";

test("live cursor initializes the exact desired-state identity and locked constants", () => {
  const cursor = initLiveRunCursor({ trading_date: DATE, session: SESSION }, tick("2026-07-13T22:30:00Z"));
  assert.equal(cursor.cursor_id, "livecur__2026-07-14__asia_open");
  assert.equal(liveRunCursorId(DATE, SESSION), cursor.cursor_id);
  assert.equal(cursor.run_id, "front_live_2026-07-14_asia_open");
  assert.equal(cursor.window.master_cutoff_paris, "2026-07-14T00:15:00+02:00");
  assert.equal(cursor.window.open_paris, "2026-07-14T00:30:00+02:00");
  assert.equal(cursor.window.close_paris, "2026-07-14T14:45:00+02:00");
  assert.equal(DEFAULT_LIVE_LEASE_SECONDS, 660);
  assert.equal(LEASE_HARD_CAP_SECONDS, 780);
  assert.equal(CADENCE_SECONDS, 900);
  assert.equal(LIVENESS_STALE_MINUTES, 20);
  assert.equal(LIVE_CURSOR_TTL_DAYS, 90);
  assert.equal(cursor.expires_at_utc, null);
});

test("scenario 1 — transient failure rolls 13:15 forward to 13:30 and records the gap", () => {
  let cursor = readyCursor();
  const first = claimAt(cursor, "2026-07-14T11:15:00Z", "lease-s1-1");
  cursor = first.cursor;
  cursor = failLiveCursor(cursor, failArgs(cursor, "transient"), tick("2026-07-14T11:15:05Z")).cursor;

  const rolled = claimAt(cursor, "2026-07-14T11:30:00Z", "lease-s1-2");

  assert.equal(rolled.result.status, "WORK_CLAIMED");
  assert.equal(rolled.result.claim_handle.checkpoint, "2026-07-14T13:30:00+02:00");
  assert.deepEqual(rolled.result.rolled_forward_from, ["2026-07-14T13:15:00+02:00"]);
  assert.deepEqual(rolled.cursor.gap_ledger.at(-1), {
    from_checkpoint: "2026-07-14T13:15:00+02:00",
    to_checkpoint: "2026-07-14T13:30:00+02:00",
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
  assert.ok(expiryMs - startMs < CADENCE_SECONDS * 1000);

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

test("scenario 7 — sixth transient failure is dead-lettered as transient_exhausted", () => {
  const claimTimes = [
    "2026-07-14T11:15:00Z",
    "2026-07-14T11:15:32Z",
    "2026-07-14T11:16:34Z",
    "2026-07-14T11:18:36Z",
    "2026-07-14T11:22:38Z",
    "2026-07-14T11:27:40Z",
  ];
  const failTimes = [
    "2026-07-14T11:15:01Z",
    "2026-07-14T11:15:33Z",
    "2026-07-14T11:16:35Z",
    "2026-07-14T11:18:37Z",
    "2026-07-14T11:22:39Z",
    "2026-07-14T11:27:41Z",
  ];
  let cursor = readyCursor();
  let failed = null;
  for (let index = 0; index < 6; index += 1) {
    cursor = claimAt(cursor, claimTimes[index], `lease-s7-${index + 1}`).cursor;
    assert.equal(cursor.attempt.attempt_count, index + 1);
    failed = failLiveCursor(cursor, failArgs(cursor, "transient"), tick(failTimes[index]), { jitterSeconds: 0 });
    cursor = failed.cursor;
  }

  assert.equal(cursor.cursor_status, "DEGRADED");
  assert.equal(failed.dead_letters.length, 1);
  assert.equal(failed.dead_letters[0].error.class, "transient_exhausted");
  assert.equal(failed.dead_letters[0].attempt_count, 6);
});

test("scenario 8 — complete is idempotent and last_completed never advances twice", () => {
  const claimed = claimAt(readyCursor(), "2026-07-14T11:15:00Z", "lease-s8-1");
  const args = leaseArgs(claimed.cursor);
  const completed = completeLiveCursor(claimed.cursor, args, tick("2026-07-14T11:16:00Z"), { outputMaterialized: true });
  const replayed = completeLiveCursor(completed.cursor, args, tick("2026-07-14T11:17:00Z"), { outputMaterialized: true });

  assert.equal(completed.result.idempotent, false);
  assert.equal(replayed.result.idempotent, true);
  assert.equal(replayed.cursor.last_completed_checkpoint, "2026-07-14T13:15:00+02:00");
  assert.equal(replayed.events.length, 0);
  const next = claimAt(replayed.cursor, "2026-07-14T11:30:00Z", "lease-s8-2");
  assert.equal(next.result.claim_handle.checkpoint, "2026-07-14T13:30:00+02:00");
  assert.equal(next.cursor.gap_ledger.length, 0, "normal progression after DONE is not a gap");
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

  const notDue = claimLiveCursor(
    initLiveRunCursor({ trading_date: DATE, session: SESSION }, tick("2026-07-13T22:00:00Z")),
    { worker_id: "worker-master" },
    tick("2026-07-13T22:14:59Z"),
  );
  assert.equal(notDue.result.status, "NO_WORK");
  assert.equal(notDue.result.reason, "master_not_due");
});

test("clarification — completing LIVE_MASTER activates prerequisites without consuming the Monitor checkpoint", () => {
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

  assert.equal(masterComplete.cursor.last_completed_checkpoint, null);
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

test("clarification — close checkpoint is inclusive and cursor closes one cadence later", () => {
  const cursor = readyCursor("ny_open");
  const atClose = claimAt(cursor, "2026-07-14T19:45:00Z", "lease-close-1");
  assert.equal(atClose.result.status, "WORK_CLAIMED");
  assert.equal(atClose.result.claim_handle.checkpoint, "2026-07-14T21:45:00+02:00");

  const expired = structuredClone(atClose.cursor);
  expired.attempt.lease_expires_at_utc = "2026-07-14T19:59:59.000Z";
  const closed = claimAt(expired, "2026-07-14T20:00:00Z", "lease-close-2");
  assert.equal(closed.result.status, "NO_WORK");
  assert.equal(closed.result.reason, "market_closed");
  assert.equal(closed.cursor.cursor_status, "CLOSED");
  assert.equal(closed.cursor.closed_at_utc, "2026-07-14T20:00:00.000Z");
  assert.equal(closed.cursor.expires_at_utc, "2026-10-12T20:00:00.000Z");
});

test("phase 4 sweeper closes the cursor and assigns the conventional 90-day TTL", () => {
  const cursor = readyCursor("ny_open");
  const closed = reconcileLiveCursorTick(cursor, tick("2026-07-14T20:00:00Z"));
  assert.equal(closed.cursor.cursor_status, "CLOSED");
  assert.equal(closed.cursor.closed_at_utc, "2026-07-14T20:00:00.000Z");
  assert.equal(closed.cursor.expires_at_utc, "2026-10-12T20:00:00.000Z");
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
    save_target: { tool: master ? "save_master_analysis" : "save_manual_monitor" },
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
  const minute = Math.floor(Number(paris.slice(14, 16)) / 15) * 15;
  const floor = `${paris.slice(0, 13)}:${String(minute).padStart(2, "0")}:00${paris.slice(-6)}`;
  const open = session === "ny_open" ? `${DATE}T15:45:00+02:00` : `${DATE}T00:30:00+02:00`;
  const close = session === "ny_open" ? `${DATE}T21:45:00+02:00` : `${DATE}T14:45:00+02:00`;
  if (Date.parse(floor) <= Date.parse(open)) return open;
  if (Date.parse(floor) >= Date.parse(close)) return close;
  return floor;
}

function tick(utc) {
  return new FixedClock(Date.parse(utc)).now();
}
