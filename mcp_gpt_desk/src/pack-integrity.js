import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import { canonicalSha256 } from "@tv-automation/desk-domain";
import { toParisIso } from "@tv-automation/desk-time";
import { parseCsv, parseCsvLine } from "./csv.js";

export const PACK_BUILD_SCHEMA_VERSION = "2.0.0";
export const DATASET_MANIFEST_SCHEMA_VERSION = "1.0.0";
export const PACK_BUILD_STATUSES = Object.freeze([
  "building",
  "ready",
  "degraded",
  "compromised",
  "quarantined",
  "superseded",
]);

export class DeskIntegrityError extends Error {
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = "DeskIntegrityError";
    this.code = code;
    this.details = details;
  }
}

export function buildPackBuildId(packId, uuid = randomUUID()) {
  return `packbuild__${sanitizePathSegment(packId)}__${sanitizePathSegment(uuid)}`;
}

export function immutableDatasetObjectName({ storagePrefix = "desk-data", packId, packBuildId, dataset, extension = "csv" }) {
  requireIdentifier(packId, "pack_id");
  requireIdentifier(packBuildId, "pack_build_id");
  requireIdentifier(dataset, "dataset");
  const ext = String(extension || "csv").replace(/^\./, "").toLowerCase();
  return [
    trimSlashes(storagePrefix),
    "packs",
    sanitizePathSegment(packId),
    "builds",
    sanitizePathSegment(packBuildId),
    "raw",
    `${sanitizePathSegment(dataset)}.${ext}`,
  ].filter(Boolean).join("/");
}

export function analyzeDatasetBytes({ buffer, dataset, format, cutoffUtc = null, asOfUtc = null } = {}) {
  const bytes = toBuffer(buffer);
  const text = bytes.toString("utf8");
  const parsed = parseRows(text, format);
  const rows = parsed.rows;
  const columns = parsed.columns;
  const isPrice = isPriceDataset(dataset, rows);
  const timestamps = [];
  const duplicateKeys = new Set();
  const seenKeys = new Set();
  let outOfOrder = false;
  let previousTimestamp = -Infinity;
  let timezoneInvalid = false;
  const hardCutoff = earliestInstant(cutoffUtc, asOfUtc);
  const expected = expectedDatasetShape(dataset);

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (isPrice) validatePriceRowScope(row, { dataset, expected, index });
    const timestamp = observationTimestamp(row);
    if (timestamp) {
      const epochMs = Date.parse(timestamp);
      if (!Number.isFinite(epochMs)) {
        throw new DeskIntegrityError("DATASET_SCHEMA_MISMATCH", "Dataset contains an invalid observation timestamp.", {
          dataset,
          row_index: index,
          timestamp,
        });
      }
      if (epochMs < previousTimestamp) outOfOrder = true;
      previousTimestamp = epochMs;
      timestamps.push({ epochMs, value: new Date(epochMs).toISOString(), row_index: index });

      if (isPrice && row.timestamp_paris != null && !validParisTimestamp(row.timestamp_paris, epochMs)) {
        timezoneInvalid = true;
      }
    }
    const cutoffFields = isPrice
      ? ["bar_close_utc", "knowledge_timestamp_utc", "source_snapshot_timestamp_utc"]
      : String(dataset) === "news_digest"
        ? ["published_at_utc", "knowledge_timestamp_utc", "source_snapshot_timestamp_utc"]
        : ["knowledge_timestamp_utc", "source_snapshot_timestamp_utc"];
    for (const field of cutoffFields) {
      if (!row?.[field]) continue;
      const valueMs = parseRequiredInstant(row[field], field);
      if (hardCutoff && valueMs > Date.parse(hardCutoff)) {
        throw new DeskIntegrityError("LOOKAHEAD_DETECTED", "Dataset contains information known after the allowed cutoff.", {
          dataset,
          row_index: index,
          field,
          timestamp_utc: new Date(valueMs).toISOString(),
          allowed_until_utc: hardCutoff,
        });
      }
    }
    const duplicateKey = rowIdentity(row, index);
    if (seenKeys.has(duplicateKey)) duplicateKeys.add(duplicateKey);
    seenKeys.add(duplicateKey);
  }

  if (outOfOrder) {
    throw new DeskIntegrityError("DATASET_SCHEMA_MISMATCH", "Dataset observations are not ordered chronologically.", { dataset });
  }
  if (duplicateKeys.size) {
    throw new DeskIntegrityError("DATASET_SCHEMA_MISMATCH", "Dataset contains duplicate observations.", {
      dataset,
      duplicate_count: duplicateKeys.size,
    });
  }
  if (timezoneInvalid) {
    throw new DeskIntegrityError("TIMEZONE_INVALID", "timestamp_paris is not a real Europe/Paris conversion.", { dataset });
  }

  const minTimestamp = timestamps.length ? timestamps[0].value : null;
  const maxTimestamp = timestamps.length ? timestamps.at(-1).value : null;
  if (isPrice && maxTimestamp) {
    if (hardCutoff && Date.parse(maxTimestamp) > Date.parse(hardCutoff)) {
      throw new DeskIntegrityError("LOOKAHEAD_DETECTED", "Dataset contains an observation after the allowed cutoff.", {
        dataset,
        max_timestamp_utc: maxTimestamp,
        allowed_until_utc: hardCutoff,
      });
    }
  }

  return {
    buffer: bytes,
    text,
    rows,
    columns,
    format: parsed.format,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    crc32c: crc32cBase64(bytes),
    size_bytes: bytes.length,
    row_count: rows.length,
    min_timestamp_utc: minTimestamp,
    max_timestamp_utc: maxTimestamp,
  };
}

