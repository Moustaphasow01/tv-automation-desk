import assert from "node:assert/strict";
import test from "node:test";
import { ninjaAtiExternalEventKey, parseNinjaAtiOutgoingFile } from "../index.js";

test("parses official ATI order state format", () => {
  const event = parseNinjaAtiOutgoingFile({
    filename: "order_intent_demo.txt",
    contents: "Partially filled;1;22450.25",
    observedAt: "2026-07-22T10:00:00.000Z",
  });
  assert.deepEqual(event, {
    kind: "order", filename: "order_intent_demo.txt", order_id: "order_intent_demo",
    status: "partially_filled", terminal: false, filled_quantity: 1, average_fill_price: 22450.25,
    observed_at: "2026-07-22T10:00:00.000Z", raw: "Partially filled;1;22450.25",
  });
});

test("strips the real NinjaTrader account prefix from ATI order update filenames", () => {
  const event = parseNinjaAtiOutgoingFile({
    filename: "Sim101_order_intent_demo.txt",
    contents: "WORKING;0;0",
    accountName: "Sim101",
  });
  assert.equal(event.kind, "order");
  assert.equal(event.order_id, "order_intent_demo");
  assert.equal(event.status, "working");
});

test("parses position and strips the documented exchange suffix", () => {
  const event = parseNinjaAtiOutgoingFile({
    filename: "MNQ 09-26 Globex_Sim101_Position.txt",
    contents: "LONG;1;22450.25",
    accountName: "Sim101",
  });
  assert.equal(event.kind, "position");
  assert.equal(event.instrument, "MNQ 09-26");
  assert.equal(event.quantity, 1);
});

test("normalizes NinjaTrader display-month position filenames to the OIF contract notation", () => {
  const event = parseNinjaAtiOutgoingFile({
    filename: "MNQ SEP26 Globex_Sim101_position.txt",
    contents: "FLAT;0;0",
    accountName: "Sim101",
  });
  assert.equal(event.instrument, "MNQ 09-26");
  assert.equal(event.market_position, "FLAT");
});

test("parses connection state and creates restart-stable event keys", () => {
  const event = parseNinjaAtiOutgoingFile({ filename: "Playback.txt", contents: "CONNECTED" });
  assert.equal(event.kind, "connection");
  assert.equal(event.state, "CONNECTED");
  assert.equal(
    ninjaAtiExternalEventKey({ filename: "a.txt", contents: "Working;0;0", modifiedAt: "123" }),
    ninjaAtiExternalEventKey({ filename: "a.txt", contents: "Working;0;0", modifiedAt: "123" }),
  );
});

test("rejects another account position file", () => {
  assert.equal(parseNinjaAtiOutgoingFile({ filename: "MNQ 09-26 Globex_Live1_Position.txt", contents: "LONG;1;1", accountName: "Sim101" }), null);
});

test("rejects another account order update file", () => {
  assert.equal(parseNinjaAtiOutgoingFile({ filename: "Live1_order_intent_demo.txt", contents: "WORKING;0;0", accountName: "Sim101" }), null);
});
