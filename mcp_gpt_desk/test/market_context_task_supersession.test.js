import assert from "node:assert/strict";
import test from "node:test";
import {
  MARKET_CONTEXT_SUPERSEDE_READY_SQL,
  MarketContextTaskScheduler,
} from "../src/market-context-task-scheduler.js";
import { createTheoreticalTestDatabase } from "./support/theoretical-postgres-fixtures.js";

const UNIVERSE = "US_GRAINS_CBOT";
const TASK_TYPE = "LIVE_US_GRAINS_MARKET_CONTEXT_REFRESH";
const SUPERSEDED_CODE = "SUPERSEDED_BY_NEWER_MARKET_CONTEXT_TASK";
const MISSION_ID = "f23b52e4-1955-4c8a-b8c7-216dd65e2c40";

test("cadence OPEN 30 to HOLIDAY 60 supersedes by analysis time, not the regressed bucket", async () => {
  const observed = { buckets: [], supersessionAsOf: [] };
  const fixture = schedulerFixture(observed);
  const scheduler = new MarketContextTaskScheduler({ store: fixture.store });

  await scheduler.runCycle({ now_utc: "2026-09-07T15:30:00.000Z" });
  fixture.setSession("HOLIDAY");
  await scheduler.runCycle({ now_utc: "2026-09-07T15:31:00.000Z" });

  assert.deepEqual(observed.buckets, [
    "2026-09-07T15:30:00.000Z",
    "2026-09-07T15:00:00.000Z",
  ]);
  assert.deepEqual(observed.supersessionAsOf, [
    "2026-09-07T15:30:00.000Z",
    "2026-09-07T15:31:00.000Z",
  ]);
});

test("PostgreSQL supersession cancels only due READY tasks in the exact context scope", {
  skip: process.env.RUN_POSTGRES_TESTS !== "1",
}, async (t) => {
  const database = await createTheoreticalTestDatabase();
  t.after(() => database.close());
  const keepTaskId = "10000000-0000-4000-8000-000000000001";
  await seedSupersessionCases(database.pool, keepTaskId);

  const result = await database.pool.query(MARKET_CONTEXT_SUPERSEDE_READY_SQL, [
    "2026-09-07T15:31:00.000Z",
    keepTaskId,
    SUPERSEDED_CODE,
    UNIVERSE,
    TASK_TYPE,
  ]);

  assert.deepEqual(result.rows.map((row) => row.agent_task_id), [
    "10000000-0000-4000-8000-000000000002",
  ]);
  assert.deepEqual(await taskStatuses(database.pool), [
    ["claimed-old", "CLAIMED"],
    ["created-in-future", "READY"],
    ["due-newer-bucket", "CANCELLED"],
    ["future-old-cycle", "READY"],
    ["keep-current", "READY"],
    ["other-task-type", "READY"],
    ["other-universe", "READY"],
    ["running-old", "RUNNING"],
  ]);
});

function schedulerFixture(observed) {
  let state = "OPEN";
  const query = async (sql, params = []) => {
    if (sql.includes("min(timestamp_utc) AS coverage_start")) return { rows: [{}] };
    if (sql.includes("SELECT timestamp_utc, open, high, low, close, volume")) return { rows: [] };
    if (sql.includes("SELECT * FROM market_context_task_dispatches")) return { rows: [] };
    if (sql.includes("INSERT INTO market_context_task_dispatches")) observed.buckets.push(params[1]);
    if (sql === MARKET_CONTEXT_SUPERSEDE_READY_SQL) observed.supersessionAsOf.push(params[0]);
    return { rows: [] };
  };
  const client = { query, release() {} };
  return {
    setSession(next) { state = next; },
    store: {
      persistence: { pool: { query, connect: async () => client } },
      health: async () => ({ data_readiness: { market_session: {
        state,
        active_session: `CBOT_GRAINS_${state}`,
        trading_date: "2026-09-07",
      } } }),
      marketContext: marketContextFixture(),
    },
  };
}

