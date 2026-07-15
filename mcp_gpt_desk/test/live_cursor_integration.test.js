import assert from "node:assert/strict";
import test from "node:test";
import { FixedClock } from "@tv-automation/desk-time";
import {
  claimLiveCursor,
  failLiveCursor,
  initLiveRunCursor,
  reconcileLiveCursorTick,
  shadowLiveCursorBundle,
} from "../src/live-cursor.js";
import {
  claimNextReplaySchema,
  heartbeatReplaySchema,
} from "../src/schemas.js";
import { callDeskTool, createDeskToolRegistry } from "../src/tools.js";

const DATE = "2026-07-14";

test("scenario 9 — a declared non-active trading date returns trading_date_mismatch", () => {
  const cursor = initLiveRunCursor({ trading_date: DATE, session: "asia_open" }, tick("2026-07-14T11:00:00Z"));
  const result = claimLiveCursor(cursor, { worker_id: "worker-live" }, tick("2026-07-15T11:00:00Z"));
  assert.equal(result.result.status, "NO_WORK");
  assert.equal(result.result.reason, "trading_date_mismatch");
});

test("scenario 11 — a stale due cursor emits one liveness alert", () => {
  const cursor = {
    ...readyCursor(),
    updated_at_utc: "2026-07-14T10:39:59.000Z",
  };
  const result = reconcileLiveCursorTick(cursor, tick("2026-07-14T11:00:00Z"));
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].event_type, "CURSOR_LIVENESS_ALERT");
  assert.equal(result.events[0].details.liveness_stale_minutes, 20);
});

test("shadow preparation mirrors LIVE work without acquiring a cursor lease", () => {
  const cursor = initLiveRunCursor({ trading_date: DATE, session: "ny_open" }, tick("2026-07-14T13:30:00Z"));
  const shadow = shadowLiveCursorBundle(cursor, {
    workflow: "LIVE_M15_MONITOR",
    checkpoint: "2026-07-14T15:45:00+02:00",
    bundle_id: "bundle-shadow-1545",
    work_status: "READY",
    data_quality: "ready",
    master_id: "master-shadow",
    thesis_id: "thesis-shadow",
  }, tick("2026-07-14T13:45:00Z"));
  assert.equal(shadow.cursor_status, "DUE");
  assert.equal(shadow.attempt.status, "PENDING");
  assert.equal(shadow.attempt.lease_token, null);
  assert.equal(shadow.master_state, "READY");
  assert.equal(shadow.thesis_state, "ACTIVE");
});

test("scenario 13 — two concurrent persistent LIVE claims produce one lease", async () => {
  const initial = readyCursor();
  const fake = transactionalStore({ [`desk_live_run_cursor/${initial.cursor_id}`]: initial });
  const persistence = new TransactionalDeskPersistence(fake);
  const now = tick("2026-07-14T11:15:00Z");
  const work = preparedMonitorWork("2026-07-14T13:15:00+02:00");
  const claim = (worker, token) => persistence.claimLiveCursor({
    cursorId: initial.cursor_id,
    initialCursor: initial,
    transition: (current) => claimLiveCursor(current, { worker_id: worker, lease_token: token, work }, now),
  });

  const outcomes = await Promise.all([
    claim("worker-one", "lease-token-one"),
    claim("worker-two", "lease-token-two"),
  ]);

  assert.equal(outcomes.filter((outcome) => outcome.result.status === "WORK_CLAIMED").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.result.reason === "in_progress").length, 1);
  const stored = fake.docs.get(`desk_live_run_cursor/${initial.cursor_id}`);
  assert.equal(stored.cursor_status, "LEASED");
  assert.equal([...fake.docs.keys()].filter((key) => key.startsWith("desk_agent_work_events/")).length, 1);
});