export function buildDatasetManifestEntry({
  packId,
  packBuildId,
  strategyId,
  session,
  dataset,
  cutoffUtc,
  objectPath,
  generation,
  source,
  buffer,
  format,
  sourceRef = {},
} = {}) {
  const analysis = analyzeDatasetBytes({ buffer, dataset, format, cutoffUtc, asOfUtc: cutoffUtc });
  return {
    pack_id: packId,
    pack_build_id: packBuildId,
    strategy_id: strategyId,
    session,
    dataset,
    schema_version: DATASET_MANIFEST_SCHEMA_VERSION,
    cutoff_utc: normalizeUtc(cutoffUtc),
    object_path: objectPath,
    storage_path: objectPath,
    gcs_generation: generation == null ? null : String(generation),
    sha256: analysis.sha256,
    checksum: analysis.sha256,
    crc32c: analysis.crc32c,
    size_bytes: analysis.size_bytes,
    row_count: analysis.row_count,
    min_timestamp_utc: analysis.min_timestamp_utc,
    max_timestamp_utc: analysis.max_timestamp_utc,
    columns: analysis.columns,
    format: analysis.format,
    source: source || sourceRef.source || null,
    source_ref: sourceRef.source_ref || sourceRef.storage_path || sourceRef.local_path || null,
    timezone: "Europe/Paris",
  };
}

export function buildSourceManifest({ packId, packBuildId, scope, datasets, createdAtUtc } = {}) {
  const manifest = {
    manifest_schema_version: DATASET_MANIFEST_SCHEMA_VERSION,
    pack_id: packId,
    pack_build_id: packBuildId,
    resolved_scope: scope,
    created_at_utc: createdAtUtc,
    datasets: Object.fromEntries(Object.entries(datasets || {}).sort(([left], [right]) => left.localeCompare(right))),
  };
  return { ...manifest, source_manifest_hash: canonicalSha256(manifest) };
}

