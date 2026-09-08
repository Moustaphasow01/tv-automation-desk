import assert from "node:assert/strict";
import test from "node:test";
import {
  MarketContextTaskScheduler,
  barCloseUtc,
  detectMarketContextEventReasons,
  eligibleBarOpenCutoffUtc,
  marketBarCoverageAssessment,
} from "../src/market-context-task-scheduler.js";
import {
  buildPrompt,
  marketContextValidityWindow,
  requiredSourcesReady,
  resolveBundleTimeContract,
} from "../scripts/run_us_grains_market_context_task_runner.mjs";

const ANALYSIS_AS_OF = "2026-09-07T15:00:00.000Z";
const MARKET_DATA_CUTOFF = "2026-09-04T18:20:00.000Z";

test("bar-open timestamps become closed-bar cutoffs without crossing the analysis instant", () => {
  assert.equal(barCloseUtc("2026-09-04T18:19:00.000Z", "1"), MARKET_DATA_CUTOFF);
  assert.equal(barCloseUtc("2026-09-04T18:15:00.000Z", "5"), MARKET_DATA_CUTOFF);
  assert.equal(eligibleBarOpenCutoffUtc(MARKET_DATA_CUTOFF, "1"), "2026-09-04T18:19:00.000Z");
  assert.equal(eligibleBarOpenCutoffUtc(MARKET_DATA_CUTOFF, "5"), "2026-09-04T18:15:00.000Z");
  assert.equal(barCloseUtc(new Date("2026-09-04T18:19:00.212Z"), "1"), "2026-09-04T18:20:00.212Z");
});

test("holiday freshness accepts Friday last-known bars but rejects Thursday truncation", () => {
  assert.deepEqual(marketBarCoverageAssessment({ available: true, ageMs: 92 * 60 * 60_000,
    freshnessMs: 96 * 60 * 60_000, timeframe: "1", coverageEnd: "2026-09-03T18:20:00.000Z",
    latestMarketDate: "2026-09-03", lastExpectedMarketDate: "2026-09-04",
    lastExpectedCoreClosesUtc: { "1": MARKET_DATA_CUTOFF } }), {
    stale: true,
    expectedMarketDateMismatch: true,
    expectedMarketCloseMismatch: true,
    lastExpectedCloseUtc: MARKET_DATA_CUTOFF,
  });
  assert.deepEqual(marketBarCoverageAssessment({ available: true, ageMs: 69 * 60 * 60_000,
    freshnessMs: 96 * 60 * 60_000, timeframe: "1", coverageEnd: MARKET_DATA_CUTOFF,
    latestMarketDate: "2026-09-04", lastExpectedMarketDate: "2026-09-04",
    lastExpectedCoreClosesUtc: { "1": MARKET_DATA_CUTOFF } }), {
    stale: false,
    expectedMarketDateMismatch: false,
    expectedMarketCloseMismatch: false,
    lastExpectedCloseUtc: MARKET_DATA_CUTOFF,
  });
  const truncatedFriday = marketBarCoverageAssessment({ available: true, ageMs: 72 * 60 * 60_000,
    freshnessMs: 96 * 60 * 60_000, timeframe: "5", coverageEnd: "2026-09-04T16:00:00.000Z",
    latestMarketDate: "2026-09-04", lastExpectedMarketDate: "2026-09-04",
    lastExpectedCoreClosesUtc: { "5": MARKET_DATA_CUTOFF } });
  assert.equal(truncatedFriday.stale, true);
  assert.equal(truncatedFriday.expectedMarketDateMismatch, false);
  assert.equal(truncatedFriday.expectedMarketCloseMismatch, true);
});

test("bundle time contract keeps source and legacy cutoffs as exact analysis-time aliases", () => {
  assert.deepEqual(resolveBundleTimeContract({
    timeContractVersion: "us_grains_market_context_time_v2",
    analysisAsOfUtc: ANALYSIS_AS_OF,
    marketDataCutoffUtc: MARKET_DATA_CUTOFF,
    sourceDataCutoff: ANALYSIS_AS_OF,
    cutoff: ANALYSIS_AS_OF,
  }), {
    analysisAsOfUtc: ANALYSIS_AS_OF,
    marketDataCutoffUtc: MARKET_DATA_CUTOFF,
  });
  assert.throws(() => resolveBundleTimeContract({
    timeContractVersion: "us_grains_market_context_time_v2",
    analysisAsOfUtc: ANALYSIS_AS_OF,
    marketDataCutoffUtc: MARKET_DATA_CUTOFF,
    sourceDataCutoff: ANALYSIS_AS_OF,
    cutoff: "2026-09-04T18:15:00.000Z",
  }), /US_GRAINS_CONTEXT_CUTOFF_ALIAS_MISMATCH/);
  assert.throws(() => resolveBundleTimeContract({
    timeContractVersion: "us_grains_market_context_time_v2",
    analysisAsOfUtc: ANALYSIS_AS_OF,
    marketDataCutoffUtc: "2026-09-07T15:00:01.000Z",
    sourceDataCutoff: ANALYSIS_AS_OF,
    cutoff: ANALYSIS_AS_OF,
  }), /US_GRAINS_CONTEXT_MARKET_DATA_LOOKAHEAD/);
});

