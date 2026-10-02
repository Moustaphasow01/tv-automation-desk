import { oosTvError, oosWait } from "./oos-tradingview-engine.js";
import { replayObservation } from "./oos-replay-progress.js";
import { panelProofScript, panelFailureReasons, panelCaptureGeometry } from "./oos-tradingview-panel-proof.js";

/** Display-only recovery of the installed native pane. Never changes ENGINE trading inputs. */
export class OosTradingViewPanels {
  constructor({ engine, provider, settings = {}, now = Date.now, wait = oosWait }) {
    Object.assign(this, { engine, provider, now, wait });
    this.settings = { layout_ms: 30000, poll_ms: 200, max_attempts: 3, max_width: 10000, max_height: 8000, ...settings };
    this.history = []; this.dimensions = { width: 3600, height: 1200 };
  }

  async open(view, context = {}) {
    if (!["AUDIT", "POSITIONS"].includes(view)) throw oosTvError("TV_PANEL_VIEW_REJECTED");
    this.context = context; this.history = [];
    await this.engine.setInput("view", view === "AUDIT" ? "AUTO" : view);
    await this.engine.setInput("text", "Normal");
    await this.engine.setInput("width", 98);
    const prior = await this.engine.evaluate(`var l=c._chartWidget.model().model().properties().childs()
      .paneProperties.childs().legendProperties.childs().showLegend;var prior=l.value();l.setValue(false);
      s._study.setHasExternalViews(false);return prior;`);
    this.legend ??= prior;
    await this.recover(view);
    return { positions_distinct: true };
  }

  proof() { return this.engine.evaluate(panelProofScript(this.engine.ids.view)); }

  async recover(view) {
    const client = await this.client();
    let panel;
    for (let attempt = 0; attempt < this.settings.max_attempts; attempt++) {
      await this.recoverUi(client);
      panel = await this.awaitLayout();
      const reasons = panelFailureReasons(panel, view);
      this.history.push({ attempt: attempt + 1, reasons, dimensions: { ...this.dimensions }, panel });
      if (reasons.length === 0) return panel;
      this.grow(panel);
    }
    throw await this.failure(panel, view, client);
  }

