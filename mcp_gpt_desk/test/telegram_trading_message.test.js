import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTelegramTradingCandidate,
  buildTelegramTradingMessage,
  telegramTradingDeliverySuppressionReason,
} from "../src/telegram-trading-message.js";

test("manual Telegram entry ticket is directly actionable and broker-safe", () => {
  const message = buildTelegramTradingMessage({
    kind: "order_intent",
    state: "pending_approval",
    sourceId: "order_intent_1",
    occurredAt: "2026-08-12T14:05:00.000Z",
    manualTelegramExecution: true,
    payload: {
      ...qualifiedPlan(),
      instrument: "MNQ",
      broker_symbol: "MNQ 09-26",
      side: "buy",
      order_type: "limit",
      quantity: 1,
      limit_price: 30000,
      protective_stop: 29980,
      profit_target: 30040,
      expires_at: "2026-08-12T14:06:00.000Z",
    },
  });

  assert.match(message, /ORDRE QUALIFIÉ — À CONFIRMER/);
  assert.match(message, /🟢 ACHAT MNQ/);
  assert.match(message, /Validation humaine: AWAITING_MANUAL_CONFIRMATION/);
  assert.match(message, /Entrée: LIMITE 30 000/);
  assert.match(message, /Stop: 29 980/);
  assert.match(message, /TP: 30 040/);
  assert.match(message, /OrderIntent: order_intent_1/);
  assert.match(message, /Notification ≠ exécution/);
});

test("manual Telegram management ticket highlights the operator action", () => {
  const message = buildTelegramTradingMessage({
    kind: "management_intent",
    state: "pending_approval",
    sourceId: "management_1",
    occurredAt: "2026-08-12T14:15:00.000Z",
    manualTelegramExecution: true,
    payload: {
      trade_id: "trade_1",
      instrument: "MNQ",
      action: "move_stop",
      quantity: 1,
      stop_price: 30010,
      reason: "break-even confirmé",
    },
  });

  assert.match(message, /🛡️ GESTION MANUELLE — Déplacer le stop/);
  assert.match(message, /Instrument: MNQ/);
  assert.match(message, /Nouveau stop: 30 010/);
  assert.match(message, /Modifier manuellement la position/);
});

test("theoretical execution alert is explicit, readable and never presented as a broker fill", () => {
  const message = buildTelegramTradingMessage({
    kind: "theoretical_execution_event",
    state: "target_hit",
    sourceId: "theoretical_event_1",
    occurredAt: "2026-08-30T16:05:00.000Z",
    payload: {
      portfolio_order_intent_id: "poi_1",
      trade_id: "trade_1",
      event_type: "target_hit",
      instrument: "ZC",
      side: "buy",
      price: 430.25,
      entry_price: 427.5,
      exit_price: 430.25,
      result_r: 1.75,
    },
  });

  assert.match(message, /🎯 OBJECTIF THÉORIQUE TOUCHÉ/);
  assert.match(message, /\+1,75R/);
  assert.match(message, /Simulation backend déterministe/);
  assert.match(message, /Aucun fill broker n’est déduit/);
  assert.match(message, /OrderIntent: poi_1/);
});

test("manual execution receipt remains observational", () => {
  const message = buildTelegramTradingMessage({
    kind: "manual_execution_event",
    state: "filled",
    sourceId: "manual_event_1",
    occurredAt: "2026-08-30T16:06:00.000Z",
    payload: { portfolio_order_intent_id: "poi_1", instrument: "ZW", event_type: "filled", quantity: 1, price: 520, source: "front", actor: "MSO" },
  });
  assert.match(message, /DÉCLARATION OPÉRATEUR — FILLED/);
  assert.match(message, /ne réécrit pas le suivi théorique/);
});

