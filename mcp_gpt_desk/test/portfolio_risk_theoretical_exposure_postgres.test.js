import assert from "node:assert/strict";
import test from "node:test";
import { PostgresPortfolioRiskRuntimeRepository } from "../src/portfolio-risk-runtime-repository.js";
import { PortfolioRiskRuntimeService } from "../src/portfolio-risk-runtime-service.js";
import { loadTheoreticalExposureAsOf } from "../src/portfolio-theoretical-exposure-repository.js";
import { createBrokerExecutionRepository } from "../src/broker-execution-repository.js";
import { PortfolioOrderIntentExecutionService } from "../src/portfolio-order-intent-execution-service.js";
import { createTheoreticalTestDatabase } from "./support/theoretical-postgres-fixtures.js";

const NOW = "2026-09-05T14:05:00.000Z";
const LATER = "2026-09-05T14:10:00.000Z";
const MONDAY = "2026-09-07T00:05:00.000Z";

test("PostgreSQL exposure lock reserves a theoretical intent and prevents an opposing concurrent batch", { skip: process.env.RUN_POSTGRES_TESTS !== "1" }, async () => {
  const database = await createTheoreticalTestDatabase();
  try {
    const repository = new PostgresPortfolioRiskRuntimeRepository({ pool: database.pool, initialized: Promise.resolve() });
    const service = new PortfolioRiskRuntimeService({ repository, clock: { now: () => ({ utc: NOW }) } });
    const [longResult, shortResult] = await Promise.all([
      service.runPipeline(command(signal({ signal_id: "signal-long", direction: "LONG" }))),
      service.runPipeline(command(signal({ signal_id: "signal-short", direction: "SHORT" }))),
    ]);

    const results = [longResult, shortResult];
    assert.equal(results.filter((item) => item.intents.order_intents.length === 1).length, 1);
    assert.equal(results.filter((item) => item.intents.order_intents.length === 0).length, 1);
    assert.equal(await count(database.pool, "portfolio_order_intent_lineage"), 1);
    const blocked = results.find((item) => item.intents.order_intents.length === 0);
    assert.ok(blocked.allocations.rejected_signals[0].issues.some((issue) => issue.code === "PORTFOLIO_THEORETICAL_INTENT_RESERVED"));
  } finally {
    await database.close();
  }
});

test("a lifecycle UNKNOWN and expired human gate remain a non-known theoretical reservation as-of", { skip: process.env.RUN_POSTGRES_TESTS !== "1" }, async () => {
  const database = await createTheoreticalTestDatabase();
  try {
    const persistence = { pool: database.pool, initialized: Promise.resolve() };
    const repository = new PostgresPortfolioRiskRuntimeRepository(persistence);
    const service = new PortfolioRiskRuntimeService({ repository, clock: { now: () => ({ utc: NOW }) } });
    const first = await service.runPipeline(command(signal({ signal_id: "signal-reserved", direction: "LONG" })));
    const intentId = first.intents.order_intents[0].order_intent_id;
    const humanGates = new PortfolioOrderIntentExecutionService({ persistence, clock: { now: () => ({ utc: NOW }) } });
    const gate = await humanGates.ensureHumanGate({ portfolioOrderIntentId: intentId, expiresAtUtc: NOW, as_of_utc: NOW });
    assert.equal(gate.status, "AWAITING_MANUAL_CONFIRMATION");
    const brokerRepository = createBrokerExecutionRepository(persistence);
    const expired = await brokerRepository.expireStalePortfolioHumanGates({ now: NOW, portfolioOrderIntentIds: [intentId] });
    assert.equal(expired.expired, 1);
    const persistedGate = await database.pool.query("SELECT status FROM human_execution_gates WHERE portfolio_order_intent_id = $1", [intentId]);
    assert.equal(persistedGate.rowCount, 1);
    assert.equal(persistedGate.rows[0].status, "EXPIRED");
    const unknown = await database.pool.query(`UPDATE portfolio_order_intent_execution_states
      SET lifecycle_status = 'UNKNOWN', payload = '{}'::jsonb WHERE portfolio_order_intent_id = $1`, [intentId]);
    assert.equal(unknown.rowCount, 1);
    const client = await database.pool.connect();
    try {
      const snapshot = await loadTheoreticalExposureAsOf(client, exposureRequest());
      assert.equal(snapshot.availability, "PARTIAL");
      assert.deepEqual(snapshot.reservation_instruments, ["ZC"]);
      assert.ok(snapshot.reason_codes.includes("THEORETICAL_INTENT_UNKNOWN:ZC"));
      const historical = await loadTheoreticalExposureAsOf(client, { ...exposureRequest(), require_historical_status: true });
      assert.equal(historical.availability, "UNAVAILABLE");
      assert.ok(historical.reason_codes.includes("THEORETICAL_LINEAGE_STATUS_HISTORY_UNAVAILABLE"));
    } finally { client.release(); }
    const blocked = await service.runPipeline(command(signal({ signal_id: "signal-after-unknown", direction: "SHORT" })));
    assert.equal(blocked.status, "EXPOSURE_UNAVAILABLE");
    assert.equal(blocked.intents.order_intents.length, 0);
    assert.equal(await count(database.pool, "portfolio_order_intent_lineage"), 1);
  } finally {
    await database.close();
  }
});

