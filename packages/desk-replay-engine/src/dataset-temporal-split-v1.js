import { canonicalSha256 } from "@tv-automation/desk-domain";

export const DATASET_TEMPORAL_SPLIT_SCHEMA_VERSION_V1 = "dataset_temporal_split_manifest_v1";
export const DATASET_TEMPORAL_SPLIT_POLICY_ID_V1 = "desk_dataset_temporal_split_policy_v1";
export const DATASET_TEMPORAL_SPLIT_POLICY_VERSION_V1 = "1.0.0";
export const DATASET_TEMPORAL_SPLIT_ROLES_V1 = Object.freeze(["TRAIN", "VALIDATION", "OUT_OF_SAMPLE"]);

export const DEFAULT_DATASET_TEMPORAL_SPLIT_POLICY_V1 = Object.freeze({
  policy_id: DATASET_TEMPORAL_SPLIT_POLICY_ID_V1,
  policy_version: DATASET_TEMPORAL_SPLIT_POLICY_VERSION_V1,
  boundary_policy: "START_INCLUSIVE_END_EXCLUSIVE",
  min_train_rows: 1,
  min_validation_rows: 1,
  min_out_of_sample_rows: 1,
  require_contiguous_roles: true,
});

export function buildTemporalDatasetSplitManifestV1(input = {}) {
  const policy = normalizePolicy(input.policy);
  const splits = normalizeSplits(input.splits);
  const coverage = normalizeCoverage(input.coverage) || splitCoverageSummaryV1({ splits, rows: input.rows });
  const validation = validateSplitRangesV1({ splits, coverage, policy });
  const manifest = {
    schema_version: DATASET_TEMPORAL_SPLIT_SCHEMA_VERSION_V1,
    dataset_temporal_split_id: text(input.dataset_temporal_split_id),
    split_key: text(input.split_key),
    dataset_id: text(input.dataset_id),
    dataset_hash: text(input.dataset_hash),
    policy_snapshot: policy,
    policy_hash: `sha256:${canonicalSha256(policy)}`,
    boundary_policy: policy.boundary_policy,
    roles: DATASET_TEMPORAL_SPLIT_ROLES_V1,
    splits,
    coverage,
    validation,
    metadata: objectOrEmpty(input.metadata),
    created_at_utc: text(input.created_at_utc),
  };
  return {
    ...manifest,
    split_hash: splitManifestHashV1(manifest),
  };
}

export function splitManifestHashV1(manifest = {}) {
  return `sha256:${canonicalSha256(hashableManifest(manifest))}`;
}

export function validateTemporalSplitNoLeakageV1(input = {}) {
  const manifest = objectOrEmpty(input.manifest);
  const splits = normalizeSplits(manifest.splits || input.splits);
  const policy = normalizePolicy(input.policy || manifest.policy_snapshot);
  const coverage = normalizeCoverage(input.coverage || manifest.coverage) || splitCoverageSummaryV1({ splits, rows: input.rows });
  const rangeValidation = validateSplitRangesV1({ splits, coverage, policy });
  const rowViolations = validateRows(input.rows, splits);
  const runViolations = validateRunUsages(input.run_usages, splits);
  const violations = [...rangeValidation.violations, ...rowViolations, ...runViolations];
  return {
    schema_version: "dataset_temporal_split_leakage_report_v1",
    split_hash: text(manifest.split_hash) || splitManifestHashV1({ ...manifest, splits }),
    status: violations.length ? "FAIL" : rangeValidation.status,
    ok: violations.length === 0 && rangeValidation.ok,
    reasons: [...rangeValidation.reasons, ...violations.map((violation) => violation.reason)],
    violations,
    coverage: splitCoverageSummaryV1({ splits, rows: input.rows, run_usages: input.run_usages }),
  };
}

export function assignRowsToTemporalSplitsV1(rows = [], manifest = {}) {
  const splits = normalizeSplits(manifest.splits);
  const buckets = Object.fromEntries(DATASET_TEMPORAL_SPLIT_ROLES_V1.map((role) => [role, []]));
  const dropped_rows = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const role = roleForTimestamp(timestamp(row), splits);
    if (role) buckets[role].push(row);
    else dropped_rows.push(row);
  }
  return {
    schema_version: "dataset_temporal_split_assignment_v1",
    split_hash: text(manifest.split_hash) || splitManifestHashV1(manifest),
    rows_by_role: buckets,
    counts: Object.fromEntries(Object.entries(buckets).map(([role, items]) => [role, items.length])),
    dropped_row_count: dropped_rows.length,
    dropped_rows,
  };
}

