import { calculateTradeOutcome } from "@tv-automation/desk-domain";

export async function materializeTradeOutcome(client, tradeId, calculatedAt) {
  const trade = await one(client, `SELECT t.*, c.point_value
    FROM trades t
    LEFT JOIN broker_contracts c ON c.broker_contract_id = t.broker_contract_id
    WHERE t.trade_id = $1`, [tradeId]);
  if (!trade?.avg_entry_price || !trade?.initial_stop_price) return null;
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
    pointValue: Number(trade.point_value || 1),
    entryFills: entryFills.map(projectFill),
    exitFills: exitFills.map(projectFill),
    calculatedAt,
    finalized: trade.status === "closed",
  });
  const latest = await one(client, "SELECT COALESCE(max(revision), 0)::integer AS revision FROM trade_outcomes WHERE trade_id = $1", [tradeId]);
  const revision = Number(latest?.revision || 0) + 1;
  const outcomeId = `trade_outcome_${tradeId}_${revision}`;
  await client.query(
    `INSERT INTO trade_outcomes (
       trade_outcome_id, trade_id, revision, status, schema_version, engine_version,
       initial_risk_amount, gross_realized_pnl, total_fees, net_realized_pnl, result_r,
       mfe_r, mae_r, evidence_hash, evidence, calculated_at_utc, finalized_at_utc
     ) VALUES (
       $1,$2,$3,$4::trade_outcome_status,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,
       CASE WHEN $4 = 'final' THEN $16::timestamptz ELSE NULL END
     )
     ON CONFLICT (trade_id, evidence_hash) DO NOTHING`,
    [outcomeId, tradeId, revision, outcome.status, outcome.schema_version, outcome.engine_version,
      outcome.initial_risk_amount, outcome.gross_realized_pnl, outcome.total_fees,
      outcome.net_realized_pnl, outcome.result_r, outcome.mfe_r, outcome.mae_r,
      outcome.evidence_hash, JSON.stringify(outcome.evidence), outcome.calculated_at_utc],
  );
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
  return outcome;
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
