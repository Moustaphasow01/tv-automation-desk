import { canonicalSha256 } from "@tv-automation/desk-domain";
import { SystemClock, toParisIso } from "@tv-automation/desk-time";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import {
  buildDatasetManifestEntry,
  buildPackBuildId,
  buildSourceManifest,
  immutableDatasetObjectName,
} from "./pack-integrity.js";
import {
  auditDerivedM5AgainstProvider,
  CANONICAL_M1_TO_M5_VERSION,
  CANONICAL_M5_MODE,
  deriveCanonicalM5FromClosedM1,
} from "./canonical-market-resampler.js";
import {
  V5_REPLAY_DATA_PROFILE,
  buildV5ReplayRequestedCoverage,
  datasetQueryStartUtc,
  evaluateV5ReplayDatasetCoverage,
  summarizeV5ReplayCoverage,
  timeframeDurationMinutes,
} from "./v5-replay-data-profile.js";

const PRICE_COLUMNS = Object.freeze([
  "asset",
  "requested_symbol",
  "chart_symbol",
  "timeframe",
  "timestamp_utc",
  "bar_close_utc",
  "timestamp_paris",
  "open",
  "high",
  "low",
  "close",
  "volume",
  "rsi_14",
  "atr_14",
]);

export class LocalPackBuilder {
  constructor({ persistence, clock = new SystemClock() } = {}) {
    if (!persistence) throw new Error("document_persistence_required");
    this.persistence = persistence;
    this.clock = clock;
  }

  async buildLiveRollingPack({ date, session, checkpoint_paris }) {
    return this.build({
      date,
      session,
      purpose: "live_rolling",
      cutoffUtc: new Date(checkpoint_paris).toISOString(),
      cutoffParis: checkpoint_paris,
    });
  }

