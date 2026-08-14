import { canonicalSha256 } from "./execution-scope.js";
import { buildResearchCandidateGenomeV1, compareResearchCandidateGenomesV1 } from "./research-candidate-genome-v1.js";

export const PORTFOLIO_VIRTUAL_PNL_ATTRIBUTION_SCHEMA_VERSION_V1 = "portfolio_virtual_pnl_attribution_v1";
export const PORTFOLIO_STRATEGY_SIMILARITY_SCHEMA_VERSION_V1 = "portfolio_strategy_similarity_v1";
export const PORTFOLIO_SIMILARITY_DECISIONS_V1 = Object.freeze(["OK", "TOO_SIMILAR", "DUPLICATE"]);

export function buildPortfolioVirtualPnlAttributionV1(input = {}) {
  const asOf = iso(firstDefined(input.as_of_utc, input.asOfUtc, new Date().toISOString()));
  const policy = normalizePolicy(firstDefined(input.policy, input.similarity_policy, {}));
  const ids = strategyIds(input);
  const attributions = ids.map((id) => attributionFor(id, input));
  const similarity = similarityModel(strategyGenomes(input), attributions, policy);
  const base = {
    schema_version: PORTFOLIO_VIRTUAL_PNL_ATTRIBUTION_SCHEMA_VERSION_V1,
    status: attributions.length ? "ATTRIBUTED" : "NO_STRATEGIES",
    as_of_utc: asOf,
    policy,
    portfolio_totals: portfolioTotals(attributions),
    strategy_attributions: attributions,
    similarity,
    allocation_impacts: allocationImpacts(similarity, attributions, policy),
  };
  return { ...base, attribution_hash: hash(base) };
}

function attributionFor(strategyId, input) {
  const trades = array(firstDefined(input.trades, input.virtual_trades)).filter((trade) => text(firstDefined(trade.strategy_instance_id, trade.strategy_id)) === strategyId);
  const totalR = round(trades.reduce((total, trade) => total + rValue(trade), 0));
  const wins = trades.filter((trade) => rValue(trade) > 0).length;
  const positions = virtualPositions(input).filter((item) => text(firstDefined(item.strategy_instance_id, item.strategy_id)) === strategyId);
  const allocationSize = candidateAllocationSize(strategyId, firstDefined(input.candidate_allocations, input.allocations));
  return {
    strategy_instance_id: strategyId,
    trade_count: trades.length,
    total_r: totalR,
    expectancy_r: trades.length ? round(totalR / trades.length) : null,
    win_rate: trades.length ? round(wins / trades.length) : null,
    open_signed_size: round(positions.reduce((total, item) => total + Number(item.open_signed_size || item.signed_size || 0), 0)),
    allocation_size: allocationSize,
    status: trades.length || allocationSize ? "ACTIVE" : "NO_TRADES",
  };
}

function similarityModel(genomes, attributions, policy) {
  const matrix = [];
  for (let leftIndex = 0; leftIndex < genomes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < genomes.length; rightIndex += 1) {
      matrix.push(similarityPair(genomes[leftIndex], genomes[rightIndex], attributions, policy));
    }
  }
  const alerts = matrix.filter((item) => item.decision !== "OK");
  const base = {
    schema_version: PORTFOLIO_STRATEGY_SIMILARITY_SCHEMA_VERSION_V1,
    duplicate_threshold: policy.duplicate_threshold,
    too_close_threshold: policy.too_close_threshold,
    pairs: matrix.sort((left, right) => right.similarity_score - left.similarity_score || left.left_strategy_instance_id.localeCompare(right.left_strategy_instance_id)),
    alerts,
  };
  return { ...base, similarity_hash: hash(base) };
}

function similarityPair(left, right, attributions, policy) {
  const comparison = compareResearchCandidateGenomesV1(left, right);
  const score = comparison.similarity_score;
  return {
    left_strategy_instance_id: strategyIdOfGenome(left),
    right_strategy_instance_id: strategyIdOfGenome(right),
    similarity_score: score,
    decision: score >= policy.duplicate_threshold ? "DUPLICATE" : score >= policy.too_close_threshold ? "TOO_SIMILAR" : "OK",
    weaker_strategy_instance_id: weakerStrategy(left, right, attributions),
    axis_scores: comparison.axis_scores,
    reason: comparison.reason,
  };
}

