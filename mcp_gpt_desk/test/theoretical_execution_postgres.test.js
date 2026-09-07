import assert from "node:assert/strict";
import { test } from "node:test";
import { createTheoreticalTestDatabase, seedAuthorizedIntent, seedMinuteCandles } from "./support/theoretical-postgres-fixtures.js";
import { listTheoreticalEntryCandidates, expireStalePortfolioHumanGates, recordTheoreticalEntryFill,
  recordTheoreticalEntryExpired, recordTheoreticalExitFill, recordTheoreticalReviewRequired, listTheoreticalOpenTrades } from "../src/broker-theoretical-execution-repository.js";
import { latestClosedCandleForIntent, latestClosedCandleForTrade } from "../src/broker-theoretical-candle-repository.js";
import { evaluateTheoreticalEntryIntent } from "../src/theoretical-execution-engine.js";
import { materializeTradeOutcome, resolveOutcomePointValue } from "../src/broker-trade-outcome-repository.js";
import { loadTheoreticalExposureAsOf } from "../src/portfolio-theoretical-exposure-repository.js";

const HISTORICAL_CUTOFF = "2026-09-01T14:04:00.000Z";

test("point value comes from frozen canonical units, never an invented 1", () => {
  assert.equal(resolveOutcomePointValue({ point_value: 2, intent_units: { point_value: 50 } }), 50);
  assert.equal(resolveOutcomePointValue({ point_value: 2, intent_economics_units: { point_value: 50 } }), 50);
  assert.equal(resolveOutcomePointValue({ target_economics_units: { point_value: 50 }, target_units: { point_value: 2 } }), 50);
  assert.equal(resolveOutcomePointValue({ raw: { execution_units: { point_value: 50 } }, intent_units: { point_value: 10 } }), 50);
  for (const value of [null, undefined, "", false, 0, -1, "not a value"]) {
    assert.equal(resolveOutcomePointValue({ point_value: value }), null);
  }
});

test("historical source-less expiry stays reserved while source-backed expiry releases risk", {
  skip: process.env.RUN_POSTGRES_TESTS !== "1",
}, async (t) => {
  const repository = await createTheoreticalTestDatabase();
  t.after(() => repository.close());
  const intentId = "historical-expiry";
  const provenIntentId = "historical-expiry-proven";
  await seedAuthorizedIntent(repository.pool, intentId);
  await seedAuthorizedIntent(repository.pool, provenIntentId);
  await backdateIntentForHistoricalExpiry(repository.pool, intentId);
  await backdateIntentForHistoricalExpiry(repository.pool, provenIntentId);

  const sweep = await expireStalePortfolioHumanGates(repository, {
    now: HISTORICAL_CUTOFF, portfolioOrderIntentIds: [intentId, provenIntentId],
  });
  assert.equal(sweep.expired, 2);
  const state = (await repository.pool.query(`SELECT created_at_utc,updated_at_utc,payload
    FROM portfolio_order_intent_execution_states WHERE portfolio_order_intent_id=$1`, [intentId])).rows[0];
  assert.equal(new Date(state.updated_at_utc).toISOString(), HISTORICAL_CUTOFF);
  assert.equal(state.payload.expired_at_utc, HISTORICAL_CUTOFF);
  assert.ok(Date.parse(state.created_at_utc) > Date.parse(state.updated_at_utc));

  const beforeProof = await historicalExposure(repository.pool);
  assert.equal(beforeProof.availability, "KNOWN");
  assert.deepEqual(beforeProof.reservation_instruments, ["ZC"]);
  assert.equal(beforeProof.reason_codes.some((code) => code.includes("AFTER_AS_OF")), false);

  await recordTheoreticalEntryExpired(repository, {
    result: { portfolio_order_intent_id: intentId, order_intent_id: intentId,
      action: "expire_entry", status: "expired", reason: "ENTRY_WINDOW_EXPIRED",
      event_at_utc: HISTORICAL_CUTOFF },
    now: HISTORICAL_CUTOFF,
  });
  const afterUnproven = await historicalExposure(repository.pool);
  assert.equal(afterUnproven.pending_order_intents.length, 2);
  await recordTheoreticalEntryExpired(repository, {
    result: { portfolio_order_intent_id: provenIntentId, order_intent_id: provenIntentId,
      action: "expire_entry", status: "expired", reason: "ENTRY_WINDOW_EXPIRED",
      event_at_utc: HISTORICAL_CUTOFF,
      candle: { feed_id: "historical-feed", timestamp_utc: "2026-09-01T14:03:00.000Z" } },
    now: HISTORICAL_CUTOFF,
  });
  const afterProof = await historicalExposure(repository.pool);
  assert.equal(afterProof.pending_order_intents.length, 1);
  assert.equal(afterProof.pending_order_intents[0].portfolio_order_intent_id, intentId);
  assert.equal(await terminalEventCount(repository.pool, intentId), 1);
});

