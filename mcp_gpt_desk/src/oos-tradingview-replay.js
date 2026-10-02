import { readFile } from "node:fs/promises";
import path from "node:path";
import { OosTradingViewEngine, OOS_CHART, OOS_REPLAY, oosTvError, oosWait, oosHash } from "./oos-tradingview-engine.js";
import { OosTradingViewPanels } from "./oos-tradingview-panels.js";
import { extractOosPublishedAudit } from "./oos-tradingview-audit.js";
import { OosReplayProgress, replayObservation, REPLAY_TIMEOUTS } from "./oos-replay-progress.js";

const TF = { "5m": "5", "15m": "15" };
const seconds = at => typeof at === "number" ? at / (at > 1e12 ? 1000 : 1) : Date.parse(at) / 1000;
export const OOS_REPLAY_TOOLS = Object.freeze({ replay_step: "replay_step", ui_open_panel: "ui_open_panel" });

export function proveReplayEnd(obs, at) {
  const end = Date.parse(at) / 1000;
  return obs.replay === true && obs.autoplay === false && [end, end - 1].includes(seconds(obs.at))
    && Number.isFinite(obs.last_bar_time) && obs.last_bar_time <= end;
}

/** Replay of a frozen external plan through the installed Pine ENGINE. No desk simulation or broker. */
export class OosTradingViewReplay {
  constructor({ capture, provider, timeouts = {} }) {
    this.capture = capture; this.active = false; this.trace = [];
    this.provider = provider; this.timeouts = { ...REPLAY_TIMEOUTS, ...timeouts };
    this.engine = new OosTradingViewEngine(capture);
    this.panels = new OosTradingViewPanels({ engine: this.engine, provider, settings: { layout_ms: this.timeouts.ui_transition_ms } });
  }

  async call(operation, input) {
    if (operation === "resumeFrozenReplay") return this.resume(input);
    if (operation === "resumeResultCapture") return this.resumeResultCapture(input);
    if (operation === "openSymbol") {
      this.active = false; this.resumed = false; this.progress = null; this.end = null;
      return this.capture.call(operation, input);
    }
    if (operation === "setEngineVersion") {
      if (!input.replay_only || !this.capture.cutoff) throw oosTvError("TV_REPLAY_SCOPE_REQUIRED");
      this.active = true;
      await this.capture.raw("ui_open_panel", { panel: "pine-editor", action: "close" }, { timeoutMs: this.timeouts.ui_transition_ms });
      await this.capture.raw("chart_set_timeframe", { timeframe: "15" }, { timeoutMs: this.timeouts.ui_transition_ms });
      this.timeframe = "15m";
      return this.engine.initialize(input.engine_version);
    }
    if (!this.active) return this.capture.call(operation, input);
    const handlers = { setBookMode: () => this.engine.setInput("book", input.book_mode),
      loadPlan: () => this.engine.load(input), setReplayCutoff: () => this.position(input),
      readPlanFingerprint: () => this.fingerprint(input), startReplay: () => this.start(input),
      advanceTo: () => this.advance(input), openDashboard: () => this.openPanel("AUDIT", input),
      openPositions: () => this.openPanel("POSITIONS", input), setTimeframe: () => this.setTimeframe(input.timeframe),
      capture: () => this.captureResult(input), collectVisibleAudit: () => this.audit(input),
      closeResultViews: () => this.closeViews() };
    if (!Object.hasOwn(handlers, operation)) throw oosTvError("OOS_REPLAY_OPERATION_REJECTED");
    return handlers[operation]();
  }

  observation() { return this.capture.observation().then(replayObservation); }

  async uiState() {
    try {
      return await this.engine.evaluate(`function u(x){return x&&typeof x.value==='function'?x.value():x;}
        return {loading:s.isLoading(),error:s.hasError(),tables:oosTables().length,
        modal:!!document.querySelector('[role="dialog"]'),
        spinner:!!document.querySelector('[role="progressbar"],[aria-busy="true"]'),
        replay_toolbar_visible:typeof ${OOS_REPLAY}.isReplayToolbarVisible==='function'
          ? !!u(${OOS_REPLAY}.isReplayToolbarVisible()):null};`);
    } catch (error) { return { read_error: error.code || "TV_UI_READ_FAILED" }; }
  }

