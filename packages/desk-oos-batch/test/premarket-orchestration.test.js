import test from "node:test";
import assert from "node:assert/strict";
import { createPremarketOrchestration } from "../index.js";
import { premarketPeriod, hasPremarket, projectPreparationDay, preparationCounts, preparationStatus, queuedPreparationDates } from "../src/domain/premarket-batch.js";
import { PostgresOosCommands } from "../src/adapter/postgres-commands.js";
import { fixture, DAY } from "./support.js";

const scope = { batch_id: "SYNTHETIC", symbol: "CME_MINI:MES1!", cutoff_time: "09:00" };
function options(batches) { return { batches, batchId: scope.batch_id, symbol: scope.symbol, cutoffTime: "09:00" }; }
function row(date, state = "CAPTURING") { return { day: date, state, checkpoint: state, capture_count: 0,
  manifest_sha256: null, plan_sha256: null, error: null, revision: 1, updated_at: "2026-10-01T00:00:00Z" }; }
function memory() {
  const rows = new Map(), batches = new Map(), queued = [];
  return { rows, batches, queued, day: async day => rows.get(day.date) ?? null, refresh: async () => {},
    async enqueue(input) {
      const id = input.batch.batch_id;
      if (!batches.has(id)) {
        batches.set(id, { ...input.batch, status: "RUNNING" }); queued.push(input);
        for (const day of input.days) if (!rows.has(day.date)) rows.set(day.date, row(day.date));
      }
      return batches.get(id);
    },
    async read(query) {
      const selected = query.batchId ? [...rows.values()].filter(r => r.day >= batches.get(query.batchId).start_date && r.day <= batches.get(query.batchId).end_date)
        : [...rows.values()].filter(r => r.day >= query.startDate && r.day <= query.endDate);
      return { rows: selected.sort((a, b) => a.day.localeCompare(b.day)), batches: [...batches.values()].filter(b => !query.batchId || b.batch_id === query.batchId),
        queue: { capture: new Set(selected.filter(r => !hasPremarket(r)).map(r => r.day)), replay: new Set() } };
    } };
}

test("weekdays only; V1 dates strict, no guessed CME holiday or strategy inputs", () => {
  const period = premarketPeriod({ scope, startDate: "2026-07-24", endDate: "2026-07-29", requestedConcurrency: 3 });
  assert.deepEqual(period.days.map(d => d.date), ["2026-07-24", "2026-07-27", "2026-07-28", "2026-07-29"]);
  assert.deepEqual(period.skipped_dates, ["2026-07-25", "2026-07-26"]);
  assert.equal(period.concurrency, 1); assert.equal(period.requested_concurrency, 3);
  for (const dates of [["2026-07-32", "2026-08-02"], ["2026-06-30", "2026-07-01"], ["2026-08-02", "2026-07-01"]]) {
    assert.throws(() => premarketPeriod({ scope, startDate: dates[0], endDate: dates[1] }));
  }
  assert.throws(() => premarketPeriod({ scope, startDate: "2026-07-29", endDate: "2026-07-29", requestedConcurrency: 4 }), { code: "CAPTURE_CONCURRENCY_INVALID" });
});

test("prepare is idempotent, queue action is capture only and no replay/source data leaks", async () => {
  const batches = memory(), api = createPremarketOrchestration(options(batches));
  assert.equal((await api.prepare("2026-07-29")).state, "CAPTURING");
  await api.prepare("2026-07-29"); assert.equal(batches.queued.length, 1);
  batches.rows.set("2026-07-29", { ...row("2026-07-29", "PREMARKET_READY"), capture_count: 8, manifest_sha256: "b".repeat(64),
    audit: { FUTURE_SECRET: 123 }, run_meta: { future: "replay/dashboard" } });
  const ready = await api.prepare("2026-07-29");
  assert.equal(ready.state, "PREMARKET_READY"); assert.equal(ready.capture_count, 8);
  assert.equal(ready.manifest_sha256, "b".repeat(64)); assert.equal(batches.queued.length, 1);
  assert.equal(JSON.stringify(ready).includes("FUTURE_SECRET"), false);
  assert.equal(JSON.stringify(ready).includes("replay/"), false);
  assert.equal(batches.queued[0].days[0].cutoff, "2026-07-29T09:00:00+02:00");
  await assert.rejects(api.prepare("2026-07-25"), { code: "PREMARKET_WEEKEND" });
});