test("canonical theoretical tracking against an isolated, fully migrated PostgreSQL database", {
  skip: process.env.RUN_POSTGRES_TESTS !== "1",
}, async (t) => {
  const repository = await createTheoreticalTestDatabase();
  t.after(() => repository.close());
  await seedMinuteCandles(repository.pool);
  await t.test("Human Gate expiration preserves the theoretical mandate, not arbitrary expired intents", async () => {
    await seedAuthorizedIntent(repository.pool, "awaiting");
    await seedAuthorizedIntent(repository.pool, "rejected", { gate: "REJECTED" });
    await seedAuthorizedIntent(repository.pool, "confirmed", { gate: "CONFIRMED" });
    await seedAuthorizedIntent(repository.pool, "unrelated-expiry", { status: "EXPIRED", gate: "EXPIRED" });
    const sweep = await expireStalePortfolioHumanGates(repository, { now: "2026-09-04T14:04Z" });
    assert.equal(sweep.expired, 1);
    const candidates = await listTheoreticalEntryCandidates(repository, { portfolioOrderIntentIds: ["awaiting", "rejected", "confirmed", "unrelated-expiry"] });
    assert.deepEqual(candidates.map((row) => row.portfolio_order_intent_id).sort(), ["awaiting", "confirmed", "rejected"]);
    assert.equal(candidates[0].point_value, 50);
    assert.equal((await repository.pool.query("SELECT count(*) FROM broker_provider_commands")).rows[0].count, "0");
  });
  await t.test("M1 reads obey the replay clock and the complete non-touch window expires", async () => {
    const [intent] = await listTheoreticalEntryCandidates(repository, { portfolioOrderIntentIds: ["awaiting"] });
    const beforeClose = await latestClosedCandleForIntent(repository, intent, { now: "2026-09-04T14:00:59Z" });
    assert.equal(beforeClose, null);
    const atClose = await latestClosedCandleForIntent(repository, intent, { now: "2026-09-04T14:01Z" });
    assert.equal(new Date(atClose.timestamp_utc).toISOString(), "2026-09-04T14:00:00.000Z");
    assert.equal(atClose.theoretical_window_complete, false);
    const complete = await latestClosedCandleForIntent(repository, intent, { now: "2026-09-04T14:10Z" });
    assert.equal(complete.theoretical_window_complete, true);
    const result = evaluateTheoreticalEntryIntent({ intent, candle: complete, now: "2026-09-04T14:10Z" });
    assert.equal(result.action, "expire_entry");
    await recordTheoreticalEntryExpired(repository, { result, now: "2026-09-04T14:10Z" });
    const terminal = (await repository.pool.query(`SELECT source_candle_feed_id,source_candle_timestamp_utc
      FROM trade_theoretical_execution_events WHERE portfolio_order_intent_id='awaiting'`)).rows[0];
    assert.equal(terminal.source_candle_feed_id, "td2_zc");
    assert.equal(new Date(terminal.source_candle_timestamp_utc).toISOString(), "2026-09-04T14:02:00.000Z");
    const released = await historicalExposure(repository.pool);
    assert.equal(released.pending_order_intents.some((row) => row.portfolio_order_intent_id === "awaiting"), false);
    const racedFill = await recordTheoreticalEntryFill(repository, { result: { ...result, price: 100, quantity: 1 }, now: "2026-09-04T14:10Z" });
    assert.equal(racedFill.idempotent, true);
    assert.equal(racedFill.event.event_type, "entry_expired");
    assert.equal((await repository.pool.query("SELECT count(*) FROM trades WHERE portfolio_order_intent_id = 'awaiting'")).rows[0].count, "0");
  });
  await t.test("an older touched bar is recovered without changing the Human Gate; exits cannot read the future", async () => {
    await repository.pool.query("UPDATE market_candles SET low = 99 WHERE feed_id = 'td2_zc' AND timestamp_utc = '2026-09-04T14:01Z'");
    const [intent] = await listTheoreticalEntryCandidates(repository, { portfolioOrderIntentIds: ["rejected"] });
    const candle = await latestClosedCandleForIntent(repository, intent, { now: "2026-09-04T14:10Z" });
    const result = evaluateTheoreticalEntryIntent({ intent, candle, now: "2026-09-04T14:10Z" });
    assert.equal(result.action, "fill_entry");
    await Promise.all([1, 2].map(() => recordTheoreticalEntryFill(repository, { result, now: "2026-09-04T14:10Z" })));
    const trade = (await repository.pool.query("SELECT *, raw->>'instrument' AS instrument_code FROM trades WHERE portfolio_order_intent_id = 'rejected'")).rows[0];
    assert.equal(trade.raw.execution_units.point_value, 50);
    const expired = await recordTheoreticalEntryExpired(repository, { result, now: "2026-09-04T14:10Z" });
    assert.equal(expired.event.event_type, "entry_filled");
    assert.equal(await latestClosedCandleForTrade(repository, trade, { now: "2026-09-04T14:02Z" }), null);
    const next = await latestClosedCandleForTrade(repository, trade, { now: "2026-09-04T14:03Z" });
    assert.equal(new Date(next.timestamp_utc).toISOString(), "2026-09-04T14:02:00.000Z");
    assert.equal((await repository.pool.query("SELECT status FROM human_execution_gates WHERE portfolio_order_intent_id = 'rejected'")).rows[0].status, "REJECTED");
    await recordTheoreticalExitFill(repository, { result: { trade_id: trade.trade_id, price: 110, quantity: 1, exit_reason: "target", event_at_utc: "2026-09-04T14:03Z" }, now: "2026-09-04T14:04Z" });
    const outcome = (await repository.pool.query("SELECT * FROM trade_outcomes WHERE trade_id = $1", [trade.trade_id])).rows[0];
    assert.equal(Number(outcome.initial_risk_amount), 250);
    assert.equal(Number(outcome.gross_realized_pnl), 500);
    assert.equal(Number(outcome.result_r), 2);
  });
  await t.test("missing economics stays explicit; corrected monetary evidence retains old revisions", async () => {
    await repository.pool.query(`INSERT INTO trades(trade_id,status,side,quantity_planned,avg_entry_price,initial_stop_price)
      VALUES ('economics','closed','long',1,100,95)`);
    await repository.pool.query(`INSERT INTO trade_fills(trade_fill_id,trade_id,side,quantity,price,filled_at)
      VALUES ('eco-entry','economics','buy',1,100,'2026-09-04T14:01Z'),('eco-exit','economics','sell',1,110,'2026-09-04T14:03Z')`);
    const client = await repository.pool.connect();
    try {
      await client.query("BEGIN");
      assert.equal(await materializeTradeOutcome(client, "economics", "2026-09-04T14:04Z"), null);
      const pending = (await client.query("SELECT raw,result_r FROM trades WHERE trade_id = 'economics'")).rows[0];
      assert.equal(pending.raw.outcome_pending_reason, "CANONICAL_POINT_VALUE_MISSING");
      assert.equal(pending.result_r, null);
      for (const pointValue of [1, 50, 50]) {
        await client.query("UPDATE trades SET raw = jsonb_set(raw,'{execution_units}',$1) WHERE trade_id = 'economics'", [JSON.stringify({ point_value: pointValue })]);
        await materializeTradeOutcome(client, "economics", "2026-09-04T14:04Z");
      }
      const revisions = (await client.query("SELECT status,initial_risk_amount FROM trade_outcomes WHERE trade_id = 'economics' ORDER BY revision")).rows;
      assert.deepEqual(revisions.map((row) => [row.status, Number(row.initial_risk_amount)]), [["void", 5], ["final", 250]]);
      await client.query("SAVEPOINT old_evidence");
      await client.query("UPDATE trades SET raw = jsonb_set(raw,'{execution_units}','{\"point_value\":1}') WHERE trade_id = 'economics'");
      await assert.rejects(materializeTradeOutcome(client, "economics", "2026-09-04T14:04Z"), { code: "OUTCOME_EVIDENCE_SUPERSEDED" });
      await client.query("ROLLBACK TO SAVEPOINT old_evidence");
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    assert.equal((await repository.pool.query("SELECT count(*) FROM broker_provider_commands")).rows[0].count, "0");
  });
  await t.test("a missing minute stays indeterminate and an ambiguous exit is never skipped toward a later winner", async () => {
    const [intent] = await listTheoreticalEntryCandidates(repository, { portfolioOrderIntentIds: ["confirmed"] });
    await repository.pool.query("UPDATE market_candles SET low=101 WHERE feed_id='td2_zc'");
    await repository.pool.query("UPDATE market_candles SET is_closed=false WHERE feed_id='td2_zc' AND timestamp_utc='2026-09-04T14:01Z'");
    const candle = await latestClosedCandleForIntent(repository, intent, { now: "2026-09-04T14:10Z" });
    assert.equal(candle.theoretical_window_complete, false);
    const incomplete = evaluateTheoreticalEntryIntent({ intent, candle, now: "2026-09-04T14:10Z" });
    assert.equal(incomplete.reason, "ENTRY_WINDOW_DATA_INCOMPLETE");
    await repository.pool.query(`INSERT INTO trades(trade_id,status,side,quantity_open,current_stop_price,current_target_price,opened_at,raw)
      VALUES ('review','open','long',1,95,110,'2026-09-04T14:01Z','{"instrument":"ZC","source":"theoretical_execution_engine"}'),
             ('physical','open','long',1,95,110,'2026-09-04T14:01Z','{"instrument":"ZC","source":"broker"}')`);
    assert.ok(!(await listTheoreticalOpenTrades(repository, { now: "2026-09-04T14:05Z" })).some((row) => row.trade_id === "physical"));
    const physical = await recordTheoreticalExitFill(repository, { result: { trade_id: "physical", price: 110, quantity: 1 }, now: "2026-09-04T14:05Z" });
    assert.equal(physical.reason, "NON_THEORETICAL_TRADE");
    assert.ok((await listTheoreticalOpenTrades(repository, { now: "2026-09-04T14:05Z" })).some((row) => row.trade_id === "review"));
    await recordTheoreticalReviewRequired(repository, { result: { trade_id: "review", reason: "AMBIGUOUS_INTRABAR_STOP_AND_TARGET", event_at_utc: "2026-09-04T14:02Z" }, now: "2026-09-04T14:03Z" });
    assert.ok(!(await listTheoreticalOpenTrades(repository, { now: "2026-09-04T14:10Z" })).some((row) => row.trade_id === "review"));
    const blocked = await recordTheoreticalExitFill(repository, { result: { trade_id: "review", price: 110, quantity: 1, exit_reason: "target" }, now: "2026-09-04T14:10Z" });
    assert.equal(blocked.status, "THEORETICAL_REVIEW_REQUIRED");
    const trade = (await repository.pool.query("SELECT * FROM trades WHERE trade_id='review'")).rows[0];
    assert.equal(trade.raw.theoretical_review_required, true);
    assert.equal(trade.result_r, null);
  });
});

async function backdateIntentForHistoricalExpiry(pool, intentId) {
  await pool.query("UPDATE portfolio_arbitration_runs SET as_of_utc='2026-09-01T14:00Z' WHERE portfolio_arbitration_run_id=$1", [intentId]);
  await pool.query("UPDATE portfolio_target_positions SET computed_at_utc='2026-09-01T14:00Z' WHERE target_position_id=$1", [intentId]);
  await pool.query(`UPDATE human_execution_gates
    SET expires_at_utc='2026-09-01T14:03Z', confirmed_at_utc='2026-09-01T14:00Z'
    WHERE portfolio_order_intent_id=$1`, [intentId]);
}

async function historicalExposure(pool) {
  const client = await pool.connect();
  try {
    return await loadTheoreticalExposureAsOf(client, {
      account_id: "test", portfolio_scope: "test", execution_mode: "SHADOW",
      instruments: ["ZC"], as_of_utc: HISTORICAL_CUTOFF,
    });
  } finally { client.release(); }
}

async function terminalEventCount(pool, intentId) {
  const row = await pool.query(`SELECT count(*)::integer AS count FROM trade_theoretical_execution_events
    WHERE portfolio_order_intent_id=$1 AND event_type='entry_expired'`, [intentId]);
  return row.rows[0].count;
}