export function splitCoverageSummaryV1(input = {}) {
  const splits = normalizeSplits(input.splits || input.manifest?.splits);
  const assigned = assignCounts(input.rows, splits);
  const runCounts = runUsageCounts(input.run_usages);
  return {
    rows_by_role: assigned.counts,
    dropped_row_count: assigned.dropped,
    run_count_by_role: runCounts,
    range_start_utc: splits[0]?.start_utc || null,
    range_end_utc: splits[splits.length - 1]?.end_utc || null,
  };
}

export function validateSplitRangesV1(input = {}) {
  const splits = normalizeSplits(input.splits);
  const policy = normalizePolicy(input.policy);
  const coverage = objectOrEmpty(input.coverage);
  const violations = [
    ...missingRoleViolations(splits),
    ...rangeOrderViolations(splits, policy),
    ...minimumCoverageViolations(coverage.rows_by_role, policy),
  ];
  return {
    status: violations.length ? "FAIL" : "PASS",
    ok: violations.length === 0,
    reasons: violations.map((violation) => violation.reason),
    violations,
  };
}

function normalizeSplits(splits = []) {
  return (Array.isArray(splits) ? splits : [])
    .map((split) => ({
      role: normalizeRole(split.role),
      start_utc: isoOrNull(split.start_utc || split.start),
      end_utc: isoOrNull(split.end_utc || split.end),
      dataset_id: text(split.dataset_id),
      metadata: objectOrEmpty(split.metadata),
    }))
    .filter((split) => split.role)
    .sort((left, right) => Date.parse(left.start_utc || "") - Date.parse(right.start_utc || ""));
}

function normalizePolicy(policy = {}) {
  return {
    ...DEFAULT_DATASET_TEMPORAL_SPLIT_POLICY_V1,
    ...objectOrEmpty(policy),
    policy_id: text(policy.policy_id) || DEFAULT_DATASET_TEMPORAL_SPLIT_POLICY_V1.policy_id,
    policy_version: text(policy.policy_version) || DEFAULT_DATASET_TEMPORAL_SPLIT_POLICY_V1.policy_version,
  };
}

function missingRoleViolations(splits) {
  return DATASET_TEMPORAL_SPLIT_ROLES_V1
    .filter((role) => !splits.some((split) => split.role === role))
    .map((role) => violation("ROLE_MISSING", role));
}

function rangeOrderViolations(splits, policy) {
  const violations = [];
  for (const split of splits) {
    if (!split.start_utc || !split.end_utc || Date.parse(split.end_utc) <= Date.parse(split.start_utc)) violations.push(violation("INVALID_RANGE", split.role));
  }
  for (let index = 1; index < splits.length; index += 1) {
    violations.push(...adjacencyViolations(splits[index - 1], splits[index], policy));
  }
  return violations;
}

function adjacencyViolations(previous, current, policy) {
  const issues = [];
  if (Date.parse(current.start_utc) < Date.parse(previous.end_utc)) issues.push(violation("SPLIT_RANGE_OVERLAP", `${previous.role}_${current.role}`));
  if (policy.require_contiguous_roles && current.start_utc !== previous.end_utc) issues.push(violation("SPLIT_RANGE_GAP", `${previous.role}_${current.role}`));
  return issues;
}

function minimumCoverageViolations(rowsByRole = {}, policy) {
  return [
    minCoverageViolation("TRAIN", rowsByRole.TRAIN, policy.min_train_rows),
    minCoverageViolation("VALIDATION", rowsByRole.VALIDATION, policy.min_validation_rows),
    minCoverageViolation("OUT_OF_SAMPLE", rowsByRole.OUT_OF_SAMPLE, policy.min_out_of_sample_rows),
  ].filter(Boolean);
}

function minCoverageViolation(role, count, minimum) {
  if (Number(count || 0) >= Number(minimum || 0)) return null;
  return violation("SPLIT_MINIMUM_COVERAGE_NOT_MET", role, { count: Number(count || 0), minimum: Number(minimum || 0) });
}

function validateRows(rows = [], splits = []) {
  return (Array.isArray(rows) ? rows : []).flatMap((row, index) => rowLeakageViolations(row, index, splits));
}

function rowLeakageViolations(row, index, splits) {
  const expectedRole = normalizeRole(row.split_role || row.role);
  if (!expectedRole) return [];
  const actualRole = roleForTimestamp(timestamp(row), splits);
  if (actualRole === expectedRole) return [];
  return [violation("ROW_ROLE_TIMESTAMP_LEAKAGE", expectedRole, { row_index: index, actual_role: actualRole })];
}

