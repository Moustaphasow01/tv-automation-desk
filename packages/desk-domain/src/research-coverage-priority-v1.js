import { canonicalSha256 } from "./execution-scope.js";
import {
  buildResearchCandidateGenomeV1,
  RESEARCH_MARKET_REGIMES_V1,
  RESEARCH_STRATEGY_FAMILIES_V1,
} from "./research-candidate-genome-v1.js";
import {
  buildResearchKnowledgeGraphFromArtifactsV1,
  RESEARCH_KNOWLEDGE_GRAPH_SCHEMA_VERSION_V1,
} from "./research-knowledge-graph-v1.js";

export const RESEARCH_COVERAGE_PRIORITY_VERSION_V1 = "1.0.0";
export const RESEARCH_COVERAGE_MODEL_SCHEMA_VERSION_V1 = "research_coverage_model_v1";
export const RESEARCH_PRIORITY_SCORE_SCHEMA_VERSION_V1 = "research_priority_score_v1";
export const RESEARCH_PRIORITY_PLAN_SCHEMA_VERSION_V1 = "research_priority_plan_v1";
export const RESEARCH_COVERAGE_FRONT_SUMMARY_SCHEMA_VERSION_V1 = "research_coverage_front_summary_v1";

export const RESEARCH_COVERAGE_DIMENSIONS_V1 = Object.freeze(["families", "regimes", "instruments", "timeframes", "sessions"]);
export const RESEARCH_PRIORITY_DECISIONS_V1 = Object.freeze(["HIGH_PRIORITY", "MEDIUM_PRIORITY", "LOW_PRIORITY", "DEFER"]);
export const RESEARCH_PRIORITY_WEIGHTS_V1 = Object.freeze({ coverage_gap: 0.35, novelty: 0.25, potential: 0.25, cost: -0.1, risk: -0.05 });

export function buildResearchCoverageModelV1(input = {}) {
  const vectors = candidateVectors(input);
  const targets = coverageTargets(input.targets || {});
  const dimensions = Object.fromEntries(RESEARCH_COVERAGE_DIMENSIONS_V1.map((dimension) => [dimension, coverageDimension(dimension, targets[dimension], vectors)]));
  const gaps = RESEARCH_COVERAGE_DIMENSIONS_V1.flatMap((dimension) => dimensions[dimension].missing_values.map((value) => ({ dimension, value, gap_score: dimensions[dimension].gap_ratio })));
  const model = {
    schema_version: RESEARCH_COVERAGE_MODEL_SCHEMA_VERSION_V1,
    coverage_version: RESEARCH_COVERAGE_PRIORITY_VERSION_V1,
    vector_count: vectors.length,
    dimensions,
    gaps: gaps.sort((left, right) => right.gap_score - left.gap_score || left.dimension.localeCompare(right.dimension)),
  };
  return { ...model, coverage_hash: stableHash(model) };
}

export function scoreResearchPriorityV1(input = {}) {
  const candidate = buildResearchCandidateGenomeV1(input.candidate || input.genome || input);
  const coverage = input.coverage_model?.schema_version === RESEARCH_COVERAGE_MODEL_SCHEMA_VERSION_V1 ? input.coverage_model : buildResearchCoverageModelV1(input);
  const factors = {
    coverage_gap: coverageGapForCandidate(candidate, coverage),
    novelty: bounded(input.novelty_score, 0.5),
    potential: bounded(input.potential_score, 0.5),
    cost: bounded(input.cost_score, 0.5),
    risk: bounded(input.risk_score, 0.5),
  };
  const priorityScore = bounded(Object.entries(RESEARCH_PRIORITY_WEIGHTS_V1).reduce((sum, [key, weight]) => sum + factors[key] * weight, 0) + 0.25, 0);
  const result = {
    schema_version: RESEARCH_PRIORITY_SCORE_SCHEMA_VERSION_V1,
    coverage_version: RESEARCH_COVERAGE_PRIORITY_VERSION_V1,
    research_candidate_id: candidate.research_candidate_id,
    candidate_key: candidate.candidate_key,
    genome_hash: candidate.genome_hash,
    priority_score: round4(priorityScore),
    decision: priorityDecision(priorityScore),
    factors,
    audit: { weights: RESEARCH_PRIORITY_WEIGHTS_V1, covered_gaps: coveredGaps(candidate, coverage) },
  };
  return { ...result, priority_hash: stableHash(result) };
}

export function rankResearchPrioritiesV1(input = {}) {
  const coverageModel = buildResearchCoverageModelV1(input);
  const scores = list(input.candidates || input.genomes)
    .map((candidate) => scoreResearchPriorityV1({ ...input, candidate, coverage_model: coverageModel }))
    .sort((left, right) => right.priority_score - left.priority_score || String(left.candidate_key).localeCompare(String(right.candidate_key)));
  const plan = {
    schema_version: RESEARCH_PRIORITY_PLAN_SCHEMA_VERSION_V1,
    coverage_version: RESEARCH_COVERAGE_PRIORITY_VERSION_V1,
    coverage_model: coverageModel,
    priorities: scores,
    next_best: scores[0] || null,
  };
  return { ...plan, plan_hash: stableHash(plan) };
}