  async build({
    date,
    session,
    purpose = "replay_source",
    cutoffUtc,
    cutoffParis = null,
    packId = null,
    requestedStartUtc = null,
    requestedStartParis = null,
    sourceEvidence = null,
  } = {}) {
    assertBuildInput({ date, session, cutoffUtc });
    if (typeof this.persistence.queryMarketCandles !== "function"
      || typeof this.persistence.writeStorageObject !== "function") {
      throw new Error("LOCAL_PACK_PERSISTENCE_CAPABILITIES_REQUIRED");
    }
    const tick = this.clock.now();
    const resolvedPackId = packId || `${date}_${session}${purpose === "replay_source" ? "_replay_source" : ""}`;
    const packBuildId = buildPackBuildId(resolvedPackId);
    const resolvedCutoffUtc = new Date(cutoffUtc).toISOString();
    const resolvedCutoffParis = cutoffParis || toParisIso(Date.parse(resolvedCutoffUtc));
    const fromUtc = new Date(Date.parse(resolvedCutoffUtc) - 5 * 24 * 60 * 60 * 1000).toISOString();
    const replayRequestedCoverage = purpose === "replay_source"
      ? buildV5ReplayRequestedCoverage({
        tradingDate: date,
        cutoffUtc: resolvedCutoffUtc,
        cutoffParis: resolvedCutoffParis,
        requestedStartUtc,
        requestedStartParis,
      })
      : null;
    const normalizedSourceEvidence = normalizeSourceEvidence(sourceEvidence);
    const datasets = {};
    const missingDatasets = [];
    const staleDatasets = [];
    const preparedPriceDatasets = [];
    const datasetFreshness = {};
    const replayCoverageEntries = [];
    const sourceRowsByDataset = new Map();
    const providerM5Audit = {};
    const specsByDataset = new Map(V5_REPLAY_DATA_PROFILE.datasets.map((spec) => [spec.dataset, spec]));

    // First pass: acquire provider datasets, including the exact closed MNQ/MES M1
    // feeds that are shared by LIVE execution and replay preparation.
    for (const spec of V5_REPLAY_DATA_PROFILE.datasets.filter((item) => item.sourceMode !== "derived")) {
      const datasetFromUtc = replayRequestedCoverage
        ? datasetQueryStartUtc(spec, replayRequestedCoverage)
        : fromUtc;
      const queriedRows = await this.persistence.queryMarketCandles({
        symbolCodes: spec.symbols,
        feedIds: spec.feedIds || [],
        timeframe: spec.timeframe,
        fromUtc: datasetFromUtc,
        toUtc: resolvedCutoffUtc,
        closedOnly: true,
        limit: 250_000,
      });
      const rows = queriedRows.filter((row) => marketRowAvailableAtCutoff(row, spec, resolvedCutoffUtc));
      sourceRowsByDataset.set(spec.dataset, rows);
      const replayCoverage = replayRequestedCoverage
        ? evaluateV5ReplayDatasetCoverage({ spec, rows, requestedCoverage: replayRequestedCoverage })
        : null;
      if (replayCoverage) replayCoverageEntries.push(replayCoverage);
      if (!rows.length) {
        missingDatasets.push(spec.dataset);
        datasetFreshness[spec.dataset] = replayCoverage
          ? replayCoverageFreshness(spec, replayCoverage, resolvedCutoffUtc)
          : missingFreshness(spec);
        if (spec.required && purpose !== "replay_source") {
          throw localPackError("LOCAL_PACK_CORE_DATASET_MISSING", `Required SQL dataset is empty: ${spec.dataset}.`, {
            dataset: spec.dataset,
            from_utc: datasetFromUtc,
            cutoff_utc: resolvedCutoffUtc,
          });
        }
        continue;
      }
      const normalizedRows = rows.map((row) => normalizePriceRow(row, spec));
      const freshness = replayCoverage
        ? replayCoverageFreshness(spec, replayCoverage, resolvedCutoffUtc)
        : evaluateDatasetFreshness(spec, normalizedRows, resolvedCutoffUtc, purpose);
      datasetFreshness[spec.dataset] = freshness;
      if (freshness.status !== "fresh") {
        staleDatasets.push(spec.dataset);
        if (spec.required && ["execution", "trigger"].includes(spec.freshnessRole) && purpose === "live_rolling") {
          throw localPackError("LOCAL_PACK_CORE_DATASET_STALE", `Required LIVE SQL dataset is stale: ${spec.dataset}.`, {
            dataset: spec.dataset,
            cutoff_utc: resolvedCutoffUtc,
            ...freshness,
          });
        }
      }
      // LIVE consumes M1 directly from PostgreSQL; replay seals the M1 tape.
      if (purpose === "replay_source" || spec.freshnessRole !== "execution") {
        preparedPriceDatasets.push({
          spec,
          normalizedRows,
          freshness,
          source: "postgres_market_candles",
          lineage: {
            ...(spec.feedIds?.length ? { canonical_feed_ids: [...spec.feedIds] } : {}),
            ...sourceEvidenceLineage(normalizedSourceEvidence, spec.dataset),
          },
        });
      }
    }

    // Second pass: create canonical M5 exclusively from the exact closed M1 feed.
    for (const spec of V5_REPLAY_DATA_PROFILE.datasets.filter((item) => item.sourceMode === "derived")) {
      const sourceSpec = specsByDataset.get(spec.sourceDataset);
      const sourceRows = sourceRowsByDataset.get(spec.sourceDataset) || [];
      const derivation = deriveCanonicalM5FromClosedM1(sourceRows, {
        cutoffUtc: resolvedCutoffUtc,
        expectedFeedId: sourceSpec?.feedIds?.[0],
        expectedSymbol: sourceSpec?.symbols?.[0],
        requestedSymbol: spec.symbols[0],
        asset: spec.dataset.split("_")[0],
      });
      const normalizedRows = derivation.rows;
      const datasetFromUtc = replayRequestedCoverage
        ? datasetQueryStartUtc(spec, replayRequestedCoverage)
        : fromUtc;
      const providerRows = await this.persistence.queryMarketCandles({
        symbolCodes: spec.symbols,
        feedIds: spec.providerAuditFeedIds || [],
        timeframe: spec.timeframe,
        fromUtc: datasetFromUtc,
        toUtc: resolvedCutoffUtc,
        closedOnly: true,
        limit: 250_000,
      }).catch(() => []);
      providerM5Audit[spec.dataset] = auditDerivedM5AgainstProvider(normalizedRows, providerRows, {
        expectedFeedId: spec.providerAuditFeedIds?.[0] || null,
      });
      const replayCoverage = replayRequestedCoverage
        ? evaluateV5ReplayDatasetCoverage({ spec, rows: normalizedRows, requestedCoverage: replayRequestedCoverage })
        : null;
      if (replayCoverage) replayCoverageEntries.push(replayCoverage);
      if (!normalizedRows.length) {
        missingDatasets.push(spec.dataset);
        datasetFreshness[spec.dataset] = replayCoverage
          ? replayCoverageFreshness(spec, replayCoverage, resolvedCutoffUtc)
          : missingFreshness(spec);
        if (spec.required && purpose !== "replay_source") {
          throw localPackError("LOCAL_PACK_CORE_DATASET_MISSING", `Required derived dataset is empty: ${spec.dataset}.`, {
            dataset: spec.dataset,
            source_dataset: spec.sourceDataset,
            cutoff_utc: resolvedCutoffUtc,
            lineage: derivation.lineage,
          });
        }
        continue;
      }
      const freshness = replayCoverage
        ? replayCoverageFreshness(spec, replayCoverage, resolvedCutoffUtc)
        : evaluateDatasetFreshness(spec, normalizedRows, resolvedCutoffUtc, purpose);
      datasetFreshness[spec.dataset] = freshness;
      if (freshness.status !== "fresh") {
        staleDatasets.push(spec.dataset);
        if (spec.required && purpose === "live_rolling") {
          throw localPackError("LOCAL_PACK_CORE_DATASET_STALE", `Required LIVE derived dataset is stale: ${spec.dataset}.`, {
            dataset: spec.dataset,
            source_dataset: spec.sourceDataset,
            cutoff_utc: resolvedCutoffUtc,
            ...freshness,
          });
        }
      }
      preparedPriceDatasets.push({
        spec,
        normalizedRows,
        freshness,
        source: "canonical_derived_m1",
        lineage: derivation.lineage,
      });
    }

    const indicatorWarmupIncomplete = preparedPriceDatasets
      .filter(({ lineage }) => lineage?.indicator_warmup_incomplete === true)
      .map(({ spec }) => spec.dataset);
    const replayActualCoverage = replayRequestedCoverage
      ? summarizeV5ReplayCoverage(replayCoverageEntries)
      : null;
    if (replayRequestedCoverage && !replayActualCoverage.canonical_coverage_complete) {
      throw localPackError("LOCAL_PACK_CORE_COVERAGE_INCOMPLETE", "Required replay M1/M5 coverage is incomplete.", {
        data_profile_id: replayActualCoverage.profile_id,
        data_profile_version: replayActualCoverage.profile_version,
        requested_coverage: replayRequestedCoverage,
        actual_coverage: replayActualCoverage,
      });
    }

    for (const { spec, normalizedRows, freshness, source, lineage } of preparedPriceDatasets) {
      datasets[spec.dataset] = await this.#writeDataset({
        packId: resolvedPackId,
        packBuildId,
        strategyId: session,
        session,
        dataset: spec.dataset,
        cutoffUtc: resolvedCutoffUtc,
        format: "csv",
        content: serializeCsv(PRICE_COLUMNS, normalizedRows),
        source,
        extra: {
          freshness,
          availability: freshness.status === "fresh" ? "fresh" : "last_known",
          ...lineage,
        },
      });
    }

    const macroRows = await this.persistence.queryCollectionDocuments({
      collection: DESK_COLLECTIONS.macroCalendarEvents,
      filters: [
        { field: "date", operator: ">=", value: offsetDate(date, -1) },
        { field: "date", operator: "<=", value: offsetDate(date, 1) },
      ],
      orderBy: [{ field: "timestamp_paris", direction: "asc" }],
      limit: 5_000,
    });
    datasets.macro_calendar = await this.#writeDataset({
      packId: resolvedPackId,
      packBuildId,
      strategyId: session,
      session,
      dataset: "macro_calendar",
      cutoffUtc: resolvedCutoffUtc,
      format: "json",
      content: `${JSON.stringify({ events: macroRows })}\n`,
      source: "postgres_macro_calendar_events",
    });

    const newsFromUtc = new Date(Date.parse(resolvedCutoffUtc) - 48 * 60 * 60_000).toISOString();
    const newsRows = typeof this.persistence.queryNewsArticles === "function"
      ? await this.persistence.queryNewsArticles({
        from_utc: newsFromUtc,
        to_utc: resolvedCutoffUtc,
        limit: 500,
      })
      : await this.persistence.queryCollectionDocuments({
        collection: DESK_COLLECTIONS.newsArticles || "news_articles",
        filters: [
          { field: "published_at_utc", operator: ">=", value: newsFromUtc },
          { field: "published_at_utc", operator: "<=", value: resolvedCutoffUtc },
        ],
        orderBy: [{ field: "published_at_utc", direction: "desc" }],
        limit: 500,
      }).catch(() => []);
    const chronologicalNewsRows = sortNewsChronologically(newsRows);
    datasets.news_digest = await this.#writeDataset({
      packId: resolvedPackId,
      packBuildId,
      strategyId: session,
      session,
      dataset: "news_digest",
      cutoffUtc: resolvedCutoffUtc,
      format: "json",
      content: `${JSON.stringify({
        status: chronologicalNewsRows.length ? "ready" : "empty",
        source: "postgres_news_articles",
        items: chronologicalNewsRows,
      })}\n`,
      source: "postgres_news_articles",
      extra: {
        status: chronologicalNewsRows.length ? "ready" : "empty",
        empty_ok: true,
        reason: chronologicalNewsRows.length ? null : "no_news_available_at_cutoff",
      },
    });

    const scopeBase = {
      mode: purpose === "replay_source" ? "replay" : "live",
      pack_id: resolvedPackId,
      pack_build_id: packBuildId,
      strategy_id: session,
      session,
      trading_date: date,
      cutoff_utc: resolvedCutoffUtc,
      cutoff_paris: resolvedCutoffParis,
      scope_schema_version: "1.0.0",
      ...(normalizedSourceEvidence ? { source_evidence: normalizedSourceEvidence } : {}),
    };
    const resolvedScope = { ...scopeBase, scope_hash: canonicalSha256(scopeBase) };
    const manifest = buildSourceManifest({
      packId: resolvedPackId,
      packBuildId,
      scope: resolvedScope,
      datasets,
      createdAtUtc: tick.utc,
    });
    const rowCountTotal = Object.values(datasets).reduce((total, ref) => total + Number(ref.row_count || 0), 0);
    const build = {
      pack_id: resolvedPackId,
      pack_build_id: packBuildId,
      strategy_id: session,
      session,
      date,
      trading_date: date,
      mode: resolvedScope.mode,
      status: "ready",
      execution_allowed: true,
      pack_purpose: purpose,
      data_profile_id: V5_REPLAY_DATA_PROFILE.profile_id,
      data_profile_version: V5_REPLAY_DATA_PROFILE.version,
      canonical_m5_mode: CANONICAL_M5_MODE,
      canonical_resampler_version: CANONICAL_M1_TO_M5_VERSION,
      ...(replayRequestedCoverage ? {
        canonical_coverage_complete: replayActualCoverage.canonical_coverage_complete,
        requested_coverage: replayRequestedCoverage,
        actual_coverage: replayActualCoverage,
      } : {}),
      cutoff_utc: resolvedCutoffUtc,
      cutoff_paris: resolvedCutoffParis,
      created_at_utc: tick.utc,
      updated_at_utc: tick.utc,
      sealed_at_utc: tick.utc,
      datasets,
      manifest,
      source_manifest_hash: manifest.source_manifest_hash,
      source_evidence: normalizedSourceEvidence,
      resolved_scope: resolvedScope,
      scope_hash: resolvedScope.scope_hash,
      source_coverage: {
        mode: purpose === "replay_source" ? "full_replay_range" : "rolling",
        start_utc: replayRequestedCoverage?.context_start_utc || fromUtc,
        end_utc: resolvedCutoffUtc,
        end_paris: resolvedCutoffParis,
      },
      data_cutoff: {
        source: "postgres_market_candles+canonical_m1_to_m5",
        h4_days: 5,
        end_utc: resolvedCutoffUtc,
        end_paris: resolvedCutoffParis,
        h4_from_utc: fromUtc,
        intraday_from_utc: fromUtc,
      },
      quality: {
        source: "postgres_local_v5",
        status: missingDatasets.length || staleDatasets.length ? "degraded_context" : "ready",
        row_count_total: rowCountTotal,
        missing_datasets: missingDatasets,
        stale_datasets: staleDatasets,
        dataset_freshness: datasetFreshness,
        freshness_policy_version: "1.2.0",
        canonical_m5_mode: CANONICAL_M5_MODE,
        canonical_resampler_version: CANONICAL_M1_TO_M5_VERSION,
        provider_m5_audit: providerM5Audit,
        indicator_warmup_incomplete: indicatorWarmupIncomplete,
        warnings: [
          ...missingDatasets.map((dataset) => `optional_dataset_missing:${dataset}`),
          ...staleDatasets.map((dataset) => `optional_dataset_stale:${dataset}`),
          ...indicatorWarmupIncomplete.map((dataset) => `indicator_warmup_incomplete:${dataset}`),
          ...Object.entries(providerM5Audit)
            .filter(([, audit]) => audit.status !== "exact")
            .map(([dataset, audit]) => `provider_m5_audit:${dataset}:${audit.status}`),
        ],
      },
      pack_build_schema_version: "2.0.0",
    };
    const logicalPack = {
      pack_id: resolvedPackId,
      active_build_id: packBuildId,
      pack_build_id: packBuildId,
      strategy_id: session,
      session,
      date,
      trading_date: date,
      status: "ready",
      execution_allowed: true,
      pack_purpose: purpose,
      data_profile_id: build.data_profile_id,
      data_profile_version: build.data_profile_version,
      canonical_m5_mode: build.canonical_m5_mode,
      canonical_resampler_version: build.canonical_resampler_version,
      ...(replayRequestedCoverage ? {
        canonical_coverage_complete: build.canonical_coverage_complete,
        requested_coverage: build.requested_coverage,
        actual_coverage: build.actual_coverage,
      } : {}),
      cutoff_utc: resolvedCutoffUtc,
      cutoff_paris: resolvedCutoffParis,
      data_cutoff: build.data_cutoff,
      source_coverage: build.source_coverage,
      source_manifest_hash: manifest.source_manifest_hash,
      source_evidence: normalizedSourceEvidence,
      quality: build.quality,
      datasets,
      updated_at_utc: tick.utc,
      created_at_utc: tick.utc,
    };
    await this.persistence.writeDocuments([
      {
        collection: DESK_COLLECTIONS.deskPackBuilds,
        documentId: packBuildId,
        data: build,
        merge: false,
      },
      {
        collection: DESK_COLLECTIONS.deskPacks,
        documentId: resolvedPackId,
        data: logicalPack,
        merge: false,
      },
    ]);
    return {
      ok: true,
      status: "ready",
      pack_id: resolvedPackId,
      pack_build_id: packBuildId,
      source_manifest_hash: manifest.source_manifest_hash,
      source_evidence: normalizedSourceEvidence,
      canonical_m5_mode: build.canonical_m5_mode,
      canonical_resampler_version: build.canonical_resampler_version,
      provider_m5_audit: providerM5Audit,
      data_profile_id: build.data_profile_id,
      data_profile_version: build.data_profile_version,
      ...(replayRequestedCoverage ? {
        canonical_coverage_complete: build.canonical_coverage_complete,
        requested_coverage: build.requested_coverage,
        actual_coverage: build.actual_coverage,
      } : {}),
      dataset_count: Object.keys(datasets).length,
      missing_datasets: missingDatasets,
      stale_datasets: staleDatasets,
      dataset_freshness: datasetFreshness,
      source_coverage: build.source_coverage,
    };
  }

  async #writeDataset({
    packId,
    packBuildId,
    strategyId,
    session,
    dataset,
    cutoffUtc,
    format,
    content,
    source,
    extra = {},
  }) {
    const extension = format === "json" ? "json" : "csv";
    const relativeObjectName = immutableDatasetObjectName({
      storagePrefix: "desk-data",
      packId,
      packBuildId,
      dataset,
      extension,
    });
    const storagePath = `local://${relativeObjectName}`;
    const buffer = Buffer.from(content, "utf8");
    const generation = canonicalSha256({ storagePath, bytes: buffer.toString("base64") });
    await this.persistence.writeStorageObject(storagePath, buffer, {
      generation,
      localRelativePath: relativeObjectName,
      contentType: format === "json" ? "application/json" : "text/csv",
      sourceKind: "POSTGRES_BUILD",
      metadata: { pack_id: packId, pack_build_id: packBuildId, dataset },
    });
    return {
      ...buildDatasetManifestEntry({
        packId,
        packBuildId,
        strategyId,
        session,
        dataset,
        cutoffUtc,
        objectPath: storagePath,
        generation,
        source,
        buffer,
        format,
        sourceRef: { storage_path: `postgres://${source}` },
      }),
      ...extra,
    };
  }
}


