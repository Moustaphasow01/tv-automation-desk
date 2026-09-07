import test from "node:test";
import assert from "node:assert/strict";
import { frontApiCacheControl, frontApiEtag, requestMatchesEtag } from "../src/front-api-cache.js";
import {
  FRONT_RESOURCE_PATHS,
  loadFrontApiResource,
  loadFrontMacroResource,
  loadFrontMarketResource,
} from "../src/front-api-resources.js";
import { loadFrontDeskSession } from "../src/front-session-projection.js";

const scope = {
  strategy_id: "asia_open",
  session: "asia_open",
  trading_date: "2026-07-14",
  date: "2026-07-14",
  mode: "live",
  run_id: "front_live_2026-07-14_asia_open",
  as_of_utc: "2026-07-14T08:00:00.000Z",
  timezone: "Europe/Paris",
};

function liveFixture() {
  return {
    ok: true,
    ...scope,
    resolved_scope: scope,
    pack: { pack_id: "pack-1", pack_build_id: "build-1", data_cutoff: { cutoff_paris: "2026-07-14T10:00:00+02:00" } },
    active_thesis: { thesis_id: "thesis-1", instrument: "MNQ", direction: "long", status: "active" },
    latest_master: { analysis_id: "master-1", instrument: "MNQ" },
    active_position: {
      status: "ACTIVE",
      instrument: "MNQ",
      direction: "long",
      entry_price: 22_000,
      mark_price: 22_025,
      unrealized_R: 0.5,
      note: "Position issue du backend d'exécution.",
    },
    macro_cross_asset_summary: { DXY: { price: 97.4, change_pct: -0.2 } },
    key_levels: [{ price: 22_000, role: "support", state: "observed" }],
    jobs: [],
    alerts: [],
    contracts: {
      front: { contract_name: "DeskFrontProjectionContract", schema_version: "1.0.0", status: "active" },
    },
    data_readiness: {},
  };
}

function fakeStore(overrides = {}) {
  return {
    getLiveDeskState: async () => liveFixture(),
    getSessionSnapshot: async () => ({
      session_snapshot: {
        timestamp_paris: "2026-07-14T10:00:00+02:00",
        instruments: {
          MNQ: { price: 22_025, change_pct: 0.35, timestamp_paris: "2026-07-14T10:00:00+02:00" },
        },
      },
    }),
    getMacroCalendar: async () => ({
      events: [{
        scheduled_at_paris: "2026-07-14T10:45:00+02:00",
        title: "CPI US",
        importance: "high",
        impact_text: "Volatilité attendue.",
      }],
    }),
    getNewsDigest: async () => ({
      updated_at_paris: "2026-07-14T10:00:00+02:00",
      digest: "Le marché attend le CPI.",
      items: [{
        published_at_paris: "2026-07-14T09:55:00+02:00",
        headline: "Futures stables avant le CPI",
        source: "Desk News",
        impact: "Attentisme sur MNQ.",
      }],
    }),
    listDeskJobs: async () => ({
      jobs: [{ job_id: "job-1", job_type: "LIVE_M15_MONITOR", status: "RUNNING", created_at_paris: "2026-07-14T10:00:00+02:00" }],
    }),
    listAlerts: async () => ({
      alerts: [{ title: "CPI proche", message: "Réduire le risque.", severity: "warning", created_at_paris: "2026-07-14T10:00:00+02:00" }],
    }),
    getAuditState: async () => ({
      anti_lookahead: { pack_cutoff_ok: true, no_post_cutoff_candles: true, no_actual_j_jplus1: true },
      errors: [],
    }),
    getStrategyCalendar: async ({ year, month, pricing_mode }) => ({
      ok: true,
      strategy_id: "ny_open_1530",
      pricing_mode,
      year,
      month,
      from_date: `${year}-${String(month).padStart(2, "0")}-01`,
      to_date: `${year}-${String(month).padStart(2, "0")}-31`,
      summary: { closed_trades: 2, wins: 1, losses: 1, win_rate: 0.5, total_R: 1.25, expectancy_R: 0.625, max_drawdown_R: -0.5 },
      days: [{ date: `${year}-${String(month).padStart(2, "0")}-14`, status: "win", total_R: 1.25, closed_trades: 2, setup_count: 1, has_master: true, has_trade: true, has_open_position: false, pack_status: "ready", master_decision: "GO", setup_status: "CLOSED" }],
    }),
    getStrategyDayDetail: async ({ date, pricing_mode }) => ({
      ok: true, strategy_id: "ny_open_1530", pricing_mode, date,
      master: { decision: "GO", summary: "Plan haussier." }, thesis: null,
      setups: [], monitors: [], trades: [{ trade_id: "trade-1", instrument: "MNQ", result_R: 1.25 }],
      performance: { summary: { closed_trades: 1, wins: 1, losses: 0, win_rate: 1, total_R: 1.25 } },
      timeline: [{ time: `${date}T15:45:00+02:00`, type: "Trade", title: "MNQ", status: "closed" }],
    }),
    ...overrides,
  };
}