  async ready(timeoutMs = this.timeouts.final_render_ms) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const state = await this.uiState();
      if (state.error) throw Object.assign(oosTvError("TV_ENGINE_CALCULATION_ERROR"), { details: state });
      if (!state.loading && !state.read_error && state.tables) return;
      await oosWait(this.timeouts.poll_ms);
    }
    throw Object.assign(oosTvError("TV_ENGINE_NOT_READY"), { details: { stage: "FINAL_RENDER", timeout_ms: timeoutMs, ui: await this.uiState() } });
  }

  async configureProgress(input, observation) {
    const session = await this.provider?.getTargetInfo?.();
    this.progress = new OosReplayProgress({ observe: () => this.observation(),
      command: timeoutMs => this.capture.raw("replay_step", {}, { timeoutMs }),
      ui: () => this.uiState(), ready: timeoutMs => this.ready(timeoutMs),
      persist: input.onProgress, settings: this.timeouts });
    await this.progress.initialize({ observation, target: `${input.date}T20:00:00+02:00`,
      prior: input.progress, browserSessionId: session?.id, configHash: this.engine.configHash, cutoff: input.cutoff });
  }

  async resume(input) {
    if (!input.replay_only || input.meta.status !== "FROZEN") throw oosTvError("TV_REPLAY_SCOPE_REQUIRED");
    await this.capture.assertChart();
    this.progressInput = input;
    const descriptor = await this.capture.evaluate(`(function(){var c=${OOS_CHART};
      var e=c.getAllStudies().find(x=>x.name==='SMC PRO 3.9.8 — Audit');if(!e)return null;
      var s=c.getStudyById(e.id),i=s.getInputsInfo().find(x=>x.name==='COLLER LE PLAN COMPACT ICI');
      return {engine:e,plan:s.getInputValues().find(x=>x.id===i?.id)?.value};})()`);
    if (!descriptor || oosHash(descriptor.plan || "") !== input.plan_sha256) {
      if (input.progress?.steps_completed) throw oosTvError("TV_REPLAY_RESUME_PLAN_MISMATCH");
      return { resumed: false };
    }
    this.capture.engine = descriptor.engine; this.capture.date = input.date;
    this.capture.cutoff = input.cutoff; this.capture.effectiveCutoff = input.cutoff;
    await this.engine.initialize(input.engine_version); this.engine.loadedHash = input.plan_sha256;
    await this.engine.verifyInputs();
    const mode = this.engine.descriptor.values.find(x => x.id === this.engine.ids.mode)?.value;
    const book = this.engine.descriptor.values.find(x => x.id === this.engine.ids.book)?.value;
    const obs = await this.observation(), anchor = seconds(obs.selection_anchor), cutoff = seconds(input.cutoff);
    // currentDate can stay at the initial anchor on the first step, then track subsequent steps.
    // A persisted, hash-bound cursor authorizes resuming that progressed session, never rewinding it.
    const anchored = [cutoff, cutoff - 1].includes(anchor);
    const progressed = input.progress?.steps_completed > 0 && Number.isFinite(anchor)
      && anchor >= cutoff - 1 && anchor <= seconds(obs.at)
      && seconds(obs.at) <= seconds(`${input.date}T20:00:00+02:00`) + 86400;
    if (!obs.replay || obs.autoplay || obs.resolution !== "15" || !(anchored || progressed)
      || !["CME_MINI:MES1!", "CME_MINI_DL:MES1!"].includes(obs.symbol) || obs.timezone !== "Europe/Paris"
      || mode !== "REPLAY" || book !== "PORTEFEUILLE_REALISTE") throw oosTvError("TV_REPLAY_RESUME_SCOPE_MISMATCH");
    await this.configureProgress(input, obs); await this.ready();
    this.active = true; this.resumed = true; this.timeframe = "15m";
    return { resumed: true, replay: true, plan_sha256: input.plan_sha256, progress: this.progress.state };
  }

  async position(input) {
    const positioned = await this.capture.position(input.cutoff);
    await this.engine.ready(); return positioned;
  }

  async resumeResultCapture(input) {
    const end = input.completed_replay;
    if (!input.replay_only || input.meta.status !== "FROZEN" || !end?.replay
      || end.plan_sha256 !== input.plan_sha256 || end.symbol !== input.symbol) throw oosTvError("TV_CAPTURE_RESUME_SCOPE_MISMATCH");
    // A display-timeframe change during a partial capture must not reset or advance replay.
    await this.capture.assertChart();
    const observed = await this.observation();
    if (!proveReplayEnd(observed, end.at)) throw oosTvError("TV_CAPTURE_RESUME_END_UNPROVEN");
    if (observed.resolution !== "15") {
      await this.capture.raw("chart_set_timeframe", { timeframe: "15" }, { timeoutMs: this.timeouts.ui_transition_ms });
    }
    await this.resume(input);
    if (this.engine.configHash !== end.config_hash && end.config_hash) throw oosTvError("TV_CAPTURE_RESUME_CONFIG_MISMATCH");
    this.end = end.at;
    await this.assertEnd({ at: this.end, plan_sha256: input.plan_sha256 });
    return { resumed: true, capture_only: true, at: this.end, plan_sha256: input.plan_sha256 };
  }

  async closeViews() {
    await this.capture.assertChart(); return this.panels.restoreViewport();
  }

  async fingerprint(input) {
    if (input.cutoff !== this.capture.cutoff || input.symbol !== "CME_MINI:MES1!") throw oosTvError("TV_REPLAY_SCOPE_MISMATCH");
    await this.capture.assertChart();
    const verified = await this.engine.verifyInputs();
    const tables = (await this.engine.readPublished()).tables;
    if (tables.some(t => t.cells.some(c => /PLAN REFUSE|PLAN INVALIDE|ERREUR PLAN/.test(c.text)))) {
      throw oosTvError("TV_ENGINE_PLAN_REJECTED");
    }
    return { ...verified, symbol: input.symbol, cutoff: input.cutoff,
      engine_version: "V3.9.8", book_mode: "PORTEFEUILLE_REALISTE" };
  }

  async start(input) {
    if (!input.replay_only || input.plan_sha256 !== this.engine.loadedHash) throw oosTvError("TV_REPLAY_HASH_MISMATCH");
    await this.engine.verifyInputs();
    if (this.resumed) return { replay: true, resumed: true, plan_sha256: this.engine.loadedHash };
    const obs = await this.capture.awaitCutoff();
    if (obs.resolution !== "15") throw oosTvError("TV_EXECUTION_TIMEFRAME_MISMATCH");
    await this.capture.evaluate(`${OOS_REPLAY}.changeReplayResolution('15');true`);
    this.trace = [{ visible_as_of: new Date(seconds(obs.at) * 1000).toISOString() }];
    await this.configureProgress(this.progressInput, replayObservation(obs));
    return { replay: true, execution_timeframe: "15m", plan_sha256: this.engine.loadedHash };
  }

  async advance(input) {
    if (!input.replay_only || input.plan_sha256 !== this.engine.loadedHash
      || input.at !== `${this.capture.date}T20:00:00+02:00`) throw oosTvError("TV_REPLAY_END_SCOPE_MISMATCH");
    const end = Date.parse(input.at) / 1000;
    let obs = await this.observation();
    for (let step = 0; step < 100 && seconds(obs.at) < end - 1; step++) {
      await this.capture.assertChart();
      if (!obs.replay || obs.autoplay) throw oosTvError("TV_REPLAY_CONTROL_LOST");
      obs = await this.progress.step({ observation: obs, bound: end });
      this.trace.push({ visible_as_of: new Date(seconds(obs.at) * 1000).toISOString(), last_bar_time: obs.last_bar_time });
    }
    if (!proveReplayEnd(obs, input.at)) throw oosTvError("TV_REPLAY_END_UNPROVEN");
    const final = await this.drainCarry(obs, input.at);
    obs = final.observation; this.end = final.at;
    await this.ready(); await this.engine.verifyInputs();
    return { replay: true, at: this.end, session_end: input.at, visible_as_of: new Date(seconds(obs.at) * 1000).toISOString(),
      symbol: "CME_MINI:MES1!", plan_sha256: this.engine.loadedHash,
      config_hash: this.engine.configHash, execution_timeframe: "15m", steps: this.trace,
      replay_progress: this.progress.state };
  }

  async drainCarry(observation, sessionEnd) {
    const bound = Date.parse(sessionEnd) / 1000 + 86400;
    for (let step = 0; step < 96; step++) {
      const published = await this.engine.readPublished();
      const state = published.tables.flatMap(t => t.cells).find(c => c.row === 1 && c.column === 1)?.text;
      if (state === "AUDIT FIN SESSION") {
        const at = step === 0 ? sessionEnd : new Date((seconds(observation.at) + 1 + 7200) * 1000).toISOString().slice(0, 19) + "+02:00";
        return { observation, at };
      }
      if (state !== "AUDIT PROVISOIRE + CARRY") throw oosTvError("TV_ENGINE_FINAL_SESSION_UNPROVEN");
      // Only the ENGINE manages its already-open positions. Never force-close or change a plan window.
      await this.capture.assertChart();
      if (!observation.replay || observation.autoplay) throw oosTvError("TV_REPLAY_CONTROL_LOST");
      observation = await this.progress.step({ observation, bound, stage: "CARRY" });
      this.trace.push({ visible_as_of: new Date(seconds(observation.at) * 1000).toISOString(), engine_state: state, carry: true });
    }
    // Technical watchdog only; no expiry/cancel/fill or trading-rule mutation.
    throw oosTvError("TV_ENGINE_CARRY_STILL_OPEN");
  }

  async assertEnd(input) {
    await this.capture.assertChart();
    if (input.at !== this.end || input.plan_sha256 !== this.engine.loadedHash
      || !proveReplayEnd(await this.observation(), this.end)) throw oosTvError("TV_RESULT_SCOPE_MISMATCH");
    await this.engine.verifyInputs(); await this.engine.ready();
  }

  async openPanel(view, input) {
    if (!input.replay_only || !this.end) throw oosTvError("TV_RESULT_BEFORE_REPLAY_END");
    await this.assertEnd({ at: this.end, plan_sha256: this.engine.loadedHash });
    const result = await this.panels.open(view, { replay_end: this.end });
    this.view = view;
    if (view === "AUDIT") this.published = await this.engine.readPublished();
    if (view === "POSITIONS") this.publishedPositions = await this.engine.readPublished();
    return result;
  }

  async setTimeframe(timeframe) {
    if (!TF[timeframe] || !this.end) throw oosTvError("TV_RESULT_TIMEFRAME_REJECTED");
    await this.panels.restorePrice(); this.view = "PRICE";
    await this.capture.raw("chart_set_timeframe", { timeframe: TF[timeframe] });
    await this.engine.ready();
    this.timeframe = timeframe;
    await this.assertEnd({ at: this.end, plan_sha256: this.engine.loadedHash });
    const at = Date.parse(this.end) / 1000;
    await this.capture.raw("chart_set_visible_range", { from: Date.parse(this.capture.cutoff) / 1000 - 3600, to: at + 3600 });
    await oosWait(500);
    return { timeframe };
  }

  async resultCapture(input) {
    if (input.phase !== "RESULT" || input.replay_only !== true) throw oosTvError("TV_RESULT_CAPTURE_SCOPE_REQUIRED");
    await this.assertEnd(input);
    const at = { replay: true, at: this.end, symbol: "CME_MINI:MES1!", plan_sha256: this.engine.loadedHash,
      captured_at: new Date().toISOString(), source: "TradingView MCP / installed SMC398", timeframe: this.timeframe };
    if (["dashboard_final.png", "positions_final.png"].includes(input.name)) return { ...at, ...await this.panels.screenshot(input.name) };
    if (input.name !== `${input.timeframe}_final.png` || input.timeframe !== this.timeframe || this.view !== "PRICE") {
      throw oosTvError("TV_RESULT_CAPTURE_VIEW_MISMATCH");
    }
    const shot = await this.capture.raw("capture_screenshot", { region: "chart", method: "cdp",
      filename: `oos_${this.capture.date}_${input.timeframe}_final` }, { timeoutMs: this.timeouts.capture_ms });
    const file = path.resolve(shot.file_path || "");
    if (path.dirname(file) !== path.resolve(this.capture.screenshotRoot)) throw oosTvError("TV_CAPTURE_PATH_REJECTED");
    await this.assertEnd(input);
    return { ...at, image_base64: (await readFile(file)).toString("base64") };
  }

  async captureResult(input) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(oosTvError("TV_RESULT_CAPTURE_TIMEOUT"), { details: {
        stage: "CAPTURING_RESULTS", artifact: input.name, timeout_ms: this.timeouts.capture_ms,
        plan_sha256: this.engine.loadedHash } })), this.timeouts.capture_ms);
    });
    try { return await Promise.race([this.resultCapture(input), timeout]); }
    finally { clearTimeout(timer); }
  }

  async audit(input) {
    await this.assertEnd(input);
    if (!this.published) throw oosTvError("TV_AUDIT_NOT_COLLECTED");
    const audit = extractOosPublishedAudit(this.published);
    audit.published_position_tables = this.publishedPositions?.tables ?? [];
    return { at: this.end, symbol: "CME_MINI:MES1!", plan_sha256: this.engine.loadedHash,
      engine_version: "V3.9.8", book_mode: "PORTEFEUILLE_REALISTE", source: "SMC398 published dashboard / Pine Logs",
      config_hash: this.engine.configHash, positions_distinct: true, logs_accessible: this.published.logs_accessible,
      audit, ...(this.published.logs_accessible ? { logs: this.published.logs.map(x => JSON.stringify(x)).join("\n") + "\n" } : {}) };
  }
}