test("phase 3 persistent flow rolls a failed checkpoint forward instead of replaying it", async () => {
  const initial = readyCursor();
  const fake = transactionalStore({ [`desk_live_run_cursor/${initial.cursor_id}`]: initial });
  const persistence = new TransactionalDeskPersistence(fake);
  const claimed = await persistence.claimLiveCursor({
    cursorId: initial.cursor_id,
    initialCursor: initial,
    transition: (current) => claimLiveCursor(current, {
      worker_id: "worker-roll-forward",
      lease_token: "lease-roll-forward-1315",
      work: preparedMonitorWork("2026-07-14T13:15:00+02:00"),
    }, tick("2026-07-14T11:15:00Z")),
  });
  await persistence.transitionLiveCursor({
    cursorId: initial.cursor_id,
    transition: (current) => failLiveCursor(current, {
      worker_id: "worker-roll-forward",
      cursor_id: initial.cursor_id,
      checkpoint: claimed.cursor.attempt.checkpoint,
      lease_token: "lease-roll-forward-1315",
      error_code: "TEMPORARY_SOURCE_FAILURE",
      error_message: "temporary source failure",
      error_class: "transient",
    }, tick("2026-07-14T11:16:00Z"), { jitterSeconds: 0 }),
  });
  const rolled = await persistence.claimLiveCursor({
    cursorId: initial.cursor_id,
    initialCursor: initial,
    transition: (current) => claimLiveCursor(current, {
      worker_id: "worker-roll-forward",
      lease_token: "lease-roll-forward-1330",
      work: preparedMonitorWork("2026-07-14T13:30:00+02:00"),
    }, tick("2026-07-14T11:30:00Z")),
  });

  assert.equal(rolled.result.status, "WORK_CLAIMED");
  assert.equal(rolled.cursor.attempt.checkpoint, "2026-07-14T13:30:00+02:00");
  assert.deepEqual(rolled.result.rolled_forward_from, ["2026-07-14T13:15:00+02:00"]);
  assert.equal(rolled.cursor.gap_ledger.at(-1).reason, "stale_checkpoint_rolled_forward");
  assert.equal([...fake.docs.values()].some((doc) => doc.event_type === "CURSOR_ROLLED_FORWARD"), true);
});

test("phase 3 persistent sweeper saves a liveness alert after twenty minutes", async () => {
  const initial = { ...readyCursor(), updated_at_utc: "2026-07-14T10:39:59.000Z" };
  const fake = transactionalStore({ [`desk_live_run_cursor/${initial.cursor_id}`]: initial });
  const persistence = new TransactionalDeskPersistence(fake);
  const outcome = await persistence.transitionLiveCursor({
    cursorId: initial.cursor_id,
    transition: (current) => reconcileLiveCursorTick(current, tick("2026-07-14T11:00:00Z")),
  });

  assert.equal(outcome.events[0].event_type, "CURSOR_LIVENESS_ALERT");
  assert.equal(outcome.events[0].details.liveness_stale_minutes, 20);
  assert.equal([...fake.docs.values()].some((doc) => doc.event_type === "CURSOR_LIVENESS_ALERT"), true);
});

test("persistent fail transaction writes cursor, events, and renamed dead-letter atomically", async () => {
  const initial = readyCursor();
  const claimed = claimLiveCursor(initial, {
    worker_id: "worker-dlq",
    lease_token: "lease-token-dlq",
    work: preparedMonitorWork("2026-07-14T13:15:00+02:00"),
  }, tick("2026-07-14T11:15:00Z")).cursor;
  const fake = transactionalStore({ [`desk_live_run_cursor/${initial.cursor_id}`]: claimed });
  const persistence = new TransactionalDeskPersistence(fake);
  const outcome = await persistence.transitionLiveCursor({
    cursorId: initial.cursor_id,
    transition: (current) => failLiveCursor(current, {
      worker_id: "worker-dlq",
      cursor_id: initial.cursor_id,
      checkpoint: claimed.attempt.checkpoint,
      lease_token: "lease-token-dlq",
      error_code: "INVALID_OUTPUT",
      error_message: "invalid output",
      error_class: "deterministic",
    }, tick("2026-07-14T11:15:05Z")),
  });
  assert.equal(outcome.cursor.cursor_status, "DEGRADED");
  assert.equal(fake.docs.has(`desk_agent_work_dead_letter/${outcome.cursor.dead_letter_ref}`), true);
  assert.equal([...fake.docs.keys()].filter((key) => key.startsWith("desk_agent_work_events/")).length, 2);
});

