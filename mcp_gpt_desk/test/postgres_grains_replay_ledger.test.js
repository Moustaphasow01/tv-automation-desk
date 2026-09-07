import assert from "node:assert/strict";
import test from "node:test";
import { loadGrainsReplayLedger } from "../src/persistence/postgres-grains-replay-ledger.js";

test("replay ledger separates causal request time from technical ingestion and sorts causally", async () => {
  const intents = [
    intentRow("later", "2026-09-04T14:01:00Z", "2027-01-01T00:00:00Z", "2026-09-04T14:01:00Z"),
    intentRow("legacy", null, "2028-01-01T00:00:00Z", "2026-09-04T14:00:00Z"),
    intentRow("invalid", "not-a-timestamp", "2025-01-01T00:00:00Z", "2026-09-04T13:00:00Z"),
  ];
  const pool = { async query(sql) {
    if (sql.includes("supplied_requested_at_utc")) return { rows: intents };
    if (sql.includes("count(*)::int")) return { rows: [{ count: 0 }] };
    return { rows: [] };
  } };

  const result = await loadGrainsReplayLedger(pool);

  assert.deepEqual(result.intents.map((row) => row.portfolio_order_intent_id), ["legacy", "later", "invalid"]);
  assert.deepEqual(result.intents.map((row) => row.requested_at_provenance), [
    "TARGET_COMPUTED_AT_FALLBACK", "ORDER_INTENT_REQUESTED_AT", "ORDER_INTENT_REQUESTED_AT_INVALID",
  ]);
  assert.equal(result.intents[0].requested_at_utc, "2026-09-04T14:00:00.000Z");
  assert.equal(result.intents[0].ingested_at_utc, "2028-01-01T00:00:00.000Z");
  assert.equal(result.intents[2].requested_at_utc, null);
  assert.equal(result.provider_commands, 0);
});

test("replay ledger preserves PostgreSQL Date millisecond precision for technical ingestion", async () => {
  const ingestedAt = new Date("2026-09-04T14:00:00.500Z");
  const pool = {
    async query(sql) {
      if (sql.includes("FROM portfolio_order_intent_lineage")) return { rows: [{
        portfolio_order_intent_id: "intent-ms", supplied_requested_at_utc: "2026-09-04T14:00:00.100Z",
        target_computed_at_utc: new Date("2026-09-04T14:00:00.000Z"), ingested_at_utc: ingestedAt,
      }] };
      if (sql.includes("count(*)::int")) return { rows: [{ count: 0 }] };
      return { rows: [] };
    },
  };

  const ledger = await loadGrainsReplayLedger(pool);
  assert.equal(ledger.intents[0].requested_at_utc, "2026-09-04T14:00:00.100Z");
  assert.equal(ledger.intents[0].ingested_at_utc, "2026-09-04T14:00:00.500Z");
});

function intentRow(id, requestedAt, ingestedAt, targetComputedAt) {
  return {
    portfolio_order_intent_id: id, target_position_id: `target-${id}`, status: "READY", quantity: "1",
    supplied_requested_at_utc: requestedAt, target_computed_at_utc: targetComputedAt,
    ingested_at_utc: ingestedAt, payload: requestedAt ? { requested_at_utc: requestedAt } : {},
  };
}
