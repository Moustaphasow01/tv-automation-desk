import { oosWait } from "./oos-tradingview-engine.js";
import { replayBarSequence } from "./oos-replay-barrier.js";

export const REPLAY_TIMEOUTS = Object.freeze({ command_ms: 120000, ui_transition_ms: 30000,
  progress_ms: 90000, final_render_ms: 60000, capture_ms: 60000, poll_ms: 500,
  retry_backoff_ms: 1000, max_retries: 2 });

const iso = seconds => Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
export const replaySeconds = at => typeof at === "number" ? at / (at > 1e12 ? 1000 : 1) : Date.parse(at) / 1000;

// currentDate() is the selection anchor, not the stepping cursor in this TradingView build.
// A replay step publishes a complete historical candle. Its close is the progress clock.
export function replayObservation(raw) {
  const duration = Number(raw.resolution) * 60;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(raw.last_bar_time)) {
    throw Object.assign(new Error("TV_REPLAY_BAR_TIME_UNPROVEN"), { code: "TV_REPLAY_BAR_TIME_UNPROVEN" });
  }
  return { ...raw, selection_anchor: raw.at, at: raw.last_bar_time + duration - 1 };
}

export class OosReplayProgress {
  constructor({ observe, command, ui, ready, persist = async () => {}, settings = {},
    now = Date.now, wait = oosWait }) {
    Object.assign(this, { observe, command, ui, ready, persist, now, wait });
    this.settings = { ...REPLAY_TIMEOUTS, ...settings };
    for (const [key, value] of Object.entries(this.settings)) {
      if (!Number.isFinite(value) || value < (key === "max_retries" ? 0 : 1)
        || key === "max_retries" && (!Number.isInteger(value) || value > 5)) {
        throw Object.assign(new Error("TV_REPLAY_TIMEOUT_CONFIG_INVALID"), { code: "TV_REPLAY_TIMEOUT_CONFIG_INVALID" });
      }
    }
    this.state = {}; this.errors = [];
  }

  async initialize({ observation, target, prior, browserSessionId, configHash, cutoff, cutoffProof, scope, ephemeralScope }) {
    const time = replaySeconds(observation.at);
    const previous = prior?.last_confirmed_bar_time ? Date.parse(prior.last_confirmed_bar_time) / 1000 : null;
    if (previous !== null && observation.last_bar_time < previous) throw this.error("TV_REPLAY_RESUME_REGRESSION", observation);
    if (prior?.config_hash && prior.config_hash !== configHash) throw this.error("TV_REPLAY_RESUME_CONFIG_MISMATCH", observation);
    this.initializeIdentity({ prior: prior || {}, target, browserSessionId, configHash, scope, ephemeralScope });
    if (cutoffProof) this.state.tv_replay_state = { ...this.state.tv_replay_state, cutoff_proof: cutoffProof };
    if (!prior) this.state.steps_completed = Math.max(0, Math.round((time + 1 - Date.parse(cutoff) / 1000) / 900));
    if (previous !== null && observation.last_bar_time > previous) {
      this.state.steps_completed += this.sequence(observation, previous, replaySeconds(target)).bars_actually_advanced;
    }
    await this.confirm(observation, "RECONCILED");
  }

  initializeIdentity({ prior, target, browserSessionId, configHash, scope, ephemeralScope }) {
    this.state = { ...prior, ...scope, replay_target_time: target, browser_session_id: browserSessionId || null,
      config_hash: configHash, steps_completed: prior.steps_completed || 0, retry_count: prior.retry_count || 0,
      ephemeral_scope: ephemeralScope ?? prior.ephemeral_scope,
      overshoot_count: prior.overshoot_count ?? 0, resume_count: prior.resume_count ?? 0 };
    if (scope) this.state.plan_sha256 = scope.immutable_scope.plan_sha256;
  }

  assertControl(obs, bound) {
    if (!obs.replay || obs.autoplay || obs.resolution !== "15") throw this.error("TV_REPLAY_CONTROL_LOST", obs);
    if (replaySeconds(obs.at) > bound) throw this.error("TV_REPLAY_OVERSHOOT", obs);
  }

  async confirm(obs, phase) {
    this.state = { ...this.state, replay_current_time: iso(replaySeconds(obs.at)),
      last_confirmed_bar_time: iso(obs.last_bar_time), last_confirmed_bar_open: iso(obs.last_bar_time),
      last_confirmed_bar_close: iso(obs.last_bar_time + 900), expected_next_bar_open: iso(obs.last_bar_time + 900),
      observed_bar_open: iso(obs.last_bar_time), last_success_at: new Date(this.now()).toISOString(),
      last_error: null, tv_replay_state: { ...this.state.tv_replay_state, phase, replay: obs.replay, autoplay: obs.autoplay,
        timeframe: obs.resolution, selection_anchor: iso(replaySeconds(obs.selection_anchor)) } };
    await this.persist(this.state);
  }

  async step({ observation, bound, stage = "REPLAYING" }) {
    try { return await this.advanceOne({ observation, bound, stage }); }
    catch (error) {
      if (error.code === "TV_REPLAY_OVERSHOOT") this.state.overshoot_count++;
      this.state.last_error = error.details ?? { code: error.code };
      await this.persist(this.state);
      throw error;
    }
  }

