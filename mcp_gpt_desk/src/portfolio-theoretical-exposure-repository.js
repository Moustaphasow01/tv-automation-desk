import { isTradeOutcomeMonetaryProofValid } from "@tv-automation/desk-domain";

const TERMINAL_INTENT_STATUSES = Object.freeze(["REJECTED", "CANCELLED", "CANCELED", "SUPERSEDED"]);
const THEORETICAL_MODES = new Set(["SHADOW", "SEMI_MANUAL"]);

export async function lockTheoreticalExposureScope(client, input = {}) {
  for (const key of lockKeys(input)) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
  }
}

export async function loadTheoreticalExposureAsOf(client, input = {}) {
  const request = normalizeRequest(input);
  if (!THEORETICAL_MODES.has(request.executionMode)) return unsupportedSnapshot(request);
  if (request.requireHistoricalStatus) return historicalStatusUnavailable(request);
  const row = (await client.query(THEORETICAL_EXPOSURE_SNAPSHOT_SQL, request.intentParams)).rows?.[0] || {};
  return buildSnapshot(request, array(row.positions), array(row.intents), array(row.qualified), row.loss_usage);
}

const THEORETICAL_EXPOSURE_SNAPSHOT_SQL = `WITH open_positions AS (
  SELECT
    t.trade_id AS position_id, target.account_id, target.instrument, upper(t.side::text) AS direction,
    COALESCE(sum(CASE WHEN (lower(t.side::text) = 'long' AND lower(f.side::text) = 'buy')
      OR (lower(t.side::text) = 'short' AND lower(f.side::text) = 'sell') THEN f.quantity ELSE -f.quantity END), 0) AS size,
    max(f.filled_at) AS observed_at_utc,
    max(CASE
      WHEN jsonb_typeof(lineage.risk_snapshot->'risk_per_contract') = 'number'
        THEN (lineage.risk_snapshot->>'risk_per_contract')::numeric
      WHEN jsonb_typeof(lineage.risk_snapshot->'risk_amount') = 'number' AND lineage.quantity > 0
        THEN (lineage.risk_snapshot->>'risk_amount')::numeric / lineage.quantity
      ELSE NULL
    END) AS monetary_risk_per_contract,
    max(upper(COALESCE(NULLIF(lineage.risk_snapshot->>'currency', ''),
      NULLIF(lineage.payload #>> '{approved_trade_plan,economics,currency}', ''),
      NULLIF(target.approved_trade_plan #>> '{economics,currency}', '')))) AS monetary_currency,
    max(upper(COALESCE(NULLIF(lineage.risk_snapshot->>'availability', ''),
      NULLIF(lineage.payload #>> '{approved_trade_plan,economics,availability}', ''),
      NULLIF(target.approved_trade_plan #>> '{economics,availability}', '')))) AS monetary_availability
  FROM trades t
  JOIN portfolio_order_intent_lineage lineage ON lineage.portfolio_order_intent_id = t.portfolio_order_intent_id
  JOIN portfolio_target_positions target ON target.target_position_id = lineage.target_position_id
  LEFT JOIN trade_fills f ON f.trade_id = t.trade_id AND f.filled_at <= $2::timestamptz
  WHERE t.raw->>'source' = 'theoretical_execution_engine'
    AND t.opened_at <= $2::timestamptz
    AND target.account_id = $1
  GROUP BY t.trade_id, target.account_id, target.instrument, t.side
  HAVING COALESCE(sum(CASE WHEN (lower(t.side::text) = 'long' AND lower(f.side::text) = 'buy')
      OR (lower(t.side::text) = 'short' AND lower(f.side::text) = 'sell') THEN f.quantity ELSE -f.quantity END), 0) > 0
), pending_intents AS (
  SELECT
    lineage.portfolio_order_intent_id, lineage.status, lineage.quantity, lineage.created_at_utc,
    target.account_id, target.instrument, upper(lineage.payload->>'action') AS action,
    execution.lifecycle_status, execution.filled_quantity, execution.updated_at_utc,
    CASE
      WHEN jsonb_typeof(lineage.risk_snapshot->'risk_per_contract') = 'number'
        THEN (lineage.risk_snapshot->>'risk_per_contract')::numeric
      WHEN jsonb_typeof(lineage.risk_snapshot->'risk_amount') = 'number' AND lineage.quantity > 0
        THEN (lineage.risk_snapshot->>'risk_amount')::numeric / lineage.quantity
      ELSE NULL
    END AS monetary_risk_per_contract,
    upper(COALESCE(NULLIF(lineage.risk_snapshot->>'currency', ''),
      NULLIF(lineage.payload #>> '{approved_trade_plan,economics,currency}', ''),
      NULLIF(target.approved_trade_plan #>> '{economics,currency}', ''))) AS monetary_currency,
    upper(COALESCE(NULLIF(lineage.risk_snapshot->>'availability', ''),
      NULLIF(lineage.payload #>> '{approved_trade_plan,economics,availability}', ''),
      NULLIF(target.approved_trade_plan #>> '{economics,availability}', ''))) AS monetary_availability
  FROM portfolio_order_intent_lineage lineage
  JOIN portfolio_target_positions target ON target.target_position_id = lineage.target_position_id
  LEFT JOIN portfolio_order_intent_execution_states execution
    ON execution.portfolio_order_intent_id = lineage.portfolio_order_intent_id
  WHERE target.account_id = $1
    AND target.computed_at_utc <= $2::timestamptz
    AND upper(lineage.status) <> ALL($3::text[])
    AND NOT EXISTS (
      SELECT 1 FROM portfolio_invalid_origin_adjudications adjudication
      WHERE adjudication.portfolio_order_intent_id = lineage.portfolio_order_intent_id
        AND adjudication.status = 'CANCELLED_INVALID_ORIGIN'
        AND adjudication.reservation_disposition = 'ADMINISTRATIVELY_RELEASED'
        AND adjudication.effective_at_utc <= $2::timestamptz
        AND adjudication.created_at_utc <= $2::timestamptz
    )
    AND NOT EXISTS (
      SELECT 1 FROM portfolio_administrative_reservation_cancellations cancellation
      WHERE cancellation.portfolio_order_intent_id = lineage.portfolio_order_intent_id
        AND cancellation.status = 'CANCELLED_ADMINISTRATIVE_NO_OPEN_EXPOSURE'
        AND cancellation.reservation_disposition = 'ADMINISTRATIVELY_RELEASED'
        AND cancellation.historical_outcome_disposition = 'UNDETERMINED_PRESERVED'
        AND cancellation.effective_at_utc <= $2::timestamptz
        AND cancellation.created_at_utc <= $2::timestamptz
    )
    AND NOT EXISTS (
      SELECT 1 FROM trade_theoretical_execution_events event
      WHERE event.portfolio_order_intent_id = lineage.portfolio_order_intent_id
        AND event.event_type = 'entry_expired'
        AND event.source_candle_feed_id IS NOT NULL
        AND event.source_candle_timestamp_utc IS NOT NULL
        AND event.event_at_utc <= $2::timestamptz
    )
    AND NOT (
      EXISTS (
        SELECT 1 FROM trade_theoretical_execution_events event
        WHERE event.portfolio_order_intent_id = lineage.portfolio_order_intent_id
          AND event.event_type = 'entry_filled'
          AND event.event_at_utc <= $2::timestamptz
      )
      AND EXISTS (
        SELECT 1 FROM trades trade
        JOIN trade_fills fill ON fill.trade_id = trade.trade_id AND fill.filled_at <= $2::timestamptz
        WHERE trade.portfolio_order_intent_id = lineage.portfolio_order_intent_id
      )
    )
), monetary_reservations AS (
  SELECT position_id AS reservation_id, size AS quantity, monetary_risk_per_contract,
    monetary_currency, monetary_availability
  FROM open_positions
  UNION ALL
  SELECT portfolio_order_intent_id, quantity, monetary_risk_per_contract,
    monetary_currency, monetary_availability
  FROM pending_intents
), monetary_reservation_usage AS (
  SELECT
    COALESCE(sum(quantity * monetary_risk_per_contract), 0) AS reserved_monetary_risk,
    count(*) FILTER (WHERE monetary_risk_per_contract IS NULL OR monetary_risk_per_contract <= 0
      OR monetary_currency IS DISTINCT FROM $4
      OR monetary_availability IS DISTINCT FROM 'KNOWN')::integer AS monetary_reservation_gap_count
  FROM monetary_reservations
), qualified_signals AS (
  SELECT DISTINCT jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(target.lineage->'strategy_signal_ids') = 'array'
      THEN target.lineage->'strategy_signal_ids' ELSE '[]'::jsonb END
  ) AS signal_id
  FROM portfolio_target_positions target
  WHERE target.account_id = $1
    AND target.computed_at_utc <= $2::timestamptz
), realized_loss_usage AS (
  SELECT
    COALESCE(sum(outcome.result_r) FILTER (WHERE trade.raw->>'source' = 'theoretical_execution_engine'
      AND outcome.finalized_at_utc >= date_trunc('day', $2::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      AND outcome.finalized_at_utc <= $2::timestamptz), 0) AS daily_realized_r,
    COALESCE(sum(outcome.result_r) FILTER (WHERE trade.raw->>'source' = 'theoretical_execution_engine'
      AND outcome.finalized_at_utc >= date_trunc('week', $2::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      AND outcome.finalized_at_utc <= $2::timestamptz), 0) AS weekly_realized_r,
    greatest(-COALESCE(sum(outcome.net_realized_pnl) FILTER (
      WHERE trade.raw->>'source' = 'theoretical_execution_engine'
        AND outcome.finalized_at_utc >= date_trunc('day', $2::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0), 0) AS daily_loss_monetary,
    greatest(-COALESCE(sum(outcome.net_realized_pnl) FILTER (
      WHERE trade.raw->>'source' = 'theoretical_execution_engine'
        AND outcome.finalized_at_utc >= date_trunc('week', $2::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0), 0) AS weekly_loss_monetary,
    count(*) FILTER (WHERE trade.raw->>'source' = 'theoretical_execution_engine')::integer AS final_outcome_count,
    count(*) FILTER (WHERE trade.raw->>'source' IS DISTINCT FROM 'theoretical_execution_engine')::integer AS unproven_final_outcome_count,
    COALESCE(jsonb_agg(to_jsonb(outcome)) FILTER (
      WHERE trade.raw->>'source' = 'theoretical_execution_engine'
        AND outcome.finalized_at_utc >= date_trunc('week', $2::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    ), '[]'::jsonb) AS monetary_outcome_proofs,
    count(*) FILTER (WHERE trade.raw->>'source' = 'theoretical_execution_engine'
      AND outcome.finalized_at_utc >= date_trunc('week', $2::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      AND (upper(COALESCE(NULLIF(lineage.risk_snapshot->>'currency', ''),
        NULLIF(lineage.payload #>> '{approved_trade_plan,economics,currency}', ''),
        NULLIF(target.approved_trade_plan #>> '{economics,currency}', ''))) IS DISTINCT FROM $4
        OR canonical_units.point_value IS NULL
        OR outcome.evidence->'point_value' IS DISTINCT FROM canonical_units.point_value
      ))::integer AS monetary_outcome_gap_count
  FROM trade_outcomes outcome
  JOIN trades trade ON trade.trade_id = outcome.trade_id
  JOIN portfolio_order_intent_lineage lineage ON lineage.portfolio_order_intent_id = trade.portfolio_order_intent_id
  JOIN portfolio_target_positions target ON target.target_position_id = lineage.target_position_id
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(DISTINCT unit) = 1 AND bool_and(
      CASE WHEN jsonb_typeof(unit) = 'number' THEN unit::text::numeric > 0 ELSE false END
    ) THEN jsonb_agg(unit)->0 ELSE NULL END AS point_value FROM (VALUES
      (1, lineage.payload #> '{approved_trade_plan,economics,units,point_value}'),
      (2, lineage.payload #> '{approved_trade_plan,units,point_value}'),
      (3, target.approved_trade_plan #> '{economics,units,point_value}'),
      (4, target.approved_trade_plan #> '{units,point_value}')
    ) units(priority, unit)
    WHERE unit IS NOT NULL AND unit <> 'null'::jsonb
  ) canonical_units ON true
  WHERE outcome.status = 'final'
    AND outcome.finalized_at_utc IS NOT NULL
    AND outcome.finalized_at_utc <= $2::timestamptz
    AND outcome.calculated_at_utc <= $2::timestamptz
    AND target.account_id = $1
), closed_trade_outcome_gaps AS (
  SELECT count(*) FILTER (WHERE NOT EXISTS (
      SELECT 1 FROM trade_outcomes outcome
      WHERE outcome.trade_id = trade.trade_id
        AND outcome.status = 'final'
        AND outcome.finalized_at_utc IS NOT NULL
        AND outcome.finalized_at_utc <= $2::timestamptz
        AND outcome.calculated_at_utc <= $2::timestamptz
    ))::integer AS missing_closed_final_outcome_count
  FROM trades trade
  JOIN portfolio_order_intent_lineage lineage ON lineage.portfolio_order_intent_id = trade.portfolio_order_intent_id
  JOIN portfolio_target_positions target ON target.target_position_id = lineage.target_position_id
  WHERE trade.raw->>'source' = 'theoretical_execution_engine'
    AND lower(trade.status::text) = 'closed'
    AND trade.closed_at IS NOT NULL
    AND trade.closed_at <= $2::timestamptz
    AND target.account_id = $1
)
SELECT
  COALESCE((SELECT jsonb_agg(to_jsonb(open_positions)) FROM open_positions), '[]'::jsonb) AS positions,
  COALESCE((SELECT jsonb_agg(to_jsonb(pending_intents)) FROM pending_intents), '[]'::jsonb) AS intents,
  COALESCE((SELECT jsonb_agg(to_jsonb(qualified_signals)) FROM qualified_signals), '[]'::jsonb) AS qualified,
  (SELECT jsonb_build_object('daily_realized_r', daily_realized_r, 'weekly_realized_r', weekly_realized_r,
    'daily_loss_monetary', daily_loss_monetary, 'weekly_loss_monetary', weekly_loss_monetary,
    'reserved_monetary_risk', reserved_monetary_risk, 'currency', $4,
    'monetary_reservation_gap_count', monetary_reservation_gap_count,
    'monetary_outcome_gap_count', monetary_outcome_gap_count,
    'monetary_outcome_proofs', monetary_outcome_proofs,
    'final_outcome_count', final_outcome_count, 'unproven_final_outcome_count', unproven_final_outcome_count,
    'missing_closed_final_outcome_count', missing_closed_final_outcome_count,
    'period_timezone', 'UTC', 'provenance', 'THEORETICAL_FINAL_OUTCOMES')
   FROM realized_loss_usage CROSS JOIN closed_trade_outcome_gaps CROSS JOIN monetary_reservation_usage) AS loss_usage`;