test("market resource projects the canonical snapshot and cross-asset data", async () => {
  const store = fakeStore();
  const resource = await loadFrontMarketResource(store, scope);

  assert.equal(resource.contract, "DeskFrontMarketResource");
  assert.deepEqual(resource.scope, {
    strategyId: "asia_open",
    session: "asia_open",
    tradingDate: "2026-07-14",
    mode: "live",
  });
  assert.equal(resource.market.find((item) => item.symbol === "MNQ")?.price, "22 025");
  assert.equal(resource.market.find((item) => item.symbol === "DXY")?.trend, "down");
  assert.deepEqual(resource.levels, [{ price: "22 000", role: "support", state: "observed" }]);
});

test("all dedicated front routes return their validated resource contract", async () => {
  const store = fakeStore();
  const expected = {
    "/api/v1/market/snapshot": "DeskFrontMarketResource",
    "/api/v1/positions/current": "DeskFrontPositionResource",
    "/api/v1/macro/calendar": "DeskFrontMacroResource",
    "/api/v1/news/headlines": "DeskFrontNewsHeadlinesResource",
    "/api/v1/news/digest": "DeskFrontNewsDigestResource",
    "/api/v1/desk/activity": "DeskFrontActivityResource",
    "/api/v1/alerts": "DeskFrontAlertsResource",
    "/api/v1/audit": "DeskFrontAuditResource",
    "/api/v1/performance/calendar": "DeskFrontPerformanceCalendarResource",
    "/api/v1/performance/day": "DeskFrontPerformanceDayResource",
  };

  assert.deepEqual([...FRONT_RESOURCE_PATHS], Object.keys(expected));
  for (const [pathname, contract] of Object.entries(expected)) {
    const resource = await loadFrontApiResource(store, pathname, scope);
    assert.equal(resource.contract, contract, pathname);
    assert.equal(resource.schemaVersion, "1.0.0", pathname);
  }
});

test("performance resources expose monthly R and drill-down day detail", async () => {
  const store = fakeStore();
  const [calendar, day] = await Promise.all([
    loadFrontApiResource(store, "/api/v1/performance/calendar", { ...scope, year: 2026, month: 7, pricing_mode: "conservative" }),
    loadFrontApiResource(store, "/api/v1/performance/day", { ...scope, date: "2026-07-14", pricing_mode: "conservative" }),
  ]);

  assert.equal(calendar.calendar.summary.total_R, 1.25);
  assert.equal(calendar.calendar.days[0].closed_trades, 2);
  assert.equal(day.day.performance.summary.total_R, 1.25);
  assert.equal(day.day.trades[0].instrument, "MNQ");
});

test("position, macro, news, activity, alerts and audit preserve canonical data", async () => {
  const store = fakeStore();
  const [position, macro, digest, headlines, activity, alerts, audit] = await Promise.all([
    loadFrontApiResource(store, "/api/v1/positions/current", scope),
    loadFrontApiResource(store, "/api/v1/macro/calendar", scope),
    loadFrontApiResource(store, "/api/v1/news/digest", scope),
    loadFrontApiResource(store, "/api/v1/news/headlines", scope),
    loadFrontApiResource(store, "/api/v1/desk/activity", scope),
    loadFrontApiResource(store, "/api/v1/alerts", scope),
    loadFrontApiResource(store, "/api/v1/audit", scope),
  ]);

  assert.deepEqual(position.position, {
    active: true,
    status: "ACTIVE",
    instrument: "MNQ",
    direction: "long",
    entry: 22_000,
    current: 22_025,
    unrealizedR: 0.5,
    note: "Position issue du backend d'exécution.",
  });
  assert.equal(macro.nearEvent, true);
  assert.equal(macro.macro[0].title, "CPI US");
  assert.equal(digest.news.digest, "Le marché attend le CPI.");
  assert.equal(headlines.headlines[0].title, "Futures stables avant le CPI");
  assert.equal(activity.automation.status, "RUNNING");
  assert.equal(alerts.alerts[0].level, "warning");
  assert.equal(audit.dataQuality.status, "ready");
  assert.equal(audit.audit.contracts[0].name, "DeskFrontProjectionContract");
});

