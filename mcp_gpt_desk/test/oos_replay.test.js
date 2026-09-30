import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { OosTradingViewEngine, oosHash } from "../src/oos-tradingview-engine.js";
import { OosTradingViewReplay, OOS_REPLAY_TOOLS, proveReplayEnd } from "../src/oos-tradingview-replay.js";
import { OosTradingViewPanels } from "../src/oos-tradingview-panels.js";
import { extractOosPublishedAudit } from "../src/oos-tradingview-audit.js";

function engineFixture() {
  const definitions = [["plan", "COLLER LE PLAN COMPACT ICI"], ["mode", "Mode donnees", ["REPLAY", "SUIVI LIVE"]],
    ["book", "Simulation", ["PORTEFEUILLE_REALISTE", "LAB_SIGNAUX"]], ["view", "Vue", ["AUTO", "AUDIT", "POSITIONS"]],
    ["text", "Texte", ["Normal", "Petit"]], ["width", "Largeur du tableau (%)"], ["rule", "SYNTHETIC_RULE_INPUT"]];
  const values = definitions.map(([id]) => ({ id, value: { plan: "", mode: "REPLAY", book: "PORTEFEUILLE_REALISTE", rule: 11 }[id] ?? 0 }));
  const writes = [], study = { getInputsInfo: () => definitions.map(([id, name, options]) => ({ id, name, options })),
    getInputValues: () => values, setVisible() {}, setInputValues: inputs => {
      for (const input of inputs) { values.find(x => x.id === input.id).value = input.value; writes.push(input.id); }
    }, _study: { metaInfo: () => ({ pine: { version: "19.0", digest: "TEST_ONLY" } }) } };
  // Match the installed input naming convention; no market or scenario processing is in this fixture.
  for (let i = 0; i < values.length; i++) { values[i].id = `in_${i}`; definitions[i][0] = `in_${i}`; }
  const context = vm.createContext({ window: { TradingViewApi: { _activeChartWidgetWV: { value: () => ({ getStudyById: () => study }) } } } });
  const capture = { engine: { id: "TEST_ONLY" }, evaluate: async expression => vm.runInContext(expression, context) };
  return { engine: new OosTradingViewEngine(capture), writes, values };
}

