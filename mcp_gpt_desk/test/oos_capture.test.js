import test from "node:test";
import assert from "node:assert/strict";
import { OosTradingViewCapture, OOS_TV_TOOLS } from "../src/oos-tradingview-capture.js";

test("capture bridge cannot invoke broker, replay steps or engine input mutation", async () => {
  assert.ok(Object.keys(OOS_TV_TOOLS).every(name => !/trade|order|input|step|buy|sell/.test(name)));
  const calls = [];
  const bridge = new OosTradingViewCapture({ connection: { call: async (...args) => { calls.push(args); } } });
  for (const operation of ["loadFrozenPlan", "replayTo", "buy", "collectResults"]) {
    await assert.rejects(bridge.call(operation, {}), /OOS_REPLAY_BRIDGE_NOT_CERTIFIED/);
  }
  assert.deepEqual(calls, []);
});

test("capture bridge rejects wrong scope before accessing TradingView", async () => {
  const bridge = new OosTradingViewCapture({ connection: { call: () => { throw new Error("UNEXPECTED_CALL"); } } });
  await assert.rejects(bridge.open({ symbol: "OTHER", replay_only: true }), /TV_SCOPE_REJECTED/);
  await assert.rejects(bridge.position("2026-07-30T09:00:00Z"), /TV_CUTOFF_INVALID/);
  await assert.rejects(bridge.capture({ cutoff: "2026-07-30" }), /TV_CAPTURE_SCOPE_MISMATCH/);
});

test("cutoff proof requires stopped replay and no bar from the future", async () => {
  const cutoff = "2026-07-30T09:00:00+02:00";
  const bridge = new OosTradingViewCapture({}); bridge.cutoff = cutoff;
  bridge.observation = async () => ({ replay: true, autoplay: false, at: Date.parse(cutoff), last_bar_time: Date.parse(cutoff) / 1000 - 300 });
  assert.equal((await bridge.awaitCutoff()).visible_as_of, "2026-07-30T07:00:00.000Z");
});