function validateRunUsages(runUsages = [], splits = []) {
  return (Array.isArray(runUsages) ? runUsages : []).flatMap((usage, index) => runUsageViolations(usage, index, splits));
}

function runUsageViolations(usage, index, splits) {
  const role = normalizeRole(usage.split_role || usage.role);
  const split = splits.find((candidate) => candidate.role === role);
  if (!split) return [violation("RUN_SPLIT_ROLE_UNKNOWN", role || "UNKNOWN", { run_index: index })];
  return [
    ...runTimestampViolations(usage, split, index),
    ...selectionCutoffViolations(usage, splits, role, index),
  ];
}

function runTimestampViolations(usage, split, index) {
  const sourceEnd = isoOrNull(usage.source_data_end_utc || usage.source_end_utc);
  const cutoff = isoOrNull(usage.cutoff_utc || usage.cutoff);
  return [
    afterEndViolation(sourceEnd, split.end_utc, "RUN_SOURCE_DATA_AFTER_SPLIT_END", index),
    afterEndViolation(cutoff, split.end_utc, "RUN_CUTOFF_AFTER_SPLIT_END", index),
  ].filter(Boolean);
}

function selectionCutoffViolations(usage, splits, role, index) {
  const trainEnd = splitEnd(splits, "TRAIN");
  const validationEnd = splitEnd(splits, "VALIDATION");
  return [
    role !== "TRAIN" ? afterEndViolation(isoOrNull(usage.training_cutoff_utc), trainEnd, "TRAINING_CUTOFF_USES_VALIDATION_OR_OOS", index) : null,
    role === "OUT_OF_SAMPLE" ? afterEndViolation(isoOrNull(usage.candidate_selection_cutoff_utc), validationEnd, "OOS_USES_POST_VALIDATION_SELECTION", index) : null,
  ].filter(Boolean);
}

function afterEndViolation(value, end, reason, index) {
  if (!value || !end || Date.parse(value) <= Date.parse(end)) return null;
  return violation(reason, "RUN_USAGE", { run_index: index, value, end });
}

function assignCounts(rows = [], splits = []) {
  const counts = Object.fromEntries(DATASET_TEMPORAL_SPLIT_ROLES_V1.map((role) => [role, 0]));
  let dropped = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const role = roleForTimestamp(timestamp(row), splits);
    if (role) counts[role] += 1;
    else dropped += 1;
  }
  return { counts, dropped };
}

function runUsageCounts(runUsages = []) {
  const counts = Object.fromEntries(DATASET_TEMPORAL_SPLIT_ROLES_V1.map((role) => [role, 0]));
  for (const usage of Array.isArray(runUsages) ? runUsages : []) {
    const role = normalizeRole(usage.split_role || usage.role);
    if (role) counts[role] += 1;
  }
  return counts;
}

function normalizeCoverage(coverage) {
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) return null;
  return {
    rows_by_role: {
      TRAIN: Number(coverage.rows_by_role?.TRAIN || 0),
      VALIDATION: Number(coverage.rows_by_role?.VALIDATION || 0),
      OUT_OF_SAMPLE: Number(coverage.rows_by_role?.OUT_OF_SAMPLE || 0),
    },
    dropped_row_count: Number(coverage.dropped_row_count || 0),
    run_count_by_role: coverage.run_count_by_role || {},
    range_start_utc: text(coverage.range_start_utc),
    range_end_utc: text(coverage.range_end_utc),
  };
}

function roleForTimestamp(value, splits) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return null;
  const split = splits.find((candidate) => time >= Date.parse(candidate.start_utc) && time < Date.parse(candidate.end_utc));
  return split?.role || null;
}

function timestamp(row = {}) {
  return isoOrNull(row.timestamp_utc || row.timestamp || row.time || row.t);
}

function splitEnd(splits, role) {
  return splits.find((split) => split.role === role)?.end_utc || null;
}

function hashableManifest(manifest) {
  const { split_hash, validation, coverage, ...hashable } = objectOrEmpty(manifest);
  return hashable;
}

function violation(reason, role, extra = {}) {
  return { reason, role, ...extra };
}

function normalizeRole(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (["OOS", "OUT_OF_SAMPLE", "OUT_OF_SAMPLE_TEST"].includes(normalized)) return "OUT_OF_SAMPLE";
  return DATASET_TEMPORAL_SPLIT_ROLES_V1.includes(normalized) ? normalized : null;
}

function isoOrNull(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