test("replay allowlist adds stepping but no broker or replay-trading tools", async () => {
  assert.deepEqual(Object.keys(OOS_REPLAY_TOOLS), ["replay_step", "ui_open_panel"]);
  const bridge = new OosTradingViewReplay({ capture: { call() { throw new Error("NO_PREMARKET_CALL_EXPECTED"); } }, provider: {} });
  bridge.active = true;
  for (const operation of ["buy", "sell", "replay_trade", "broker_order", "setRisk", "optimizePlan"]) {
    await assert.rejects(bridge.call(operation, {}), /OOS_REPLAY_OPERATION_REJECTED/);
  }
});
test("ENGINE receives frozen UTF-8 text exactly; a different hash never writes an input", async () => {
  const f = engineFixture(), plan = "SYNTHETIC_TRANSPORT_ONLY\r\n  opaque external bytes\r\n";
  await f.engine.initialize("V3.9.8");
  await assert.rejects(f.engine.load({ plan_text: plan, plan_sha256: oosHash(plan.trim()), replay_only: true, reset_simulation: true }), /FROZEN_PLAN_HASH_MISMATCH/);
  assert.deepEqual(f.writes, []);
  await f.engine.load({ plan_text: plan, plan_sha256: oosHash(plan), replay_only: true, reset_simulation: true });
  assert.equal(f.values[0].value, plan);
  assert.equal((await f.engine.verifyInputs()).plan_sha256, oosHash(plan));
  assert.deepEqual(f.writes, ["in_1", "in_0", "in_3"]);
  f.values[6].value++;
  await assert.rejects(f.engine.verifyInputs(), /ENGINE_RULE_INPUT_CHANGED/);
});
test("ENGINE control cannot change a trading-rule input, mode LIVE or an arbitrary display value", async () => {
  const f = engineFixture(); await f.engine.initialize("V3.9.8");
  await assert.rejects(f.engine.setInput("rule", 0), /INPUT_WRITE_REJECTED/);
  await assert.rejects(f.engine.setInput("mode", "SUIVI LIVE"), /INPUT_WRITE_REJECTED/);
  await assert.rejects(f.engine.setInput("view", "GUESSED_VIEW"), /INPUT_VALUE_REJECTED/);
  assert.deepEqual(f.writes, []);
});
test("end proof rejects live, autoplay, overshoot, early cursor and future bar", () => {
  const end = "2026-07-30T20:00:00+02:00", at = Date.parse(end) / 1000;
  const obs = { replay: true, autoplay: false, at: at - 1, last_bar_time: at - 900 };
  assert.equal(proveReplayEnd(obs, end), true);
  for (const change of [{ replay: false }, { autoplay: true }, { at: at + 1 }, { at: at - 900 }, { last_bar_time: at + 1 }]) {
    assert.equal(proveReplayEnd({ ...obs, ...change }, end), false);
  }
});
test("an ENGINE carry is managed by further replay bars, not a forced close or plan change", async () => {
  const at = Date.parse("2026-07-30T20:00:00+02:00") / 1000, calls = [];
  const bridge = new OosTradingViewReplay({ capture: {
    assertChart: async () => {}, raw: async operation => { calls.push(operation); }
  }, provider: {} });
  let reads = 0;
  bridge.engine.readPublished = async () => ({ tables: [{ cells: [{ row: 1, column: 1,
    text: reads++ ? "AUDIT FIN SESSION" : "AUDIT PROVISOIRE + CARRY" }] }] });
  bridge.awaitStep = async () => ({ replay: true, autoplay: false, at: at + 899, last_bar_time: at });
  const result = await bridge.drainCarry({ replay: true, autoplay: false, at: at - 1 }, "2026-07-30T20:00:00+02:00");
  assert.equal(result.at, "2026-07-30T20:15:00+02:00");
  assert.deepEqual(calls, ["replay_step"]);
  assert.equal(bridge.trace[0].carry, true);
});
test("published metrics are decoded verbatim, never recalculated from prices or logs", () => {
  const texts = ["Fills 3", "W/L 1/2", "Net -17.5$ | -0.42R", "MFEp/n 1.2/0.9", "MAEp 0.6", "GBn 0.7",
    "Dur/TTM 15/8m", "BE.5 0.32", "BE1 -0.15", "BE1.5 N/D", "P1@1R 0.25", "1m/15 11/2 FB partial",
    "evt/drop 20/1", "SH C/R/O 4/3/1", "SH W/L/NF/N 1/1/1/0"];
  const result = extractOosPublishedAudit({ tables: [{ cells: texts.map(text => ({ text })) }], logs: [{ text: "SYNTHETIC_OTHER_VALUE 999" }] });
  assert.equal(result.net_usd, -17.5); assert.equal(result.net_r, -0.42); assert.equal(result.fills, 3);
  assert.equal(result.duration, 15); assert.equal(result.time_to_mfe, 8); assert.equal(result.cf_be_1_5, null);
  assert.equal(result.rearm, null); assert.equal(result.event_count, 20); assert.equal(result.recalculated, false);
  assert.deepEqual(result.shadow, { created: 4, resolved: 3, open: 1, win: 1, loss: 1, nofill: 1, unknown: 0 });
  assert.ok(result.missing_metrics.includes("mfe_to_exit"));
});
test("a dedicated audit capture fails if panel, final title or readability is unproven", async () => {
  const panel = new OosTradingViewPanels({ engine: { capture: { assertChart: async () => {} } }, provider: {
    getClient() { throw new Error("CAPTURE_SHOULD_NOT_HAPPEN"); }
  } });
  const good = { dedicated_panel: true, maximized: true, view: "AUTO", title: "AUDIT FIN SESSION", minimum_font_size: 14,
    bounds: { x: 0, y: 0, width: 1920, height: 1500 } };
  for (const changed of [{ dedicated_panel: false }, { bounds: { height: 300 } }, { minimum_font_size: 8 }, { title: null }]) {
    panel.proof = async () => ({ ...good, ...changed });
    await assert.rejects(panel.screenshot("dashboard_final.png"), /TV_(DEDICATED_PANEL|FINAL_AUDIT_VIEW)_UNPROVEN/);
  }
});
