import assert from "node:assert/strict";
import test from "node:test";
import {
  parseV5FrozenQuiesceArgs,
  quiesceV5FrozenState,
  V5_FROZEN_HOLD_REASON,
} from "../src/v5-frozen-quiesce.js";

function poolWith({ activeLeases = [] } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes("FROM desk_documents") && String(sql).includes("desk_claim_lane_controls") && String(sql).includes("FOR UPDATE")) {
        return {
          rows: [
            { document_id: "live", data: { enabled: false, status: "PAUSED" } },
            { document_id: "replay", data: { enabled: false, status: "PAUSED" } },
          ],
        };
      }
      if (String(sql).includes("SELECT 'work' AS lease_kind")) return { rows: activeLeases };
      if (String(sql).startsWith("UPDATE") || String(sql).includes("INSERT INTO broker_execution_locks")) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      calls.push({ sql: "RELEASE", params: [] });
    },
  };
  return {
    pool: { async connect() { return client; } },
    calls,
  };
}

test("quiesce atomically freezes stale work and asserts broker lock", async () => {
  const fixture = poolWith();
  const result = await quiesceV5FrozenState(fixture.pool, {
    actor: "test",
    releaseVersion: "v5-test",
    auditId: "audit-v5-test",
    now: () => new Date("2026-07-30T12:00:00.000Z"),
  });
  assert.equal(result.ok, true);
  assert.equal(result.dry_run, false);
  assert.equal(result.summary.broker_lock_asserted, true);
  assert.equal(result.audit.reason, V5_FROZEN_HOLD_REASON);
  assert.equal(fixture.calls.at(-2).sql, "COMMIT");
  assert.equal(fixture.calls.at(-1).sql, "RELEASE");
  assert.ok(fixture.calls.some((call) => call.sql.includes("'desk_agent_work_items'")));
  const leaseSelects = fixture.calls.filter((call) => call.sql.includes("AS lease_kind"));
  assert.equal(leaseSelects.length, 3);
  assert.equal(leaseSelects.every((call) => call.sql.includes("FOR UPDATE") && !call.sql.includes("UNION")), true);
  const brokerUpsert = fixture.calls.find((call) => call.sql.includes("INSERT INTO broker_execution_locks"));
  assert.ok(brokerUpsert);
  assert.match(brokerUpsert.sql, /global_default_kill_switch/);
  assert.match(brokerUpsert.sql, /ON CONFLICT \(scope_type, scope_value\) DO UPDATE/);
  assert.ok(fixture.calls.some((call) => call.sql.includes("'desk_audit_logs'")));
  const untypedParams = fixture.calls.flatMap((call) => call.params.length
    ? [...call.sql.matchAll(/\$[1-9](?!::)/g)].map((match) => match[0])
    : []);
  assert.deepEqual(untypedParams, []);
});

test("quiesce refuses an unexpired CLAIMED lease and rolls back without mutation", async () => {
  const fixture = poolWith({
    activeLeases: [{
      lease_kind: "work",
      document_id: "work-live-active",
      status: "CLAIMED",
      lease_expires_at: "2026-07-30T12:10:00.000Z",
    }],
  });
  await assert.rejects(
    quiesceV5FrozenState(fixture.pool, {
      auditId: "audit-refused",
      now: () => new Date("2026-07-30T12:00:00.000Z"),
    }),
    (error) => error?.code === "V5_FROZEN_ACTIVE_LEASE_REFUSED"
      && error.active_leases[0].document_id === "work-live-active",
  );
  assert.deepEqual(
    fixture.calls.map((call) => call.sql).filter((sql) => sql === "BEGIN" || sql === "ROLLBACK" || sql === "COMMIT"),
    ["BEGIN", "ROLLBACK"],
  );
  assert.equal(fixture.calls.some((call) => call.sql.startsWith("UPDATE")), false);
});

test("quiesce requires both claim lanes already paused", async () => {
  const fixture = poolWith();
  const originalQuery = fixture.pool.connect;
  fixture.pool.connect = async () => {
    const client = await originalQuery();
    const query = client.query.bind(client);
    client.query = async (sql, params) => {
      if (String(sql).includes("desk_claim_lane_controls") && String(sql).includes("FOR UPDATE")) {
        return { rows: [{ document_id: "live", data: { enabled: false, status: "PAUSED" } }] };
      }
      return query(sql, params);
    };
    return client;
  };
  await assert.rejects(
    quiesceV5FrozenState(fixture.pool, { auditId: "audit-lane-refused" }),
    (error) => error?.code === "V5_FROZEN_LANES_NOT_PAUSED"
      && error.lanes.includes("replay"),
  );
});


test("CLI target release overrides the current desk.env release", () => {
  assert.deepEqual(
    parseV5FrozenQuiesceArgs(
      ["--release-version=2026.07.30-engine-v5-hold.2", "--actor=deploy-frozen"],
      { DESK_RELEASE_VERSION: "2026.07.30-engine-v3-hold.1" },
    ),
    {
      releaseVersion: "2026.07.30-engine-v5-hold.2",
      actor: "deploy-frozen",
      dryRun: false,
    },
  );
});


test("dry-run executes all mutations and audit then rolls back", async () => {
  const fixture = poolWith();
  const result = await quiesceV5FrozenState(fixture.pool, {
    auditId: "audit-dry-run",
    dryRun: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.dry_run, true);
  const transactionCommands = fixture.calls
    .map((call) => call.sql)
    .filter((sql) => ["BEGIN", "ROLLBACK", "COMMIT"].includes(sql));
  assert.deepEqual(transactionCommands, ["BEGIN", "ROLLBACK"]);
  assert.ok(fixture.calls.some((call) => call.sql.includes("'desk_audit_logs'")));
});
