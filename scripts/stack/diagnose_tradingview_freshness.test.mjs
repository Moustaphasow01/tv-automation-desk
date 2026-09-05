import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTradingViewFreshnessDiagnosis,
  formatTradingViewFreshnessDiagnosis,
  parseTradingViewFreshnessArgs,
} from "./diagnose_tradingview_freshness.mjs";

describe("TradingView freshness doctor", () => {
  it("passes when all core MNQ/MES M1/M5 feeds are fresh", () => {
    const diagnosis = buildTradingViewFreshnessDiagnosis(readyReadiness(), {
      checkedAtUtc: "2026-08-12T10:10:00.000Z",
    });

    assert.equal(diagnosis.ok, true);
    assert.equal(diagnosis.status, "READY");
    assert.deepEqual(diagnosis.blockers, []);
  });

  it("detects a missing mandatory core feed", () => {
    const readiness = readyReadiness();
    readiness.ok = false;
    readiness.core_feeds = readiness.core_feeds.filter((feed) => !(feed.instrument === "MES" && feed.timeframe === "5"));

    const diagnosis = buildTradingViewFreshnessDiagnosis(readiness, {
      checkedAtUtc: "2026-08-12T10:10:00.000Z",
    });

    assert.equal(diagnosis.ok, false);
    assert.equal(diagnosis.status, "MISSING_FEEDS");
    assert.ok(diagnosis.blockers.some((blocker) => blocker.code === "feed.MES.5.missing"));
  });

  it("detects stale feeds and exposes the MCP rescue as diagnostic only", () => {
    const readiness = readyReadiness();
    readiness.ok = false;
    readiness.state = "stale";
    readiness.core_age_seconds = 1200;

    const diagnosis = buildTradingViewFreshnessDiagnosis(readiness, {
      checkedAtUtc: "2026-08-12T10:25:00.000Z",
    });

    assert.equal(diagnosis.status, "STALE_FEEDS");
    assert.ok(diagnosis.blockers.some((blocker) => blocker.code === "feed.MNQ.1.stale"));
    assert.ok(diagnosis.actions.some((action) => action.id === "tradingview_alerts_durable"));
    assert.ok(diagnosis.actions.some((action) => action.id === "tradingview_mcp_rescue"));
    assert.equal(diagnosis.actions.some((action) => action.command), false);
    assert.match(diagnosis.durable_source_note, /source durable/);
  });

  it("blocks when a feed belongs to a different market date", () => {
    const readiness = readyReadiness();
    readiness.ok = false;
    readiness.core_feeds[0].latest_market_date = "2026-08-11";

    const diagnosis = buildTradingViewFreshnessDiagnosis(readiness, {
      checkedAtUtc: "2026-08-12T10:10:00.000Z",
    });

    assert.equal(diagnosis.ok, false);
    assert.ok(diagnosis.blockers.some((blocker) => blocker.code === "feed.MNQ.1.market_date_mismatch"));
  });

  it("blocks fresh prices when the latest source is only the MCP rescue", () => {
    const readiness = readyReadiness();
    readiness.source_health.durable = false;
    readiness.source_health.durable_count = 0;
    readiness.source_health.non_durable_feeds = readiness.core_feeds.map((feed) => ({
      instrument: feed.instrument,
      timeframe: feed.timeframe,
      classification: "rescue",
      source: "tradingview_desktop_recent_ohlcv_rescue",
      source_service: "local_tradingview_webhook",
      received_at_utc: "2026-08-12T10:05:10.000Z",
      alert_id: null,
    }));
    for (const feed of readiness.core_feeds) {
      feed.latest_source = "tradingview_desktop_recent_ohlcv_rescue";
      feed.provenance = {
        classification: "rescue",
        durable: false,
        source: "tradingview_desktop_recent_ohlcv_rescue",
        source_service: "local_tradingview_webhook",
        received_at_utc: "2026-08-12T10:05:10.000Z",
        alert_id: null,
      };
    }

    const diagnosis = buildTradingViewFreshnessDiagnosis(readiness, {
      checkedAtUtc: "2026-08-12T10:10:00.000Z",
    });

    assert.equal(diagnosis.ok, false);
    assert.equal(diagnosis.status, "SOURCE_NOT_DURABLE");
    assert.ok(diagnosis.blockers.some((blocker) => blocker.code === "feed.MNQ.1.source_not_durable"));
  });

  it("uses backend closed-candle age instead of recomputing age from the open timestamp", () => {
    const readiness = readyReadiness();
    readiness.core_feeds[0].latest_timestamp_utc = "2026-08-12T10:09:00.000Z";
    readiness.core_feeds[0].latest_closed_candle_at_utc = "2026-08-12T10:05:00.000Z";
    readiness.core_feeds[0].closed_candle_age_seconds = 300;

    const diagnosis = buildTradingViewFreshnessDiagnosis(readiness, {
      checkedAtUtc: "2026-08-12T10:10:00.000Z",
    });

    assert.equal(diagnosis.feed_statuses[0].status, "fresh");
    assert.equal(diagnosis.feed_statuses[0].age_seconds, 300);
    assert.equal(diagnosis.feed_statuses[0].age_source, "backend_closed_candle");
  });

  it("never labels a future close as fresh", () => {
    const readiness = readyReadiness();
    readiness.ok = false;
    readiness.core_feeds[0].latest_closed_candle_at_utc = "2026-08-12T10:11:00.000Z";
    readiness.core_feeds[0].closed_candle_age_seconds = 0;

    const diagnosis = buildTradingViewFreshnessDiagnosis(readiness, {
      checkedAtUtc: "2026-08-12T10:10:00.000Z",
    });

    assert.notEqual(diagnosis.feed_statuses[0].status, "fresh");
    assert.ok(diagnosis.blockers.some((blocker) => blocker.code === "feed.MNQ.1.future_closed_candle"));
  });

  it("reports normal market closure from last-known durable feeds without rescue actions", () => {
    const readiness = readyReadiness();
    readiness.ok = false;
    readiness.state = "stale_market_closed";
    readiness.market_closed = true;
    readiness.core_feeds.forEach((feed) => {
      feed.latest_timestamp_utc = "2026-08-08T20:00:00.000Z";
      feed.latest_closed_candle_at_utc = "2026-08-08T20:05:00.000Z";
      feed.closed_candle_age_seconds = 200_000;
    });

    const diagnosis = buildTradingViewFreshnessDiagnosis(readiness, {
      checkedAtUtc: "2026-08-10T10:10:00.000Z",
    });

    assert.equal(diagnosis.status, "MARKET_CLOSED_LAST_KNOWN");
    assert.deepEqual(diagnosis.actions, []);
    assert.equal(diagnosis.blockers.length, 0);
  });

  it("keeps a missing feed explicit during a market closure", () => {
    const readiness = readyReadiness();
    readiness.ok = false;
    readiness.market_closed = true;
    readiness.core_feeds = readiness.core_feeds.filter((feed) => !(feed.instrument === "ZW" && feed.timeframe === "5"));
    readiness.readiness_scope = { instruments: ["ZC", "ZW"], timeframes: ["1", "5"] };

    const diagnosis = buildTradingViewFreshnessDiagnosis(readiness, {
      checkedAtUtc: "2026-08-10T10:10:00.000Z",
    });

    assert.equal(diagnosis.status, "MISSING_FEEDS");
    assert.ok(diagnosis.blockers.some((blocker) => blocker.code === "feed.ZW.5.missing"));
  });


  it("formats a compact operator report", () => {
    const readiness = readyReadiness();
    readiness.ok = false;
    readiness.core_feeds = [];

    const output = formatTradingViewFreshnessDiagnosis(buildTradingViewFreshnessDiagnosis(readiness, {
      checkedAtUtc: "2026-08-12T10:10:00.000Z",
    }));

    assert.match(output, /TradingView freshness doctor: MISSING_FEEDS/);
    assert.match(output, /MNQ M1/);
    assert.match(output, /Actions opérateur/);
  });

  it("prints provenance-aware timing evidence when the backend supplies it", () => {
    const readiness = readyReadiness();
    readiness.core_feeds[0].ingestion_timing = {
      provenance: "current_event_linked",
      close_to_received: { seconds: 600, status: "observed" },
      received_to_persisted: { seconds: 2, status: "observed" },
    };

    const output = formatTradingViewFreshnessDiagnosis(buildTradingViewFreshnessDiagnosis(readiness, {
      checkedAtUtc: "2026-08-12T10:10:00.000Z",
    }));

    assert.match(output, /current_event_linked/);
    assert.match(output, /close→receipt=600s \(observed\)/);
    assert.match(output, /receipt→first_db_event=2s \(observed\)/);
  });

  it("parses CLI flags", () => {
    assert.deepEqual(parseTradingViewFreshnessArgs([
      "--json",
      "--exit-zero",
      "--status-url=http://desk/status",
    ]), {
      statusUrl: "http://desk/status",
      output: "json",
      exitZero: true,
    });
  });
});