function marketContextFixture() {
  return {
    upsertSourceCoverage: async (input) => ({ ...input, sourceId: input.sourceId }),
    current: async () => ({ sourceStates: [], snapshot: null, brief: null }),
    calendarAt: async (asOfUtc) => ({
      sourceState: { sourceId: "market_agri_events", sourceType: "AGRI_EVENT_CALENDAR",
        status: "AVAILABLE", dataCutoff: asOfUtc },
      events: [],
    }),
  };
}

async function seedSupersessionCases(pool, keepTaskId) {
  const cases = [
    [keepTaskId, "keep-current", TASK_TYPE, "READY", "15:31", "15:31", UNIVERSE, "15:00"],
    ["10000000-0000-4000-8000-000000000002", "due-newer-bucket", TASK_TYPE, "READY", "15:30", "15:30", UNIVERSE, "15:30"],
    ["10000000-0000-4000-8000-000000000003", "future-old-cycle", TASK_TYPE, "READY", "16:00", "15:29", UNIVERSE, "15:00"],
    ["10000000-0000-4000-8000-000000000004", "created-in-future", TASK_TYPE, "READY", "15:20", "15:40", UNIVERSE, "15:00"],
    ["10000000-0000-4000-8000-000000000005", "claimed-old", TASK_TYPE, "CLAIMED", "15:20", "15:20", UNIVERSE, "15:00"],
    ["10000000-0000-4000-8000-000000000006", "running-old", TASK_TYPE, "RUNNING", "15:20", "15:20", UNIVERSE, "15:00"],
    ["10000000-0000-4000-8000-000000000007", "other-task-type", "OTHER_TASK", "READY", "15:20", "15:20", UNIVERSE, "15:00"],
    ["10000000-0000-4000-8000-000000000008", "other-universe", TASK_TYPE, "READY", "15:20", "15:20", "OTHER", "15:00"],
  ];
  for (const item of cases) await seedCase(pool, item);
}

async function seedCase(pool, item) {
  const [taskId, key, taskType, status, notBefore, createdAt, universe, cutoff] = item;
  const lease = ["CLAIMED", "RUNNING"].includes(status);
  await pool.query(`INSERT INTO agent_tasks (
    agent_task_id, agent_mission_id, task_key, task_type, lane, status, payload,
    not_before_utc, created_at_utc, updated_at_utc, assigned_worker_id,
    lease_token, lease_expires_at_utc, claimed_at_utc
  ) VALUES ($1,$2,$3,$4,'live',$5,'{"test":true}'::jsonb,$6,$7,$7,$8,$9,$10,$11)`, [
    taskId, MISSION_ID, key, taskType, status,
    at(notBefore), at(createdAt), lease ? "test-worker" : null,
    lease ? `lease-${key}` : null, lease ? at("16:30") : null,
    lease ? at("15:10") : null,
  ]);
  await pool.query(`INSERT INTO market_context_task_dispatches (
    dispatch_id, universe, source_data_cutoff_utc, reason_hash, trigger_type,
    status, agent_task_id, not_before_utc, created_at_utc, updated_at_utc
  ) VALUES ($1,$2,$3,$4,'CADENCE',$5,$6,$7,$8,$8)`, [
    `dispatch-${key}`, universe, at(cutoff), `reason-${key}`,
    lease ? "CLAIMED" : "ENQUEUED", taskId, at(notBefore), at(createdAt),
  ]);
}

async function taskStatuses(pool) {
  const result = await pool.query(`SELECT task_key, status::text
    FROM agent_tasks WHERE task_key IN (
      'keep-current','due-newer-bucket','future-old-cycle','created-in-future',
      'claimed-old','running-old','other-task-type','other-universe'
    ) ORDER BY task_key`);
  return result.rows.map((row) => [row.task_key, row.status]);
}

function at(time) {
  return `2026-09-07T${time}:00.000Z`;
}
