import test from "node:test";
import assert from "node:assert/strict";
import { OosReplayProgress, replayObservation } from "../src/oos-replay-progress.js";
import { TradingViewMcpAdapter } from "../../packages/desk-oos-batch/src/adapter/tradingview-mcp.js";
import { OosTradingViewReplay } from "../src/oos-tradingview-replay.js";
import { oosHash } from "../src/oos-tradingview-engine.js";

const cutoff = "2026-07-27T09:00:00+02:00", start = Date.parse(cutoff) / 1000;
function fixture(overrides = {}) {
  let time = 0, bar = start - 900, calls = 0;
  const writes = [];
  const observe = async () => replayObservation({ at: start - 1, last_bar_time: bar,
    replay: true, autoplay: false, resolution: "15" });
  const controller = new OosReplayProgress({ observe, command: async () => { calls++; bar += 900; },
    ui: async () => ({ loading: false, modal: false }), ready: async () => {},
    persist: async state => writes.push(structuredClone(state)), now: () => time,
    wait: async ms => { time += ms; }, settings: { progress_ms: 3, poll_ms: 1, retry_backoff_ms: 1, max_retries: 2 }, ...overrides });
  return { controller, writes, observe, setBar: value => { bar = value; }, get calls() { return calls; } };
}
async function initialize(f, prior) {
  await f.controller.initialize({ observation: await f.observe(), target: "2026-07-27T20:00:00+02:00",
    prior, configHash: "SYNTHETIC_CONFIG", cutoff });
}
test("fixed selection anchor does not mask actual historical bar progress", async () => {
  const f = fixture(); await initialize(f);
  const obs = await f.controller.step({ observation: await f.observe(), bound: start + 900 });
  assert.equal(obs.selection_anchor, start - 1); assert.equal(obs.at, start + 899);
  assert.equal(f.calls, 1); assert.equal(f.controller.state.steps_completed, 1);
  assert.equal(f.writes.at(-1).last_confirmed_bar_time, new Date(start * 1000).toISOString());
});
test("MCP timeout after successful step reconciles; never duplicates the mutation", async () => {
  const f = fixture(); await initialize(f);
  f.controller.command = async () => { f.setBar(start); throw Object.assign(new Error("timeout"), { code: "TEST_MCP_TIMEOUT" }); };
  await f.controller.step({ observation: await f.observe(), bound: start + 900 });
  assert.equal(f.controller.state.steps_completed, 1); assert.equal(f.controller.state.retry_count, 0);
  assert.equal(f.controller.errors[0].code, "TEST_MCP_TIMEOUT");
});
test("progress immediately after deadline is success, not automatic failure", async () => {
  const f = fixture(); await initialize(f); let reads = 0, commands = 0;
  f.controller.command = async () => { commands++; };
  f.controller.observe = async () => { if (++reads === 5) f.setBar(start); return f.observe(); };
  await f.controller.step({ observation: await f.observe(), bound: start + 900 });
  assert.equal(commands, 1); assert.equal(f.controller.state.retry_count, 0);
});
test("stalled replay has bounded retries and complete diagnostic evidence", async () => {
  const f = fixture({ command: async () => {} }); await initialize(f);
  await assert.rejects(f.controller.step({ observation: await f.observe(), bound: start + 900 }), error => {
    assert.equal(error.code, "TV_REPLAY_STEP_TIMEOUT");
    for (const key of ["stage", "tradingview_current_time", "target_time", "timeframe", "steps_completed",
      "last_success_at", "timeouts", "expected_condition", "observed_condition", "ui", "mcp_errors", "retry_count"]) {
      assert.ok(Object.hasOwn(error.details, key), key);
    }
    assert.equal(error.details.retry_count, 2); return true;
  });
  assert.equal(f.controller.state.retry_count, 2); assert.ok(f.writes.at(-1).last_error);
});
test("restart reconciles current UI without issuing an already-confirmed step", async () => {
  const f = fixture(); await initialize(f);
  await f.controller.step({ observation: await f.observe(), bound: start + 900 });
  const prior = structuredClone(f.controller.state), g = fixture(); g.setBar(start);
  await initialize(g, prior); assert.equal(g.calls, 0); assert.equal(g.controller.state.steps_completed, 1);
  g.setBar(start + 900);
  await g.controller.step({ observation: await f.observe(), bound: start + 1800 });
  assert.equal(g.calls, 0); assert.equal(g.controller.state.steps_completed, 2);
});
test("regression, autoplay, overshoot and config drift fail closed", async () => {
  const f = fixture(); await initialize(f); const prior = { ...f.controller.state,
    last_confirmed_bar_time: new Date(start * 1000).toISOString() };
  await assert.rejects(initialize(f, prior), { code: "TV_REPLAY_RESUME_REGRESSION" });
  await assert.rejects(initialize(f, { ...f.controller.state, config_hash: "CHANGED" }), { code: "TV_REPLAY_RESUME_CONFIG_MISMATCH" });
  assert.throws(() => f.controller.assertControl({ replay: true, autoplay: true, resolution: "15" }, start), /CONTROL_LOST/);
  assert.throws(() => f.controller.assertControl({ replay: true, autoplay: false, resolution: "15", at: start + 1 }, start), /OVERSHOOT/);
});
test("a confirmed resume never resets the cutoff or reloads the frozen plan", async () => {
  const calls = [], adapter = new TradingViewMcpAdapter(async (name, input) => {
    calls.push({ name, input }); return { resumed: true };
  });
  await adapter.prepareFrozenReplay({ meta: { status: "FROZEN", plan_sha256: "a".repeat(64) },
    plan_text: "SYNTHETIC_EXACT_BYTES", progress: { steps_completed: 1 } });
  assert.deepEqual(calls.map(x => x.name), ["resumeFrozenReplay"]);
  assert.equal(calls[0].input.plan_sha256, "a".repeat(64));
});
test("a lost progressed session cannot silently restart at the cutoff", async () => {
  const calls = [], adapter = new TradingViewMcpAdapter(async name => { calls.push(name); return { resumed: false }; });
  await assert.rejects(adapter.prepareFrozenReplay({ meta: { status: "FROZEN", plan_sha256: "a".repeat(64) },
    progress: { steps_completed: 1 } }), { code: "REPLAY_RESUME_REQUIRED" });
  assert.deepEqual(calls, ["resumeFrozenReplay"]);
});
test("resume accepts a moving mid-session anchor only with a persisted, scoped progress record", async () => {
  const plan = "SYNTHETIC_RESUME_PLAN", hash = oosHash(plan), calls = [];
  const capture = { assertChart: async () => calls.push("assert"),
    evaluate: async () => ({ engine: { id: "SYNTHETIC_ENGINE" }, plan }) };
  const replay = new OosTradingViewReplay({ capture });
  replay.engine = { ids: { mode: "mode", book: "book" }, initialize: async () => {},
    verifyInputs: async () => {}, descriptor: { values: [
      { id: "mode", value: "REPLAY" }, { id: "book", value: "PORTEFEUILLE_REALISTE" }] } };
  let obs = replayObservation({ at: start + 7199, last_bar_time: start + 6300,
    replay: true, autoplay: false, resolution: "15", symbol: "CME_MINI_DL:MES1!", timezone: "Europe/Paris" });
  replay.observation = async () => obs;
  replay.configureProgress = async () => { calls.push("reconcile"); replay.progress = { state: {} }; };
  replay.ready = async () => {};
  const input = { date: "2026-07-27", cutoff, replay_only: true, engine_version: "V3.9.8",
    symbol: "CME_MINI:MES1!", book_mode: "PORTEFEUILLE_REALISTE", plan_sha256: hash,
    meta: { status: "FROZEN", premarket_manifest_sha256: "b".repeat(64) },
    progress: { steps_completed: 8, plan_sha256: hash, replay_target_time: "2026-07-27T20:00:00+02:00",
      last_confirmed_bar_time: new Date((start + 6300) * 1000).toISOString() } };
  assert.equal((await replay.resume(input)).resumed, true);
  assert.deepEqual(calls, ["assert", "reconcile"]);
  await assert.rejects(replay.resume({ ...input, progress: null }), { code: "TV_REPLAY_UI_REVALIDATION_FAILED" });
  obs = { ...obs, symbol: "OTHER_SYMBOL" };
  await assert.rejects(replay.resume(input), { code: "TV_REPLAY_UI_REVALIDATION_FAILED" });
  obs = { ...obs, symbol: "CME_MINI_DL:MES1!", selection_anchor: start - 86400 };
  assert.equal((await replay.resume(input)).resumed, true); // UI anchor cannot override scoped native bars.
});

