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
