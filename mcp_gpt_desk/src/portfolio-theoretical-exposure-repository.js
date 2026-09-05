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
  return buildSnapshot(request, array(row.positions), array(row.intents), array(row.qualified));
}

const THEORETICAL_EXPOSURE_SNAPSHOT_SQL = `WITH open_positions AS (
  SELECT
    t.trade_id AS position_id, target.account_id, target.instrument, upper(t.side::text) AS direction,
    COALESCE(sum(CASE WHEN (lower(t.side::text) = 'long' AND lower(f.side::text) = 'buy')
      OR (lower(t.side::text) = 'short' AND lower(f.side::text) = 'sell') THEN f.quantity ELSE -f.quantity END), 0) AS size,
    max(f.filled_at) AS observed_at_utc
  FROM trades t
  JOIN portfolio_order_intent_lineage lineage ON lineage.portfolio_order_intent_id = t.portfolio_order_intent_id
  JOIN portfolio_target_positions target ON target.target_position_id = lineage.target_position_id
  LEFT JOIN trade_fills f ON f.trade_id = t.trade_id AND f.filled_at <= $3::timestamptz
  WHERE t.raw->>'source' = 'theoretical_execution_engine'
    AND t.opened_at <= $3::timestamptz
    AND target.account_id = $2
    AND ($1::text[] IS NULL OR target.instrument = ANY($1::text[]))
  GROUP BY t.trade_id, target.account_id, target.instrument, t.side
  HAVING COALESCE(sum(CASE WHEN (lower(t.side::text) = 'long' AND lower(f.side::text) = 'buy')
      OR (lower(t.side::text) = 'short' AND lower(f.side::text) = 'sell') THEN f.quantity ELSE -f.quantity END), 0) > 0
), pending_intents AS (
  SELECT
    lineage.portfolio_order_intent_id, lineage.status, lineage.quantity, lineage.created_at_utc,
    target.account_id, target.instrument, upper(lineage.payload->>'action') AS action,
    execution.lifecycle_status, execution.filled_quantity, execution.updated_at_utc
  FROM portfolio_order_intent_lineage lineage
  JOIN portfolio_target_positions target ON target.target_position_id = lineage.target_position_id
  LEFT JOIN portfolio_order_intent_execution_states execution
    ON execution.portfolio_order_intent_id = lineage.portfolio_order_intent_id
  WHERE target.account_id = $2
    AND target.computed_at_utc <= $3::timestamptz
    AND ($1::text[] IS NULL OR target.instrument = ANY($1::text[]))
    AND upper(lineage.status) <> ALL($4::text[])
    AND NOT EXISTS (
      SELECT 1 FROM trade_theoretical_execution_events event
      WHERE event.portfolio_order_intent_id = lineage.portfolio_order_intent_id
        AND event.event_type IN ('entry_filled', 'entry_expired')
        AND event.event_at_utc <= $3::timestamptz
    )
), qualified_signals AS (
  SELECT DISTINCT jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(target.lineage->'strategy_signal_ids') = 'array'
      THEN target.lineage->'strategy_signal_ids' ELSE '[]'::jsonb END
  ) AS signal_id
  FROM portfolio_target_positions target
  WHERE target.account_id = $2
    AND target.computed_at_utc <= $3::timestamptz
)
SELECT
  COALESCE((SELECT jsonb_agg(to_jsonb(open_positions)) FROM open_positions), '[]'::jsonb) AS positions,
  COALESCE((SELECT jsonb_agg(to_jsonb(pending_intents)) FROM pending_intents), '[]'::jsonb) AS intents,
  COALESCE((SELECT jsonb_agg(to_jsonb(qualified_signals)) FROM qualified_signals), '[]'::jsonb) AS qualified`;

function normalizeRequest(input) {
  const instruments = [...new Set(array(input.instruments).map(upper).filter(Boolean))].sort();
  const asOf = iso(input.as_of_utc || input.asOfUtc);
  if (!asOf) throw new Error("THEORETICAL_EXPOSURE_CUTOFF_REQUIRED");
  return {
    accountId: text(input.account_id || input.accountId || "default"),
    portfolioScope: text(input.portfolio_scope || input.portfolioScope || input.scope || "default"),
    executionMode: upper(input.execution_mode || input.executionMode || "SHADOW"),
    requireHistoricalStatus: input.require_historical_status === true || input.requireHistoricalStatus === true,
    asOf,
    instruments,
    positionParams: [null, text(input.account_id || input.accountId || "default"), asOf],
    intentParams: [null, text(input.account_id || input.accountId || "default"), asOf, TERMINAL_INTENT_STATUSES],
  };
}

function lockKeys(input) {
  const request = normalizeRequest(input);
  const accountKey = `portfolio-theoretical-exposure:account:${request.accountId}`;
  const scopePrefix = `portfolio-theoretical-exposure:${request.portfolioScope}:${request.accountId}`;
  return [accountKey, `${scopePrefix}:*`, ...request.instruments.map((instrument) => `${scopePrefix}:${instrument}`)];
}

function buildSnapshot(request, positionRows, intentRows, qualifiedRows) {
  const positions = positionRows.map(normalizePosition);
  const pending = intentRows.map(normalizeIntent);
  const unknown = pending.filter((item) => ["UNKNOWN", "RECONCILIATION_REQUIRED"].includes(item.lifecycle_status));
  const futureState = pending.filter((item) => item.updated_at_utc && item.updated_at_utc > request.asOf);
  const invalid = [...positions, ...pending].filter((item) => item.invalid_numeric === true);
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
    availability: unknown.length || futureState.length || invalid.length ? "PARTIAL" : "KNOWN",
    as_of_status_provenance: "CURRENT_LINEAGE_STATUS_UNVERSIONED",
    loss_usage_availability: "UNAVAILABLE",
    reason_codes: reasons,
    positions: [...positions.filter((item) => item.size > 0), ...reservationPositions(pending)],
    pending_order_intents: pending.filter((item) => item.quantity > 0),
    qualified_signal_ids: [...new Set(qualifiedRows.map((item) => text(item.signal_id)).filter(Boolean))],
    reservation_instruments: [...new Set(pending.filter((item) => item.quantity > 0).map((item) => item.instrument))],
    unknown_reservation_instruments: [...new Set(unknown.map((item) => item.instrument))],
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
    positions: [], pending_order_intents: [], qualified_signal_ids: [], reservation_instruments: [], unknown_reservation_instruments: [],
  };
}

function historicalStatusUnavailable(request) {
  return {
    source: "THEORETICAL_PERSISTED_AS_OF", execution_mode: request.executionMode, as_of_utc: request.asOf,
    portfolio_scope: request.portfolioScope, account_id: request.accountId, availability: "UNAVAILABLE",
    reason_codes: ["THEORETICAL_LINEAGE_STATUS_HISTORY_UNAVAILABLE"],
    loss_usage_availability: "UNAVAILABLE",
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
function iso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