export function marketRowAvailableAtCutoff(row = {}, spec = {}, cutoffUtc) {
  const cutoffMs = parseTimestampMs(cutoffUtc);
  const closeMs = marketRowBarCloseMs(row, spec);
  return Number.isFinite(cutoffMs) && Number.isFinite(closeMs) && closeMs <= cutoffMs;
}

function marketRowBarCloseUtc(row = {}, spec = {}) {
  const value = marketRowBarCloseMs(row, spec);
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function marketRowBarCloseMs(row = {}, spec = {}) {
  for (const field of [
    "bar_close_utc",
    "bar_close_paris",
    "close_timestamp_utc",
    "candle_close_utc",
    "timestamp_close_utc",
    "time_close",
  ]) {
    if (row[field] !== null && row[field] !== undefined && row[field] !== "") {
      return parseTimestampMs(row[field]);
    }
  }
  const timestampMs = parseTimestampMs(row.timestamp_utc || row.timestamp_paris);
  if (!Number.isFinite(timestampMs)) return Number.NaN;
  if (row.timestamp_is_bar_close === true
    || ["BAR_CLOSE", "CLOSE", "CLOSING_TIME"].includes(String(row.timestamp_semantics || row.timestamp_type || "").toUpperCase())) {
    return timestampMs;
  }
  return timestampMs + timeframeDurationMinutes(spec.timeframe || row.timeframe) * 60_000;
}

function parseTimestampMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  const text = String(value ?? "").trim();
  if (!text) return Number.NaN;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const numericValue = Number(text);
    return numericValue < 10_000_000_000 ? numericValue * 1000 : numericValue;
  }
  return Date.parse(text);
}