export function validateDatasetObject({ ref, buffer, metadata = {}, dataset, cutoffUtc, asOfUtc } = {}) {
  if (!ref || typeof ref !== "object") {
    throw new DeskIntegrityError("DATASET_NOT_FOUND", `Dataset manifest entry is missing: ${dataset}.`, { dataset });
  }
  const required = ["pack_id", "pack_build_id", "strategy_id", "session", "sha256", "crc32c", "size_bytes", "row_count"];
  const missing = required.filter((field) => ref[field] === null || ref[field] === undefined || ref[field] === "");
  if (missing.length) {
    throw new DeskIntegrityError("DATASET_SCHEMA_MISMATCH", "Dataset manifest is incomplete.", { dataset, missing });
  }
  if (ref.dataset && ref.dataset !== dataset) {
    throw new DeskIntegrityError("DATASET_SCOPE_MISMATCH", "Requested dataset does not match its manifest entry.", {
      requested_dataset: dataset,
      manifest_dataset: ref.dataset,
    });
  }
  const objectPath = String(ref.object_path || ref.storage_path || "");
  const expectedPathFragment = `/packs/${sanitizePathSegment(ref.pack_id)}/builds/${sanitizePathSegment(ref.pack_build_id)}/raw/`;
  if (!objectPath.includes(expectedPathFragment)) {
    throw new DeskIntegrityError("DATASET_SCOPE_MISMATCH", "Dataset object path is outside its immutable pack build namespace.", {
      dataset,
      object_path: objectPath || null,
      expected_path_fragment: expectedPathFragment,
    });
  }

  const actual = analyzeDatasetBytes({
    buffer,
    dataset,
    format: ref.format || ref.object_path || ref.storage_path,
    cutoffUtc: cutoffUtc || ref.cutoff_utc,
    asOfUtc,
  });
  const actualGeneration = metadata.generation == null ? null : String(metadata.generation);
  const expectedGeneration = ref.gcs_generation == null ? null : String(ref.gcs_generation);
  if (expectedGeneration && actualGeneration !== expectedGeneration) {
    throw new DeskIntegrityError("DATASET_GENERATION_MISMATCH", "GCS generation does not match the pinned manifest.", {
      dataset,
      expected_generation: expectedGeneration,
      actual_generation: actualGeneration,
    });
  }

  const comparisons = {
    sha256: [String(ref.sha256), actual.sha256],
    crc32c: [String(ref.crc32c), actual.crc32c],
    size_bytes: [Number(ref.size_bytes), actual.size_bytes],
    row_count: [Number(ref.row_count), actual.row_count],
  };
  const mismatches = Object.entries(comparisons)
    .filter(([, [expected, observed]]) => expected !== observed)
    .map(([field, [expected, observed]]) => ({ field, expected, actual: observed }));
  if (mismatches.length) {
    throw new DeskIntegrityError("DATASET_INTEGRITY_MISMATCH", "Dataset bytes do not match the immutable manifest.", {
      dataset,
      mismatches,
    });
  }
  compareManifestTimestamp(ref, actual, "min_timestamp_utc");
  compareManifestTimestamp(ref, actual, "max_timestamp_utc");
  if (Array.isArray(ref.columns) && canonicalColumns(ref.columns) !== canonicalColumns(actual.columns)) {
    throw new DeskIntegrityError("DATASET_SCHEMA_MISMATCH", "Dataset columns do not match the manifest.", {
      dataset,
      expected_columns: ref.columns,
      actual_columns: actual.columns,
    });
  }

  return {
    valid: true,
    expected: {
      generation: expectedGeneration,
      sha256: ref.sha256,
      crc32c: ref.crc32c,
      size_bytes: Number(ref.size_bytes),
      row_count: Number(ref.row_count),
      min_timestamp_utc: ref.min_timestamp_utc || null,
      max_timestamp_utc: ref.max_timestamp_utc || null,
    },
    actual: {
      generation: actualGeneration || expectedGeneration,
      sha256: actual.sha256,
      crc32c: actual.crc32c,
      size_bytes: actual.size_bytes,
      row_count: actual.row_count,
      min_timestamp_utc: actual.min_timestamp_utc,
      max_timestamp_utc: actual.max_timestamp_utc,
    },
    analysis: actual,
  };
}

