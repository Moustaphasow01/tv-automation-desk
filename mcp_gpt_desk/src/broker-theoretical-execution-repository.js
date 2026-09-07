import { canonicalSha256 } from "@tv-automation/desk-domain";
import { materializeTradeOutcome } from "./broker-trade-outcome-repository.js";
import {
  boundLimit,
  buildTheoreticalEntryTrade,
  buildTheoreticalExit,
  candidateDecisionFromPortfolioIntent,
  commitValue,
  cryptoId,
  emptyTheoreticalBacklog,
  expireTheoreticalIntent,
  insertTheoreticalEntryFill,
  insertTheoreticalTradeEvent,
  insertTheoreticalEvent,
  insertTheoreticalExitFill,
  insertTheoreticalExitTradeEvent,
  json,
  latestTheoreticalEntryTerminal,
  legacyOrderIntentId,
  lockedOpenTrade,
  lockedTheoreticalIntent,
  markIntentTheoreticallyFilled,
  normalizePortfolioOrderIntentIds,
  one,
  PORTFOLIO_THEORETICAL_BROKER_ACCOUNT_JOIN_SQL,
  PORTFOLIO_THEORETICAL_CANDIDATE_COLUMNS_SQL,
  PORTFOLIO_THEORETICAL_CONTRACT_JOIN_SQL,
  portfolioLineageToTheoreticalEntryCandidate,
  portfolioOrderIntentId,
  rows,
  text,
  updateTheoreticalExitTrade,
  upsertTheoreticalTrade,
  validIso,
} from "./broker-theoretical-execution-persistence.js";
export { latestClosedCandleForIntent, latestClosedCandleForTrade } from "./broker-theoretical-candle-repository.js";
export { portfolioLineageToTheoreticalEntryCandidate } from "./broker-theoretical-execution-persistence.js";

export async function listTheoreticalEntryCandidates(repository, {
  limit = 100, portfolioOrderIntentIds = null, now = new Date().toISOString(),
} = {}) {
  await repository.ready();
  const bounded = boundLimit(limit);
  const knownAt = validIso(now);
  if (!knownAt) {
    const error = new Error("A valid theoretical execution as-of time is required.");
    error.code = "THEORETICAL_EXECUTION_AS_OF_INVALID";
    throw error;
  }
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
  const portfolioCandidates = await rows(repository.pool, `WITH eligible_portfolio_intents AS MATERIALIZED (
      SELECT l.portfolio_order_intent_id, l.created_at_utc
      FROM portfolio_order_intent_lineage l
      JOIN portfolio_target_positions t ON t.target_position_id = l.target_position_id
      LEFT JOIN human_execution_gates g ON g.portfolio_order_intent_id = l.portfolio_order_intent_id
      WHERE (l.status = 'READY' OR (
          l.status = 'EXPIRED' AND g.status = 'EXPIRED'
          AND g.payload->>'expired_by' = 'theoretical_execution_sweeper'
        ))
        AND ($2::text[] IS NULL OR l.portfolio_order_intent_id = ANY($2::text[]))
        AND NOT EXISTS (
          SELECT 1 FROM portfolio_invalid_origin_adjudications adjudication
          WHERE adjudication.portfolio_order_intent_id=l.portfolio_order_intent_id
            AND adjudication.status='CANCELLED_INVALID_ORIGIN'
            AND adjudication.reservation_disposition='ADMINISTRATIVELY_RELEASED'
            AND adjudication.effective_at_utc <= $3::timestamptz
            AND adjudication.created_at_utc <= $3::timestamptz
        )
        AND NOT EXISTS (
          SELECT 1 FROM portfolio_administrative_reservation_cancellations cancellation
          WHERE cancellation.portfolio_order_intent_id=l.portfolio_order_intent_id
            AND cancellation.status='CANCELLED_ADMINISTRATIVE_NO_OPEN_EXPOSURE'
            AND cancellation.reservation_disposition='ADMINISTRATIVELY_RELEASED'
            AND cancellation.historical_outcome_disposition='UNDETERMINED_PRESERVED'
            AND cancellation.effective_at_utc <= $3::timestamptz
            AND cancellation.created_at_utc <= $3::timestamptz
        )
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
      ORDER BY l.created_at_utc ASC, l.portfolio_order_intent_id ASC
      LIMIT $1
    )
      SELECT l.*, l.payload AS order_intent_payload,
        t.account_id AS target_account_id, t.instrument AS target_instrument,
        t.approved_trade_plan, t.risk_allocation, t.expected_exposure,
        t.lineage AS target_lineage, t.payload AS target_position_payload,
        g.human_execution_gate_id, g.status AS human_gate_status,
        g.expires_at_utc AS human_gate_expires_at_utc,
        ss.signal_id AS source_strategy_signal_id,
        ss.generated_at_utc AS source_signal_generated_at_utc,
        ss.source_data_cutoff_utc AS source_signal_cutoff_utc,
        ss.expires_at_utc AS source_signal_expires_at_utc,
        ${PORTFOLIO_THEORETICAL_CANDIDATE_COLUMNS_SQL}
      FROM eligible_portfolio_intents eligible
      JOIN portfolio_order_intent_lineage l
        ON l.portfolio_order_intent_id = eligible.portfolio_order_intent_id
      JOIN portfolio_target_positions t ON t.target_position_id = l.target_position_id
      LEFT JOIN human_execution_gates g ON g.portfolio_order_intent_id = l.portfolio_order_intent_id
      ${PORTFOLIO_THEORETICAL_BROKER_ACCOUNT_JOIN_SQL}
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
      ${PORTFOLIO_THEORETICAL_CONTRACT_JOIN_SQL}
      ORDER BY eligible.created_at_utc ASC, eligible.portfolio_order_intent_id ASC`,
  [bounded, hasPortfolioScope ? scopedPortfolioIds : null, knownAt]);
  return [...legacyCandidates, ...portfolioCandidates.map(portfolioLineageToTheoreticalEntryCandidate)]
    .sort((left, right) => Date.parse(left.requested_at || 0) - Date.parse(right.requested_at || 0))
    .slice(0, bounded);
}

