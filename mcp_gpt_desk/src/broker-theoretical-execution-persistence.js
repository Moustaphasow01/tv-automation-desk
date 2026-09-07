export function portfolioLineageToTheoreticalEntryCandidate(row = {}) {
  const payload = record(row.order_intent_payload) || record(row.payload) || {};
  const terms = record(row.execution_terms) || record(payload.execution_terms) || {};
  const approvedTradePlan = record(row.approved_trade_plan) || record(payload.approved_trade_plan) || {};
  const portfolioId = text(row.portfolio_order_intent_id || payload.order_intent_id);
  const requestedAt = validIso(payload.requested_at_utc || payload.requested_at || row.created_at_utc) || new Date(0).toISOString();
  const orderType = normalizeBrokerOrderType(payload.order_type || terms.order_type || approvedTradePlan.order_type || "LIMIT");
  const prices = portfolioCandidatePrices({ approvedTradePlan, payload, terms });
  return {
    order_intent_id: portfolioId,
    portfolio_order_intent_id: portfolioId,
    trade_order_intent_id: row.trade_order_intent_id || null,
    theoretical_source_kind: "PORTFOLIO_ORDER_INTENT_LINEAGE",
    trade_decision_id: null,
    broker_account_id: row.matched_broker_account_id || null,
    broker_contract_id: row.broker_contract_id || null,
    side: normalizeOrderSide(payload.action || terms.side || payload.side),
    order_type: orderType,
    quantity: positiveNumber(row.quantity ?? payload.quantity, 1),
    limit_price: orderType === "limit" || orderType === "stop_limit" ? prices.entryPrice : null,
    stop_price: orderType === "stop_market" || orderType === "stop_limit" ? prices.entryPrice : null,
    requested_at: requestedAt,
    expires_at: portfolioIntentExpiry(row, payload, requestedAt),
    bracket: { stop_price: prices.stopPrice, target_price: prices.targetPrice },
    payload: {
      ...payload,
      entry_price: prices.entryPrice,
      limit_price: orderType === "limit" || orderType === "stop_limit" ? prices.entryPrice : null,
      stop_price: orderType === "stop_market" || orderType === "stop_limit" ? prices.entryPrice : null,
      profit_target: prices.targetPrice,
      theoretical_source_kind: "PORTFOLIO_ORDER_INTENT_LINEAGE",
    },
    instrument_code: text(payload.instrument || terms.instrument || row.target_instrument).toUpperCase(),
    contract_instrument_code: text(row.contract_instrument_code || payload.instrument || terms.instrument || row.target_instrument).toUpperCase(),
    broker_symbol: row.broker_symbol || payload.provider_contract_ref?.provider_symbol || null,
    tick_size: firstNumberValue(approvedTradePlan.units?.tick_size, row.tick_size),
    point_value: firstNumberValue(approvedTradePlan.units?.point_value, row.point_value),
    decision_side: normalizeDecisionSide(payload.action || terms.side || payload.side),
    trading_date: tradingDate(requestedAt),
    session: payload.session || payload.market_session || null,
    strategy_id: approvedTradePlan.source_signal_id || payload.source?.signal_id || payload.source_signal_id || array(row.candidate_allocation_ids)[0] || null,
    entry_plan: {
      order_type: orderType,
      entry_price: prices.entryPrice,
      limit_price: orderType === "limit" || orderType === "stop_limit" ? prices.entryPrice : null,
      stop_price: orderType === "stop_market" || orderType === "stop_limit" ? prices.entryPrice : null,
    },
    risk_plan: { stop_price: prices.stopPrice, target_price: prices.targetPrice },
  };
}

function portfolioCandidatePrices({ approvedTradePlan, payload, terms }) {
  const entry = record(payload.entry) || record(terms.entry) || record(approvedTradePlan.entry) || {};
  const protection = record(payload.protection) || {};
  const stop = record(terms.stop) || record(approvedTradePlan.stop) || {};
  const targets = array(payload.targets).length ? array(payload.targets) : array(terms.targets).length ? array(terms.targets) : array(approvedTradePlan.targets);
  return {
    entryPrice: firstNumberValue(entry.price, entry.calculation_price, payload.entry_price, terms.entry_price, approvedTradePlan.entry_price),
    stopPrice: firstNumberValue(protection.stop_price, protection.protective_stop, stop.price, approvedTradePlan.stop_price),
    targetPrice: firstNumberValue(protection.target_price, protection.profit_target, targets[0]?.price, approvedTradePlan.target_price),
  };
}

