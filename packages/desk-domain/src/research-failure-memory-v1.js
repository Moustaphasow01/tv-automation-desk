import { canonicalSha256 } from "./execution-scope.js";
import {
  buildResearchCandidateGenomeV1,
  compareResearchCandidateGenomesV1,
} from "./research-candidate-genome-v1.js";

export const RESEARCH_FAILURE_MEMORY_VERSION_V1 = "1.0.0";
export const RESEARCH_FAILURE_RECORD_SCHEMA_VERSION_V1 = "research_failure_record_v1";
export const RESEARCH_FAILURE_MEMORY_QUERY_SCHEMA_VERSION_V1 = "research_failure_memory_query_v1";
export const RESEARCH_FAILURE_MATCH_SCHEMA_VERSION_V1 = "research_failure_match_v1";
export const RESEARCH_FAILURE_KNOWLEDGE_NODE_SCHEMA_VERSION_V1 = "research_failure_knowledge_node_v1";

export const RESEARCH_FAILURE_RECORD_STATUSES_V1 = Object.freeze(["ACTIVE", "SUPERSEDED", "RETIRED"]);

export const RESEARCH_FAILURE_CAUSE_CODES_V1 = Object.freeze([
  "LOW_EDGE",
  "OVERFIT",
  "REGIME_DEPENDENT",
  "INSUFFICIENT_SAMPLE",
  "HIGH_DRAWDOWN",
  "POOR_RR",
  "EXECUTION_FRICTION",
  "DUPLICATE_OR_TOO_CLOSE",
  "DATA_QUALITY",
  "CONTRACT_VIOLATION",
  "OPERATOR_REJECTED",
  "UNKNOWN",
]);

export const RESEARCH_FAILURE_MEMORY_DECISIONS_V1 = Object.freeze([
  "BLOCK_RETEST",
  "REQUIRE_REVISION",
  "ALLOW_WITH_MEMORY",
  "NO_MATCH",
]);

export function buildResearchFailureRecordV1(input = {}) {
  const source = object(firstPresent(input.failure, input.record, input));
  const genome = buildResearchCandidateGenomeV1(firstPresent(input.candidate, source.candidate, source.candidate_genome, source.genome, source));
  const causeCodes = normalizeCauseCodes(firstPresent(source.cause_codes, source.causes, inferCauseCodes(source)));
  const evidenceRefs = sortedStrings(firstPresent(source.evidence_refs, source.evidence, source.artifact_refs));
  const negativeResultRef = firstText(source, ["negative_result_ref", "evaluation_report_id", "report_id"]);
  const rootCauseSummary = firstText(source, ["root_cause_summary", "summary", "reason"]);
  const failureId = textOr(source.failure_id, `failure:${shortHash([genome.genome_hash, causeCodes, negativeResultRef, rootCauseSummary])}`);
  const record = {
    schema_version: RESEARCH_FAILURE_RECORD_SCHEMA_VERSION_V1,
    memory_version: RESEARCH_FAILURE_MEMORY_VERSION_V1,
    failure_id: failureId,
    research_experiment_id: text(source.research_experiment_id),
    research_hypothesis_id: text(source.research_hypothesis_id),
    research_candidate_id: genome.research_candidate_id,
    candidate_key: genome.candidate_key,
    status: enumValue(source.status || "ACTIVE", RESEARCH_FAILURE_RECORD_STATUSES_V1),
    cause_codes: causeCodes,
    root_cause_summary: rootCauseSummary,
    negative_result_ref: negativeResultRef,
    evidence_refs: evidenceRefs,
    metrics_snapshot: object(firstPresent(source.metrics_snapshot, source.metrics)),
    candidate_genome: genome,
    recorded_at_utc: firstText(source, ["recorded_at_utc", "rejected_at_utc", "created_at_utc"]),
  };
  return { ...record, validation: validateFailureRecord(record), failure_hash: hash(record) };
}

