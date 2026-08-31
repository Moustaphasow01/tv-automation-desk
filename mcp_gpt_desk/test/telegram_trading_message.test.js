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

  assert.match(message, /🚨 MANUAL ACTION REQUIRED/);
  assert.match(message, /🟢 ACHAT MNQ/);
  assert.match(message, /Human Gate: AWAITING_MANUAL_CONFIRMATION/);
  assert.match(message, /Entrée: LIMIT 30 000/);
  assert.match(message, /Stop: 29 980/);
  assert.match(message, /TP: 30 040/);
  assert.match(message, /OrderIntent: order_intent_1/);
  assert.match(message, /Aucun ordre Ninja\/broker n’a été envoyé/);
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
  assert.match(candidate.message, /MANUAL ACTION REQUIRED/);
});