function normalizeRequest(input) {
  const instruments = [...new Set(array(input.instruments).map(upper).filter(Boolean))].sort();
  const asOf = iso(input.as_of_utc || input.asOfUtc);
  if (!asOf) throw new Error("THEORETICAL_EXPOSURE_CUTOFF_REQUIRED");
  const accountId = text(input.account_id || input.accountId || "default");
  const monetaryCurrency = currency(input.risk_budget?.max_monetary_risk_currency);
  return {
    accountId,
    portfolioScope: text(input.portfolio_scope || input.portfolioScope || input.scope || "default"),
    executionMode: upper(input.execution_mode || input.executionMode || "SHADOW"),
    requireHistoricalStatus: input.require_historical_status === true || input.requireHistoricalStatus === true,
    asOf,
    instruments,
    monetaryCurrency,
    intentParams: [accountId, asOf, TERMINAL_INTENT_STATUSES, monetaryCurrency],
  };
}

function lockKeys(input) {
  const request = normalizeRequest(input);
  const accountKey = `portfolio-theoretical-exposure:account:${request.accountId}`;
  const scopePrefix = `portfolio-theoretical-exposure:${request.portfolioScope}:${request.accountId}`;
  return [accountKey, `${scopePrefix}:*`, ...request.instruments.map((instrument) => `${scopePrefix}:${instrument}`)];
}

