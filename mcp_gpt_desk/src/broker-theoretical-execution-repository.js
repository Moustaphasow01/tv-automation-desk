import { materializeTradeOutcome } from "./broker-trade-outcome-repository.js";

export async function listTheoreticalEntryCandidates(repository, { limit = 100 } = {}) {
  await repository.ready();
  const bounded = boundLimit(limit);
  return rows(repository.pool, `SELECT i.*, d.instrument_code, d.side AS decision_side,
        d.trading_date, d.session, d.strategy_id, d.entry_plan, d.risk_plan,
        c.broker_symbol, c.instrument_code AS contract_instrument_code,
        c.tick_size, c.point_value
      FROM trade_order_intents i
      JOIN trade_decisions d ON d.trade_decision_id = i.trade_decision_id
      JOIN broker_contracts c ON c.broker_contract_id = i.broker_contract_id
      WHERE i.status IN ('pending_approval','approved','queued','sent','acknowledged')
        AND i.order_type IN ('market','limit','stop_market','stop_limit')
        AND NOT EXISTS (
          SELECT 1 FROM trade_theoretical_execution_events e
          WHERE e.order_intent_id = i.order_intent_id
            AND e.event_type IN ('entry_filled','entry_expired')
        )
        AND NOT EXISTS (
          SELECT 1 FROM trades t
          WHERE t.order_intent_id = i.order_intent_id
            AND t.status NOT IN ('cancelled','rejected','expired','error')
        )
      ORDER BY i.requested_at ASC
      LIMIT $1`, [bounded]);
}

export async function latestClosedCandleForIntent(repository, intent) {
  await repository.ready();
  const candles = await rows(repository.pool, `SELECT mc.*
      FROM market_candles mc
      JOIN market_feeds mf ON mf.feed_id = mc.feed_id
      WHERE mf.instrument_code = $1
        AND mc.timeframe = '1'
        AND mc.is_closed = true
        AND mc.timestamp_utc >= $2::timestamptz
      ORDER BY mc.timestamp_utc ASC
      LIMIT 500`, [
    intent.contract_instrument_code || intent.instrument_code,
    intent.requested_at,
  ]);
  return candles.find((candle) => intentEntryTouched(intent, candle)) || candles.at(-1) || null;
}

