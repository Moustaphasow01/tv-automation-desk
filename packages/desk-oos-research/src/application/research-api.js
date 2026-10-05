import { requireResearch } from "../domain/research-evidence.js";

export class ResearchApi {
  constructor({ cycle, memory, hypotheses, discovery,caseAuditor,science }) { Object.assign(this, { cycle, memory, hypotheses, discovery,caseAuditor,science }); }
  async start(args) { return this.cycle.start(args); }
  async advance({ cycle_id, maximum_cases = 1 }) {
    return this.memory.executeExclusive(cycle_id, async () => {
      const cycle = await this.memory.getCycle(cycle_id);
      requireResearch(cycle, "RESEARCH_CYCLE_NOT_FOUND");
      if (this.cycle.observer) await this.cycle.observer.assertCorpus(cycle.corpus_hash);
      if(cycle.definition.kind==='SCIENTIFIC_EXPERIMENTS')return this.science.advance({cycle_id});
      const steps = { OBSERVING: () => this.cycle.observe({ cycle_id }),
        DIAGNOSING: () => this.cycle.diagnose({ cycle_id, limit: maximum_cases }),
        CLUSTERING: () => this.caseAuditor?this.caseAuditor.advance({cycle_id}):this.cycle.cluster({ cycle_id }),
        HYPOTHESIZING: () => this.discovery.discover({ cycle_id,maximum_chunks:1 }),
        COUNTEREXAMPLES: () => this.discovery.critiqueAll({ cycle_id,maximum_hypotheses:1 }),
        CRITIQUING: () => this.discovery.critiqueAll({ cycle_id,maximum_hypotheses:1 }) };
      if (!steps[cycle.status]) return { ...cycle, action: "NO_AUTOMATIC_EXPERIMENT_OR_PROMOTION" };
      try { return await steps[cycle.status](); }
      catch (error) {
        await this.memory.addEvent({ cycle_id, event_id: this.cycle.fingerprint(`${cycle_id}|${cycle.revision}|${error.code ?? "RESEARCH_STEP_FAILED"}`),
          type: "RESEARCH_STEP_BLOCKED", payload: { checkpoint: cycle.status, code: error.code ?? "RESEARCH_STEP_FAILED",
            automatic_paid_retry: false, champion_modified: false } });
        throw error;
      }
    });
  }
  async status({ cycle_id }) {
    const cycle = await this.memory.getCycle(cycle_id);
    requireResearch(cycle, "RESEARCH_CYCLE_NOT_FOUND");
    const events = await this.memory.listEvents(cycle_id);
    const findings = await this.cycle.all(cycle_id, "finding");
    const experimentsExecuted = findings.filter(row => row.payload.scientific_stage === 'EXPERIMENT_DECISION'
      && row.payload.experiment_executed === true).length;
    const caseCritiques=(await this.cycle.all(cycle_id,'critique')).filter(row=>row.payload.audit_scope==='SCENARIO_REVIEW');
    return { ...cycle, model_requests: events.filter(e => e.type === "MODEL_REQUESTED").length,
      last_blocking_error: events.filter(e => e.type === "RESEARCH_STEP_BLOCKED").at(-1)?.payload ?? null,
      hypotheses_tested: experimentsExecuted, hypotheses_tested_definition: 'Completed registered experiments, not observational proposals.',
      hypotheses_registered: this.hypotheses ? (await this.hypotheses.all(cycle_id)).length : (await this.cycle.all(cycle_id,'hypothesis')).length,
      scenario_reviews_persisted: findings.filter(row=>row.payload.case_id).length,
      scenario_reviews_audited: caseCritiques.length,
      scenario_reviews_independently_audited: caseCritiques.filter(row=>row.payload.independent===true).length,
      experiments_executed: experimentsExecuted,
      scientific_source_cycle_id: cycle.definition.source_cycle_id ?? null,
      number_of_hypotheses_proposed: findings.reduce((sum, f) => sum + (f.payload.proposals?.length ?? 0), 0),
      hypotheses_without_persisted_support: findings.filter(f => f.payload.reason === "NO_PERSISTED_SUPPORT").length,
      significance_claim_allowed: false,
      reports: Object.fromEntries(await Promise.all(["scenario_audit", "plan_audit", "finding", "family", "hypothesis", "critique", "experiment"]
        .map(async kind => [kind, (await this.cycle.all(cycle_id, kind)).length]))),
      supervision:await this.supervisionStatus(),
      champion_write_capability: false, broker_capability: false, replay_capability: false };
  }
  async assessRecovery({cycle_id}) {
    const cycle=await this.memory.getCycle(cycle_id);
    const recovery = { CLUSTERING: this.caseAuditor, COUNTEREXAMPLES: this.hypotheses, CRITIQUING: this.hypotheses };
    requireResearch(recovery[cycle?.status], 'RESEARCH_RECOVERY_NOT_APPLICABLE');
    if(this.cycle.observer)await this.cycle.observer.assertCorpus(cycle.corpus_hash);
    return {...await recovery[cycle.status].assessRecovery({cycle_id}),expected_revision:cycle.revision};
  }
  async supervisionStatus() {
    const event=await this.memory.latestEvent?.('RESEARCH_SUPERVISION_PASS');
    if(!event)return {available:false,reason:'NO_EXECUTION_RECORDED'};
    return {available:true,event_id:event.event_id,event_hash:event.payload_hash,...event.payload,
      overdue:Date.parse(this.cycle.clock())>Date.parse(event.payload.next_run_at)+120000};
  }
  async artifacts(args) { return this.memory.listArtifacts(args); }
  async scorecard(args) {
    const cycle=await this.memory.getCycle(args.cycle_id);
    requireResearch(cycle,'RESEARCH_CYCLE_NOT_FOUND');
    if(!cycle.definition.source_cycle_id)return this.cycle.scorecard(args);
    return {...await this.cycle.scorecard({...args,cycle_id:cycle.definition.source_cycle_id}),
      source_cycle_id:cycle.definition.source_cycle_id,metrics_basis:'CHAMPION_REAL_NOT_EXPERIMENTAL_REPLAY'};
  }
  async experiment(args) {
    return this.memory.executeExclusive(args.cycle_id, () => this.hypotheses.experiment(args));
  }
}