test("account-wide persisted reservations consume the common budget across instruments", { skip: process.env.RUN_POSTGRES_TESTS !== "1" }, async () => {
  const database = await createTheoreticalTestDatabase();
  try {
    const repository = new PostgresPortfolioRiskRuntimeRepository({ pool: database.pool, initialized: Promise.resolve() });
    const service = new PortfolioRiskRuntimeService({ repository, clock: { now: () => ({ utc: NOW }) } });
    const first = await service.runPipeline(command(signal({ signal_id: "signal-zc-budget", instrument: "ZC", direction: "LONG" }), 1));
    const second = await service.runPipeline(command(signal({ signal_id: "signal-zw-budget", instrument: "ZW", direction: "LONG" }), 1));

    assert.equal(first.intents.order_intents.length, 1);
    assert.equal(second.risk.status, "BLOCK");
    assert.equal(second.targets.target_positions.length, 0);
    assert.equal(second.intents.order_intents.length, 0);
    assert.equal(await count(database.pool, "portfolio_order_intent_lineage"), 1);
  } finally {
    await database.close();
  }
});

test("canonical USD risk reserves pending and partially open quantity once", { skip: process.env.RUN_POSTGRES_TESTS !== "1" }, async () => {
  const database = await createTheoreticalTestDatabase();
  try {
    const intentId = "monetary-partial-intent";
    await insertMonetaryIntent(database.pool, intentId);
    const pending = await exposure(database.pool, monetaryExposureRequest());
    assert.equal(pending.loss_usage.monetary_availability, "KNOWN");
    assert.equal(pending.loss_usage.reserved_monetary_risk, 1000);
    assert.equal(pending.loss_usage.currency, "USD");
    const missingCurrency = await exposure(database.pool, exposureRequest());
    assert.equal(missingCurrency.loss_usage.monetary_availability, "UNAVAILABLE");
    assert.equal(missingCurrency.loss_usage.reserved_monetary_risk, null);
    await database.pool.query(`UPDATE portfolio_order_intent_lineage
      SET risk_snapshot = jsonb_set(risk_snapshot,'{availability}','"UNAVAILABLE"')
      WHERE portfolio_order_intent_id = $1`, [intentId]);
    const missingProvenance = await exposure(database.pool, monetaryExposureRequest());
    assert.equal(missingProvenance.loss_usage.monetary_availability, "UNAVAILABLE");
    assert.equal(missingProvenance.loss_usage.reserved_monetary_risk, null);
    await database.pool.query(`UPDATE portfolio_order_intent_lineage
      SET risk_snapshot = jsonb_set(risk_snapshot,'{availability}','"KNOWN"')
      WHERE portfolio_order_intent_id = $1`, [intentId]);

    await insertPartiallyClosedTrade(database.pool, intentId);
    const partial = await exposure(database.pool, monetaryExposureRequest());
    assert.equal(partial.pending_order_intents.length, 0);
    assert.equal(partial.positions.filter((item) => item.source === "THEORETICAL_TRADE")[0].size, 1);
    assert.equal(partial.loss_usage.reserved_monetary_risk, 500);

    await closeMonetaryTrade(database.pool, intentId);
    const profitIntentId = "monetary-profit-intent";
    await insertMonetaryIntent(database.pool, profitIntentId);
    await insertClosedMonetaryProfit(database.pool, profitIntentId);
    const closed = await exposure(database.pool, monetaryExposureRequest());
    assert.equal(closed.loss_usage.reserved_monetary_risk, 0);
    assert.equal(closed.loss_usage.daily_loss_monetary, 50);
    assert.equal(closed.loss_usage.weekly_loss_monetary, 50);
    assert.equal(closed.loss_usage.daily_realized_r, -0.05);

    await database.pool.query("UPDATE trade_outcomes SET calculated_at_utc = '2026-09-05T14:06Z' WHERE trade_id = $1", [`trade:${intentId}`]);
    const futureCalculation = await exposure(database.pool, monetaryExposureRequest());
    assert.equal(futureCalculation.loss_usage_availability, "UNAVAILABLE");
    assert.ok(futureCalculation.reason_codes.includes("THEORETICAL_CLOSED_TRADE_OUTCOME_UNAVAILABLE"));
  } finally {
    await database.close();
  }
});

