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
    const resumed = await this.call("resumeFrozenReplay", { ...input, replay_only: true,
      plan_sha256: input.meta.plan_sha256 });
    if (resumed?.resumed === true) return resumed;
    requireFact(!input.progress?.steps_completed, "REPLAY_RESUME_REQUIRED");
    await this.preparePremarket(input);
    await this.call("setEngineVersion", { engine_version: input.engine_version, replay_only: true });
    await this.call("setBookMode", { book_mode: input.book_mode, replay_only: true });
    await this.call("loadPlan", { plan_text: input.plan_text, plan_sha256: input.meta.plan_sha256,
      replay_only: true, reset_simulation: true });
    // Input changes may restart Pine: re-establish the cutoff after loading the exact plan.
    await this.call("setReplayCutoff", { cutoff: input.cutoff, replay_only: true });
  }

  readPlanFingerprint(day) { return this.call("readPlanFingerprint", { symbol: day.symbol, cutoff: day.cutoff }); }

  async resumeResultCapture(input) {
    requireFact(input.meta.status === "FROZEN" && input.completed_replay?.replay === true, "CAPTURE_RESUME_REQUIRED");
    const result = await this.call("resumeResultCapture", { ...input, replay_only: true, plan_sha256: input.meta.plan_sha256 });
    requireFact(result?.resumed === true, "CAPTURE_RESUME_REQUIRED");
    return result;
  }

  async replayTo(input) {
    await this.call("startReplay", { replay_only: true, plan_sha256: input.plan_sha256 });
    return this.call("advanceTo", { at: input.end, replay_only: true, plan_sha256: input.plan_sha256 });
  }

  async collectResults(input) {
    try {
      const panel = await this.call("openDashboard", { replay_only: true });
      const dashboard = await this.resultCapture(input, { name: "dashboard_final.png" });
      const images = { "dashboard_final.png": dashboard.image_base64 };
      const capture_provenance = { "dashboard_final.png": this.provenance(dashboard) };
      // Read the canonical 15m ENGINE before changing any display or chart timeframe.
      if (panel.positions_distinct) {
        await this.call("openPositions", { replay_only: true });
        const positions = await this.resultCapture(input, { name: "positions_final.png" });
        images["positions_final.png"] = positions.image_base64;
        capture_provenance["positions_final.png"] = this.provenance(positions);
      }
      const audit = await this.call("collectVisibleAudit", { plan_sha256: input.plan_sha256, at: input.end, replay_only: true });
      for (const timeframe of ["5m", "15m"]) {
        await this.call("setTimeframe", { timeframe });
        const capture = await this.resultCapture(input, { timeframe, name: `${timeframe}_final.png` });
        images[`${timeframe}_final.png`] = capture.image_base64;
        capture_provenance[`${timeframe}_final.png`] = this.provenance(capture);
      }
      return { ...audit, positions_distinct: panel.positions_distinct === true, images, capture_provenance };
    } finally { await this.call("closeResultViews", { replay_only: true }); }
  }

  provenance(capture) {
    const { symbol, at, timeframe, captured_at, source, plan_sha256, presentation } = capture;
    return { symbol, at, timeframe: timeframe || null, captured_at, source, plan_sha256,
      ...(presentation ? { presentation } : {}) };
  }

  async resultCapture(input, view) {
    const capture = await this.call("capture", { ...view, symbol: input.symbol, phase: "RESULT", at: input.end,
      plan_sha256: input.plan_sha256, replay_only: true });
    requireFact(capture.replay === true && capture.at === input.end && capture.symbol === input.symbol
      && capture.plan_sha256 === input.plan_sha256, "RESULT_CAPTURE_SCOPE_MISMATCH");
    requireFact(!view.timeframe || capture.timeframe === view.timeframe, "RESULT_TIMEFRAME_MISMATCH");
    requireFact(Number.isFinite(Date.parse(capture.captured_at)) && typeof capture.source === "string", "RESULT_PROVENANCE_REQUIRED");
    return capture;
  }
}