test("split MCP tools are registered and replay schemas reject LIVE workflows", async () => {
  const calls = [];
  const store = new Proxy({
    async logToolCall() {},
    async claimNextLive(args) { calls.push(["live", args]); return { ok: true, status: "NO_WORK", scope: "live", reason: "up_to_date" }; },
    async claimNextReplay(args) { calls.push(["replay", args]); return { ok: true, status: "NO_WORK", scope: "replay", reason: "no_ready_step" }; },
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return async () => ({ ok: true });
    },
  });
  const tools = createDeskToolRegistry(store);
  for (const name of ["claim_next_live", "heartbeat_live", "complete_live", "fail_live", "claim_next_replay", "heartbeat_replay", "complete_replay", "fail_replay"]) {
    assert.equal(tools.some((tool) => tool.name === name), true, name);
  }
  await callDeskTool(tools, "claim_next_live", { worker_id: "worker-live", session: "asia_open", trading_date: DATE });
  await callDeskTool(tools, "claim_next_replay", { worker_id: "worker-replay" });
  assert.deepEqual(calls.map(([scope]) => scope), ["live", "replay"]);
  assert.throws(() => claimNextReplaySchema.parse({ worker_id: "worker-replay", workflows: ["LIVE_MASTER"] }));
  assert.equal(heartbeatReplaySchema.parse({ work_item_id: "work-1", worker_id: "worker-replay", lease_token: "lease-token" }).lease_seconds, 720);
});

function readyCursor() {
  return {
    ...initLiveRunCursor({ trading_date: DATE, session: "asia_open" }, tick("2026-07-13T22:15:00Z")),
    master_state: "READY",
    master_id: "master-1",
    thesis_state: "ACTIVE",
    thesis_id: "thesis-1",
  };
}

function preparedMonitorWork(checkpoint) {
  return {
    workflow: "LIVE_M15_MONITOR",
    checkpoint,
    master_id: "master-1",
    thesis_id: "thesis-1",
    data_quality: "ready",
    bundle: { bundle_id: `bundle-${checkpoint}`, bundle_tool: "get_manual_monitor_bundle", bundle_args: { checkpoint } },
    execution_prompt: "Execute LIVE monitor",
    prompt_hash: "prompt-hash",
    save_target: { tool: "save_manual_monitor" },
  };
}

function tick(utc) {
  return new FixedClock(Date.parse(utc)).now();
}

function transactionalStore(initial = {}) {
  const docs = new Map(Object.entries(initial));
  let queue = Promise.resolve();
  const db = {
    collection(collection) {
      return {
        doc(documentId) {
          return { key: `${collection}/${documentId}` };
        },
      };
    },
    runTransaction(callback) {
      const run = queue.then(async () => {
        const writes = [];
        const transaction = {
          get: async (ref) => ({ exists: docs.has(ref.key), data: () => docs.get(ref.key) }),
          set(ref, data) { writes.push({ ref, data }); },
        };
        const result = await callback(transaction);
        for (const write of writes) docs.set(write.ref.key, write.data);
        return result;
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
  return { db, docs };
}

class TransactionalDeskPersistence {
  constructor(fake) {
    this.fake = fake;
  }

  async claimLiveCursor(input) {
    return this.transitionLiveCursor(input);
  }

  async transitionLiveCursor({
    cursorCollection = "desk_live_run_cursor",
    eventCollection = "desk_agent_work_events",
    deadLetterCollection = "desk_agent_work_dead_letter",
    cursorId,
    initialCursor,
    transition,
  }) {
    return this.fake.db.runTransaction(async transaction => {
      const cursorRef = this.fake.db.collection(cursorCollection).doc(cursorId);
      const snapshot = await transaction.get(cursorRef);
      const current = snapshot.exists ? snapshot.data() : initialCursor;
      const outcome = await transition(current);
      transaction.set(cursorRef, outcome.cursor);
      for (const event of outcome.events || []) {
        transaction.set(this.fake.db.collection(eventCollection).doc(event.event_id), event);
      }
      for (const item of outcome.dead_letters || []) {
        transaction.set(this.fake.db.collection(deadLetterCollection).doc(item.dead_letter_id), item);
      }
      return outcome;
    });
  }
}