  async recoverUi(client) {
    await this.engine.capture.assertChart();
    await client.Page.bringToFront();
    for (const type of ["keyDown", "keyUp"]) await client.Input.dispatchKeyEvent({ type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    // Reset Chromium/Electron zoom; clipping still uses the measured zoom, never an assumed value.
    for (const type of ["keyDown", "keyUp"]) await client.Input.dispatchKeyEvent({ type, key: "0", code: "Digit0", modifiers: 2, windowsVirtualKeyCode: 48 });
    await this.engine.evaluate(`s.setVisible(true);if(s.paneIndex()===0)s.unmergeDown();
      var p=c.getPanes()[s.paneIndex()];if(p.isCollapsed())p.restore();p.setMaximized(true);return true;`);
    await client.Emulation.setDeviceMetricsOverride({ ...this.dimensions, deviceScaleFactor: 1, mobile: false });
  }

  async awaitLayout() {
    const deadline = this.now() + this.settings.layout_ms;
    let previous, panel;
    while (this.now() < deadline) {
      panel = await this.proof();
      const signature = JSON.stringify(panel);
      if (!panel.loading && !panel.engine_error && signature === previous) return panel;
      previous = signature;
      await this.wait(this.settings.poll_ms);
    }
    throw await this.failure(panel, "LAYOUT", await this.client(), ["LAYOUT_NOT_STABLE"]);
  }

  grow(panel) {
    const tables = panel.rendered_tables || [];
    const ratios = tables.flatMap(t => t.clipped_cell_details || []).map(c => c.required_width / c.allocated_width).filter(Number.isFinite);
    const ratio = Math.max(1.15, ...ratios);
    this.dimensions.width = Math.min(this.settings.max_width, Math.ceil(this.dimensions.width * ratio * 1.05));
    const needed = Math.max(0, ...tables.map(t => t.height || 0)) + 250;
    this.dimensions.height = Math.min(this.settings.max_height, Math.max(this.dimensions.height, Math.ceil(needed)));
  }

  async failure(panel, view, client, reasons = panelFailureReasons(panel, view)) {
    const clock = await this.replayDiagnostic(), debug = await this.captureDiagnostic(panel, client);
    const error = oosTvError("TV_DEDICATED_PANEL_UNPROVEN");
    error.details = { stage: "CAPTURING_RESULTS", reason: reasons.join(","), reasons, requested_view: view,
      ...clock,
      ...(panel || { smc398_found: false, pane_index: null, pane_count: null }),
      browser_zoom: debug.browser_zoom, capture_scale: debug.capture_scale, diagnostic_errors: debug.errors,
      recovery_history: this.history, debug_artifact: null };
    if (debug.image) error.diagnostic_image_base64 = debug.image;
    return error;
  }

  async replayDiagnostic() {
    try {
      const observation = replayObservation(await this.engine.capture.observation());
      const end = Date.parse(this.context?.replay_end) / 1000;
      return { replay_complete: observation.replay && !observation.autoplay && [end, end - 1].includes(observation.at),
        tradingview_current_time: new Date(observation.at * 1000).toISOString(),
        replay_state: { replay: observation.replay, autoplay: observation.autoplay, timeframe: observation.resolution } };
    } catch (error) { return { replay_complete: false, tradingview_current_time: null, replay_state: null,
      clock_read_error: error.code || "TV_REPLAY_CLOCK_READ_FAILED" }; }
  }

  async captureDiagnostic(panel, client) {
    const result = { image: null, browser_zoom: null, capture_scale: null, errors: [] };
    try {
      const layout = await client.Page.getLayoutMetrics();
      result.browser_zoom = layout.cssVisualViewport.zoom;
      result.capture_scale = panelCaptureGeometry(panel, layout).scale;
    } catch (error) { result.errors.push(error.code || "TV_LAYOUT_READ_FAILED"); }
    try { result.image = (await client.Page.captureScreenshot({ format: "png" })).data; }
    catch (error) { result.errors.push(error.code || "TV_DEBUG_CAPTURE_FAILED"); }
    return result;
  }

  async screenshot(name) {
    if (!["dashboard_final.png", "positions_final.png"].includes(name)) throw oosTvError("TV_PANEL_CAPTURE_NAME_REJECTED");
    await this.engine.capture.assertChart();
    const view = name === "dashboard_final.png" ? "AUDIT" : "POSITIONS";
    let panel = await this.awaitLayout();
    if (panelFailureReasons(panel, view).length) panel = await this.recover(view);
    const client = await this.client(), layout = await client.Page.getLayoutMetrics();
    const { factor, scale, clip } = panelCaptureGeometry(panel, layout);
    const { data } = await client.Page.captureScreenshot({ format: "png", clip: { ...clip, scale } });
    return { image_base64: data, presentation: { ...panel, schema_version: "oos-native-panel/2", browser_zoom: factor, capture_scale: scale,
      image_bounds: clip, layout_stable: true, recovery_history: this.history } };
  }

  async restorePrice() {
    await this.restoreLegend();
    await this.engine.evaluate(`for(var p of c.getPanes())if(p.isMaximized())p.setMaximized(false);
      c.getPanes()[0].setMaximized(true);return true;`);
    await this.client().then(client => client.Emulation.clearDeviceMetricsOverride());
  }

  async restoreViewport() {
    await this.restoreLegend();
    await this.client().then(client => client.Emulation.clearDeviceMetricsOverride());
  }

  async restoreLegend() {
    if (typeof this.legend !== "boolean") return;
    await this.engine.evaluate(`c._chartWidget.model().model().properties().childs().paneProperties.childs()
      .legendProperties.childs().showLegend.setValue(${JSON.stringify(this.legend)});return true;`);
    this.legend = null;
  }

  async client() {
    const client = await this.provider.getClient();
    const check = await client.Runtime.evaluate({ expression: "location.pathname", returnByValue: true });
    if (check.result?.value !== `/chart/${this.engine.capture.chartId}/`) throw oosTvError("TV_PANEL_CHART_OWNERSHIP_MISMATCH");
    return client;
  }
}