test("same range identity deduplicates; already ready day retains hash and no extra capture", async () => {
  const batches = memory(), api = createPremarketOrchestration(options(batches));
  await api.prepare("2026-07-29");
  batches.rows.set("2026-07-29", { ...row("2026-07-29", "PREMARKET_READY"), capture_count: 8, manifest_sha256: "a".repeat(64) });
  const first = await api.prepareRange("2026-07-27", "2026-07-29"), second = await api.prepareRange("2026-07-27", "2026-07-29");
  assert.equal(first.batch_id, second.batch_id); assert.equal(batches.queued.length, 2);
  assert.equal(first.total_days, 3); assert.equal(first.ready, 1); assert.equal(first.queued, 2);
  assert.equal(batches.rows.get("2026-07-29").manifest_sha256, "a".repeat(64));
  assert.equal(batches.rows.size, 3);
});

test("FROZEN/COMPLETED and failed-plan days are never overwritten or passed to capture workflow", async () => {
  for (const state of ["FROZEN", "COMPLETED", "FAILED_PLAN_VALIDATION"]) {
    const advanced = { ...row("2026-07-30", state), checkpoint: state === "FAILED_PLAN_VALIDATION" ? "VALIDATING_PLAN" : state,
      capture_count: 8, manifest_sha256: "a".repeat(64), plan_sha256: state === "FAILED_PLAN_VALIDATION" ? null : "b".repeat(64) };
    const commands = new PostgresOosCommands({ pool: {}, getPreparation: async () => advanced });
    const result = await commands.executePremarketDay({ execute() { throw new Error("MUST_NOT_CAPTURE"); } }, DAY);
    assert.equal(result.state, state);
  }
});

test("technical premarket failure retries only capture, never builder or replay", async () => {
  const calls = [], commands = new PostgresOosCommands({ pool: {}, getPreparation: async () => row("2026-07-29", "FAILED_TECHNICAL") });
  const result = await commands.executePremarketDay({ execute: async (day, action) => { calls.push(action); return row(day.date, "PREMARKET_READY"); } }, DAY);
  assert.deepEqual(calls, ["retry-capture"]); assert.equal(result.state, "PREMARKET_READY");
});

test("restart after durable day completion does not recapture or call scenario/replay", async () => {
  const f = await fixture(); await f.workflow.execute(DAY, "capture");
  const calls = [...f.calls];
  f.repository.getPreparation = () => f.repository.get();
  const commands = new PostgresOosCommands(f.repository);
  const receipt = await commands.executeDay(f.workflow, { payload: { premarket_only: true, action: "capture", days: [DAY] } }, 0);
  assert.equal(receipt.state, "PREMARKET_READY"); assert.deepEqual(f.calls, calls);
  assert.equal(f.submissions.length, 0); assert.equal(await f.archive.optionalJson(DAY, "replay/run_meta.json"), null);
});

test("all eight proven captures required; partial capture cannot become ready", async () => {
  const f = await fixture(); let count = 0;
  const capture = f.tradingView.capturePremarket.bind(f.tradingView);
  f.tradingView.capturePremarket = input => { if (++count === 8) throw Object.assign(new Error("technical"), { code: "TV_TIMEOUT" }); return capture(input); };
  const failed = await f.workflow.execute(DAY, "capture");
  assert.equal(failed.state, "FAILED_TECHNICAL"); assert.equal(failed.capture_count, 7); assert.equal(hasPremarket(failed), false);
  assert.equal(f.submissions.length, 0); assert.equal(f.calls.includes("replay"), false);
  f.tradingView.capturePremarket = capture;
  const ready = await f.workflow.execute(DAY, "retry-capture");
  assert.equal(ready.state, "PREMARKET_READY"); assert.equal(ready.capture_count, 8);
});

