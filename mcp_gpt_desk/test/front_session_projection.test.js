import assert from "node:assert/strict";
import test from "node:test";
import { FixedClock } from "@tv-automation/desk-time";
import {
  applyFrontProjection,
  loadFrontDeskSession,
  loadFrontMarketSnapshot,
  normalizeFrontApiScope,
  projectDeskSession,
  sessionSummary,
} from "../src/front-session-projection.js";
import { PersistentDeskStore } from "../src/store.js";

test("front session projection keeps canonical setup and execution position separate", () => {
  const session = projectDeskSession({
    live: {
      trading_date: "2026-07-13",
      strategy_id: "ny_open_1530",
      session: "ny_open",
      mode: "live",
      desk_status: "POSITION_PROTECTED",
      desk_color: "orange",
      as_of_utc: "2026-07-13T16:10:00.000Z",
      action_now: {
        decision: "HOLD",
        message: "Conserver la position protégée.",
        next_condition: "Surveiller TP1.",
      },
      active_thesis: {
        thesis_id: "thesis-1",
        instrument: "MNQ",
        direction: "short",
        status: "POSITION_PROTECTED",
        confidence_pct: 68,
        health_score: 72,
        dominant_scenario: "Poursuite sous VWAP.",
        valid_until: "2026-07-13T18:00:00+02:00",
      },
      active_position: {
        status: "protected",
        instrument: "MNQ",
        direction: "short",
        entry_price: 22450,
        current_price: 22420,
        unrealized_R: 0.8,
      },
      key_levels: [{ price: 22400, label: "TP1", status: "active" }],
      jobs: [{ job_id: "job-1", job_type: "HOURLY_MONITOR", status: "DONE", updated_at_paris: "2026-07-13T18:00:00+02:00" }],
      contracts: {
        master: { contract_name: "DeskMasterAnalysisContract", schema_version: "4.0.0", status: "active" },
      },
      data_readiness: { pack: "ready", level_map: "ready" },
    },
    masterAnalysis: {
      analysis_id: "master-1",
      created_at_paris: "2026-07-13T15:35:00+02:00",
      full_analysis: {
        executive_summary: {
          final_decision: "WAIT",
          final_instrument: "MNQ",
          final_direction: "short",
          confidence_pct: 66,
          summary: "Plan initial baissier.",
        },
        macro_thesis: "Contexte risk-off.",
      },
    },
    monitors: [{
      monitor_id: "monitor-1",
      timestamp_paris: "2026-07-13T18:05:00+02:00",
      monitor_decision: {
        action: "HOLD",
        reason_summary: "Le scénario reste confirmé.",
      },
      thesis_health_score: {
        previous_score: 70,
        current_score: 72,
        score_drivers_positive: ["Position protégée"],
      },
      active_thesis_update: { status: "POSITION_PROTECTED" },
    }],
    setups: [{
      setup_id: "setup-1",
      label: "Rejet VWAP",
      instrument: "MNQ",
      direction: "short",
      status: "TRIGGERED",
      entry_zone: { from: 22445, to: 22455 },
      stop_loss: 22480,
      take_profit_1: 22400,
      risk_pct: 0.5,
    }],
    marketSnapshot: {
      timestamp_paris: "2026-07-13T18:09:00+02:00",
      anti_lookahead_compliant: true,
      instruments: { MNQ: {
        latest_close: 22420,
        latest_timestamp_paris: "2026-07-13T18:09:00+02:00",
        series_timeframe: "M1",
        intraday_series: [
          { timestamp_paris: "2026-07-13T18:08:00+02:00", open: 22418, high: 22422, low: 22417, close: 22419 },
          { timestamp_paris: "2026-07-13T18:09:00+02:00", open: 22419, high: 22423, low: 22418, close: 22420 },
        ],
      } },
    },
    macro: { events: [{ time_paris: "2026-07-13T20:00:00+02:00", title: "Budget balance", impact: "medium" }] },
    news: { items: [{ timestamp_paris: "2026-07-13T18:00:00+02:00", title: "Risk-off", source: "Desk feed" }] },
    audit: {
      anti_lookahead: { pack_cutoff_ok: true, no_actual_j_jplus1: true, no_post_cutoff_candles: true },
      errors: [],
      data_quality: { warnings: [] },
    },
  });

  assert.equal(session.id, "ny_open");
  assert.equal(session.setup.entryFrom, 22445);
  assert.equal(session.position.entry, 22450);
  assert.equal(session.position.current, 22420);
  assert.equal(session.position.active, true);
  assert.equal(session.lastDataAt, "18:09");
  assert.equal(session.market[0].seriesTimeframe, "M1");
  assert.equal(session.market[0].series.length, 2);
  assert.equal(session.market[0].series[1].close, 22420);
  assert.equal(session.lastMonitorAt, "18:05");
  assert.equal(session.dataQuality.status, "ready");
  assert.equal(session.monitors[0].healthAfter, 72);
  assert.equal(session.timeline.some((event) => event.type === "MONITOR"), true);
  assert.deepEqual(sessionSummary(session), {
    id: "ny_open",
    label: "NY Open",
    shortLabel: "NY",
    status: "POSITION_PROTECTED",
    severity: "warning",
    decision: "HOLD",
    health: 72,
    lastMonitorAt: "18:05",
  });
});