export function matchResearchFailureMemoryV1(input = {}) {
  const candidateGenome = buildResearchCandidateGenomeV1(input.candidate || input.genome || input);
  const blockThreshold = score(input.block_threshold, 0.92);
  const reviewThreshold = score(input.review_threshold, 0.78);
  const limit = Math.max(1, Math.min(20, Number(input.limit) || 5));
  const candidateCauses = normalizeCauseCodes(input.cause_codes || input.expected_failure_causes);
  const matches = array(input.failure_records || input.memory_records || input.records)
    .map((item) => buildResearchFailureRecordV1(item))
    .filter((record) => record.status === "ACTIVE")
    .map((record) => failureMatch(candidateGenome, record, candidateCauses, { blockThreshold, reviewThreshold }))
    .sort((left, right) => right.memory_score - left.memory_score);
  const decision = memoryDecision(matches[0], { blockThreshold, reviewThreshold });
  const result = {
    schema_version: RESEARCH_FAILURE_MEMORY_QUERY_SCHEMA_VERSION_V1,
    memory_version: RESEARCH_FAILURE_MEMORY_VERSION_V1,
    research_candidate_id: candidateGenome.research_candidate_id,
    genome_hash: candidateGenome.genome_hash,
    block_threshold: blockThreshold,
    review_threshold: reviewThreshold,
    decision,
    nearest_failures: matches.slice(0, limit),
    blocking_failure_ids: matches.filter((item) => item.memory_score >= blockThreshold).map((item) => item.failure_id),
  };
  return { ...result, memory_hash: hash(result) };
}

export function evaluateResearchFailureMemoryGateV1(input = {}) {
  const memory = matchResearchFailureMemoryV1(input);
  const rejected = memory.decision === "BLOCK_RETEST";
  const review = memory.decision === "REQUIRE_REVISION";
  return {
    ok: !rejected,
    status: rejected ? "rejected" : review ? "review_required" : "accepted",
    reasons: failureMemoryReasons(memory),
    memory,
  };
}

export function buildResearchFailureKnowledgeNodeV1(input = {}) {
  const record = buildResearchFailureRecordV1(input.failure || input.record || input);
  const node = {
    schema_version: RESEARCH_FAILURE_KNOWLEDGE_NODE_SCHEMA_VERSION_V1,
    memory_version: RESEARCH_FAILURE_MEMORY_VERSION_V1,
    node_id: `research_failure:${record.failure_id.replace(/^failure:/, "")}`,
    labels: ["ResearchFailure", "NegativeResult", record.candidate_genome.taxonomy.family],
    properties: {
      failure_id: record.failure_id,
      research_candidate_id: record.research_candidate_id,
      candidate_key: record.candidate_key,
      status: record.status,
      cause_codes: record.cause_codes,
      genome_hash: record.candidate_genome.genome_hash,
      negative_result_ref: record.negative_result_ref,
    },
    edges: failureKnowledgeEdges(record),
  };
  return { ...node, node_hash: hash(node) };
}

export function researchFailureMemoryHashV1(input = {}) {
  return hash(input);
}

function failureMatch(candidateGenome, record, candidateCauses, thresholds) {
  const comparison = compareResearchCandidateGenomesV1(candidateGenome, record.candidate_genome);
  const causeOverlapScore = candidateCauses.length ? jaccard(candidateCauses, record.cause_codes) : 0;
  const memoryScore = round4(Math.max(comparison.similarity_score, comparison.similarity_score * 0.9 + causeOverlapScore * 0.1));
  return {
    schema_version: RESEARCH_FAILURE_MATCH_SCHEMA_VERSION_V1,
    failure_id: record.failure_id,
    failed_candidate_id: record.research_candidate_id,
    failed_candidate_key: record.candidate_key,
    similarity_score: comparison.similarity_score,
    cause_overlap_score: round4(causeOverlapScore),
    memory_score: memoryScore,
    exact_duplicate: comparison.exact_duplicate,
    decision_hint: scoreDecision(memoryScore, thresholds),
    cause_codes: record.cause_codes,
    evidence_refs: record.evidence_refs,
    negative_result_ref: record.negative_result_ref,
    root_cause_summary: record.root_cause_summary,
  };
}