  sequence(observation, previous, bound) {
    const proof = replayBarSequence({ previous, observation, bound });
    if (!proof.accepted) throw this.error("TV_REPLAY_OVERSHOOT", observation, proof);
    return proof;
  }

  async advanceOne({ observation, bound, stage }) {
    const baseline = observation.last_bar_time;
    this.stage = stage; this.started = this.now();
    this.assertAvailableBar({ observation, bound });
    return this.advanceAttempts({ observation, bound, baseline });
  }

  assertAvailableBar({ observation, bound }) {
    const baseline = observation.last_bar_time;
    const gap = this.state.tv_replay_state?.native_gap;
    if (this.stage === "REPLAYING" && gap?.expected_next_bar_open === iso(baseline + 900)
      && Date.parse(gap.next_native_bar_open) / 1000 >= bound && baseline + 900 < bound) {
      this.state.tv_replay_state = { ...this.state.tv_replay_state, market_session_exhausted: true };
      throw this.error("TV_REPLAY_SESSION_BAR_UNAVAILABLE", observation, {
        ...replayBarSequence({ previous: baseline, observation, bound }), native_gap: gap,
        market_session_exhausted: true,
        reason: "NO_NATIVE_M15_BAR_BEFORE_SESSION_END; ENGINE_FINAL_AUDIT_UNPROVEN", steps_requested: 0 });
    }
  }

  async advanceAttempts({ observation, bound, baseline }) {
    for (let retry = 0; retry <= this.settings.max_retries; retry++) {
      // Reconcile before every mutation, including recovery of an uncertain command response.
      const current = await this.observe(); this.assertControl(current, bound);
      if (current.last_bar_time > baseline) return this.completedStep(current, baseline, bound);
      if (current.last_bar_time < baseline) throw this.error("TV_REPLAY_RESUME_REGRESSION", current);
      if (retry) {
        this.state.retry_count++;
        await this.wait(this.settings.retry_backoff_ms * retry);
        const ui = await this.ui();
        if (ui.loading || ui.modal) throw this.error("TV_REPLAY_UI_BLOCKED", current, { ui });
      }
      await this.persist({ ...this.state, tv_replay_state: { ...this.state.tv_replay_state, phase: "STEP_PENDING" } });
      try { await this.command(this.settings.command_ms); }
      catch (error) { this.errors.push({ code: error.code || "TV_REPLAY_COMMAND_FAILED", details: error.details || null }); }
      const progress = await this.awaitProgress({ baseline, bound });
      if (progress) return this.completedStep(progress, baseline, bound);
      // The final read happens after the deadline: slow-but-completed commands are success.
      const actual = await this.observe(); this.assertControl(actual, bound);
      if (actual.last_bar_time > baseline) return this.completedStep(actual, baseline, bound);
      const failure = this.error("TV_REPLAY_STEP_TIMEOUT", actual, { ui: await this.ui(), attempt: retry + 1 });
      this.state.last_error = failure.details; await this.persist(this.state);
      if (retry === this.settings.max_retries) throw failure;
    }
  }

  async awaitProgress({ baseline, bound }) {
    const deadline = this.now() + this.settings.progress_ms;
    while (this.now() < deadline) {
      const obs = await this.observe(); this.assertControl(obs, bound);
      if (obs.last_bar_time > baseline) return obs;
      await this.wait(this.settings.poll_ms);
    }
    return null;
  }

  async completedStep(obs, previous, bound) {
    // Checkpoint the proved cursor even if the subsequent Pine render is slow/fails.
    const proof = this.sequence(obs, previous, bound);
    this.state.steps_completed += proof.bars_actually_advanced;
    await this.confirm(obs, "BAR_CONFIRMED");
    await this.ready(this.settings.final_render_ms);
    await this.confirm(obs, "READY");
    return obs;
  }

  error(code, obs, extra = {}) {
    return Object.assign(new Error(code), { code, details: { stage: this.stage || "RESUME_RECONCILIATION",
      tradingview_current_time: iso(replaySeconds(obs.at)), selection_anchor: iso(replaySeconds(obs.selection_anchor)),
      target_time: this.state.replay_target_time, timeframe: obs.resolution,
      timezone: obs.timezone || "Europe/Paris",
      steps_completed: this.state.steps_completed, last_confirmed_bar_time: this.state.last_confirmed_bar_time,
      last_success_at: this.state.last_success_at, elapsed_ms: this.now() - (this.started || this.now()),
      timeouts: this.settings, expected_condition: "closed historical bar timestamp advances; replay paused; ENGINE rendered",
      observed_condition: { last_bar_time: iso(obs.last_bar_time), replay: obs.replay, autoplay: obs.autoplay },
      tv_replay_state: this.state.tv_replay_state, browser_session_id: this.state.browser_session_id,
      retry_count: this.state.retry_count, tv_replay_session_id: obs.tv_replay_session_id ?? null,
      ...replayBarSequence({ previous: replaySeconds(this.state.last_confirmed_bar_time), observation: obs,
        bound: replaySeconds(this.state.replay_target_time) }),
      mcp_errors: this.errors.slice(-6), ...extra } });
  }
}
