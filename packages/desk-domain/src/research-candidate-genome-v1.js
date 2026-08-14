import { canonicalSha256 } from "./execution-scope.js";

export const RESEARCH_CANDIDATE_GENOME_VERSION_V1 = "1.0.0";
export const RESEARCH_CANDIDATE_GENOME_SCHEMA_VERSION_V1 = "research_candidate_genome_v1";
export const RESEARCH_CANDIDATE_NOVELTY_SCHEMA_VERSION_V1 = "research_candidate_novelty_v1";
export const RESEARCH_CANDIDATE_KNOWLEDGE_NODE_SCHEMA_VERSION_V1 = "research_candidate_knowledge_node_v1";

export const RESEARCH_STRATEGY_FAMILIES_V1 = Object.freeze([
  "BREAKOUT_RETEST",
  "MOMENTUM_CONTINUATION",
  "MEAN_REVERSION",
  "RANGE_ROTATION",
  "VOLATILITY_EXPANSION",
  "EVENT_DRIVEN",
  "CROSS_ASSET_CONFIRMATION",
  "RISK_MANAGEMENT_VARIANT",
  "UNKNOWN",
]);

export const RESEARCH_MARKET_REGIMES_V1 = Object.freeze([
  "TREND",
  "RANGE",
  "LOW_VOL_COMPRESSION",
  "VOLATILITY_EXPANSION",
  "EVENT_WINDOW",
  "CROSS_ASSET_DIVERGENCE",
  "UNKNOWN",
]);

export const RESEARCH_NOVELTY_DECISIONS_V1 = Object.freeze(["NOVEL", "TOO_CLOSE", "DUPLICATE", "REVIEW"]);

const GENOME_AXES = Object.freeze([
  "family",
  "instruments",
  "timeframes",
  "session_scope",
  "entry_logic",
  "confirmation_signals",
  "exit_logic",
  "risk_model",
  "regime_filters",
]);

const FAMILY_RULES = Object.freeze([
  ["MEAN_REVERSION", ["mean", "reversion"]],
  ["RANGE_ROTATION", ["range", "rotation"]],
  ["EVENT_DRIVEN", ["event", "macro"]],
  ["CROSS_ASSET_CONFIRMATION", ["cross", "dxy", "vix"]],
  ["RISK_MANAGEMENT_VARIANT", ["risk", "stop"]],
  ["VOLATILITY_EXPANSION", ["volatility", "expansion"]],
  ["BREAKOUT_RETEST", ["breakout", "retest"]],
  ["MOMENTUM_CONTINUATION", ["momentum", "continuation"]],
]);

export function buildResearchCandidateGenomeV1(input = {}) {
  const source = object(firstPresent(input.candidate, input));
  const metadata = object(source.metadata);
  const summary = text(source.primary_change_summary || source.summary || input.summary);
  const dsl = object(firstPresent(input.dsl, source.dsl_source, metadata.dsl_source));
  const plan = object(firstPresent(input.deterministic_plan, source.deterministic_plan, metadata.deterministic_plan));
  const taxonomy = taxonomyFrom({ source, summary, dsl, plan, input });
  const genome = {
    schema_version: RESEARCH_CANDIDATE_GENOME_SCHEMA_VERSION_V1,
    genome_version: RESEARCH_CANDIDATE_GENOME_VERSION_V1,
    research_candidate_id: text(source.research_candidate_id || source.id),
    candidate_key: text(source.candidate_key),
    taxonomy,
    instruments: sortedStrings(firstPresent(input.instruments, source.instrument_scope, metadata.instruments, dsl.instruments, plan.instruments)),
    timeframes: sortedStrings(firstPresent(input.timeframes, source.timeframe_scope, metadata.timeframes, dsl.timeframes, plan.timeframes)),
    session_scope: sortedStrings(firstPresent(input.session_scope, source.session_scope, metadata.session_scope, dsl.session_scope)),
    entry_logic: sortedStrings(firstPresent(input.entry_logic, dsl.entry_logic, plan.entry_logic, keywords(summary, ["breakout", "retest", "vwap", "pullback", "range"]))),
    confirmation_signals: sortedStrings(firstPresent(input.confirmation_signals, dsl.confirmation_signals, plan.confirmation_signals, keywords(summary, ["rsi", "vwap", "dxy", "vix", "volume", "delta"]))),
    exit_logic: sortedStrings(firstPresent(input.exit_logic, dsl.exit_logic, plan.exit_logic, metadata.exit_logic)),
    risk_model: sortedStrings(firstPresent(input.risk_model, dsl.risk_model, plan.risk_model, metadata.risk_model)),
    regime_filters: sortedStrings(firstPresent(input.regime_filters, dsl.regime_filters, plan.regime_filters, taxonomy.regimes)),
    source_hashes: sortedStrings(sourceHashes(input.source_hashes, dsl, plan)),
  };
  return { ...genome, axis_signature: axisSignature(genome), genome_hash: hash(axisSignature(genome)) };
}

