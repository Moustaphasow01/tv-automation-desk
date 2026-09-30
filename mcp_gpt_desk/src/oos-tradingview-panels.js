import { OOS_CHART, oosTvError, oosWait } from "./oos-tradingview-engine.js";

/** CDP screenshot specialization only: use the existing provider, but clip the actual audit pane. */
export class OosTradingViewPanels {
  constructor({ engine, provider }) { Object.assign(this, { engine, provider }); }

  async open(view) {
    if (!["AUDIT", "POSITIONS"].includes(view)) throw oosTvError("TV_PANEL_VIEW_REJECTED");
    await this.engine.setInput("view", view === "AUDIT" ? "AUTO" : view);
    await this.engine.setInput("text", "Normal");
    await this.engine.setInput("width", 98);
    await this.engine.evaluate(`s.setVisible(true);if(s.paneIndex()===0)s.unmergeDown();
      var p=c.getPanes()[s.paneIndex()];p.restore();p.setMaximized(true);return s.paneIndex();`);
    const client = await this.client();
    await client.Emulation.setDeviceMetricsOverride({ width: 1920, height: 1600, deviceScaleFactor: 1, mobile: false });
    await oosWait(1000);
    await this.engine.ready();
    return { positions_distinct: true };
  }

  async proof() {
    return this.engine.evaluate(`var i=s.paneIndex(),p=c.getPanes()[i],w=c._chartWidget._paneWidgets.value()[i];
      var rect=w.getElement().getBoundingClientRect(),t=s._study.tables().data().value();
      var text=t.flatMap(x=>x.cells.map(v=>v.text)).join(' | ');
      return {dedicated_panel:i>0&&!p.hasMainSeries(),pane_index:i,maximized:p.isMaximized(),
        view:s.getInputValues().find(x=>x.id===${JSON.stringify(this.engine.ids.view)})?.value,
        title:text.includes('AUDIT FIN SESSION')?'AUDIT FIN SESSION':null,
        rows:t.map(x=>x.rows),columns:t.map(x=>x.columns),text,
        bounds:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
        minimum_font_size:Math.min(...t.flatMap(x=>x.cells.filter(c=>c.text).map(c=>c.fontSize)))};`);
  }

  async screenshot(name) {
    await this.engine.capture.assertChart();
    const panel = await this.proof();
    if (!panel.dedicated_panel || !panel.maximized || panel.bounds.height < 900 || panel.minimum_font_size < 12) {
      throw oosTvError("TV_DEDICATED_PANEL_UNPROVEN");
    }
    if (name === "dashboard_final.png" && (panel.view !== "AUTO" || panel.title !== "AUDIT FIN SESSION")) {
      throw oosTvError("TV_FINAL_AUDIT_VIEW_UNPROVEN");
    }
    const client = await this.client();
    const { data } = await client.Page.captureScreenshot({ format: "png", clip: { ...panel.bounds, scale: 1 } });
    const { text, ...presentation } = panel;
    return { image_base64: data, presentation: { ...presentation, complete_table: true } };
  }

  async restorePrice() {
    await this.engine.evaluate(`for(var p of c.getPanes())if(p.isMaximized())p.setMaximized(false);
      c.getPanes()[0].setMaximized(true);return true;`);
    await this.client().then(client => client.Emulation.clearDeviceMetricsOverride());
    await oosWait(500);
  }

  async restoreViewport() {
    await this.client().then(client => client.Emulation.clearDeviceMetricsOverride());
  }

  async client() {
    const client = await this.provider.getClient();
    const check = await client.Runtime.evaluate({ expression: "location.pathname", returnByValue: true });
    if (check.result?.value !== `/chart/${this.engine.capture.chartId}/`) throw oosTvError("TV_PANEL_CHART_OWNERSHIP_MISMATCH");
    return client;
  }
}
