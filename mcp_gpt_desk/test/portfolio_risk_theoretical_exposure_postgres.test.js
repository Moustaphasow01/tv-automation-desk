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

async function count(pool, table) {
  return Number((await pool.query(`SELECT count(*)::integer AS count FROM ${table}`)).rows[0].count);
}
