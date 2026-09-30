import { createHash } from "node:crypto";

export const OOS_CHART = "window.TradingViewApi._activeChartWidgetWV.value()";
export const OOS_REPLAY = "window.TradingViewApi._replayApi";
export const oosTvError = code => Object.assign(new Error(code), { code });
export const oosHash = value => createHash("sha256").update(value).digest("hex");
export const oosWait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Only plan import, requested simulation mode and display controls are writable.
const INPUTS = Object.freeze({ plan: ["COLLER LE PLAN COMPACT ICI", null], mode: ["Mode donnees", "REPLAY"],
  book: ["Simulation", "PORTEFEUILLE_REALISTE"], view: ["Vue", null],
  text: ["Texte", null], width: ["Largeur du tableau (%)", null] });
const DISPLAY_NAMES = new Set(["Vue", "Texte", "Largeur du tableau (%)", "Page (TOUTES / JOURNAL / POSITIONS)",
  "Lignes visibles (pas limite du moteur)", "Epingler les transitions recentes (15m)", "Tickets sur le graphique de prix"]);

// TradingView's external-table stream is empty when the same table is drawn in its native pane.
// Copy the native renderer's published cells instead; never inspect/serialize its cyclic layout cache.
const PUBLISHED_TABLES = `function oosTables(){var external=s._study.tables().data().value();if(external.length)return external;
  var views=s._study._paneViews.filter(v=>Array.isArray(v._renderers)&&Array.isArray(v._data));
  views.forEach(v=>v.renderer());return views.flatMap(v=>v._data).filter(d=>d.table&&d.cells)
    .map(d=>({id:d.table.id,rows:d.table.rows,columns:d.table.columns,cells:d.cells.filter(x=>!x.merged).map(x=>({
      row:x.cell.row,column:x.cell.column,rowSpan:x.cell.rowSpan,colSpan:x.cell.colSpan,
      text:x.cell.text,tooltip:x.cell.tooltip,fontSize:typeof x.cell.fontSize==='number'?x.cell.fontSize:
        ({tiny:10,small:12,normal:14,large:20,huge:36})[x.cell.fontSize]??null}))}));}`;

/** Controls the installed ENGINE, never its trading rules or the external plan's contents. */
export class OosTradingViewEngine {
  constructor(capture) { this.capture = capture; this.ids = {}; this.loadedHash = null; }
  expression(body) {
    return `(function(){var c=${OOS_CHART},s=c.getStudyById(${JSON.stringify(this.id)});${PUBLISHED_TABLES}${body}})()`;
  }
  evaluate(body) { return this.capture.evaluate(this.expression(body)); }

  async initialize(version) {
    if (version !== "V3.9.8") throw oosTvError("TV_ENGINE_VERSION_UNVERIFIED");
    this.id = this.capture.engine?.id;
    const descriptor = await this.evaluate(`return {name:s._study.metaInfo().description,
      version:s._study.metaInfo().pine?.version,digest:s._study.metaInfo().pine?.digest,
      inputs:s.getInputsInfo().filter(x=>/^in_[0-9]+$/.test(x.id)).map(x=>({id:x.id,name:x.name,options:x.options})),
      values:s.getInputValues().filter(x=>/^in_[0-9]+$/.test(x.id))};`);
    if (descriptor.version !== "19.0") throw oosTvError("TV_ENGINE_VERSION_UNVERIFIED");
    for (const [key, [name, required]] of Object.entries(INPUTS)) {
      const input = descriptor.inputs.find(x => x.name === name);
      if (!input || (required && !input.options?.includes(required))) throw oosTvError("TV_ENGINE_INPUT_UNVERIFIED");
      this.ids[key] = input.id;
    }
    this.descriptor = descriptor;
    this.ruleInputs = structuredClone(descriptor.values.filter(x => x.id !== this.ids.plan
      && !DISPLAY_NAMES.has(descriptor.inputs.find(i => i.id === x.id)?.name)));
    this.configHash = oosHash(JSON.stringify({ version, digest: descriptor.digest, inputs: this.ruleInputs }));
    // TradingView disables receipt of Pine log.info by default, independently of ENGINE's log input.
    this.logMask = await this.evaluate(`if(typeof s._study.setLogLevelMask==='function')
      s._study.setLogLevelMask({error:true,warning:true,info:true});
      return typeof s._study.logLevelMask==='function'?s._study.logLevelMask():null;`);
    return { engine_version: version, config_hash: this.configHash };
  }