export function sanitizeMacroActualsAtCutoff(events, cutoffUtc) {
  const cutoffMs = parseRequiredInstant(cutoffUtc, "cutoff_utc");
  return (events || []).map((event) => {
    if (!actualPresent(event.actual)) return { ...event, actual_visible_at_cutoff: false };
    const publication = firstPresent(
      event.actual_published_at_utc,
      event.actual_available_at_utc,
      event.published_at_utc,
      event.released_at_utc,
      event.actual_published_at_paris,
      event.actual_available_at_paris,
      event.published_at_paris,
      event.released_at_paris,
    );
    const publishedMs = parseOptionalInstant(publication);
    if (!Number.isFinite(publishedMs) || publishedMs > cutoffMs) {
      return {
        ...event,
        actual: null,
        actual_hidden: true,
        actual_visible_at_cutoff: false,
        actual_hidden_reason: "published_after_cutoff_or_unknown",
      };
    }
    return { ...event, actual_hidden: false, actual_visible_at_cutoff: true, actual_hidden_reason: null };
  });
}

export function filterNewsAtCutoff(items, cutoffUtc) {
  const cutoffMs = parseRequiredInstant(cutoffUtc, "cutoff_utc");
  return (items || []).filter((item) => {
    const publication = item?.published_at_utc || item?.published_at_paris;
    const publishedMs = parseOptionalInstant(publication);
    return Number.isFinite(publishedMs) && publishedMs <= cutoffMs;
  });
}

export function crc32cBase64(input) {
  const buffer = toBuffer(input);
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32C_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  const value = (crc ^ 0xffffffff) >>> 0;
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value, 0);
  return bytes.toString("base64");
}

function parseRows(text, formatHint) {
  const hint = String(formatHint || "").toLowerCase();
  if (hint.includes("json") || hint.endsWith(".json")) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new DeskIntegrityError("DATASET_SCHEMA_MISMATCH", "Dataset JSON cannot be parsed.", { error: error.message });
    }
    const rows = Array.isArray(parsed) ? parsed : parsed.events || parsed.items || parsed.rows || [];
    if (!Array.isArray(rows)) {
      throw new DeskIntegrityError("DATASET_SCHEMA_MISMATCH", "Dataset JSON does not contain an array of rows.");
    }
    return { format: "json", rows, columns: uniqueColumns(rows) };
  }

  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length > 0);
  const columns = lines.length ? parseCsvLine(lines[0]).map((column) => column.trim()) : [];
  if (new Set(columns).size !== columns.length) {
    throw new DeskIntegrityError("DATASET_SCHEMA_MISMATCH", "Dataset CSV contains duplicate columns.");
  }
  return { format: "csv", rows: parseCsv(text, { maxRows: Number.MAX_SAFE_INTEGER }), columns };
}

function observationTimestamp(row) {
  return firstPresent(
    row?.bar_close_utc,
    row?.timestamp_utc,
    row?.knowledge_timestamp_utc,
    row?.source_snapshot_timestamp_utc,
    row?.published_at_utc,
  );
}

function expectedDatasetShape(dataset) {
  const name = String(dataset || "").toUpperCase();
  const match = name.match(/^(MNQ|MES|NQ|ES)_(M5|M15|H1|H4)$/);
  if (!match) return { instrument: null, timeframe: null };
  return { instrument: match[1], timeframe: canonicalTimeframe(match[2]) };
}