export function summarizeResearchCoverageForFrontV1(input = {}) {
  const plan = input.schema_version === RESEARCH_PRIORITY_PLAN_SCHEMA_VERSION_V1 ? input : rankResearchPrioritiesV1(input);
  const weakest = Object.entries(plan.coverage_model.dimensions).sort((left, right) => right[1].gap_ratio - left[1].gap_ratio)[0] || null;
  const summary = {
    schema_version: RESEARCH_COVERAGE_FRONT_SUMMARY_SCHEMA_VERSION_V1,
    coverage_hash: plan.coverage_model.coverage_hash,
    vector_count: plan.coverage_model.vector_count,
    gap_count: plan.coverage_model.gaps.length,
    weakest_dimension: weakest ? weakest[0] : null,
    weakest_gap_ratio: weakest ? weakest[1].gap_ratio : 0,
    top_priorities: plan.priorities.slice(0, 5).map((item) => ({ candidate_key: item.candidate_key, decision: item.decision, priority_score: item.priority_score })),
  };
  return { ...summary, summary_hash: stableHash(summary) };
}

export function researchCoveragePriorityHashV1(input = {}) {
  return stableHash(input);
}

function candidateVectors(input) {
  const graph = graphFrom(input);
  const graphVectors = list(graph.nodes).filter((node) => node.type === "ResearchCandidate").map((node) => vectorFromProperties(node.properties));
  const explicitSource = input.graph || input.genomes ? list(input.candidates || input.genomes) : [];
  const explicitVectors = explicitSource.map((candidate) => vectorFromGenome(buildResearchCandidateGenomeV1(candidate)));
  return [...graphVectors, ...explicitVectors].filter((item) => item.family);
}

function graphFrom(input) {
  if (input.graph?.schema_version === RESEARCH_KNOWLEDGE_GRAPH_SCHEMA_VERSION_V1) return input.graph;
  if (input.experiments || input.candidates || input.failure_records || input.evaluation_reports) return buildResearchKnowledgeGraphFromArtifactsV1(input);
  return { nodes: [] };
}

function coverageTargets(targets) {
  return {
    families: uniqueText(targets.families || RESEARCH_STRATEGY_FAMILIES_V1.filter((item) => item !== "UNKNOWN")),
    regimes: uniqueText(targets.regimes || RESEARCH_MARKET_REGIMES_V1.filter((item) => item !== "UNKNOWN")),
    instruments: uniqueText(targets.instruments || ["mnq", "mes"]),
    timeframes: uniqueText(targets.timeframes || ["m1", "m5", "m15"]),
    sessions: uniqueText(targets.sessions || ["asia_open", "ny_open"]),
  };
}

function coverageDimension(dimension, targetValues, vectors) {
  const observed = uniqueText(vectors.flatMap((vector) => vector[dimension]));
  const missing = targetValues.filter((value) => !observed.includes(value));
  const covered = targetValues.filter((value) => observed.includes(value));
  return {
    target_values: targetValues,
    observed_values: observed,
    missing_values: missing,
    coverage_ratio: ratio(covered.length, targetValues.length),
    gap_ratio: ratio(missing.length, targetValues.length),
  };
}

function coverageGapForCandidate(candidate, coverage) {
  const vector = vectorFromGenome(candidate);
  const scores = RESEARCH_COVERAGE_DIMENSIONS_V1.map((dimension) => coverage.dimensions[dimension].missing_values.some((value) => vector[dimension].includes(value)) ? coverage.dimensions[dimension].gap_ratio : 0);
  return round4(Math.max(0, ...scores));
}

function coveredGaps(candidate, coverage) {
  const vector = vectorFromGenome(candidate);
  return coverage.gaps.filter((gap) => vector[gap.dimension].includes(gap.value));
}

function vectorFromGenome(genome) {
  return {
    family: genome.taxonomy.family,
    families: [genome.taxonomy.family],
    regimes: list(genome.taxonomy.regimes),
    instruments: list(genome.instruments),
    timeframes: list(genome.timeframes),
    sessions: list(genome.session_scope),
  };
}

function vectorFromProperties(properties = {}) {
  const axis = object(properties.axis_signature);
  return {
    family: valueText(properties.family),
    families: uniqueText(properties.family),
    regimes: uniqueText(properties.regimes),
    instruments: uniqueText(axis.instruments),
    timeframes: uniqueText(axis.timeframes),
    sessions: uniqueText(axis.session_scope),
  };
}

function priorityDecision(score) {
  if (score >= 0.7) return "HIGH_PRIORITY";
  if (score >= 0.5) return "MEDIUM_PRIORITY";
  if (score >= 0.3) return "LOW_PRIORITY";
  return "DEFER";
}

function ratio(part, total) {
  return total > 0 ? round4(part / total) : 1;
}

function uniqueText(value) {
  return [...new Set(list(value).map(valueText).filter(Boolean))].sort();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function bounded(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
}

function list(value) {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined || value === "" ? [] : [value];
}

function valueText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function stableHash(value) {
  return `sha256:${canonicalSha256(value)}`;
}