export const PORTFOLIO_THEORETICAL_CANDIDATE_COLUMNS_SQL = String.raw`ba.broker_account_id AS matched_broker_account_id,
      c.broker_contract_id, c.broker_symbol,
      c.instrument_code AS contract_instrument_code, c.tick_size, c.point_value,
      COALESCE((
        SELECT array_remove(array_agg(DISTINCT a.candidate_allocation_id), NULL)
        FROM portfolio_target_position_allocations a
        WHERE a.target_position_id = t.target_position_id
      ), '{}') AS candidate_allocation_ids,
      COALESCE((
        SELECT array_remove(array_agg(DISTINCT r.risk_decision_id), NULL)
        FROM portfolio_target_position_risk_decisions r
        WHERE r.target_position_id = t.target_position_id
      ), '{}') AS risk_decision_ids`;

export const PORTFOLIO_THEORETICAL_BROKER_ACCOUNT_JOIN_SQL = String.raw`LEFT JOIN broker_accounts ba ON ba.broker_account_id = COALESCE(
      l.payload->>'broker_account_id',
      l.payload->>'account_id',
      t.account_id
    )`;

export const PORTFOLIO_THEORETICAL_CONTRACT_JOIN_SQL = String.raw`LEFT JOIN LATERAL (
      SELECT candidate.*
      FROM broker_contracts candidate
      WHERE candidate.broker_contract_id = COALESCE(
          l.payload #>> '{provider_contract_ref,provider_contract_id}',
          l.payload #>> '{provider_contract_ref,broker_contract_id}',
          l.payload->>'broker_contract_id'
        )
        OR (
          candidate.instrument_code = COALESCE(l.payload->>'instrument', t.instrument)
          AND candidate.active = true
        )
      ORDER BY CASE WHEN candidate.broker_contract_id = COALESCE(
          l.payload #>> '{provider_contract_ref,provider_contract_id}',
          l.payload #>> '{provider_contract_ref,broker_contract_id}',
          l.payload->>'broker_contract_id'
        ) THEN 0 ELSE 1 END,
        candidate.active DESC,
        candidate.expiry_date DESC NULLS LAST
      LIMIT 1
    ) c ON true`;

export async function latestTheoreticalEntryTerminal(client, { orderIntentId = null, portfolioOrderIntentId = null } = {}) {
  return one(client, `SELECT * FROM trade_theoretical_execution_events
    WHERE event_type IN ('entry_filled','entry_expired')
      AND (
        ($1::text IS NOT NULL AND order_intent_id = $1)
        OR ($2::text IS NOT NULL AND portfolio_order_intent_id = $2)
      )
    ORDER BY event_at_utc DESC LIMIT 1`, [orderIntentId, portfolioOrderIntentId]);
}

export async function lockedTheoreticalIntent(client, result) {
  const portfolioId = portfolioOrderIntentId(result);
  if (portfolioId) return lockedPortfolioIntent(client, portfolioId);
  return lockedIntent(client, result.order_intent_id);
}

async function lockedIntent(client, orderIntentId) {
  const intent = await one(client, "SELECT * FROM trade_order_intents WHERE order_intent_id = $1 FOR UPDATE", [orderIntentId]);
  if (!intent) throw repositoryError("ORDER_INTENT_NOT_FOUND", `Order intent not found: ${orderIntentId}.`);
  return intent;
}

