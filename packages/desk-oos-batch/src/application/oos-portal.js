import { batchDays, requireFact, STAGES } from "../domain/batch-contract.js";
import { projectDay, aggregateBatch } from "./batch-projection.js";
import { isUnscorableMarketGap, projectSessionCoverage } from "../domain/market-session-exhaustion.js";

/** Date-scoped boundary shared by remote MCP and the dedicated OOS host. */
export class OosPortal {
  constructor({ runtime, batchId, symbol, cutoffTime }) {
    Object.assign(this, { runtime, batchId, symbol, cutoffTime });
  }
  day(date) {
    return batchDays({ batch_id: this.batchId, symbol: this.symbol, cutoff_time: this.cutoffTime, date })[0];
  }
  sample(row) {
    return { ...row, sample_purpose: this.runtime.technicalSmokeDates?.includes(row.day) ? "TECHNICAL_SMOKE" : "OOS" };
  }
  async status(date) {
    const row = await this.runtime.repository.get(this.day(date));
    // A corrupt/prefilled result column cannot leak through the status endpoint before freeze.
    return projectDay(this.sample(row.plan_sha256 ? row : { ...row, audit: null, run_meta: null }));
  }
  async list(kind, month) {
    if (month) requireFact(/^2026-(07|08)$/.test(month), "MONTH_INVALID");
    const rows = await this.runtime.repository.list(this.batchId);
    return rows.filter(row => (!month || row.day.startsWith(month))
      && (kind === "completed" ? row.state === "COMPLETED" && row.plan_sha256 : row.state !== "COMPLETED"))
      .map(row => projectDay(this.sample(row.plan_sha256 ? row : { ...row, audit: null, run_meta: null })));
  }
  async premarket(date) {
    const day = this.day(date), row = await this.runtime.repository.get(day);
    requireFact(row.capture_count === 8 && row.manifest_sha256, "PREMARKET_NOT_READY");
    const bundle = await this.runtime.premarket.verify(day);
    requireFact(bundle.manifest_sha256 === row.manifest_sha256, "PREMARKET_HASH_MISMATCH");
    return { ...bundle, sample_purpose: this.sample(row).sample_purpose };
  }
  async result(date) {
    const day = this.day(date), row = await this.runtime.repository.get(day);
    requireFact(row.plan_sha256, "PLAN_NOT_FROZEN");
    await this.runtime.freeze.verify(day);
    requireFact(row.state === "COMPLETED", "RESULT_NOT_READY");
    if (isUnscorableMarketGap(row)) {
      const run_meta = await this.runtime.replay.verifySessionCoverage(day, row.run_meta);
      return { date, sample_purpose: this.sample(row).sample_purpose, ...projectSessionCoverage(row),
        audit: null, run_meta, metrics: projectDay(row).metrics, artifact_hashes: [],
        technical_receipt: run_meta.coverage_receipt };
    }
    const integrity = await this.runtime.replay.verifyResults(day, row.run_meta);
    return { date, sample_purpose: this.sample(row).sample_purpose, audit: row.audit, run_meta: row.run_meta,
      artifact_hashes: integrity.artifacts };
  }
  async month(month) {
    requireFact(/^2026-(07|08)$/.test(month), "MONTH_INVALID");
    const results = [];
    const rows = (await this.runtime.repository.list(this.batchId))
      .filter(row => row.day.startsWith(month) && row.state === "COMPLETED" && row.plan_sha256);
    for (const row of rows) results.push(await this.result(row.day));
    return { month, results, stats: aggregateBatch(rows.map(row => this.sample(row))) };
  }
  submit(date, text) { return this.runtime.submittedPlan.submit(this.day(date), text); }
  prepare(date) { return this.runtime.preparations.prepare(date); }
  prepareRange(start, end) { return this.runtime.preparations.prepareRange(start, end); }
  batchStatus(filters) { return this.runtime.preparations.status(filters); }
  async requestReplay(date) {
    const day = this.day(date), row = await this.runtime.repository.get(day);
    const postFreeze = STAGES.indexOf(row.checkpoint) >= STAGES.indexOf("FROZEN");
    requireFact(postFreeze && row.plan_sha256, "PLAN_NOT_FROZEN");
    await this.runtime.freeze.verify(day);
    if (row.state === "COMPLETED") return { status: "COMPLETED", date, plan_sha256: row.plan_sha256,
      ...projectSessionCoverage(row), idempotent: true };
    const retry = row.state === "FAILED_TECHNICAL";
    return this.runtime.commands.enqueue({ batch_id: this.batchId, symbol: this.symbol,
      cutoff_time: this.cutoffTime, date, action: retry ? "retry" : "replay" },
    `replay-${this.batchId}-${date}-${row.plan_sha256.slice(0, 16)}${retry ? `-retry-${row.revision}` : ""}`);
  }
}
