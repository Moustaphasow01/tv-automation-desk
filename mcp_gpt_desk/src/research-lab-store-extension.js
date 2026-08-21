import { createResearchExperimentRegistryService } from "./research-experiment-registry-service.js";
import { bootstrapDemoPaperAutonomousResearch } from "./research/demo-paper-autonomous-bootstrap.js";
import {
  buildResearchCandidateDetailProjection,
  buildResearchExperimentDetailProjection,
  buildResearchLabOverviewProjection,
} from "./research-lab-front-projection.js";

export function attachResearchLabStoreMethods(StoreClass) {
  Object.assign(StoreClass.prototype, researchLabStoreMethods);
}

const researchLabStoreMethods = {
  async getResearchLabOverview(args = {}) {
    const limit = args.limit ? Number(args.limit) : 200;
    const registry = researchRegistry(this);
    const [experiments, hypotheses, candidates, evaluationReports] = await Promise.all([
      registry.listExperiments({ ...args, limit }),
      registry.listHypotheses({ ...args, limit }),
      registry.listCandidates({ ...args, limit }),
      registry.listEvaluationReports({ ...args, limit }),
    ]);
    return researchLabResponse("DeskResearchLabOverviewV1", buildResearchLabOverviewProjection({
      generatedAtUtc: this.clock.now().utc,
      experiments,
      hypotheses,
      candidates,
      evaluationReports,
    }));
  },

  async listResearchExperiments(args = {}) {
    const items = await researchRegistry(this).listExperiments(args);
    return researchLabResponse("DeskResearchExperimentListV1", { generated_at_utc: this.clock.now().utc, items });
  },

  async getResearchExperiment({ research_experiment_id }) {
    const registry = researchRegistry(this);
    const experiment = await registry.getExperiment(research_experiment_id);
    const [hypotheses, candidates, evaluationReports] = await Promise.all([
      registry.listHypotheses({ researchExperimentId: research_experiment_id, limit: 500 }),
      registry.listCandidates({ researchExperimentId: research_experiment_id, limit: 500 }),
      registry.listEvaluationReports({ researchExperimentId: research_experiment_id, limit: 500 }),
    ]);
    return researchLabResponse("DeskResearchExperimentDetailV1", buildResearchExperimentDetailProjection({
      generatedAtUtc: this.clock.now().utc,
      experiment,
      hypotheses,
      candidates,
      evaluationReports,
    }));
  },

  async listResearchCandidates(args = {}) {
    const items = await researchRegistry(this).listCandidates(args);
    return researchLabResponse("DeskResearchCandidateListV1", { generated_at_utc: this.clock.now().utc, items });
  },

  async getResearchCandidate({ research_candidate_id }) {
    const registry = researchRegistry(this);
    const candidate = await registry.getCandidate(research_candidate_id);
    const [experiment, hypothesis, evaluationReports] = await Promise.all([
      registry.getExperiment(candidate.research_experiment_id),
      registry.getHypothesis(candidate.research_hypothesis_id),
      registry.listEvaluationReports({ researchCandidateId: research_candidate_id, limit: 500 }),
    ]);
    return researchLabResponse("DeskResearchCandidateDetailV1", buildResearchCandidateDetailProjection({
      generatedAtUtc: this.clock.now().utc,
      candidate,
      experiment,
      hypothesis,
      evaluationReports,
    }));
  },

  async listResearchEvaluationReports(args = {}) {
    const items = await researchRegistry(this).listEvaluationReports(args);
    return researchLabResponse("DeskResearchEvaluationReportListV1", { generated_at_utc: this.clock.now().utc, items });
  },

  async getStrategyPromotionLineage({ strategyVersionId } = {}) {
    const registry = researchRegistry(this);
    const candidate = strategyVersionId ? (await registry.listCandidates({ strategyVersionId, limit: 1 }))[0] || null : null;
    const [evaluationReports, hypothesis, experiment] = candidate
      ? await Promise.all([
          registry.listEvaluationReports({ researchCandidateId: candidate.research_candidate_id, limit: 20 }),
          candidate.research_hypothesis_id ? registry.getHypothesis(candidate.research_hypothesis_id).catch(() => null) : Promise.resolve(null),
          candidate.research_experiment_id ? registry.getExperiment(candidate.research_experiment_id).catch(() => null) : Promise.resolve(null),
        ])
      : [[], null, null];
    return researchLabResponse("DeskStrategyPromotionLineageV1", {
      generated_at_utc: this.clock.now().utc,
      candidate: candidate ? buildResearchCandidateDetailProjection({ candidate, evaluationReports, experiment, hypothesis }) : null,
    });
  },

  async executeResearchLabAction({ input = {}, actor = {} } = {}) {
    const action = String(input.action || input.action_id || input.command || "").trim();
    if (action !== "bootstrap_demo_paper_research") {
      throw researchLabError("RESEARCH_LAB_ACTION_UNSUPPORTED", `Unsupported Research Lab action: ${action || "missing"}.`, 422);
    }
    return researchLabResponse("DeskResearchLabActionResultV1", await bootstrapDemoPaperAutonomousResearch({
      store: this,
      input,
      actor,
    }));
  },
};

function researchRegistry(store) {
  if (!store.researchRegistry) {
    store.researchRegistry = createResearchExperimentRegistryService({ persistence: store.persistence, clock: store.clock });
  }
  return store.researchRegistry;
}

function researchLabResponse(contract, payload = {}) {
  return {
    contract,
    schemaVersion: "research_lab_front_v1",
    count: Array.isArray(payload.items) ? payload.items.length : payload.count,
    ...payload,
  };
}

function researchLabError(code, message, statusCode = 400) {
  return Object.assign(new Error(message || code), { code, statusCode, retryable: false });
}
