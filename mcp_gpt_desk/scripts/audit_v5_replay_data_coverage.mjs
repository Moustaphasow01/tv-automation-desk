#!/usr/bin/env node
import {
  auditDerivedM5AgainstProvider,
  CANONICAL_M1_TO_M5_VERSION,
  CANONICAL_M5_MODE,
  deriveCanonicalM5FromClosedM1,
} from "../src/canonical-market-resampler.js";
import { marketRowAvailableAtCutoff } from "../src/local-pack-builder.js";
import {
  V5_REPLAY_DATA_PROFILE,
  buildV5ReplayRequestedCoverage,
  datasetQueryStartUtc,
  evaluateV5ReplayDatasetCoverage,
  summarizeV5ReplayCoverage,
} from "../src/v5-replay-data-profile.js";

const { createDeskStoreFromEnv } = await import(
  process.env.DESK_STORE_MODULE_URL || "../src/store.js"
);

const tradingDate = String(process.argv[2] || "2026-06-11");
const cutoffParis = String(process.argv[3] || `${tradingDate}T22:00:00+02:00`);
const cutoffUtc = new Date(cutoffParis).toISOString();
const requestedCoverage = buildV5ReplayRequestedCoverage({
  tradingDate,
  cutoffUtc,
  cutoffParis,
});

const store = createDeskStoreFromEnv();
try {
  await store.persistence.initialized;
  const coverage = [];
  const sourceRowsByDataset = new Map();
  const specsByDataset = new Map(V5_REPLAY_DATA_PROFILE.datasets.map((spec) => [spec.dataset, spec]));
  const providerM5Audit = {};

  for (const spec of V5_REPLAY_DATA_PROFILE.datasets.filter((item) => item.sourceMode !== "derived")) {
    const queriedRows = await store.persistence.queryMarketCandles({
      symbolCodes: spec.symbols,
      feedIds: spec.feedIds || [],
      timeframe: spec.timeframe,
      fromUtc: datasetQueryStartUtc(spec, requestedCoverage),
      toUtc: cutoffUtc,
      closedOnly: true,
      limit: 250_000,
    });
    const rows = queriedRows.filter((row) => marketRowAvailableAtCutoff(row, spec, cutoffUtc));
    sourceRowsByDataset.set(spec.dataset, rows);
    coverage.push(coverageEntry(spec, rows));
  }

  for (const spec of V5_REPLAY_DATA_PROFILE.datasets.filter((item) => item.sourceMode === "derived")) {
    const sourceSpec = specsByDataset.get(spec.sourceDataset);
    const derivation = deriveCanonicalM5FromClosedM1(sourceRowsByDataset.get(spec.sourceDataset) || [], {
      cutoffUtc,
      expectedFeedId: sourceSpec?.feedIds?.[0],
      expectedSymbol: sourceSpec?.symbols?.[0],
      requestedSymbol: spec.symbols[0],
      asset: spec.dataset.split("_")[0],
    });
    coverage.push({
      ...coverageEntry(spec, derivation.rows),
      lineage: derivation.lineage,
    });
    const providerRows = await store.persistence.queryMarketCandles({
      symbolCodes: spec.symbols,
      feedIds: spec.providerAuditFeedIds || [],
      timeframe: spec.timeframe,
      fromUtc: datasetQueryStartUtc(spec, requestedCoverage),
      toUtc: cutoffUtc,
      closedOnly: true,
      limit: 250_000,
    }).catch(() => []);
    providerM5Audit[spec.dataset] = auditDerivedM5AgainstProvider(derivation.rows, providerRows, {
      expectedFeedId: spec.providerAuditFeedIds?.[0] || null,
    });
  }

  const coverageSummary = summarizeV5ReplayCoverage(coverage);
  const preparations = await store.persistence.listDocuments("desk_replay_preparation_jobs", 5_000);
  const relevantPreparations = preparations
    .filter((job) => job.trading_date === tradingDate)
    .map((job) => ({
      preparation_id: job.preparation_id,
      status: job.status,
      error: job.error || null,
      pack_id: job.pack_id || null,
      pack_build_id: job.pack_build_id || null,
      attempts: job.attempts || 0,
      data_profile_id: job.data_profile_id || null,
      data_profile_version: job.data_profile_version || null,
      canonical_coverage_complete: job.canonical_coverage_complete === true,
      requested_coverage: job.requested_coverage || null,
      actual_coverage: job.actual_coverage || null,
    }));
  process.stdout.write(`${JSON.stringify({
    ok: true,
    trading_date: tradingDate,
    cutoff_paris: cutoffParis,
    cutoff_utc: cutoffUtc,
    data_profile_id: coverageSummary.profile_id,
    data_profile_version: coverageSummary.profile_version,
    canonical_m5_mode: CANONICAL_M5_MODE,
    canonical_resampler_version: CANONICAL_M1_TO_M5_VERSION,
    canonical_coverage_complete: coverageSummary.canonical_coverage_complete,
    requested_coverage: requestedCoverage,
    required_missing: coverageSummary.required_missing,
    required_incomplete: coverageSummary.required_incomplete,
    optional_missing: coverageSummary.context_missing,
    optional_incomplete: coverageSummary.context_incomplete,
    coverage_summary: coverageSummary,
    coverage,
    provider_m5_audit: providerM5Audit,
    preparations: relevantPreparations,
  }, null, 2)}\n`);

  function coverageEntry(spec, rows) {
    return {
      ...evaluateV5ReplayDatasetCoverage({ spec, rows, requestedCoverage }),
      symbols: spec.symbols,
      feed_ids: spec.feedIds || [],
      source_mode: spec.sourceMode || "provider",
      output_timeframe: spec.outputTimeframe,
      count: rows.length,
      present: rows.length > 0,
    };
  }
} finally {
  await store.persistence.close?.();
}