function buildSnapshot(request, positionRows, intentRows, qualifiedRows, lossRow) {
  const positions = positionRows.map(normalizePosition);
  const pending = intentRows.map(normalizeIntent);
  const unknown = pending.filter((item) => ["UNKNOWN", "RECONCILIATION_REQUIRED"].includes(item.lifecycle_status));
  const futureState = pending.filter((item) => item.updated_at_utc && item.updated_at_utc > request.asOf);
  const invalid = [...positions, ...pending].filter((item) => item.invalid_numeric === true);
  const lossUsage = normalizeLossUsage(lossRow);
  const reasons = [
    ...unknown.map((item) => `THEORETICAL_INTENT_${item.lifecycle_status}:${item.instrument}`),
    ...futureState.map((item) => `THEORETICAL_EXECUTION_STATE_AFTER_AS_OF:${item.instrument}`),
    ...invalid.map((item) => `THEORETICAL_EXPOSURE_NUMERIC_INVALID:${item.instrument}`),
  ];
  return {
    source: "THEORETICAL_PERSISTED_AS_OF",
    execution_mode: request.executionMode,
    as_of_utc: request.asOf,
    portfolio_scope: request.portfolioScope,
    account_id: request.accountId,
    availability: unknown.length || futureState.length || invalid.length || lossUsage.availability !== "KNOWN" ? "PARTIAL" : "KNOWN",
    as_of_status_provenance: "CURRENT_LINEAGE_STATUS_UNVERSIONED",
    loss_usage_availability: lossUsage.availability,
    loss_usage: lossUsage,
    reason_codes: [...reasons, ...(lossUsage.reason_codes || [])],
    positions: [...positions.filter((item) => item.size > 0), ...reservationPositions(pending)],
    pending_order_intents: pending.filter((item) => item.quantity > 0),
    qualified_signal_ids: [...new Set(qualifiedRows.map((item) => text(item.signal_id)).filter(Boolean))],
    reservation_instruments: [...new Set(pending.filter((item) => item.quantity > 0).map((item) => item.instrument))],
    unknown_reservation_instruments: [...new Set(unknown.map((item) => item.instrument))],
  };
}