test("front projection exposes missing canonical values without fabricating prices", () => {
  const session = projectDeskSession({
    live: {
      date: "2026-07-13",
      session: "asia_open",
      desk_status: "NO_ACTIVE_THESIS",
      data_readiness: { pack: "missing" },
    },
  });

  assert.equal(session.setup.entryFrom, null);
  assert.equal(session.setup.stop, null);
  assert.equal(session.setup.risk, null);
  assert.equal(session.position.active, false);
  assert.equal(session.market.length, 0);
  assert.equal(session.lastDataAt, "—");
  assert.equal(session.crossAssetBrief.verdict, "Donnée indisponible");
  assert.equal(session.dataQuality.status, "degraded");
  assert.match(session.dataQuality.warnings[0], /pack: missing/);
});

test("front API scope is stable and session-specific", () => {
  const scope = normalizeFrontApiScope(
    { session: "ny_open", trading_date: "2026-07-10" },
    new Date("2026-07-13T10:00:00.000Z"),
  );
  assert.equal(scope.strategy_id, "ny_open_1530");
  assert.equal(scope.run_id, "front_live_2026-07-10_ny_open");
  assert.equal(scope.timezone, "Europe/Paris");
});

test("materialized front projection enriches narrative state without overriding canonical execution", () => {
  const base = projectDeskSession({
    live: {
      date: "2026-07-14",
      trading_date: "2026-07-14",
      strategy_id: "asia_open",
      session: "asia_open",
      mode: "live",
      desk_status: "THESIS_ACTIVE",
      active_position: { status: "protected", instrument: "MNQ", entry_price: 22400 },
      active_thesis: { thesis_id: "thesis-1", status: "THESIS_ACTIVE", health_score: 60, confidence_pct: 62 },
    },
    monitors: [{
      monitor_id: "monitor-2",
      timestamp_paris: "2026-07-14T08:15:00+02:00",
      monitor_decision: { action: "WAIT" },
      thesis_health_score: { previous_score: 60, current_score: 61 },
    }],
    setups: [{ setup_id: "setup-canonical", status: "TRIGGERED", entry_zone: { from: 22390, to: 22400 } }],
  });
  const enriched = applyFrontProjection(base, projectionFixture());

  assert.equal(enriched.liveBrief.headline, "Attente de confirmation");
  assert.equal(enriched.liveBrief.decision, "WAIT", "canonical Monitor decision keeps priority");
  assert.equal(enriched.thesis.health, 61, "canonical thesis health keeps priority");
  assert.equal(enriched.monitors[0].expectedVsRealized[0].element, "Support");
  assert.equal(enriched.setup.id, "setup-canonical", "canonical setup must keep priority");
  assert.equal(enriched.position.entry, 22400, "canonical execution position must keep priority");
});

