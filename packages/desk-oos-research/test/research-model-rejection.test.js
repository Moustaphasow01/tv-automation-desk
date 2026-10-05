import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { codexResearchRejectionEvidence } from '../src/adapter/codex-research-rejection-evidence.js';
import { recordResearchRejection } from '../src/application/research-rejection-recovery.js';
import { callResearchModel } from '../src/application/research-model-call.js';
import { MemoryFixture, fingerprint } from './research-fixtures.js';

const selection = { identifier: 'gpt-6-astra', reasoning_effort: 'xhigh' };
const request = { instructions: 'TEST_ONLY', input: { fixture: true }, selection, role: 'TEST_RESEARCH' };
const requested = { request_id: 'a'.repeat(64), model: selection, prompt_sha256: fingerprint(request.instructions),
  context_sha256: fingerprint(JSON.stringify(request.input)) };
function trace() {
  return [
    { type: 'event_msg', timestamp: '2026-10-05T10:07:19Z', payload: { type: 'task_started', turn_id: 'T' } },
    { type: 'turn_context', payload: { model: selection.identifier, effort: 'xhigh' } },
    { type: 'response_item', payload: { role: 'user', content: [{ text:
      `${request.instructions}\n\nUNTRUSTED_PERSISTED_EVIDENCE_JSON:\n${JSON.stringify(request.input)}` }] } },
    { type: 'event_msg', payload: { type: 'token_count', info: null } },
    { type: 'event_msg', timestamp: '2026-10-05T10:07:23Z', payload: { type: 'task_complete', turn_id: 'T',
      last_agent_message: null, error: { codex_error_info: 'server_overloaded' } } },
  ];
}
async function source(t, rows = trace()) {
  const root = await mkdtemp(path.join(tmpdir(), 'research-rejection-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'rollout-2026-10-05T12-07-19-test.jsonl');
  const raw = rows.map(JSON.stringify).join('\n'); await writeFile(file, raw);
  const reader = codexResearchRejectionEvidence({ sessions_root: root, fingerprint });
  const args = { source_path: file, source_sha256: fingerprint(raw), requested,
    requested_at: '2026-10-05T10:07:18Z' };
  return { reader, args, file };
}
async function fixture(t) {
  const s = await source(t), memory = new MemoryFixture();
  await memory.beginCycle({ cycle_id: 'C', definition: { budget: { maximum_model_calls: 5 } } });
  await memory.addEvent({ cycle_id: 'C', event_id: requested.request_id, type: 'MODEL_REQUESTED',
    created_at: s.args.requested_at, payload: requested });
  await recordResearchRejection({ memory, readEvidence: s.reader, fingerprint,
    command: { cycle_id: 'C', request_id: requested.request_id, ...s.args } });
  return { ...s, memory, cycle: await memory.getCycle('C') };
}

test('exact terminal rejection is recorded idempotently without modifying original request', async t => {
  const f = await fixture(t), before = JSON.stringify(f.memory.events[0]);
  const proof = await recordResearchRejection({ memory: f.memory, readEvidence: f.reader, fingerprint,
    command: { cycle_id: 'C', request_id: requested.request_id, ...f.args } });
  assert.equal(proof.reason, 'server_overloaded'); assert.equal(f.memory.events.length, 2);
  assert.equal(JSON.stringify(f.memory.events[0]), before);
});

test('one verified retry survives restart, caches delivered response and preserves original request', async t => {
  const f = await fixture(t); let calls = 0;
  const model = { analyze: async () => { calls++; return { output: { test: true }, model_identifier: selection.identifier,
    reasoning_effort: 'xhigh' }; } };
  const args = { memory: f.memory, model, fingerprint, cycle: f.cycle, request, requestId: requested.request_id };
  const original = JSON.stringify(f.memory.events[0]);
  assert.deepEqual(await callResearchModel(args), await callResearchModel(args)); assert.equal(calls, 1);
  assert.equal(JSON.stringify(f.memory.events[0]), original);
  const retry = f.memory.events.find(e => e.type === 'MODEL_REQUESTED' && e.payload.recovery_parent_request_id);
  assert.equal(retry.payload.recovery_parent_request_id, requested.request_id);
});

test('uncertain retry remains blocked after restart, never a third inference', async t => {
  const f = await fixture(t); let calls = 0;
  const model = { analyze: async () => { calls++; throw new Error('transport lost'); } };
  const args = { memory: f.memory, model, fingerprint, cycle: f.cycle, request, requestId: requested.request_id };
  await assert.rejects(callResearchModel(args));
  await assert.rejects(callResearchModel(args), { code: 'RESEARCH_MODEL_REQUEST_INDETERMINATE' });
  assert.equal(calls, 1);
});

for (const mutation of ['network', 'assistant', 'tokens', 'model', 'context', 'time', 'turn']) {
  test(`rejection certificate refuses ${mutation}`, async t => {
    const rows = trace();
    if (mutation === 'network') rows.at(-1).payload.error.codex_error_info = 'stream_disconnected';
    if (mutation === 'assistant') rows.push({ type: 'response_item', payload: { role: 'assistant', content: [] } });
    if (mutation === 'tokens') rows[3].payload.info = { output_tokens: 1 };
    if (mutation === 'model') rows[1].payload.model = 'other';
    if (mutation === 'context') rows[2].payload.content[0].text += 'altered';
    if (mutation === 'time') rows[0].timestamp = '2026-10-04T10:07:19Z';
    if (mutation === 'turn') rows.at(-1).payload.turn_id = 'other';
    const f = await source(t, rows); await assert.rejects(f.reader(f.args));
  });
}

test('source bytes are reverified and auth/config paths are never accepted', async t => {
  const f = await source(t); await writeFile(f.file, 'changed');
  await assert.rejects(f.reader(f.args), { code: 'RESEARCH_REJECTION_SOURCE_HASH_MISMATCH' });
  const file = path.join(path.dirname(f.file), 'auth.json'); await writeFile(file, '{}');
  await assert.rejects(f.reader({ ...f.args, source_path: file }), { code: 'RESEARCH_REJECTION_SOURCE_FORBIDDEN' });
});

test('rejection certificate never authorizes changed context or model', async t => {
  const f = await fixture(t), model = { analyze: async () => assert.fail('must not infer') };
  const args = { memory: f.memory, model, fingerprint, cycle: f.cycle, requestId: requested.request_id };
  await assert.rejects(callResearchModel({ ...args, request: { ...request, input: { changed: true } } }),
    { code: 'RESEARCH_MODEL_RESPONSE_CONTEXT_CONFLICT' });
  await assert.rejects(callResearchModel({ ...args, request: { ...request, selection: { ...selection, identifier: 'other' } } }),
    { code: 'RESEARCH_MODEL_DRIFT' });
});
