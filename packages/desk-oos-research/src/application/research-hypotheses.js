import { validateHypothesis, validateProposalFields, validateResearchSplit, evaluateExperimentReadiness, selectResearchModel } from "../domain/research-governance.js";
import { requireResearch } from "../domain/research-evidence.js";
import { searchHypothesisEvidence, winnerRegressionSet } from "../domain/hypothesis-evidence.js";
import { CRITIC_PROMPT } from "../domain/research-role-contract.js";
import { callResearchModel } from "./research-model-call.js";
import { validateResearchOutput } from "../domain/research-output-validation.js";
import { researchCanonicalJson } from "../domain/research-canonical-json.js";

const CRITIQUE_SCHEMA = { type: "object", additionalProperties: false,
  required: ["verdict", "objections", "evidence_refs"], properties: {
    verdict: { type: "string", enum: ["READY_FOR_EXPERIMENT", "WEAK", "REJECTED"] },
    objections: { type: "array", minItems: 1, items: { type: "string" } },
    evidence_refs: { type: "array", items: { type: "string" } } } };

export class ResearchHypotheses {
  constructor({ cycle, memory, fingerprint, model, clock }) { Object.assign(this, { cycle, memory, fingerprint, model, clock }); }
  async register({ cycle_id, proposal }) {
    validateProposalFields(proposal);
    const cases = (await this.cycle.all(cycle_id, "scenario_audit")).map(r => r.payload);
    requireResearch(cases.length > 0, "RESEARCH_OBSERVATIONS_REQUIRED");
    const evidence = searchHypothesisEvidence({ cases, feature_rule: proposal.feature_rule, outcome_rule: proposal.outcome_rule });
    const hypothesis = validateHypothesis({ hypothesis: { ...proposal, supporting_cases: evidence.supporting_cases,
      counterexamples: evidence.counterexamples }, caseIds: cases.map(c => c.case_id) });
    const mechanism = { target_component: hypothesis.target_component, mechanism: hypothesis.mechanism,
      feature_rule: hypothesis.feature_rule, outcome_rule: hypothesis.outcome_rule, testable_change: hypothesis.testable_change };
    const hypothesis_id = this.fingerprint(researchCanonicalJson(mechanism));
    const existing = await this.memory.findArtifact({ kind: "hypothesis", id: hypothesis_id });
    if (existing) return { hypothesis_id, already_tested_or_registered: true, previous: existing.payload };
    const winnerRegression = winnerRegressionSet({ cases, feature_rule: proposal.feature_rule });
    const payload = { hypothesis_id, ...hypothesis, counterexample_search: evidence, winner_regression_set: winnerRegression,
      sample_size: { known_cases: evidence.supporting_cases.length + evidence.counterexamples.length, independent_days: evidence.independent_days },
      created_at: this.clock(), source_cycle_id: cycle_id, hypotheses_tested_in_cycle: (await this.cycle.all(cycle_id, "hypothesis")).length + 1,
      no_statistical_significance_claim: true };
    await this.cycle.save(cycle_id, "hypothesis", hypothesis_id, payload);
    return payload;
  }
  async critique({ cycle_id, hypothesis_id }) {
    const prior = await this.memory.findArtifact({ kind: "critique", id: this.fingerprint(`${cycle_id}|${hypothesis_id}|CRITIQUE`) });
    if (prior) return prior.payload;
    const cycle = await this.memory.getCycle(cycle_id);
    const hypothesis = (await this.cycle.all(cycle_id, "hypothesis")).find(r => r.id === hypothesis_id)?.payload;
    requireResearch(hypothesis && this.model, "RESEARCH_HYPOTHESIS_OR_MODEL_MISSING");
    const cases = (await this.cycle.all(cycle_id, "scenario_audit")).map(r => r.payload);
    const selected = cases.filter(c => [...hypothesis.supporting_cases, ...hypothesis.counterexamples,
      ...hypothesis.winner_regression_set.all_published_winners].includes(c.case_id));
    const selection = selectResearchModel(await this.model.capabilities());
    const response = await callResearchModel({ memory: this.memory, model: this.model, fingerprint: this.fingerprint, cycle,
      requestId: this.fingerprint(`${cycle_id}|${hypothesis_id}|CRITIC_MODEL`),
      request: { role: "DESK_AI_RESEARCH_CRITIC", selection, instructions: CRITIC_PROMPT,
        input: { hypothesis, cases: selected }, output_schema: CRITIQUE_SCHEMA } });
    validateResearchOutput(response.output, CRITIQUE_SCHEMA);
    requireResearch(CRITIQUE_SCHEMA.properties.verdict.enum.includes(response.output?.verdict)
      && Array.isArray(response.output.objections) && response.output.objections.length > 0, "RESEARCH_CRITIQUE_REQUIRED");
    const known = new Set(selected.flatMap(c => c.evidence_refs));
    requireResearch(Array.isArray(response.output.evidence_refs)
      && response.output.evidence_refs.every(ref => known.has(ref)), "RESEARCH_CITATION_UNKNOWN");
    const critique = { ...response.output, hypothesis_id, independent: true, isolated_session: true,
      model: selection, prompt_sha256: this.fingerprint(CRITIC_PROMPT), actual_telemetry: response.telemetry ?? null,
      generated_at: this.clock(), classification: "RESEARCH_CRITIQUE" };
    await this.cycle.save(cycle_id, "critique", this.fingerprint(`${cycle_id}|${hypothesis_id}|CRITIQUE`), critique);
    return critique;
  }
  async experiment({ cycle_id, hypothesis_id, protocol }) {
    const experiment_id = this.fingerprint(researchCanonicalJson({ hypothesis_id, protocol }));
    const prior = await this.memory.findArtifact({ kind: "experiment", id: experiment_id });
    if (prior) return prior.payload;
    const hypothesis = (await this.cycle.all(cycle_id, "hypothesis")).find(r => r.id === hypothesis_id)?.payload;
    requireResearch(hypothesis, "RESEARCH_HYPOTHESIS_NOT_FOUND");
    const corpus = await this.cycle.observer.pages("get_forensic_index", {});
    const split = validateResearchSplit({ ...protocol.split, exposedDates: corpus.map(d => d.date) });
    const critique = (await this.cycle.all(cycle_id, "critique")).find(r => r.payload.hypothesis_id === hypothesis_id)?.payload;
    requireResearch(["primary_metric", "stopping_rule", "false_discovery_control"].every(field =>
      typeof protocol[field] === "string" && protocol[field].trim().length > 0),
      "RESEARCH_EXPERIMENT_PROTOCOL_REQUIRED");
    const admission = evaluateExperimentReadiness({ hypothesis, critique, split,
      counterexampleSearch: hypothesis.counterexample_search, winnerRegression: hypothesis.winner_regression_set });
    const experiment = { experiment_id, hypothesis_id, ...admission, protocol, split, preregistered_at: this.clock(),
      champion: { engine: "V3.9.8", mutable: false }, challenger: { executable: false, status: "PROTOCOL_ONLY" },
      performance: { available: false, reason: "EXPERIMENT_NOT_EXECUTED" }, classification: "RESEARCH_PROTOCOL" };
    await this.cycle.save(cycle_id, "experiment", experiment_id, experiment);
    return experiment;
  }
}
