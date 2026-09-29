import { requireFact } from "../domain/batch-contract.js";

/** Technical operations only. Tool mappings are explicit operator configuration. */
export class TradingViewMcpAdapter {
  constructor(call) { this.call = call; }

  async preparePremarket(day) {
    await this.call("openSymbol", { symbol: day.symbol, replay_only: true });
    await this.call("setReplayDate", { date: day.date, timezone: day.timezone, replay_only: true });
    await this.call("setReplayCutoff", { cutoff: day.cutoff, replay_only: true });
  }

  async capturePremarket(input) {
    await this.call("setTimeframe", { timeframe: input.timeframe });
    await this.call("applyViewPreset", { view: input.view });
    return this.call("capture", { symbol: input.symbol, date: input.date, cutoff: input.cutoff,
      timeframe: input.timeframe, view: input.view, phase: "PREMARKET" });
  }

  async prepareFrozenReplay(input) {
    requireFact(input.meta.status === "FROZEN", "PLAN_NOT_FROZEN");
    await this.preparePremarket(input);
    await this.call("setEngineVersion", { engine_version: input.engine_version, replay_only: true });
    await this.call("setBookMode", { book_mode: input.book_mode, replay_only: true });
    await this.call("loadPlan", { plan_text: input.plan_text, plan_sha256: input.meta.plan_sha256,
      replay_only: true, reset_simulation: true });
    // Input changes may restart Pine: re-establish the cutoff after loading the exact plan.
    await this.call("setReplayCutoff", { cutoff: input.cutoff, replay_only: true });
  }

  readPlanFingerprint(day) { return this.call("readPlanFingerprint", { symbol: day.symbol, cutoff: day.cutoff }); }

  async replayTo(input) {
    await this.call("startReplay", { replay_only: true, plan_sha256: input.plan_sha256 });
    return this.call("advanceTo", { at: input.end, replay_only: true, plan_sha256: input.plan_sha256 });
  }

  async collectResults(input) {
    await this.call("openDashboard", { replay_only: true });
    const dashboard = await this.call("capture", { phase: "RESULT", name: "dashboard_final.png", at: input.end });
    const images = { "dashboard_final.png": dashboard.image_base64 };
    for (const timeframe of ["5m", "15m"]) {
      await this.call("setTimeframe", { timeframe });
      images[`${timeframe}_final.png`] = (await this.call("capture", { phase: "RESULT", at: input.end, timeframe })).image_base64;
    }
    const audit = await this.call("collectVisibleAudit", { plan_sha256: input.plan_sha256, at: input.end, replay_only: true });
    return { ...audit, images };
  }
}