test("closed-market prompt requires French narrative and the exact last-known price timestamp", () => {
  const prompt = buildPrompt({ canonicalMarketSession: { marketState: "HOLIDAY" } }, {
    analysisAsOfUtc: ANALYSIS_AS_OF,
    marketDataCutoffUtc: MARKET_DATA_CUTOFF,
  });
  assert.match(prompt, /human-facing narrative text in French/);
  assert.match(prompt, /exact UTC date and time of marketDataCutoffUtc/);
  assert.match(prompt, new RegExp(MARKET_DATA_CUTOFF.replaceAll(".", "\\.")));
});

test("required source readiness uses price time for OHLC and knowledge time for calendar and session", () => {
  const states = requiredSourceStates();
  assert.equal(requiredSourcesReady(states, {
    analysisAsOfUtc: ANALYSIS_AS_OF,
    marketDataCutoffUtc: MARKET_DATA_CUTOFF,
    marketState: "HOLIDAY",
  }), true);
  const calendarGap = states.map((source) => source.sourceId === "market_agri_events"
    ? { ...source, coverageEnd: "2026-09-06T23:59:59.000Z" }
    : source);
  assert.equal(requiredSourcesReady(calendarGap, {
    analysisAsOfUtc: ANALYSIS_AS_OF,
    marketDataCutoffUtc: MARKET_DATA_CUTOFF,
    marketState: "HOLIDAY",
  }), false);
  const staleOpenPrices = states.map((source) => source.sourceId === "ZC_1"
    ? { ...source, status: "STALE" }
    : source);
  assert.equal(requiredSourcesReady(staleOpenPrices, {
    analysisAsOfUtc: ANALYSIS_AS_OF,
    marketDataCutoffUtc: MARKET_DATA_CUTOFF,
    marketState: "OPEN",
  }), false);
});

test("snapshot publication never extends the analysis deadline", () => {
  assert.deepEqual(marketContextValidityWindow({
    analysisAsOfUtc: ANALYSIS_AS_OF, marketState: "OPEN", publishedAtUtc: "2026-09-07T15:10:00.000Z",
  }), {
    validFrom: "2026-09-07T15:10:00.000Z",
    validUntil: "2026-09-07T15:30:00.000Z",
  });
  assert.deepEqual(marketContextValidityWindow({
    analysisAsOfUtc: ANALYSIS_AS_OF, marketState: "HOLIDAY", publishedAtUtc: "2026-09-07T15:10:00.000Z",
  }), {
    validFrom: "2026-09-07T15:10:00.000Z",
    validUntil: "2026-09-07T16:00:00.000Z",
  });
  assert.throws(() => marketContextValidityWindow({
    analysisAsOfUtc: ANALYSIS_AS_OF, marketState: "OPEN", publishedAtUtc: "2026-09-07T15:30:00.000Z",
  }), /US_GRAINS_CONTEXT_ANALYSIS_EXPIRED_BEFORE_PUBLICATION/);
  assert.throws(() => marketContextValidityWindow({
    analysisAsOfUtc: ANALYSIS_AS_OF, marketState: "OPEN", publishedAtUtc: "2026-09-07T14:59:59.999Z",
  }), /US_GRAINS_CONTEXT_PUBLICATION_BEFORE_ANALYSIS/);
});

test("agri-event proximity is evaluated at analysis knowledge time, not the old price cutoff", () => {
  const reasons = detectMarketContextEventReasons({
    analysisAsOfUtc: ANALYSIS_AS_OF,
    cutoff: MARKET_DATA_CUTOFF,
    canonicalMarketSession: { marketSession: "CBOT_GRAINS_HOLIDAY" },
    previousSnapshot: null,
    sourceStates: [],
    series: {},
    coveredAgriEvents: [{ importance: "HIGH", event_timestamp_utc: "2026-09-07T15:05:00.000Z" }],
  });
  assert.deepEqual(reasons, ["HIGH_AGRI_EVENT_NEARBY"]);
});

