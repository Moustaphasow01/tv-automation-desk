import { requireResearch } from "../domain/research-evidence.js";

export class ResearchApi {
  constructor({ cycle, memory, hypotheses, discovery,caseAuditor }) { Object.assign(this, { cycle, memory, hypotheses, discovery,caseAuditor }); }
  async start(args) { return this.cycle.start(args); }
  async advance({ cycle_id, maximum_cases = 1 }) {
    return this.memory.executeExclusive(cycle_id, async () => {
      const cycle = await this.memory.getCycle(cycle_id);
      requireResearch(cycle, "RESEARCH_CYCLE_NOT_FOUND");
      if (this.cycle.observer) await this.cycle.observer.assertCorpus(cycle.corpus_hash);
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
    return { ...cycle, model_requests: events.filter(e => e.type === "MODEL_REQUESTED").length,
      last_blocking_error: events.filter(e => e.type === "RESEARCH_STEP_BLOCKED").at(-1)?.payload ?? null,
      hypotheses_tested: (await this.cycle.all(cycle_id, "hypothesis")).length,
      number_of_hypotheses_proposed: findings.reduce((sum, f) => sum + (f.payload.proposals?.length ?? 0), 0),
      hypotheses_without_persisted_support: findings.filter(f => f.payload.reason === "NO_PERSISTED_SUPPORT").length,
      significance_claim_allowed: false,
      reports: Object.fromEntries(await Promise.all(["scenario_audit", "plan_audit", "finding", "family", "hypothesis", "critique", "experiment"]
        .map(async kind => [kind, (await this.cycle.all(cycle_id, kind)).length]))),
      champion_write_capability: false, broker_capability: false, replay_capability: false };
  }
  async artifacts(args) { return this.memory.listArtifacts(args); }
  async scorecard(args) { return this.cycle.scorecard(args); }
  async experiment(args) {
    return this.memory.executeExclusive(args.cycle_id, () => this.hypotheses.experiment(args));
  }
}
