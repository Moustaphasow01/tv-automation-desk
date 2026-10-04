import { planQualityAudit, researchScorecard, researchCohorts } from "../domain/research-scorecard.js";
import { scenarioFamilyKey } from "../domain/scenario-self-audit.js";
import { RESEARCH_VERSION, requireResearch } from "../domain/research-evidence.js";
import { selectResearchModel } from "../domain/research-governance.js";
import { RESEARCHER_PROMPT, RESEARCH_PROMPT_VERSION, RESEARCH_ROLE_OUTPUT_SCHEMA, validateResearcherAnswer } from "../domain/research-role-contract.js";
import { callResearchModel } from "./research-model-call.js";
import { researchCanonicalJson } from "../domain/research-canonical-json.js";

/** No trading command port, no experiment executor and no promotion port are accepted. */
export class ResearchCycle {
  constructor({ observer, memory, fingerprint, model, clock }) { Object.assign(this, { observer, memory, fingerprint, model, clock }); }
  async start({ dates, budget = { maximum_model_calls: 50 } }) {
    requireResearch(Array.isArray(dates) && dates.length > 0 && dates.length <= 1000, "RESEARCH_DATES_REQUIRED");
    requireResearch(new Set(dates).size === dates.length && dates.every(d => /^2026-(07|08)-\d{2}$/.test(d)
      && Number.isFinite(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d), "RESEARCH_DATE_INVALID");
    requireResearch(Number.isInteger(budget.maximum_model_calls) && budget.maximum_model_calls >= 0
      && budget.maximum_model_calls <= 10000, "RESEARCH_BUDGET_INVALID");
    const capabilities = await this.observer.read("get_forensic_capabilities");
    const definition = { schema: RESEARCH_VERSION, dates: [...dates].sort(), budget,
      dataset_role: "DISCOVERY", exposed_dates: [...dates].sort(), prompt_version: RESEARCH_PROMPT_VERSION,
      prompt_sha256: this.fingerprint(RESEARCHER_PROMPT), automatic_champion_promotion: false,
      holdout: "NONE_RESERVED", workflow_owner: "DESK_AI_RESEARCHER" };
    const inputHash = this.fingerprint(researchCanonicalJson(definition));
    return this.memory.beginCycle({ cycle_id: this.fingerprint(`${capabilities.index_hash}|${inputHash}`),
      input_hash: inputHash, corpus_hash: capabilities.index_hash, definition });
  }
  async observe({ cycle_id }) {
    let cycle = await this.memory.getCycle(cycle_id);
    requireResearch(cycle, "RESEARCH_CYCLE_NOT_FOUND");
    requireResearch(cycle.status === "OBSERVING", "RESEARCH_CYCLE_STAGE_INVALID");
    for (const date of cycle.definition.dates) {
      const day = await this.observer.day(date, cycle.corpus_hash);
      requireResearch(day.coverage.observed_attempt_count === day.coverage.expected_attempt_count, "RESEARCH_EPISODE_COVERAGE_MISMATCH");
      for (const audit of day.cases) await this.save(cycle_id, "scenario_audit", audit.case_id, audit);
      await this.save(cycle_id, "plan_audit", this.fingerprint(`${cycle_id}|${date}|PLAN`), planQualityAudit(day));
    }
    cycle = await this.memory.getCycle(cycle_id);
    return this.memory.transition({ cycle_id, expected_revision: cycle.revision, status: "DIAGNOSING", checkpoint: { observed_at: this.clock() } });
  }
  async diagnose({ cycle_id, limit = 1 }) {
    const cycle = await this.memory.getCycle(cycle_id);
    requireResearch(cycle?.status === "DIAGNOSING", "RESEARCH_CYCLE_STAGE_INVALID");
    requireResearch(Number.isInteger(limit) && limit >= 1 && limit <= 20, "RESEARCH_CHUNK_INVALID");
    requireResearch(this.model, "RESEARCH_MODEL_NOT_CONFIGURED");
    const selection = selectResearchModel(await this.model.capabilities());
    const audits = await this.all(cycle_id, "scenario_audit"), done = await this.all(cycle_id, "finding");
    const complete = new Set(done.map(d => d.payload.case_id)), pending = audits.filter(a => !complete.has(a.payload.case_id));
    const remaining = cycle.definition.budget.maximum_model_calls - done.length;
    requireResearch(!pending.length || remaining > 0, "RESEARCH_BUDGET_EXHAUSTED", { pending: pending.length });
    for (const item of pending.slice(0, Math.min(limit, remaining))) await this.analyzeOne({ cycle, selection, audit: item.payload });
    const finished = done.length + Math.min(pending.length, limit, remaining) === audits.length;
    return this.memory.transition({ cycle_id, expected_revision: cycle.revision, status: finished ? "CLUSTERING" : "DIAGNOSING",
      checkpoint: { model: selection, diagnoses_completed: (await this.all(cycle_id, "finding")).length, total_cases: audits.length } });
  }
  async analyzeOne({ cycle, selection, audit }) {
    const response = await callResearchModel({ memory: this.memory, model: this.model, fingerprint: this.fingerprint, cycle,
      requestId: this.fingerprint(`${cycle.cycle_id}|${audit.case_id}|MODEL`),
      request: { role: "DESK_AI_RESEARCHER", selection, instructions: RESEARCHER_PROMPT,
        input: audit, output_schema: RESEARCH_ROLE_OUTPUT_SCHEMA } });
    const result = validateResearcherAnswer({ output: response.output, audit });
    await this.save(cycle.cycle_id, "finding", this.fingerprint(`${cycle.cycle_id}|${audit.case_id}|DIAGNOSIS`), {
      case_id: audit.case_id, result, source_identity: audit.identity, model: selection,
      prompt_sha256: cycle.definition.prompt_sha256, context_sha256: this.fingerprint(JSON.stringify(audit)),
      generated_at: this.clock(), actual_telemetry: response.telemetry ?? null, status: "UNREVIEWED" });
  }
  async cluster({ cycle_id }) {
    const cycle = await this.memory.getCycle(cycle_id);
    requireResearch(cycle?.status === "CLUSTERING", "RESEARCH_CYCLE_STAGE_INVALID");
    const cases = (await this.all(cycle_id, "scenario_audit")).map(r => r.payload), groups = new Map();
    for (const audit of cases) {
      const key = scenarioFamilyKey(audit, this.fingerprint);
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(audit);
    }
    for (const [family_id, members] of groups) await this.save(cycle_id, "family", this.fingerprint(`${cycle_id}|${family_id}`), {
      family_id, basis: "EXACT_STRUCTURAL_SIGNATURE_NOT_SEMANTIC_EQUIVALENCE", case_ids: members.map(c => c.case_id),
      scorecard: researchScorecard(members), redundancy_conclusion: "UNKNOWN" });
    return this.memory.transition({ cycle_id, expected_revision: cycle.revision, status: "HYPOTHESIZING", checkpoint: { families: groups.size } });
  }
  async scorecard({ cycle_id, rule }) {
    const cases = (await this.all(cycle_id, "scenario_audit")).map(r => r.payload);
    return rule ? researchCohorts({ cases, rule }) : researchScorecard(cases);
  }
  async save(cycle_id, kind, id, payload) {
    return this.memory.putArtifact({ cycle_id, kind, id, payload, payload_hash: this.fingerprint(researchCanonicalJson(payload)) });
  }
  async all(cycle_id, kind) {
    const rows = []; let cursor;
    do { const page = await this.memory.listArtifacts({ cycle_id, kind, limit: 200, cursor });
      rows.push(...page.items); cursor = page.next_cursor; } while (cursor);
    return rows;
  }
}
