import { canonicalSha256 } from "./execution-scope.js";
import { buildResearchCandidateKnowledgeNodeV1 } from "./research-candidate-genome-v1.js";
import {
  buildResearchFailureKnowledgeNodeV1,
  buildResearchFailureRecordV1,
} from "./research-failure-memory-v1.js";

export const RESEARCH_KNOWLEDGE_GRAPH_VERSION_V1 = "1.0.0";
export const RESEARCH_KNOWLEDGE_GRAPH_SCHEMA_VERSION_V1 = "research_knowledge_graph_v1";
export const RESEARCH_KNOWLEDGE_NODE_SCHEMA_VERSION_V1 = "research_knowledge_node_v1";
export const RESEARCH_KNOWLEDGE_EDGE_SCHEMA_VERSION_V1 = "research_knowledge_edge_v1";
export const RESEARCH_KNOWLEDGE_QUERY_SCHEMA_VERSION_V1 = "research_knowledge_query_v1";

export const RESEARCH_KNOWLEDGE_NODE_TYPES_V1 = Object.freeze([
  "ResearchExperiment",
  "ResearchHypothesis",
  "ResearchCandidate",
  "StrategyGenome",
  "ResearchFailure",
  "EvaluationReport",
  "Dataset",
  "Feature",
  "StrategyVersion",
  "MarketRegime",
  "StrategyFamily",
  "Unknown",
]);

export const RESEARCH_KNOWLEDGE_EDGE_TYPES_V1 = Object.freeze([
  "CONTAINS_HYPOTHESIS",
  "TESTS_CANDIDATE",
  "HAS_GENOME",
  "HAS_FAMILY",
  "TARGETS_REGIME",
  "FAILED_CANDIDATE",
  "FAILED_BECAUSE",
  "EVIDENCED_BY",
  "PRODUCED_REPORT",
  "USES_DATASET",
  "USES_FEATURE",
  "SIMILAR_TO",
  "DUPLICATES",
  "BLOCKED_BY_FAILURE",
  "SUPPORTS_HYPOTHESIS",
  "FALSIFIES_HYPOTHESIS",
  "PROMOTES_TO_STRATEGY",
  "RELATES_TO",
]);

export function buildResearchKnowledgeNodeV1(input = {}) {
  const node = object(input);
  const type = enumToken(node.type || node.kind || "Unknown", RESEARCH_KNOWLEDGE_NODE_TYPES_V1);
  const nodeId = valueText(node.node_id || node.id) || `${type.toLowerCase()}:${shortHash(node)}`;
  const result = {
    schema_version: RESEARCH_KNOWLEDGE_NODE_SCHEMA_VERSION_V1,
    graph_version: RESEARCH_KNOWLEDGE_GRAPH_VERSION_V1,
    node_id: nodeId,
    type,
    labels: uniqueText([type, ...list(node.labels)]),
    properties: object(node.properties),
    source_ref: valueText(node.source_ref),
  };
  return { ...result, node_hash: stableHash(result) };
}

export function buildResearchKnowledgeEdgeV1(input = {}) {
  const edge = object(input);
  const result = {
    schema_version: RESEARCH_KNOWLEDGE_EDGE_SCHEMA_VERSION_V1,
    graph_version: RESEARCH_KNOWLEDGE_GRAPH_VERSION_V1,
    edge_id: valueText(edge.edge_id || edge.id) || `edge:${shortHash([edge.from, edge.type, edge.to, edge.properties])}`,
    from: valueText(edge.from),
    to: valueText(edge.to),
    type: enumToken(edge.type || "RELATES_TO", RESEARCH_KNOWLEDGE_EDGE_TYPES_V1),
    weight: bounded(edge.weight, 1),
    evidence_refs: uniqueText(edge.evidence_refs),
    properties: object(edge.properties),
  };
  return { ...result, edge_hash: stableHash(result) };
}