test("a qualified signal stays rejected in a later batch after its theoretical intent is terminal", { skip: process.env.RUN_POSTGRES_TESTS !== "1" }, async () => {
  const database = await createTheoreticalTestDatabase();
  try {
    const repository = new PostgresPortfolioRiskRuntimeRepository({ pool: database.pool, initialized: Promise.resolve() });
    const service = new PortfolioRiskRuntimeService({ repository, clock: { now: () => ({ utc: NOW }) } });
    const first = await service.runPipeline(command(signal({ signal_id: "signal-qualified", direction: "LONG" })));
    const originalIntent = first.intents.order_intents[0].order_intent_id;
    await database.pool.query(`INSERT INTO trade_theoretical_execution_events
      (theoretical_execution_event_id, portfolio_order_intent_id, event_type, event_at_utc, payload, raw)
      VALUES ('terminal-qualified',$1,'entry_expired','2026-09-05T14:06:00.000Z','{}','{}')`, [originalIntent]);
    const later = await service.runPipeline(command([
      signal({ signal_id: "signal-qualified", direction: "LONG" }),
      signal({ signal_id: "signal-new-batch", direction: "SHORT", instrument: "ZW" }),
    ], 4, LATER));

    assert.equal(later.intents.order_intents.length, 1);
    assert.equal(later.intents.order_intents[0].instrument, "ZW");
    const rejected = later.allocations.rejected_signals.find((item) => item.signal_id === "signal-qualified");
    assert.ok(rejected.issues.some((item) => item.code === "PORTFOLIO_THEORETICAL_SIGNAL_ALREADY_QUALIFIED"));
    const run = (await database.pool.query("SELECT signal_ids FROM portfolio_arbitration_runs WHERE portfolio_arbitration_run_id = $1", [later.persistence.portfolio_arbitration_run_id])).rows[0];
    assert.deepEqual(run.signal_ids.sort(), ["signal-new-batch", "signal-qualified"]);
  } finally {
    await database.close();
  }
});

