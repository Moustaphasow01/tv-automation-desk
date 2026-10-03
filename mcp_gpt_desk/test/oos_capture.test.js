import test from "node:test";
import assert from "node:assert/strict";
import { OosTradingViewCapture, OOS_TV_TOOLS, isProvenCutoff, isClosedBar, completeBarCutoff } from "../src/oos-tradingview-capture.js";

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
  const obs = await bridge.observation();
  assert.equal(isProvenCutoff({ ...obs, at: obs.at - 1000 }, cutoff), true);
  assert.equal(isProvenCutoff({ ...obs, at: obs.at + 1000 }, cutoff), false);
  assert.equal(isProvenCutoff({ ...obs, at: obs.at - 60000 }, cutoff), false);
  assert.equal(isProvenCutoff({ ...obs, autoplay: true }, cutoff), false);
  assert.equal(isProvenCutoff({ ...obs, last_bar_time: obs.at / 1000 + 60 }, cutoff), false);
});

test("H4 opening before 09:00 but closing afterwards is excluded, not certified by cursor alone", async () => {
  const cutoff = "2026-07-30T09:00:00+02:00", eight = Date.parse("2026-07-30T08:00:00+02:00") / 1000;
  assert.equal(isClosedBar({ last_bar_time: eight }, "4h", cutoff), false);
  assert.equal(isClosedBar({ last_bar_time: eight - 14400 }, "4h", cutoff), true);
  const bridge = new OosTradingViewCapture({}); bridge.cutoff = cutoff;
  const sought = []; bridge.raw = async () => ({});
  bridge.seek = async at => { sought.push(at); bridge.effectiveCutoff = at; return { last_bar_time: sought.length === 1 ? eight : eight - 14400 }; };
  bridge.awaitScopedCutoff = async () => ({ last_bar_time: eight });
  bridge.awaitClosedCutoff = async () => ({});
  await bridge.setTimeframe("4h");
  assert.deepEqual(sought, [cutoff, "2026-07-30T06:00:00.000Z"]);
  assert.equal(bridge.cutoff, cutoff);
});

for (const firstBar of ["2026-08-20T02:00:00Z", "2026-08-20T06:00:00Z"]) {
  test(`global/zoom share H4 closed bound when the first snapshot is ${firstBar}`, async () => {
    const cutoff = "2026-08-20T09:00:00+02:00", bridge = new OosTradingViewCapture({ wait: async () => {} });
    bridge.cutoff = cutoff; const seeks = []; bridge.raw = async () => ({});
    bridge.seek = async at => { seeks.push(at); bridge.effectiveCutoff = at;
      return { last_bar_time: Date.parse(seeks.length === 1 ? firstBar : "2026-08-20T02:00:00Z") / 1000 }; };
    bridge.awaitScopedCutoff = async () => ({ last_bar_time: Date.parse(firstBar) / 1000 });
    bridge.observation = async () => ({ replay: true, autoplay: false, symbol: "CME_MINI:MES1!",
      timezone: "Europe/Paris", resolution: "240", at: Date.parse(bridge.effectiveCutoff) / 1000 - 1,
      last_bar_time: Date.parse("2026-08-20T02:00:00Z") / 1000 });
    await bridge.setTimeframe("4h"); await bridge.preset("global");
    const global = bridge.effectiveCutoff;
    await bridge.setTimeframe("4h"); await bridge.preset("zoom");
    assert.equal(global, "2026-08-20T06:00:00.000Z"); assert.equal(bridge.effectiveCutoff, global);
    assert.deepEqual(seeks, [cutoff, global, global]);
  });
}

test("closed-bound calculation uses the native bar clock, not a fixed Paris/UTC offset", () => {
  for (const [cutoff, open, expected] of [
    ["2026-08-20T09:00:00+02:00", "2026-08-20T02:00:00Z", "2026-08-20T06:00:00.000Z"],
    ["2026-01-20T09:00:00+01:00", "2026-01-20T03:00:00Z", "2026-01-20T07:00:00.000Z"]]) {
    assert.equal(completeBarCutoff({ last_bar_time: Date.parse(open) / 1000 }, "4h", cutoff), expected);
  }
  assert.throws(() => completeBarCutoff({ last_bar_time: null }, "4h", "2026-08-20T07:00:00Z"), /TV_BAR_CLOCK_UNPROVEN/);
});

test("cutoff calculation waits for the requested native timeframe after a chart transition", async () => {
  const bridge = new OosTradingViewCapture({ wait: async () => {} }); bridge.timeframe = "4h";
  const obs = { symbol: "CME_MINI:MES1!", timezone: "Europe/Paris", at: 1787209199, last_bar_time: 1787191200 };
  let reads = 0;
  bridge.awaitCutoff = async () => ({ ...obs, resolution: ++reads < 3 ? "60" : "240" });
  assert.equal((await bridge.awaitScopedCutoff()).resolution, "240"); assert.equal(reads, 4);
});

test("a provisional H4 candle never satisfies stable closed capture proof", async () => {
  const bridge = new OosTradingViewCapture({ wait: async () => {} });
  bridge.timeframe = "4h"; bridge.effectiveCutoff = "2026-08-20T06:00:00Z";
  bridge.awaitCutoff = async () => ({ symbol: "CME_MINI:MES1!", resolution: "240", timezone: "Europe/Paris",
    at: Date.parse("2026-08-20T05:59:59Z") / 1000, visible_as_of: "2026-08-20T05:59:59Z", last_bar_time: Date.parse("2026-08-20T06:00:00Z") / 1000 });
  await assert.rejects(bridge.awaitClosedCutoff(), /TV_CLOSED_CUTOFF_NOT_STABLE/);
});