export function buildResearchKnowledgeGraphV1(input = {}) {
  const nodes = dedupeBy(list(input.nodes).map(buildResearchKnowledgeNodeV1), "node_id").sort(byKey("node_id"));
  const edges = dedupeBy(list(input.edges).map(buildResearchKnowledgeEdgeV1), "edge_id").sort(byKey("edge_id"));
  const graph = {
    schema_version: RESEARCH_KNOWLEDGE_GRAPH_SCHEMA_VERSION_V1,
    graph_version: RESEARCH_KNOWLEDGE_GRAPH_VERSION_V1,
    graph_id: valueText(input.graph_id) || `research_graph:${shortHash([nodes, edges])}`,
    nodes,
    edges,
  };
  return { ...graph, validation: validateGraph(graph), summary: summarizeResearchKnowledgeGraphV1(graph), graph_hash: stableHash(graph) };
}

export function buildResearchKnowledgeGraphFromArtifactsV1(input = {}) {
  const assembled = [...experimentParts(input), ...candidateParts(input), ...failureParts(input), ...evaluationParts(input)];
  const nodes = assembled.filter((item) => item.entity === "node").map((item) => item.value);
  const edges = assembled.filter((item) => item.entity === "edge").map((item) => item.value);
  return buildResearchKnowledgeGraphV1({ graph_id: input.graph_id, nodes: [...nodes, ...referenceNodes(nodes, edges)], edges });
}

export function queryResearchKnowledgeGraphV1(graphInput = {}, query = {}) {
  const graph = graphInput.schema_version === RESEARCH_KNOWLEDGE_GRAPH_SCHEMA_VERSION_V1 ? graphInput : buildResearchKnowledgeGraphV1(graphInput);
  const startIds = uniqueText(query.node_ids || query.node_id || query.start_node_id);
  const allowedEdges = new Set(uniqueText(query.edge_types));
  const allowedNodes = new Set(uniqueText(query.node_types));
  const selectedEdges = graph.edges.filter((edge) => touches(edge, startIds) && allowed(allowedEdges, edge.type));
  const selectedNodeIds = new Set([...startIds, ...selectedEdges.flatMap((edge) => [edge.from, edge.to])]);
  const selectedNodes = graph.nodes.filter((node) => selectedNodeIds.has(node.node_id) && allowed(allowedNodes, node.type));
  const result = {
    schema_version: RESEARCH_KNOWLEDGE_QUERY_SCHEMA_VERSION_V1,
    graph_hash: graph.graph_hash,
    node_ids: startIds,
    nodes: selectedNodes,
    edges: selectedEdges,
  };
  return { ...result, query_hash: stableHash(result) };
}

export function summarizeResearchKnowledgeGraphV1(graph = {}) {
  return {
    node_count: list(graph.nodes).length,
    edge_count: list(graph.edges).length,
    nodes_by_type: countBy(list(graph.nodes), "type"),
    edges_by_type: countBy(list(graph.edges), "type"),
  };
}

export function researchKnowledgeGraphHashV1(input = {}) {
  return stableHash(input);
}

function experimentParts(input) {
  return list(input.experiments).flatMap((experiment) => {
    const experimentId = valueText(experiment.research_experiment_id || experiment.id);
    const node = partNode("ResearchExperiment", `research_experiment:${experimentId}`, experiment);
    return [node, ...edgeParts(`research_experiment:${experimentId}`, "CONTAINS_HYPOTHESIS", experiment.hypothesis_ids, "research_hypothesis:")];
  });
}

function candidateParts(input) {
  return list(input.candidates).flatMap((candidate) => {
    const candidateNode = buildResearchCandidateKnowledgeNodeV1(candidate);
    const candidateId = candidateNode.properties.research_candidate_id;
    const base = [{ entity: "node", value: graphNodeFromDomain(candidateNode, "ResearchCandidate") }];
    const edges = [...candidateNode.edges.map((edge) => partEdge(candidateNode.node_id, edge.type, edge.to, edge))];
    if (candidate.research_experiment_id) edges.push(partEdge(`research_experiment:${candidate.research_experiment_id}`, "TESTS_CANDIDATE", `research_candidate:${candidateId}`));
    if (candidate.research_hypothesis_id) edges.push(partEdge(`research_hypothesis:${candidate.research_hypothesis_id}`, "TESTS_CANDIDATE", `research_candidate:${candidateId}`));
    return [...base, ...edges];
  });
}