test("atomic as-of snapshot uses persisted final theoretical outcomes for daily and weekly loss", { skip: process.env.RUN_POSTGRES_TESTS !== "1" }, async () => {
  const database = await createTheoreticalTestDatabase();
  try {
    const repository = new PostgresPortfolioRiskRuntimeRepository({ pool: database.pool, initialized: Promise.resolve() });
    const service = new PortfolioRiskRuntimeService({ repository, clock: { now: () => ({ utc: NOW }) } });
    const first = await service.runPipeline(command(signal({ signal_id: "signal-loss-evidence" })));
    const intentId = first.intents.order_intents[0].order_intent_id;
    await insertEntryEventWithoutTrade(database.pool, intentId);
    const beforeTrade = await database.pool.connect();
    try {
      const snapshot = await loadTheoreticalExposureAsOf(beforeTrade, exposureRequest());
      assert.deepEqual(snapshot.reservation_instruments, ["ZC"]);
    } finally { beforeTrade.release(); }
    await insertFinalOutcome(database.pool, { tradeId: "theory-final-loss", intentId, resultR: -1, finalizedAtUtc: "2026-09-05T14:04:00.000Z" });
    await insertFinalOutcome(database.pool, { tradeId: "theory-future-loss", intentId, resultR: -3, finalizedAtUtc: "2026-09-05T14:06:00.000Z" });

    const client = await database.pool.connect();
    try {
      const snapshot = await loadTheoreticalExposureAsOf(client, exposureRequest());
      assert.equal(snapshot.loss_usage_availability, "KNOWN");
      assert.equal(snapshot.loss_usage.daily_realized_r, -1);
      assert.equal(snapshot.loss_usage.weekly_realized_r, -1);
      assert.equal(snapshot.loss_usage.final_outcome_count, 1);
      assert.equal(snapshot.loss_usage.provenance, "THEORETICAL_FINAL_OUTCOMES");
      assert.deepEqual(snapshot.reservation_instruments, []);
    } finally { client.release(); }

    const blocked = await service.runPipeline({
      ...command(signal({ signal_id: "signal-after-loss", instrument: "ZW" })),
      risk_budget: { max_portfolio_abs_size: 4, max_daily_loss_r: 1, max_weekly_loss_r: 2 },
    });
    assert.equal(blocked.risk.status, "BLOCK");
    assert.equal(blocked.targets.target_positions.length, 0);
    assert.equal(blocked.intents.order_intents.length, 0);
    assert.ok(blocked.risk.allocation_evaluations[0].reason_codes.includes("DAILY_LOSS_R"));
    await insertFinalOutcome(database.pool, {
      tradeId: "unproven-final-loss", intentId, resultR: -9, finalizedAtUtc: "2026-09-05T14:04:30.000Z", source: "manual_unverified",
    });
    const unproven = await database.pool.connect();
    try {
      const snapshot = await loadTheoreticalExposureAsOf(unproven, exposureRequest());
      assert.equal(snapshot.loss_usage_availability, "UNAVAILABLE");
      assert.equal(snapshot.availability, "PARTIAL");
      assert.ok(snapshot.reason_codes.includes("THEORETICAL_FINAL_OUTCOME_PROVENANCE_UNAVAILABLE"));
    } finally { unproven.release(); }
  } finally {
    await database.close();
  }
});

test("realized-loss periods use documented UTC day and week boundaries", { skip: process.env.RUN_POSTGRES_TESTS !== "1" }, async () => {
  const database = await createTheoreticalTestDatabase();
  try {
    const repository = new PostgresPortfolioRiskRuntimeRepository({ pool: database.pool, initialized: Promise.resolve() });
    const service = new PortfolioRiskRuntimeService({ repository, clock: { now: () => ({ utc: NOW }) } });
    const first = await service.runPipeline(command(signal({ signal_id: "signal-utc-boundary" })));
    const intentId = first.intents.order_intents[0].order_intent_id;
    await insertFinalOutcome(database.pool, { tradeId: "prior-week-loss", intentId, resultR: -4, finalizedAtUtc: "2026-09-04T23:59:00.000Z" });
    await insertFinalOutcome(database.pool, { tradeId: "current-week-loss", intentId, resultR: -1, finalizedAtUtc: "2026-09-07T00:01:00.000Z" });
    const client = await database.pool.connect();
    try {
      const snapshot = await loadTheoreticalExposureAsOf(client, { ...exposureRequest(), as_of_utc: MONDAY });
      assert.equal(snapshot.loss_usage_availability, "KNOWN");
      assert.equal(snapshot.loss_usage.period_timezone, "UTC");
      assert.equal(snapshot.loss_usage.daily_realized_r, -1);
      assert.equal(snapshot.loss_usage.weekly_realized_r, -1);
      assert.equal(snapshot.loss_usage.final_outcome_count, 2);
    } finally { client.release(); }
  } finally {
    await database.close();
  }
});