function normalizePriceRow(row, spec) {
  const symbol = String(row.symbol_code || row.symbol || "").toUpperCase();
  const asset = canonicalAsset(symbol);
  const indicators = row.indicators && typeof row.indicators === "object" ? row.indicators : {};
  const studies = row.studies && typeof row.studies === "object" ? row.studies : {};
  const timestampUtc = new Date(row.timestamp_utc).toISOString();
  return {
    asset,
    requested_symbol: spec.symbols[0],
    chart_symbol: symbol,
    timeframe: spec.outputTimeframe,
    timestamp_utc: timestampUtc,
    bar_close_utc: marketRowBarCloseUtc(row, spec),
    timestamp_paris: toParisIso(Date.parse(timestampUtc)),
    open: numeric(row.open),
    high: numeric(row.high),
    low: numeric(row.low),
    close: numeric(row.close),
    volume: nullableNumeric(row.volume),
    rsi_14: nullableNumeric(indicators.rsi_14 ?? studies.rsi_14 ?? row.rsi_14),
    atr_14: nullableNumeric(indicators.atr_14 ?? studies.atr_14 ?? row.atr_14),
  };
}

function normalizeSourceEvidence(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw localPackError("LOCAL_PACK_SOURCE_EVIDENCE_INVALID", "Pack source evidence must be an object.");
  }
  return JSON.parse(JSON.stringify(value));
}

