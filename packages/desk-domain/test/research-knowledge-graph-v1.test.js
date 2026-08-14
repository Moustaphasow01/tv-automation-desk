import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildResearchKnowledgeEdgeV1,
  buildResearchKnowledgeGraphFromArtifactsV1,
  buildResearchKnowledgeGraphV1,
  buildResearchKnowledgeNodeV1,
  queryResearchKnowledgeGraphV1,
} from "../index.js";

test("TD2-509 normalizes nodes and edges into a stable graph", () => {
  const graph = buildResearchKnowledgeGraphV1({
    nodes: [
      buildResearchKnowledgeNodeV1({ node_id: "research_candidate:c1", type: "ResearchCandidate" }),
      buildResearchKnowledgeNodeV1({ node_id: "research_candidate:c1", type: "ResearchCandidate" }),
      buildResearchKnowledgeNodeV1({ node_id: "strategy_family:BREAKOUT_RETEST", type: "StrategyFamily" }),
    ],
    edges: [
      buildResearchKnowledgeEdgeV1({ from: "research_candidate:c1", type: "HAS_FAMILY", to: "strategy_family:BREAKOUT_RETEST" }),
    ],
  });

  assert.equal(graph.validation.ok, true);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.summary.nodes_by_type.ResearchCandidate, 1);
});

test("TD2-509 projects research artifacts into explicit graph relations", () => {
  const graph = buildResearchKnowledgeGraphFromArtifactsV1({
    graph_id: "research-graph:fixture",
    experiments: [{ research_experiment_id: "exp1", hypothesis_ids: ["hyp1"] }],
    candidates: [candidate({ research_experiment_id: "exp1", research_hypothesis_id: "hyp1" })],
    failure_records: [failure()],
    evaluation_reports: [{ research_evaluation_report_id: "rep1", research_candidate_id: "c1", verdict: "FAIL" }],
  });

  assert.equal(graph.validation.ok, true);
  assert.ok(graph.edges.some((edge) => edge.type === "CONTAINS_HYPOTHESIS"));
  assert.ok(graph.edges.some((edge) => edge.type === "TESTS_CANDIDATE"));
  assert.ok(graph.edges.some((edge) => edge.type === "FAILED_BECAUSE"));
  assert.ok(graph.edges.some((edge) => edge.type === "FALSIFIES_HYPOTHESIS"));
});

test("TD2-509 lets agents query the neighborhood of a candidate", () => {
  const graph = buildResearchKnowledgeGraphFromArtifactsV1({
    candidates: [candidate()],
    failure_records: [failure()],
  });
  const result = queryResearchKnowledgeGraphV1(graph, {
    node_id: "research_candidate:c1",
    edge_types: ["HAS_FAMILY", "TARGETS_REGIME", "FAILED_CANDIDATE"],
  });

  assert.ok(result.nodes.some((node) => node.node_id === "research_candidate:c1"));
  assert.ok(result.edges.some((edge) => edge.type === "HAS_FAMILY"));
  assert.ok(result.edges.some((edge) => edge.type === "FAILED_CANDIDATE"));
  assert.match(result.query_hash, /^sha256:[a-f0-9]{64}$/);
});

test("TD2-509 reports dangling relations in hand-built graphs", () => {
  const graph = buildResearchKnowledgeGraphV1({
    nodes: [{ node_id: "research_candidate:c1", type: "ResearchCandidate" }],
    edges: [{ from: "research_candidate:c1", type: "HAS_FAMILY", to: "strategy_family:MISSING" }],
  });

  assert.equal(graph.validation.ok, false);
  assert.equal(graph.validation.dangling_edges.length, 1);
});

test("TD2-509 graph hash is stable regardless of input order", () => {
  const left = buildResearchKnowledgeGraphV1({
    nodes: [
      { node_id: "strategy_family:BREAKOUT_RETEST", type: "StrategyFamily" },
      { node_id: "research_candidate:c1", type: "ResearchCandidate" },
    ],
    edges: [{ from: "research_candidate:c1", type: "HAS_FAMILY", to: "strategy_family:BREAKOUT_RETEST" }],
  });
  const right = buildResearchKnowledgeGraphV1({
    nodes: [
      { node_id: "research_candidate:c1", type: "ResearchCandidate" },
      { node_id: "strategy_family:BREAKOUT_RETEST", type: "StrategyFamily" },
    ],
    edges: [{ from: "research_candidate:c1", type: "HAS_FAMILY", to: "strategy_family:BREAKOUT_RETEST" }],
  });

  assert.equal(left.graph_hash, right.graph_hash);
});

test("TD2-509 supports node-type filtering for front projections", () => {
  const graph = buildResearchKnowledgeGraphFromArtifactsV1({ candidates: [candidate()] });
  const result = queryResearchKnowledgeGraphV1(graph, {
    node_id: "research_candidate:c1",
    node_types: ["StrategyFamily"],
  });

  assert.ok(result.nodes.every((node) => node.type === "StrategyFamily"));
});

function candidate(overrides = {}) {
  return {
    research_candidate_id: "c1",
    candidate_key: "mnq.breakout.retest",
    primary_change_summary: "Breakout retest continuation with VWAP and RSI confirmation after compression.",
    instruments: ["MNQ"],
    timeframes: ["M1", "M15"],
    session_scope: ["ny_open"],
    entry_logic: ["breakout", "retest"],
    confirmation_signals: ["VWAP", "RSI"],
    exit_logic: ["tp1"],
    risk_model: ["fixed_risk_pct"],
    ...overrides,
  };
}

function failure() {
  return {
    failure_id: "failure:overfit-c1",
    candidate: candidate(),
    cause_codes: ["OVERFIT"],
    root_cause_summary: "Overfit on train window.",
    negative_result_ref: "report:rep1",
    evidence_refs: ["report:rep1"],
  };
}