test("closed theoretical trade without a final outcome is unavailable only after its close", { skip: process.env.RUN_POSTGRES_TESTS !== "1" }, async () => {
  const database = await createTheoreticalTestDatabase();
  try {
    const repository = new PostgresPortfolioRiskRuntimeRepository({ pool: database.pool, initialized: Promise.resolve() });
    const service = new PortfolioRiskRuntimeService({ repository, clock: { now: () => ({ utc: NOW }) } });
    const first = await service.runPipeline(command(signal({ signal_id: "signal-missing-outcome" })));
    await insertClosedTradeWithoutOutcome(database.pool, {
      tradeId: "closed-without-outcome", intentId: first.intents.order_intents[0].order_intent_id, closedAtUtc: "2026-09-05T14:04:00.000Z",
    });
    const client = await database.pool.connect();
    try {
      const beforeClose = await loadTheoreticalExposureAsOf(client, { ...exposureRequest(), as_of_utc: "2026-09-05T14:03:00.000Z" });
      assert.equal(beforeClose.loss_usage_availability, "KNOWN");
      assert.equal(beforeClose.loss_usage.daily_realized_r, 0);
      const afterClose = await loadTheoreticalExposureAsOf(client, exposureRequest());
      assert.equal(afterClose.loss_usage_availability, "UNAVAILABLE");
      assert.ok(afterClose.reason_codes.includes("THEORETICAL_CLOSED_TRADE_OUTCOME_UNAVAILABLE"));
    } finally { client.release(); }
  } finally {
    await database.close();
  }
});

function command(item, maxPortfolio = 4, asOf = NOW) {
  return {
    as_of_utc: asOf, account_id: "shadow-grains", portfolio_scope: "shadow-grains", execution_mode: "SHADOW",
    signals: Array.isArray(item) ? item : [item], risk_budget: { budget_id: "grains-test", max_portfolio_abs_size: maxPortfolio, max_account_abs_size: { "shadow-grains": maxPortfolio }, max_instrument_abs_size: { ZC: 2, ZW: 2 } },
    execution_policy: { provider_id: "provider-neutral-shadow", broker_account_id: "shadow-grains", submission_enabled: false, order_type: "LIMIT" },
    default_protection_plan: { stop_price: 95, target_price: 105 },
  };
}

function signal(overrides = {}) {
  return {
    signal_id: "signal-zc", strategy_instance_id: "grains-instance", strategy_version_id: "grains-version",
    instrument: "ZC", direction: "LONG", proposed_size: 1, execution_mode_origin: "SHADOW",
    generated_at_utc: "2026-09-05T14:00:00.000Z", expires_at_utc: "2026-09-05T14:30:00.000Z", status: "ACTIVE",
    proposed_trade_plan: { instrument: "ZC", direction: "LONG", order_type: "LIMIT", entry: { price: 100 }, stop: { price: 95 }, targets: [{ price: 105 }] },
    ...overrides,
  };
}

function exposureRequest() {
  return { as_of_utc: NOW, account_id: "shadow-grains", portfolio_scope: "shadow-grains", execution_mode: "SHADOW", instruments: ["ZC"] };
}

function monetaryExposureRequest() {
  return {
    ...exposureRequest(),
    risk_budget: { max_monetary_risk_currency: "USD" },
  };
}

async function exposure(pool, request) {
  const client = await pool.connect();
  try { return await loadTheoreticalExposureAsOf(client, request); }
  finally { client.release(); }
}

async function insertMonetaryIntent(pool, intentId) {
  const hash = `sha256:${"7".repeat(64)}`;
  const plan = { availability: "KNOWN", economics: { availability: "KNOWN", currency: "USD", risk_per_contract: 500 } };
  const risk = { availability: "KNOWN", risk_amount: 1000, risk_per_contract: 500 };
  const snapshot = { availability: "KNOWN", currency: "USD", risk_amount: 1000, risk_per_contract: 500 };
  await pool.query(`INSERT INTO portfolio_arbitration_runs
    (portfolio_arbitration_run_id,idempotency_key,portfolio_scope,account_id,status,as_of_utc,plan_hash,payload_hash)
    VALUES ($1,$1,'shadow-grains','shadow-grains','ORDER_INTENTS_READY','2026-09-05T14:00Z',$2,$2)`, [intentId, hash]);
  await pool.query(`INSERT INTO portfolio_target_positions
    (target_position_id,portfolio_arbitration_run_id,account_id,instrument,net_direction,status,computed_at_utc,
      target_hash,payload_hash,approved_trade_plan,risk_allocation)
    VALUES ($1,$1,'shadow-grains','ZC','LONG','TARGETED','2026-09-05T14:00Z',$2,$2,$3,$4)`, [intentId, hash, plan, risk]);
  await pool.query(`INSERT INTO portfolio_order_intent_lineage
    (portfolio_order_intent_id,target_position_id,idempotency_key,status,quantity,order_intent_hash,payload_hash,
      payload,risk_snapshot,created_at_utc)
    VALUES ($1,$1,$1,'READY',2,$2,$2,$3,$4,'2026-09-05T14:00Z')`, [intentId, hash, { action: "BUY", approved_trade_plan: plan }, snapshot]);
}