function sourceEvidenceLineage(evidence, dataset) {
  if (!evidence) return {};
  const file = (evidence.files || []).find((candidate) => candidate.dataset === dataset);
  if (!file) return {};
  return {
    source_import_id: evidence.import_id || null,
    source_import_manifest_sha256: evidence.manifest_sha256 || null,
    source_capture_proof_sha256: evidence.capture_proof_sha256 || null,
    source_capture_policy_version: evidence.capture_policy_version || null,
    source_file_sha256: file.sha256 || null,
  };
}

function serializeCsv(columns, rows) {
  return [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
    "",
  ].join("\n");
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function canonicalAsset(symbol) {
  const value = String(symbol || "").toUpperCase().replace(/1!$/, "");
  return value === "MCL" ? "CL" : value;
}

function numeric(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`LOCAL_PACK_OHLC_INVALID:${value}`);
  return parsed;
}

function nullableNumeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function evaluateDatasetFreshness(spec, rows, cutoffUtc, purpose) {
  const cutoffMs = Date.parse(cutoffUtc);
  const latestMs = rows.reduce((latest, row) => Math.max(
    latest,
    Date.parse(row.bar_close_utc || row.timestamp_utc),
  ), Number.NEGATIVE_INFINITY);
  const timeframeMinutes = timeframeDurationMinutes(spec.timeframe);
  const maximumAgeMinutes = spec.freshnessRole === "context"
    ? timeframeMinutes * 2
    : timeframeMinutes;
  const ageMinutes = Number.isFinite(latestMs)
    ? Number(((cutoffMs - latestMs) / 60_000).toFixed(3))
    : null;
  const liveFresh = purpose !== "live_rolling"
    || (ageMinutes !== null && ageMinutes >= 0 && ageMinutes <= maximumAgeMinutes);
  return {
    status: liveFresh ? "fresh" : "stale",
    role: spec.freshnessRole || "optional",
    required: spec.required === true,
    timeframe: spec.timeframe,
    latest_closed_timestamp_utc: Number.isFinite(latestMs) ? new Date(latestMs).toISOString() : null,
    cutoff_utc: new Date(cutoffMs).toISOString(),
    age_minutes: ageMinutes,
    maximum_age_minutes: maximumAgeMinutes,
    policy: purpose === "live_rolling" ? "strict_live_closed_candle_v1" : "replay_coverage_only",
  };
}

