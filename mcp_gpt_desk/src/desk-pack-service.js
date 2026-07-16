import { parseCsv, trimCsv } from "./csv.js";
import { DATASETS } from "./schemas.js";
import { SystemClock } from "@tv-automation/desk-time";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { canonicalSha256 } from "@tv-automation/desk-domain";
import {
  DeskIntegrityError,
  filterNewsAtCutoff,
  sanitizeMacroActualsAtCutoff,
  validateDatasetObject,
} from "./pack-integrity.js";
import { deskError } from "./desk-errors.js";
import { normalizeUtcIso } from "./desk-time-utils.js";

const COLLECTIONS = DESK_COLLECTIONS;

export class DeskPackService {
  constructor({ persistence, clock = new SystemClock() } = {}) {
    if (!persistence) throw new Error("document_persistence_required");
    this.persistence = persistence;
    this.clock = clock;
  }

  async getLatestAsiaOpenPack({ date } = {}) {
    if (date) return compactPack(await this.getDeskPack({ pack_id: `${date}_asia_open` }));

    const docs = await this.persistence.listDocuments(COLLECTIONS.deskPacks, 50);
    const ready = docs
      .filter((pack) => pack.session === "asia_open" && pack.status === "ready")
      .sort(comparePackFreshness);
    if (!ready.length) throw new Error("latest_asia_open_pack_not_found");
    return compactPack(ready[0]);
  }

  async listDeskPacks({ date_from, date_to, session = "asia_open", status = "ready", limit = 100 } = {}) {
    const docs = await this.persistence.listDocuments(
      COLLECTIONS.deskPacks,
      Math.max(50, Math.min(Number(limit) || 100, 500)),
    );
    return summarizePacks(filterPacks(docs, { date_from, date_to, session, status, limit }));
  }

  async getDeskPack({ pack_id, pack_build_id, mode = "live", include_draft = false }) {
    const logicalPack = await this.persistence.getDocument(COLLECTIONS.deskPacks, pack_id);
    const resolvedBuildId = resolveRequestedPackBuildId({ logicalPack, pack_build_id, mode });
    if (resolvedBuildId) {
      const build = await this.persistence.getDocument(COLLECTIONS.deskPackBuilds, resolvedBuildId)
        .catch(() => logicalPack.pack_build_id === resolvedBuildId ? logicalPack : null);
      if (!build) {
        throw deskError("PACK_NOT_FOUND", `Pack build not found: ${resolvedBuildId}.`, {
          pack_id,
          pack_build_id: resolvedBuildId,
        });
      }
      assertResolvedPackBuild(build, { pack_id, pack_build_id: resolvedBuildId, include_draft });
      try {
        assertPackManifestIntegrity(build);
      } catch (error) {
        await this.#markPackBuildInvalid(build, error).catch(() => undefined);
        throw error;
      }
      return { ...build, logical_pack: compactLogicalPack(logicalPack) };
    }
    if (["replay", "backtest"].includes(mode)) {
      throw deskError("PACK_BUILD_MISMATCH", "Legacy packs cannot be used by replay/backtest.", { pack_id });
    }
    if (!include_draft && logicalPack.status !== "ready") throw new Error("pack_not_ready");
    return { ...logicalPack, legacy_unverified: true };
  }

  async getDataset({ pack_id, pack_build_id, dataset, as_of_utc, mode = "live", format = "json", max_rows = 1000 }) {
    assertDataset(dataset);
    const pack = await this.getDeskPack({ pack_id, pack_build_id, mode });
    const ref = datasetRef(pack, dataset);
    if (!ref) throw new Error(`dataset_not_found:${dataset}`);

    if (pack.pack_build_id) {
      assertDatasetManifestScope(pack, ref, dataset);
      try {
        const object = await this.#readStorageObject(ref.storage_path || ref.object_path, ref.gcs_generation);
        const integrity = validateDatasetObject({
          ref,
          buffer: object.buffer,
          metadata: object.metadata,
          dataset,
          cutoffUtc: pack.cutoff_utc || pack.resolved_scope?.cutoff_utc || ref.cutoff_utc,
          asOfUtc: pack.cutoff_utc || pack.resolved_scope?.cutoff_utc || ref.cutoff_utc,
        });
        return validatedDatasetResponse({ pack, ref, integrity, dataset, format, max_rows, as_of_utc });
      } catch (error) {
        await this.#markPackBuildInvalid(pack, error).catch(() => undefined);
        throw error;
      }
    }

    const text = await this.#readStorageText(ref.storage_path);
    if (format === "csv") {
      return {
        pack_id,
        dataset,
        format,
        row_count: ref.row_count ?? null,
        columns: ref.columns ?? [],
        csv: trimCsv(text, { maxRows: max_rows }),
      };
    }
    return {
      pack_id,
      dataset,
      format: "json",
      row_count: ref.row_count ?? null,
      columns: ref.columns ?? [],
      rows: parseDatasetText(text, ref, { maxRows: max_rows }),
      integrity: { valid: null, legacy_unverified: true },
    };
  }

