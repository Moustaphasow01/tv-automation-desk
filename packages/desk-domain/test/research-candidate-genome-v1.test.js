import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildResearchCandidateGenomeV1,
  buildResearchCandidateKnowledgeNodeV1,
  compareResearchCandidateGenomesV1,
  evaluateResearchCandidateNoveltyV1,
} from "../index.js";

test("TD2-507 builds a stable genome hash from normalized taxonomy axes", () => {
  const left = buildResearchCandidateGenomeV1(candidate({
    instruments: ["MES", "MNQ"],
    timeframes: ["M15", "M1"],
    confirmation_signals: ["VWAP", "RSI"],
  }));
  const right = buildResearchCandidateGenomeV1(candidate({
    instruments: ["MNQ", "MES", "MNQ"],
    timeframes: ["M1", "M15"],
    confirmation_signals: ["RSI", "VWAP"],
  }));

  assert.equal(left.genome_hash, right.genome_hash);
  assert.equal(left.taxonomy.family, "BREAKOUT_RETEST");
  assert.deepEqual(left.instruments, ["mes", "mnq"]);
});

test("TD2-507 infers family and regimes for unclassified raw candidates", () => {
  const genome = buildResearchCandidateGenomeV1(candidate({
    primary_change_summary: "Cross asset DXY/VIX filter for macro event continuation after low vol compression.",
  }));

  assert.equal(genome.taxonomy.family, "EVENT_DRIVEN");
  assert.ok(genome.taxonomy.regimes.includes("EVENT_WINDOW"));
  assert.ok(genome.taxonomy.regimes.includes("LOW_VOL_COMPRESSION"));
  assert.ok(genome.taxonomy.regimes.includes("CROSS_ASSET_DIVERGENCE"));
});

test("TD2-507 detects exact duplicate genomes before compute is wasted", () => {
  const genome = buildResearchCandidateGenomeV1(candidate());
  const comparison = compareResearchCandidateGenomesV1(genome, genome);
  const novelty = evaluateResearchCandidateNoveltyV1({ candidate: genome, existing_genomes: [genome] });

  assert.equal(comparison.exact_duplicate, true);
  assert.equal(comparison.similarity_score, 1);
  assert.equal(novelty.decision, "DUPLICATE");
  assert.equal(novelty.novelty_score, 0);
});

test("TD2-507 flags near candidates as too close without calling them exact duplicates", () => {
  const base = buildResearchCandidateGenomeV1(candidate());
  const close = buildResearchCandidateGenomeV1(candidate({
    research_candidate_id: "33333333-3333-4333-8333-333333333334",
    confirmation_signals: ["VWAP", "RSI", "DXY"],
  }));
  const novelty = evaluateResearchCandidateNoveltyV1({
    candidate: close,
    existing_genomes: [base],
    duplicate_threshold: 0.98,
    too_close_threshold: 0.7,
  });

  assert.equal(novelty.decision, "TOO_CLOSE");
  assert.ok(novelty.novelty_score > 0);
  assert.ok(novelty.nearest_neighbors[0].similarity_score >= 0.7);
});

test("TD2-507 returns novel when the nearest genome is far enough", () => {
  const base = buildResearchCandidateGenomeV1(candidate());
  const other = buildResearchCandidateGenomeV1(candidate({
    research_candidate_id: "33333333-3333-4333-8333-333333333335",
    primary_change_summary: "Mean reversion range rotation during quiet lunchtime range.",
    instruments: ["MES"],
    timeframes: ["M5"],
    entry_logic: ["range"],
    confirmation_signals: ["volume"],
    exit_logic: ["midline"],
  }));
  const novelty = evaluateResearchCandidateNoveltyV1({ candidate: other, existing_genomes: [base] });

  assert.equal(novelty.decision, "NOVEL");
  assert.ok(novelty.novelty_score > 0.5);
});

test("TD2-507 produces a knowledge-graph consumable node and edges", () => {
  const node = buildResearchCandidateKnowledgeNodeV1(candidate());

  assert.ok(node.labels.includes("ResearchCandidate"));
  assert.ok(node.edges.some((edge) => edge.type === "HAS_FAMILY" && edge.to === "strategy_family:BREAKOUT_RETEST"));
  assert.match(node.node_hash, /^sha256:[a-f0-9]{64}$/);
});

function candidate(overrides = {}) {
  return {
    research_candidate_id: "33333333-3333-4333-8333-333333333333",
    candidate_key: "mnq.breakout.retest.v1",
    primary_change_summary: "Breakout retest continuation with VWAP and RSI confirmation after compression.",
    instruments: ["MNQ"],
    timeframes: ["M1", "M15"],
    session_scope: ["ny_open"],
    entry_logic: ["breakout", "retest"],
    confirmation_signals: ["VWAP", "RSI"],
    exit_logic: ["tp1", "trailing_stop"],
    risk_model: ["fixed_risk_pct", "rr_min_2"],
    ...overrides,
  };
}
