import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveTheoreticalTradeAdministrativeReview }
  from "../src/application/resolve-theoretical-trade-administrative-review.js";
import { createPostgresTheoreticalTradeAdministrativeResolution }
  from "../src/persistence/postgres-theoretical-trade-administrative-resolution.js";
import { loadTheoreticalExposureAsOf } from "../src/portfolio-theoretical-exposure-repository.js";
import { createTheoreticalTestDatabase, seedAuthorizedIntent }
  from "./support/theoretical-postgres-fixtures.js";

const manifest = JSON.parse(await readFile(new URL(
  "../../reports/research/THEORETICAL_TRADE_ADMINISTRATIVE_RESOLUTION_20260908.json",
  import.meta.url)));
const specification = manifest.resolutions[0];
const EFFECTIVE_AT = "2026-09-08T00:00:00.000Z";

test("administrative review resolution releases only current exposure and preserves all history", {
  skip: process.env.RUN_POSTGRES_TESTS !== "1",
}, async (t) => {
  const database = await createTheoreticalTestDatabase();
  t.after(() => database.close());
  await seedReviewTrade(database.pool);
  const repository = createPostgresTheoreticalTradeAdministrativeResolution(database.pool);
  const beforeCounts = await evidenceCounts(database.pool);
  const historical = await exposure(database.pool, "2026-09-07T23:59:59Z");
  assert.equal(historical.positions.filter((item) => item.source === "THEORETICAL_TRADE").length, 1);

  const dryRun = await resolveTheoreticalTradeAdministrativeReview(command("DRY_RUN"), { repository });
  assert.equal(dryRun.status, "DRY_RUN_VERIFIED");
  assert.equal(await count(database.pool, "trade_theoretical_administrative_resolutions"), 0);

  const applied = await resolveTheoreticalTradeAdministrativeReview(command("APPLY"), { repository });
  assert.equal(applied.status, "APPLIED");
  assert.equal(applied.market_execution_effect, "NONE");
  assert.equal(applied.historical_outcome_effect, "UNDETERMINED_PRESERVED");
  assert.equal(await count(database.pool, "trade_theoretical_administrative_resolutions"), 1);
  assert.deepEqual(await evidenceCounts(database.pool), beforeCounts);
  const replayed = await resolveTheoreticalTradeAdministrativeReview(command("APPLY"), { repository });
  assert.equal(replayed.replayed_count, 1);

  const resolution = (await database.pool.query(
    "SELECT created_at_utc FROM trade_theoretical_administrative_resolutions WHERE trade_id=$1",
    [specification.trade_id])).rows[0];
  const knownAfter = new Date(Math.max(Date.parse(resolution.created_at_utc), Date.parse(EFFECTIVE_AT)) + 1).toISOString();
  const beforeKnowledge = await exposure(database.pool,
    new Date(Date.parse(resolution.created_at_utc) - 1).toISOString());
  assert.equal(beforeKnowledge.positions.filter((item) => item.source === "THEORETICAL_TRADE").length, 1);
  const current = await exposure(database.pool, knownAfter);
  assert.equal(current.positions.filter((item) => item.source === "THEORETICAL_TRADE").length, 0);
  assert.equal(current.loss_usage.reserved_monetary_risk, 0);

  const trade = (await database.pool.query("SELECT status::text,quantity_open,avg_exit_price,result_r FROM trades WHERE trade_id=$1",
    [specification.trade_id])).rows[0];
  assert.deepEqual(trade, { status: "open", quantity_open: "2", avg_exit_price: null, result_r: null });
  await assert.rejects(database.pool.query("UPDATE trade_theoretical_administrative_resolutions SET resolved_by='changed'"),
    /append-only/);
  await assert.rejects(database.pool.query(`INSERT INTO trade_fills
      (trade_fill_id,trade_id,side,quantity,price,filled_at,raw)
      VALUES ('late-fill',$1,'sell',2,100,'2026-09-08T00:01Z','{"source":"theoretical_execution_engine"}')`,
  [specification.trade_id]), /execution evidence refused/);
});

async function seedReviewTrade(pool) {
  await seedAuthorizedIntent(pool, specification.portfolio_order_intent_id);
  await pool.query(`UPDATE portfolio_order_intent_lineage SET payload_hash=$2,
      risk_snapshot='{"risk_per_contract":250,"currency":"USD","availability":"KNOWN"}'
    WHERE portfolio_order_intent_id=$1`, [specification.portfolio_order_intent_id,
    specification.expected_lineage_payload_hash]);
  await pool.query("UPDATE portfolio_target_positions SET account_id='shadow-grains',instrument='MNQ' WHERE target_position_id=$1",
    [specification.portfolio_order_intent_id]);
  await pool.query(`INSERT INTO trades
    (trade_id,portfolio_order_intent_id,status,side,quantity_planned,quantity_open,quantity_closed,
      avg_entry_price,opened_at,trading_date,strategy_id,revision,raw,created_at,updated_at)
    VALUES ($1,$2,'open','long',2,2,0,29331,'2026-09-07T20:00Z','2026-09-07','strategy-test',0,
      '{"source":"theoretical_execution_engine","theoretical_review_required":true}',
      '2026-09-07T20:00Z','2026-09-07T20:00Z')`, [specification.trade_id,
    specification.portfolio_order_intent_id]);
  await pool.query(`INSERT INTO trade_fills
    (trade_fill_id,trade_id,broker_order_id,broker_fill_ref,side,quantity,price,filled_at,raw)
    VALUES ('theoretical-fill',$1,NULL,'theoretical:entry','buy',2,29331,'2026-09-07T20:00Z',
      '{"source":"theoretical_execution_engine"}')`, [specification.trade_id]);
  await pool.query(`INSERT INTO trade_theoretical_execution_events
    (theoretical_execution_event_id,trade_id,portfolio_order_intent_id,event_type,event_at_utc,quantity,price,payload,raw)
    VALUES ('entry-event',$1,$2,'entry_filled','2026-09-07T20:00Z',2,29331,'{}','{}'),
      ('review-event',$1,$2,'exit_review_required','2026-09-07T20:01Z',NULL,NULL,'{}','{}')`,
  [specification.trade_id, specification.portfolio_order_intent_id]);
}

function command(mode) {
  return { mode, manifest, effective_at_utc: EFFECTIVE_AT, actor: "operator-authorized",
    reason: "No corresponding real order or position remains open.",
    operator_attestation: { schema_version: "operator_no_open_exposure_attestation_v1",
      no_open_orders: true, no_open_positions: true } };
}

async function exposure(pool, asOf) {
  const client = await pool.connect();
  try {
    return await loadTheoreticalExposureAsOf(client, { as_of_utc: asOf,
      account_id: "shadow-grains", portfolio_scope: "shadow-grains", execution_mode: "SHADOW",
      instruments: ["MNQ"], risk_budget: { max_monetary_risk_currency: "USD" } });
  } finally { client.release(); }
}

async function evidenceCounts(pool) {
  const row = (await pool.query(`SELECT
    (SELECT count(*) FROM trades WHERE trade_id=$1)::integer trades,
    (SELECT count(*) FROM trade_fills WHERE trade_id=$1)::integer fills,
    (SELECT count(*) FROM trade_theoretical_execution_events WHERE trade_id=$1)::integer events,
    (SELECT count(*) FROM trade_outcomes WHERE trade_id=$1)::integer outcomes`,
  [specification.trade_id])).rows[0];
  return row;
}
async function count(pool, table) {
  return Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
}