export async function expireStalePortfolioHumanGates(repository, { limit = 200, now = new Date().toISOString(), portfolioOrderIntentIds = null } = {}) {
  await repository.ready();
  const eventAt = validIso(now);
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
      [eventAt, bounded, hasPortfolioScope ? scopedPortfolioIds : null],
    );
    for (const gate of result.rows) {
      const payload = {
        expired_by: "theoretical_execution_sweeper",
        expired_at_utc: eventAt,
        previous_status: "AWAITING_MANUAL_CONFIRMATION",
        reason: "HUMAN_GATE_EXPIRED",
      };
      await client.query(
        `UPDATE human_execution_gates
         SET status = 'EXPIRED',
             revision = revision + 1,
             reason = COALESCE(reason, 'HUMAN_GATE_EXPIRED'),
             payload = payload || $2::jsonb,
             updated_at_utc = $3::timestamptz
         WHERE human_execution_gate_id = $1
           AND status = 'AWAITING_MANUAL_CONFIRMATION'`,
        [gate.human_execution_gate_id, json(payload), eventAt],
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
           portfolio_order_intent_id, lifecycle_status, payload, updated_at_utc
         ) VALUES ($1, 'EXPIRED', $2::jsonb, $3::timestamptz)
         ON CONFLICT (portfolio_order_intent_id) DO UPDATE SET
           lifecycle_status = 'EXPIRED',
           payload = portfolio_order_intent_execution_states.payload || EXCLUDED.payload,
           revision = portfolio_order_intent_execution_states.revision + 1,
           updated_at_utc = EXCLUDED.updated_at_utc`,
        [gate.portfolio_order_intent_id, json(payload), eventAt],
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
          eventAt,
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

export async function recordTheoreticalEntryFill(repository, { result, now }) {
  await repository.ready();
  const client = await repository.pool.connect();
  try {
    await client.query("BEGIN");
    const intent = await lockedTheoreticalIntent(client, result);
    const existing = await latestTheoreticalEntryTerminal(client, {
      orderIntentId: legacyOrderIntentId(result),
      portfolioOrderIntentId: portfolioOrderIntentId(result),
    });
    if (existing) return await commitValue(client, { event: existing, idempotent: true });
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
    const intent = await lockedTheoreticalIntent(client, result);
    const existing = await latestTheoreticalEntryTerminal(client, {
      orderIntentId: legacyOrderIntentId(result),
      portfolioOrderIntentId: portfolioOrderIntentId(result),
    });
    if (existing) return await commitValue(client, { event: existing, idempotent: true });
    const eventAt = result.event_at_utc || now;
    await expireTheoreticalIntent(client, intent, eventAt);
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

export async function listTheoreticalOpenTrades(repository, { limit = 100, portfolioOrderIntentIds = null, now = new Date().toISOString() } = {}) {
  await repository.ready();
  const bounded = boundLimit(limit);
  const hasPortfolioScope = Array.isArray(portfolioOrderIntentIds);
  const scopedPortfolioIds = normalizePortfolioOrderIntentIds(portfolioOrderIntentIds);
  if (hasPortfolioScope && scopedPortfolioIds.length === 0) return [];
  return rows(repository.pool, `SELECT t.*,
        COALESCE(c.instrument_code, t.raw->>'instrument') AS instrument_code,
        c.broker_symbol,
        COALESCE(t.theoretical_cursor_at_utc, t.opened_at) AS theoretical_cursor_at_utc
      FROM trades t
      LEFT JOIN broker_contracts c ON c.broker_contract_id = t.broker_contract_id
      WHERE t.status IN ('open','scaling','protected')
        AND t.raw->>'source' = 'theoretical_execution_engine'
        AND t.quantity_open > 0
        AND t.current_stop_price IS NOT NULL
        AND t.current_target_price IS NOT NULL
        AND COALESCE(t.raw->>'theoretical_review_required', 'false') <> 'true'
        AND ($2::text[] IS NULL OR t.portfolio_order_intent_id = ANY($2::text[]))
        AND EXISTS (
          SELECT 1
          FROM market_candles pending_candle
          JOIN market_feeds pending_feed ON pending_feed.feed_id = pending_candle.feed_id
          WHERE pending_feed.instrument_code = COALESCE(c.instrument_code, t.raw->>'instrument')
            AND pending_candle.timeframe = '1'
            AND pending_candle.is_closed = true
            AND pending_candle.timestamp_utc > COALESCE(t.theoretical_cursor_at_utc, t.opened_at)
            AND pending_candle.timestamp_utc + interval '1 minute' <= $3::timestamptz
        )
      ORDER BY COALESCE(t.theoretical_cursor_at_utc, t.opened_at) ASC NULLS FIRST,
        t.opened_at ASC NULLS FIRST,
        t.trade_id ASC
      LIMIT $1`, [bounded, hasPortfolioScope ? scopedPortfolioIds : null, now]);
}

export async function advanceTheoreticalTradeCursor(repository, { tradeId, candleTimestampUtc } = {}) {
  await repository.ready();
  const trade = text(tradeId);
  const cursor = validIso(candleTimestampUtc);
  if (!trade || !cursor) return { advanced: false, reason: "INVALID_CURSOR_INPUT", trade_id: trade || null };
  const row = await one(repository.pool, `UPDATE trades
      SET theoretical_cursor_at_utc = GREATEST(
            COALESCE(theoretical_cursor_at_utc, opened_at, $2::timestamptz),
            $2::timestamptz
          )
      WHERE trade_id = $1
        AND status IN ('open','scaling','protected')
        AND quantity_open > 0
        AND (
          theoretical_cursor_at_utc IS NULL
          OR theoretical_cursor_at_utc < $2::timestamptz
        )
      RETURNING trade_id, theoretical_cursor_at_utc`, [trade, cursor]);
  return row
    ? { advanced: true, trade_id: row.trade_id, theoretical_cursor_at_utc: validIso(row.theoretical_cursor_at_utc) }
    : { advanced: false, reason: "CURSOR_ALREADY_ADVANCED_OR_TRADE_CLOSED", trade_id: trade, theoretical_cursor_at_utc: cursor };
}

export async function theoreticalExecutionBacklog(repository, { portfolioOrderIntentIds = null, now = new Date().toISOString() } = {}) {
  await repository.ready();
  const hasPortfolioScope = Array.isArray(portfolioOrderIntentIds);
  const scopedPortfolioIds = normalizePortfolioOrderIntentIds(portfolioOrderIntentIds);
  if (hasPortfolioScope && scopedPortfolioIds.length === 0) return emptyTheoreticalBacklog();
  const row = await one(repository.pool, `SELECT
        count(*)::integer AS eligible_open_trades,
        (count(*) FILTER (WHERE EXISTS (
          SELECT 1
          FROM market_candles pending_candle
          JOIN market_feeds pending_feed ON pending_feed.feed_id = pending_candle.feed_id
          WHERE pending_feed.instrument_code = COALESCE(c.instrument_code, t.raw->>'instrument')
            AND pending_candle.timeframe = '1'
            AND pending_candle.is_closed = true
            AND pending_candle.timestamp_utc > COALESCE(t.theoretical_cursor_at_utc, t.opened_at)
            AND pending_candle.timestamp_utc + interval '1 minute' <= $2::timestamptz
        )))::integer AS due_open_trades,
        min(COALESCE(t.theoretical_cursor_at_utc, t.opened_at)) AS oldest_cursor_at_utc,
        max(COALESCE(t.theoretical_cursor_at_utc, t.opened_at)) AS newest_cursor_at_utc
      FROM trades t
      LEFT JOIN broker_contracts c ON c.broker_contract_id = t.broker_contract_id
      WHERE t.status IN ('open','scaling','protected')
        AND t.raw->>'source' = 'theoretical_execution_engine'
        AND t.quantity_open > 0
        AND t.current_stop_price IS NOT NULL
        AND t.current_target_price IS NOT NULL
        AND COALESCE(t.raw->>'theoretical_review_required', 'false') <> 'true'
        AND ($1::text[] IS NULL OR t.portfolio_order_intent_id = ANY($1::text[]))`, [hasPortfolioScope ? scopedPortfolioIds : null, now]);
  return {
    eligible_open_trades: Number(row?.eligible_open_trades || 0),
    due_open_trades: Number(row?.due_open_trades || 0),
    oldest_cursor_at_utc: validIso(row?.oldest_cursor_at_utc),
    newest_cursor_at_utc: validIso(row?.newest_cursor_at_utc),
  };
}

export async function recordTheoreticalExitFill(repository, { result, now }) {
  await repository.ready();
  const client = await repository.pool.connect();
  try {
    await client.query("BEGIN");
    const trade = await lockedOpenTrade(client, result.trade_id);
    if (trade.status === "NO_OPEN_THEORETICAL_TRADE") return await commitValue(client, trade);
    if (trade.raw?.theoretical_review_required === true) return await commitValue(client, { status: "THEORETICAL_REVIEW_REQUIRED", trade_id: trade.trade_id });
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
  const client = await repository.pool.connect();
  try {
    await client.query("BEGIN");
    const trade = await lockedOpenTrade(client, result.trade_id);
    if (trade.status === "NO_OPEN_THEORETICAL_TRADE") return await commitValue(client, trade);
    const event = await insertTheoreticalEvent(client, {
      eventType: "exit_review_required", orderIntentId: trade.order_intent_id || null,
      portfolioOrderIntentId: trade.portfolio_order_intent_id || null, tradeId: result.trade_id,
      eventAt: result.event_at_utc || now, result,
    });
    await client.query(`UPDATE trades SET raw = raw || $2::jsonb WHERE trade_id = $1`, [result.trade_id,
      json({ theoretical_review_required: true, theoretical_review_reason: result.reason, theoretical_review_event_id: event.theoretical_execution_event_id })]);
    return await commitValue(client, { event });
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
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