async function lockedPortfolioIntent(client, portfolioOrderIntentIdValue) {
  const locked = await one(client, `SELECT portfolio_order_intent_id
    FROM portfolio_order_intent_lineage WHERE portfolio_order_intent_id = $1 FOR UPDATE`,
  [portfolioOrderIntentIdValue]);
  if (!locked) {
    throw repositoryError("PORTFOLIO_ORDER_INTENT_NOT_FOUND",
      `Portfolio OrderIntent not found: ${portfolioOrderIntentIdValue}.`);
  }
  const row = await one(client, `SELECT l.*, l.payload AS order_intent_payload,
      t.account_id AS target_account_id, t.instrument AS target_instrument,
      t.approved_trade_plan, t.risk_allocation, t.expected_exposure,
      t.lineage AS target_lineage, t.payload AS target_position_payload,
      g.human_execution_gate_id, g.status AS human_gate_status,
      g.expires_at_utc AS human_gate_expires_at_utc,
      EXISTS (
        SELECT 1 FROM portfolio_invalid_origin_adjudications adjudication
        WHERE adjudication.portfolio_order_intent_id=l.portfolio_order_intent_id
          AND adjudication.status='CANCELLED_INVALID_ORIGIN'
          AND adjudication.reservation_disposition='ADMINISTRATIVELY_RELEASED'
          AND adjudication.effective_at_utc <= clock_timestamp()
          AND adjudication.created_at_utc <= clock_timestamp()
      ) AS invalid_origin_administratively_cancelled,
      EXISTS (
        SELECT 1 FROM portfolio_administrative_reservation_cancellations cancellation
        WHERE cancellation.portfolio_order_intent_id=l.portfolio_order_intent_id
          AND cancellation.status='CANCELLED_ADMINISTRATIVE_NO_OPEN_EXPOSURE'
          AND cancellation.reservation_disposition='ADMINISTRATIVELY_RELEASED'
          AND cancellation.historical_outcome_disposition='UNDETERMINED_PRESERVED'
          AND cancellation.effective_at_utc <= clock_timestamp()
          AND cancellation.created_at_utc <= clock_timestamp()
      ) AS administratively_cancelled,
      ${PORTFOLIO_THEORETICAL_CANDIDATE_COLUMNS_SQL}
    FROM portfolio_order_intent_lineage l
    JOIN portfolio_target_positions t ON t.target_position_id = l.target_position_id
    LEFT JOIN human_execution_gates g ON g.portfolio_order_intent_id = l.portfolio_order_intent_id
    ${PORTFOLIO_THEORETICAL_BROKER_ACCOUNT_JOIN_SQL}
    ${PORTFOLIO_THEORETICAL_CONTRACT_JOIN_SQL}
    WHERE l.portfolio_order_intent_id = $1`, [portfolioOrderIntentIdValue]);
  if (!row) throw repositoryError("PORTFOLIO_ORDER_INTENT_NOT_FOUND", `Portfolio OrderIntent not found: ${portfolioOrderIntentIdValue}.`);
  if (row.invalid_origin_administratively_cancelled || row.administratively_cancelled) {
    throw repositoryError("THEORETICAL_INTENT_ADMINISTRATIVELY_CANCELLED",
      `Portfolio OrderIntent was administratively cancelled: ${portfolioOrderIntentIdValue}.`);
  }
  return portfolioLineageToTheoreticalEntryCandidate(row);
}

export async function lockedOpenTrade(client, tradeId) {
  const trade = await one(client, `SELECT t.*,EXISTS (
      SELECT 1 FROM trade_theoretical_administrative_resolutions resolution
      WHERE resolution.trade_id=t.trade_id
        AND resolution.status='ADMINISTRATIVELY_RESOLVED_NO_REAL_EXPOSURE'
        AND resolution.exposure_disposition='ADMINISTRATIVELY_RELEASED'
        AND resolution.effective_at_utc <= clock_timestamp()
        AND resolution.created_at_utc <= clock_timestamp()
    ) AS administratively_resolved
    FROM trades t WHERE t.trade_id = $1 FOR UPDATE`, [tradeId]);
  if (!trade) throw repositoryError("TRADE_NOT_FOUND", `Trade not found: ${tradeId}.`);
  if (trade.administratively_resolved === true) {
    return { event: null, status: "THEORETICAL_TRADE_ADMINISTRATIVELY_RESOLVED",
      reason: "NO_REAL_EXPOSURE_ATTESTED", trade_id: trade.trade_id };
  }
  if (trade.raw?.source !== "theoretical_execution_engine") return { event: null, status: "NO_OPEN_THEORETICAL_TRADE", reason: "NON_THEORETICAL_TRADE" };
  const open = ["open", "scaling", "protected"].includes(trade.status);
  if (!open || Number(trade.quantity_open || 0) <= 0) return { event: null, status: "NO_OPEN_THEORETICAL_TRADE" };
  return trade;
}

export function buildTheoreticalEntryTrade({ intent, decision, result, now }) {
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
    raw: theoreticalRaw(result, intent),
  };
}

