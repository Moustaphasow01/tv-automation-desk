import test from "node:test";
import assert from "node:assert/strict";
import { fixture, DAY, PLAN } from "./support.js";
import { sha256 } from "../src/adapter/artifact-archive.js";
import { OosPortal } from "../src/application/oos-portal.js";
import { aggregateBatch, projectDay } from "../src/application/batch-projection.js";
import { projectPreparationDay, preparationCounts } from "../src/domain/premarket-batch.js";
import { proveMarketSessionExhaustion, frozenPlanHasMatchingGap } from "../src/domain/market-session-exhaustion.js";
import { sessionCalendarEvidence } from "../src/domain/session-calendar-evidence.js";

function proof(meta) {
  return { stage: "REPLAYING", timeframe: "15", observed_bar_open: "2026-07-01T16:45:00.000Z",
    last_confirmed_bar_time: "2026-07-01T16:45:00.000Z", observed_bar_close: "2026-07-01T17:00:00.000Z",
    native_gap: { source: "TradingView native bars() consecutive indices",
      previous_confirmed_bar: "2026-07-01T16:45:00.000Z", expected_next_bar_open: "2026-07-01T17:00:00.000Z",
      next_native_bar_open: "2026-07-05T22:00:00.000Z" },
    tv_replay_state: { immutable_scope: { date: DAY.date, symbol: DAY.symbol,
      plan_sha256: meta.plan_sha256, manifest_sha256: meta.premarket_manifest_sha256,
      engine_version: DAY.engine_version, book_mode: DAY.book_mode, execution_timeframe: "15m",
      cutoff: "2026-07-01T07:00:00.000Z", session_end: "2026-07-01T18:00:00.000Z" } } };
}

async function frozenFixture(text = PLAN) {
  const f = await fixture();
  f.scenarioBuilder.request = async () => ({ status: "READY", plan_text: text,
    generated_by: "SYNTHETIC_TEST_ONLY", generated_at: "2026-09-29T12:00:00Z" });
  f.tradingView.readPlanFingerprint = async () => ({ ...DAY, plan_sha256: sha256(text) });
  await f.workflow.execute(DAY, "scenario");
  const frozen = await f.freeze.verify(DAY);
  f.tradingView.replayTo = async () => { f.calls.push("replay");
    throw Object.assign(new Error("native gap"), { code: "TV_REPLAY_SESSION_BAR_UNAVAILABLE", details: proof(frozen.meta) }); };
  f.repository.list = async () => [await f.repository.get()];
  f.portal = new OosPortal({ runtime: f, batchId: DAY.batch_id, symbol: DAY.symbol, cutoffTime: "09:00" });
  return { ...f, frozen };
}

test("exact frozen GAP coverage uses Europe/Paris, never an implicit calendar or plan repair", () => {
  const meta = { plan_sha256: "a".repeat(64), premarket_manifest_sha256: "b".repeat(64) };
  const coverage = proveMarketSessionExhaustion({ day: DAY, meta, details: proof(meta) });
  assert.equal(coverage.last_native_bar_close, "2026-07-01T17:00:00.000Z");
  assert.equal(frozenPlanHasMatchingGap(PLAN, coverage), false);
  assert.equal(frozenPlanHasMatchingGap("GAP|2026-07-01|19:00|2026-07-01|20:00|TEST;", coverage), true);
  assert.equal(frozenPlanHasMatchingGap("GAP|2026-07-01|19:15|2026-07-01|20:00|TEST;", coverage), false);
  assert.equal(frozenPlanHasMatchingGap("GAP|2026-07-01|19:00|2026-07-01|19:45|TEST;", coverage), false);
});

test("unscorable completion publishes coverage only; no ENGINE result, synthetic bar or capture", async () => {
  const f = await frozenFixture(), before = await f.premarket.verify(DAY);
  const row = await f.workflow.execute(DAY, "replay");
  assert.equal(row.state, "COMPLETED"); assert.equal(row.checkpoint, "COMPLETED");
  assert.equal(row.run_meta.result_classification, "UNSCORABLE_MARKET_GAP");
  assert.equal(row.run_meta.reason, "UNDECLARED_MARKET_SESSION_GAP");
  assert.equal(row.run_meta.scorable, false); assert.equal(row.audit, null);
  assert.equal(row.run_meta.recalculated, false);
  assert.equal(row.plan_sha256, f.frozen.meta.plan_sha256);
  assert.equal((await f.archive.read(DAY, "plan/PLAN_SMC3.txt")).toString(), PLAN);
  assert.equal((await f.premarket.verify(DAY)).manifest_sha256, before.manifest_sha256);
  assert.equal(await f.archive.optionalJson(DAY, "evidence/replay-completed.json"), null);
  assert.equal(await f.archive.optionalJson(DAY, "replay/audit.json"), null);
  assert.equal(await f.archive.optionalJson(DAY, "replay/run_meta.json"), null);
  assert.ok(!f.calls.includes("results") && !f.calls.includes("resume-capture"));
  const result = await f.portal.result(DAY.date);
  assert.equal(result.audit, null); assert.deepEqual(result.artifact_hashes, []);
  assert.ok(Object.values(result.metrics).every(x => x === null));
  assert.equal(result.technical_receipt.sha256, row.run_meta.coverage_receipt.sha256);
  const calls = f.calls.length, revision = row.revision;
  assert.equal((await f.workflow.execute(DAY, "retry")).revision, revision);
  assert.equal((await f.portal.requestReplay(DAY.date)).idempotent, true);
  assert.equal(f.calls.length, calls);
});