  async getMarketLevels({ pack_id, instrument }) {
    const pack = await this.getDeskPack({ pack_id });
    const levels = pack.summary?.key_levels?.[instrument];
    if (!levels) throw new Error(`market_levels_not_found:${instrument}`);
    return { pack_id, instrument, ...levels };
  }

  async getMacroCalendar({ date, pack_id, pack_build_id, as_of_utc, mode = "live", importance_min = "medium" } = {}) {
    const pack = pack_id
      ? await this.getDeskPack({ pack_id, pack_build_id, mode })
      : await this.getLatestAsiaOpenPack({ date }).then((summary) => this.getDeskPack({ pack_id: summary.pack_id }));
    const ref = datasetRef(pack, "macro_calendar");
    if (!ref) {
      return { date: date || pack.date, importance_min, events: [], warning: "macro_calendar_dataset_not_available" };
    }
    const cutoffUtc = as_of_utc || resolvePackCutoffUtc(pack);
    if (pack.pack_build_id) {
      const dataset = await this.getDataset({
        pack_id: pack.pack_id,
        pack_build_id: pack.pack_build_id,
        dataset: "macro_calendar",
        as_of_utc: cutoffUtc,
        mode,
        max_rows: 5000,
      });
      return scopedMacroResponse(
        pack,
        sanitizeMacroActualsAtCutoff(dataset.rows || [], cutoffUtc),
        { date: date || pack.date, importance_min },
      );
    }
    const normalized = normalizeMacroDataset(
      await this.#readStorageText(ref.storage_path),
      ref,
      { date: date || pack.date, importance_min },
    );
    return cutoffUtc
      ? { ...normalized, events: sanitizeMacroActualsAtCutoff(normalized.events, cutoffUtc) }
      : normalized;
  }

  async getNewsDigest({ date, session = "asia_open", pack_id, pack_build_id, as_of_utc, mode = "live" } = {}) {
    const pack = pack_id
      ? await this.getDeskPack({ pack_id, pack_build_id, mode })
      : await this.getLatestAsiaOpenPack({ date }).then((summary) => this.getDeskPack({ pack_id: summary.pack_id }));
    const ref = datasetRef(pack, "news_digest");
    if (!ref) return optionalNewsDigestUnavailable({ date: date || pack.date, session });

    const cutoffUtc = as_of_utc || resolvePackCutoffUtc(pack);
    if (pack.pack_build_id) {
      const dataset = await this.getDataset({
        pack_id: pack.pack_id,
        pack_build_id: pack.pack_build_id,
        dataset: "news_digest",
        as_of_utc: cutoffUtc,
        mode,
        max_rows: 5000,
      });
      return scopedNewsResponse(
        pack,
        filterNewsAtCutoff(dataset.rows || [], cutoffUtc),
        { date: date || pack.date, session },
      );
    }
    const normalized = normalizeNewsDataset(
      await this.#readStorageText(ref.storage_path),
      ref,
      { date: date || pack.date, session },
    );
    return cutoffUtc ? { ...normalized, items: filterNewsAtCutoff(normalized.items, cutoffUtc) } : normalized;
  }

  async #readStorageText(storagePath) {
    return this.persistence.readStorageText(storagePath);
  }

  async #readStorageObject(storagePath, generation) {
    if (typeof this.persistence.readStorageObject === "function") {
      return this.persistence.readStorageObject(storagePath, { generation });
    }
    const text = await this.persistence.readStorageText(storagePath);
    const buffer = Buffer.from(text, "utf8");
    return {
      buffer,
      text,
      metadata: { generation: generation == null ? null : String(generation), size_bytes: buffer.length },
    };
  }

  async #markPackBuildInvalid(pack, error) {
    if (!pack?.pack_build_id || !isBlockingIntegrityError(error)) return;
    const tick = this.clock.now();
    await this.persistence.setDocument(COLLECTIONS.deskPackBuilds, pack.pack_build_id, {
      status: error.code === "LOOKAHEAD_DETECTED" ? "compromised" : "degraded",
      execution_allowed: false,
      invalid_reason_codes: [...new Set([...(pack.invalid_reason_codes || []), error.code])],
      invalidated_at_utc: tick.utc,
      invalidated_by: "dataset_read_validation_v2",
      updated_at_utc: tick.utc,
    }, { merge: true });
  }
}