export function compareResearchCandidateGenomesV1(left = {}, right = {}) {
  const leftGenome = normalizeGenome(left);
  const rightGenome = normalizeGenome(right);
  const axisScores = GENOME_AXES.map((axis) => axisSimilarity(axis, leftGenome, rightGenome));
  const similarity = round4(axisScores.reduce((sum, item) => sum + item.score, 0) / axisScores.length);
  const exact = leftGenome.genome_hash && leftGenome.genome_hash === rightGenome.genome_hash;
  return {
    schema_version: RESEARCH_CANDIDATE_NOVELTY_SCHEMA_VERSION_V1,
    left_candidate_id: leftGenome.research_candidate_id,
    right_candidate_id: rightGenome.research_candidate_id,
    exact_duplicate: Boolean(exact),
    similarity_score: exact ? 1 : similarity,
    axis_scores: axisScores,
    reason: exact ? "GENOME_HASH_MATCH" : similarityReason(similarity),
  };
}

export function evaluateResearchCandidateNoveltyV1(input = {}) {
  const candidateGenome = buildResearchCandidateGenomeV1(input.candidate || input.genome || input);
  const duplicateThreshold = score(input.duplicate_threshold, 0.92);
  const tooCloseThreshold = score(input.too_close_threshold, 0.78);
  const comparisons = array(input.existing_genomes)
    .map((item) => compareResearchCandidateGenomesV1(candidateGenome, item))
    .sort((left, right) => right.similarity_score - left.similarity_score);
  const nearest = comparisons[0] || null;
  const noveltyScore = round4(1 - (nearest?.similarity_score || 0));
  const decision = noveltyDecision({ nearest, duplicateThreshold, tooCloseThreshold });
  const result = {
    schema_version: RESEARCH_CANDIDATE_NOVELTY_SCHEMA_VERSION_V1,
    genome_version: RESEARCH_CANDIDATE_GENOME_VERSION_V1,
    research_candidate_id: candidateGenome.research_candidate_id,
    genome_hash: candidateGenome.genome_hash,
    novelty_score: noveltyScore,
    decision,
    duplicate_threshold: duplicateThreshold,
    too_close_threshold: tooCloseThreshold,
    nearest_neighbors: comparisons.slice(0, 5),
    knowledge_graph_edges: knowledgeEdges(candidateGenome, nearest),
  };
  return { ...result, novelty_hash: hash(result) };
}

export function buildResearchCandidateKnowledgeNodeV1(input = {}) {
  const genome = buildResearchCandidateGenomeV1(input.candidate || input.genome || input);
  const node = {
    schema_version: RESEARCH_CANDIDATE_KNOWLEDGE_NODE_SCHEMA_VERSION_V1,
    genome_version: RESEARCH_CANDIDATE_GENOME_VERSION_V1,
    node_id: `research_candidate:${genome.research_candidate_id || genome.genome_hash.slice(7, 19)}`,
    labels: ["ResearchCandidate", "StrategyGenome", genome.taxonomy.family],
    properties: {
      research_candidate_id: genome.research_candidate_id,
      candidate_key: genome.candidate_key,
      family: genome.taxonomy.family,
      regimes: genome.taxonomy.regimes,
      genome_hash: genome.genome_hash,
      axis_signature: genome.axis_signature,
    },
    edges: knowledgeEdges(genome, null),
  };
  return { ...node, node_hash: hash(node) };
}

export function researchCandidateGenomeHashV1(input = {}) {
  return hash(input);
}

function taxonomyFrom({ source, summary, dsl, plan, input }) {
  const explicit = object(input.taxonomy || source.taxonomy || source.metadata?.taxonomy);
  const family = enumValue(explicit.family || dsl.pattern || plan.pattern || inferFamily(summary), RESEARCH_STRATEGY_FAMILIES_V1);
  const regimes = sortedEnums(explicit.regimes || explicit.market_regimes || input.regimes || inferRegimes(summary), RESEARCH_MARKET_REGIMES_V1);
  return {
    family,
    regimes: regimes.length ? regimes : ["UNKNOWN"],
    hypothesis_class: text(explicit.hypothesis_class || inferHypothesisClass(family)),
  };
}