function normalizeLossUsage(row) {
  const values = lossUsageValues(row);
  const unavailable = unavailableLossUsage(values);
  if (unavailable) return unavailable;
  const monetary = monetaryLossFields(values);
  return {
    availability: "KNOWN", daily_realized_r: values.daily, weekly_realized_r: values.weekly,
    ...monetary,
    final_outcome_count: values.finalOutcomeCount, unproven_final_outcome_count: values.unprovenCount,
    missing_closed_final_outcome_count: values.missingClosedCount,
    period_timezone: text(values.source.period_timezone || "UTC"),
    provenance: text(values.source.provenance || "THEORETICAL_FINAL_OUTCOMES"), reason_codes: [],
  };
}

function lossUsageValues(row) {
  const source = row || {};
  const unitGaps = numericOrNull(source.monetary_outcome_gap_count);
  const proofGaps = Array.isArray(source.monetary_outcome_proofs)
    ? source.monetary_outcome_proofs.filter(outcome => !isTradeOutcomeMonetaryProofValid(outcome)).length : null;
  return {
    source,
    daily: signedNumericOrNull(source.daily_realized_r),
    weekly: signedNumericOrNull(source.weekly_realized_r),
    dailyMonetary: moneyOrNull(source.daily_loss_monetary),
    weeklyMonetary: moneyOrNull(source.weekly_loss_monetary),
    reservedMonetary: moneyOrNull(source.reserved_monetary_risk),
    currency: currency(source.currency),
    monetaryReservationGapCount: numericOrNull(source.monetary_reservation_gap_count),
    monetaryOutcomeGapCount: unitGaps === null || proofGaps === null ? null : unitGaps + proofGaps,
    finalOutcomeCount: numericOrNull(source.final_outcome_count),
    unprovenCount: numericOrNull(source.unproven_final_outcome_count),
    missingClosedCount: numericOrNull(source.missing_closed_final_outcome_count),
  };
}

