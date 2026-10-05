import { validateHypothesis, validateProposalFields, validateResearchSplit, evaluateExperimentReadiness, selectResearchModel } from "../domain/research-governance.js";
import { requireResearch } from "../domain/research-evidence.js";
import { searchHypothesisEvidence, winnerRegressionSet } from "../domain/hypothesis-evidence.js";
import { CRITIC_PROMPT } from "../domain/research-role-contract.js";
import { callResearchModel } from "./research-model-call.js";
import { validateResearchOutput } from "../domain/research-output-validation.js";
import { researchCanonicalJson } from "../domain/research-canonical-json.js";
import { hypothesisCitationCatalog, resolveCritiqueCitations, CRITIQUE_CITATION_VERSION } from '../domain/research-critique-citations.js';

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
    if (existing?.cycle_id === cycle_id) return { ...existing.payload, already_tested_or_registered: true };
    const projection_id = this.fingerprint(`${cycle_id}|${hypothesis_id}|HYPOTHESIS_EVIDENCE`);
    const projection = await this.memory.findArtifact({ kind: "finding", id: projection_id });
    if (projection) return projection.payload;
    const winnerRegression = winnerRegressionSet({ cases, feature_rule: proposal.feature_rule });
    const payload = { hypothesis_id, ...hypothesis, counterexample_search: evidence, winner_regression_set: winnerRegression,
      sample_size: { known_cases: evidence.supporting_cases.length + evidence.counterexamples.length, independent_days: evidence.independent_days },
      created_at: this.clock(), source_cycle_id: cycle_id, hypotheses_registered_in_cycle: (await this.all(cycle_id)).length + 1,
      experiments_executed: 0,
      no_statistical_significance_claim: true };
    if (existing) {
      Object.assign(payload, { already_tested_or_registered: true, classification: "RESEARCH_HYPOTHESIS_EVIDENCE",
        parent_hypothesis_ref: { id: hypothesis_id, source_cycle_id: existing.cycle_id, payload_hash: existing.payload_hash } });
      await this.cycle.save(cycle_id, "finding", projection_id, payload);
    } else await this.cycle.save(cycle_id, "hypothesis", hypothesis_id, payload);
    return payload;
  }
  async all(cycle_id) {
    const definitions = await this.cycle.all(cycle_id, "hypothesis");
    const projections = (await this.cycle.all(cycle_id, "finding"))
      .filter(row => row.payload.classification === "RESEARCH_HYPOTHESIS_EVIDENCE")
      .map(row => ({ ...row, id: row.payload.hypothesis_id }));
    return [...definitions, ...projections];
  }
  async critique({ cycle_id, hypothesis_id }) {
    const prior = await this.memory.findArtifact({ kind: "critique", id: this.fingerprint(`${cycle_id}|${hypothesis_id}|CRITIQUE`) });
    if (prior) return prior.payload;
    const cycle = await this.memory.getCycle(cycle_id);
    const evidence = await this.critiqueEvidence({ cycle_id, hypothesis_id });
    requireResearch(this.model, 'RESEARCH_HYPOTHESIS_OR_MODEL_MISSING');
    const selection = selectResearchModel(await this.model.capabilities());
    const response = await callResearchModel({ memory: this.memory, model: this.model, fingerprint: this.fingerprint, cycle,
      requestId: this.fingerprint(`${cycle_id}|${hypothesis_id}|CRITIC_MODEL`),
      request: { role: "DESK_AI_RESEARCH_CRITIC", selection, instructions: CRITIC_PROMPT,
        input: evidence.input, output_schema: CRITIQUE_SCHEMA } });
    validateResearchOutput(response.output, CRITIQUE_SCHEMA);
    requireResearch(CRITIQUE_SCHEMA.properties.verdict.enum.includes(response.output?.verdict)
      && Array.isArray(response.output.objections) && response.output.objections.length > 0, "RESEARCH_CRITIQUE_REQUIRED");
    const citation_bindings = resolveCritiqueCitations({ output: response.output, catalog: evidence.catalog,
      scope: 'HYPOTHESIS_CRITIC' });
    const critique = { ...response.output, hypothesis_id, independent: true, isolated_session: true,
      citation_validation_version: CRITIQUE_CITATION_VERSION, citation_bindings,
      model: selection, prompt_sha256: this.fingerprint(CRITIC_PROMPT), actual_telemetry: response.telemetry ?? null,
      generated_at: this.clock(), classification: "RESEARCH_CRITIQUE" };
    await this.cycle.save(cycle_id, "critique", this.fingerprint(`${cycle_id}|${hypothesis_id}|CRITIQUE`), critique);
    return critique;
  }
  async critiqueEvidence({ cycle_id, hypothesis_id }) {
    const hypothesis = (await this.all(cycle_id)).find(row => row.id === hypothesis_id);
    requireResearch(hypothesis, 'RESEARCH_HYPOTHESIS_OR_MODEL_MISSING');
    const ids = [...hypothesis.payload.supporting_cases, ...hypothesis.payload.counterexamples,
      ...hypothesis.payload.winner_regression_set.all_published_winners];
    const cases = (await this.cycle.all(cycle_id, 'scenario_audit')).filter(row => ids.includes(row.payload.case_id));
    return { input: { hypothesis: hypothesis.payload, cases: cases.map(row => row.payload) },
      catalog: hypothesisCitationCatalog({ hypothesis, cases, fingerprint: this.fingerprint }) };
  }
  async assessRecovery({ cycle_id }) {
    const completed = new Set((await this.cycle.all(cycle_id, 'critique')).map(row => row.payload.hypothesis_id));
    const pending = (await this.all(cycle_id)).find(row => !completed.has(row.id));
    requireResearch(pending, 'RESEARCH_RECOVERY_NOT_APPLICABLE');
    const request_id = this.fingerprint(`${cycle_id}|${pending.id}|CRITIC_MODEL`);
    const events = await this.memory.listEvents(cycle_id);
    const delivered = events.find(e => e.type === 'MODEL_RESPONSE_RECEIVED' && e.payload.request_id === request_id);
    requireResearch(delivered, 'RESEARCH_RECOVERY_RESPONSE_NOT_PERSISTED');
    const evidence = await this.critiqueEvidence({ cycle_id, hypothesis_id: pending.id });
    requireResearch(delivered.payload.context_sha256 === this.fingerprint(JSON.stringify(evidence.input)),
      'RESEARCH_MODEL_RESPONSE_CONTEXT_CONFLICT');
    const requested = events.find(e => e.type === 'MODEL_REQUESTED' && e.payload.request_id === request_id);
    requireResearch(requested?.payload.role === 'DESK_AI_RESEARCH_CRITIC'
      && requested.payload.context_sha256 === delivered.payload.context_sha256
      && requested.payload.prompt_sha256 === delivered.payload.prompt_sha256
      && delivered.payload.prompt_sha256 === this.fingerprint(CRITIC_PROMPT), 'RESEARCH_RECOVERY_REQUEST_LINKAGE_FAILED');
    requireResearch(requested.payload.model.identifier === delivered.payload.response.model_identifier
      && requested.payload.model.reasoning_effort === delivered.payload.response.reasoning_effort, 'RESEARCH_MODEL_DRIFT');
    validateResearchOutput(delivered.payload.response.output, CRITIQUE_SCHEMA);
    const bindings = resolveCritiqueCitations({ output: delivered.payload.response.output,
      catalog: evidence.catalog, scope: 'HYPOTHESIS_CRITIC' });
    return { validation_version: CRITIQUE_CITATION_VERSION, hypothesis_id: pending.id, request_id,
      citation_bindings_hash: this.fingerprint(researchCanonicalJson(bindings)), new_model_calls: 0 };
  }
  async experiment({ cycle_id, hypothesis_id, protocol }) {
    const experiment_id = this.fingerprint(researchCanonicalJson({ hypothesis_id, protocol }));
    const prior = await this.memory.findArtifact({ kind: "experiment", id: experiment_id });
    if (prior) return prior.payload;
    const hypothesis = (await this.all(cycle_id)).find(r => r.id === hypothesis_id)?.payload;
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
