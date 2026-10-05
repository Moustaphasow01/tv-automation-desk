import { requireResearch } from '../domain/research-evidence.js';
import { researchCanonicalJson } from '../domain/research-canonical-json.js';
import { selectResearchModel } from '../domain/research-governance.js';
import { validateResearchOutput } from '../domain/research-output-validation.js';
import { freezePublishedAudit, executePublishedAudit, experimentSample, PUBLISHED_AUDIT_VARIANTS } from '../domain/published-counterfactual-experiment.js';
import { callResearchModel } from './research-model-call.js';

export const EXPERIMENT_DESIGN_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['action', 'variant', 'mechanism', 'thresholds', 'limitation'], properties: {
    action: { type: 'string', enum: ['ENGINE_PUBLISHED_AUDIT', 'NEEDS_ISOLATED_RUNTIME', 'NO_DISCRIMINATING_TEST'] },
    variant: { type: ['string', 'null'], enum: [...Object.keys(PUBLISHED_AUDIT_VARIANTS), null] },
    mechanism: { type: 'string' }, limitation: { type: 'string' },
    thresholds: { type: 'object', additionalProperties: false,
      required: ['minimum_trades', 'minimum_days', 'minimum_expectancy_delta', 'minimum_winner_preservation'],
      properties: { minimum_trades: { type: 'integer', minimum: 1 }, minimum_days: { type: 'integer', minimum: 1 },
        minimum_expectancy_delta: { type: 'number', minimum: 0 },
        minimum_winner_preservation: { type: 'number', minimum: 0, maximum: 1 } } } } };

const DESIGN_PROMPT = `You are DESK_AI_EXPERIMENT_DESIGNER. Work in RESEARCH only.
Choose the smallest discriminating test for the supplied hypothesis, or explicitly require an isolated runtime.
The only executable capability in this adapter is comparison of already ENGINE-published single-trade counterfactuals.
Never claim such an audit implements the proposed strategy, produces different fills, proves portfolio effects or validates edge.
Do not force a management variant onto a MAP/CONFIRMATION/ENTRY/FILTER/REENTRY hypothesis.
No prices, new replay, modified plan, champion changes or guessed outcomes. No holdout has been reserved.
All July/August inputs are DISCOVERY. Thresholds are preregistered before variant outcomes are read.
The design sees publication coverage, not variant profitability. Return NO_DISCRIMINATING_TEST if evidence cannot decide.
Explain the mechanism and limitations. No recommendations for live trading.`;