test("expired OrderIntent is never projected as a new manual action", () => {
  const row = {
    source_kind: "order_intent",
    source_id: "portfolio_order_intent_expired",
    source_state: "awaiting_confirmation",
    occurred_at: "2026-08-31T15:59:00.000Z",
    payload: {
      instrument: "ZW",
      side: "sell",
      order_type: "limit",
      quantity: 1,
      limit_price: 759.25,
      expires_at: "2026-08-31T16:30:33.423Z",
    },
  };

  assert.equal(buildTelegramTradingCandidate(row, {
    manualTelegramExecution: true,
    now: "2026-08-31T16:30:33.423Z",
  }), null);
  assert.equal(telegramTradingDeliverySuppressionReason({
    sourceKind: "order_intent",
    payload: row.payload,
  }, { now: "2026-08-31T16:30:52.714Z" }), "ORDER_INTENT_EXPIRED_BEFORE_TELEGRAM_DELIVERY");
});

test("valid OrderIntent remains eligible until its exact expiry", () => {
  const candidate = buildTelegramTradingCandidate({
    source_kind: "order_intent",
    source_id: "portfolio_order_intent_valid",
    source_state: "awaiting_confirmation",
    occurred_at: "2026-08-31T16:00:00.000Z",
    payload: {
      ...qualifiedPlan(),
      instrument: "ZW",
      side: "sell",
      order_type: "limit",
      quantity: 1,
      limit_price: 759.25,
      expires_at: "2026-08-31T16:30:33.423Z",
    },
  }, {
    manualTelegramExecution: true,
    now: "2026-08-31T16:30:33.422Z",
  });

  assert.ok(candidate);
  assert.equal(candidate.payload.source_state, "awaiting_confirmation");
  assert.match(candidate.message, /ORDRE QUALIFIÉ — À CONFIRMER/);
});

function qualifiedPlan() {
  return {
    telegram_qualification_source: "portfolio_risk_human_gate",
    order_intent_id: "order_intent_1", target_position_id: "target_1", human_execution_gate_id: "gate_1",
    risk_decision: "APPROVED", human_gate_status: "AWAITING_MANUAL_CONFIRMATION",
    instrument: "ZW", side: "buy", order_type: "limit", quantity: 1,
    entry_price: 520, protective_stop: 518, profit_target: 524, expires_at: "2026-09-05T11:00:00Z",
  };
}

test("raw signals and unqualified, rejected or decided intents never become actionable notifications", () => {
  const options = { manualTelegramExecution: true, now: "2026-09-05T10:00:00Z" };
  const row = { source_kind: "order_intent", source_id: "poi_1", source_state: "awaiting_manual_confirmation" };
  for (const payload of [{}, { ...qualifiedPlan(), risk_decision: "REJECTED" },
    { ...qualifiedPlan(), human_gate_status: "CONFIRMED" }, { ...qualifiedPlan(), human_gate_status: "REJECTED" },
    { ...qualifiedPlan(), entry_price: null }, { ...qualifiedPlan(), side: null }]) {
    assert.equal(buildTelegramTradingCandidate({ ...row, payload }, options), null);
  }
  assert.equal(buildTelegramTradingCandidate({ ...row, source_kind: "trade_decision", payload: qualifiedPlan() }, options), null);
  assert.ok(buildTelegramTradingCandidate({ ...row, payload: qualifiedPlan() }, options));
});

test("unknown gate, side and prices are neither invented nor displayed as a zero-price BUY", () => {
  const message = buildTelegramTradingMessage({ kind: "order_intent", manualTelegramExecution: true,
    payload: { instrument: "ZW", entry_price: null, protective_stop: null, profit_target: null } });
  assert.match(message, /DOSSIER À VÉRIFIER/);
  assert.match(message, /SENS NON PUBLIÉ/);
  assert.match(message, /Validation humaine: NON PUBLIÉ/);
  assert.match(message, /Entrée: N\/D/);
  assert.doesNotMatch(message, /ACHAT|Entrée: 0|Stop: 0|TP: 0/);
});
