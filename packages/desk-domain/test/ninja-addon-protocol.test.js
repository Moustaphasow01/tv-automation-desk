import assert from "node:assert/strict";
import test from "node:test";
import { compareNinjaAdapterSnapshots, createNinjaAddonCommand, normalizeNinjaAddonEvent } from "../index.js";

const now = "2026-07-22T14:00:00.000Z";

test("AddOn entry command preserves approved quantity and ATM protection", () => {
  const command = createNinjaAddonCommand({
    workType: "entry",
    leased: { order_intent_id: "order_intent_12345678", expires_at: "2026-07-22T14:01:00.000Z", command_payload: { broker_symbol: "MNQ 09-26", action: "BUY", quantity: 2, order_type: "limit", limit_price: 30000, protective_stop: 29980, profit_target: 30040, time_in_force: "DAY", atm_strategy_id: "desk_atm_1" } },
    context: { intent: {}, contract: { broker_symbol: "MNQ 09-26" } },
    accountName: "Sim101", atmStrategyName: "TVA_SIM_SAFE_1X_320_400", now,
  });
  assert.equal(command.action, "place_entry");
  assert.equal(command.quantity, 2);
  assert.equal(command.atm_strategy_name, "TVA_SIM_SAFE_1X_320_400");
  assert.match(command.command_id, /^addon_[a-f0-9]{32}$/);
});

test("AddOn command refuses non-simulation accounts", () => {
  assert.throws(() => createNinjaAddonCommand({ workType: "entry", leased: {}, context: {}, accountName: "Live001", now }), (error) => error.code === "ADDON_SIM_ACCOUNT_REQUIRED");
});

test("AddOn management command targets the exact protective stop", () => {
  const command = createNinjaAddonCommand({
    workType: "management",
    leased: { management_intent_id: "management_intent_12345678", expires_at: "2026-07-22T14:01:00.000Z" },
    context: { intent: { action: "move_stop", requested_stop_price: 30000, expected_trade_revision: 4 }, trade: { side: "long", quantity_open: 2, raw: { protective_stop_order_ref: "NT-STOP-1" } }, contract: { broker_symbol: "MNQ 09-26" } },
    accountName: "Sim101", now,
  });
  assert.equal(command.action, "move_stop");
  assert.equal(command.broker_order_ref, "NT-STOP-1");
  assert.equal(command.stop_price, 30000);
});

test("AddOn events and shadow snapshots normalize deterministically", () => {
  const event = normalizeNinjaAddonEvent({ event_type: "position", occurred_at: now, payload: { instrument: "MNQ 09-26", quantity: 1 } });
  assert.match(event.event_id, /^addon_event_/);
  const parity = compareNinjaAdapterSnapshots(
    { positions: [{ instrument: "MNQ 09-26", quantity: 1, market_position: "LONG", average_price: 30000 }] },
    { positions: [{ broker_symbol: "MNQ 09-26", quantity: 1, side: "long", avg_price: 30000 }] },
  );
  assert.equal(parity.status, "matched");
  assert.equal(parity.mismatch_count, 0);
});
