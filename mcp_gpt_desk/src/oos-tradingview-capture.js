import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const CHART = "window.TradingViewApi._activeChartWidgetWV.value()";
const REPLAY = "window.TradingViewApi._replayApi";
const TF = { "5m": "5", "15m": "15", "1h": "60", "4h": "240" };
const fail = code => Object.assign(new Error(code), { code });
const hash = value => createHash("sha256").update(value).digest("hex");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export const OOS_TV_TOOLS = Object.freeze({ chart_set_symbol: "chart_set_symbol", chart_set_timeframe: "chart_set_timeframe",
  chart_set_visible_range: "chart_set_visible_range", replay_start: "replay_start", ui_evaluate: "ui_evaluate",
  capture_screenshot: "capture_screenshot", tv_health_check: "tv_health_check" });

/** Only an operator-configured chart can be controlled. No broker or trading MCP tool is reachable. */
export class OosTradingViewCapture {
  constructor({ connection, chartId, screenshotRoot }) {
    Object.assign(this, { connection, chartId, screenshotRoot });
    this.cutoff = null; this.timeframe = null; this.view = null;
  }
  async call(operation, input) {
    if (operation === "openSymbol") return this.open(input);
    if (operation === "setReplayDate") { this.date = input.date; return { accepted: true }; }
    if (operation === "setReplayCutoff") return this.position(input.cutoff);
    if (operation === "setTimeframe") return this.setTimeframe(input.timeframe);
    if (operation === "applyViewPreset") return this.preset(input.view);
    if (operation === "capture" && input.phase === "PREMARKET") return this.capture(input);
    throw fail("OOS_REPLAY_BRIDGE_NOT_CERTIFIED");
  }
  async raw(name, input = {}) {
    const response = await this.connection.call(name, input);
    if (response.success === false) throw fail(`TV_${name.toUpperCase()}_FAILED`);
    return response;
  }
  async evaluate(expression) { return (await this.raw("ui_evaluate", { expression })).result; }
  async assertChart() {
    const current = await this.evaluate("location.pathname");
    if (current !== `/chart/${this.chartId}/`) throw fail("TV_CHART_OWNERSHIP_MISMATCH");
  }
  async open({ symbol, replay_only }) {
    if (replay_only !== true || symbol !== "CME_MINI:MES1!") throw fail("TV_SCOPE_REJECTED");
    await this.assertChart();
    await this.raw("chart_set_symbol", { symbol });
    await this.evaluate(`${CHART}.setTimezone("Europe/Paris")`);
    const studies = await this.evaluate(`(function(){var c=${CHART};return c.getAllStudies().map(x=>{
      var s=c.getStudyById(x.id),m=s._study.metaInfo();return {id:x.id,name:x.name,version:m.pine?.version,
      digest:m.pine?.digest,visible:s.isVisible()};});})()`);
    const engine = studies.find(s => s.name === "SMC PRO 3.9.8 — Audit");
    if (!engine || engine.version !== "19.0") throw fail("TV_ENGINE_VERSION_UNVERIFIED");
    this.engine = engine; this.indicatorFingerprint = hash(JSON.stringify(studies));
    // Hide pre-existing plans/audits from the analyst's captures; never change their inputs or rules.
    const hidden = studies.filter(s => /Moteur et audit|SMC PRO 3\.9\.8/.test(s.name)).map(s => s.id);
    await this.evaluate(`(function(){var c=${CHART};for(var id of ${JSON.stringify(hidden)})c.getStudyById(id).setVisible(false);return true;})()`);
    return { engine_version: "V3.9.8", pine_version: engine.version };
  }
  async position(cutoff) {
    if (!/^2026-(07|08)-\d{2}T\d{2}:\d{2}:\d{2}\+02:00$/.test(cutoff)) throw fail("TV_CUTOFF_INVALID");
    this.cutoff = cutoff;
    await this.assertChart();
    // replay_start selects a historical cutoff; it does not advance the ENGINE or autoplay.
    await this.raw("replay_start", { date: new Date(cutoff).toISOString() });
    return this.awaitCutoff();
  }
  async setTimeframe(timeframe) {
    if (!TF[timeframe] || !this.cutoff) throw fail("TV_TIMEFRAME_INVALID");
    this.timeframe = timeframe;
    await this.raw("chart_set_timeframe", { timeframe: TF[timeframe] });
    await this.position(this.cutoff);
    return { timeframe };
  }
  async preset(view) {
    if (!["global", "zoom"].includes(view)) throw fail("TV_VIEW_INVALID");
    this.view = view;
    const seconds = Number(TF[this.timeframe]) * 60, cutoff = Date.parse(this.cutoff) / 1000;
    const bars = view === "global" ? 240 : 65;
    await this.raw("chart_set_visible_range", { from: cutoff - bars * seconds, to: cutoff + Math.ceil(bars * 0.22) * seconds });
    await wait(1000);
    return this.awaitCutoff();
  }
  async observation() {
    return this.evaluate(`(function(){var c=${CHART},r=${REPLAY};function u(x){return x&&typeof x.value==='function'?x.value():x;}
      var b=c._chartWidget.model().mainSeries().bars(),i=b.lastIndex(),v=b.valueAt(i);
      return {symbol:c.symbol(),resolution:c.resolution(),timezone:c.getTimezone(),replay:u(r.isReplayStarted()),
      autoplay:u(r.isAutoplayStarted()),at:u(r.currentDate()),last_bar_time:v?.[0]??null};})()`);
  }
  async awaitCutoff() {
    for (let attempt = 0; attempt < 20; attempt++) {
      const obs = await this.observation();
      const at = typeof obs.at === "number" ? obs.at * (obs.at < 1e12 ? 1000 : 1) : Date.parse(obs.at);
      if (obs.replay === true && obs.autoplay === false && at === Date.parse(this.cutoff)
        && Number.isFinite(obs.last_bar_time) && obs.last_bar_time * 1000 <= at) return { ...obs, visible_as_of: new Date(at).toISOString() };
      await wait(500);
    }
    throw fail("TV_CUTOFF_NOT_PROVEN");
  }
  async capture(input) {
    if (input.cutoff !== this.cutoff || input.timeframe !== this.timeframe || input.view !== this.view) throw fail("TV_CAPTURE_SCOPE_MISMATCH");
    await this.assertChart(); const before = await this.awaitCutoff();
    if (!["CME_MINI:MES1!", "CME_MINI_DL:MES1!"].includes(before.symbol)
      || before.resolution !== TF[input.timeframe] || before.timezone !== "Europe/Paris") throw fail("TV_CAPTURE_IDENTITY_MISMATCH");
    const shot = await this.raw("capture_screenshot", { region: "chart", method: "cdp", filename: `oos_${input.date}_${input.timeframe}_${input.view}` });
    await this.awaitCutoff();
    const file = path.resolve(shot.file_path || "");
    if (path.dirname(file) !== path.resolve(this.screenshotRoot)) throw fail("TV_CAPTURE_PATH_REJECTED");
    const bytes = await readFile(file);
    return { ...input, replay: true, visible_as_of: before.visible_as_of, captured_at: new Date().toISOString(),
      source: `TradingView MCP / ${before.symbol}`, indicator_fingerprint: this.indicatorFingerprint,
      image_base64: bytes.toString("base64") };
  }
}