test("BFF loader reads the materialized current projection and keeps its canonical fallback path", async () => {
  let projectionReads = 0;
  const session = await loadFrontDeskSession({
    async getLiveDeskState(scope) {
      return {
        ...scope,
        resolved_scope: scope,
        desk_status: "NO_ACTIVE_THESIS",
        data_readiness: {},
      };
    },
    async getLatestMasterAnalysis() { return { analysis: null }; },
    async getAuditState() { return {}; },
    async getSessionSnapshot() { return {}; },
    async getFrontProjectionCurrent() {
      projectionReads += 1;
      return { projection: projectionFixture() };
    },
  }, {
    session: "asia_open",
    strategy_id: "asia_open",
    trading_date: "2026-07-14",
    run_id: "front_live_2026-07-14_asia_open",
    as_of_utc: "2026-07-14T06:15:00.000Z",
  });

  assert.equal(projectionReads, 1);
  assert.equal(session.liveBrief.headline, "Attente de confirmation");
  assert.equal(session.liveBrief.decision, "NO_ACTIVE_THESIS");
  assert.equal(session.position.active, false, "a projection cannot create an execution position");
  assert.equal(session.position.entry, null);
});

test("BFF aggregate exposes daily macro and news without a session pack", async () => {
  const session = await loadFrontDeskSession({
    async getLiveDeskState(scope) {
      return { ...scope, resolved_scope: scope, desk_status: "NO_ACTIVE_THESIS", data_readiness: { pack: "missing" } };
    },
    async getLatestMasterAnalysis() { return { analysis: null }; },
    async getAuditState() { return {}; },
    async getSessionSnapshot() { return {}; },
    async getMacroCalendar(input) {
      assert.equal(input.pack_id, undefined);
      assert.equal(input.as_of_utc, undefined);
      return { events: [{ scheduled_at_paris: "2026-07-14T10:45:00+02:00", title: "CPI US", importance: "high", impact_text: "Volatilité attendue." }] };
    },
    async getNewsDigest(input) {
      assert.equal(input.pack_id, undefined);
      assert.equal(input.as_of_utc, undefined);
      return {
        updated_at_paris: "2026-07-14T10:00:00+02:00",
        digest: "Digest quotidien autonome.",
        items: [{ published_at_paris: "2026-07-14T09:55:00+02:00", headline: "Futures stables", source: "Desk News", impact: "Neutre" }],
      };
    },
  }, {
    session: "asia_open",
    strategy_id: "asia_open",
    trading_date: "2026-07-14",
    run_id: "front_live_2026-07-14_asia_open",
    as_of_utc: "2026-07-14T08:00:00.000Z",
    mode: "live",
  });

  assert.equal(session.macro[0].title, "CPI US");
  assert.equal(session.news.digest, "Digest quotidien autonome.");
  assert.equal(session.news.headlines[0].title, "Futures stables");
  assert.equal(session.status, "NO_ACTIVE_THESIS");
});

test("BFF aggregate exposes the complete daily macro calendar as honest news fallback", async () => {
  const session = projectDeskSession({
    live: { session: "asia_open", trading_date: "2026-07-14", desk_status: "NO_ACTIVE_THESIS" },
    news: { status: "not_configured", empty_ok: true, items: [] },
    macro: {
      events: [
        { timestamp_paris: "2026-07-14T14:30:00+02:00", title: "CPI y/y", importance: "high" },
        { timestamp_paris: "2026-07-14T10:45:00+02:00", title: "Discours BOE", importance: "medium" },
      ],
    },
  });

  assert.equal(session.news.headlines.length, 2);
  assert.equal(session.news.headlines[0].source, "Calendrier macro");
  assert.match(session.news.digest, /indépendant du Master et des workers/);
});