function assertDataset(dataset) {
  if (!DATASETS.includes(dataset)) throw new Error(`dataset_not_allowed:${dataset}`);
}

function resolveRequestedPackBuildId({ logicalPack, pack_build_id, mode }) {
  if (["replay", "backtest"].includes(mode) && !pack_build_id) {
    throw deskError("SCOPE_REQUIRED", "pack_build_id is required for replay/backtest.", { field: "pack_build_id", mode });
  }
  const activeBuildId = logicalPack.active_build_id || (logicalPack.pack_build_id ? logicalPack.pack_build_id : null);
  if (pack_build_id && activeBuildId && mode === "live" && pack_build_id !== activeBuildId) {
    throw deskError("PACK_BUILD_MISMATCH", "Live reads must use the pack active_build_id.", {
      requested_pack_build_id: pack_build_id,
      active_build_id: activeBuildId,
    });
  }
  return pack_build_id || activeBuildId || null;
}

function assertResolvedPackBuild(build, { pack_id, pack_build_id, include_draft }) {
  if (build.pack_id !== pack_id || build.pack_build_id !== pack_build_id) {
    throw deskError("PACK_BUILD_MISMATCH", "Resolved build does not belong to the requested pack.", {
      requested_pack_id: pack_id,
      actual_pack_id: build.pack_id || null,
      requested_pack_build_id: pack_build_id,
      actual_pack_build_id: build.pack_build_id || null,
    });
  }
  if (!include_draft && (build.status !== "ready" || build.execution_allowed === false)) {
    throw deskError("PACK_BUILD_NOT_READY", `Pack build is not executable: ${build.status || "unknown"}.`, {
      pack_id,
      pack_build_id,
      status: build.status || null,
    });
  }
}

function assertPackManifestIntegrity(build) {
  const manifest = build.manifest;
  const expectedHash = build.source_manifest_hash || manifest?.source_manifest_hash || null;
  if (!manifest || !expectedHash) {
    throw deskError("DATASET_SCHEMA_MISMATCH", "Pack build has no canonical source manifest.", {
      pack_id: build.pack_id,
      pack_build_id: build.pack_build_id,
    });
  }
  const { source_manifest_hash: embeddedHash, ...payload } = manifest;
  const actualHash = canonicalSha256(payload);
  if (embeddedHash !== expectedHash || actualHash !== expectedHash) {
    throw deskError("DATASET_INTEGRITY_MISMATCH", "Pack source manifest hash is invalid.", {
      pack_id: build.pack_id,
      pack_build_id: build.pack_build_id,
      expected_source_manifest_hash: expectedHash,
      embedded_source_manifest_hash: embeddedHash || null,
      actual_source_manifest_hash: actualHash,
    });
  }
  if (canonicalSha256(build.datasets || {}) !== canonicalSha256(manifest.datasets || {})) {
    throw deskError("DATASET_INTEGRITY_MISMATCH", "Pack datasets differ from the sealed source manifest.", {
      pack_id: build.pack_id,
      pack_build_id: build.pack_build_id,
    });
  }
  return true;
}

function assertDatasetManifestScope(pack, ref, dataset) {
  const mismatches = [];
  for (const [field, expected, actual] of [
    ["pack_id", pack.pack_id, ref.pack_id],
    ["pack_build_id", pack.pack_build_id, ref.pack_build_id],
    ["strategy_id", pack.strategy_id || pack.resolved_scope?.strategy_id, ref.strategy_id],
    ["session", pack.session || pack.resolved_scope?.session, ref.session],
    ["dataset", dataset, ref.dataset],
    ["cutoff_utc", normalizeUtcIso(resolvePackCutoffUtc(pack)), ref.cutoff_utc ? normalizeUtcIso(ref.cutoff_utc) : null],
  ]) {
    if ((expected ?? null) !== (actual ?? null)) {
      mismatches.push({ field, expected: expected ?? null, actual: actual ?? null });
    }
  }
  if (mismatches.length) {
    throw deskError("DATASET_SCOPE_MISMATCH", "Dataset manifest entry does not match its pack build.", {
      dataset,
      mismatches,
    });
  }
  return true;
}