test("coverage receipt resumes after crash without replaying, recapturing or changing freeze", async () => {
  const f = await frozenFixture(), save = f.repository.save.bind(f.repository);
  let crash = true;
  f.repository.save = async (row, change, at) => {
    if (crash && change.state === "COMPLETED") { crash = false; throw new Error("SYNTHETIC_DATABASE_INTERRUPTION"); }
    return save(row, change, at);
  };
  assert.equal((await f.workflow.execute(DAY, "replay")).state, "FAILED_TECHNICAL");
  const count = f.calls.length;
  assert.equal((await f.workflow.execute(DAY, "retry")).state, "COMPLETED");
  assert.equal(f.calls.length, count);
});

test("declared GAP is never reclassified as undeclared; ENGINE publication still required", async () => {
  const f = await frozenFixture(PLAN + ";GAP|2026-07-01|19:00|2026-07-01|20:00|TEST;");
  const row = await f.workflow.execute(DAY, "replay");
  assert.equal(row.state, "FAILED_TECHNICAL");
  assert.equal(row.error.code, "DECLARED_MARKET_GAP_ENGINE_AUDIT_REQUIRED");
  assert.equal(row.run_meta, undefined);
});

test("a native candle before end, unconfirmed bar, UI-only gap or foreign scope cannot complete", () => {
  const meta = { plan_sha256: "a".repeat(64), premarket_manifest_sha256: "b".repeat(64) };
  for (const change of [d => { d.native_gap.next_native_bar_open = "2026-07-01T17:30:00Z"; },
    d => { d.last_confirmed_bar_time = "2026-07-01T16:30:00Z"; },
    d => { d.native_gap.source = "UI_CLOCK_ONLY"; },
    d => { d.tv_replay_state.immutable_scope.plan_sha256 = "c".repeat(64); },
    d => { d.stage = "CARRY"; }]) {
    const details = proof(meta); change(details);
    assert.throws(() => proveMarketSessionExhaustion({ day: DAY, meta, details }));
  }
});

test("unscorable days retain coverage and are excluded from every performance metric", () => {
  const gap = { day: DAY.date, state: "COMPLETED", plan_sha256: "a".repeat(64),
    run_meta: { result_classification: "UNSCORABLE_MARKET_GAP", reason: "UNDECLARED_MARKET_SESSION_GAP" },
    audit: { net_r: 999, net_usd: 999, fills: 999, wins: 999, losses: 999, mae: 999 } };
  const normal = { state: "COMPLETED", audit: { net_r: 2, fills: 3, wins: 2, losses: 1 } };
  const stats = aggregateBatch([gap, normal]);
  assert.equal(stats.days, 2); assert.equal(stats.completed, 2); assert.equal(stats.statistical_days, 1);
  assert.equal(stats.UNSCORABLE_MARKET_GAP_DAYS, 1); assert.equal(stats.metrics.net_r.sum, 2);
  assert.equal(stats.metrics.fills.sum, 3); assert.equal(stats.metrics.wins.sum, 2);
  assert.equal(stats.metrics.losses.sum, 1); assert.equal(stats.metrics.mae.sum, null);
  assert.ok(Object.values(projectDay(gap).metrics).every(x => x === null));
  const technical = { ...gap, ...gap.run_meta }; delete technical.run_meta; delete technical.audit;
  assert.equal(projectPreparationDay(technical).scorable, false);
  assert.equal(projectPreparationDay(technical).replay_status, "COMPLETED");
  assert.equal(preparationCounts([technical]).UNSCORABLE_MARKET_GAP_DAYS, 1);
  assert.equal(projectPreparationDay({ ...technical, state: "PREMARKET_READY", plan_sha256: null }).scorable, undefined);
});

test("coverage does not leak before freeze and receipt tampering is rejected", async () => {
  const f = await frozenFixture();
  await f.workflow.execute(DAY, "replay");
  const original = f.repository.row.run_meta;
  f.repository.row.run_meta = { ...original, last_native_bar_close: "2026-07-01T18:00:00Z" };
  await assert.rejects(f.portal.result(DAY.date), { code: "SESSION_COVERAGE_REGISTRY_MISMATCH" });
  f.repository.row.plan_sha256 = null;
  assert.equal((await f.portal.status(DAY.date)).scorable, undefined);
  await assert.rejects(f.portal.result(DAY.date), { code: "PLAN_NOT_FROZEN" });
});

test("future calendar is explicit pre-cutoff evidence only and never retrofits existing bundles", async () => {
  const calendar = { date: DAY.date, symbol: DAY.symbol, timezone: DAY.timezone, source: "SYNTHETIC_TEST_ONLY",
    version: "fixture/1", known_at: "2026-06-01T00:00:00Z", early_close: true,
    session_open: "2026-07-01T00:00:00+02:00", session_close: "2026-07-01T19:00:00+02:00" };
  assert.deepEqual(sessionCalendarEvidence(undefined, DAY, sha256), {});
  assert.throws(() => sessionCalendarEvidence({ ...calendar, known_at: "2026-07-01T20:00:00Z" }, DAY, sha256),
    { code: "SESSION_CALENDAR_POST_CUTOFF" });
  const f = await fixture(); f.premarket.sessionCalendar = { [DAY.date]: calendar };
  const bundle = await f.premarket.capture(DAY);
  assert.equal(bundle.manifest.session_calendar.early_close, true);
  const { sha256: hash, ...content } = bundle.manifest.session_calendar;
  assert.equal(hash, sha256(JSON.stringify(content, null, 2) + "\n"));
  const count = f.calls.length;
  f.premarket.sessionCalendar[DAY.date] = { ...calendar, version: "later-version" };
  assert.equal((await f.premarket.capture(DAY)).manifest_sha256, bundle.manifest_sha256);
  assert.equal(f.calls.length, count);
  assert.equal(await f.archive.optionalJson(DAY, "plan/plan_meta.json"), null);
  assert.ok(!f.calls.includes("replay"));
});