test("a failed optional source is explicit and does not invent macro events", async () => {
  const store = fakeStore({ getMacroCalendar: async () => { throw new Error("dataset unavailable"); } });
  const resource = await loadFrontMacroResource(store, scope);

  assert.deepEqual(resource.macro, []);
  assert.equal(resource.nearEvent, false);
  assert.match(resource.warnings[0], /^macro_calendar_not_available:dataset unavailable$/);
});

test("macro and news remain available without a session pack or Master", async () => {
  const calls = [];
  const store = fakeStore({
    getLiveDeskState: async () => {
      const live = liveFixture();
      delete live.pack;
      delete live.active_thesis;
      delete live.latest_master;
      return live;
    },
    getMacroCalendar: async (input) => {
      calls.push(["macro", input]);
      return { events: [{ scheduled_at_paris: "2026-07-14T10:45:00+02:00", title: "CPI US", importance: "high", impact_text: "Volatilité attendue." }] };
    },
    getNewsDigest: async (input) => {
      calls.push(["news", input]);
      return {
        updated_at_paris: "2026-07-14T10:00:00+02:00",
        digest: "Digest quotidien autonome.",
        items: [{ published_at_paris: "2026-07-14T09:55:00+02:00", headline: "Futures stables", source: "Desk News", impact: "Neutre" }],
      };
    },
  });

  const [macro, digest, headlines] = await Promise.all([
    loadFrontApiResource(store, "/api/v1/macro/calendar", scope),
    loadFrontApiResource(store, "/api/v1/news/digest", scope),
    loadFrontApiResource(store, "/api/v1/news/headlines", scope),
  ]);

  assert.equal(macro.macro[0].title, "CPI US");
  assert.equal(digest.news.digest, "Digest quotidien autonome.");
  assert.equal(headlines.headlines[0].title, "Futures stables");
  assert.equal(calls.every(([, input]) => input.pack_id === undefined && input.pack_build_id === undefined), true);
  assert.equal(calls.find(([kind]) => kind === "news")[1].as_of_utc, scope.as_of_utc);
  assert.equal(calls.filter(([kind]) => kind === "macro").every(([, input]) => input.as_of_utc === undefined), true);
});

test("live session, macro and news coalesce shared live and macro reads", async () => {
  let liveReads = 0;
  let macroReads = 0;
  const store = fakeStore({
    getLiveDeskState: async () => {
      liveReads += 1;
      await Promise.resolve();
      return liveFixture();
    },
    getMacroCalendar: async () => {
      macroReads += 1;
      await Promise.resolve();
      return { events: [{ scheduled_at_paris: "2026-07-14T10:45:00+02:00", title: "CPI US", importance: "high" }] };
    },
  });
  const { as_of_utc: _asOf, ...currentScope } = scope;
  const cachedScope = { ...currentScope, front_cache: true, defer_secondary_resources: true };

  const [session, macro, headlines] = await Promise.all([
    loadFrontDeskSession(store, cachedScope),
    loadFrontApiResource(store, "/api/v1/macro/calendar", cachedScope),
    loadFrontApiResource(store, "/api/v1/news/headlines", cachedScope),
  ]);

  assert.equal(session.id, "asia_open");
  assert.equal(macro.macro[0].title, "CPI US");
  assert.equal(headlines.headlines[0].title, "Futures stables avant le CPI");
  assert.equal(liveReads, 1, "all auxiliary sources must share one live desk read");
  assert.equal(macroReads, 1, "macro and news must share one macro calendar read");
});