function compactLogicalPack(pack) {
  return {
    pack_id: pack.pack_id,
    strategy_id: pack.strategy_id || null,
    session: pack.session || null,
    date: pack.date || pack.trading_date || null,
    status: pack.status || null,
    active_build_id: pack.active_build_id || null,
    source_manifest_hash: pack.source_manifest_hash || null,
  };
}

function validatedDatasetResponse({ pack, ref, integrity, dataset, format, max_rows, as_of_utc }) {
  const analysis = integrity.analysis;
  const sourceCutoffUtc = resolvePackCutoffUtc(pack);
  const decisionCutoffUtc = as_of_utc || sourceCutoffUtc;
  if (decisionCutoffUtc && sourceCutoffUtc && Date.parse(decisionCutoffUtc) > Date.parse(sourceCutoffUtc)) {
    throw deskError(
      "REPLAY_SOURCE_COVERAGE_INSUFFICIENT",
      "Requested decision cutoff exceeds the immutable source pack coverage.",
      {
        pack_id: pack.pack_id,
        pack_build_id: pack.pack_build_id,
        requested_as_of_utc: normalizeUtcIso(decisionCutoffUtc),
        source_coverage_end_utc: normalizeUtcIso(sourceCutoffUtc),
      },
    );
  }
  const visibleRows = filterDatasetRowsAtCutoff(analysis.rows, dataset, decisionCutoffUtc);
  const limitedRows = visibleRows.slice(0, max_rows);
  const base = {
    ok: true,
    pack_id: pack.pack_id,
    pack_build_id: pack.pack_build_id,
    dataset,
    format,
    row_count: visibleRows.length,
    source_row_count: analysis.row_count,
    columns: analysis.columns,
    as_of_utc: decisionCutoffUtc ? normalizeUtcIso(decisionCutoffUtc) : null,
    source_coverage_end_utc: sourceCutoffUtc ? normalizeUtcIso(sourceCutoffUtc) : null,
    cutoff_filtered: Boolean(decisionCutoffUtc),
    resolved_scope: pack.resolved_scope || null,
    scope_hash: pack.scope_hash || pack.resolved_scope?.scope_hash || null,
    source_manifest_hash: pack.source_manifest_hash || pack.manifest?.source_manifest_hash || null,
    integrity: {
      valid: true,
      expected: integrity.expected,
      actual: integrity.actual,
      checked_at_read: true,
      object_path: ref.object_path || ref.storage_path || null,
    },
  };
  if (format === "csv") return { ...base, csv: serializeDatasetRows(analysis.columns, limitedRows) };
  return { ...base, format: "json", rows: limitedRows };
}

function filterDatasetRowsAtCutoff(rows, dataset, cutoffUtc) {
  if (!cutoffUtc) return rows || [];
  if (dataset === "macro_calendar") return sanitizeMacroActualsAtCutoff(rows || [], cutoffUtc);
  if (dataset === "news_digest") return filterNewsAtCutoff(rows || [], cutoffUtc);
  const cutoffMs = Date.parse(cutoffUtc);
  return (rows || []).filter((row) => {
    const timestamps = [
      row?.timestamp_utc,
      row?.timestamp_paris,
      row?.bar_close_utc,
      row?.knowledge_timestamp_utc,
      row?.source_snapshot_timestamp_utc,
    ].filter(Boolean).map((value) => Date.parse(value)).filter(Number.isFinite);
    if (timestamps.length && !timestamps.every((value) => value <= cutoffMs)) return false;
    const timeframeMinutes = datasetTimeframeMinutes(row?.timeframe);
    const observationMs = Date.parse(row?.timestamp_utc || row?.timestamp_paris || "");
    return !(timeframeMinutes >= 60
      && Number.isFinite(observationMs)
      && observationMs + timeframeMinutes * 60 * 1000 > cutoffMs);
  });
}

function datasetTimeframeMinutes(value) {
  const text = String(value || "").toUpperCase();
  if (["5", "5M", "M5"].includes(text)) return 5;
  if (["15", "15M", "M15"].includes(text)) return 15;
  if (["60", "1H", "H1"].includes(text)) return 60;
  if (["240", "4H", "H4"].includes(text)) return 240;
  return 0;
}