test("technical projection excludes prices/results; statuses/counts preserve failures and queued replay", () => {
  const ready = { ...row("2026-07-27", "PREMARKET_READY"), capture_count: 8, manifest_sha256: "a".repeat(64) };
  const failed = { ...row("2026-07-28", "FAILED_TECHNICAL"), error: { code: "TV_TIMEOUT", details: { secret: "EXCLUDE" } } };
  const projected = projectPreparationDay(failed);
  assert.deepEqual(projected.error, { code: "TV_TIMEOUT" }); assert.equal(JSON.stringify(projected).includes("EXCLUDE"), false);
  assert.equal(projectPreparationDay({ ...ready, state: "FROZEN" }, { replay: new Set([ready.day]) }).replay_status, "QUEUED");
  const queue = { capture: new Set([ready.day, failed.day, "2026-07-29"]) };
  assert.equal(projectPreparationDay(ready, queue).queue_status, "NOT_QUEUED");
  assert.deepEqual(queuedPreparationDates([ready, failed], queue), [failed.day]);
  assert.equal(preparationStatus({ rows: [ready, failed], commandStatus: "COMPLETED" }), "PARTIAL");
  assert.equal(preparationStatus({ rows: [failed], commandStatus: "COMPLETED" }), "FAILED");
  assert.equal(preparationStatus({ rows: [failed], commandStatus: "RUNNING" }), "RUNNING");
  assert.equal(preparationStatus({ rows: [], commandStatus: "COMPLETED" }), "COMPLETED");
  assert.deepEqual(preparationCounts([ready, failed]), { total_days: 2, ready: 1, failed: 1, queued: 0, completed: 0,
    UNSCORABLE_MARKET_GAP_DAYS: 0, premarket_ready: 1, next_waiting_scenario: ready.day });
});

test("replay status preserves actual lifecycle and failure checkpoints, even while a command is running", () => {
  const base = row("2026-07-01", "FROZEN"), queue = { replay: new Set([base.day]) };
  assert.equal(projectPreparationDay(base).replay_status, "NOT_REQUESTED");
  assert.equal(projectPreparationDay(base, queue).replay_status, "QUEUED");
  for (const state of ["REPLAYING", "CAPTURING_RESULTS", "COMPLETED"]) {
    assert.equal(projectPreparationDay({ ...base, state, checkpoint: state }, queue).replay_status, state);
    const failed = { ...base, state: "FAILED_TECHNICAL", checkpoint: state };
    if (state !== "COMPLETED") assert.equal(projectPreparationDay(failed).replay_status, "FAILED_TECHNICAL");
  }
  assert.equal(projectPreparationDay({ ...base, state: "FAILED_TECHNICAL", checkpoint: "CAPTURING" }).replay_status, "NOT_REQUESTED");
  assert.equal(projectPreparationDay({ ...base, state: "FAILED_TECHNICAL", checkpoint: "REPLAYING" }, queue).replay_status, "QUEUED");
});

test("batch read selectors reject ambiguity and remain read-only", async () => {
  const batches = memory(), api = createPremarketOrchestration(options(batches));
  for (const filters of [{ month: "2026-09" }, { month: "2026-07", start_date: "2026-07-01", end_date: "2026-07-31" }, { start_date: "2026-07-01" }, { other: "forbidden" }]) {
    await assert.rejects(api.status(filters));
  }
  const status = await api.status({ month: "2026-07" });
  assert.equal(status.start_date, "2026-07-01"); assert.equal(status.end_date, "2026-07-31");
  assert.equal(batches.queued.length, 0); assert.equal(batches.rows.size, 0);
});
