import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export async function createTheoreticalTestDatabase() {
  const config = { host: "127.0.0.1", port: Number(process.env.DESK_TEST_PG_PORT || 5432),
    user: process.env.DESK_TEST_PG_USER || "desk", password: process.env.DESK_TEST_PG_PASSWORD || "desk_local_only",
    database: "postgres", connectionTimeoutMillis: 5000 };
  const admin = new pg.Client(config);
  await admin.connect();
  const name = `desk_td2_425_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const pool = new pg.Pool({ ...config, database: name, max: 4 });
  const close = async () => {
    await pool.end();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  };
  try {
    const dir = new URL("../../../infra/postgres/init/", import.meta.url);
    for (const filename of (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort()) {
      await pool.query(await readFile(new URL(filename, dir), "utf8"));
    }
    return { pool, ready: async () => {}, close };
  } catch (error) { await close(); throw error; }
}

const hash = `sha256:${"1".repeat(64)}`;
export async function seedAuthorizedIntent(pool, id, { status = "READY", gate = "AWAITING_MANUAL_CONFIRMATION", pointValue = 50 } = {}) {
  const units = { point_value: pointValue, tick_size: 0.25 };
  const plan = { entry: { price: 100 }, stop: { price: 95 }, targets: [{ price: 110 }],
    units, economics: { availability: "KNOWN", currency: "USD", units } };
  const payload = { instrument: "ZC", action: "BUY", quantity: 1, order_type: "LIMIT",
    requested_at_utc: "2026-09-04T14:00:00Z", expires_at_utc: "2026-09-04T14:03:00Z",
    approved_trade_plan: plan, protection: { ready: true, stop_price: 95, target_price: 110 } };
  await pool.query(`INSERT INTO portfolio_arbitration_runs
    (portfolio_arbitration_run_id,idempotency_key,portfolio_scope,account_id,status,as_of_utc,plan_hash,payload_hash)
    VALUES ($1,$1,'test','test','ORDER_INTENTS_READY','2026-09-04T14:00Z',$2,$2)`, [id, hash]);
  await pool.query(`INSERT INTO portfolio_target_positions
    (target_position_id,portfolio_arbitration_run_id,account_id,instrument,net_direction,status,computed_at_utc,
      target_hash,payload_hash,approved_trade_plan)
    VALUES ($1,$1,'test','ZC','LONG','TARGETED','2026-09-04T14:00Z',$2,$2,$3)`, [id, hash, plan]);
  await pool.query(`INSERT INTO portfolio_order_intent_lineage
    (portfolio_order_intent_id,target_position_id,idempotency_key,status,quantity,order_intent_hash,payload_hash,payload,created_at_utc)
    VALUES ($1,$1,$1,$2,1,$3,$3,$4,'2026-09-04T14:00Z')`, [id, status, hash, payload]);
  await pool.query(`INSERT INTO human_execution_gates
    (human_execution_gate_id,portfolio_order_intent_id,status,expires_at_utc,operator_id,confirmed_at_utc,terms_hash)
    VALUES ($1,$1,$2,'2026-09-04T14:03Z','test','2026-09-04T14:00Z',$3)`, [id, gate, hash]);
  return id;
}

export async function seedMinuteCandles(pool) {
  await pool.query(`INSERT INTO market_instruments(instrument_code,display_name) VALUES ('ZC','Test corn') ON CONFLICT DO NOTHING`);
  await pool.query(`INSERT INTO market_symbols(symbol_id,instrument_code,provider,symbol_code)
    VALUES ('td2_zc','ZC','synthetic','TD2-ZC')`);
  await pool.query(`INSERT INTO market_feeds(feed_id,symbol_id,instrument_code,timeframe,environment,provider)
    VALUES ('td2_zc','td2_zc','ZC','1','test','synthetic')`);
  await pool.query(`INSERT INTO market_candles(feed_id,timestamp_utc,symbol_code,timeframe,open,high,low,close)
    SELECT 'td2_zc',t,'TD2-ZC','1',102,103,101,102
    FROM generate_series('2026-09-04T14:00Z'::timestamptz,'2026-09-04T14:09Z',interval '1 minute') t`);
}