function readyReadiness() {
  return {
    ok: true,
    state: "ready",
    market_closed: false,
    market_session: { timestamp_paris: "2026-08-12T12:10:00.000+02:00" },
    freshness_policy: { max_age_seconds: 900 },
    core_age_seconds: 300,
    requested_trading_date: "2026-08-12",
    effective_market_date: "2026-08-12",
    core_feeds: [
      durableFeed("MNQ", "1", "2026-08-12T10:05:00.000Z"),
      durableFeed("MNQ", "5", "2026-08-12T10:00:00.000Z"),
      durableFeed("MES", "1", "2026-08-12T10:05:00.000Z"),
      durableFeed("MES", "5", "2026-08-12T10:00:00.000Z"),
    ],
    source_health: { required: true, durable: true, durable_count: 4, total_count: 4, non_durable_feeds: [] },
  };
}

function durableFeed(instrument, timeframe, latest) {
  return {
    instrument,
    timeframe,
    feed_id: `prod__tradingview__${instrument}1!__${timeframe}`,
    provider: "tradingview",
    source_service: "local_tradingview_webhook",
    latest_timestamp_utc: latest,
    latest_market_date: "2026-08-12",
    latest_received_at_utc: "2026-08-12T10:05:10.000Z",
    latest_source: "tradingview_alert_webhook",
    latest_alert_id: `${instrument}-${timeframe}-alert`,
    provenance: {
      classification: "durable_alert",
      durable: true,
      source: "tradingview_alert_webhook",
      source_service: "local_tradingview_webhook",
      received_at_utc: "2026-08-12T10:05:10.000Z",
      alert_id: `${instrument}-${timeframe}-alert`,
    },
  };
}
