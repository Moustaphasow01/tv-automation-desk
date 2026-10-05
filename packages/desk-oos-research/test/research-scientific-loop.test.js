import test from 'node:test';
import assert from 'node:assert/strict';
import { ResearchScientificLoop } from '../src/application/research-scientific-loop.js';
import { freezePublishedAudit, executePublishedAudit } from '../src/domain/published-counterfactual-experiment.js';
import { ResearchCycle } from '../src/application/research-cycle.js';
import { MemoryFixture, fingerprint, clock, identity, packet } from './research-fixtures.js';
import { createScenarioSelfAudit } from '../src/domain/scenario-self-audit.js';
import { validateResearchOutput } from '../src/domain/research-output-validation.js';
import { EXPERIMENT_DESIGN_SCHEMA } from '../src/application/research-scientific-loop.js';
import { ResearchApi } from '../src/application/research-api.js';
import { ResearchScheduler } from '../src/application/research-scheduler.js';

const design = { action: 'ENGINE_PUBLISHED_AUDIT', variant: 'BE1', mechanism: 'TEST_ONLY_MECHANISM',
  thresholds: { minimum_trades: 2, minimum_days: 2, minimum_expectancy_delta: 0.1, minimum_winner_preservation: 1 },
  limitation: 'Synthetic fixtures are not market data; no strategy or validation claim.' };
function cases() {
  return ['2026-07-02', '2026-08-03'].map((date, i) => createScenarioSelfAudit({ identity: { ...identity, date }, packet: packet(),
    events: [], fingerprint, trades: [{ trade_id: `TEST-${i}`, real_R: i ? -1 : 3, cf_BE_1: i ? 0 : 3,
      real_USD: i ? -5 : 15, exit_time: `${date}T12:00:00Z`, source: 'ENGINE_PUBLISHED_ONLY', recalculated: false,
      provenance: { source_event_hash: fingerprint(`event-${i}`), provenance_ref: `TEST-ref-${i}` } }] }));
}
function frozen(items = cases()) {
  return freezePublishedAudit({ cycle: { cycle_id: 'C', corpus_hash: 'CORPUS' }, hypothesis: { hypothesis_id: 'H' },
    design, cases: items, fingerprint, clock });
}
async function fixture(output = design) {
  const memory = new MemoryFixture(), cycle = new ResearchCycle({ memory, fingerprint, clock,
    observer: { assertCorpus: async () => {} } });
  await memory.beginCycle({ cycle_id: 'C', input_hash: 'SOURCE_INPUT', corpus_hash: 'CORPUS',
    definition: { dates: ['2026-07-02', '2026-08-03'], budget: { maximum_model_calls: 10 } } });
  await memory.transition({ cycle_id: 'C', expected_revision: 0, status: 'COMPLETED' });
  for (const item of cases()) await cycle.save('C', 'scenario_audit', item.case_id, item);
  const hypothesis = { id: 'H', payload: { hypothesis_id: 'H', target_component: 'MANAGEMENT',
    mechanism: 'TEST_ONLY_MECHANISM', sample_size: { independent_days: 2 }, winner_regression_set: { at_risk: [] } } };
  const hypotheses = { all: async () => [hypothesis] };
  await cycle.save('C', 'critique', 'TEST-critique', { hypothesis_id: 'H', independent: true, verdict: 'READY_FOR_EXPERIMENT' });
  const requests = [], model = { capabilities: async () => [{ identifier: 'TEST_MODEL', capability_source: 'TEST_ONLY',
    available: true, reasoning: true, capability_rank: 1, reasoning_efforts: ['xhigh'] }], analyze: async request => {
    requests.push(request); return { output, model_identifier: 'TEST_MODEL', reasoning_effort: 'xhigh' };
  } };
  return { memory, cycle, hypotheses, model, fingerprint, clock, requests, hypothesis };
}

