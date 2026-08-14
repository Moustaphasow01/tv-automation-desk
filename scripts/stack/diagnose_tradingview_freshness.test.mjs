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
    assert.ok(diagnosis.actions.some((action) => action.command === "python3 scripts/tradingview/migrate_local_alert_webhooks.py"));
    assert.ok(diagnosis.actions.some((action) => action.id === "tradingview_mcp_rescue"));
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