test("PostgreSQL live market reader prefers M1 and computes the evolving Paris-day OHLC", async () => {
  const rowsByParent = new Map([
    ["market_feeds/prod__tradingview__MNQ1!__1", [
      { timestamp_utc: "2026-07-14T07:00:00+00:00", open: 100, high: 102, low: 99, close: 101 },
      { timestamp_utc: "2026-07-14T08:20:00+00:00", open: 101, high: 104, low: 100, close: 103 },
    ]],
    ["market_feeds/prod__tradingview__MES1!__1", [
      { timestamp_utc: "2026-07-14T08:20:00+00:00", open: 50, high: 51, low: 49, close: 50.5 },
    ]],
    ["market_feeds/prod__tradingview__CL1!__5", [
      { timestamp_utc: "2026-07-14T08:15:00+00:00", open: 80, high: 81, low: 79, close: 80.5 },
    ]],
    ["market_feeds/prod__tradingview__NVDA__5", [
      { timestamp_utc: "2026-07-13T19:55:00+00:00", open: 200, high: 205, low: 198, close: 203 },
    ]],
  ]);
  const persistence = {
    async queryDocuments({ parentPath }) { return rowsByParent.get(parentPath) || []; },
  };
  const store = new PersistentDeskStore(new FixedClock(Date.parse("2026-07-14T08:21:00.000Z")), persistence);

  const snapshot = await store.getFrontLiveMarketSnapshot({ date: "2026-07-14" });

  assert.equal(snapshot.instruments.MNQ.timeframe, "M1");
  assert.equal(snapshot.instruments.MNQ.latest_close, 103);
  assert.deepEqual(snapshot.instruments.MNQ.day_ohlc, { open: 100, high: 104, low: 99, close: 103 });
  assert.equal(snapshot.instruments.MNQ.latest_timestamp_paris, "2026-07-14T10:20:00.000+02:00");
  assert.equal(snapshot.instruments.MCL.timeframe, "M5");
  assert.equal(snapshot.instruments.NVDA.market_date, "2026-07-13");
});

test("BFF market projection gives direct PostgreSQL candles priority over canonical snapshots", async () => {
  const result = await loadFrontMarketSnapshot({
    async getSessionSnapshot() {
      return { session_snapshot: { instruments: { MNQ: { latest_close: 100, rsi_14: 48 } } } };
    },
    async getFrontLiveMarketSnapshot() {
      return {
        timestamp_paris: "2026-07-14T10:20:00+02:00",
        instruments: {
          MNQ: {
            latest_close: 103,
            latest_timestamp_paris: "2026-07-14T10:20:00+02:00",
            day_ohlc: { open: 100, high: 104, low: 99, close: 103 },
            source: "market_feeds/prod__tradingview__MNQ1!__1/candles",
          },
        },
      };
    },
  }, { date: "2026-07-14", session: "asia_open", instrument: "MNQ" });

  assert.equal(result.session_snapshot.instruments.MNQ.latest_close, 103);
  assert.equal(result.session_snapshot.instruments.MNQ.rsi_14, 48);
  assert.equal(result.session_snapshot.source, "canonical_snapshot+postgres_market_feeds");
});

function projectionFixture() {
  return {
    contractName: "DeskFrontProjectionContract",
    schemaVersion: "1.0.0",
    source: {
      sourceType: "MONITOR", sourceId: "monitor-2", masterId: "master-1", monitorId: "monitor-2",
      thesisId: "thesis-1", strategyId: "asia_open", session: "asia_open", mode: "live",
      tradingDate: "2026-07-14", runId: "front_live_2026-07-14_asia_open",
      timestampParis: "2026-07-14T08:15:00+02:00", asOfUtc: "2026-07-14T06:15:00.000Z",
      sequence: 2, revision: 2,
    },
    status: {
      deskStatus: "THESIS_ACTIVE", decision: "MAINTAIN", actionCode: "WATCH", alertLevel: "watch",
      thesisStatus: "THESIS_ACTIVE", setupStatus: "ARMED", positionStatus: "NO_POSITION",
      confidencePct: 68, healthScore: 72, riskPct: 0.5,
    },
    briefs: {
      headline: "Attente de confirmation", oneLiner: "Support tenu.", marketBrief: "Marché stable.",
      thesisBrief: "Thèse confirmée.", deltaBrief: "Score en hausse.", whyNow: "Le support tient.",
      actionNow: "Surveiller.", nextFocus: "Cassure de résistance.",
    },
    latestChange: {
      stateTransition: { from: "WATCH", to: "WATCH" },
      scoreTransition: { from: 60, to: 72, delta: 12 },
      validatedElements: ["Support"], weakenedElements: [], invalidatedElements: [],
    },
    expectedVsRealized: [{ label: "Support", expected: "Tenue", realized: "Tenu", verdict: "confirm", impact: "positive" }],
    conditions: { go: [], invalidations: [] },
    setup: { setup_id: "setup-projected", status: "ARMED" },
    position: { status: "active", entry_price: 999 },
    marketContext: {},
    timelineEvent: { type: "MONITOR", title: "Monitor M15", summary: "Support tenu", severity: "watch" },
    drilldownRefs: { monitorId: "monitor-2" },
  };
}