test('protocol freezes full eligible sample, excludes smoke/gap, then hashes source identity', () => {
  const items = cases(), smoke = { ...items[0], case_id: 'SMOKE', identity: { ...items[0].identity, sample_purpose: 'TECHNICAL_SMOKE' } };
  const gap = { ...items[0], case_id: 'GAP', identity: { ...items[0].identity, scorable: false } };
  assert.deepEqual(frozen([...items, smoke, gap]).sample, frozen(items).sample);
  assert.equal(frozen().status, 'FROZEN_RESEARCH_PROTOCOL');
  assert.equal(frozen().dataset_role, 'DISCOVERY');
  assert.equal(frozen().holdout, 'NONE_RESERVED');
});
test('uses published paired values only, never substitutes REAL timestamps/USD for counterfactual path', () => {
  const result = executePublishedAudit({ protocol: frozen(), cases: cases(), fingerprint });
  assert.equal(result.status, 'DEVELOPMENT_AUDIT_SUPPORTED');
  assert.equal(result.expectancy_delta, 0.5); assert.equal(result.winner_preservation, 1);
  assert.equal(result.challenger.realized_closed_trade_drawdown_R.available, false);
  assert.equal(result.challenger.net_USD.available, false);
  assert.equal(result.portfolio_effects.available, false);
  assert.equal(result.validated_edge, false); assert.equal(result.financial_recalculation, false);
  assert.equal(result.promotion_allowed, false);
});
test('missing counterfactual is not zero or a gain, and prevents full sample pass', () => {
  const items = cases(); items[1].observations.trades[0].cf_BE_1 = null;
  const result = executePublishedAudit({ protocol: frozen(items), cases: items, fingerprint });
  assert.equal(result.status, 'INCOMPLETE_EVIDENCE'); assert.equal(result.paired_trades, 1);
  assert.equal(result.skipped[0].reason, 'NOT_PERSISTED'); assert.equal(result.skipped[0].trade_id, 'TEST-1');
});
test('a modification that removes a runner fails the preregistered winner gate', () => {
  const items = cases(); items[0].observations.trades[0].cf_BE_1 = 2.75;
  const result = executePublishedAudit({ protocol: frozen(items), cases: items, fingerprint });
  assert.ok(result.expectancy_delta > 0); assert.equal(result.status, 'REJECTED_DEVELOPMENT_AUDIT');
  assert.equal(result.winners_at_risk[0].trade_id, 'TEST-0');
});
test('protocol, source and sample drift cannot quietly change a preregistered audit', () => {
  const protocol = frozen(); assert.throws(() => executePublishedAudit({ protocol: { ...protocol, challenger: 'BE0.5' }, cases: cases(), fingerprint }), /PROTOCOL_DRIFT/);
  const items = cases(); items[0].observations.trades[0].provenance.source_event_hash = fingerprint('CHANGED');
  assert.throws(() => executePublishedAudit({ protocol, cases: items, fingerprint }), /SAMPLE_DRIFT/);
  const changed = cases(); changed[0].observations.trades[0].cf_BE_1 = 50;
  assert.throws(() => executePublishedAudit({ protocol, cases: changed, fingerprint }), /SAMPLE_DRIFT/);
});
test('technical validator enforces integer bounds and never accepts economic thresholds outside the protocol', () => {
  assert.doesNotThrow(() => validateResearchOutput(design, EXPERIMENT_DESIGN_SCHEMA));
  for (const minimum_trades of [0, 1.5, Infinity]) assert.throws(() => validateResearchOutput({ ...design,
    thresholds: { ...design.thresholds, minimum_trades } }, EXPERIMENT_DESIGN_SCHEMA), /RESEARCH_OUTPUT/);
  assert.throws(() => validateResearchOutput({ ...design,
    thresholds: { ...design.thresholds, minimum_winner_preservation: 1.01 } }, EXPERIMENT_DESIGN_SCHEMA), /RANGE_INVALID/);
});
test('unknown fields, invented trade results and alternative financial recalculation are forbidden', () => {
  const items = cases(); items[0].observations.trades[0].source = 'LLM_ESTIMATE';
  assert.throws(() => frozen(items), /UNPUBLISHED_TRADE/);
  const other = cases(); other[0].observations.trades[0].recalculated = true;
  assert.throws(() => frozen(other), /UNPUBLISHED_TRADE/);
});
test('autonomously selects, preregisters, survives restart, executes once and persists next-task decision', async () => {
  const f = await fixture(), first = await new ResearchScientificLoop(f).tick({ cycle_id: 'C' });
  assert.equal(first.state, 'RESEARCH_EXPERIMENT_PREREGISTERED');
  assert.equal((await f.cycle.all('C', 'experiment')).length, 1);
  const after = await new ResearchScientificLoop(f).tick({ cycle_id: 'C' });
  assert.equal(after.status, 'DEVELOPMENT_AUDIT_SUPPORTED'); assert.equal(after.experiment_executed, true);
  assert.equal((await new ResearchScientificLoop(f).tick({ cycle_id: 'C' })).state, 'SCIENTIFIC_SWEEP_RECORDED');
  await new ResearchScientificLoop(f).tick({ cycle_id: 'C' });
  assert.equal(f.requests.length, 1); assert.equal((await f.cycle.all('C', 'experiment')).length, 1);
  const decisions = (await f.cycle.all('C', 'finding')).filter(row => row.payload.scientific_stage === 'EXPERIMENT_DECISION');
  assert.equal(decisions.length, 1); assert.equal(decisions[0].payload.promotion_allowed, false);
  const input = JSON.stringify(f.requests[0].input);
  assert.equal(input.includes('cf_BE_1'), false); assert.equal(input.includes('real_R'), false);
  assert.equal(f.requests[0].role, 'DESK_AI_EXPERIMENT_DESIGNER');
});
test('rejected critique skips paid inference and chooses the next hypothesis', async () => {
  const f = await fixture(); f.memory.artifacts.delete('C:critique:TEST-critique');
  await f.cycle.save('C', 'critique', 'TEST-weak', { hypothesis_id: 'H', independent: true, verdict: 'WEAK' });
  const result = await new ResearchScientificLoop(f).tick({ cycle_id: 'C' });
  assert.equal(result.status, 'WEAK'); assert.equal(result.next_action, 'SELECT_NEXT_HYPOTHESIS');
  assert.equal(f.requests.length, 0); assert.equal((await f.cycle.all('C', 'experiment')).length, 0);
});
test('unsupported strategy is not silently converted into a management experiment', async () => {
  const f = await fixture(); f.hypothesis.payload.target_component = 'CONFIRMATION';
  const result = await new ResearchScientificLoop(f).tick({ cycle_id: 'C' });
  assert.equal(result.status, 'UNSUPPORTED_DISCRIMINATING_TEST'); assert.equal(result.experiment_executed, false);
  assert.equal((await f.cycle.all('C', 'experiment')).length, 0);
});
test('next task remains explicit when an isolated engine is necessary, without a replay command', async () => {
  const f = await fixture({ ...design, action: 'NEEDS_ISOLATED_RUNTIME', variant: null });
  const result = await new ResearchScientificLoop(f).tick({ cycle_id: 'C' });
  assert.equal(result.status, 'NEEDS_ISOLATED_RUNTIME'); assert.equal(result.experiment_executed, false);
  assert.equal((await f.cycle.all('C', 'experiment')).length, 0);
  assert.equal((await new ResearchScientificLoop(f).tick({ cycle_id: 'C' })).state, 'SCIENTIFIC_SWEEP_RECORDED');
  const memory = (await f.cycle.all('C', 'finding')).find(row => row.payload.scientific_stage === 'SCIENTIFIC_SWEEP');
  assert.deepEqual(memory.payload.required_capabilities, ['ISOLATED_RESEARCH_ENGINE_EXECUTOR']);
});
test('scientific work uses the persistent queue, model/resource journal and checkpoint across scheduler restarts', async () => {
  const f = await fixture(), scheduled = new Map(), settled = [];
  const queue = { schedule: async ({ cycle_id }) => {
    if (!scheduled.has(cycle_id)) scheduled.set(cycle_id, { cycle_id, task_id: cycle_id, status: 'READY', attempts: 0, maximum_attempts: 5 });
    return scheduled.get(cycle_id);
  }, claim: async () => { const task = [...scheduled.values()].find(row => row.status === 'READY');
    if (task) task.status = 'RUNNING'; return task; }, worker: async () => {}, heartbeat: async () => {},
  settle: async (task, result) => { task.status = result.status; settled.push(result); }, incident: () => assert.fail('no incident expected') };
  const science = new ResearchScientificLoop(f), api = new ResearchApi({ ...f, science });
  const first = await science.schedule({ source_cycle_id: 'C', queue });
  assert.equal((await science.schedule({ source_cycle_id: 'C', queue })).cycle_id, first.cycle_id);
  assert.equal(scheduled.size, 1);
  const timers = { setInterval: () => 1, clearInterval: () => {} };
  let scheduler = new ResearchScheduler({ api, queue, worker_id: 'test-before-restart', timers });
  assert.equal((await scheduler.tick()).result.state, 'RESEARCH_EXPERIMENT_PREREGISTERED');
  scheduler = new ResearchScheduler({ api, queue, worker_id: 'test-after-restart', timers });
  assert.equal((await scheduler.tick()).result.status, 'DEVELOPMENT_AUDIT_SUPPORTED');
  assert.equal((await scheduler.tick()).state, 'COMPLETED');
  assert.equal((await f.memory.getCycle(first.cycle_id)).status, 'COMPLETED');
  assert.equal((await f.memory.getCycle('C')).revision, 1);
  assert.equal(f.requests.length, 1); assert.deepEqual(settled.map(row => row.status), ['READY', 'READY', 'COMPLETED']);
  const scorecard=await api.scorecard({cycle_id:first.cycle_id});
  assert.equal(scorecard.source_cycle_id,'C');assert.equal(scorecard.trades,2);
  assert.equal(scorecard.metrics_basis,'CHAMPION_REAL_NOT_EXPERIMENTAL_REPLAY');
});
test('quota exhaustion during experiment design becomes a durable wait, not an uncertain paid call or busy loop', async () => {
  const f = await fixture(), science = new ResearchScientificLoop(f), rows = [];
  await science.schedule({ source_cycle_id: 'C', queue: { schedule: async row => rows.push(row) } });
  const cycle_id = rows[0].cycle_id;
  f.model.admission = async () => ({ allowed: false, source: 'TEST_ONLY', resume_at: '2030-01-01T00:00:00Z' });
  let settlement;
  const queue = { claim: async () => ({ task_id: cycle_id, cycle_id, attempts: 0, maximum_attempts: 5 }),
    worker: async () => {}, heartbeat: async () => {}, settle: async (task, result) => { settlement = result; },
    incident: () => assert.fail('quota is not a technical incident') };
  const api = new ResearchApi({ ...f, science }), timers = { setInterval: () => 1, clearInterval: () => {} };
  const result = await new ResearchScheduler({ api, queue, worker_id: 'quota-test', timers }).tick();
  assert.equal(result.state, 'WAITING_RESOURCE'); assert.equal(settlement.status, 'READY');
  assert.ok(settlement.delay_ms > 0); assert.equal(f.requests.length, 0);
  assert.equal((await f.memory.listEvents(cycle_id)).some(row => row.type === 'MODEL_REQUESTED'), false);
});