function unavailableLossUsage(values) {
  if ([values.daily, values.weekly, values.unprovenCount, values.missingClosedCount].includes(null)) {
    return unavailableLossUsageFor("THEORETICAL_FINAL_OUTCOME_R_UNAVAILABLE");
  }
  if (values.unprovenCount > 0) return unavailableLossUsageFor("THEORETICAL_FINAL_OUTCOME_PROVENANCE_UNAVAILABLE");
  if (values.missingClosedCount > 0) return unavailableLossUsageFor("THEORETICAL_CLOSED_TRADE_OUTCOME_UNAVAILABLE");
  return null;
}

function monetaryAvailability(values) {
  const amounts = [values.dailyMonetary, values.weeklyMonetary, values.reservedMonetary];
  if (!values.currency || amounts.includes(null)
    || values.monetaryReservationGapCount === null || values.monetaryOutcomeGapCount === null) return "UNAVAILABLE";
  return values.monetaryReservationGapCount > 0 || values.monetaryOutcomeGapCount > 0
    ? "UNAVAILABLE"
    : "KNOWN";
}

function monetaryLossFields(values) {
  const availability = monetaryAvailability(values);
  if (availability !== "KNOWN") return {
    monetary_availability: "UNAVAILABLE", daily_loss_monetary: null,
    weekly_loss_monetary: null, reserved_monetary_risk: null, currency: "UNAVAILABLE",
  };
  return {
    monetary_availability: "KNOWN", daily_loss_monetary: values.dailyMonetary,
    weekly_loss_monetary: values.weeklyMonetary, reserved_monetary_risk: values.reservedMonetary,
    currency: values.currency,
  };
}

