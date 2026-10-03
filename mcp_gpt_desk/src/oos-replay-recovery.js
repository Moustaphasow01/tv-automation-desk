import { oosTvError, oosWait } from "./oos-tradingview-engine.js";
import { replaySeconds } from "./oos-replay-progress.js";
import { nativeGap, replayBarSequence } from "./oos-replay-barrier.js";
import { attachmentChanged, replayAttachment, verifyReplayScope } from "./oos-replay-scope.js";

/** Reattach or restore a proved checkpoint; never import a plan or inspect results. */
export class OosReplayRecovery {
  constructor({ replay, wait = oosWait, now = Date.now }) { Object.assign(this, { replay, wait, now }); }

  async reconcile(input, observation) {
    const scope = verifyReplayScope(input), prior = input.progress;
    const session = await this.replay.provider?.getTargetInfo?.();
    const ephemeral_scope = replayAttachment(observation, session?.id);
    const changed = attachmentChanged(prior, ephemeral_scope);
    const previous = replaySeconds(prior?.last_confirmed_bar_time);
    const gap = nativeGap(observation, previous);
    const reasons = recoveryReasons({ observation, previous, scope, changed });
    const restore = reasons.length > 0;
    if (restore && input.completed_replay) throw Object.assign(oosTvError("TV_CAPTURE_RESUME_SESSION_CHANGED"), {
      details: { date: input.date, reason: "PUBLISHED_REPLAY_MUST_NOT_BE_REPOSITIONED", ephemeral_scope } });
    if (prior?.steps_completed && restore) {
      observation = await this.restore(input, previous);
    }
    return { observation, progress: recoveryMetadata({ prior, scope, ephemeral_scope: replayAttachment(observation, session?.id), gap, reasons }),
      scope, ephemeral_scope };
  }

  async restore(input, previous) {
    if (!Number.isFinite(previous) || previous + 900 < replaySeconds(input.cutoff)) {
      throw Object.assign(oosTvError("TV_REPLAY_RECOVERY_CHECKPOINT_UNPROVEN"), { details: { date: input.date, previous } });
    }
    await this.replay.cutoff.reconnectData();
    await this.replay.capture.raw("chart_set_timeframe", { timeframe: "15" }, { timeoutMs: this.replay.timeouts.ui_transition_ms });
    await this.replay.capture.raw("replay_start", { date: new Date((previous + 900) * 1000).toISOString() },
      { timeoutMs: this.replay.timeouts.command_ms });
    await this.replay.capture.evaluate("window.TradingViewApi._replayApi.changeReplayResolution('15');true");
    const observation = await this.awaitCheckpoint(previous);
    await this.replay.engine.verifyInputs();
    const cutoff = replaySeconds(input.cutoff), times = observation.bar_times ?? [];
    if (!times.includes(cutoff - 900) || !times.includes(cutoff)) {
      throw Object.assign(oosTvError("TV_REPLAY_RECOVERY_CUTOFF_UNPROVEN"), { details: {
        expected_cutoff: input.cutoff, first_simulation_bar: new Date(cutoff * 1000).toISOString(),
        checkpoint_bar_open: new Date(previous * 1000).toISOString(), reason: "NATIVE_CUTOFF_HISTORY_MISSING" } });
    }
    return observation;
  }

  async awaitCheckpoint(previous) {
    const deadline = this.now() + this.replay.timeouts.ui_transition_ms;
    let stable = false, observation;
    while (this.now() < deadline) {
      observation = await this.replay.observation();
      const valid = observation.last_bar_time === previous && observation.resolution === "15"
        && observation.replay && !observation.autoplay && !observation.loading
        && observation.data_connected !== false && observation.replay_session_connected !== false;
      if (valid && stable) return observation;
      stable = valid;
      await this.wait(this.replay.timeouts.poll_ms);
    }
    throw Object.assign(oosTvError("TV_REPLAY_RECOVERY_CHECKPOINT_UNPROVEN"), { details: {
      expected_bar_open: new Date(previous * 1000).toISOString(), observed_bar_open: observation?.last_bar_time,
      reason: "NATIVE_CHECKPOINT_NOT_RESTORED", timeout_ms: this.replay.timeouts.ui_transition_ms } });
  }
}

function recoveryReasons({ observation, previous, scope, changed }) {
  const reasons = [], bound = replaySeconds(scope.immutable_scope.session_end);
  if (changed) reasons.push("TV_REPLAY_EPHEMERAL_SESSION_CHANGED");
  if (Number.isFinite(previous) && observation.last_bar_time < previous) reasons.push("NATIVE_CURSOR_REGRESSED");
  if (observation.last_bar_time > previous) {
    if (!replayBarSequence({ previous, observation, bound }).accepted) reasons.push("NATIVE_ADVANCE_UNPROVEN");
    if (observation.last_bar_time + 900 > bound) reasons.push("SESSION_BARRIER_EXCEEDED");
  }
  return reasons;
}

function recoveryMetadata({ prior, scope, ephemeral_scope, gap, reasons }) {
  if (!prior) return null;
  return { ...prior, ...scope, ephemeral_scope, resume_count: (prior.resume_count ?? 0) + 1,
    overshoot_count: (prior.overshoot_count ?? 0) + (reasons.includes("SESSION_BARRIER_EXCEEDED") ? 1 : 0),
    tv_replay_state: { ...prior.tv_replay_state, ...scope, native_gap: gap ?? prior.tv_replay_state?.native_gap,
      attachment_event: reasons.includes("TV_REPLAY_EPHEMERAL_SESSION_CHANGED") ? "TV_REPLAY_EPHEMERAL_SESSION_CHANGED" : "SAME_ATTACHMENT",
      recovery_action: reasons.length ? "RESTORED_CONFIRMED_NATIVE_BAR" : "RECONCILED", recovery_reasons: reasons } };
}
