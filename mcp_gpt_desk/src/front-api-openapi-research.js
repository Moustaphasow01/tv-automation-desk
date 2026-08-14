const dataFoundationParameters = [
  { name: "audience", in: "query", required: false, schema: { type: "string", enum: ["front", "simulation", "agent", "operator"], default: "front" } },
  { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 500 } },
];

export function researchOpenApiPaths({ errorResponses, jsonContent }) {
  const researchGet = (operationId, summary, parameters = []) => ({
    operationId,
    summary,
    tags: ["Desk Research Lab"],
    parameters: [...dataFoundationParameters, ...parameters],
    responses: {
      "200": { description: "Research Lab controlled read model", content: jsonContent({ $ref: "#/components/schemas/OperationsEnvelope" }) },
      ...errorResponses,
    },
  });
  return {
    "/research/overview": { get: researchGet("getResearchLabOverview", "Read Research Lab experiments, candidates, evidence and knowledge graph summary") },
    "/research/experiments": {
      get: researchGet("listResearchExperiments", "List Research Experiments", [
        { name: "status", in: "query", schema: { type: "string", enum: ["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED", "ARCHIVED"] } },
        { name: "owner", in: "query", schema: { type: "string" } },
      ]),
    },
    "/research/experiments/{researchExperimentId}": {
      get: researchGet("getResearchExperiment", "Get one Research Experiment zoom", [{ name: "researchExperimentId", in: "path", required: true, schema: { type: "string" } }]),
    },
    "/research/candidates": {
      get: researchGet("listResearchCandidates", "List Research Candidates", [
        { name: "research_experiment_id", in: "query", schema: { type: "string" } },
        { name: "research_hypothesis_id", in: "query", schema: { type: "string" } },
        { name: "status", in: "query", schema: { type: "string", enum: ["IDEA", "BASELINE_REQUIRED", "IN_SIMULATION", "UNDER_REVIEW", "PROMOTION_READY", "REJECTED", "RETIRED"] } },
      ]),
    },
    "/research/candidates/{researchCandidateId}": {
      get: researchGet("getResearchCandidate", "Get one Research Candidate zoom", [{ name: "researchCandidateId", in: "path", required: true, schema: { type: "string" } }]),
    },
    "/research/evaluation-reports": {
      get: researchGet("listResearchEvaluationReports", "List Research Evaluation Reports", [
        { name: "research_experiment_id", in: "query", schema: { type: "string" } },
        { name: "research_candidate_id", in: "query", schema: { type: "string" } },
        { name: "verdict", in: "query", schema: { type: "string", enum: ["PASS", "FAIL", "INCONCLUSIVE", "NEEDS_REVIEW"] } },
      ]),
    },
  };
}