test("closed-market scheduling reads current calendar knowledge and only includes commonly closed bars", async () => {
  const observed = { aggregateCutoffs: new Map(), seriesCutoffs: new Map(), calendarCalls: [], taskPayload: null, dispatchMetadata: null };
  const rowsByFeed = new Map([
    ["prod__tradingview__ZC1!__1", { first: "2026-09-04T18:18:00.000Z", last: "2026-09-04T18:19:00.000Z", marketDate: "2026-09-04" }],
    ["prod__tradingview__ZC1!__5", { first: "2026-09-04T18:10:00.000Z", last: "2026-09-04T18:15:00.000Z", marketDate: "2026-09-04" }],
    ["prod__tradingview__ZW1!__1", { first: "2026-09-04T18:18:00.000Z", last: "2026-09-04T18:19:00.000Z", marketDate: "2026-09-04" }],
    ["prod__tradingview__ZW1!__5", { first: "2026-09-04T18:10:00.000Z", last: "2026-09-04T18:15:00.000Z", marketDate: "2026-09-04" }],
  ]);
  const query = async (sql, params = []) => {
    if (sql.includes("min(timestamp_utc) AS coverage_start")) {
      const feed = rowsByFeed.get(params[0]);
      observed.aggregateCutoffs.set(params[0], params[1]);
      return { rows: [{ coverage_start: new Date(feed.first), coverage_end: new Date(feed.last),
        latest_market_date: feed.marketDate, row_count: 2 }] };
    }
    if (sql.includes("SELECT timestamp_utc, open, high, low, close, volume")) {
      const feed = rowsByFeed.get(params[0]);
      observed.seriesCutoffs.set(params[0], params[1]);
      return { rows: [bar(feed.last, 101), bar(feed.first, 100)] };
    }
    if (sql.includes("SELECT * FROM market_context_task_dispatches")) return { rows: [] };
    if (sql.includes("SELECT dispatch_id, agent_task_id FROM market_context_task_dispatches")) return { rows: [] };
    if (sql.includes("SELECT metadata FROM market_context_task_dispatches")) return { rows: [] };
    if (sql.includes("INSERT INTO agent_tasks")) {
      observed.taskPayload = JSON.parse(params[3]);
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO market_context_task_dispatches")) {
      observed.dispatchMetadata = JSON.parse(params[6]);
      return { rows: [] };
    }
    return { rows: [] };
  };
  const client = { query, release() {} };
  const calendarState = source("market_agri_events", "AGRI_EVENT_CALENDAR", "2026-08-01T00:00:00.000Z", "2026-09-30T00:00:00.000Z");
  const store = {
    persistence: { pool: { query, connect: async () => client } },
    health: async () => ({ data_readiness: {
      market_session: {
        state: "HOLIDAY", active_session: "CBOT_GRAINS_HOLIDAY", timezone: "America/Chicago",
        trading_date: "2026-09-07", last_expected_market_date: "2026-09-04", as_of_utc: ANALYSIS_AS_OF,
        last_expected_core_close_utc_by_timeframe: { "1": MARKET_DATA_CUTOFF, "5": MARKET_DATA_CUTOFF },
      },
      freshness_policy: { max_age_seconds: 96 * 60 * 60 },
    } }),
    marketContext: {
      upsertSourceCoverage: async (input) => ({
        ...input,
        coverageStart: iso(input.coverageStart),
        coverageEnd: iso(input.coverageEnd),
        dataCutoff: iso(input.dataCutoff),
        asOf: iso(input.asOf),
      }),
      current: async () => ({ sourceStates: [calendarState], snapshot: null, brief: null }),
      calendarAt: async (asOfUtc) => {
        observed.calendarCalls.push(asOfUtc);
        return { sourceState: calendarState, events: [] };
      },
    },
  };
  const outcome = await new MarketContextTaskScheduler({ store }).runCycle({ now_utc: ANALYSIS_AS_OF });
  assert.equal(outcome.status, "ENQUEUED");
  assert.deepEqual(observed.calendarCalls, [ANALYSIS_AS_OF]);
  assert.equal(observed.taskPayload.bundle.analysisAsOfUtc, ANALYSIS_AS_OF);
  assert.equal(observed.taskPayload.bundle.marketDataCutoffUtc, MARKET_DATA_CUTOFF);
  assert.equal(observed.taskPayload.bundle.sourceDataCutoff, ANALYSIS_AS_OF);
  assert.equal(observed.taskPayload.bundle.cutoff, ANALYSIS_AS_OF);
  assert.equal(observed.taskPayload.bundle.timeContractVersion, "us_grains_market_context_time_v2");
  assert.equal(observed.dispatchMetadata.event_facts.schemaVersion, "market_context_event_facts_v1");
  assert.equal(observed.dispatchMetadata.event_facts.marketDataCutoffUtc, MARKET_DATA_CUTOFF);
  assert.equal(observed.dispatchMetadata.event_facts.series["ZC:1"].lastBarClosedAt, MARKET_DATA_CUTOFF);
  assert.equal(observed.taskPayload.bundle.series["ZC:1"].lastBarOpenedAt, "2026-09-04T18:19:00.000Z");
  assert.equal(observed.taskPayload.bundle.series["ZC:1"].lastBarClosedAt, MARKET_DATA_CUTOFF);
  assert.equal(observed.taskPayload.bundle.series["ZC:5"].lastBarOpenedAt, "2026-09-04T18:15:00.000Z");
  assert.equal(observed.taskPayload.bundle.series["ZC:5"].lastBarClosedAt, MARKET_DATA_CUTOFF);
  assert.equal(observed.seriesCutoffs.get("prod__tradingview__ZC1!__1"), "2026-09-04T18:19:00.000Z");
  assert.equal(observed.seriesCutoffs.get("prod__tradingview__ZC1!__5"), "2026-09-04T18:15:00.000Z");
  assert.equal(observed.taskPayload.bundle.sourceStates.find((item) => item.sourceId === "ZC_1").reasonCodes[0],
    "CLOSED_BARS_LAST_KNOWN_MARKET_NOT_OPEN");
  assert.equal(observed.aggregateCutoffs.get("prod__tradingview__ZC1!__1"), "2026-09-07T14:59:00.000Z");
  assert.equal(observed.aggregateCutoffs.get("prod__tradingview__ZC1!__5"), "2026-09-07T14:55:00.000Z");

  const health = await store.health();
  health.data_readiness.readiness_scope = { data_policy: "M5_FALLBACK" };
  store.health = async () => health;
  for (const id of ["prod__tradingview__ZC1!__1", "prod__tradingview__ZW1!__1"])
    rowsByFeed.set(id, { first: "2026-09-03T13:30Z", last: "2026-09-03T13:31Z", marketDate: "2026-09-03" });
  await new MarketContextTaskScheduler({ store }).runCycle({ now_utc: ANALYSIS_AS_OF });
  const fallbackBundle = observed.taskPayload.bundle;
  assert.equal(fallbackBundle.marketDataCutoffUtc, MARKET_DATA_CUTOFF);
  assert.equal(fallbackBundle.dataPolicy, "M5_FALLBACK");
  assert.equal(fallbackBundle.sourceStates.find((s) => s.sourceId === "ZC_1").status, "STALE");
  assert.deepEqual(fallbackBundle.sourceStates.find((s) => s.sourceId === "ZC_1").requiredFor, []);
  assert.equal(requiredSourcesReady(fallbackBundle.sourceStates, fallbackBundle), true);
  assert.equal(requiredSourcesReady(fallbackBundle.sourceStates, { ...fallbackBundle, dataPolicy: "M1_M5_STRICT" }), false);
  assert.match(buildPrompt(fallbackBundle, fallbackBundle), /M1 is diagnostic and optional/);
  for (const id of ["ZC_5", "ZW_5", "market_agri_events", "canonical_grains_session"])
    assert.equal(requiredSourcesReady(fallbackBundle.sourceStates.filter((s) => s.sourceId !== id), fallbackBundle), false);
});

function requiredSourceStates() {
  const prices = ["ZC_1", "ZC_5", "ZW_1", "ZW_5"].map((id) =>
    source(id, "OHLCV", "2026-08-01T00:00:00.000Z", MARKET_DATA_CUTOFF));
  return [
    ...prices,
    source("market_agri_events", "AGRI_EVENT_CALENDAR", "2026-08-01T00:00:00.000Z", "2026-09-30T00:00:00.000Z"),
    source("canonical_grains_session", "MARKET_SESSION", "2026-09-07T00:00:00.000Z", ANALYSIS_AS_OF),
  ];
}

function source(sourceId, sourceType, coverageStart, coverageEnd) {
  return { sourceId, sourceType, status: "AVAILABLE", coverageStart, coverageEnd, reasonCodes: [] };
}

function bar(timestamp, close) {
  return { timestamp_utc: new Date(timestamp), open: close - 1, high: close + 1, low: close - 2, close, volume: 10 };
}

function iso(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}