function theoreticalRaw(result, intent = {}) {
  return {
    source: "theoretical_execution_engine",
    engine_version: result.engine_version,
    theoretical_source_kind: intent.theoretical_source_kind || null,
    portfolio_order_intent_id: portfolioOrderIntentId(intent),
    order_intent_id: legacyOrderIntentId(intent),
    instrument: result.instrument_code || intent.instrument_code || intent.contract_instrument_code || null,
    simulator_outcome: result.simulator_outcome || null,
    candle: result.candle || null,
    execution_units: { point_value: intent.point_value ?? null, tick_size: intent.tick_size ?? null },
    alert_only_manual_execution: true,
  };
}

export async function upsertTheoreticalTrade(client, trade) {
  await client.query(
    `INSERT INTO trades (
      trade_id, trade_decision_id, order_intent_id, portfolio_order_intent_id, broker_account_id, broker_contract_id, status, side,
      quantity_planned, quantity_open, avg_entry_price, initial_stop_price, current_stop_price,
      current_target_price, atm_strategy_id, opened_at, theoretical_cursor_at_utc, trading_date, session, strategy_id, raw
    ) VALUES ($1,$2,$3,$4,$5,$6,'open',$7::trade_side,$8,$8,$9,$10,$10,$11,$12,$13,$13,$14,$15,$16,$17::jsonb)
    ON CONFLICT (trade_id) DO UPDATE SET status = 'open',
      quantity_open = EXCLUDED.quantity_open,
      avg_entry_price = EXCLUDED.avg_entry_price,
      initial_stop_price = COALESCE(trades.initial_stop_price, EXCLUDED.initial_stop_price),
      current_stop_price = COALESCE(trades.current_stop_price, EXCLUDED.current_stop_price),
      current_target_price = COALESCE(trades.current_target_price, EXCLUDED.current_target_price),
      theoretical_cursor_at_utc = GREATEST(
        COALESCE(trades.theoretical_cursor_at_utc, trades.opened_at, EXCLUDED.theoretical_cursor_at_utc),
        EXCLUDED.theoretical_cursor_at_utc
      ),
      raw = trades.raw || EXCLUDED.raw,
      updated_at = now()`,
    [trade.tradeId, trade.intent.trade_decision_id || null, legacyOrderIntentId(trade.intent), portfolioOrderIntentId(trade.intent),
      trade.intent.broker_account_id, trade.intent.broker_contract_id,
      trade.side, trade.result.quantity, trade.result.price, trade.stopPrice, trade.targetPrice,
      trade.atmStrategyId, trade.eventAt, trade.tradingDate, trade.session, trade.strategyId, json(trade.raw)],
  );
}

export async function insertTheoreticalEntryFill(client, { intent, trade, result }) {
  await client.query(
    `INSERT INTO trade_fills (trade_fill_id, trade_id, broker_order_id, broker_fill_ref, side, quantity, price, filled_at, liquidity, raw)
     VALUES ($1,$2,NULL,$3,$4::order_side,$5,$6,$7,'unknown',$8::jsonb)`,
    [`trade_fill_${cryptoId()}`, trade.tradeId, `theoretical:${result.order_intent_id}:entry`,
      intent.side, result.quantity, result.price, trade.eventAt, json(trade.raw)],
  );
}

export async function markIntentTheoreticallyFilled(client, intent) {
  const portfolioId = portfolioOrderIntentId(intent);
  if (portfolioId) {
    // Portfolio OrderIntent lifecycle remains owned by the canonical
    // execution/gate state machines. The theoretical fill is recorded in
    // trade_theoretical_execution_events + trades and never promotes provider
    // execution status.
    return;
  }
  await client.query("UPDATE trade_order_intents SET status = 'acknowledged', updated_at = now() WHERE order_intent_id = $1", [legacyOrderIntentId(intent)]);
}

export async function insertTheoreticalTradeEvent(client, { trade, result, intent }) {
  await client.query(
    `INSERT INTO trade_events (trade_event_id, trade_id, event_type, status, occurred_at, payload, raw)
     VALUES ($1,$2,'order_filled','open',$3,$4::jsonb,$5::jsonb)`,
    [`trade_event_${cryptoId()}`, trade.tradeId, trade.eventAt,
      json({ quantity: result.quantity, price: result.price, order_type: intent.order_type, theoretical: true }),
      json(trade.raw)],
  );
}