function serializeDatasetRows(columns, rows) {
  const header = (columns || []).map(csvCell).join(",");
  const body = (rows || []).map((row) => (columns || []).map((column) => csvCell(row?.[column])).join(","));
  return [header, ...body, ""].join("\n");
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function isBlockingIntegrityError(error) {
  return error instanceof DeskIntegrityError || [
    "DATASET_INTEGRITY_MISMATCH",
    "DATASET_GENERATION_MISMATCH",
    "DATASET_SCHEMA_MISMATCH",
    "DATASET_SCOPE_MISMATCH",
    "LOOKAHEAD_DETECTED",
    "TIMEZONE_INVALID",
  ].includes(error?.code);
}

export function datasetRef(pack, dataset) {
  const datasets = pack.datasets || {};
  if (datasets[dataset]) return datasets[dataset];
  if (dataset === "ny_close_mega_caps" && datasets.mega_caps_premarket) return datasets.mega_caps_premarket;
  if (dataset === "mega_caps_premarket" && datasets.ny_close_mega_caps) return datasets.ny_close_mega_caps;
  return null;
}

function parseDatasetText(text, ref, { maxRows }) {
  const format = String(ref.format || ref.storage_path || "").toLowerCase();
  if (format.endsWith(".json") || format.includes("json")) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.slice(0, maxRows);
    if (Array.isArray(parsed.items)) return parsed.items.slice(0, maxRows);
    if (Array.isArray(parsed.events)) return parsed.events.slice(0, maxRows);
    return parsed;
  }
  return parseCsv(text, { maxRows });
}

function normalizeMacroDataset(text, ref, { date, importance_min }) {
  const rows = parseDatasetText(text, ref, { maxRows: 500 });
  const events = (Array.isArray(rows) ? rows : rows.events || [])
    .filter((event) => impactRank(event.impact) >= impactRank(importance_min));
  return { date, importance_min, events };
}