test("news resources expose the complete daily macro calendar when no headline provider is configured", async () => {
  const sourceReads = [];
  const store = fakeStore({
    getNewsDigest: async (input) => {
      sourceReads.push(input);
      return { status: "not_configured", empty_ok: true, items: [] };
    },
    getMacroCalendar: async (input) => {
      sourceReads.push(input);
      return {
      events: [
        { scheduled_at_paris: "2026-07-14T14:30:00+02:00", title: "CPI m/m", importance: "high" },
        { scheduled_at_paris: "2026-07-14T10:45:00+02:00", title: "Discours BOE", importance: "medium" },
      ],
      };
    },
  });

  const [digest, headlines] = await Promise.all([
    loadFrontApiResource(store, "/api/v1/news/digest", scope),
    loadFrontApiResource(store, "/api/v1/news/headlines", scope),
  ]);

  assert.match(digest.news.digest, /2 événements macro dans la fenêtre glissante de 48 h avant\/après, dont 1 à fort impact/);
  assert.deepEqual(digest.news.headlines.map((item) => item.title), ["Discours BOE", "CPI m\/m"]);
  assert.equal(digest.news.headlines[0].source, "Calendrier macro");
  assert.equal(headlines.headlines.length, 2);
  assert.equal(sourceReads.every(input => input.pack_id === undefined && input.pack_build_id === undefined), true);
  assert.equal(sourceReads.find(input => Object.hasOwn(input, "session")).as_of_utc, scope.as_of_utc);
});

test("market resource falls back to passive daily packs with OHLC and mega caps", async () => {
  const rowsByDataset = {
    MNQ_M5: [
      { asset: "MNQ", timestamp_paris: "2026-07-14T00:00:00+02:00", open: 22000, high: 22010, low: 21990, close: 22005 },
      { asset: "MNQ", timestamp_paris: "2026-07-14T08:00:00+02:00", open: 22005, high: 22120, low: 21980, close: 22100, rsi_14: 61, atr_14: 42 },
      { asset: "MNQ", timestamp_paris: "2026-07-14T08:05:00+02:00", open: "", high: "", low: "", close: "" },
    ],
    MES_M5: [{ asset: "MES", timestamp_paris: "2026-07-14T08:00:00+02:00", open: 6400, high: 6410, low: 6385, close: 6390, rsi_14: 39, atr_14: 11 }],
    DXY_CL_GC_VIX: [{ asset: "CL", timestamp_paris: "2026-07-14T08:00:00+02:00", open: 66, high: 67, low: 65, close: 66.5, rsi_14: 54, atr_14: 1.2 }],
    mega_caps_premarket: [{ asset: "NVDA", timestamp_paris: "2026-07-14T08:00:00+02:00", open: 180, high: 185, low: 179, close: 184, rsi_14: 58, atr_14: 3.4 }],
  };
  const store = fakeStore({
    getSessionSnapshot: async () => ({
      session_snapshot: {
        instruments: {
          MNQ: { latest_close: null, price: null, change_pct: null, day_ohlc: {} },
        },
      },
    }),
    getLatestAsiaOpenPack: async () => ({ pack_id: "pack-1", pack_build_id: "build-1" }),
    getDeskPack: async () => ({ pack_id: "pack-1", pack_build_id: "build-1", cutoff_paris: "2026-07-14T08:00:00+02:00" }),
    getDataset: async ({ dataset }) => ({ rows: rowsByDataset[dataset] || [] }),
  });

  const resource = await loadFrontMarketResource(store, scope);
  const mnq = resource.market.find((item) => item.symbol === "MNQ");
  const mes = resource.market.find((item) => item.symbol === "MES");

  assert.equal(mnq?.trend, "up");
  assert.deepEqual(mnq?.ohlc, { open: "22 000", high: "22 120", low: "21 980", close: "22 100" });
  assert.equal(mnq?.rsi, "61");
  assert.equal(mes?.trend, "down");
  assert.equal(resource.market.some((item) => item.symbol === "MCL"), true);
  assert.equal(resource.market.some((item) => item.symbol === "NVDA"), true);
});

test("ETag helpers are deterministic and support conditional requests", async () => {
  const resource = await loadFrontMarketResource(fakeStore(), scope);
  const etag = frontApiEtag(resource);

  assert.equal(frontApiEtag(structuredClone(resource)), etag);
  assert.match(etag, /^W\/\"[A-Za-z0-9_-]+\"$/);
  assert.equal(requestMatchesEtag(etag, etag), true);
  assert.equal(requestMatchesEtag(`W/\"other\", ${etag}`, etag), true);
  assert.equal(requestMatchesEtag("*", etag), true);
  assert.equal(requestMatchesEtag("", etag), false);
  assert.equal(frontApiCacheControl(15), "private, max-age=15, must-revalidate");
});
