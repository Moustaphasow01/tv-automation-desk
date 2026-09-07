import test from "node:test";
import assert from "node:assert/strict";
import { withGrainsCalendarRefreshLease } from "../src/persistence/postgres-grains-calendar-refresh-lease.js";

function fixture({ acquired = true, unlockError = null } = {}) {
  const queries = [], releases = [];
  const client = {
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes("pg_try")) return { rows: [{ acquired }] };
      if (unlockError) throw unlockError;
      return { rows: [{}] };
    },
    release: (error) => releases.push(error),
  };
  return { pool: { connect: async () => client }, queries, releases };
}

test("calendar refresh lock excludes a concurrent run without unlocking another session", async () => {
  const { pool, queries, releases } = fixture({ acquired: false });
  const result = await withGrainsCalendarRefreshLease(pool, () => assert.fail("must not collect"));
  assert.equal(result.status, "ALREADY_RUNNING");
  assert.equal(queries.length, 1);
  assert.deepEqual(releases, [undefined]);
});

test("calendar work failure releases its acquired advisory lock", async () => {
  const { pool, queries, releases } = fixture();
  await assert.rejects(withGrainsCalendarRefreshLease(pool, () => { throw new Error("FETCH_FAILED"); }), /FETCH_FAILED/);
  assert.match(queries[1], /pg_advisory_unlock/);
  assert.deepEqual(releases, [undefined]);
});

test("failed unlock destroys the database session instead of returning a held lock to the pool", async () => {
  const unlockError = new Error("CONNECTION_LOST");
  const { pool, releases } = fixture({ unlockError });
  await assert.rejects(withGrainsCalendarRefreshLease(pool, async () => ({ status: "AVAILABLE" })), /CONNECTION_LOST/);
  assert.deepEqual(releases, [unlockError]);
});