test("capture resume after restart never loads/seeks/steps a completed replay", async () => {
  const calls = [], end = "2026-07-28T20:00:00+02:00", at = Date.parse(end) / 1000;
  let resolution = "5";
  const replay = new OosTradingViewReplay({ capture: { assertChart: async () => {}, raw: async (tool, args) => {
    calls.push(tool); assert.equal(tool, "chart_set_timeframe"); assert.equal(args.timeframe, "15"); resolution = "15";
  } } });
  replay.observation = async () => ({ at: at - 1, last_bar_time: at - 900, replay: true, autoplay: false, resolution });
  replay.resume = async () => { calls.push("verify-resume"); replay.engine.configHash = "SYNTHETIC_CONFIG"; };
  replay.assertEnd = async () => {};
  const input = { replay_only: true, meta: { status: "FROZEN" }, plan_sha256: "a".repeat(64), symbol: "MES1!",
    completed_replay: { replay: true, at: end, plan_sha256: "a".repeat(64), symbol: "MES1!", config_hash: "SYNTHETIC_CONFIG" } };
  const result = await replay.resumeResultCapture(input);
  assert.equal(result.capture_only, true); assert.equal(replay.end, end);
  assert.deepEqual(calls, ["chart_set_timeframe", "verify-resume"]);
  replay.observation = async () => ({ replay: true, autoplay: false, at: at - 900, last_bar_time: at - 1800 });
  await assert.rejects(replay.resumeResultCapture(input), { code: "TV_CAPTURE_RESUME_END_UNPROVEN" });
});
