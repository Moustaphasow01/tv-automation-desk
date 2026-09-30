import { batchDays, requireFact } from "../domain/batch-contract.js";
import { projectDay, aggregateBatch } from "./batch-projection.js";

/** Date-scoped boundary shared by remote MCP and the dedicated OOS host. */
export class OosPortal {
  constructor({ runtime, batchId, symbol, cutoffTime }) {
    Object.assign(this, { runtime, batchId, symbol, cutoffTime });
  }
  day(date) {
    return batchDays({ batch_id: this.batchId, symbol: this.symbol, cutoff_time: this.cutoffTime, date })[0];
  }
  async status(date) {
    const row = await this.runtime.repository.get(this.day(date));
    // A corrupt/prefilled result column cannot leak through the status endpoint before freeze.
    return projectDay(row.plan_sha256 ? row : { ...row, audit: null, run_meta: null });
  }
  async list(kind, month) {
    if (month) requireFact(/^2026-(07|08)$/.test(month), "MONTH_INVALID");
    const rows = await this.runtime.repository.list(this.batchId);
    return rows.filter(row => (!month || row.day.startsWith(month))
      && (kind === "completed" ? row.state === "COMPLETED" && row.plan_sha256 : row.state !== "COMPLETED"))
      .map(row => projectDay(row.plan_sha256 ? row : { ...row, audit: null, run_meta: null }));
  }
  async premarket(date) {
    const day = this.day(date), row = await this.runtime.repository.get(day);
    requireFact(row.capture_count === 8 && row.manifest_sha256, "PREMARKET_NOT_READY");
    const bundle = await this.runtime.premarket.verify(day);
    requireFact(bundle.manifest_sha256 === row.manifest_sha256, "PREMARKET_HASH_MISMATCH");
    return bundle;
  }
  async result(date) {
    const day = this.day(date), row = await this.runtime.repository.get(day);
    requireFact(row.plan_sha256, "PLAN_NOT_FROZEN");
    await this.runtime.freeze.verify(day);
    requireFact(row.state === "COMPLETED", "RESULT_NOT_READY");
    await this.runtime.replay.verifyResults(day, row.run_meta);
    return { date, audit: row.audit, run_meta: row.run_meta };
  }
  async month(month) {
    requireFact(/^2026-(07|08)$/.test(month), "MONTH_INVALID");
    const results = [];
    const rows = (await this.runtime.repository.list(this.batchId))
      .filter(row => row.day.startsWith(month) && row.state === "COMPLETED" && row.plan_sha256);
    for (const row of rows) results.push(await this.result(row.day));
    return { month, results, stats: aggregateBatch(rows) };
  }
  submit(date, text) { return this.runtime.submittedPlan.submit(this.day(date), text); }
  async requestReplay(date) {
    const day = this.day(date), row = await this.runtime.repository.get(day);
    requireFact(row.state === "FROZEN" && row.plan_sha256, "PLAN_NOT_FROZEN");
    await this.runtime.freeze.verify(day);
    return this.runtime.commands.enqueue({ batch_id: this.batchId, symbol: this.symbol,
      cutoff_time: this.cutoffTime, date, action: "replay" }, `replay-${this.batchId}-${date}-${row.plan_sha256.slice(0, 16)}`);
  }
}