  async setInput(key, value) {
    const spec = INPUTS[key], id = this.ids[key];
    if (!spec || !id || (spec[1] && value !== spec[1])) throw oosTvError("TV_ENGINE_INPUT_WRITE_REJECTED");
    const info = this.descriptor.inputs.find(x => x.id === id);
    if (info.options && !info.options.includes(value)) throw oosTvError("TV_ENGINE_INPUT_VALUE_REJECTED");
    await this.evaluate(`s.setInputValues(${JSON.stringify([{ id, value }])});return true;`);
    const actual = await this.evaluate(`return s.getInputValues().find(x=>x.id===${JSON.stringify(id)})?.value;`);
    if (actual !== value) throw oosTvError("TV_ENGINE_INPUT_READBACK_MISMATCH");
  }

  async load({ plan_text, plan_sha256, replay_only, reset_simulation }) {
    if (!replay_only || !reset_simulation || typeof plan_text !== "string" || oosHash(plan_text) !== plan_sha256) {
      throw oosTvError("TV_FROZEN_PLAN_HASH_MISMATCH");
    }
    await this.setInput("mode", "REPLAY");
    await this.setInput("plan", plan_text);
    // In this installed ENGINE, AUTO after entryEnd is the actual AUDIT FIN SESSION view.
    await this.setInput("view", "AUTO");
    this.loadedHash = plan_sha256;
    await this.evaluate("s.setVisible(true);return true;");
    await this.verifyInputs();
    return { plan_sha256 };
  }

  async verifyInputs() {
    const values = await this.evaluate("return s.getInputValues().filter(x=>/^in_[0-9]+$/.test(x.id));");
    if (oosHash(values.find(x => x.id === this.ids.plan)?.value || "") !== this.loadedHash) {
      throw oosTvError("TV_LOADED_PLAN_HASH_MISMATCH");
    }
    for (const expected of this.ruleInputs) {
      if (values.find(x => x.id === expected.id)?.value !== expected.value) throw oosTvError("TV_ENGINE_RULE_INPUT_CHANGED");
    }
    return { plan_sha256: this.loadedHash, config_hash: this.configHash };
  }

  async ready() {
    for (let attempt = 0; attempt < 80; attempt++) {
      const state = await this.evaluate(`return {loading:s.isLoading(),error:s.hasError(),
        tables:oosTables().length};`);
      if (state.error) throw oosTvError("TV_ENGINE_CALCULATION_ERROR");
      if (!state.loading && state.tables) return;
      await oosWait(250);
    }
    throw oosTvError("TV_ENGINE_NOT_READY");
  }

  async readPublished() {
    await this.ready();
    return this.evaluate(`var tables=oosTables().map(t=>({id:t.id,rows:t.rows,columns:t.columns,
      cells:t.cells.map(x=>({row:x.row,column:x.column,rowSpan:x.rowSpan,colSpan:x.colSpan,
        text:x.text,tooltip:x.tooltip,fontSize:x.fontSize}))}));var l=s._study.logs();return {tables,logs_accessible:l!==null,
      logs:l?Array.from(l).map(x=>Object.fromEntries(Object.entries(x).filter(([k,v])=>v===null||
        ['string','number','boolean'].includes(typeof v)))):[],pine_version:s._study.metaInfo().pine?.version,
      log_mask:typeof s._study.logLevelMask==='function'?s._study.logLevelMask():null};`);
  }
}
