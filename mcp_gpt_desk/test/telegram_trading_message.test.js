import assert from "node:assert/strict";
import test from "node:test";

import { buildTelegramTradingMessage } from "../src/telegram-trading-message.js";

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