function failureParts(input) {
  return list(input.failure_records).flatMap((failure) => {
    const record = buildResearchFailureRecordV1(failure);
    const failureNode = buildResearchFailureKnowledgeNodeV1(record);
    const edges = failureNode.edges.map((edge) => partEdge(failureNode.node_id, edge.type, edge.to, edge));
    return [{ entity: "node", value: graphNodeFromDomain(failureNode, "ResearchFailure") }, ...edges];
  });
}

function evaluationParts(input) {
  return list(input.evaluation_reports).flatMap((report) => {
    const reportId = valueText(report.research_evaluation_report_id || report.report_id || report.id);
    const candidateId = valueText(report.research_candidate_id);
    const node = partNode("EvaluationReport", `research_evaluation_report:${reportId}`, report);
    const edgeType = report.verdict === "PASS" ? "SUPPORTS_HYPOTHESIS" : "FALSIFIES_HYPOTHESIS";
    return [node, partEdge(`research_evaluation_report:${reportId}`, "PRODUCED_REPORT", `research_candidate:${candidateId}`), partEdge(`research_evaluation_report:${reportId}`, edgeType, `research_candidate:${candidateId}`)];
  });
}

function graphNodeFromDomain(node, type) {
  return buildResearchKnowledgeNodeV1({
    node_id: node.node_id,
    type,
    labels: node.labels,
    properties: node.properties,
  });
}

function partNode(type, nodeId, properties) {
  return { entity: "node", value: buildResearchKnowledgeNodeV1({ node_id: nodeId, type, properties }) };
}

function edgeParts(from, type, ids, prefix) {
  return uniqueText(ids).map((id) => partEdge(from, type, `${prefix}${id}`));
}

function partEdge(from, type, to, source = {}) {
  return { entity: "edge", value: buildResearchKnowledgeEdgeV1({ from, type, to, evidence_refs: source.evidence_refs, properties: source.properties }) };
}

function validateGraph(graph) {
  const nodeIds = new Set(graph.nodes.map((node) => node.node_id));
  const dangling_edges = graph.edges.filter((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to)).map((edge) => edge.edge_id);
  return { ok: dangling_edges.length === 0, dangling_edges };
}

function referenceNodes(nodes, edges) {
  const known = new Set(nodes.map((node) => node.node_id));
  const refs = uniqueText(edges.flatMap((edge) => [edge.from, edge.to])).filter((id) => !known.has(id));
  return refs.map((id) => buildResearchKnowledgeNodeV1({ node_id: id, type: nodeTypeFromId(id), properties: { external_ref: id } }));
}

function nodeTypeFromId(id) {
  if (id.startsWith("strategy_family:")) return "StrategyFamily";
  if (id.startsWith("market_regime:")) return "MarketRegime";
  if (id.startsWith("research_candidate:")) return "ResearchCandidate";
  if (id.startsWith("strategy_genome:")) return "StrategyGenome";
  return "Unknown";
}

function touches(edge, nodeIds) {
  return !nodeIds.length || nodeIds.includes(edge.from) || nodeIds.includes(edge.to);
}

function allowed(set, value) {
  return set.size === 0 || set.has(value);
}

function dedupeBy(items, key) {
  return [...new Map(items.filter((item) => item[key]).map((item) => [item[key], item])).values()];
}

function countBy(items, key) {
  return items.reduce((acc, item) => ({ ...acc, [item[key]]: (acc[item[key]] || 0) + 1 }), {});
}

function byKey(key) {
  return (left, right) => String(left[key]).localeCompare(String(right[key]));
}

function enumToken(value, allowedValues) {
  const normalized = valueText(value).replaceAll("-", "_").replaceAll(" ", "_");
  return allowedValues.includes(normalized) ? normalized : "Unknown";
}

function bounded(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
}

function uniqueText(value) {
  return [...new Set(list(value).map(valueText).filter(Boolean))].sort();
}

function list(value) {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined || value === "" ? [] : [value];
}

function valueText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function shortHash(value) {
  return canonicalSha256(value).slice(0, 16);
}

function stableHash(value) {
  return `sha256:${canonicalSha256(value)}`;
}
