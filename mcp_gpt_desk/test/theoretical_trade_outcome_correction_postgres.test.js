import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateTradeOutcome } from "@tv-automation/desk-domain";
import { correctTheoreticalTradeOutcomes } from "../src/application/correct-theoretical-trade-outcomes.js";
import { createPostgresTradeOutcomeCorrection } from "../src/persistence/postgres-trade-outcome-correction.js";
import { createTheoreticalTestDatabase, seedAuthorizedIntent } from "./support/theoretical-postgres-fixtures.js";

test("versioned outcome correction is atomic, audited and idempotent in PostgreSQL", {
  skip: process.env.RUN_POSTGRES_TESTS !== "1",
}, async (t) => {
  const database = await createTheoreticalTestDatabase();
  t.after(() => database.close());
  const fixture = await seedWrongOutcome(database.pool);
  const repository = createPostgresTradeOutcomeCorrection(database.pool);

  const dryRun = await correctTheoreticalTradeOutcomes({
    mode: "DRY_RUN", manifest: fixture.manifest, correction_known_at_utc: "2026-09-07T08:00:00Z",
  }, { repository });
  assert.equal(dryRun.items[0].status, "WOULD_APPLY");
  assert.deepEqual(await counts(database.pool), { outcomes: 1, corrections: 0 });

  const applied = await correctTheoreticalTradeOutcomes({
    mode: "APPLY",
    manifest: fixture.manifest,
    correction_known_at_utc: "2026-09-07T08:00:00Z",
    corrected_by: "operator-test",
    reason: "Canonical Intent and Target economics prove point_value=50.",
  }, { repository });
  assert.equal(applied.items[0].status, "CORRECTED");
  assert.deepEqual(await counts(database.pool), { outcomes: 2, corrections: 1 });
  const rows = (await database.pool.query(`SELECT revision,status,evidence,net_realized_pnl,
      calculated_at_utc,finalized_at_utc FROM trade_outcomes WHERE trade_id=$1 ORDER BY revision`, [fixture.tradeId])).rows;
  assert.deepEqual(rows.map((row) => [Number(row.revision), row.status, Number(row.evidence.point_value), Number(row.net_realized_pnl)]), [
    [1, "void", 1, -1], [2, "final", 50, -50],
  ]);
  assert.equal(new Date(rows[1].calculated_at_utc).toISOString(), "2026-09-07T08:00:00.000Z");
  assert.equal(new Date(rows[1].finalized_at_utc).toISOString(), fixture.economicTime);

  const replayed = await correctTheoreticalTradeOutcomes({
    mode: "APPLY",
    manifest: fixture.manifest,
    correction_known_at_utc: "2026-09-07T09:00:00Z",
    corrected_by: "operator-test",
    reason: "Canonical Intent and Target economics prove point_value=50.",
  }, { repository });
  assert.equal(replayed.items[0].status, "ALREADY_APPLIED");
  assert.equal(replayed.items[0].correction_known_at_utc, "2026-09-07T08:00:00.000Z");
  assert.deepEqual(await counts(database.pool), { outcomes: 2, corrections: 1 });
});

async function seedWrongOutcome(pool) {
  const intentId = "outcome-correction-intent";
  const tradeId = "outcome-correction-trade";
  const economicTime = "2026-08-31T17:54:00.000Z";
  await seedAuthorizedIntent(pool, intentId);
  await pool.query(`INSERT INTO trades (
      trade_id,portfolio_order_intent_id,status,side,quantity_planned,quantity_open,
      quantity_closed,avg_entry_price,initial_stop_price,opened_at,closed_at,raw
    ) VALUES ($1,$2,'closed','long',1,0,1,100,99,'2026-08-31T17:47Z',$3,
      '{"source":"theoretical_execution_engine"}'::jsonb)`, [tradeId, intentId, economicTime]);
  await pool.query(`INSERT INTO trade_fills (
      trade_fill_id,trade_id,broker_fill_ref,side,quantity,price,filled_at,raw
    ) VALUES ('wrong-entry',$1,'wrong-entry','buy',1,100,'2026-08-31T17:47Z','{}'),
             ('wrong-exit',$1,'wrong-exit','sell',1,99,$2,'{}')`, [tradeId, economicTime]);
  const wrong = calculateTradeOutcome({ side: "long", entryPrice: 100, initialStopPrice: 99,
    initialQuantity: 1, pointValue: 1, exitFills: [{ quantity: 1, price: 99 }],
    calculatedAt: economicTime, finalized: true });
  await pool.query(`INSERT INTO trade_outcomes (
      trade_outcome_id,trade_id,revision,status,schema_version,engine_version,
      initial_risk_amount,gross_realized_pnl,total_fees,net_realized_pnl,result_r,
      mfe_r,mae_r,evidence_hash,evidence,calculated_at_utc,finalized_at_utc
    ) VALUES ('wrong-outcome',$1,1,'final',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`, [
    tradeId, wrong.schema_version, wrong.engine_version, wrong.initial_risk_amount,
    wrong.gross_realized_pnl, wrong.total_fees, wrong.net_realized_pnl, wrong.result_r,
    wrong.mfe_r, wrong.mae_r, wrong.evidence_hash, wrong.evidence, economicTime,
  ]);
  return {
    tradeId,
    economicTime,
    manifest: {
      schema_version: "trade_outcome_correction_manifest_v1",
      manifest_id: "postgres-correction-fixture",
      corrections: [{
        idempotency_key: "postgres-correction-fixture:trade",
        trade_id: tradeId,
        portfolio_order_intent_id: intentId,
        expected_trade_outcome_id: "wrong-outcome",
        expected_revision: 1,
        expected_evidence_hash: wrong.evidence_hash,
        expected_evidence_point_value: 1,
        canonical_point_value: 50,
        expected_economic_finalized_at_utc: economicTime,
        expected_corrected_net_pnl_usd: -50,
        expected_result_r: -1,
      }],
    },
  };
}

async function counts(pool) {
  const result = await pool.query(`SELECT
    (SELECT count(*)::integer FROM trade_outcomes) AS outcomes,
    (SELECT count(*)::integer FROM trade_outcome_correction_events) AS corrections`);
  return result.rows[0];
}
