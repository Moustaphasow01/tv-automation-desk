import { canonicalSha256 } from "@tv-automation/desk-domain";
import { materializeTradeOutcome } from "./broker-trade-outcome-repository.js";

export async function listTheoreticalEntryCandidates(repository, { limit = 100, portfolioOrderIntentIds = null } = {}) {
  await repository.ready();
  const bounded = boundLimit(limit);
  const hasPortfolioScope = Array.isArray(portfolioOrderIntentIds);
  const scopedPortfolioIds = normalizePortfolioOrderIntentIds(portfolioOrderIntentIds);
  if (hasPortfolioScope && scopedPortfolioIds.length === 0) return [];
  const legacyCandidates = hasPortfolioScope ? [] : await rows(repository.pool, `SELECT i.*, d.instrument_code, d.side AS decision_side,
        d.trading_date, d.session, d.strategy_id, d.entry_plan, d.risk_plan,
        NULL::text AS portfolio_order_intent_id,
        'LEGACY_TRADE_ORDER_INTENT' AS theoretical_source_kind,
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
  const portfolioCandidates = await rows(repository.pool, `SELECT l.*, l.payload AS order_intent_payload,
        t.account_id AS target_account_id, t.instrument AS target_instrument,
        t.approved_trade_plan, t.risk_allocation, t.expected_exposure,
        t.lineage AS target_lineage, t.payload AS target_position_payload,
        g.human_execution_gate_id, g.status AS human_gate_status,
        g.expires_at_utc AS human_gate_expires_at_utc,
        ss.signal_id AS source_strategy_signal_id,
        ss.generated_at_utc AS source_signal_generated_at_utc,
        ss.source_data_cutoff_utc AS source_signal_cutoff_utc,
        ss.expires_at_utc AS source_signal_expires_at_utc,
        ba.broker_account_id AS matched_broker_account_id,
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
        ), '{}') AS risk_decision_ids
      FROM portfolio_order_intent_lineage l
      JOIN portfolio_target_positions t ON t.target_position_id = l.target_position_id
      LEFT JOIN human_execution_gates g ON g.portfolio_order_intent_id = l.portfolio_order_intent_id
      LEFT JOIN broker_accounts ba ON ba.broker_account_id = COALESCE(
        l.payload->>'broker_account_id',
        l.payload->>'account_id',
        t.account_id
      )
      LEFT JOIN LATERAL (
        SELECT s.signal_id, s.generated_at_utc, s.source_data_cutoff_utc, s.expires_at_utc
        FROM strategy_signal_outbox s
        WHERE s.signal_id::text = ANY(ARRAY(
          SELECT DISTINCT signal_id
          FROM (
            SELECT jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(l.lineage->'strategy_signal_ids') = 'array'
                THEN l.lineage->'strategy_signal_ids'
                ELSE '[]'::jsonb
              END
            ) AS signal_id
            UNION ALL
            SELECT jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(l.payload #> '{source,lineage,strategy_signal_ids}') = 'array'
                THEN l.payload #> '{source,lineage,strategy_signal_ids}'
                ELSE '[]'::jsonb
              END
            ) AS signal_id
            UNION ALL SELECT NULLIF(l.payload->>'source_signal_id', '')
            UNION ALL SELECT NULLIF(l.payload #>> '{approved_trade_plan,source_signal_id}', '')
          ) signal_ids
          WHERE signal_id IS NOT NULL AND signal_id <> ''
        ))
        ORDER BY s.generated_at_utc DESC NULLS LAST
        LIMIT 1
      ) ss ON true
      LEFT JOIN LATERAL (
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
      ) c ON true
      WHERE l.status = 'READY'
        AND ($2::text[] IS NULL OR l.portfolio_order_intent_id = ANY($2::text[]))
        AND COALESCE((l.payload #>> '{protection,ready}')::boolean, true) = true
        AND l.quantity > 0
        AND NOT EXISTS (
          SELECT 1 FROM trade_theoretical_execution_events e
          WHERE e.portfolio_order_intent_id = l.portfolio_order_intent_id
            AND e.event_type IN ('entry_filled','entry_expired')
        )
        AND NOT EXISTS (
          SELECT 1 FROM trades tr
          WHERE tr.portfolio_order_intent_id = l.portfolio_order_intent_id
            AND tr.status NOT IN ('cancelled','rejected','expired','error')
        )
      ORDER BY l.created_at_utc ASC
      LIMIT $1`, [bounded, hasPortfolioScope ? scopedPortfolioIds : null]);
  return [...legacyCandidates, ...portfolioCandidates.map(portfolioLineageToTheoreticalEntryCandidate)]
    .sort((left, right) => Date.parse(left.requested_at || 0) - Date.parse(right.requested_at || 0))
    .slice(0, bounded);
}

export async function expireStalePortfolioHumanGates(repository, { limit = 200, now = new Date().toISOString(), portfolioOrderIntentIds = null } = {}) {
  await repository.ready();
  const bounded = boundLimit(limit);
  const hasPortfolioScope = Array.isArray(portfolioOrderIntentIds);
  const scopedPortfolioIds = normalizePortfolioOrderIntentIds(portfolioOrderIntentIds);
  if (hasPortfolioScope && scopedPortfolioIds.length === 0) return { expired: 0, items: [] };
  const client = await repository.pool.connect();
  const expired = [];
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT g.human_execution_gate_id, g.portfolio_order_intent_id, g.expires_at_utc,
              g.revision, g.payload
       FROM human_execution_gates g
       JOIN portfolio_order_intent_lineage l ON l.portfolio_order_intent_id = g.portfolio_order_intent_id
       WHERE g.status = 'AWAITING_MANUAL_CONFIRMATION'
         AND g.expires_at_utc IS NOT NULL
         AND g.expires_at_utc <= $1::timestamptz
         AND l.status = 'READY'
         AND ($3::text[] IS NULL OR g.portfolio_order_intent_id = ANY($3::text[]))
       ORDER BY g.expires_at_utc ASC
       LIMIT $2
       FOR UPDATE OF g, l SKIP LOCKED`,
      [now, bounded, hasPortfolioScope ? scopedPortfolioIds : null],
    );
    for (const gate of result.rows) {
      const payload = {
        expired_by: "theoretical_execution_sweeper",
        expired_at_utc: now,
        previous_status: "AWAITING_MANUAL_CONFIRMATION",
        reason: "HUMAN_GATE_EXPIRED",
      };
      await client.query(
        `UPDATE human_execution_gates
         SET status = 'EXPIRED',
             revision = revision + 1,
             reason = COALESCE(reason, 'HUMAN_GATE_EXPIRED'),
             payload = payload || $2::jsonb,
             updated_at_utc = now()
         WHERE human_execution_gate_id = $1
           AND status = 'AWAITING_MANUAL_CONFIRMATION'`,
        [gate.human_execution_gate_id, json(payload)],
      );
      await client.query(
        `UPDATE portfolio_order_intent_lineage
         SET status = 'EXPIRED'
         WHERE portfolio_order_intent_id = $1
           AND status = 'READY'`,
        [gate.portfolio_order_intent_id],
      );
      await client.query(
        `INSERT INTO portfolio_order_intent_execution_states (
           portfolio_order_intent_id, lifecycle_status, payload
         ) VALUES ($1, 'EXPIRED', $2::jsonb)
         ON CONFLICT (portfolio_order_intent_id) DO UPDATE SET
           lifecycle_status = 'EXPIRED',
           payload = portfolio_order_intent_execution_states.payload || EXCLUDED.payload,
           revision = portfolio_order_intent_execution_states.revision + 1,
           updated_at_utc = now()`,
        [gate.portfolio_order_intent_id, json(payload)],
      );
      await client.query(
        `INSERT INTO human_execution_gate_events (
          human_execution_gate_event_id, human_execution_gate_id, portfolio_order_intent_id,
          event_type, operator_id, idempotency_key, occurred_at_utc, payload_hash, payload
        ) VALUES ($1,$2,$3,'EXPIRED',NULL,$4,$5::timestamptz,$6,$7::jsonb)
        ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
        [
          `human_gate_event_${canonicalSha256({ gate_id: gate.human_execution_gate_id, event_type: "EXPIRED", expires_at_utc: gate.expires_at_utc }).slice(0, 24)}`,
          gate.human_execution_gate_id,
          gate.portfolio_order_intent_id,
          `human_gate_expired:${gate.human_execution_gate_id}:${new Date(gate.expires_at_utc).toISOString()}`,
          now,
          `sha256:${canonicalSha256(payload)}`,
          json(payload),
        ],
      );
      expired.push({
        human_execution_gate_id: gate.human_execution_gate_id,
        portfolio_order_intent_id: gate.portfolio_order_intent_id,
        expires_at_utc: validIso(gate.expires_at_utc),
      });
    }
    await client.query("COMMIT");
    return { expired: expired.length, items: expired };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function latestClosedCandleForIntent(repository, intent, { now = null } = {}) {
  await repository.ready();
  const upperBound = earliestIso([
    intent.expires_at,
    now,
  ]);
  const candles = await rows(repository.pool, `SELECT mc.*
      FROM market_candles mc
      JOIN market_feeds mf ON mf.feed_id = mc.feed_id
      WHERE mf.instrument_code = $1
        AND mc.timeframe = '1'
        AND mc.is_closed = true
        AND mc.timestamp_utc > $2::timestamptz
        AND ($3::timestamptz IS NULL OR mc.timestamp_utc <= $3::timestamptz)
      ORDER BY mc.timestamp_utc ASC
      LIMIT 500`, [
    intent.contract_instrument_code || intent.instrument_code,
    intent.requested_at,
    upperBound,
  ]);
  return candles.find((candle) => intentEntryTouched(intent, candle)) || candles.at(-1) || null;
}

export async function recordTheoreticalEntryFill(repository, { result, now }) {
  await repository.ready();
  const client = await repository.pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await latestTheoreticalEntryFill(client, {
      orderIntentId: legacyOrderIntentId(result),
      portfolioOrderIntentId: portfolioOrderIntentId(result),
    });
    if (existing) return await commitValue(client, { event: existing, idempotent: true });
    const intent = await lockedTheoreticalIntent(client, result);
    const decision = intent.trade_decision_id
      ? await one(client, "SELECT * FROM trade_decisions WHERE trade_decision_id = $1", [intent.trade_decision_id])
      : candidateDecisionFromPortfolioIntent(intent);
    const trade = buildTheoreticalEntryTrade({ intent, decision, result, now });
    await upsertTheoreticalTrade(client, trade);
    await insertTheoreticalEntryFill(client, { intent, trade, result });
    await markIntentTheoreticallyFilled(client, intent);
    await insertTheoreticalTradeEvent(client, { trade, result, intent });
    const event = await insertTheoreticalEvent(client, {
      eventType: "entry_filled",
      orderIntentId: legacyOrderIntentId(intent),
      portfolioOrderIntentId: portfolioOrderIntentId(intent),
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
    const existing = await latestTheoreticalEntryExpired(client, {
      orderIntentId: legacyOrderIntentId(result),
      portfolioOrderIntentId: portfolioOrderIntentId(result),
    });
    if (existing) return await commitValue(client, { event: existing, idempotent: true });
    const intent = await lockedTheoreticalIntent(client, result);
    const eventAt = result.event_at_utc || now;
    await expireTheoreticalIntent(client, intent);
    const event = await insertTheoreticalEvent(client, {
      eventType: "entry_expired",
      orderIntentId: legacyOrderIntentId(intent),
      portfolioOrderIntentId: portfolioOrderIntentId(intent),
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

export async function listTheoreticalOpenTrades(repository, { limit = 100, portfolioOrderIntentIds = null } = {}) {
  await repository.ready();
  const bounded = boundLimit(limit);
  const hasPortfolioScope = Array.isArray(portfolioOrderIntentIds);
  const scopedPortfolioIds = normalizePortfolioOrderIntentIds(portfolioOrderIntentIds);
  if (hasPortfolioScope && scopedPortfolioIds.length === 0) return [];
  return rows(repository.pool, `SELECT t.*,
        COALESCE(c.instrument_code, t.raw->>'instrument') AS instrument_code,
        c.broker_symbol,
        COALESCE(last_event.last_event_at_utc, t.opened_at) AS theoretical_cursor_at_utc
      FROM trades t
      LEFT JOIN broker_contracts c ON c.broker_contract_id = t.broker_contract_id
      LEFT JOIN LATERAL (
        SELECT max(e.event_at_utc) AS last_event_at_utc
        FROM trade_theoretical_execution_events e
        WHERE e.trade_id = t.trade_id
      ) last_event ON true
      WHERE t.status IN ('open','scaling','protected')
        AND t.quantity_open > 0
        AND t.current_stop_price IS NOT NULL
        AND t.current_target_price IS NOT NULL
        AND ($2::text[] IS NULL OR t.portfolio_order_intent_id = ANY($2::text[]))
      ORDER BY t.updated_at ASC
      LIMIT $1`, [bounded, hasPortfolioScope ? scopedPortfolioIds : null]);
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
      orderIntentId: trade.order_intent_id || null,
      portfolioOrderIntentId: trade.portfolio_order_intent_id || null,
      tradeId: trade.trade_id,
      eventAt: exit.eventAt,
      result: { ...result, order_intent_id: trade.order_intent_id || null, portfolio_order_intent_id: trade.portfolio_order_intent_id || null, quantity: exit.quantity },
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
    portfolioOrderIntentId: portfolioOrderIntentId(result),
    tradeId: result.trade_id,
    eventAt: result.event_at_utc || now,
    result,
  });
  return { event };
}

export async function recordManualExecutionEvent(repository, { event }) {
  await repository.ready();
  const portfolioOrderIntent = portfolioOrderIntentId(event);
  const orderIntent = portfolioOrderIntent ? null : event.order_intent_id || null;
  const result = await repository.pool.query(
    `INSERT INTO trade_manual_execution_events (
       manual_execution_event_id, order_intent_id, portfolio_order_intent_id, trade_id, management_intent_id,
       event_type, source, actor, quantity, price, reason, occurred_at_utc,
       idempotency_key, payload, raw
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb)
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
     DO UPDATE SET payload = trade_manual_execution_events.payload || EXCLUDED.payload,
       raw = trade_manual_execution_events.raw || EXCLUDED.raw,
       updated_at_utc = now()
     RETURNING *`,
    [event.manual_execution_event_id || `manual_execution_event_${cryptoId()}`,
      orderIntent, portfolioOrderIntent, event.trade_id || null, event.management_intent_id || null,
      event.event_type, event.source || "front", event.actor || null,
      event.quantity ?? null, event.price ?? null, event.reason || null,
      event.occurred_at_utc, event.idempotency_key || null,
      json(event.payload), json(event.raw)],
  );
  return result.rows[0];
}

export function portfolioLineageToTheoreticalEntryCandidate(row = {}) {
  const payload = record(row.order_intent_payload) || record(row.payload) || {};
  const terms = record(row.execution_terms) || record(payload.execution_terms) || {};
  const approvedTradePlan = record(row.approved_trade_plan) || record(payload.approved_trade_plan) || {};
  const entry = record(payload.entry) || record(terms.entry) || record(approvedTradePlan.entry) || {};
  const protection = record(payload.protection) || {};
  const stop = record(terms.stop) || record(approvedTradePlan.stop) || {};
  const targets = array(payload.targets).length ? array(payload.targets)
    : array(terms.targets).length ? array(terms.targets)
      : array(approvedTradePlan.targets);
  const portfolioId = text(row.portfolio_order_intent_id || payload.order_intent_id);
  const requestedAt = validIso(payload.requested_at_utc || payload.requested_at || row.created_at_utc) || new Date(0).toISOString();
  const orderType = normalizeBrokerOrderType(payload.order_type || terms.order_type || approvedTradePlan.order_type || "LIMIT");
  const entryPrice = firstNumberValue(
    entry.price,
    entry.calculation_price,
    payload.entry_price,
    terms.entry_price,
    approvedTradePlan.entry_price,
  );
  const stopPrice = firstNumberValue(
    protection.stop_price,
    protection.protective_stop,
    stop.price,
    approvedTradePlan.stop_price,
  );
  const targetPrice = firstNumberValue(
    protection.target_price,
    protection.profit_target,
    targets[0]?.price,
    approvedTradePlan.target_price,
  );
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
    limit_price: orderType === "limit" || orderType === "stop_limit" ? entryPrice : null,
    stop_price: orderType === "stop_market" || orderType === "stop_limit" ? entryPrice : null,
    requested_at: requestedAt,
    expires_at: portfolioIntentExpiry(row, payload, requestedAt),
    bracket: { stop_price: stopPrice, target_price: targetPrice },
    payload: {
      ...payload,
      entry_price: entryPrice,
      limit_price: orderType === "limit" || orderType === "stop_limit" ? entryPrice : null,
      stop_price: orderType === "stop_market" || orderType === "stop_limit" ? entryPrice : null,
      profit_target: targetPrice,
      theoretical_source_kind: "PORTFOLIO_ORDER_INTENT_LINEAGE",
    },
    instrument_code: text(payload.instrument || terms.instrument || row.target_instrument).toUpperCase(),
    contract_instrument_code: text(row.contract_instrument_code || payload.instrument || terms.instrument || row.target_instrument).toUpperCase(),
    broker_symbol: row.broker_symbol || payload.provider_contract_ref?.provider_symbol || null,
    tick_size: numberOrNull(row.tick_size),
    point_value: numberOrNull(row.point_value),
    decision_side: normalizeDecisionSide(payload.action || terms.side || payload.side),
    trading_date: tradingDate(requestedAt),
    session: payload.session || payload.market_session || null,
    strategy_id: approvedTradePlan.source_signal_id || payload.source?.signal_id || payload.source_signal_id || array(row.candidate_allocation_ids)[0] || null,
    entry_plan: {
      order_type: orderType,
      entry_price: entryPrice,
      limit_price: orderType === "limit" || orderType === "stop_limit" ? entryPrice : null,
      stop_price: orderType === "stop_market" || orderType === "stop_limit" ? entryPrice : null,
    },
    risk_plan: { stop_price: stopPrice, target_price: targetPrice },
  };
}

async function latestTheoreticalEntryFill(client, { orderIntentId = null, portfolioOrderIntentId = null } = {}) {
  return one(client, `SELECT * FROM trade_theoretical_execution_events
    WHERE event_type = 'entry_filled'
      AND (
        ($1::text IS NOT NULL AND order_intent_id = $1)
        OR ($2::text IS NOT NULL AND portfolio_order_intent_id = $2)
      )
    ORDER BY event_at_utc DESC LIMIT 1`, [orderIntentId, portfolioOrderIntentId]);
}

async function latestTheoreticalEntryExpired(client, { orderIntentId = null, portfolioOrderIntentId = null } = {}) {
  return one(client, `SELECT * FROM trade_theoretical_execution_events
    WHERE event_type = 'entry_expired'
      AND (
        ($1::text IS NOT NULL AND order_intent_id = $1)
        OR ($2::text IS NOT NULL AND portfolio_order_intent_id = $2)
      )
    ORDER BY event_at_utc DESC LIMIT 1`, [orderIntentId, portfolioOrderIntentId]);
}

async function lockedTheoreticalIntent(client, result) {
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
  const row = await one(client, `SELECT l.*, l.payload AS order_intent_payload,
      t.account_id AS target_account_id, t.instrument AS target_instrument,
      t.approved_trade_plan, t.risk_allocation, t.expected_exposure,
      t.lineage AS target_lineage, t.payload AS target_position_payload,
      g.human_execution_gate_id, g.status AS human_gate_status,
      g.expires_at_utc AS human_gate_expires_at_utc,
      ba.broker_account_id AS matched_broker_account_id,
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
      ), '{}') AS risk_decision_ids
    FROM portfolio_order_intent_lineage l
    JOIN portfolio_target_positions t ON t.target_position_id = l.target_position_id
    LEFT JOIN human_execution_gates g ON g.portfolio_order_intent_id = l.portfolio_order_intent_id
    LEFT JOIN broker_accounts ba ON ba.broker_account_id = COALESCE(
      l.payload->>'broker_account_id',
      l.payload->>'account_id',
      t.account_id
    )
    LEFT JOIN LATERAL (
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
    ) c ON true
    WHERE l.portfolio_order_intent_id = $1
    FOR UPDATE OF l`, [portfolioOrderIntentIdValue]);
  if (!row) throw repositoryError("PORTFOLIO_ORDER_INTENT_NOT_FOUND", `Portfolio OrderIntent not found: ${portfolioOrderIntentIdValue}.`);
  return portfolioLineageToTheoreticalEntryCandidate(row);
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
    alert_only_manual_execution: true,
  };
}

async function upsertTheoreticalTrade(client, trade) {
  await client.query(
    `INSERT INTO trades (
      trade_id, trade_decision_id, order_intent_id, portfolio_order_intent_id, broker_account_id, broker_contract_id, status, side,
      quantity_planned, quantity_open, avg_entry_price, initial_stop_price, current_stop_price,
      current_target_price, atm_strategy_id, opened_at, trading_date, session, strategy_id, raw
    ) VALUES ($1,$2,$3,$4,$5,$6,'open',$7::trade_side,$8,$8,$9,$10,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
    ON CONFLICT (trade_id) DO UPDATE SET status = 'open',
      quantity_open = EXCLUDED.quantity_open,
      avg_entry_price = EXCLUDED.avg_entry_price,
      initial_stop_price = COALESCE(trades.initial_stop_price, EXCLUDED.initial_stop_price),
      current_stop_price = COALESCE(trades.current_stop_price, EXCLUDED.current_stop_price),
      current_target_price = COALESCE(trades.current_target_price, EXCLUDED.current_target_price),
      raw = trades.raw || EXCLUDED.raw,
      updated_at = now()`,
    [trade.tradeId, trade.intent.trade_decision_id || null, legacyOrderIntentId(trade.intent), portfolioOrderIntentId(trade.intent),
      trade.intent.broker_account_id, trade.intent.broker_contract_id,
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

async function markIntentTheoreticallyFilled(client, intent) {
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

async function insertTheoreticalTradeEvent(client, { trade, result, intent }) {
  await client.query(
    `INSERT INTO trade_events (trade_event_id, trade_id, event_type, status, occurred_at, payload, raw)
     VALUES ($1,$2,'order_filled','open',$3,$4::jsonb,$5::jsonb)`,
    [`trade_event_${cryptoId()}`, trade.tradeId, trade.eventAt,
      json({ quantity: result.quantity, price: result.price, order_type: intent.order_type, theoretical: true }),
      json(trade.raw)],
  );
}

async function expireTheoreticalIntent(client, intent) {
  const portfolioId = portfolioOrderIntentId(intent);
  if (portfolioId) {
    await client.query(`UPDATE portfolio_order_intent_lineage
      SET status = 'EXPIRED'
      WHERE portfolio_order_intent_id = $1
        AND status NOT IN ('REJECTED','EXPIRED','CANCELLED','SUPERSEDED')`, [portfolioId]);
    await client.query(`UPDATE human_execution_gates
      SET status = 'EXPIRED', updated_at_utc = now()
      WHERE portfolio_order_intent_id = $1
        AND status = 'AWAITING_MANUAL_CONFIRMATION'`, [portfolioId]);
    return;
  }
  await client.query("UPDATE trade_order_intents SET status = 'expired', updated_at = now() WHERE order_intent_id = $1 AND status NOT IN ('cancelled','rejected','expired','superseded')", [legacyOrderIntentId(intent)]);
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

async function insertTheoreticalEvent(client, { eventType, orderIntentId = null, portfolioOrderIntentId = null, tradeId = null, eventAt, result }) {
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
function normalizePortfolioOrderIntentIds(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => text(item)).filter(Boolean))]
    : [];
}
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
function record(valueToInspect) { return valueToInspect && typeof valueToInspect === "object" && !Array.isArray(valueToInspect) ? valueToInspect : null; }
function array(valueToInspect) { return Array.isArray(valueToInspect) ? valueToInspect.filter(Boolean) : []; }
function text(valueToNormalize) { return String(valueToNormalize ?? "").trim(); }
function numberOrNull(valueToParse) {
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
function validIso(valueToParse) {
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
function portfolioOrderIntentId(valueToInspect = {}) {
  const direct = text(valueToInspect.portfolio_order_intent_id || valueToInspect.portfolioOrderIntentId);
  if (direct) return direct;
  const orderIntentId = text(valueToInspect.order_intent_id || valueToInspect.orderIntentId);
  return orderIntentId.startsWith("portfolio_order_intent_") ? orderIntentId : null;
}
function legacyOrderIntentId(valueToInspect = {}) {
  const portfolioId = portfolioOrderIntentId(valueToInspect);
  if (portfolioId) return valueToInspect.trade_order_intent_id || null;
  return text(valueToInspect.order_intent_id || valueToInspect.orderIntentId) || null;
}
function candidateDecisionFromPortfolioIntent(intent = {}) {
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
