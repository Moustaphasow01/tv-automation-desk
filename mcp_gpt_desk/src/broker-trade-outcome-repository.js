import { calculateTradeOutcome } from "@tv-automation/desk-domain";

export async function materializeTradeOutcome(client, tradeId, calculatedAt, options = {}) {
  const trade = await one(client, `SELECT t.*, c.point_value,
      l.payload #> '{approved_trade_plan,economics,units}' AS intent_economics_units,
      l.payload #> '{approved_trade_plan,units}' AS intent_units,
      p.approved_trade_plan #> '{economics,units}' AS target_economics_units,
      p.approved_trade_plan->'units' AS target_units
    FROM trades t
    LEFT JOIN broker_contracts c ON c.broker_contract_id = t.broker_contract_id
    LEFT JOIN portfolio_order_intent_lineage l ON l.portfolio_order_intent_id = t.portfolio_order_intent_id
    LEFT JOIN portfolio_target_positions p ON p.target_position_id = l.target_position_id
    WHERE t.trade_id = $1 FOR UPDATE OF t`, [tradeId]);
  if (!trade?.avg_entry_price || !trade?.initial_stop_price) return null;
  const pointValue = resolveOutcomePointValue(trade);
  if (pointValue === null) {
    await client.query(`UPDATE trades SET raw = raw ||
      '{"outcome_pending_reason":"CANONICAL_POINT_VALUE_MISSING"}'::jsonb
      WHERE trade_id = $1`, [tradeId]);
    return null;
  }
  const fills = await rows(client, `SELECT f.*
    FROM trade_fills f
    WHERE f.trade_id = $1
    ORDER BY f.filled_at ASC, f.trade_fill_id ASC`, [tradeId]);
  const entrySide = trade.side === "long" ? "buy" : "sell";
  const entryFills = fills.filter((fill) => fill.side === entrySide);
  const exitFills = fills.filter((fill) => fill.side !== entrySide);
  if (!exitFills.length) return null;
  const outcome = calculateTradeOutcome({
    side: trade.side,
    entryPrice: Number(trade.avg_entry_price),
    initialStopPrice: Number(trade.initial_stop_price),
    initialQuantity: Number(trade.quantity_planned || entryFills.reduce((sum, fill) => sum + Number(fill.quantity || 0), 0)),
    pointValue,
    entryFills: entryFills.map(projectFill),
    exitFills: exitFills.map(projectFill),
    calculatedAt,
    finalized: trade.status === "closed",
  });
  await persistOutcome(client, tradeId, outcome, {
    finalizedAt: options.finalizedAt || calculatedAt,
  });
  return outcome;
}

// An entry snapshot is immutable. Canonical intent/target units recover older
// theoretical trades with no provider contract. No instrument-name heuristic.
export function resolveOutcomePointValue(trade = {}) {
  const values = [
    trade.raw?.execution_units?.point_value,
    trade.intent_economics_units?.point_value,
    trade.intent_units?.point_value,
    trade.target_economics_units?.point_value,
    trade.target_units?.point_value,
    trade.point_value,
  ];
  for (const value of values) {
    if (value === null || value === undefined || value === "" || typeof value === "boolean") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return null;
}

async function persistOutcome(client, tradeId, outcome, { finalizedAt }) {
  const duplicate = await one(client, "SELECT trade_outcome_id,status FROM trade_outcomes WHERE trade_id = $1 AND evidence_hash = $2", [tradeId, outcome.evidence_hash]);
  if (duplicate?.status === "void") {
    throw Object.assign(new Error("Superseded outcome evidence cannot overwrite the current projection."), { code: "OUTCOME_EVIDENCE_SUPERSEDED" });
  }
  if (!duplicate) await insertOutcomeRevision(client, tradeId, outcome, { finalizedAt });
  await client.query(
    `UPDATE trades SET initial_risk_amount = $2, gross_realized_pnl = $3, total_fees = $4,
       net_realized_pnl = $5, realized_pnl = $5, result_r = $6, mfe_r = $7, mae_r = $8,
       outcome_schema_version = $9, outcome_evidence_hash = $10,
       raw = raw - 'outcome_pending_reason', updated_at = now()
     WHERE trade_id = $1`,
    [tradeId, outcome.initial_risk_amount, outcome.gross_realized_pnl, outcome.total_fees,
      outcome.net_realized_pnl, outcome.result_r, outcome.mfe_r, outcome.mae_r,
      outcome.schema_version, outcome.evidence_hash],
  );
}

async function insertOutcomeRevision(client, tradeId, outcome, { finalizedAt }) {
  const latest = await one(client, "SELECT COALESCE(max(revision), 0)::integer AS revision FROM trade_outcomes WHERE trade_id = $1", [tradeId]);
  const revision = Number(latest?.revision || 0) + 1;
  const outcomeId = `trade_outcome_${tradeId}_${revision}`;
  // Preserve old evidence while allowing a corrected final revision. The trade
  // row lock serializes revisions and the partial unique index keeps one final.
  if (outcome.status === "final") await client.query(
    "UPDATE trade_outcomes SET status = 'void', updated_at_utc = now() WHERE trade_id = $1 AND status = 'final'",
    [tradeId],
  );
  await client.query(
    `INSERT INTO trade_outcomes (
       trade_outcome_id, trade_id, revision, status, schema_version, engine_version,
       initial_risk_amount, gross_realized_pnl, total_fees, net_realized_pnl, result_r,
       mfe_r, mae_r, evidence_hash, evidence, calculated_at_utc, finalized_at_utc
     ) VALUES (
       $1,$2,$3,$4::trade_outcome_status,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,
       CASE WHEN $4 = 'final' THEN $17::timestamptz ELSE NULL END
     )
     ON CONFLICT (trade_id, evidence_hash) DO NOTHING`,
    [outcomeId, tradeId, revision, outcome.status, outcome.schema_version, outcome.engine_version,
      outcome.initial_risk_amount, outcome.gross_realized_pnl, outcome.total_fees,
      outcome.net_realized_pnl, outcome.result_r, outcome.mfe_r, outcome.mae_r,
      outcome.evidence_hash, JSON.stringify(outcome.evidence), outcome.calculated_at_utc, finalizedAt],
  );
}

function projectFill(fill) {
  return {
    quantity: Number(fill.quantity),
    price: Number(fill.price),
    commission: Number(fill.commission || 0),
    filled_at: fill.filled_at,
    fill_ref: fill.broker_fill_ref,
  };
}

async function rows(client, sql, params = []) { return (await client.query(sql, params)).rows; }
async function one(client, sql, params = []) { return (await client.query(sql, params)).rows[0] || null; }
