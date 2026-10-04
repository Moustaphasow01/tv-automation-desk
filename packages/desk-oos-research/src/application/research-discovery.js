import { requireResearch } from "../domain/research-evidence.js";
import { selectResearchModel } from "../domain/research-governance.js";
import { RESEARCHER_PROMPT } from "../domain/research-role-contract.js";
import { callResearchModel } from "./research-model-call.js";
import { validateResearchOutput } from "../domain/research-output-validation.js";

const rule = { type: "object", additionalProperties: false, required: ["feature", "operator", "value"], properties: {
  feature: { type: "string" }, operator: { type: "string", enum: ["GT", "GTE", "LT", "LTE", "EQ"] },
  value: { type: ["number", "string"] } } };
export const DISCOVERY_SCHEMA = { type: "object", additionalProperties: false, required: ["proposals"], properties: {
  proposals: { type: "array", maxItems: 10, items: { type: "object", additionalProperties: false,
    required: ["description", "target_component", "mechanism", "feature_rule", "outcome_rule", "testable_change", "expected_benefit", "expected_risk", "winner_risk"],
    properties: { description: { type: "string" }, target_component: { type: "string", enum: ["MAP", "CONFIRMATION", "ENTRY", "FILTER", "REENTRY", "MANAGEMENT"] },
      mechanism: { type: "string" }, feature_rule: rule, outcome_rule: { type: "object", additionalProperties: false,
        required: ["metric", "operator", "value"], properties: { metric: { type: "string", enum: ["PUBLISHED_REAL_R"] },
          operator: { type: "string", enum: ["GT", "GTE", "LT", "LTE", "EQ"] }, value: { type: "number" } } },
      testable_change: { type: "string" }, expected_benefit: { type: "string" }, expected_risk: { type: "string" }, winner_risk: { type: "string" } } } } } };

