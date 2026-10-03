import test from "node:test";
import assert from "node:assert/strict";
import { OosReplayCutoff, replayCutoffProof } from "../src/oos-replay-cutoff.js";
import { OosTradingViewReplay } from "../src/oos-tradingview-replay.js";
import { OosReplayProgress, replayObservation } from "../src/oos-replay-progress.js";

const cutoff = "2026-07-01T09:00:00+02:00", at = Date.parse(cutoff) / 1000;
const observed = { replay: true, autoplay: false, resolution: "15", timezone: "Europe/Paris",
  symbol: "CME_MINI_DL:MES1!", at: at - 1, last_bar_time: at - 900, previous_bar_time: at - 1800 };
function fixture(snapshots = [observed]) {
  let time = 0, reads = 0; const calls = [];
  const capture = { setCutoffIdentity: async value => { calls.push(["cutoff", value]); },
    raw: async (name, input) => { calls.push([name, input]); }, evaluate: async () => ({ ready_state: "complete" }),
    observation: async () => snapshots[Math.min(reads++, snapshots.length - 1)] };
  const proof = new OosReplayCutoff({ capture, provider: { getTargetInfo: async () => ({ id: "TEST_ONLY" }) },
    settings: { ui_transition_ms: 5, poll_ms: 1, retry_backoff_ms: 1, max_retries: 1 },
    now: () => time, wait: async ms => { time += ms; } });
  return { proof, capture, calls };
}