async function insertPartiallyClosedTrade(pool, intentId) {
  const tradeId = `trade:${intentId}`;
  await pool.query(`INSERT INTO trades
    (trade_id,portfolio_order_intent_id,status,side,quantity_planned,quantity_open,quantity_closed,opened_at,raw)
    VALUES ($1,$2,'open','long',2,1,1,'2026-09-05T14:01Z','{"source":"theoretical_execution_engine"}')`, [tradeId, intentId]);
  await pool.query(`INSERT INTO trade_fills (trade_fill_id,trade_id,side,quantity,price,filled_at,raw)
    VALUES ($1,$2,'buy',2,100,'2026-09-05T14:01Z','{}'),($3,$2,'sell',1,99,'2026-09-05T14:03Z','{}')`,
  [`entry:${tradeId}`, tradeId, `partial-exit:${tradeId}`]);
  await pool.query(`INSERT INTO trade_theoretical_execution_events
    (theoretical_execution_event_id,portfolio_order_intent_id,trade_id,event_type,event_at_utc,payload,raw)
    VALUES ($1,$2,$3,'entry_filled','2026-09-05T14:01Z','{}','{}')`, [`entry-event:${tradeId}`, intentId, tradeId]);
}

async function closeMonetaryTrade(pool, intentId) {
  const tradeId = `trade:${intentId}`;
  await pool.query(`INSERT INTO trade_fills (trade_fill_id,trade_id,side,quantity,price,filled_at,raw)
    VALUES ($1,$2,'sell',1,95,'2026-09-05T14:04Z','{}')`, [`final-exit:${tradeId}`, tradeId]);
  await pool.query(`UPDATE trades SET status='closed',quantity_open=0,quantity_closed=2,closed_at='2026-09-05T14:04Z'
    WHERE trade_id=$1`, [tradeId]);
  await pool.query(`INSERT INTO trade_outcomes
    (trade_outcome_id,trade_id,revision,status,schema_version,engine_version,initial_risk_amount,
      gross_realized_pnl,total_fees,net_realized_pnl,result_r,evidence_hash,evidence,calculated_at_utc,finalized_at_utc)
    VALUES ($1,$2,1,'final','test-outcome-v1','test-engine',1000,-150,0,-150,-0.15,$3,'{}','2026-09-05T14:04Z','2026-09-05T14:04Z')`,
  [`outcome:${tradeId}`, tradeId, `sha256:${"8".repeat(64)}`]);
}

async function insertClosedMonetaryProfit(pool, intentId) {
  const tradeId = `trade:${intentId}`;
  await pool.query(`INSERT INTO trades
    (trade_id,portfolio_order_intent_id,status,side,quantity_planned,quantity_open,quantity_closed,opened_at,closed_at,raw)
    VALUES ($1,$2,'closed','long',2,0,2,'2026-09-05T14:01Z','2026-09-05T14:04Z',
      '{"source":"theoretical_execution_engine"}')`, [tradeId, intentId]);
  await pool.query(`INSERT INTO trade_fills (trade_fill_id,trade_id,side,quantity,price,filled_at,raw)
    VALUES ($1,$2,'buy',2,100,'2026-09-05T14:01Z','{}'),($3,$2,'sell',2,101,'2026-09-05T14:04Z','{}')`,
  [`entry:${tradeId}`, tradeId, `exit:${tradeId}`]);
  await pool.query(`INSERT INTO trade_theoretical_execution_events
    (theoretical_execution_event_id,portfolio_order_intent_id,trade_id,event_type,event_at_utc,payload,raw)
    VALUES ($1,$2,$3,'entry_filled','2026-09-05T14:01Z','{}','{}')`, [`entry-event:${tradeId}`, intentId, tradeId]);
  await pool.query(`INSERT INTO trade_outcomes
    (trade_outcome_id,trade_id,revision,status,schema_version,engine_version,initial_risk_amount,
      gross_realized_pnl,total_fees,net_realized_pnl,result_r,evidence_hash,evidence,calculated_at_utc,finalized_at_utc)
    VALUES ($1,$2,1,'final','test-outcome-v1','test-engine',1000,100,0,100,0.1,$3,'{}',
      '2026-09-05T14:04Z','2026-09-05T14:04Z')`,
  [`outcome:${tradeId}`, tradeId, `sha256:${"9".repeat(64)}`]);
}

