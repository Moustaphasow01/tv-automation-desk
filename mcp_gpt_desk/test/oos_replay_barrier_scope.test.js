import test from "node:test";
import assert from "node:assert/strict";
import { replayScope, verifyReplayScope, attachmentChanged } from "../src/oos-replay-scope.js";
import { replayBarSequence, nativeGap } from "../src/oos-replay-barrier.js";
import { OosReplayRecovery } from "../src/oos-replay-recovery.js";
import { OosReplayProgress, replayObservation } from "../src/oos-replay-progress.js";

const input = { date: "2026-07-03", symbol: "CME_MINI:MES1!", plan_sha256: "a".repeat(64),
  engine_version: "V3.9.8", book_mode: "PORTEFEUILLE_REALISTE", cutoff: "2026-07-03T09:00:00+02:00",
  meta: { status: "FROZEN", premarket_manifest_sha256: "b".repeat(64) } };
const start = Date.parse(input.cutoff) / 1000, previous = start + 39 * 900;
const iso = seconds => new Date(seconds * 1000).toISOString();
const observation = (bar, times = [bar]) => replayObservation({ last_bar_time: bar, bar_times: times,
  resolution: "15", replay: true, autoplay: false, at: start - 1, timezone: "Europe/Paris",
  symbol: "CME_MINI_DL:MES1!", tv_replay_session_id: "NEW_TV" });
function prior() {
  const scope = replayScope(input);
  return { plan_sha256: input.plan_sha256, ...scope, steps_completed: 40, retry_count: 0,
    replay_current_time: iso(previous + 899), replay_target_time: scope.immutable_scope.session_end,
    last_confirmed_bar_time: iso(previous), tv_replay_state: { ...scope,
      cutoff_proof: { expected_cutoff: scope.immutable_scope.cutoff } },
    ephemeral_scope: { browser_session_id: "OLD_BROWSER", tv_replay_session_id: "OLD_TV" } };
}

test("exact one native M15 bar advances the barrier, never currentDate", () => {
  const proof = replayBarSequence({ previous, observation: observation(previous + 900), bound: previous + 1800 });
  assert.equal(proof.accepted, true); assert.equal(proof.bars_actually_advanced, 1);
  assert.equal(proof.expected_next_bar_open, iso(previous + 900));
});
test("unexpected multiple bars require a complete native sequence", () => {
  const observed = observation(previous + 2700, [previous + 900, previous + 1800, previous + 2700]);
  assert.equal(replayBarSequence({ previous, observation: observed, bound: previous + 3600 }).accepted, true);
  observed.bar_times = [previous, previous + 2700];
  assert.equal(replayBarSequence({ previous, observation: observed, bound: previous + 3600 }).accepted, false);
});
test("session overshoot is rejected even when every intermediate bar exists", () => {
  const proof = replayBarSequence({ previous, observation: observation(previous + 900), bound: previous + 900 });
  assert.equal(proof.accepted, false); assert.equal(proof.reason, "SESSION_BARRIER_EXCEEDED");
});
test("scope hashing is deterministic and excludes browser/TradingView identities", () => {
  assert.deepEqual(replayScope(input), replayScope({ ...input, browser_session_id: "OTHER", tv_replay_session_id: "OTHER" }));
  assert.equal(replayScope(input).immutable_scope_hash.length, 64);
  assert.equal(replayScope(input).immutable_scope_hash, replayScope(input).replay_scope_hash);
});
test("JSONB key reordering cannot turn the same immutable scope into a mismatch", () => {
  const persisted = prior();
  persisted.tv_replay_state.immutable_scope = Object.fromEntries(Object.entries(persisted.immutable_scope).reverse());
  assert.equal(verifyReplayScope({ ...input, progress: persisted }).immutable_scope_hash, replayScope(input).immutable_scope_hash);
});
for (const [field, value] of [["date", "2026-07-06"], ["plan_sha256", "c".repeat(64)],
  ["symbol", "CME_MINI:MNQ1!"], ["book_mode", "OTHER"], ["engine_version", "OTHER"]]) {
  test(`immutable ${field} mismatch rejects before any UI mutation`, () => {
    assert.throws(() => verifyReplayScope({ ...input, [field]: value, progress: prior() }),
      error => error.code === "TV_REPLAY_RESUME_SCOPE_MISMATCH" && Object.keys(error.details).length > 0);
  });
}
test("manifest mismatch rejects; legacy progress is adopted only from pinned target/plan/cutoff", () => {
  assert.throws(() => verifyReplayScope({ ...input, meta: { ...input.meta, premarket_manifest_sha256: "c".repeat(64) }, progress: prior() }), /SCOPE_MISMATCH/);
  const legacy = prior(); delete legacy.immutable_scope_hash; delete legacy.tv_replay_state.immutable_scope;
  delete legacy.tv_replay_state.immutable_scope_hash;
  assert.equal(verifyReplayScope({ ...input, progress: legacy }).immutable_scope_hash, replayScope(input).immutable_scope_hash);
});
test("ephemeral replacement is recoverable, not an immutable mismatch", () => {
  const current = { browser_session_id: "NEW_BROWSER", tv_replay_session_id: "NEW_TV" };
  assert.equal(attachmentChanged(prior(), current), true);
  assert.doesNotThrow(() => verifyReplayScope({ ...input, progress: prior() }));
});