/** Exploration only. A technical per-call budget is not a limit on frozen trading scenarios. */
export class ResearchDiscovery {
  constructor({ cycle, hypotheses, memory, model, fingerprint }) { Object.assign(this, { cycle, hypotheses, memory, model, fingerprint }); }
  async discover({ cycle_id, maximum_chunks = Infinity }) {
    const cycle = await this.memory.getCycle(cycle_id);
    requireResearch(cycle?.status === "HYPOTHESIZING" && this.model, "RESEARCH_DISCOVERY_NOT_READY");
    const cases = (await this.cycle.all(cycle_id, "scenario_audit")).map(r => r.payload), chunks = [];
    for (let offset = 0; offset < cases.length; offset += 100) chunks.push(cases.slice(offset, offset + 100));
    let proposals = 0, processed = 0, completed = 0;
    for (const [chunk, batch] of chunks.entries()) {
      let stored = await this.memory.findArtifact({ kind: "finding", id: this.fingerprint(`${cycle_id}|DISCOVERY|${chunk}`) });
      if (!stored && processed >= maximum_chunks) continue;
      if (!stored) {stored = await this.propose(cycle, batch, chunk); processed++;}
      validateResearchOutput({ proposals: stored.payload.proposals }, DISCOVERY_SCHEMA);
      for (const [i, proposal] of stored.payload.proposals.entries()) await this.registerProposal(cycle_id, proposal, `${chunk}|${i}`);
      proposals += stored.payload.proposals.length;
      completed++;
    }
    return this.memory.transition({ cycle_id, expected_revision: cycle.revision, status: completed===chunks.length?"COUNTEREXAMPLES":"HYPOTHESIZING",
      checkpoint: { proposals, discovery_chunks: chunks.length, chunks_completed:completed,cases_compared: cases.length, hypotheses_are_exploratory: true } });
  }
  async registerProposal(cycle_id, proposal, index) {
    try { return await this.hypotheses.register({ cycle_id, proposal }); }
    catch (error) {
      if (error.code !== "RESEARCH_SUPPORT_REQUIRED") throw error;
      const id = this.fingerprint(`${cycle_id}|UNSUPPORTED_HYPOTHESIS|${index}`);
      const prior = await this.memory.findArtifact({ kind: "finding", id });
      if (prior) return prior.payload;
      const rejection = { proposal, status: "WEAK", reason: "NO_PERSISTED_SUPPORT",
        classification: "RESEARCH_HYPOTHESIS", edge_validated: false, source_cycle_id: cycle_id };
      await this.cycle.save(cycle_id, "finding", id, rejection);
      return rejection;
    }
  }
  async propose(cycle, cases, chunk) {
    const ids = new Set(cases.map(c => c.case_id));
    const findings = (await this.cycle.all(cycle.cycle_id, "finding")).filter(r => ids.has(r.payload.case_id));
    const input = { cases: cases.map(c => ({ case_id: c.case_id, date: c.identity.date, scorable: c.identity.scorable,
      sample_purpose: c.identity.sample_purpose, features: c.features, observations: {
        reason_codes: c.observations.reason_codes, filled: c.observations.filled,
        trades: c.observations.trades.map(t => ({ trade_id: t.trade_id, real_R: t.real_R, real_USD: t.real_USD })) }, evidence_refs: c.evidence_refs })),
      diagnoses: findings.map(r => r.payload), hypotheses_registered: (await this.hypotheses.all(cycle.cycle_id)).length,
      experiments_executed: 0 };
    requireResearch(JSON.stringify(input).length <= 1_000_000, "RESEARCH_CONTEXT_BUDGET_EXCEEDED");
    const selection = selectResearchModel(await this.model.capabilities());
    const response = await callResearchModel({ memory: this.memory, model: this.model, fingerprint: this.fingerprint, cycle,
      requestId: this.fingerprint(`${cycle.cycle_id}|DISCOVERY_MODEL|${chunk}`), request: { role: "DESK_AI_RESEARCHER", selection,
        instructions: `${RESEARCHER_PROMPT}\nNow compare cases. Propose zero or more falsifiable observational implications from available features and published REAL R only.\nDo not aim to confirm predefined example patterns. No manufactured support, significance or causal assertion. Missing evidence can justify zero hypotheses.`,
        input, output_schema: DISCOVERY_SCHEMA } });
    validateResearchOutput(response.output, DISCOVERY_SCHEMA);
    const payload = { proposals: response.output.proposals, model: selection, actual_telemetry: response.telemetry ?? null,
      source_cycle_id: cycle.cycle_id, classification: "RESEARCH_HYPOTHESIS", edge_validated: false };
    const id = this.fingerprint(`${cycle.cycle_id}|DISCOVERY|${chunk}`);
    await this.cycle.save(cycle.cycle_id, "finding", id, payload);
    return { id, payload };
  }
  async critiqueAll({ cycle_id, maximum_hypotheses = Infinity }) {
    const cycle = await this.memory.getCycle(cycle_id);
    requireResearch(["COUNTEREXAMPLES", "CRITIQUING"].includes(cycle?.status), "RESEARCH_CYCLE_STAGE_INVALID");
    const hypotheses = await this.hypotheses.all(cycle_id);
    const prior=new Set((await this.cycle.all(cycle_id,'critique')).map(c=>c.payload.hypothesis_id));
    for (const hypothesis of hypotheses.filter(h=>!prior.has(h.id)).slice(0,maximum_hypotheses)) await this.hypotheses.critique({ cycle_id, hypothesis_id: hypothesis.id });
    const reviewed=(await this.cycle.all(cycle_id,'critique')).length;
    return this.memory.transition({ cycle_id, expected_revision: cycle.revision, status: reviewed===hypotheses.length?"COMPLETED":"CRITIQUING", checkpoint: {
      hypotheses_reviewed: reviewed, next_action: "PREREGISTER_UNCONTAMINATED_EXPERIMENT",
      edge_validated: false, champion_changes: 0, experiments_executed: 0,
      readiness_semantics: "Research dossiers reviewed, not experiment admission or champion promotion" } });
  }
}
