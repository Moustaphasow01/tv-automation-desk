import assert from "node:assert/strict";
import test from "node:test";
import { FixedClock } from "@tv-automation/desk-time";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import {
  classifyNews,
  isEditorialNewsQuality,
  NewsIngestionService,
  normalizeGdeltArticles,
} from "../src/news-ingestion-service.js";
import { InMemoryDeskPersistence } from "./support/in-memory-desk-persistence.js";

const COLLECTIONS = {
  ...DESK_COLLECTIONS,
  newsArticles: DESK_COLLECTIONS.newsArticles || "news_articles",
};
const nowUtc = "2026-07-26T10:00:00.000Z";
const clock = new FixedClock(Date.parse(nowUtc));

test("GDELT normalization keeps relevant desk news and deduplicates tracking URLs", () => {
  const articles = normalizeGdeltArticles([
    {
      url: "https://example.com/nasdaq-futures?utm_source=test",
      title: "Nasdaq futures rise as Nvidia gains",
      seendate: "20260726T093000Z",
      domain: "example.com",
      language: "English",
      sourcecountry: "United States",
    },
    {
      url: "https://example.com/nasdaq-futures",
      title: "Nasdaq futures rise as Nvidia gains",
      seendate: "20260726T093000Z",
      domain: "example.com",
    },
    {
      url: "https://example.com/sports",
      title: "Local football result",
      seendate: "20260726T093500Z",
      domain: "example.com",
    },
  ], { firstSeenAtUtc: nowUtc });

  assert.equal(articles.length, 1);
  assert.equal(articles[0].url, "https://example.com/nasdaq-futures");
  assert.deepEqual(articles[0].instruments, ["MNQ"]);
  assert.ok(articles[0].assets.includes("NVDA"));
  assert.ok(articles[0].topics.includes("NASDAQ"));
});

test("news classifier maps macro, rates, cross-asset and mega caps deterministically", () => {
  const classified = classifyNews("Federal Reserve signals on Treasury yields as Nvidia and crude oil prices move");
  assert.deepEqual(classified.topics, ["FED_MONETARY_POLICY", "US_RATES", "ENERGY", "MEGACAPS"]);
  assert.equal(classified.importance, "HIGH");
  for (const asset of ["DXY", "US10Y", "MCL", "NVDA"]) assert.ok(classified.assets.includes(asset));
  for (const instrument of ["MNQ", "MES", "MCL"]) assert.ok(classified.instruments.includes(instrument));
});

test("editorial quality rejects classifieds and generated comparison noise", () => {
  assert.equal(isEditorialNewsQuality(
    "For Sale ( 30 Pieces ) New Apple iPhone 17 Original 256GB",
    "dhal3.com",
  ), false);
  assert.equal(isEditorialNewsQuality(
    "Clarivate vs Grid Dynamics Head to Head Analysis",
    "tickerreport.com",
  ), false);
  assert.equal(isEditorialNewsQuality(
    "Head - To - Head Comparison : China SXT Pharmaceuticals vs PMV Pharmaceuticals",
    "tickerreport.com",
  ), false);
  assert.equal(isEditorialNewsQuality(
    "Analyzing Valley National Bancorp & Southern Michigan Bancorp",
    "tickerreport.com",
  ), false);
  assert.equal(isEditorialNewsQuality(
    "Federal Reserve expected to hold rates steady as inflation swirls",
    "example.com",
  ), true);

  const articles = normalizeGdeltArticles([
    {
      url: "https://dhal3.com/classified",
      title: "For Sale ( 30 Pieces ) New Apple iPhone 17 Original 256GB",
      seendate: "20260726T093000Z",
      domain: "dhal3.com",
    },
    {
      url: "https://example.com/fed-outlook",
      title: "Federal Reserve expected to hold rates steady as inflation swirls",
      seendate: "20260726T093000Z",
      domain: "example.com",
    },
  ], { firstSeenAtUtc: nowUtc });
  assert.equal(articles.length, 1);
  assert.match(articles[0].title, /Federal Reserve/);
});

test("autonomous news refresh is idempotent and enforces a 48-hour cutoff window", async () => {
  const persistence = new InMemoryDeskPersistence();
  const payload = {
    articles: [{
      url: "https://example.com/fed-markets",
      title: "Federal Reserve outlook lifts S&P 500 futures",
      seendate: "20260726T093000Z",
      domain: "example.com",
      language: "English",
      sourcecountry: "United States",
    }],
  };
  const service = new NewsIngestionService({
    persistence,
    clock,
    fetchImpl: async () => ({ ok: true, json: async () => payload }),
  });

  const first = await service.refresh({ requested_by: "test", force: true });
  assert.equal(first.status, "READY");
  assert.equal(first.inserted_count, 1);
  assert.equal(persistence.count(COLLECTIONS.newsArticles), 1);

  const second = await service.refresh({ requested_by: "test", force: true });
  assert.equal(second.inserted_count, 0);
  assert.equal(second.updated_count, 1);
  assert.equal(persistence.count(COLLECTIONS.newsArticles), 1);

  const visible = await service.getWindow({ as_of_utc: nowUtc, before_hours: 48 });
  assert.equal(visible.status, "ready");
  assert.equal(visible.items.length, 1);
  assert.equal(visible.items[0].published_at_utc, "2026-07-26T09:30:00.000Z");
  assert.match(visible.digest, /1 news éditoriale réelle/);

  const beforePublication = await service.getWindow({
    as_of_utc: "2026-07-26T09:00:00.000Z",
    before_hours: 48,
  });
  assert.equal(beforePublication.items.length, 0);
});

test("news provider failures are observable and never fabricate articles", async () => {
  const persistence = new InMemoryDeskPersistence();
  const service = new NewsIngestionService({
    persistence,
    clock,
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });

  const result = await service.refresh({ force: true });
  assert.equal(result.status, "FETCH_FAILED");
  assert.equal(persistence.count(COLLECTIONS.newsArticles), 0);
  const alert = persistence.peek(COLLECTIONS.deskAlerts, "news_ingestion__gdelt_market_news");
  assert.equal(alert.status, "OPEN");
  assert.equal(alert.severity, "CRITICAL");
});

test("news provider circuit opens after a failure and avoids hammering GDELT", async () => {
  const persistence = new InMemoryDeskPersistence();
  let calls = 0;
  const service = new NewsIngestionService({
    persistence,
    clock,
    failureBackoffMs: 15 * 60_000,
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: false,
        status: 429,
        headers: { get: () => "1200" },
        json: async () => ({}),
      };
    },
  });

  const failed = await service.refresh();
  assert.equal(failed.status, "FETCH_FAILED");
  assert.equal(failed.circuit_state, "open");
  assert.equal(calls, 1);

  const cooledDown = await service.refresh();
  assert.equal(cooledDown.status, "FETCH_FAILED");
  assert.equal(cooledDown.reused_existing_fetch, true);
  assert.equal(cooledDown.circuit_state, "open");
  assert.equal(calls, 1);
});