function missingFreshness(spec) {
  return {
    status: "missing",
    role: spec.freshnessRole || "optional",
    required: spec.required === true,
    timeframe: spec.timeframe,
    latest_closed_timestamp_utc: null,
    cutoff_utc: null,
    age_minutes: null,
    maximum_age_minutes: spec.freshnessRole === "context"
      ? timeframeDurationMinutes(spec.timeframe) * 2
      : timeframeDurationMinutes(spec.timeframe),
  };
}

function replayCoverageFreshness(spec, coverage, cutoffUtc) {
  return {
    status: coverage.complete ? "fresh" : coverage.status === "missing" ? "missing" : "stale",
    role: spec.freshnessRole || "optional",
    required: spec.required === true,
    timeframe: spec.timeframe,
    latest_closed_timestamp_utc: coverage.actual_end_utc,
    cutoff_utc: cutoffUtc,
    age_minutes: coverage.end_gap_minutes,
    maximum_age_minutes: coverage.interval_minutes,
    policy: "replay_bounds_and_gaps_v5",
    coverage_complete: coverage.complete,
    requested_start_utc: coverage.requested_start_utc,
    requested_end_utc: coverage.requested_end_utc,
    actual_start_utc: coverage.actual_start_utc,
    actual_end_utc: coverage.actual_end_utc,
    gap_count: coverage.gap_count,
    missing_interval_count: coverage.missing_interval_count,
    reasons: coverage.reasons,
  };
}

function offsetDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function sortNewsChronologically(rows) {
  return [...(rows || [])].sort((left, right) => {
    const leftTimestamp = Date.parse(String(left?.published_at_utc || ""));
    const rightTimestamp = Date.parse(String(right?.published_at_utc || ""));
    const leftValid = Number.isFinite(leftTimestamp);
    const rightValid = Number.isFinite(rightTimestamp);
    if (leftValid && rightValid && leftTimestamp !== rightTimestamp) return leftTimestamp - rightTimestamp;
    if (leftValid !== rightValid) return leftValid ? -1 : 1;
    return String(left?.article_id || left?.canonical_url || "")
      .localeCompare(String(right?.article_id || right?.canonical_url || ""));
  });
}

function assertBuildInput({ date, session, cutoffUtc }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new Error(`LOCAL_PACK_DATE_INVALID:${date || "missing"}`);
  if (!["asia_open", "ny_open"].includes(session)) throw new Error(`LOCAL_PACK_SESSION_INVALID:${session || "missing"}`);
  if (!Number.isFinite(Date.parse(String(cutoffUtc || "")))) throw new Error(`LOCAL_PACK_CUTOFF_INVALID:${cutoffUtc || "missing"}`);
}

function localPackError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