function scoreDecision(memoryScore, { blockThreshold, reviewThreshold }) {
  if (memoryScore >= blockThreshold) return "BLOCK_RETEST";
  if (memoryScore >= reviewThreshold) return "REQUIRE_REVISION";
  return "ALLOW_WITH_MEMORY";
}

function memoryDecision(nearest, thresholds) {
  if (!nearest) return "NO_MATCH";
  return scoreDecision(nearest.memory_score, thresholds);
}

function validateFailureRecord(record) {
  const issues = [];
  if (!record.cause_codes.length || record.cause_codes.includes("UNKNOWN")) issues.push("FAILURE_CAUSE_REQUIRED");
  if (!record.evidence_refs.length) issues.push("FAILURE_EVIDENCE_REQUIRED");
  if (!record.negative_result_ref) issues.push("NEGATIVE_RESULT_REF_REQUIRED");
  if (!record.root_cause_summary) issues.push("ROOT_CAUSE_SUMMARY_REQUIRED");
  return { ok: issues.length === 0, issues };
}

function failureMemoryReasons(memory) {
  if (memory.decision === "NO_MATCH") return ["NO_PRIOR_FAILURE_MATCH"];
  const nearest = memory.nearest_failures[0];
  return [`${memory.decision}:${nearest.failure_id}:${nearest.memory_score}`];
}

function failureKnowledgeEdges(record) {
  return [
    { type: "FAILED_CANDIDATE", to: `research_candidate:${record.research_candidate_id}` },
    { type: "HAS_GENOME", to: `strategy_genome:${record.candidate_genome.genome_hash}` },
    ...record.cause_codes.map((code) => ({ type: "FAILED_BECAUSE", to: `failure_cause:${code}` })),
    ...record.evidence_refs.map((ref) => ({ type: "EVIDENCED_BY", to: ref })),
  ];
}

function inferCauseCodes(source) {
  const value = text(source.root_cause_summary || source.summary || source.reason).toLowerCase();
  const inferred = [];
  if (value.includes("overfit")) inferred.push("OVERFIT");
  if (value.includes("drawdown")) inferred.push("HIGH_DRAWDOWN");
  if (value.includes("sample")) inferred.push("INSUFFICIENT_SAMPLE");
  if (value.includes("friction") || value.includes("slippage")) inferred.push("EXECUTION_FRICTION");
  if (value.includes("duplicate") || value.includes("too close")) inferred.push("DUPLICATE_OR_TOO_CLOSE");
  if (value.includes("data")) inferred.push("DATA_QUALITY");
  return inferred.length ? inferred : ["UNKNOWN"];
}

function normalizeCauseCodes(value) {
  return sortedStrings(value).map((item) => enumValue(item, RESEARCH_FAILURE_CAUSE_CODES_V1)).filter(Boolean);
}

function firstPresent(...values) {
  return values.find((value) => value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0)) || null;
}

function firstText(source, keys) {
  return text(keys.map((key) => source[key]).find((value) => text(value)));
}

function textOr(value, fallback) {
  return text(value) || fallback;
}

function enumValue(value, allowed) {
  const normalized = text(value).toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
  return allowed.includes(normalized) ? normalized : "UNKNOWN";
}

function sortedStrings(value) {
  return [...new Set(array(value).map((item) => text(item)).filter(Boolean))].sort();
}

function score(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
}

function jaccard(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (union.size === 0) return 1;
  return [...leftSet].filter((item) => rightSet.has(item)).length / union.size;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function shortHash(value) {
  return canonicalSha256(value).slice(0, 16);
}

function hash(value) {
  return `sha256:${canonicalSha256(value)}`;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
