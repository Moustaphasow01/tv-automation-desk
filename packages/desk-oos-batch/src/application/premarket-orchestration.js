import { requireFact } from "../domain/batch-contract.js";
import { premarketPeriod, hasPremarket, projectPreparationDay, preparationCounts, preparationFilters, queuedPreparationDates } from "../domain/premarket-batch.js";

/** Capture-only use cases; no scenario builder, freeze, replay or result port is reachable. */
export class PremarketOrchestration {
  constructor({ batches, fingerprint, encodeJson, batchId, symbol, cutoffTime, clock, requestedConcurrency = 1 }) {
    Object.assign(this, { batches, fingerprint, encodeJson, clock, requestedConcurrency });
    this.scope = { batch_id: batchId, symbol, cutoff_time: cutoffTime };
    requireFact(symbol === "CME_MINI:MES1!" && cutoffTime === "09:00", "PREMARKET_SCOPE_INVALID");
  }

  async prepare(date) {
    const period = this.period(date, date);
    requireFact(period.days.length === 1, "PREMARKET_WEEKEND");
    const day = period.days[0], prior = await this.batches.day(day);
    if (!hasPremarket(prior)) await this.enqueue(period, "DAY");
    const row = await this.batches.day(day);
    return { ...projectPreparationDay(row), cutoff: day.cutoff, symbol: day.symbol,
      engine_version: day.engine_version, book_mode: day.book_mode };
  }

  async prepareRange(startDate, endDate) {
    const period = this.period(startDate, endDate);
    const batch = await this.enqueue(period, "RANGE");
    await this.batches.refresh();
    return this.status({ batch_id: batch.batch_id });
  }

  period(startDate, endDate) {
    return premarketPeriod({ scope: this.scope, startDate, endDate, requestedConcurrency: this.requestedConcurrency });
  }

  enqueue(period, selectorKind) {
    const identity = { ...this.scope, start_date: period.start_date, end_date: period.end_date, selector_kind: selectorKind };
    return this.batches.enqueue({ days: period.days, batch: { ...period, ...identity,
      archive_batch_id: this.scope.batch_id, batch_id: `premarket-${this.fingerprint(this.encodeJson(identity)).slice(0, 40)}` } });
  }

  async status(filters = {}) {
    const { batchId, startDate: start, endDate: end } = preparationFilters(filters);
    this.period(start, end);
    const data = await this.batches.read({ archiveBatchId: this.scope.batch_id, batchId, startDate: start, endDate: end });
    const counts = preparationCounts(data.rows);
    const batch = batchId ? data.batches[0] : { batch_id: null, start_date: start, end_date: end, status: "SNAPSHOT" };
    return { ...counts, archive_batch_id: this.scope.batch_id, batch_id: batch.batch_id, start_date: batch.start_date,
      end_date: batch.end_date, status: batch.status, observed_at: this.clock(),
      concurrency: 1, concurrency_reason: "SINGLE_TRADINGVIEW_SESSION", batches: data.batches,
      days: data.rows.map(row => projectPreparationDay(row, data.queue)),
      skipped_dates: this.period(batch.start_date, batch.end_date).skipped_dates,
      current_queue: queuedPreparationDates(data.rows, data.queue) };
  }
}
