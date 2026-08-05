import { canonicalSha256 } from "@tv-automation/desk-domain";

const BASE_EVIDENCE = {
  schema_version: "v5_june11_r2_import_evidence_v1",
  trading_date: "2026-06-11",
  import_id: "tv_m1_backfill__0fd35d23ff12a8e3bdc84781266458350b02a55b",
  source_project: "tradingview_m1_backfill",
  source_kind: "csv",
  mode: "import",
  source: "tradingview",
  environment: "prod",
  timezone: "Europe/Paris",
  timeframe: "1",
  manifest_sha256: "0fd35d23ff12a8e3bdc84781266458350b02a55bf00a7d5eb8e924846c13e054",
  manifest_schema_version: "tradingview-m1-backfill-manifest-v2",
  capture_proof_sha256: "0af3a904dc924e558c775292a5d7b4b1d0766ae22bb341cc8d8c6144937d507c",
  capture_policy_version: "settled_closed_bar_v2",
  capture_proof_row_count: 2_640,
  minimum_settlement_lag_seconds: 119,
  premature_capture_count: 0,
  window: {
    start_paris: "2026-06-11T00:00:00+02:00",
    end_paris: "2026-06-11T22:00:00+02:00",
    start_utc: "2026-06-10T22:00:00.000Z",
    end_utc: "2026-06-11T20:00:00.000Z",
    semantics: "[start,end)",
  },
  files: [
    {
      dataset: "MNQ_M1",
      feed_id: "prod__tradingview__MNQ1!__1",
      symbol: "MNQ1!",
      file: "mnq1_m1.csv",
      sha256: "e6a1269a67570b5eb9b2c2de5f6582383a2952fb34a1dc01cfad277558fa7e3a",
      row_count: 1_320,
    },
    {
      dataset: "MES_M1",
      feed_id: "prod__tradingview__MES1!__1",
      symbol: "MES1!",
      file: "mes1_m1.csv",
      sha256: "c2d13f82e504308fa379a348a97c12289e8aa73c464005210e0c7628b3f0ff61",
      row_count: 1_320,
    },
  ],
  total_m1_rows: 2_640,
  expected_complete_m5_buckets: 528,
};

export const V5_JUNE11_R2_IMPORT_EVIDENCE = deepFreeze({
  ...BASE_EVIDENCE,
  evidence_sha256: canonicalSha256(BASE_EVIDENCE),
});

export class V5June11R2EvidenceError extends Error {
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = "V5June11R2EvidenceError";
    this.code = code;
    this.details = details;
  }
}

export async function verifyV5June11R2Import(pool) {
  if (!pool?.query) {
    throw evidenceError("V5_JUNE11_R2_POSTGRES_REQUIRED", "PostgreSQL is required to verify the sealed June 11 r2 import.");
  }
  const expected = V5_JUNE11_R2_IMPORT_EVIDENCE;
  const receiptResult = await pool.query(`
    SELECT import_id, source_project, source_kind::text, mode::text, status::text,
           options, report
    FROM desk_import_runs
    WHERE import_id = $1::text
    LIMIT 1
  `, [expected.import_id]);
  const receipt = receiptResult.rows?.[0] || null;
  if (!receipt) {
    throw evidenceError("V5_JUNE11_R2_IMPORT_REQUIRED", "The sealed June 11 r2 import receipt is missing.", {
      import_id: expected.import_id,
    });
  }
  assertImportReceipt(receipt, expected);

  const coverageResult = await pool.query(`
    SELECT feed_id, symbol_code,
           count(*)::integer AS row_count,
           count(DISTINCT timestamp_utc)::integer AS unique_timestamp_count,
           min(timestamp_utc) AS min_timestamp_utc,
           max(timestamp_utc) AS max_timestamp_utc,
           count(*) FILTER (WHERE is_closed IS NOT TRUE)::integer AS unclosed_count,
           count(*) FILTER (WHERE source_collection IS DISTINCT FROM 'tradingview_m1_backfill')::integer AS source_collection_mismatch_count,
           count(*) FILTER (WHERE raw->>'source' IS DISTINCT FROM 'tradingview_csv_backfill')::integer AS source_kind_mismatch_count,
           count(*) FILTER (WHERE raw->>'import_id' IS DISTINCT FROM $2::text)::integer AS import_id_mismatch_count,
           count(*) FILTER (WHERE raw->>'manifest_sha256' IS DISTINCT FROM $3::text)::integer AS manifest_mismatch_count,
           count(*) FILTER (WHERE raw->>'capture_proof_sha256' IS DISTINCT FROM $4::text)::integer AS proof_mismatch_count,
           count(*) FILTER (WHERE raw->>'capture_policy_version' IS DISTINCT FROM $5::text)::integer AS policy_mismatch_count,
           array_agg(DISTINCT raw->>'source_file_sha256' ORDER BY raw->>'source_file_sha256') AS source_file_sha256s
    FROM market_candles
    WHERE feed_id = ANY($1::text[])
      AND timestamp_utc >= $6::timestamptz
      AND timestamp_utc < $7::timestamptz
    GROUP BY feed_id, symbol_code
    ORDER BY feed_id
  `, [
    expected.files.map((file) => file.feed_id),
    expected.import_id,
    expected.manifest_sha256,
    expected.capture_proof_sha256,
    expected.capture_policy_version,
    expected.window.start_utc,
    expected.window.end_utc,
  ]);
  assertExactCoverage(coverageResult.rows || [], expected);
  return cloneJson(expected);
}