function normalizeGenome(value) {
  return value?.schema_version === RESEARCH_CANDIDATE_GENOME_SCHEMA_VERSION_V1 ? value : buildResearchCandidateGenomeV1(value);
}

function axisSignature(genome) {
  return Object.fromEntries(GENOME_AXES.map((axis) => [axis, genomeAxisValue(axis, genome)]));
}

function genomeAxisValue(axis, genome) {
  if (axis === "family") return genome.taxonomy.family;
  return sortedStrings(genome[axis]);
}

function axisSimilarity(axis, left, right) {
  const leftValue = genomeAxisValue(axis, left);
  const rightValue = genomeAxisValue(axis, right);
  const scoreValue = axis === "family" ? (leftValue === rightValue ? 1 : 0) : jaccard(leftValue, rightValue);
  return { axis, score: round4(scoreValue), left: leftValue, right: rightValue };
}

function noveltyDecision({ nearest, duplicateThreshold, tooCloseThreshold }) {
  if (!nearest) return "NOVEL";
  if (nearest.exact_duplicate || nearest.similarity_score >= duplicateThreshold) return "DUPLICATE";
  if (nearest.similarity_score >= tooCloseThreshold) return "TOO_CLOSE";
  return "NOVEL";
}

function knowledgeEdges(genome, nearest) {
  const edges = [
    { type: "HAS_FAMILY", to: `strategy_family:${genome.taxonomy.family}` },
    ...genome.taxonomy.regimes.map((regime) => ({ type: "TARGETS_REGIME", to: `market_regime:${regime}` })),
  ];
  if (nearest) edges.push({ type: nearest.exact_duplicate ? "DUPLICATES" : "SIMILAR_TO", to: `research_candidate:${nearest.right_candidate_id}`, similarity_score: nearest.similarity_score });
  return edges;
}

function inferFamily(summary) {
  const value = summary.toLowerCase();
  const match = FAMILY_RULES.find(([, tokens]) => tokens.some((token) => value.includes(token)));
  return match ? match[0] : "UNKNOWN";
}

function inferRegimes(summary) {
  const value = summary.toLowerCase();
  const regimes = [];
  if (value.includes("trend") || value.includes("continuation")) regimes.push("TREND");
  if (value.includes("range")) regimes.push("RANGE");
  if (value.includes("compression") || value.includes("low vol")) regimes.push("LOW_VOL_COMPRESSION");
  if (value.includes("volatility") || value.includes("expansion")) regimes.push("VOLATILITY_EXPANSION");
  if (value.includes("event") || value.includes("macro")) regimes.push("EVENT_WINDOW");
  if (value.includes("cross") || value.includes("dxy") || value.includes("vix")) regimes.push("CROSS_ASSET_DIVERGENCE");
  return regimes;
}

function inferHypothesisClass(family) {
  return family === "UNKNOWN" ? "unclassified" : family.toLowerCase();
}

function keywords(summary, allowed) {
  const value = summary.toLowerCase();
  return allowed.filter((item) => value.includes(item));
}

function similarityReason(scoreValue) {
  if (scoreValue >= 0.92) return "GENOME_NEAR_DUPLICATE";
  if (scoreValue >= 0.78) return "GENOME_TOO_CLOSE";
  return "GENOME_DISTINCT";
}

function jaccard(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (union.size === 0) return 1;
  return [...leftSet].filter((item) => rightSet.has(item)).length / union.size;
}

function sortedEnums(value, allowed) {
  return sortedStrings(value).map((item) => enumValue(item, allowed)).filter((item) => item !== "UNKNOWN");
}

function enumValue(value, allowed) {
  const normalized = text(value).toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
  return allowed.includes(normalized) ? normalized : "UNKNOWN";
}

function sortedStrings(value) {
  return [...new Set(array(value).map((item) => text(item).toLowerCase()).filter(Boolean))].sort();
}

function sourceHashes(explicit, dsl, plan) {
  if (Array.isArray(explicit)) return explicit;
  const emptyHash = hash({});
  return [hash(dsl), hash(plan)].filter((item) => item !== emptyHash);
}

function firstPresent(...values) {
  return values.find((value) => value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0)) || null;
}

function score(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function hash(value) {
  return `sha256:${canonicalSha256(value)}`;
}
