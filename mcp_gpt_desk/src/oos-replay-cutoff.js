import { oosTvError, oosWait } from "./oos-tradingview-engine.js";
import { replaySeconds, REPLAY_TIMEOUTS } from "./oos-replay-progress.js";

const iso = seconds => Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;

function cutoffConditions(obs, { end, open, close }) {
  return { replay_paused: obs.replay === true && obs.autoplay === false,
    execution_timeframe: obs.resolution === "15", timezone: obs.timezone === "Europe/Paris",
    instrument: ["CME_MINI:MES1!", "CME_MINI_DL:MES1!"].includes(obs.symbol),
    native_bar_clock: Number.isFinite(open) && Number.isFinite(end),
    aligned_15m: Number.isFinite(open) && open % 900 === 0 && end % 900 === 0,
    last_complete_close_at_cutoff: close === end, no_post_cutoff_bar: close <= end,
    previous_bar_ordered: !Number.isFinite(obs.previous_bar_time) || obs.previous_bar_time < open,
    chart_not_loading: obs.loading !== true, data_connection: obs.data_connected !== false,
    replay_connection: obs.replay_session_connected !== false,
    selection_boundary: !Number.isFinite(obs.selected_at) || [end, end - 1].includes(obs.selected_at) };
}

/** The native visible bar sequence is the replay clock; currentDate is only a UI anchor. */
export function replayCutoffProof(obs, cutoff) {
  const end = replaySeconds(cutoff), open = obs.last_bar_time, duration = Number(obs.resolution) * 60;
  const close = Number.isFinite(open) && Number.isFinite(duration) ? open + duration : NaN;
  const conditions = cutoffConditions(obs, { end, open, close });
  return { expected_cutoff: iso(end), observed_replay_time: iso(replaySeconds(obs.at)),
    observed_bar_open: iso(open), observed_bar_close: iso(close), timeframe: obs.resolution, timezone: obs.timezone,
    expected_first_replay_bar: { open: iso(end), close: iso(end + 900) },
    current_replay_cursor: iso(close - 1), selected_replay_cursor: iso(obs.selected_at), current_chart_last_bar: iso(open),
    data_connected: obs.data_connected ?? null, replay_session_connected: obs.replay_session_connected ?? null,
    proof_source: "TradingView native mainSeries.bars() / closed M15 timestamps",
    proof_condition: conditions, proof_condition_result: Object.values(conditions).every(Boolean),
    reason_exacte_du_rejet: Object.entries(conditions).filter(([, ok]) => !ok).map(([name]) => name), bar_policy: "CLOSED_ONLY" };
}

/** Bounded, state-based proof before any simulated step. Never repairs or loads a plan. */
export class OosReplayCutoff {
  constructor({ capture, provider, settings = {}, wait = oosWait, now = Date.now }) {
    Object.assign(this, { capture, provider, wait, now });
    this.settings = { ...REPLAY_TIMEOUTS, ...settings };
  }
  async position(input) {
    if (input.progress?.steps_completed) throw oosTvError("REPLAY_RESUME_REQUIRED");
    await this.capture.setCutoffIdentity(input.cutoff);
    await this.reconnectData();
    await this.capture.raw("chart_set_timeframe", { timeframe: "15" }, { timeoutMs: this.settings.ui_transition_ms });
    this.capture.timeframe = "15m";
    for (let retry = 0; retry <= this.settings.max_retries; retry++) {
      await this.capture.raw("replay_start", { date: new Date(input.cutoff).toISOString() }, { timeoutMs: this.settings.command_ms });
      await this.capture.evaluate("window.TradingViewApi._replayApi.changeReplayResolution('15');true");
      try { return await this.prove({ ...input, retry_count: retry }); }
      catch (error) {
        if (error.code !== "TV_CUTOFF_NOT_PROVEN" || retry === this.settings.max_retries) throw error;
        await this.reconnectData();
        await this.wait(this.settings.retry_backoff_ms * (retry + 1));
      }
    }
  }
  async reconnectData() {
    // Keep the historical replay session and pending cutoff; never reload the page or stop replay.
    return this.capture.evaluate(`(function(){var s=window.TradingViewApi._replayApi._replayUIController?._replayManager?._replaySession,a=s?._chartApi;
      function u(x){return x&&typeof x.value==='function'?x.value():x;}
      var connected=typeof a?.connected==='function'?u(a.connected()):null;
      if(connected===false&&typeof a.connect==='function'){a.connect();return {reconnect_requested:true};}
      return {reconnect_requested:false,data_connected:connected};})()`);
  }
  async prove(input) {
    const deadline = this.now() + this.settings.ui_transition_ms; let previous, proof, observed, lastError;
    while (this.now() < deadline) {
      try {
        observed = await this.capture.observation(); proof = replayCutoffProof(observed, input.cutoff);
        const signature = JSON.stringify([observed.last_bar_time, observed.previous_bar_time, observed.resolution, observed.symbol]);
        if (proof.proof_condition_result && previous === signature) return { ...observed, cutoff_proof: proof };
        previous = proof.proof_condition_result ? signature : null;
      } catch (error) { lastError = { code: error.code || "TV_CUTOFF_OBSERVATION_FAILED", details: error.details || null }; }
      await this.wait(this.settings.poll_ms);
    }
    throw await this.failure(input, proof, observed, lastError);
  }
  async failure(input, proof, observed, lastError) {
    const session = await this.provider?.getTargetInfo?.().catch(() => null);
    const browser = await this.capture.evaluate(`({ready_state:document.readyState,path:location.pathname,
      modal:!!document.querySelector('[role="dialog"]'),spinner:!!document.querySelector('[role="progressbar"],[aria-busy="true"]')})`).catch(() => null);
    return Object.assign(oosTvError("TV_CUTOFF_NOT_PROVEN"), { details: { ...replayCutoffProof(observed || {}, input.cutoff), ...proof,
      stage: "INITIAL_CUTOFF_PROOF", last_confirmed_replay_time: input.progress?.replay_current_time || null,
      steps_completed: input.progress?.steps_completed || 0, retry_count: input.retry_count || 0,
      browser_session_id: session?.id || null, browser_state: browser, last_mcp_error: lastError || null,
      timeout_ms: this.settings.ui_transition_ms } });
  }
}