export function resolvePackCutoffUtc(pack) {
  const value = pack?.cutoff_utc
    || pack?.resolved_scope?.cutoff_utc
    || pack?.data_cutoff?.cutoff_utc
    || pack?.data_cutoff?.end_utc
    || pack?.data_cutoff?.to_utc
    || null;
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function scopedMacroResponse(pack, events, { date, importance_min }) {
  return {
    ok: true,
    date,
    importance_min,
    pack_id: pack.pack_id,
    pack_build_id: pack.pack_build_id,
    resolved_scope: pack.resolved_scope || null,
    scope_hash: pack.scope_hash || pack.resolved_scope?.scope_hash || null,
    source_manifest_hash: pack.source_manifest_hash || pack.manifest?.source_manifest_hash || null,
    events: (events || []).filter((event) => impactRank(event.impact) >= impactRank(importance_min)),
  };
}

export function impactRank(value) {
  const text = String(value || "").trim().toLowerCase();
  if (["high", "red", "critical"].includes(text)) return 3;
  if (["medium", "orange"].includes(text)) return 2;
  if (["low", "yellow"].includes(text)) return 1;
  return 0;
}

function normalizeNewsDataset(text, ref, { date, session }) {
  const parsed = parseDatasetText(text, ref, { maxRows: 500 });
  const items = Array.isArray(parsed) ? parsed : parsed.items || [];
  return {
    date,
    session,
    status: Array.isArray(parsed) ? (items.length ? "ready" : "empty") : parsed.status || (items.length ? "ready" : "empty"),
    source: Array.isArray(parsed) ? ref.source || null : parsed.source || ref.source || null,
    reason: Array.isArray(parsed) ? ref.reason || null : parsed.reason || ref.reason || null,
    empty_ok: Array.isArray(parsed) ? ref.empty_ok === true : parsed.empty_ok === true || ref.empty_ok === true,
    items,
    macro_context_fallback: Array.isArray(parsed) ? [] : parsed.macro_context_fallback || [],
  };
}

function scopedNewsResponse(pack, items, { date, session }) {
  return {
    ok: true,
    date,
    session,
    status: items.length ? "ready" : "empty",
    pack_id: pack.pack_id,
    pack_build_id: pack.pack_build_id,
    resolved_scope: pack.resolved_scope || null,
    scope_hash: pack.scope_hash || pack.resolved_scope?.scope_hash || null,
    source_manifest_hash: pack.source_manifest_hash || pack.manifest?.source_manifest_hash || null,
    items,
  };
}

function optionalNewsDigestUnavailable({ date, session }) {
  return {
    date,
    session,
    status: "not_configured",
    source: "no_historical_news_source_configured",
    reason: "historical_news_digest_source_not_configured",
    empty_ok: true,
    items: [],
    macro_context_fallback: [],
  };
}

export function replaySourceCoverage(pack) {
  const source = pack.source_coverage || pack.source_pack?.source_coverage || {};
  const datasets = pack.datasets || {};
  return {
    mode: source.mode || (pack.pack_purpose === "replay_source" ? "full_replay_range" : "decision_cutoff"),
    pack_purpose: pack.pack_purpose || pack.source_pack?.pack_purpose || "decision_cutoff",
    start_utc: source.start_utc || null,
    end_utc: source.end_utc || resolvePackCutoffUtc(pack),
    end_paris: source.end_paris || pack.cutoff_paris || pack.resolved_scope?.cutoff_paris || null,
    core_market_max_utc: {
      MNQ_M5: datasets.MNQ_M5?.max_timestamp_utc || datasets.MNQ_M5?.to_time_utc || null,
      MES_M5: datasets.MES_M5?.max_timestamp_utc || datasets.MES_M5?.to_time_utc || null,
      NQ_M15: datasets.NQ_M15?.max_timestamp_utc || datasets.NQ_M15?.to_time_utc || null,
      ES_M15: datasets.ES_M15?.max_timestamp_utc || datasets.ES_M15?.to_time_utc || null,
    },
  };
}

export function compactPack(pack) {
  const tradingDate = pack.trading_date || pack.date || pack.resolved_scope?.trading_date || null;
  return {
    pack_id: pack.pack_id || null,
    pack_build_id: pack.pack_build_id || pack.active_build_id || null,
    status: pack.status || null,
    pack_purpose: pack.pack_purpose || pack.source_pack?.pack_purpose || "decision_cutoff",
    source_coverage: replaySourceCoverage(pack),
    date: tradingDate,
    trading_date: tradingDate,
    strategy_id: pack.strategy_id || pack.resolved_scope?.strategy_id || null,
    session: pack.session || pack.resolved_scope?.session || null,
    timezone: pack.timezone || pack.resolved_scope?.timezone || null,
    cutoff_paris: pack.cutoff_paris || pack.resolved_scope?.cutoff_paris || pack.data_cutoff?.cutoff_paris || null,
    cutoff_utc: resolvePackCutoffUtc(pack),
    resolved_scope: pack.resolved_scope || null,
    scope_hash: pack.scope_hash || pack.resolved_scope?.scope_hash || null,
    source_manifest_hash: pack.source_manifest_hash || pack.manifest?.source_manifest_hash || null,
    manifest_generation: pack.manifest_generation || null,
    manifest: pack.manifest || null,
    data_cutoff: pack.data_cutoff || {},
    datasets: pack.datasets || {},
    summary: pack.summary || {},
    quality: pack.quality || {},
  };
}

function filterPacks(packs, { date_from, date_to, session, status, limit }) {
  const max = Math.max(1, Math.min(Number(limit) || 100, 500));
  return packs
    .filter((pack) => !session || pack.session === session)
    .filter((pack) => !status || status === "any" || pack.status === status)
    .filter((pack) => !date_from || String(pack.date || "") >= date_from)
    .filter((pack) => !date_to || String(pack.date || "") <= date_to)
    .sort((left, right) => String(right.date || right.pack_id || "").localeCompare(String(left.date || left.pack_id || "")))
    .slice(0, max);
}

function summarizePacks(packs) {
  return {
    count: packs.length,
    packs: packs.map((pack) => ({
      pack_id: pack.pack_id,
      date: pack.date,
      session: pack.session,
      status: pack.status,
      source: pack.data_cutoff?.source || pack.quality?.source || null,
      quality_status: pack.quality?.status || null,
      row_count_total: pack.quality?.row_count_total ?? null,
      missing_datasets: pack.quality?.missing_datasets || [],
      updated_at: pack.updated_at || null,
      published_at: pack.published_at || null,
    })),
  };
}

function comparePackFreshness(a, b) {
  const left = String(a.updated_at || a.created_at || a.pack_id || "");
  const right = String(b.updated_at || b.created_at || b.pack_id || "");
  return right.localeCompare(left);
}