export function assertV5June11R2PackEvidence(pack, expected = V5_JUNE11_R2_IMPORT_EVIDENCE) {
  const mismatches = [];
  if (!pack || typeof pack !== "object") {
    throw evidenceError("V5_JUNE11_R2_PACK_EVIDENCE_MISMATCH", "The June 11 replay pack is missing.");
  }
  compareSubset(pack.source_evidence, expected, "pack.source_evidence", mismatches);
  compareSubset(pack.resolved_scope?.source_evidence, expected, "pack.resolved_scope.source_evidence", mismatches);
  for (const file of expected.files) {
    const dataset = pack.datasets?.[file.dataset];
    compareSubset(dataset, {
      source_import_id: expected.import_id,
      source_import_manifest_sha256: expected.manifest_sha256,
      source_capture_proof_sha256: expected.capture_proof_sha256,
      source_capture_policy_version: expected.capture_policy_version,
      source_file_sha256: file.sha256,
    }, `pack.datasets.${file.dataset}`, mismatches);
    if (pack.actual_coverage?.datasets?.[file.dataset]?.complete !== true) {
      mismatches.push({
        path: `pack.actual_coverage.datasets.${file.dataset}.complete`,
        expected: true,
        actual: pack.actual_coverage?.datasets?.[file.dataset]?.complete,
      });
    }
  }
  if (mismatches.length) {
    throw evidenceError("V5_JUNE11_R2_PACK_EVIDENCE_MISMATCH", "The replay pack is not sealed against the verified June 11 r2 import.", { mismatches });
  }
  return true;
}