async function count(pool, table) {
  return Number((await pool.query(`SELECT count(*)::integer AS count FROM ${table}`)).rows[0].count);
}

async function insertFinalOutcome(pool, { tradeId, intentId, resultR, finalizedAtUtc, source = "theoretical_execution_engine" }) {
  await pool.query(`INSERT INTO trades (
      trade_id, portfolio_order_intent_id, status, side, quantity_planned, quantity_open, quantity_closed, opened_at, closed_at, raw
    ) VALUES ($1,$2,'closed','long',1,0,1,'2026-09-05T14:01:00.000Z',$3,jsonb_build_object('source',$4::text))`, [tradeId, intentId, finalizedAtUtc, source]);
  await pool.query(`INSERT INTO trade_fills (trade_fill_id, trade_id, side, quantity, price, filled_at, raw)
    VALUES ($1,$2,'buy',1,100,'2026-09-05T14:01:00.000Z','{}'::jsonb),
           ($3,$2,'sell',1,99,$4,'{}'::jsonb)`, [
    `fill-entry:${tradeId}`, tradeId, `fill-exit:${tradeId}`, finalizedAtUtc,
  ]);
  await pool.query(`INSERT INTO trade_theoretical_execution_events
    (theoretical_execution_event_id, portfolio_order_intent_id, trade_id, event_type, event_at_utc, payload, raw)
    VALUES ($1,$2,$3,'entry_filled','2026-09-05T14:01:00.000Z','{}'::jsonb,'{}'::jsonb),
           ($4,$2,$3,'target_hit',$5,'{}'::jsonb,'{}'::jsonb)
    ON CONFLICT (theoretical_execution_event_id) DO NOTHING`, [
    `event-entry:${tradeId}`, intentId, tradeId, `event-exit:${tradeId}`, finalizedAtUtc,
  ]);
  await pool.query(`INSERT INTO trade_outcomes (
      trade_outcome_id, trade_id, revision, status, schema_version, engine_version, initial_risk_amount,
      gross_realized_pnl, total_fees, net_realized_pnl, result_r, evidence_hash, evidence, calculated_at_utc, finalized_at_utc
    ) VALUES ($1,$2,1,'final','test-outcome-v1','test-engine',100,-100,0,-100,$3,$4,'{}'::jsonb,$5,$5)`, [
    `outcome:${tradeId}`, tradeId, resultR, `sha256:${tradeId.padEnd(64, "a").slice(0, 64)}`, finalizedAtUtc,
  ]);
}

async function insertEntryEventWithoutTrade(pool, intentId) {
  await pool.query(`INSERT INTO trade_theoretical_execution_events
    (theoretical_execution_event_id, portfolio_order_intent_id, event_type, event_at_utc, payload, raw)
    VALUES ('event-entry:theory-final-loss',$1,'entry_filled','2026-09-05T14:01:00.000Z','{}'::jsonb,'{}'::jsonb)`, [intentId]);
}

async function insertClosedTradeWithoutOutcome(pool, { tradeId, intentId, closedAtUtc }) {
  await pool.query(`INSERT INTO trades (
      trade_id, portfolio_order_intent_id, status, side, quantity_planned, quantity_open, quantity_closed, opened_at, closed_at, raw
    ) VALUES ($1,$2,'closed','long',1,0,1,'2026-09-05T14:01:00.000Z',$3,'{"source":"theoretical_execution_engine"}'::jsonb)`, [tradeId, intentId, closedAtUtc]);
}
