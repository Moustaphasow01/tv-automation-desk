import test from 'node:test';
import assert from 'node:assert/strict';
import { ResearchCycle } from '../src/application/research-cycle.js';
import { ResearchHypotheses } from '../src/application/research-hypotheses.js';
import { ResearchApi } from '../src/application/research-api.js';
import { CRITIC_PROMPT } from '../src/domain/research-role-contract.js';
import { hypothesisCitationCatalog, resolveCritiqueCitations } from '../src/domain/research-critique-citations.js';
import { MemoryFixture, fingerprint, clock } from './research-fixtures.js';

async function fixture(refs = ['hypothesis.sample_size', 'cases[0].coverage', 'source-hash']) {
  const memory = new MemoryFixture(), cycle = new ResearchCycle({ memory, fingerprint, clock });
  await memory.beginCycle({ cycle_id: 'C', definition: { budget: { maximum_model_calls: 10 } } });
  memory.cycles.get('C').status = 'COUNTEREXAMPLES';
  const hypothesis = { hypothesis_id: 'H', supporting_cases: ['case'], counterexamples: [],
    winner_regression_set: { all_published_winners: [] }, sample_size: { known_cases: 1 } };
  const audit = { case_id: 'case', evidence_refs: ['source-hash'], coverage: { bars: false } };
  await cycle.save('C', 'hypothesis', 'H', hypothesis);
  await cycle.save('C', 'scenario_audit', 'case', audit);
  const selection = { identifier: 'gpt-6-astra', reasoning_effort: 'xhigh' };
  const model = { capabilities: async () => [{ identifier: 'gpt-6-astra', available: true, reasoning: true,
    capability_rank: 100, reasoning_efforts: ['xhigh'], capability_source: 'TEST_ONLY' }],
    analyze: async () => assert.fail('cached response must not invoke a paid inference') };
  const ledger = new ResearchHypotheses({ cycle, memory, fingerprint, clock, model });
  const request_id = fingerprint('C|H|CRITIC_MODEL');
  const input = { hypothesis, cases: [audit] };
  const metadata = { request_id, prompt_sha256: fingerprint(CRITIC_PROMPT),
    context_sha256: fingerprint(JSON.stringify(input)) };
  await memory.addEvent({ cycle_id: 'C', event_id: request_id, type: 'MODEL_REQUESTED',
    payload: { ...metadata, role: 'DESK_AI_RESEARCH_CRITIC', model: selection } });
  await memory.addEvent({ cycle_id: 'C', event_id: fingerprint(request_id + '|RESPONSE'), type: 'MODEL_RESPONSE_RECEIVED',
    payload: { ...metadata, response: { output: { verdict: 'WEAK', objections: ['Insufficient evidence'], evidence_refs: refs },
      model_identifier: selection.identifier, reasoning_effort: selection.reasoning_effort } } });
  return { memory, cycle, ledger, request_id };
}

test('hypothesis critic recovery preserves original response, hashes and verdict with zero paid calls', async () => {
  const f = await fixture(), before = JSON.stringify(f.memory.events);
  const proof = await f.ledger.assessRecovery({ cycle_id: 'C' });
  assert.equal(proof.new_model_calls, 0); assert.equal(proof.request_id, f.request_id);
  const result = await f.ledger.critique({ cycle_id: 'C', hypothesis_id: 'H' });
  assert.equal(result.verdict, 'WEAK'); assert.equal(result.citation_bindings[0].classification, 'RESEARCH_HYPOTHESIS');
  assert.equal(result.citation_bindings[1].source_pointer, '/coverage');
  assert.equal(JSON.stringify(f.memory.events), before);
  assert.deepEqual(await f.ledger.critique({ cycle_id: 'C', hypothesis_id: 'H' }), result);
});

for (const ref of ['hypothesis.missing', 'cases[1].coverage', 'source-has', 'cases[0].missing']) {
  test(`unknown hypothesis citation remains fail-closed: ${ref}`, async () => {
    const f = await fixture([ref]);
    await assert.rejects(f.ledger.assessRecovery({ cycle_id: 'C' }),
      e => e.code === 'RESEARCH_CITATION_UNKNOWN' && e.details.scope === 'HYPOTHESIS_CRITIC');
  });
}

for (const field of ['context_sha256', 'prompt_sha256']) {
  test(`recovery rejects changed ${field}`, async () => {
    const f = await fixture(); f.memory.events[1].payload[field] = 'corrupted';
    await assert.rejects(f.ledger.assessRecovery({ cycle_id: 'C' }));
  });
}

test('recovery rejects wrong model, missing response and tampered documents', async () => {
  let f = await fixture(); f.memory.events[1].payload.response.model_identifier = 'other';
  await assert.rejects(f.ledger.assessRecovery({ cycle_id: 'C' }), { code: 'RESEARCH_MODEL_DRIFT' });
  f = await fixture(); f.memory.events.pop();
  await assert.rejects(f.ledger.assessRecovery({ cycle_id: 'C' }), { code: 'RESEARCH_RECOVERY_RESPONSE_NOT_PERSISTED' });
  f = await fixture(); (await f.ledger.all('C'))[0].payload.sample_size.known_cases = 99;
  await assert.rejects(f.ledger.assessRecovery({ cycle_id: 'C' }), { code: 'RESEARCH_DOCUMENT_HASH_MISMATCH' });
});

test('API routes hypothesis recovery but never a researcher claim failure', async () => {
  const f = await fixture(), api = new ResearchApi({ cycle: f.cycle, memory: f.memory, hypotheses: f.ledger });
  assert.equal((await api.assessRecovery({ cycle_id: 'C' })).expected_revision, 0);
  f.memory.cycles.get('C').status = 'DIAGNOSING';
  await assert.rejects(api.assessRecovery({ cycle_id: 'C' }), { code: 'RESEARCH_RECOVERY_NOT_APPLICABLE' });
});

test('document catalog only accepts exact existing fields with validated content hashes', async () => {
  const f = await fixture(), hypothesis = (await f.ledger.all('C'))[0], cases = await f.cycle.all('C', 'scenario_audit');
  const catalog = hypothesisCitationCatalog({ hypothesis, cases, fingerprint });
  const bindings = resolveCritiqueCitations({ output: { evidence_refs: ['cases[0].coverage'] }, catalog });
  assert.equal(bindings[0].source_sha256, cases[0].payload_hash);
});