function assertImportReceipt(receipt, expected) {
  const mismatches = [];
  compareSubset(receipt, {
    import_id: expected.import_id,
    source_project: expected.source_project,
    source_kind: expected.source_kind,
    mode: expected.mode,
    status: "completed",
  }, "receipt", mismatches);
  const options = jsonObject(receipt.options);
  compareSubset(options, {
    manifest_sha256: expected.manifest_sha256,
    manifest_schema_version: expected.manifest_schema_version,
    capture_proof_sha256: expected.capture_proof_sha256,
    capture_policy_version: expected.capture_policy_version,
    minimum_settlement_lag_seconds: expected.minimum_settlement_lag_seconds,
    window: {
      start_paris: expected.window.start_paris,
      end_paris: expected.window.end_paris,
      semantics: expected.window.semantics,
    },
    symbols: expected.files.map((file) => file.symbol),
  }, "receipt.options", mismatches);
  const report = jsonObject(receipt.report);
  compareSubset(report, {
    import_id: expected.import_id,
    manifest: { sha256: expected.manifest_sha256, schema_version: expected.manifest_schema_version },
    capture_proof: {
      sha256: expected.capture_proof_sha256,
      row_count: expected.capture_proof_row_count,
      policy_version: expected.capture_policy_version,
      minimum_settlement_lag_seconds: expected.minimum_settlement_lag_seconds,
      premature_capture_count: expected.premature_capture_count,
    },
    scope: {
      source: expected.source,
      environment: expected.environment,
      timezone: expected.timezone,
      timeframe: expected.timeframe,
      symbols: expected.files.map((file) => file.symbol),
      window: {
        start_paris: expected.window.start_paris,
        end_paris: expected.window.end_paris,
        semantics: expected.window.semantics,
      },
    },
    files: expected.files.map((file) => ({
      file: file.file,
      symbol: file.symbol,
      sha256: file.sha256,
      row_count: file.row_count,
    })),
    rows: { staged: expected.total_m1_rows, conflicts: 0, overwritten: 0 },
    validation_summary: {
      conflicts: 0,
      m5_compared: expected.expected_complete_m5_buckets,
      m5_mismatch: 0,
    },
    cross_timeframe: {
      expected_complete_buckets: expected.expected_complete_m5_buckets,
      complete_buckets: expected.expected_complete_m5_buckets,
      compared_buckets: expected.expected_complete_m5_buckets,
      missing_m5_buckets: 0,
      exact_match_buckets: expected.expected_complete_m5_buckets,
      mismatched_buckets: 0,
      divergent_buckets: 0,
    },
  }, "receipt.report", mismatches);
  const inserted = Number(report.rows?.inserted);
  const identical = Number(report.rows?.identical_noop);
  if (!Number.isInteger(inserted) || !Number.isInteger(identical)
    || inserted + identical !== expected.total_m1_rows) {
    mismatches.push({
      path: "receipt.report.rows.inserted+identical_noop",
      expected: expected.total_m1_rows,
      actual: `${inserted}+${identical}`,
    });
  }
  if (mismatches.length) {
    throw evidenceError("V5_JUNE11_R2_IMPORT_RECEIPT_MISMATCH", "The June 11 r2 import receipt does not match the sealed evidence.", { mismatches });
  }
}

function assertExactCoverage(rows, expected) {
  const byFeed = new Map(rows.map((row) => [row.feed_id, row]));
  const mismatches = [];
  for (const file of expected.files) {
    const row = byFeed.get(file.feed_id);
    compareSubset(row, {
      feed_id: file.feed_id,
      symbol_code: file.symbol,
      row_count: file.row_count,
      unique_timestamp_count: file.row_count,
      min_timestamp_utc: expected.window.start_utc,
      max_timestamp_utc: new Date(Date.parse(expected.window.end_utc) - 60_000).toISOString(),
      unclosed_count: 0,
      source_collection_mismatch_count: 0,
      source_kind_mismatch_count: 0,
      import_id_mismatch_count: 0,
      manifest_mismatch_count: 0,
      proof_mismatch_count: 0,
      policy_mismatch_count: 0,
      source_file_sha256s: [file.sha256],
    }, `coverage.${file.feed_id}`, mismatches, normalizeCoverageValue);
  }
  if (rows.length !== expected.files.length) {
    mismatches.push({ path: "coverage.feed_count", expected: expected.files.length, actual: rows.length });
  }
  if (mismatches.length) {
    throw evidenceError("V5_JUNE11_R2_M1_COVERAGE_MISMATCH", "Canonical PostgreSQL M1 rows do not exactly match the June 11 r2 source evidence.", { mismatches });
  }
}

function compareSubset(actual, expected, path, mismatches, normalize = identity) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)
      || canonicalSha256(actual.map(normalize)) !== canonicalSha256(expected.map(normalize))) {
      mismatches.push({ path, expected, actual });
    }
    return;
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") {
      mismatches.push({ path, expected, actual });
      return;
    }
    for (const [key, value] of Object.entries(expected)) {
      compareSubset(actual[key], value, `${path}.${key}`, mismatches, normalize);
    }
    return;
  }
  if (normalize(actual) !== normalize(expected)) mismatches.push({ path, expected, actual });
}

function normalizeCoverageValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return value;
}

function jsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try { return JSON.parse(String(value || "{}")); } catch { return {}; }
}

function evidenceError(code, message, details = {}) {
  return new V5June11R2EvidenceError(code, message, details);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function identity(value) { return value; }
