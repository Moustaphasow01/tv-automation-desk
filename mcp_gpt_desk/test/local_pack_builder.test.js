import assert from "node:assert/strict";
import test from "node:test";
import { FixedClock } from "@tv-automation/desk-time";
import {
  LocalPackBuilder,
  marketRowAvailableAtCutoff,
} from "../src/local-pack-builder.js";

const clock = new FixedClock(Date.parse("2026-07-20T10:00:00.000Z"));

test("LocalPackBuilder seals a V5 pack with canonical M5 derived from exact M1 feeds", async () => {
  const persistence = new FakeLocalPackPersistence();
  const builder = new LocalPackBuilder({ persistence, clock });

  const result = await builder.buildLiveRollingPack({
    date: "2026-07-17",
    session: "asia_open",
    checkpoint_paris: "2026-07-17T22:00:00+02:00",
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "ready");
  assert.equal(result.dataset_count, 20);
  assert.deepEqual(result.missing_datasets, []);
  assert.equal(persistence.objects.length, 20);
  assert.equal(persistence.writes.length, 2);

  const build = persistence.writes.find((write) => write.collection === "desk_pack_builds").data;
  const logical = persistence.writes.find((write) => write.collection === "desk_packs").data;
  assert.equal(build.pack_build_id, result.pack_build_id);
  assert.equal(build.source_manifest_hash, build.manifest.source_manifest_hash);
  assert.equal(build.quality.source, "postgres_local_v5");
  assert.equal(build.quality.freshness_policy_version, "1.2.0");
  assert.equal(build.quality.dataset_freshness.MNQ_M5.status, "fresh");
  assert.equal(build.datasets.MNQ_M5.availability, "fresh");
  assert.equal(logical.active_build_id, build.pack_build_id);
  assert.equal(build.canonical_m5_mode, "derived_from_m1");
  assert.equal(build.canonical_resampler_version, "1.0.0");
  assert.equal(build.datasets.MNQ_M5.source, "canonical_derived_m1");
  assert.equal(build.datasets.MNQ_M5.source_dataset, "MNQ_M1");
  assert.deepEqual(build.datasets.MNQ_M5.source_feed_ids, ["prod__tradingview__MNQ1!__1"]);
  assert.equal(build.datasets.MNQ_M5.complete_buckets > 0, true);
  assert.deepEqual(build.quality.indicator_warmup_incomplete, ["MNQ_M5", "MES_M5"]);
  assert.equal(build.datasets.news_digest.empty_ok, true);
});

test("LocalPackBuilder fails closed when a core SQL dataset is missing", async () => {
  const persistence = new FakeLocalPackPersistence({ missingTimeframe: "1" });
  const builder = new LocalPackBuilder({ persistence, clock });

  await assert.rejects(
    builder.buildLiveRollingPack({
      date: "2026-07-17",
      session: "asia_open",
      checkpoint_paris: "2026-07-17T22:00:00+02:00",
    }),
    (error) => error.code === "LOCAL_PACK_CORE_DATASET_MISSING",
  );
  assert.equal(persistence.objects.length, 0);
  assert.equal(persistence.writes.length, 0);
});

test("LocalPackBuilder treats provider M5 as audit-only when canonical M1 is complete", async () => {
  const persistence = new FakeLocalPackPersistence({ missingTimeframe: "5" });
  const builder = new LocalPackBuilder({ persistence, clock });

  const result = await builder.buildLiveRollingPack({
    date: "2026-07-17",
    session: "asia_open",
    checkpoint_paris: "2026-07-17T22:00:00+02:00",
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider_m5_audit.MNQ_M5.status, "missing");
  const build = persistence.writes.find((write) => write.collection === "desk_pack_builds").data;
  assert.equal(build.datasets.MNQ_M5.source, "canonical_derived_m1");
  assert.equal(build.quality.provider_m5_audit.MNQ_M5.audit_only, true);
});

test("LocalPackBuilder keeps stale NQ/ES M15 confirmations visible without blocking fresh MNQ/MES triggers", async () => {
  const persistence = new FakeLocalPackPersistence({
    rowAgeMinutesByTimeframe: { "15": 30 },
  });
  const builder = new LocalPackBuilder({ persistence, clock });

  const result = await builder.buildLiveRollingPack({
    date: "2026-07-17",
    session: "asia_open",
    checkpoint_paris: "2026-07-17T22:00:00+02:00",
  });

  assert.equal(result.ok, true);
  assert.equal(result.dataset_freshness.MNQ_M5.status, "fresh");
  assert.equal(result.dataset_freshness.MES_M5.status, "fresh");
  assert.equal(result.dataset_freshness.NQ_M15.status, "stale");
  assert.equal(result.dataset_freshness.NQ_M15.required, false);
  assert.equal(result.dataset_freshness.NQ_M15.role, "confirmation");
  assert.equal(result.dataset_freshness.ES_M15.status, "stale");
  assert.deepEqual(result.stale_datasets.filter((dataset) => dataset.endsWith("_M15")), ["NQ_M15", "ES_M15"]);
  const build = persistence.writes.find((write) => write.collection === "desk_pack_builds").data;
  assert.equal(build.quality.status, "degraded_context");
  assert.equal(build.datasets.NQ_M15.availability, "last_known");
  assert.equal(build.datasets.ES_M15.availability, "last_known");
});

test("LocalPackBuilder tolerates missing NQ/ES M15 confirmations when MNQ/MES triggers are available", async () => {
  const persistence = new FakeLocalPackPersistence({ missingTimeframe: "15" });
  const builder = new LocalPackBuilder({ persistence, clock });

  const result = await builder.buildLiveRollingPack({
    date: "2026-07-17",
    session: "asia_open",
    checkpoint_paris: "2026-07-17T22:00:00+02:00",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.missing_datasets.filter((dataset) => dataset.endsWith("_M15")), ["NQ_M15", "ES_M15"]);
  assert.equal(result.dataset_freshness.NQ_M15.required, false);
  assert.equal(result.dataset_freshness.ES_M15.required, false);
});

test("LocalPackBuilder fails closed without orphan objects when required LIVE candles are stale", async () => {
  const persistence = new FakeLocalPackPersistence({ rowAgeMinutes: 30 });
  const builder = new LocalPackBuilder({ persistence, clock });

  await assert.rejects(
    builder.buildLiveRollingPack({
      date: "2026-07-17",
      session: "asia_open",
      checkpoint_paris: "2026-07-17T22:00:00+02:00",
    }),
    (error) => error.code === "LOCAL_PACK_CORE_DATASET_STALE"
      && error.details?.dataset === "MNQ_M1"
      && error.details?.age_minutes === 30,
  );
  assert.equal(persistence.objects.length, 0);
  assert.equal(persistence.writes.length, 0);
});

test("LocalPackBuilder keeps historical replay coverage valid without applying LIVE freshness", async () => {
  const persistence = new FakeLocalPackPersistence({
    rowAgeMinutes: 30,
    completeReplayCoverage: true,
  });
  const builder = new LocalPackBuilder({ persistence, clock });

  const result = await builder.build({
    date: "2026-07-17",
    session: "asia_open",
    purpose: "replay_source",
    cutoffUtc: "2026-07-17T20:00:00.000Z",
    cutoffParis: "2026-07-17T22:00:00+02:00",
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "ready");
  assert.equal(result.dataset_count, 22);
  assert.equal(result.data_profile_id, "v5_replay_canonical_m1_m5");
  assert.equal(result.data_profile_version, "1.1.0");
  assert.equal(result.canonical_coverage_complete, true);
  assert.equal(result.dataset_freshness.MNQ_M1.status, "fresh");
  assert.equal(result.dataset_freshness.MES_M1.status, "fresh");
  assert.equal(result.dataset_freshness.MNQ_M5.status, "fresh");
  assert.equal(result.dataset_freshness.MES_M5.status, "fresh");
  assert.equal(result.dataset_freshness.MNQ_M5.policy, "replay_bounds_and_gaps_v5");
  assert.deepEqual(result.actual_coverage.required_incomplete, []);
  assert.equal(result.actual_coverage.datasets.MNQ_M1.complete, true);
  assert.equal(result.actual_coverage.datasets.MES_M1.complete, true);
  assert.equal(result.actual_coverage.datasets.MNQ_M5.complete, true);
  assert.equal(result.actual_coverage.datasets.MES_M5.complete, true);
  const canonicalM1Query = persistence.queries.find((query) => (
    query.timeframe === "1" && query.symbolCodes[0] === "MNQ1!"
  ));
  assert.equal(canonicalM1Query.fromUtc, result.requested_coverage.context_start_utc);
  const replayBuild = persistence.writes.find((write) => write.collection === "desk_pack_builds").data;
  assert.equal(replayBuild.datasets.MNQ_M5.indicator_warmup_complete, true);
  assert.deepEqual(replayBuild.quality.indicator_warmup_incomplete, []);
  assert.equal(
    result.stale_datasets.some((dataset) => ["MNQ_M1", "MES_M1", "MNQ_M5", "MES_M5"].includes(dataset)),
    false,
  );
  assert.equal(persistence.writes.length, 2);
  const build = persistence.writes.find((write) => write.collection === "desk_pack_builds").data;
  assert.equal(build.data_profile_id, result.data_profile_id);
  assert.equal(build.canonical_coverage_complete, true);
  assert.deepEqual(build.requested_coverage, result.requested_coverage);
  assert.deepEqual(build.actual_coverage, result.actual_coverage);
});

test("LocalPackBuilder seals explicit source evidence into scope, manifest and M1 lineage", async () => {
  const persistence = new FakeLocalPackPersistence({ completeReplayCoverage: true });
  const builder = new LocalPackBuilder({ persistence, clock });
  const sourceEvidence = {
    schema_version: "test_source_evidence_v1",
    evidence_sha256: "evidence-r2",
    import_id: "import-r2",
    manifest_sha256: "manifest-r2",
    capture_proof_sha256: "proof-r2",
    capture_policy_version: "settled_closed_bar_v2",
    files: [
      { dataset: "MNQ_M1", sha256: "mnq-r2" },
      { dataset: "MES_M1", sha256: "mes-r2" },
    ],
  };

  const result = await builder.build({
    date: "2026-07-17",
    session: "asia_open",
    purpose: "replay_source",
    cutoffUtc: "2026-07-17T20:00:00.000Z",
    cutoffParis: "2026-07-17T22:00:00+02:00",
    sourceEvidence,
  });

  const build = persistence.writes.find((write) => write.collection === "desk_pack_builds").data;
  const logical = persistence.writes.find((write) => write.collection === "desk_packs").data;
  assert.deepEqual(result.source_evidence, sourceEvidence);
  assert.deepEqual(build.source_evidence, sourceEvidence);
  assert.deepEqual(build.resolved_scope.source_evidence, sourceEvidence);
  assert.deepEqual(build.manifest.resolved_scope.source_evidence, sourceEvidence);
  assert.deepEqual(logical.source_evidence, sourceEvidence);
  assert.equal(build.datasets.MNQ_M1.source_import_id, sourceEvidence.import_id);
  assert.equal(build.datasets.MNQ_M1.source_import_manifest_sha256, sourceEvidence.manifest_sha256);
  assert.equal(build.datasets.MNQ_M1.source_capture_proof_sha256, sourceEvidence.capture_proof_sha256);
  assert.equal(build.datasets.MNQ_M1.source_capture_policy_version, sourceEvidence.capture_policy_version);
  assert.equal(build.datasets.MNQ_M1.source_file_sha256, "mnq-r2");
  assert.equal(build.datasets.MES_M1.source_file_sha256, "mes-r2");
});

test("LocalPackBuilder fails before object writes when canonical replay coverage has a gap", async () => {
  const persistence = new FakeLocalPackPersistence({
    completeReplayCoverage: true,
    replayGapAtMinute: 240,
  });
  const builder = new LocalPackBuilder({ persistence, clock });

  await assert.rejects(
    builder.build({
      date: "2026-07-17",
      session: "asia_open",
      purpose: "replay_source",
      cutoffUtc: "2026-07-17T20:00:00.000Z",
      cutoffParis: "2026-07-17T22:00:00+02:00",
    }),
    (error) => error.code === "LOCAL_PACK_CORE_COVERAGE_INCOMPLETE"
      && error.details?.actual_coverage?.required_incomplete?.includes("MNQ_M1")
      && error.details?.actual_coverage?.datasets?.MNQ_M1?.gap_count === 1,
  );
  assert.equal(persistence.objects.length, 0);
  assert.equal(persistence.writes.length, 0);
});

test("LocalPackBuilder accepts last-known H1/H4 context when all LIVE trigger feeds are fresh", async () => {
  const persistence = new FakeLocalPackPersistence({
    rowAgeMinutesByTimeframe: { "1H": 180, "4H": 720 },
  });
  const builder = new LocalPackBuilder({ persistence, clock });

  const result = await builder.buildLiveRollingPack({
    date: "2026-07-20",
    session: "asia_open",
    checkpoint_paris: "2026-07-20T00:15:00+02:00",
  });

  assert.equal(result.ok, true);
  assert.equal(result.dataset_freshness.MNQ_M5.status, "fresh");
  assert.equal(result.dataset_freshness.NQ_H1.status, "stale");
  const build = persistence.writes.find((write) => write.collection === "desk_pack_builds").data;
  assert.equal(build.quality.status, "degraded_context");
  assert.equal(build.datasets.NQ_H1.availability, "last_known");
});

test("LocalPackBuilder seals news_digest in chronological order when persistence returns newest first", async () => {
  const persistence = new FakeLocalPackPersistence({
    newsRows: [
      {
        article_id: "news-late",
        title: "Later news",
        published_at_utc: "2026-07-20T09:45:00.000Z",
      },
      {
        article_id: "news-early",
        title: "Earlier news",
        published_at_utc: "2026-07-20T08:30:00.000Z",
      },
      {
        article_id: "news-early-b",
        title: "Earlier news",
        published_at_utc: "2026-07-20T08:30:00.000Z",
      },
    ],
  });
  const builder = new LocalPackBuilder({ persistence, clock });

  const result = await builder.buildLiveRollingPack({
    date: "2026-07-20",
    session: "asia_open",
    checkpoint_paris: "2026-07-20T12:00:00+02:00",
  });

  assert.equal(result.ok, true);
  const newsObject = persistence.objects.find(({ storagePath }) => storagePath.endsWith("/news_digest.json"));
  assert.ok(newsObject);
  const digest = JSON.parse(newsObject.content.toString("utf8"));
  assert.deepEqual(
    digest.items.map(({ article_id }) => article_id),
    ["news-early", "news-early-b", "news-late"],
  );
});


test("LocalPackBuilder uses byte-identical canonical M5 rows for LIVE and Replay", async () => {
  const livePersistence = new FakeLocalPackPersistence({ completeReplayCoverage: true });
  const replayPersistence = new FakeLocalPackPersistence({ completeReplayCoverage: true });
  const liveBuilder = new LocalPackBuilder({ persistence: livePersistence, clock });
  const replayBuilder = new LocalPackBuilder({ persistence: replayPersistence, clock });

  await liveBuilder.buildLiveRollingPack({
    date: "2026-07-17",
    session: "asia_open",
    checkpoint_paris: "2026-07-17T22:00:00+02:00",
  });
  await replayBuilder.build({
    date: "2026-07-17",
    session: "asia_open",
    purpose: "replay_source",
    cutoffUtc: "2026-07-17T20:00:00.000Z",
    cutoffParis: "2026-07-17T22:00:00+02:00",
  });

  const liveM5 = livePersistence.objects.find(({ storagePath }) => storagePath.endsWith("/MNQ_M5.csv"));
  const replayM5 = replayPersistence.objects.find(({ storagePath }) => storagePath.endsWith("/MNQ_M5.csv"));
  assert.ok(liveM5);
  assert.ok(replayM5);
  assert.equal(liveM5.content.toString("utf8"), replayM5.content.toString("utf8"));
});

test("pack builder rejects open-at-cutoff bars on every V5 timeframe", () => {
  const cutoff = "2026-07-20T10:00:00.000Z";
  for (const [timeframe, minutes] of [["1", 1], ["5", 5], ["15", 15], ["1H", 60], ["4H", 240]]) {
    const openAtCutoff = { timestamp_utc: cutoff };
    const closedAtCutoff = {
      timestamp_utc: new Date(Date.parse(cutoff) - minutes * 60_000).toISOString(),
    };
    assert.equal(marketRowAvailableAtCutoff(openAtCutoff, { timeframe }, cutoff), false, timeframe);
    assert.equal(marketRowAvailableAtCutoff(closedAtCutoff, { timeframe }, cutoff), true, timeframe);
  }
  assert.equal(marketRowAvailableAtCutoff({
    timestamp_utc: cutoff,
    bar_close_utc: cutoff,
  }, { timeframe: "5" }, cutoff), true);
});

class FakeLocalPackPersistence {
  constructor({
    missingTimeframe = null,
    rowAgeMinutes = 0,
    rowAgeMinutesByTimeframe = {},
    newsRows = [],
    completeReplayCoverage = false,
    replayGapAtMinute = null,
  } = {}) {
    this.missingTimeframe = missingTimeframe;
    this.rowAgeMinutes = rowAgeMinutes;
    this.rowAgeMinutesByTimeframe = rowAgeMinutesByTimeframe;
    this.newsRows = newsRows;
    this.completeReplayCoverage = completeReplayCoverage;
    this.replayGapAtMinute = replayGapAtMinute;
    this.objects = [];
    this.writes = [];
    this.queries = [];
  }

  async queryMarketCandles({ symbolCodes, feedIds = [], timeframe, fromUtc, toUtc }) {
    this.queries.push({ symbolCodes, feedIds, timeframe, fromUtc, toUtc });
    if (timeframe === this.missingTimeframe) return [];
    if (this.completeReplayCoverage
      && ["MNQ1!", "MES1!"].includes(symbolCodes[0])
      && ["1", "5"].includes(timeframe)) {
      return replayCoverageRows({
        symbolCode: symbolCodes[0],
        feedId: feedIds[0] || feedIdFor(symbolCodes[0], timeframe),
        timeframe,
        toUtc,
        gapAtMinute: timeframe === "1" && symbolCodes[0] === "MNQ1!" ? this.replayGapAtMinute : null,
      });
    }
    const rowAgeMinutes = this.rowAgeMinutesByTimeframe[timeframe] ?? this.rowAgeMinutes;
    const intervalMinutes = timeframeMinutes(timeframe);
    const closeMs = Date.parse(toUtc) - rowAgeMinutes * 60_000;
    if (timeframe === "1") {
      return Array.from({ length: 5 }, (_, index) => marketRow({
        symbolCode: symbolCodes[0],
        feedId: feedIds[0] || feedIdFor(symbolCodes[0], timeframe),
        timeframe,
        timestampMs: closeMs - (5 - index) * 60_000,
      }));
    }
    return [marketRow({
      symbolCode: symbolCodes[0],
      feedId: feedIds[0] || feedIdFor(symbolCodes[0], timeframe),
      timeframe,
      timestampMs: closeMs - intervalMinutes * 60_000,
    })];
  }

  async queryCollectionDocuments() {
    return [{
      event_id: "macro-1",
      date: "2026-07-17",
      event: "Test event",
      timestamp_paris: "2026-07-17T14:30:00+02:00",
      importance: "high",
    }];
  }

  async queryNewsArticles() {
    return this.newsRows;
  }

  async writeStorageObject(storagePath, content, options) {
    this.objects.push({ storagePath, content: Buffer.from(content), options });
    return { storage_path: storagePath, generation: options.generation };
  }

  async writeDocuments(writes) {
    this.writes.push(...writes);
    return { ok: true, write_count: writes.length };
  }
}

function replayCoverageRows({ symbolCode, feedId, timeframe, toUtc, gapAtMinute = null }) {
  const intervalMinutes = Number(timeframe);
  const endMs = Date.parse(toUtc);
  const executionStartMs = endMs - 22 * 60 * 60_000;
  const startMs = timeframe === "1"
    ? executionStartMs
    : executionStartMs + 15 * 60_000;
  const rows = [];
  for (
    let timestampMs = startMs;
    timestampMs + intervalMinutes * 60_000 <= endMs;
    timestampMs += intervalMinutes * 60_000
  ) {
    const minuteOffset = Math.round((timestampMs - executionStartMs) / 60_000);
    if (gapAtMinute !== null && minuteOffset === gapAtMinute) continue;
    rows.push({
      feed_id: feedId,
      symbol_code: symbolCode,
      timeframe,
      timestamp_utc: new Date(timestampMs).toISOString(),
      bar_close_utc: new Date(timestampMs + intervalMinutes * 60_000).toISOString(),
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volume: 10,
      indicators: { rsi_14: 52, atr_14: 3 },
      is_closed: true,
    });
  }
  return rows;
}

function marketRow({ symbolCode, feedId, timeframe, timestampMs }) {
  const intervalMinutes = timeframeMinutes(timeframe);
  return {
    feed_id: feedId,
    symbol_code: symbolCode,
    timeframe,
    timestamp_utc: new Date(timestampMs).toISOString(),
    bar_close_utc: new Date(timestampMs + intervalMinutes * 60_000).toISOString(),
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    volume: 10,
    indicators: { rsi_14: 52, atr_14: 3 },
    is_closed: true,
  };
}

function feedIdFor(symbol, timeframe) {
  return `prod__tradingview__${symbol}__${timeframe}`;
}

function timeframeMinutes(timeframe) {
  return ({ "1": 1, "5": 5, "15": 15, "1H": 60, "4H": 240 })[timeframe] || 5;
}