function allocationImpacts(similarity, attributions, policy) {
  const byId = new Map(attributions.map((item) => [item.strategy_instance_id, item]));
  const impacts = new Map();
  for (const pair of similarity.alerts) {
    const id = pair.weaker_strategy_instance_id;
    const current = impacts.get(id) || { strategy_instance_id: id, recommended_allocation_multiplier: 1, reasons: [] };
    current.recommended_allocation_multiplier = Math.min(current.recommended_allocation_multiplier, policy.too_close_allocation_multiplier);
    current.reasons.push({ code: pair.decision, similarity_score: pair.similarity_score, compared_with: otherId(pair, id), current_total_r: byId.get(id)?.total_r ?? null });
    impacts.set(id, current);
  }
  return [...impacts.values()].sort((left, right) => left.strategy_instance_id.localeCompare(right.strategy_instance_id));
}

function strategyGenomes(input) {
  return array(firstDefined(input.strategy_genomes, input.genomes, input.strategies)).map((item) => {
    const genome = buildResearchCandidateGenomeV1({ ...item, research_candidate_id: text(firstDefined(item.strategy_instance_id, item.research_candidate_id, item.id)) });
    return { ...genome, strategy_instance_id: text(firstDefined(item.strategy_instance_id, item.id, genome.research_candidate_id)) };
  }).sort((left, right) => strategyIdOfGenome(left).localeCompare(strategyIdOfGenome(right)));
}

function strategyIds(input) {
  const ids = new Set();
  for (const trade of array(firstDefined(input.trades, input.virtual_trades))) ids.add(text(firstDefined(trade.strategy_instance_id, trade.strategy_id)));
  for (const position of virtualPositions(input)) ids.add(text(firstDefined(position.strategy_instance_id, position.strategy_id)));
  for (const genome of array(firstDefined(input.strategy_genomes, input.genomes, input.strategies))) ids.add(text(firstDefined(genome.strategy_instance_id, genome.id, genome.research_candidate_id)));
  for (const allocation of array(firstDefined(input.candidate_allocations, input.allocations))) for (const signal of array(allocation.contributing_signals)) ids.add(text(signal.strategy_instance_id));
  return [...ids].filter(Boolean).sort();
}

function virtualPositions(input) {
  const portfolio = record(firstDefined(input.virtual_portfolio, input.portfolio)) || {};
  return array(firstDefined(input.virtual_positions, portfolio.by_strategy_instance, portfolio.positions));
}

function candidateAllocationSize(strategyId, allocationsInput) {
  let total = 0;
  for (const allocation of array(allocationsInput)) {
    for (const signal of array(allocation.contributing_signals)) {
      if (text(signal.strategy_instance_id) === strategyId) total += positiveOrZero(firstDefined(signal.approved_size, signal.proposed_size));
    }
  }
  return round(total);
}

function portfolioTotals(attributions) {
  const tradeCount = attributions.reduce((total, item) => total + item.trade_count, 0);
  const totalR = round(attributions.reduce((total, item) => total + item.total_r, 0));
  return { strategy_count: attributions.length, trade_count: tradeCount, total_r: totalR, expectancy_r: tradeCount ? round(totalR / tradeCount) : null };
}

function weakerStrategy(left, right, attributions) {
  const totals = new Map(attributions.map((item) => [item.strategy_instance_id, item.total_r]));
  const leftId = strategyIdOfGenome(left);
  const rightId = strategyIdOfGenome(right);
  const leftR = totals.get(leftId) ?? 0;
  const rightR = totals.get(rightId) ?? 0;
  if (leftR === rightR) return [leftId, rightId].sort()[1];
  return leftR < rightR ? leftId : rightId;
}

function otherId(pair, id) { return pair.left_strategy_instance_id === id ? pair.right_strategy_instance_id : pair.left_strategy_instance_id; }
function strategyIdOfGenome(genome) { return text(firstDefined(genome.strategy_instance_id, genome.research_candidate_id, genome.id)); }
function rValue(trade) { return finite(firstDefined(trade.net_r, trade.pnl_r, trade.result_r, trade.r)) || 0; }
function normalizePolicy(input) { const source = record(input) || {}; return { duplicate_threshold: score(source.duplicate_threshold, 0.92), too_close_threshold: score(source.too_close_threshold, 0.78), too_close_allocation_multiplier: score(source.too_close_allocation_multiplier, 0.5) }; }
function score(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback; }
function hash(value) { return `sha256:${canonicalSha256(value)}`; }
function array(value) { return Array.isArray(value) ? value : []; }
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
function firstDefined(...values) { return values.find((value) => value !== undefined && value !== null && value !== "") ?? null; }
function text(value) { return String(value ?? "").trim(); }
function finite(value) { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function positiveOrZero(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; }
function iso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function round(value) { return Math.round(Number(value || 0) * 10000) / 10000; }