export async function recordTheoreticalEntryFill(repository, { result, now }) {
  await repository.ready();
  const client = await repository.pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await latestTheoreticalEntryFill(client, result.order_intent_id);
    if (existing) return await commitValue(client, { event: existing, idempotent: true });
    const intent = await lockedIntent(client, result.order_intent_id);
    const decision = await one(client, "SELECT * FROM trade_decisions WHERE trade_decision_id = $1", [intent.trade_decision_id]);
    const trade = buildTheoreticalEntryTrade({ intent, decision, result, now });
    await upsertTheoreticalTrade(client, trade);
    await insertTheoreticalEntryFill(client, { intent, trade, result });
    await markIntentAcknowledged(client, intent.order_intent_id);
    await insertTheoreticalTradeEvent(client, { trade, result, intent });
    const event = await insertTheoreticalEvent(client, {
      eventType: "entry_filled",
      orderIntentId: intent.order_intent_id,
      tradeId: trade.tradeId,
      eventAt: trade.eventAt,
      result,
    });
    await client.query("COMMIT");
    return { event, trade_id: trade.tradeId, idempotent: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordTheoreticalEntryExpired(repository, { result, now }) {
  await repository.ready();
  const client = await repository.pool.connect();
  try {
    await client.query("BEGIN");
    const intent = await lockedIntent(client, result.order_intent_id);
    const eventAt = result.event_at_utc || now;
    await expireIntent(client, intent.order_intent_id);
    const event = await insertTheoreticalEvent(client, {
      eventType: "entry_expired",
      orderIntentId: intent.order_intent_id,
      tradeId: null,
      eventAt,
      result,
    });
    await client.query("COMMIT");
    return { event, idempotent: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listTheoreticalOpenTrades(repository, { limit = 100 } = {}) {
  await repository.ready();
  const bounded = boundLimit(limit);
  return rows(repository.pool, `SELECT t.*, c.instrument_code, c.broker_symbol,
        COALESCE(last_event.last_event_at_utc, t.opened_at) AS theoretical_cursor_at_utc
      FROM trades t
      JOIN broker_contracts c ON c.broker_contract_id = t.broker_contract_id
      LEFT JOIN LATERAL (
        SELECT max(e.event_at_utc) AS last_event_at_utc
        FROM trade_theoretical_execution_events e
        WHERE e.trade_id = t.trade_id
      ) last_event ON true
      WHERE t.status IN ('open','scaling','protected')
        AND t.quantity_open > 0
        AND t.current_stop_price IS NOT NULL
        AND t.current_target_price IS NOT NULL
      ORDER BY t.updated_at ASC
      LIMIT $1`, [bounded]);
}

export async function latestClosedCandleForTrade(repository, trade) {
  await repository.ready();
  const candles = await rows(repository.pool, `SELECT mc.*
      FROM market_candles mc
      JOIN market_feeds mf ON mf.feed_id = mc.feed_id
      WHERE mf.instrument_code = $1
        AND mc.timeframe = '1'
        AND mc.is_closed = true
        AND mc.timestamp_utc > $2::timestamptz
      ORDER BY mc.timestamp_utc ASC
      LIMIT 500`, [
    trade.instrument_code,
    trade.theoretical_cursor_at_utc || trade.opened_at,
  ]);
  return candles.find((candle) => tradeExitTouched(trade, candle)) || candles.at(-1) || null;
}

export async function recordTheoreticalExitFill(repository, { result, now }) {
  await repository.ready();
  const client = await repository.pool.connect();
  try {
    await client.query("BEGIN");
    const trade = await lockedOpenTrade(client, result.trade_id);
    if (trade.status === "NO_OPEN_THEORETICAL_TRADE") return await commitValue(client, trade);
    const exit = buildTheoreticalExit({ trade, result, now });
    await updateTheoreticalExitTrade(client, { trade, exit });
    await insertTheoreticalExitFill(client, { trade, exit });
    await insertTheoreticalExitTradeEvent(client, { trade, exit });
    const event = await insertTheoreticalEvent(client, {
      eventType: exit.eventType,
      orderIntentId: trade.order_intent_id,
      tradeId: trade.trade_id,
      eventAt: exit.eventAt,
      result: { ...result, quantity: exit.quantity },
    });
    await materializeTradeOutcome(client, trade.trade_id, exit.eventAt);
    await client.query("COMMIT");
    return { event, trade_id: trade.trade_id, status: exit.nextStatus };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordTheoreticalReviewRequired(repository, { result, now }) {
  await repository.ready();
  const event = await insertTheoreticalEvent(repository.pool, {
    eventType: "exit_review_required",
    orderIntentId: null,
    tradeId: result.trade_id,
    eventAt: result.event_at_utc || now,
    result,
  });
  return { event };
}

export async function recordManualExecutionEvent(repository, { event }) {
  await repository.ready();
  const result = await repository.pool.query(
    `INSERT INTO trade_manual_execution_events (
       manual_execution_event_id, order_intent_id, trade_id, management_intent_id,
       event_type, source, actor, quantity, price, reason, occurred_at_utc,
       idempotency_key, payload, raw
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb)
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
     DO UPDATE SET payload = trade_manual_execution_events.payload || EXCLUDED.payload,
       raw = trade_manual_execution_events.raw || EXCLUDED.raw,
       updated_at_utc = now()
     RETURNING *`,
    [event.manual_execution_event_id || `manual_execution_event_${cryptoId()}`,
      event.order_intent_id || null, event.trade_id || null, event.management_intent_id || null,
      event.event_type, event.source || "front", event.actor || null,
      event.quantity ?? null, event.price ?? null, event.reason || null,
      event.occurred_at_utc, event.idempotency_key || null,
      json(event.payload), json(event.raw)],
  );
  return result.rows[0];
}

async function latestTheoreticalEntryFill(client, orderIntentId) {
  return one(client, `SELECT * FROM trade_theoretical_execution_events
    WHERE order_intent_id = $1 AND event_type = 'entry_filled'
    ORDER BY event_at_utc DESC LIMIT 1`, [orderIntentId]);
}

async function lockedIntent(client, orderIntentId) {
  const intent = await one(client, "SELECT * FROM trade_order_intents WHERE order_intent_id = $1 FOR UPDATE", [orderIntentId]);
  if (!intent) throw repositoryError("ORDER_INTENT_NOT_FOUND", `Order intent not found: ${orderIntentId}.`);
  return intent;
}

async function lockedOpenTrade(client, tradeId) {
  const trade = await one(client, "SELECT * FROM trades WHERE trade_id = $1 FOR UPDATE", [tradeId]);
  if (!trade) throw repositoryError("TRADE_NOT_FOUND", `Trade not found: ${tradeId}.`);
  const open = ["open", "scaling", "protected"].includes(trade.status);
  if (!open || Number(trade.quantity_open || 0) <= 0) return { event: null, status: "NO_OPEN_THEORETICAL_TRADE" };
  return trade;
}

function buildTheoreticalEntryTrade({ intent, decision, result, now }) {
  const eventAt = result.event_at_utc || now;
  return {
    intent,
    result,
    tradeId: `trade_${intent.order_intent_id}`,
    eventAt,
    side: intent.side === "sell" ? "short" : "long",
    stopPrice: intent.bracket?.stop_price || null,
    targetPrice: intent.bracket?.target_price || null,
    atmStrategyId: intent.payload?.atm_strategy_id || null,
    tradingDate: decision?.trading_date || null,
    session: decision?.session || null,
    strategyId: decision?.strategy_id || null,
    raw: theoreticalRaw(result),
  };
}

function theoreticalRaw(result) {
  return {
    source: "theoretical_execution_engine",
    engine_version: result.engine_version,
    simulator_outcome: result.simulator_outcome || null,
    candle: result.candle || null,
    alert_only_manual_execution: true,
  };
}

async function upsertTheoreticalTrade(client, trade) {
  await client.query(
    `INSERT INTO trades (
      trade_id, trade_decision_id, order_intent_id, broker_account_id, broker_contract_id, status, side,
      quantity_planned, quantity_open, avg_entry_price, initial_stop_price, current_stop_price,
      current_target_price, atm_strategy_id, opened_at, trading_date, session, strategy_id, raw
    ) VALUES ($1,$2,$3,$4,$5,'open',$6::trade_side,$7,$7,$8,$9,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
    ON CONFLICT (trade_id) DO UPDATE SET status = 'open',
      quantity_open = EXCLUDED.quantity_open,
      avg_entry_price = EXCLUDED.avg_entry_price,
      initial_stop_price = COALESCE(trades.initial_stop_price, EXCLUDED.initial_stop_price),
      current_stop_price = COALESCE(trades.current_stop_price, EXCLUDED.current_stop_price),
      current_target_price = COALESCE(trades.current_target_price, EXCLUDED.current_target_price),
      raw = trades.raw || EXCLUDED.raw,
      updated_at = now()`,
    [trade.tradeId, trade.intent.trade_decision_id, trade.intent.order_intent_id, trade.intent.broker_account_id, trade.intent.broker_contract_id,
      trade.side, trade.result.quantity, trade.result.price, trade.stopPrice, trade.targetPrice,
      trade.atmStrategyId, trade.eventAt, trade.tradingDate, trade.session, trade.strategyId, json(trade.raw)],
  );
}

async function insertTheoreticalEntryFill(client, { intent, trade, result }) {
  await client.query(
    `INSERT INTO trade_fills (trade_fill_id, trade_id, broker_order_id, broker_fill_ref, side, quantity, price, filled_at, liquidity, raw)
     VALUES ($1,$2,NULL,$3,$4::order_side,$5,$6,$7,'unknown',$8::jsonb)`,
    [`trade_fill_${cryptoId()}`, trade.tradeId, `theoretical:${result.order_intent_id}:entry`,
      intent.side, result.quantity, result.price, trade.eventAt, json(trade.raw)],
  );
}

async function markIntentAcknowledged(client, orderIntentId) {
  await client.query("UPDATE trade_order_intents SET status = 'acknowledged', updated_at = now() WHERE order_intent_id = $1", [orderIntentId]);
}

async function insertTheoreticalTradeEvent(client, { trade, result, intent }) {
  await client.query(
    `INSERT INTO trade_events (trade_event_id, trade_id, event_type, status, occurred_at, payload, raw)
     VALUES ($1,$2,'order_filled','open',$3,$4::jsonb,$5::jsonb)`,
    [`trade_event_${cryptoId()}`, trade.tradeId, trade.eventAt,
      json({ quantity: result.quantity, price: result.price, order_type: intent.order_type, theoretical: true }),
      json(trade.raw)],
  );
}

async function expireIntent(client, orderIntentId) {
  await client.query("UPDATE trade_order_intents SET status = 'expired', updated_at = now() WHERE order_intent_id = $1 AND status NOT IN ('cancelled','rejected','expired','superseded')", [orderIntentId]);
}

function buildTheoreticalExit({ trade, result, now }) {
  const eventAt = result.event_at_utc || now;
  const quantity = Math.min(Number(trade.quantity_open || 0), Number(result.quantity || 0));
  if (!(quantity > 0)) throw repositoryError("THEORETICAL_EXIT_QUANTITY_INVALID", "Theoretical exit quantity must be positive.");
  const nextQuantity = Math.max(0, Number(trade.quantity_open || 0) - quantity);
  return {
    eventAt,
    quantity,
    nextQuantity,
    nextStatus: nextQuantity === 0 ? "closed" : "protected",
    exitSide: trade.side === "long" ? "sell" : "buy",
    eventType: result.exit_reason === "target" ? "target_hit" : "stop_hit",
    lifecycleEventType: result.exit_reason === "target" ? "target_hit" : (nextQuantity === 0 ? "trade_closed" : "partial_fill"),
    raw: theoreticalExitRaw(result),
    result,
  };
}

function theoreticalExitRaw(result) {
  return {
    source: "theoretical_execution_engine",
    engine_version: result.engine_version,
    simulator_outcome: result.simulator_outcome || null,
    candle: result.candle || null,
    exit_reason: result.exit_reason || null,
  };
}

async function updateTheoreticalExitTrade(client, { trade, exit }) {
  await client.query(
    `UPDATE trades SET quantity_open = $2::numeric, quantity_closed = quantity_closed + $3::numeric,
      status = $4::trade_status,
      avg_exit_price = CASE WHEN quantity_closed + $3::numeric > 0
        THEN ((COALESCE(avg_exit_price,0) * quantity_closed) + ($5::numeric * $3::numeric)) / (quantity_closed + $3::numeric)
        ELSE avg_exit_price END,
      closed_at = CASE WHEN $2::numeric = 0 THEN $6::timestamptz ELSE closed_at END,
      revision = revision + 1, raw = raw || $7::jsonb, updated_at = now()
     WHERE trade_id = $1`,
    [trade.trade_id, exit.nextQuantity, exit.quantity, exit.nextStatus, exit.result.price,
      exit.eventAt, json({ last_theoretical_exit: exit.raw })],
  );
}

async function insertTheoreticalExitFill(client, { trade, exit }) {
  await client.query(
    `INSERT INTO trade_fills (trade_fill_id, trade_id, broker_order_id, broker_fill_ref, side, quantity, price, filled_at, liquidity, raw)
     VALUES ($1,$2,NULL,$3,$4::order_side,$5,$6,$7,'unknown',$8::jsonb)`,
    [`trade_fill_${cryptoId()}`, trade.trade_id, `theoretical:${trade.trade_id}:exit:${exit.eventAt}`,
      exit.exitSide, exit.quantity, exit.result.price, exit.eventAt, json(exit.raw)],
  );
}

async function insertTheoreticalExitTradeEvent(client, { trade, exit }) {
  await client.query(
    `INSERT INTO trade_events (trade_event_id, trade_id, event_type, status, occurred_at, payload, raw)
     VALUES ($1,$2,$3::lifecycle_event_type,$4::trade_status,$5,$6::jsonb,$7::jsonb)`,
    [`trade_event_${cryptoId()}`, trade.trade_id, exit.lifecycleEventType, exit.nextStatus, exit.eventAt,
      json({ quantity: exit.quantity, quantity_open: exit.nextQuantity, price: exit.result.price, exit_reason: exit.result.exit_reason, theoretical: true }),
      json(exit.raw)],
  );
}

async function insertTheoreticalEvent(client, { eventType, orderIntentId = null, tradeId = null, eventAt, result }) {
  const payload = theoreticalEventPayload(result);
  const row = await one(client, `INSERT INTO trade_theoretical_execution_events (
      theoretical_execution_event_id, order_intent_id, trade_id, event_type, event_at_utc,
      source_candle_feed_id, source_candle_timestamp_utc, quantity, price, idempotency_key, payload, raw
    ) VALUES ($1,$2,$3,$4::theoretical_execution_event_type,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
    DO UPDATE SET payload = trade_theoretical_execution_events.payload || EXCLUDED.payload,
      raw = trade_theoretical_execution_events.raw || EXCLUDED.raw,
      updated_at_utc = now()
    RETURNING *`, [
    `theoretical_execution_event_${cryptoId()}`, orderIntentId, tradeId, eventType, eventAt,
    nested(result, "candle", "feed_id"), nested(result, "candle", "timestamp_utc"),
    value(result, "quantity"), value(result, "price"),
    `theoretical:${eventType}:${orderIntentId || tradeId}:${eventAt}`,
    json(payload), json(result),
  ]);
  return row;
}

function theoreticalEventPayload(result) {
  return {
    schema_version: "theoretical_execution_event_v1",
    engine_version: value(result, "engine_version"),
    action: value(result, "action"),
    status: value(result, "status"),
    reason: value(result, "reason"),
    quantity: value(result, "quantity"),
    price: value(result, "price"),
    raw_price: value(result, "raw_price"),
    exit_reason: value(result, "exit_reason"),
    candle: value(result, "candle"),
  };
}

function intentEntryTouched(intent, candle) {
  const type = String(intent?.order_type || "").toLowerCase();
  if (type === "market") return true;
  if (type === "limit") return limitEntryTouched(intent, candle);
  if (type === "stop_market") return stopMarketEntryTouched(intent, candle);
  if (type === "stop_limit") return stopLimitEntryTouched(intent, candle);
  return false;
}

function limitEntryTouched(intent, candle) {
  const price = Number(intent?.limit_price);
  if (!Number.isFinite(price)) return false;
  return entrySide(intent) === "buy" ? candleLow(candle) <= price : candleHigh(candle) >= price;
}

function stopMarketEntryTouched(intent, candle) {
  const price = Number(intent?.stop_price);
  if (!Number.isFinite(price)) return false;
  return entrySide(intent) === "buy" ? candleHigh(candle) >= price : candleLow(candle) <= price;
}

function stopLimitEntryTouched(intent, candle) {
  const stop = Number(intent?.stop_price);
  const limit = Number(intent?.limit_price);
  if (!Number.isFinite(stop) || !Number.isFinite(limit)) return false;
  const buy = entrySide(intent) === "buy";
  return buy ? candleHigh(candle) >= stop && candleLow(candle) <= limit : candleLow(candle) <= stop && candleHigh(candle) >= limit;
}

function tradeExitTouched(trade, candle) {
  if (String(trade?.side || "").toLowerCase() === "short") return shortExitTouched(trade, candle);
  return longExitTouched(trade, candle);
}

function shortExitTouched(trade, candle) {
  return priceTouched(candleHigh(candle), ">=", trade?.current_stop_price ?? trade?.initial_stop_price)
    || priceTouched(candleLow(candle), "<=", trade?.current_target_price);
}

function longExitTouched(trade, candle) {
  return priceTouched(candleLow(candle), "<=", trade?.current_stop_price ?? trade?.initial_stop_price)
    || priceTouched(candleHigh(candle), ">=", trade?.current_target_price);
}

function priceTouched(actual, operator, expected) {
  const price = Number(expected);
  if (!Number.isFinite(actual) || !Number.isFinite(price)) return false;
  return operator === ">=" ? actual >= price : actual <= price;
}

async function commitValue(client, valueToReturn) {
  await client.query("COMMIT");
  return valueToReturn;
}

function boundLimit(limit) { return Math.max(1, Math.min(Number(limit) || 100, 500)); }
function entrySide(intent) { return String(intent?.side || "").toLowerCase(); }
function candleHigh(candle) { return Number(candle?.high); }
function candleLow(candle) { return Number(candle?.low); }
function value(object, key) {
  if (!object) return null;
  const actual = object[key];
  return actual === undefined ? null : actual;
}
function nested(object, section, key) {
  const inner = value(object, section);
  return value(inner, key);
}
async function rows(client, sql, params = []) { return (await client.query(sql, params)).rows; }
async function one(client, sql, params = []) { return (await client.query(sql, params)).rows[0] || null; }
function json(valueToSerialize) { return JSON.stringify(valueToSerialize ?? {}); }
function cryptoId() { return globalThis.crypto.randomUUID().replaceAll("-", ""); }
function repositoryError(code, message) { const error = new Error(message); error.code = code; error.statusCode = code.endsWith("NOT_FOUND") ? 404 : 409; return error; }