function recoveryFixture() {
  const calls = []; let time = 0, bar = Date.parse("2026-07-05T22:00:00Z") / 1000;
  const replay = { timeouts: { ui_transition_ms: 10, command_ms: 10, poll_ms: 1 },
    provider: { getTargetInfo: async () => ({ id: "NEW_BROWSER" }) },
    cutoff: { reconnectData: async () => calls.push("reconnect") },
    engine: { verifyInputs: async () => calls.push("verify-exact-plan") },
    capture: { raw: async (name, args) => { calls.push(name); if (name === "replay_start") bar = Date.parse(args.date) / 1000 - 900; },
      evaluate: async () => calls.push("set-replay-timeframe") },
    observation: async () => observation(bar, bar === previous ? [start - 900, start, previous] : [previous, bar]) };
  const recovery = new OosReplayRecovery({ replay, now: () => time, wait: async ms => { time += ms; } });
  return { replay, recovery, calls };
}
test("same date/plan after browser restart restores exact checkpoint and revalidates native cutoff", async () => {
  const f = recoveryFixture(), result = await f.recovery.reconcile({ ...input, progress: prior() }, await f.replay.observation());
  assert.equal(result.observation.last_bar_time, previous);
  assert.equal(result.progress.steps_completed, 40); assert.equal(result.progress.resume_count, 1);
  assert.equal(result.progress.tv_replay_state.attachment_event, "TV_REPLAY_EPHEMERAL_SESSION_CHANGED");
  assert.deepEqual(f.calls, ["reconnect", "chart_set_timeframe", "replay_start", "set-replay-timeframe", "verify-exact-plan"]);
});
test("native trading interruption restores progress but never fabricates the missing M15 bar", async () => {
  const f = recoveryFixture(), observed = await f.replay.observation();
  const gap = nativeGap(observed, previous);
  assert.equal(gap.expected_next_bar_open, iso(previous + 900));
  const restored = await f.recovery.reconcile({ ...input, progress: prior() }, observed);
  assert.deepEqual(restored.progress.tv_replay_state.native_gap, gap);
});
test("a proved missing session bar fails before mutation or publication and is retry-idempotent", async () => {
  const f = recoveryFixture(), observed = await f.replay.observation();
  const restored = await f.recovery.reconcile({ ...input, progress: prior() }, observed);
  let mutations = 0, publications = 0;
  const progress = new OosReplayProgress({ observe: async () => restored.observation,
    command: async () => { mutations++; }, ready: async () => { publications++; },
    ui: async () => ({}) });
  await progress.initialize({ observation: restored.observation, target: restored.progress.replay_target_time,
    prior: restored.progress, configHash: "TEST_ONLY", cutoff: input.cutoff });
  for (let retry = 0; retry < 2; retry++) {
    await assert.rejects(progress.step({ observation: restored.observation, bound: previous + 4500 }),
      { code: "TV_REPLAY_SESSION_BAR_UNAVAILABLE" });
  }
  assert.equal(progress.state.steps_completed, 40); assert.equal(mutations, 0); assert.equal(publications, 0);
});
test("rejected immutable scope never reconnects, seeks, steps, loads or publishes", async () => {
  const f = recoveryFixture();
  await assert.rejects(f.recovery.reconcile({ ...input, date: "2026-07-06", progress: prior() }, await f.replay.observation()), /SCOPE_MISMATCH/);
  assert.deepEqual(f.calls, []);
});
test("overshoot preserves the last certain checkpoint and diagnostic fields", async () => {
  let obs = observation(previous), commands = 0; const writes = [];
  const progress = new OosReplayProgress({ observe: async () => obs,
    command: async () => { commands++; obs = observation(previous + 2700); }, ready: async () => {},
    ui: async () => ({}), persist: async value => writes.push(structuredClone(value)) });
  const state = prior(); state.ephemeral_scope = undefined;
  await progress.initialize({ observation: obs, target: state.replay_target_time, prior: state, configHash: "TEST_ONLY", cutoff: input.cutoff });
  await assert.rejects(progress.step({ observation: obs, bound: previous + 3600 }), error => {
    for(const key of ["expected_next_bar_open", "expected_next_bar_close", "observed_bar_open", "observed_bar_close",
      "target_session_end", "previous_confirmed_bar", "step_size", "steps_requested", "bars_actually_advanced",
      "replay_cursor_before", "replay_cursor_after", "timeframe", "timezone", "browser_session_id", "tv_replay_session_id"]) {
      assert.ok(Object.hasOwn(error.details, key), key);
    }
    return error.code === "TV_REPLAY_OVERSHOOT";
  });
  assert.equal(commands, 1); assert.equal(progress.state.steps_completed, 40);
  assert.equal(progress.state.last_confirmed_bar_time, iso(previous)); assert.equal(writes.at(-1).overshoot_count, 1);
});