/** Durable scientific next-task planner; no broker, replay, Pine or champion port. */
export class ResearchScientificLoop {
  constructor({ cycle, hypotheses, memory, model, fingerprint, clock }) {
    Object.assign(this, { cycle, hypotheses, memory, model, fingerprint, clock });
  }
  async schedule({ source_cycle_id, queue }) {
    const source = await this.memory.getCycle(source_cycle_id);
    requireResearch(source?.status === 'COMPLETED', 'RESEARCH_SCIENCE_REQUIRES_GLOBAL_AUDIT');
    requireResearch(typeof source.input_hash === 'string' && Array.isArray(source.definition.dates),
      'RESEARCH_SCIENCE_SOURCE_METADATA_REQUIRED');
    const count = (await this.hypotheses.all(source_cycle_id)).length;
    const definition = { kind: 'SCIENTIFIC_EXPERIMENTS', source_cycle_id, source_input_hash: source.input_hash,
      dates: source.definition.dates, dataset_role: 'DISCOVERY', prompt_version: 'DESK_AI_EXPERIMENT_DESIGNER_V1',
      prompt_sha256: this.fingerprint(DESIGN_PROMPT), budget: { maximum_model_calls: count + 10 },
      champion_mutable: false, promotion_allowed: false };
    const input_hash = this.fingerprint(researchCanonicalJson(definition));
    const cycle_id = this.fingerprint(`${source.corpus_hash}|${input_hash}`);
    const cycle = await this.memory.beginCycle({ cycle_id, input_hash, corpus_hash: source.corpus_hash, definition });
    if (cycle.status === 'COMPLETED') return { state: 'SCIENTIFIC_SWEEP_RECORDED', cycle_id };
    await queue.schedule({ cycle_id, priority: -200 });
    return { state: 'SCIENTIFIC_TASK_SCHEDULED', cycle_id, source_cycle_id };
  }
  async tick({ cycle_id }) {
    return this.memory.executeExclusive(cycle_id, () => this.advance({ cycle_id }));
  }
  async advance({ cycle_id }) {
    const cycle = await this.memory.getCycle(cycle_id);
    requireResearch(cycle, 'RESEARCH_CYCLE_NOT_FOUND');
    const source = await this.memory.getCycle(cycle.definition.source_cycle_id ?? cycle_id);
    requireResearch(source?.status === 'COMPLETED', 'RESEARCH_SCIENCE_REQUIRES_GLOBAL_AUDIT');
    requireResearch(source.corpus_hash === cycle.corpus_hash, 'RESEARCH_SCIENCE_SOURCE_DRIFT');
    if (cycle.definition.kind === 'SCIENTIFIC_EXPERIMENTS') requireResearch(source.input_hash === cycle.definition.source_input_hash,
      'RESEARCH_SCIENCE_SOURCE_DRIFT');
    await this.cycle.observer.assertCorpus(cycle.corpus_hash);
    const hypotheses = await this.hypotheses.all(source.cycle_id);
    const results = await this.cycle.all(cycle_id, 'finding');
    const completed = new Set(results.filter(row => row.payload.scientific_stage === 'EXPERIMENT_DECISION')
      .map(row => row.payload.hypothesis_id));
    const next = hypotheses.filter(row => !completed.has(row.id)).sort(prioritize).at(0);
    if (!next) return this.finish(cycle, hypotheses.length);
    return this.advanceCandidate(cycle, next, source.cycle_id);
  }
  async advanceCandidate(cycle, row, source_cycle_id) {
    const critique = (await this.cycle.all(source_cycle_id, 'critique')).find(item => item.payload.hypothesis_id === row.id)?.payload;
    if (!critique?.independent || critique.verdict !== 'READY_FOR_EXPERIMENT') {
      return this.recordDecision(cycle, row.id, { status: critique?.verdict ?? 'INDEPENDENT_CRITIQUE_MISSING',
        next_action: 'SELECT_NEXT_HYPOTHESIS', experiment_executed: false, critique });
    }
    const cases = (await this.cycle.all(source_cycle_id, 'scenario_audit')).map(item => item.payload);
    const id = this.fingerprint(`${cycle.cycle_id}|${row.id}|PUBLISHED_AUDIT_PROTOCOL_V1`);
    let stored = await this.memory.findArtifact({ kind: 'experiment', id });
    if (!stored) {
      const design = await this.design(cycle, row.payload, cases);
      if (design.action !== 'ENGINE_PUBLISHED_AUDIT') return this.recordDecision(cycle, row.id,
        { status: design.action, next_action: 'SELECT_NEXT_HYPOTHESIS', experiment_executed: false,
          design, required_capability: design.action === 'NEEDS_ISOLATED_RUNTIME' ? 'ISOLATED_RESEARCH_ENGINE_EXECUTOR' : null });
      if (row.payload.target_component !== 'MANAGEMENT') return this.recordDecision(cycle, row.id,
        { status: 'UNSUPPORTED_DISCRIMINATING_TEST', reason: 'RESEARCH_AUDIT_PROXY_INCOMPATIBLE', design,
          next_action: 'SELECT_NEXT_HYPOTHESIS', experiment_executed: false,
          required_capability: 'ISOLATED_RESEARCH_ENGINE_EXECUTOR' });
      const protocol = freezePublishedAudit({ cycle, hypothesis: row.payload, design, cases,
        fingerprint: this.fingerprint, clock: this.clock });
      stored = await this.cycle.save(cycle.cycle_id, 'experiment', id, protocol);
      return { state: 'RESEARCH_EXPERIMENT_PREREGISTERED', cycle_id: cycle.cycle_id,
        experiment_id: id, protocol_sha256: protocol.protocol_sha256 };
    }
    requireResearch(stored.payload_hash === this.fingerprint(researchCanonicalJson(stored.payload)),
      'RESEARCH_EXPERIMENT_STORED_HASH_INVALID');
    const result = executePublishedAudit({ protocol: stored.payload, cases, fingerprint: this.fingerprint });
    await this.cycle.observer.assertCorpus(cycle.corpus_hash);
    return this.recordDecision(cycle, row.id, { ...result, experiment_id: id,
      experiment_executed: true, execution_kind: 'PUBLISHED_AUDIT_ONLY', source_protocol_hash: stored.payload_hash });
  }
  async design(cycle, hypothesis, cases) {
    const sample = experimentSample(cases), selection = selectResearchModel(await this.model.capabilities());
    const coverage = Object.fromEntries(Object.entries(PUBLISHED_AUDIT_VARIANTS).map(([name, field]) =>
      [name, { published: sample.filter(row => Number.isFinite(row.trade[field])).length, total: sample.length }]));
    const response = await callResearchModel({ memory: this.memory, model: this.model, fingerprint: this.fingerprint, cycle,
      requestId: this.fingerprint(`${cycle.cycle_id}|${hypothesis.hypothesis_id}|EXPERIMENT_DESIGN_V1`),
      request: { role: 'DESK_AI_EXPERIMENT_DESIGNER', selection, instructions: DESIGN_PROMPT,
        input: { hypothesis, available_publications: coverage, sample_selection: 'ALL_PERSISTED_SCORABLE_OOS_TRADES',
          dataset_role: 'DISCOVERY', holdout: 'NONE_RESERVED', available_execution: 'ENGINE_PUBLISHED_AUDIT_ONLY' },
        output_schema: EXPERIMENT_DESIGN_SCHEMA } });
    validateResearchOutput(response.output, EXPERIMENT_DESIGN_SCHEMA);
    const id = this.fingerprint(`${cycle.cycle_id}|${hypothesis.hypothesis_id}|EXPERIMENT_DESIGN_V1`);
    const prior = await this.memory.findArtifact({ kind: 'finding', id });
    if (!prior) await this.cycle.save(cycle.cycle_id, 'finding', id, { scientific_stage: 'EXPERIMENT_DESIGN',
      hypothesis_id: hypothesis.hypothesis_id, design: response.output, model: selection,
      prompt_sha256: this.fingerprint(DESIGN_PROMPT), actual_telemetry: response.telemetry ?? null,
      classification: 'RESEARCH_INTERPRETATION', validated_edge: false });
    return response.output;
  }
  async recordDecision(cycle, hypothesis_id, result) {
    const payload = { ...result, scientific_stage: 'EXPERIMENT_DECISION', hypothesis_id,
      cycle_id: cycle.cycle_id, generated_at: this.clock(), validated_edge: false,
      champion_modified: false, promotion_allowed: false };
    const id = this.fingerprint(`${cycle.cycle_id}|${hypothesis_id}|EXPERIMENT_RESULT_V1`);
    await this.cycle.save(cycle.cycle_id, 'finding', id, payload);
    return { state: 'RESEARCH_EXPERIMENT_DECISION', cycle_id: cycle.cycle_id, hypothesis_id, status: payload.status,
      experiment_executed: payload.experiment_executed, next_action: 'SELECT_NEXT_HYPOTHESIS' };
  }
  async finish(cycle, hypotheses) {
    const id = this.fingerprint(`${cycle.cycle_id}|SCIENTIFIC_SWEEP_V1`);
    if (!await this.memory.findArtifact({ kind: 'finding', id })) {
      const decisions = (await this.cycle.all(cycle.cycle_id, 'finding')).filter(item => item.payload.scientific_stage === 'EXPERIMENT_DECISION');
      await this.cycle.save(cycle.cycle_id, 'finding', id, { scientific_stage: 'SCIENTIFIC_SWEEP',
        conclusion: 'CURRENT_CHAMPION_REMAINS_BEST', meaning: 'No candidate has untouched validation/holdout evidence; not proof of optimality.',
        hypotheses_considered: hypotheses, experiments_executed: decisions.filter(item => item.payload.experiment_executed).length,
        required_capabilities: [...new Set(decisions.map(item => item.payload.required_capability).filter(Boolean))],
        discovery_only: true, validated_edge: false, promotion_allowed: false, generated_at: this.clock(),
        next_action: 'ISOLATED_EXECUTOR_OR_UNTOUCHED_VALIDATION_REQUIRED' });
    }
    if (cycle.definition.kind === 'SCIENTIFIC_EXPERIMENTS' && cycle.status !== 'COMPLETED') {
      await this.memory.transition({ cycle_id: cycle.cycle_id, expected_revision: cycle.revision, status: 'COMPLETED',
        checkpoint: { scientific_sweep: id, hypotheses_considered: hypotheses, validated_edge: false } });
    }
    return { state: 'SCIENTIFIC_SWEEP_RECORDED', cycle_id: cycle.cycle_id, hypotheses_considered: hypotheses,
      validated_edge: false, champion_modified: false };
  }
}

function prioritize(a, b) {
  const left = hypothesisPriority(a), right = hypothesisPriority(b);
  return right.days - left.days || left.winners_at_risk - right.winners_at_risk
    || a.id.localeCompare(b.id);
}

function hypothesisPriority(row) {
  return { days: row.payload.sample_size?.independent_days ?? 0,
    winners_at_risk: row.payload.winner_regression_set?.at_risk?.length ?? 0 };
}