export async function expireTheoreticalIntent(client, intent, eventAt) {
  const portfolioId = portfolioOrderIntentId(intent);
  if (portfolioId) {
    await client.query(`UPDATE portfolio_order_intent_lineage
      SET status = 'EXPIRED'
      WHERE portfolio_order_intent_id = $1
        AND status NOT IN ('REJECTED','EXPIRED','CANCELLED','SUPERSEDED')`, [portfolioId]);
    await client.query(`UPDATE human_execution_gates
      SET status = 'EXPIRED', updated_at_utc = $2::timestamptz
      WHERE portfolio_order_intent_id = $1
        AND status = 'AWAITING_MANUAL_CONFIRMATION'`, [portfolioId, eventAt]);
    return;
  }
  await client.query("UPDATE trade_order_intents SET status = 'expired', updated_at = $2::timestamptz WHERE order_intent_id = $1 AND status NOT IN ('cancelled','rejected','expired','superseded')", [legacyOrderIntentId(intent), eventAt]);
}

export function buildTheoreticalExit({ trade, result, now }) {
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

export async function updateTheoreticalExitTrade(client, { trade, exit }) {
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

export async function insertTheoreticalExitFill(client, { trade, exit }) {
  await client.query(
    `INSERT INTO trade_fills (trade_fill_id, trade_id, broker_order_id, broker_fill_ref, side, quantity, price, filled_at, liquidity, raw)
     VALUES ($1,$2,NULL,$3,$4::order_side,$5,$6,$7,'unknown',$8::jsonb)`,
    [`trade_fill_${cryptoId()}`, trade.trade_id, `theoretical:${trade.trade_id}:exit:${exit.eventAt}`,
      exit.exitSide, exit.quantity, exit.result.price, exit.eventAt, json(exit.raw)],
  );
}

export async function insertTheoreticalExitTradeEvent(client, { trade, exit }) {
  await client.query(
    `INSERT INTO trade_events (trade_event_id, trade_id, event_type, status, occurred_at, payload, raw)
     VALUES ($1,$2,$3::lifecycle_event_type,$4::trade_status,$5,$6::jsonb,$7::jsonb)`,
    [`trade_event_${cryptoId()}`, trade.trade_id, exit.lifecycleEventType, exit.nextStatus, exit.eventAt,
      json({ quantity: exit.quantity, quantity_open: exit.nextQuantity, price: exit.result.price, exit_reason: exit.result.exit_reason, theoretical: true }),
      json(exit.raw)],
  );
}

export async function insertTheoreticalEvent(client, { eventType, orderIntentId = null, portfolioOrderIntentId = null, tradeId = null, eventAt, result }) {
  const payload = theoreticalEventPayload(result);
  const intentRef = portfolioOrderIntentId || orderIntentId || tradeId;
  const row = await one(client, `INSERT INTO trade_theoretical_execution_events (
      theoretical_execution_event_id, order_intent_id, portfolio_order_intent_id, trade_id, event_type, event_at_utc,
      source_candle_feed_id, source_candle_timestamp_utc, quantity, price, idempotency_key, payload, raw
    ) VALUES ($1,$2,$3,$4,$5::theoretical_execution_event_type,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
    DO UPDATE SET payload = trade_theoretical_execution_events.payload || EXCLUDED.payload,
      raw = trade_theoretical_execution_events.raw || EXCLUDED.raw,
      updated_at_utc = now()
    RETURNING *`, [
    `theoretical_execution_event_${cryptoId()}`, orderIntentId, portfolioOrderIntentId, tradeId, eventType, eventAt,
    nested(result, "candle", "feed_id"), nested(result, "candle", "timestamp_utc"),
    value(result, "quantity"), value(result, "price"),
    `theoretical:${eventType}:${intentRef}:${eventAt}`,
    json(payload), json(result),
  ]);
  return row;
}

function theoreticalEventPayload(result) {
  return {
    schema_version: "theoretical_execution_event_v1",
    engine_version: value(result, "engine_version"),
    portfolio_order_intent_id: portfolioOrderIntentId(result),
    order_intent_id: legacyOrderIntentId(result),
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

export async function commitValue(client, valueToReturn) {
  await client.query("COMMIT");
  return valueToReturn;
}

export function boundLimit(limit) { return Math.max(1, Math.min(Number(limit) || 100, 500)); }
export function emptyTheoreticalBacklog() {
  return { eligible_open_trades: 0, due_open_trades: 0, oldest_cursor_at_utc: null, newest_cursor_at_utc: null };
}
export function normalizePortfolioOrderIntentIds(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => text(item)).filter(Boolean))]
    : [];
}
function value(object, key) {
  if (!object) return null;
  const actual = object[key];
  return actual === undefined ? null : actual;
}
function nested(object, section, key) {
  const inner = value(object, section);
  return value(inner, key);
}
export async function rows(client, sql, params = []) { return (await client.query(sql, params)).rows; }
export async function one(client, sql, params = []) { return (await client.query(sql, params)).rows[0] || null; }
export function json(valueToSerialize) { return JSON.stringify(valueToSerialize ?? {}); }
export function cryptoId() { return globalThis.crypto.randomUUID().replaceAll("-", ""); }
function repositoryError(code, message) { const error = new Error(message); error.code = code; error.statusCode = code.endsWith("NOT_FOUND") ? 404 : 409; return error; }
function record(valueToInspect) { return valueToInspect && typeof valueToInspect === "object" && !Array.isArray(valueToInspect) ? valueToInspect : null; }
function array(valueToInspect) { return Array.isArray(valueToInspect) ? valueToInspect.filter(Boolean) : []; }
export function text(valueToNormalize) { return String(valueToNormalize ?? "").trim(); }
function numberOrNull(valueToParse) {
  if (valueToParse === null || valueToParse === undefined || valueToParse === "" || typeof valueToParse === "boolean") return null;
  const parsed = Number(valueToParse);
  return Number.isFinite(parsed) ? parsed : null;
}
function positiveNumber(valueToParse, fallback) {
  const parsed = Number(valueToParse);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function firstNumberValue(...values) {
  for (const candidate of values) {
    const parsed = numberOrNull(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}
export function validIso(valueToParse) {
  const parsed = Date.parse(valueToParse || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function portfolioIntentExpiry(row, payload, requestedAt) {
  const tradePlanExpiry = earliestIso([
    payload.expires_at_utc,
    payload.expires_at,
    payload.valid_until_utc,
    payload.valid_until,
    payload.approved_trade_plan?.expires_at_utc,
    payload.approved_trade_plan?.expires_at,
    payload.approved_trade_plan?.valid_until_utc,
    payload.approved_trade_plan?.valid_until,
    row.source_signal_expires_at_utc,
  ]);
  if (tradePlanExpiry) return tradePlanExpiry;
  return validIso(row.human_gate_expires_at_utc)
    || new Date(Date.parse(requestedAt) + 30 * 60_000).toISOString();
}
function earliestIso(values = []) {
  const validValues = values.map(validIso).filter(Boolean).sort((left, right) => Date.parse(left) - Date.parse(right));
  return validValues[0] || null;
}
function normalizeBrokerOrderType(valueToNormalize) {
  const normalized = text(valueToNormalize).toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_+|_+$/g, "");
  if (normalized === "market") return "market";
  if (normalized === "limit") return "limit";
  if (normalized === "stop" || normalized === "stop_market") return "stop_market";
  if (normalized === "stop_limit") return "stop_limit";
  return "limit";
}
function normalizeOrderSide(valueToNormalize) {
  const normalized = text(valueToNormalize).toUpperCase();
  return normalized === "SELL" || normalized === "SHORT" ? "sell" : "buy";
}
function normalizeDecisionSide(valueToNormalize) {
  return normalizeOrderSide(valueToNormalize) === "sell" ? "short" : "long";
}
function tradingDate(iso) {
  const parsed = Date.parse(iso || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}
export function portfolioOrderIntentId(valueToInspect = {}) {
  return text(valueToInspect.portfolio_order_intent_id || valueToInspect.portfolioOrderIntentId) || null;
}
export function legacyOrderIntentId(valueToInspect = {}) {
  const portfolioId = portfolioOrderIntentId(valueToInspect);
  if (portfolioId) return valueToInspect.trade_order_intent_id || null;
  return text(valueToInspect.order_intent_id || valueToInspect.orderIntentId) || null;
}
export function candidateDecisionFromPortfolioIntent(intent = {}) {
  return {
    trade_decision_id: null,
    instrument_code: intent.instrument_code,
    side: intent.decision_side,
    trading_date: intent.trading_date,
    session: intent.session,
    strategy_id: intent.strategy_id,
    entry_plan: intent.entry_plan || {},
    risk_plan: intent.risk_plan || {},
  };
}