test("09:00 Paris is 07:00 UTC; last closed native M15 ends at cutoff and next allowed bar starts there", () => {
  const proof = replayCutoffProof(observed, cutoff);
  assert.equal(proof.proof_condition_result, true); assert.equal(proof.expected_cutoff, "2026-07-01T07:00:00.000Z");
  assert.equal(proof.observed_bar_open, "2026-07-01T06:45:00.000Z");
  assert.equal(proof.observed_bar_close, "2026-07-01T07:00:00.000Z");
  assert.deepEqual(proof.expected_first_replay_bar, { open: "2026-07-01T07:00:00.000Z", close: "2026-07-01T07:15:00.000Z" });
});
test("European DST uses the supplied offset, never the host timezone or a fixed UTC+2", () => {
  for (const [cutoff, expected] of [["2026-03-27T09:00:00+01:00", "08"], ["2026-03-30T09:00:00+02:00", "07"],
    ["2026-10-23T09:00:00+02:00", "07"], ["2026-10-26T09:00:00+01:00", "08"]]) {
    const end = Date.parse(cutoff) / 1000;
    const p = replayCutoffProof({ ...observed, at: end - 1, last_bar_time: end - 900, previous_bar_time: end - 1800 }, cutoff);
    assert.equal(p.proof_condition_result, true); assert.equal(p.expected_cutoff.slice(11, 13), expected);
  }
});
test("currentDate alone neither proves nor disproves cutoff; visible native bars remain authoritative", () => {
  for (const current of [null, undefined, at + 86400, at - 1]) {
    assert.equal(replayCutoffProof({ ...observed, at: current }, cutoff).proof_condition_result, true);
  }
  for (const change of [{ last_bar_time: at }, { last_bar_time: at - 600 }, { last_bar_time: at - 1800 },
    { autoplay: true }, { replay: false }, { resolution: "240" }, { timezone: "UTC" }, { symbol: "OTHER" }, { loading: true },
    { data_connected: false }, { replay_session_connected: false }, { selected_at: at + 900 }]) {
    assert.equal(replayCutoffProof({ ...observed, ...change, at: at - 1 }, cutoff).proof_condition_result, false);
  }
});
test("disconnected cached bars cannot certify cutoff; reconnect preserves the historical session", async () => {
  const f = fixture([{ ...observed, data_connected: false }, { ...observed, data_connected: true }, { ...observed, data_connected: true }]);
  const expressions = []; f.capture.evaluate = async expression => { expressions.push(expression); return { reconnect_requested: true }; };
  const result = await f.proof.position({ cutoff });
  assert.equal(result.cutoff_proof.data_connected, true);
  assert.ok(expressions.some(e => e.includes("a.connect()")));
  assert.ok(expressions.every(e => !/stopReplay|reload|doStep|setInput/.test(e)));
});
test("cutoff waits for real M15 layout/data after stale H4 state, without stepping or plan/PREMARKET writes", async () => {
  const f = fixture([{ ...observed, resolution: "240", last_bar_time: at - 14400 }, observed, observed]);
  const result = await f.proof.position({ cutoff });
  assert.equal(result.cutoff_proof.proof_condition_result, true);
  assert.deepEqual(f.calls.map(c => c[0]), ["cutoff", "chart_set_timeframe", "replay_start"]);
  assert.equal(f.calls[2][1].date, "2026-07-01T07:00:00.000Z");
  await assert.rejects(f.proof.position({ cutoff, progress: { steps_completed: 1 } }), /REPLAY_RESUME_REQUIRED/);
  assert.equal(f.calls.length, 3);
});
test("failed cutoff proof returns complete diagnostic fields with bounded retries", async () => {
  const f = fixture([{ ...observed, last_bar_time: at }]);
  await assert.rejects(f.proof.position({ cutoff, progress: { steps_completed: 0 } }), error => {
    assert.equal(error.code, "TV_CUTOFF_NOT_PROVEN");
    for (const field of ["expected_cutoff", "observed_replay_time", "observed_bar_open", "observed_bar_close", "timeframe",
      "timezone", "expected_first_replay_bar", "current_replay_cursor", "current_chart_last_bar", "proof_source", "proof_condition",
      "proof_condition_result", "last_confirmed_replay_time", "steps_completed", "retry_count", "browser_state", "reason_exacte_du_rejet"]) {
      assert.ok(Object.hasOwn(error.details, field), field);
    }
    assert.equal(error.details.retry_count, 1); assert.equal(error.details.proof_condition_result, false);
    assert.ok(error.details.reason_exacte_du_rejet.includes("no_post_cutoff_bar")); return true;
  });
  assert.equal(f.calls.filter(c => c[0] === "replay_start").length, 2);
});
test("initial replay positioning and start use native cutoff proof, not the PREMARKET anchor-only checker", async () => {
  const f = fixture([{ ...observed, at: null }]); const replay = new OosTradingViewReplay({ capture: { ...f.capture,
    awaitCutoff: () => { throw new Error("MUST_NOT_USE_PREMARKET_CHECKER"); } } });
  replay.cutoff = f.proof; replay.engine.loadedHash = "f".repeat(64); replay.engine.verifyInputs = async () => {};
  replay.configureProgress = async () => {};
  await replay.call("setReplayCutoff", { cutoff, replay_only: true }); replay.capture.cutoff = cutoff;
  await replay.start({ replay_only: true, plan_sha256: "f".repeat(64) });
  assert.equal(replay.cutoffProof.proof_condition_result, true);
  assert.equal(replay.trace[0].visible_as_of, "2026-07-01T06:59:59.000Z");
});
test("27/28/29 July retain the same closed M15 start proof; no historical run is launched", () => {
  for (const day of ["27", "28", "29"]) {
    const cutoff = `2026-07-${day}T09:00:00+02:00`, end = Date.parse(cutoff) / 1000;
    assert.equal(replayCutoffProof({ ...observed, at: end - 1, last_bar_time: end - 900, previous_bar_time: end - 1800 }, cutoff).proof_condition_result, true);
  }
});
test("cutoff provenance survives progress checkpoints; first simulated bar starts exactly at the proved bound", async () => {
  const proof = replayCutoffProof(observed, cutoff), writes = [];
  const progress = new OosReplayProgress({ persist: async p => writes.push(structuredClone(p)), now: () => 0 });
  await progress.initialize({ observation: replayObservation(observed), cutoff, target: "2026-07-01T20:00:00+02:00", cutoffProof: proof });
  assert.equal(progress.state.steps_completed, 0);
  await progress.confirm(replayObservation({ ...observed, last_bar_time: at }), "BAR_CONFIRMED");
  assert.deepEqual(writes.at(-1).tv_replay_state.cutoff_proof, proof);
  assert.equal(writes.at(-1).last_confirmed_bar_time, "2026-07-01T07:00:00.000Z");
});