function reservationPositions(intents) {
  return intents.filter((item) => item.quantity > 0).map((item) => ({
    position_id: `reservation:${item.portfolio_order_intent_id}`,
    account_id: item.account_id,
    instrument: item.instrument,
    direction: item.action === "SELL" ? "SHORT" : "LONG",
    size: item.quantity,
    observed_at_utc: item.updated_at_utc || item.created_at_utc,
    source: "THEORETICAL_PENDING_ORDER_INTENT",
    reservation: true,
  }));
}

function unsupportedSnapshot(request) {
  return {
    source: "THEORETICAL_PERSISTED_AS_OF",
    execution_mode: request.executionMode,
    as_of_utc: request.asOf,
    portfolio_scope: request.portfolioScope,
    account_id: request.accountId,
    availability: "UNAVAILABLE",
    reason_codes: ["PHYSICAL_EXPOSURE_READ_UNSUPPORTED"],
    loss_usage_availability: "UNAVAILABLE",
    loss_usage: unavailableLossUsageSnapshot(),
    positions: [], pending_order_intents: [], qualified_signal_ids: [], reservation_instruments: [], unknown_reservation_instruments: [],
  };
}

function historicalStatusUnavailable(request) {
  return {
    source: "THEORETICAL_PERSISTED_AS_OF", execution_mode: request.executionMode, as_of_utc: request.asOf,
    portfolio_scope: request.portfolioScope, account_id: request.accountId, availability: "UNAVAILABLE",
    reason_codes: ["THEORETICAL_LINEAGE_STATUS_HISTORY_UNAVAILABLE"],
    loss_usage_availability: "UNAVAILABLE",
    loss_usage: unavailableLossUsageSnapshot(),
    positions: [], pending_order_intents: [], qualified_signal_ids: [], reservation_instruments: [], unknown_reservation_instruments: [],
  };
}

function normalizePosition(row) {
  return {
    position_id: text(row.position_id), account_id: text(row.account_id), instrument: upper(row.instrument),
    direction: upper(row.direction), size: numericOrNull(row.size), observed_at_utc: iso(row.observed_at_utc),
    invalid_numeric: numericOrNull(row.size) === null,
    source: "THEORETICAL_TRADE",
  };
}

function normalizeIntent(row) {
  return {
    portfolio_order_intent_id: text(row.portfolio_order_intent_id), account_id: text(row.account_id), instrument: upper(row.instrument),
    action: upper(row.action), quantity: numericOrNull(row.quantity), status: upper(row.status),
    lifecycle_status: upper(row.lifecycle_status || "AWAITING_MANUAL_CONFIRMATION"),
    execution_state_provenance: row.lifecycle_status ? "PERSISTED" : "UNAVAILABLE",
    filled_quantity: row.lifecycle_status ? numericOrNull(row.filled_quantity) : null,
    created_at_utc: iso(row.created_at_utc), updated_at_utc: iso(row.updated_at_utc),
    invalid_numeric: numericOrNull(row.quantity) === null || Boolean(row.lifecycle_status) && numericOrNull(row.filled_quantity) === null,
    source: "THEORETICAL_ORDER_INTENT",
  };
}

function array(value) { return Array.isArray(value) ? value : []; }
function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function numericOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function signedNumericOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function moneyOrNull(value) {
  const parsed = numericOrNull(value);
  return parsed === null ? null : Math.round(parsed * 100) / 100;
}
function currency(value) {
  const code = upper(value);
  return /^[A-Z]{3}$/.test(code) ? code : null;
}
function unavailableLossUsageSnapshot() {
  return { availability: "UNAVAILABLE", monetary_availability: "UNAVAILABLE", daily_loss_monetary: null,
    weekly_loss_monetary: null, reserved_monetary_risk: null, currency: "UNAVAILABLE", reason_codes: [] };
}
function unavailableLossUsageFor(reasonCode) {
  return { ...unavailableLossUsageSnapshot(), reason_codes: [reasonCode] };
}
function iso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