function validatePriceRowScope(row, { dataset, expected, index }) {
  for (const field of ["open", "high", "low", "close"]) {
    if (!Number.isFinite(Number(row?.[field]))) {
      throw new DeskIntegrityError("DATASET_SCHEMA_MISMATCH", "Price dataset contains a non-numeric OHLC value.", {
        dataset,
        row_index: index,
        field,
        value: row?.[field] ?? null,
      });
    }
  }
  const closed = String(row?.is_closed ?? row?.bar_closed ?? row?.status ?? "").trim().toLowerCase();
  if (["false", "0", "open", "partial", "forming"].includes(closed)) {
    throw new DeskIntegrityError("LOOKAHEAD_DETECTED", "Partial or unclosed candles cannot be included in a pack.", {
      dataset,
      row_index: index,
    });
  }
  const actualInstrument = String(row?.asset || row?.instrument || row?.symbol || "").toUpperCase().replace("1!", "");
  if (expected.instrument && actualInstrument && actualInstrument !== expected.instrument) {
    throw new DeskIntegrityError("DATASET_SCOPE_MISMATCH", "Dataset contains a row for another instrument.", {
      dataset,
      row_index: index,
      expected_instrument: expected.instrument,
      actual_instrument: actualInstrument,
    });
  }
  const actualTimeframe = canonicalTimeframe(row?.timeframe);
  if (expected.timeframe && actualTimeframe && actualTimeframe !== expected.timeframe) {
    throw new DeskIntegrityError("DATASET_SCOPE_MISMATCH", "Dataset contains a row for another timeframe.", {
      dataset,
      row_index: index,
      expected_timeframe: expected.timeframe,
      actual_timeframe: actualTimeframe,
    });
  }
}

function canonicalTimeframe(value) {
  const text = String(value || "").trim().toUpperCase();
  return ({ M5: "5", "5M": "5", "5": "5", M15: "15", "15M": "15", "15": "15", H1: "1H", "1H": "1H", "60": "1H", H4: "4H", "4H": "4H", "240": "4H" })[text] || text;
}

function canonicalColumns(columns) {
  return [...new Set((columns || []).map((column) => String(column)))].sort().join("\u0000");
}

function isPriceDataset(dataset, rows) {
  if (["macro_calendar", "news_digest"].includes(String(dataset))) return false;
  return (rows || []).some((row) => row && ("open" in row || "high" in row || "low" in row || "close" in row));
}

function validParisTimestamp(value, epochMs) {
  const text = String(value || "");
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed) || parsed !== epochMs) return false;
  const expected = toParisIso(epochMs);
  return text.slice(-6) === expected.slice(-6);
}

function rowIdentity(row, index) {
  const timestamp = observationTimestamp(row);
  if (!timestamp) return `row:${index}`;
  return [timestamp, row.asset || row.instrument || "", row.timeframe || "", row.event || row.title || ""].join("|");
}

function compareManifestTimestamp(ref, actual, field) {
  if (!ref[field] && !actual[field]) return;
  if (normalizeNullableInstant(ref[field]) !== normalizeNullableInstant(actual[field])) {
    throw new DeskIntegrityError("DATASET_INTEGRITY_MISMATCH", `${field} does not match the manifest.`, {
      field,
      expected: ref[field] || null,
      actual: actual[field] || null,
    });
  }
}

function earliestInstant(...values) {
  const instants = values.filter(Boolean).map((value) => normalizeUtc(value));
  return instants.sort().at(0) || null;
}

function normalizeUtc(value) {
  const epochMs = parseRequiredInstant(value, "timestamp");
  return new Date(epochMs).toISOString();
}

function normalizeNullableInstant(value) {
  return value ? normalizeUtc(value) : null;
}

function parseRequiredInstant(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    throw new DeskIntegrityError("DATASET_SCHEMA_MISMATCH", `${field} must be a valid timestamp.`, { field, value });
  }
  return parsed;
}

function parseOptionalInstant(value) {
  if (!value) return NaN;
  return Date.parse(String(value));
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.from(String(value ?? ""), "utf8");
}

function uniqueColumns(rows) {
  return [...new Set((rows || []).flatMap((row) => Object.keys(row || {})))].sort();
}

function actualPresent(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function firstPresent(...values) {
  return values.find((value) => value !== null && value !== undefined && String(value).trim() !== "") ?? null;
}

function requireIdentifier(value, field) {
  if (!String(value || "").trim()) {
    throw new DeskIntegrityError("INVALID_SCOPE", `${field} is required.`, { field });
  }
}

function sanitizePathSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function trimSlashes(value) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

export function extensionForDatasetPath(path, fallbackFormat = "csv") {
  return extname(String(path || "")).replace(/^\./, "") || String(fallbackFormat || "csv").replace(/^\./, "");
}

const CRC32C_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0x82f63b78 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();
