import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { PostgresResearchMemory } from '../src/adapter/postgres-research-memory.js';

const NOW = '2026-10-04T09:00:00.000Z';
const DEFINITION = { model: 'research-model', model_version: 'model-1', prompt_version: 'prompt-2',
  corpus_version: 'corpus-3', prompt_hash: 'prompt-hash', budget: { tokens: 2500, experiments: 3 } };
const COMMAND = { cycle_id: 'cycle-1', input_hash: 'input-hash', corpus_hash: 'corpus-hash', definition: DEFINITION };
const ROW = { ...COMMAND, status: 'OBSERVING', checkpoint: null, revision: 0, created_at: NOW, updated_at: NOW };
const ARTIFACT = { id: 'artifact-1', payload: { version: 'v1', evidence: ['audit-1'] }, payload_hash: 'payload-hash' };
const KINDS = ['scenario_audit', 'plan_audit', 'hypothesis', 'finding', 'family', 'failure_pattern',
  'winner_pattern', 'experiment', 'critique'];
const TABLES = ['t3_scenario_audits', 't3_plan_audits', 't3_hypotheses', 't3_findings', 't3_scenario_families',
  't3_failure_patterns', 't3_winner_patterns', 't3_experiments', 't3_critiques'];

// Scripted queries prove boundaries/transaction order; PostgreSQL tests below prove SQL semantics.
function mockPool(steps) {
  const calls = [], pending = [...steps];
  let releases = 0;
  async function query(sql, params = []) {
    calls.push({ sql, params });
    assert.doesNotMatch(sql, /SELECT\s+\*/i);
    const step = pending.shift();
    assert.ok(step, `Unexpected query: ${sql}`);
    assert.match(sql, step.match);
    step.check?.(params, sql);
    if (step.error) throw step.error;
    const rows = typeof step.rows === 'function' ? step.rows(params) : step.rows || [];
    return { rows, rowCount: rows.length };
  }
  const client = { query, release: () => { releases += 1; } };
  const pool = { query, connect: async () => client };
  return { pool, calls, done() { assert.equal(pending.length, 0); }, get releases() { return releases; } };
}

function transactionSteps(steps, finish = 'COMMIT') {
  return [{ match: /^BEGIN ISOLATION LEVEL READ COMMITTED$/ },
    { match: /^SET LOCAL statement_timeout/ }, { match: /^SET LOCAL lock_timeout/ },
    { match: /^SET LOCAL synchronous_commit = on$/ },
    ...steps, { match: new RegExp(`^${finish}$`) }];
}

function cycleSelect(row = ROW) {
  return { match: /SELECT cycle_id,input_hash,corpus_hash,definition,status,checkpoint,revision,created_at,updated_at FROM research_state.t3_cycles/,
    rows: row ? [row] : [] };
}

function eventInsert(check) {
  return { match: /INSERT INTO research_state.t3_events/, check,
    rows: p => [{ event_id: p[0], cycle_id: p[1], namespace: 'T3_RESEARCH', type: p[2], payload: JSON.parse(p[3]),
      payload_hash: p[4], schema_version: '1', correlation_id: p[1], causation_id: null, created_at: p[5] }] };
}

function setup(steps, clock = () => NOW) {
  const mock = mockPool(steps);
  return { mock, memory: PostgresResearchMemory({ pool: mock.pool, clock }) };
}

test('beginCycle persists definition, pinned versions, hashes and injected timestamp atomically', async () => {
  const { mock, memory } = setup(transactionSteps([
    { match: /INSERT INTO research_state.t3_cycles/, rows: [ROW], check: p => {
      assert.deepEqual(JSON.parse(p[3]), DEFINITION);
      assert.match(p[4], /^[a-f0-9]{64}$/);
      assert.deepEqual(p.slice(5), ['model-1', 'prompt-2', 'corpus-3', NOW]);
    } }, eventInsert(p => { assert.equal(p[2], 'CycleBegun'); assert.equal(p[5], NOW); }),
  ]));
  assert.deepEqual(await memory.beginCycle(COMMAND), ROW);
  mock.done(); assert.equal(mock.releases, 1);
});

test('beginCycle repeat returns the original cycle and emits no second event', async () => {
  const prior = { ...ROW, status: 'DIAGNOSING', revision: 1 };
  const { mock, memory } = setup(transactionSteps([{ match: /ON CONFLICT \(cycle_id\) DO NOTHING/, rows: [] }, cycleSelect(prior)]));
  assert.deepEqual(await memory.beginCycle({ ...COMMAND, definition: { ...DEFINITION } }), prior);
  mock.done();
});

for (const changed of [{ input_hash: 'other' }, { corpus_hash: 'other' }, { definition: { budget: 1 } }]) {
  test(`beginCycle rejects changed ${Object.keys(changed)[0]} with rollback`, async () => {
    const { mock, memory } = setup(transactionSteps([{ match: /INSERT INTO research_state.t3_cycles/ }, cycleSelect()], 'ROLLBACK'));
    await assert.rejects(memory.beginCycle({ ...COMMAND, ...changed }), { code: 'CYCLE_CONFLICT' });
    mock.done(); assert.equal(mock.releases, 1);
  });
}

test('getCycle returns null or a receipt with ISO dates', async () => {
  const { mock, memory } = setup([cycleSelect(null), cycleSelect({ ...ROW, created_at: new Date(NOW), updated_at: new Date(NOW) })]);
  assert.equal(await memory.getCycle('absent'), null);
  assert.deepEqual(await memory.getCycle('cycle-1'), ROW);
  mock.done();
});

test('transition uses expected revision and writes its event on the same client', async () => {
  const checkpoint = { artifact_id: 'audit-1' };
  const changed = { ...ROW, status: 'DIAGNOSING', checkpoint, revision: 1 };
  const { mock, memory } = setup(transactionSteps([
    { match: /WHERE cycle_id=\$1 AND revision=\$2 RETURNING/, rows: [changed],
      check: p => assert.deepEqual(p, ['cycle-1', 0, 'DIAGNOSING', JSON.stringify(checkpoint), NOW]) },
    eventInsert(p => assert.deepEqual(JSON.parse(p[3]), { expected_revision: 0, revision: 1, status: 'DIAGNOSING', checkpoint })),
  ]));
  assert.deepEqual(await memory.transition({ cycle_id: 'cycle-1', expected_revision: 0, status: 'DIAGNOSING', checkpoint }), changed);
  mock.done();
});

test('transition clears checkpoint using SQL NULL rather than JSON null', async () => {
  const changed = { ...ROW, revision: 1, status: 'COMPLETED' };
  const { mock, memory } = setup(transactionSteps([
    { match: /UPDATE research_state.t3_cycles/, rows: [changed], check: p => assert.equal(p[3], null) }, eventInsert(),
  ]));
  assert.deepEqual(await memory.transition({ cycle_id: 'cycle-1', expected_revision: 0, status: 'COMPLETED', checkpoint: null }), changed);
  mock.done();
});

for (const [row, code] of [[ROW, 'REVISION_CONFLICT'], [null, 'CYCLE_NOT_FOUND']]) {
  test(`transition rejects ${code} without audit or silent overwrite`, async () => {
    const { mock, memory } = setup(transactionSteps([{ match: /UPDATE research_state.t3_cycles/ }, cycleSelect(row)], 'ROLLBACK'));
    await assert.rejects(memory.transition({ cycle_id: 'cycle-1', expected_revision: 0, status: 'COMPLETED', checkpoint: null }), { code });
    mock.done();
  });
}

for (const [index, kind] of KINDS.entries()) {
  test(`putArtifact allows ${kind}, immutable insert and atomic audit`, async () => {
    const { mock, memory } = setup(transactionSteps([cycleSelect(),
      { match: new RegExp(`INSERT INTO research_state.${TABLES[index]}`), rows: [ARTIFACT], check: (p, sql) => {
        assert.equal(p[2], kind); assert.equal(p[5], kind === 'hypothesis' ? 'NEW' : 'RECORDED');
        assert.equal(p[6], 'v1'); assert.equal(p.at(-1), NOW);
        assert.doesNotMatch(sql, /DO UPDATE|UPDATE.*payload/i);
        assert.match(sql, kind === 'hypothesis' || kind === 'experiment' ? /ON CONFLICT \(id\)/ : /ON CONFLICT \(cycle_id,id\)/);
      } }, eventInsert(p => assert.deepEqual(JSON.parse(p[3]), { kind, id: ARTIFACT.id, payload_hash: ARTIFACT.payload_hash })),
    ]));
    assert.deepEqual(await memory.putArtifact({ cycle_id: 'cycle-1', kind, ...ARTIFACT }), ARTIFACT);
    mock.done();
  });
}

for (const kind of ['hypothesis', 'experiment']) {
  test(`${kind} deduplicates across cycles by id and returns first payload`, async () => {
    const { mock, memory } = setup(transactionSteps([cycleSelect({ ...ROW, cycle_id: 'cycle-2' }),
      { match: /ON CONFLICT \(id\) DO NOTHING/ },
      { match: /SELECT id,payload,payload_hash.*FROM research_state\./, rows: [ARTIFACT],
        check: (p, sql) => { assert.deepEqual(p, [ARTIFACT.id]); assert.match(sql, /WHERE id=\$1/); } },
    ]));
    assert.deepEqual(await memory.putArtifact({ cycle_id: 'cycle-2', kind, ...ARTIFACT }), ARTIFACT);
    mock.done();
  });
}

test('integer versions are explicit text columns without mutating the integration payload', async () => {
  const artifact = { ...ARTIFACT, payload: { version: 2, schema_version: 1, model_version: 3 } };
  const { mock, memory } = setup(transactionSteps([cycleSelect(),
    { match: /INSERT INTO research_state.t3_hypotheses/, rows: [artifact], check: p => {
      assert.deepEqual(JSON.parse(p[3]), artifact.payload);
      assert.deepEqual(p.slice(6, 10), ['2', '1', '3', null]);
    } }, eventInsert(),
  ]));
  assert.deepEqual(await memory.putArtifact({ cycle_id: 'cycle-1', kind: 'hypothesis', ...artifact }), artifact);
  mock.done();
});

for (const changed of [{ payload_hash: 'different' }, { payload: { different: true } }]) {
  test(`artifact identity conflict on ${Object.keys(changed)[0]} rolls back`, async () => {
    const { mock, memory } = setup(transactionSteps([cycleSelect(), { match: /INSERT INTO research_state.t3_hypotheses/ },
      { match: /SELECT id,payload,payload_hash/, rows: [ARTIFACT] }], 'ROLLBACK'));
    await assert.rejects(memory.putArtifact({ cycle_id: 'cycle-1', kind: 'hypothesis', ...ARTIFACT, ...changed }), { code: 'ARTIFACT_CONFLICT' });
    mock.done();
  });
}

test('same scoped artifact is a no-op, but a new artifact requires an existing cycle', async () => {
  const { mock, memory } = setup(transactionSteps([cycleSelect(), { match: /INSERT INTO research_state.t3_findings/ },
    { match: /SELECT id,payload,payload_hash/, rows: [ARTIFACT],
      check: (p, sql) => { assert.deepEqual(p, ['cycle-1', ARTIFACT.id]); assert.match(sql, /cycle_id=\$1 AND id=\$2/); } }])
    .concat(transactionSteps([cycleSelect(null)], 'ROLLBACK')));
  assert.deepEqual(await memory.putArtifact({ cycle_id: 'cycle-1', kind: 'finding', ...ARTIFACT }), ARTIFACT);
  await assert.rejects(memory.putArtifact({ cycle_id: 'absent', kind: 'finding', ...ARTIFACT }), { code: 'CYCLE_NOT_FOUND' });
  mock.done();
});

test('pagination has stable keyset order, exact projections and scoped opaque cursor', async () => {
  const second = { ...ARTIFACT, id: 'artifact-2' };
  const { mock, memory } = setup([
    { match: /ORDER BY id COLLATE "C" ASC LIMIT \$3/, rows: [ARTIFACT, second],
      check: p => assert.deepEqual(p, ['cycle-1', null, 2]) },
    { match: /id COLLATE "C" > \$2::text COLLATE "C"/, rows: [second],
      check: p => assert.deepEqual(p, ['cycle-1', ARTIFACT.id, 2]) },
  ]);
  const first = await memory.listArtifacts({ cycle_id: 'cycle-1', kind: 'finding', limit: 1 });
  assert.deepEqual(first.items, [ARTIFACT]); assert.ok(first.next_cursor);
  const next = await memory.listArtifacts({ cycle_id: 'cycle-1', kind: 'finding', limit: 1, cursor: first.next_cursor });
  assert.deepEqual(next, { items: [second], next_cursor: null });
  await assert.rejects(memory.listArtifacts({ cycle_id: 'cycle-2', kind: 'finding', cursor: first.next_cursor }), { code: 'CURSOR_INVALID' });
  await assert.rejects(memory.listArtifacts({ cycle_id: 'cycle-1', kind: 'critique', cursor: first.next_cursor }), { code: 'CURSOR_INVALID' });
  mock.done();
});

test('pagination default is 50 and empty result has null cursor', async () => {
  const { mock, memory } = setup([{ match: /SELECT id,payload,payload_hash/, check: p => assert.equal(p[2], 51) }]);
  assert.deepEqual(await memory.listArtifacts({ cycle_id: 'cycle-1', kind: 'finding' }), { items: [], next_cursor: null });
  mock.done();
});

test('events use T3_RESEARCH envelope, injected date and immutable identity', async () => {
  let existing;
  const command = { cycle_id: 'cycle-1', event_id: 'event-1', type: 'CritiqueRecorded', payload: { b: 2, a: 1 } };
  const insertion = eventInsert((p, sql) => { assert.match(sql, /'T3_RESEARCH'/); assert.equal(p[5], NOW); });
  const rows = insertion.rows;
  insertion.rows = p => { existing = rows(p)[0]; return [existing]; };
  const prior = { match: /SELECT event_id,cycle_id,namespace,type,payload,payload_hash/,
    rows: () => [existing] };
  const { mock, memory } = setup(transactionSteps([cycleSelect(), insertion])
    .concat(transactionSteps([cycleSelect(), { match: /INSERT INTO research_state.t3_events/ }, prior]))
    .concat(transactionSteps([cycleSelect(), { match: /INSERT INTO research_state.t3_events/ }, prior], 'ROLLBACK')));
  const receipt = await memory.addEvent(command);
  assert.equal(receipt.correlation_id, command.cycle_id); assert.equal(receipt.namespace, 'T3_RESEARCH');
  assert.deepEqual(await memory.addEvent({ ...command, payload: { a: 1, b: 2 } }), receipt);
  await assert.rejects(memory.addEvent({ ...command, type: 'OtherType' }), { code: 'EVENT_CONFLICT' });
  mock.done();
});

for (const operation of ['begin', 'transition', 'artifact']) {
  test(`${operation} rolls back when the event write fails and releases its client`, async () => {
    const failedEvent = { match: /INSERT INTO research_state.t3_events/, error: new Error('audit unavailable') };
    const steps = operation === 'begin' ? [{ match: /INSERT INTO research_state.t3_cycles/, rows: [ROW] }]
      : operation === 'transition' ? [{ match: /UPDATE research_state.t3_cycles/, rows: [{ ...ROW, revision: 1 }] }]
        : [cycleSelect(), { match: /INSERT INTO research_state.t3_findings/, rows: [ARTIFACT] }];
    const { mock, memory } = setup(transactionSteps([...steps, failedEvent], 'ROLLBACK'));
    const promise = operation === 'begin' ? memory.beginCycle(COMMAND)
      : operation === 'transition' ? memory.transition({ cycle_id: 'cycle-1', expected_revision: 0, status: 'DIAGNOSING', checkpoint: null })
        : memory.putArtifact({ cycle_id: 'cycle-1', kind: 'finding', ...ARTIFACT });
    await assert.rejects(promise, /audit unavailable/);
    mock.done(); assert.equal(mock.releases, 1);
  });
}

test('rollback failure preserves original error and still releases client', async () => {
  const error = new Error('database disconnected');
  const { mock, memory } = setup(transactionSteps([{ match: /INSERT INTO research_state.t3_cycles/, error }], 'ROLLBACK')
    .map(step => step.match.source === '^ROLLBACK$' ? { ...step, error: new Error('rollback unavailable') } : step));
  await assert.rejects(memory.beginCycle(COMMAND), received => received === error && received.rollbackError.message === 'rollback unavailable');
  assert.equal(mock.releases, 1); mock.done();
});

test('validation rejects SQL identifiers, invalid limits, revisions, statuses and hypothesis promotion before any query', async () => {
  const { mock, memory } = setup([]);
  await assert.rejects(memory.putArtifact({ cycle_id: 'cycle-1', kind: '__proto__', ...ARTIFACT }), { code: 'ARTIFACT_KIND_INVALID' });
  await assert.rejects(memory.putArtifact({ cycle_id: 'cycle-1', kind: 'finding; DROP TABLE x', ...ARTIFACT }), { code: 'ARTIFACT_KIND_INVALID' });
  await assert.rejects(memory.putArtifact({ cycle_id: 'cycle-1', kind: 'hypothesis', ...ARTIFACT, payload: { status: 'VALIDATED' } }), { code: 'HYPOTHESIS_STATUS_INVALID' });
  for (const limit of [0, -1, 1.5, 501, '50']) {
    await assert.rejects(memory.listArtifacts({ cycle_id: 'cycle-1', kind: 'finding', limit }), { code: 'LIMIT_INVALID' });
  }
  await assert.rejects(memory.listArtifacts({ cycle_id: 'cycle-1', kind: 'finding', cursor: 'invalid' }), { code: 'CURSOR_INVALID' });
  await assert.rejects(memory.transition({ cycle_id: 'cycle-1', expected_revision: -1, status: 'COMPLETED', checkpoint: null }), { code: 'REVISION_INVALID' });
  await assert.rejects(memory.transition({ cycle_id: 'cycle-1', expected_revision: 0, status: 'VALIDATED', checkpoint: null }), { code: 'STATUS_INVALID' });
  await assert.rejects(memory.beginCycle({ ...COMMAND, definition: [] }), { code: 'JSON_OBJECT_REQUIRED' });
  await assert.rejects(memory.beginCycle({ ...COMMAND, input_hash: '' }), { code: 'INPUT_HASH_REQUIRED' });
  mock.done(); assert.equal(mock.calls.length, 0);
});

test('ids and hashes remain bound parameters', async () => {
  const hostileId = "cycle'); DELETE FROM research_state.t3_cycles; --";
  const { mock, memory } = setup([{ ...cycleSelect(null), check: (p, sql) => {
    assert.deepEqual(p, [hostileId]); assert.ok(!sql.includes(hostileId));
  } }]);
  assert.equal(await memory.getCycle(hostileId), null); mock.done();
});

test('invalid injected clock rolls back without writing a cycle', async () => {
  const { mock, memory } = setup(transactionSteps([], 'ROLLBACK'), () => 'invalid date');
  await assert.rejects(memory.beginCycle(COMMAND), { code: 'CLOCK_INVALID' }); mock.done();
});

for (const [index, kind] of KINDS.entries()) {
  test(`findArtifact reads ${kind} by global id without cycle scope`, async () => {
    const { mock, memory } = setup([
      { match: new RegExp(`FROM research_state.${TABLES[index]}`), rows: [ARTIFACT], check: (p, sql) => {
        assert.deepEqual(p, [ARTIFACT.id]); assert.match(sql, /WHERE id=\$1 ORDER BY created_at,cycle_id COLLATE "C" LIMIT 1/);
      } }, { match: /SELECT id,payload,payload_hash/, rows: [] },
    ]);
    assert.deepEqual(await memory.findArtifact({ kind, id: ARTIFACT.id }), ARTIFACT);
    assert.equal(await memory.findArtifact({ kind, id: 'absent' }), null);
    mock.done();
  });
}

test('listEvents returns durable requests and uncertain outcomes in deterministic order', async () => {
  const events = [
    { event_id: 'request-1', cycle_id: 'cycle-1', type: 'MODEL_REQUESTED', namespace: 'T3_RESEARCH', payload: { model_version: 'm1' }, created_at: new Date(NOW) },
    { event_id: 'uncertain-1', cycle_id: 'cycle-1', type: 'MODEL_RESULT_UNCERTAIN', namespace: 'T3_RESEARCH', payload: { request_id: 'request-1' }, created_at: new Date(NOW) },
  ];
  const { mock, memory } = setup([{ match: /WHERE cycle_id=\$1 ORDER BY created_at,event_id COLLATE "C"/,
    rows: events, check: p => assert.deepEqual(p, ['cycle-1']) }]);
  assert.deepEqual(await memory.listEvents('cycle-1'), events.map(row => ({ ...row, created_at: NOW })));
  mock.done();
});

function lockQuery(locked = true) {
  return { match: /^SELECT pg_try_advisory_lock\(hashtext\('T3:' \|\| \$1\)\) AS locked$/,
    rows: [{ locked }], check: p => assert.deepEqual(p, ['cycle-1']) };
}

function unlockQuery() {
  return { match: /^SELECT pg_advisory_unlock\(hashtext\('T3:' \|\| \$1\)\) AS unlocked$/,
    rows: [{ unlocked: true }], check: p => assert.deepEqual(p, ['cycle-1']) };
}

test('executeExclusive runs callback outside a transaction then unlocks and releases', async () => {
  const { mock, memory } = setup([lockQuery(), unlockQuery()]);
  assert.equal(await memory.executeExclusive('cycle-1', async () => {
    assert.equal(mock.calls.length, 1); assert.equal(mock.releases, 0); return 'done';
  }), 'done');
  assert.equal(mock.releases, 1); mock.done();
});

test('executeExclusive refuses busy cycle without calling model or unlocking another session', async () => {
  const { mock, memory } = setup([lockQuery(false)]);
  let calls = 0;
  await assert.rejects(memory.executeExclusive('cycle-1', async () => { calls += 1; }), { code: 'CYCLE_BUSY' });
  assert.equal(calls, 0); assert.equal(mock.releases, 1); mock.done();
});

test('executeExclusive releases acquired lock when callback fails', async () => {
  const { mock, memory } = setup([lockQuery(), unlockQuery()]);
  await assert.rejects(memory.executeExclusive('cycle-1', async () => { throw new Error('model outcome uncertain'); }), /model outcome uncertain/);
  assert.equal(mock.releases, 1); mock.done();
});

test('uncertain lock or failed unlock destroys the session and preserves the operation failure', async () => {
  const acquireError = new Error('connection lost');
  const releaseErrors = [];
  const acquired = mockPool([{ ...lockQuery(), error: acquireError }]);
  acquired.pool.connect = async () => ({ query: acquired.pool.query, release: error => releaseErrors.push(error) });
  const memory = PostgresResearchMemory({ pool: acquired.pool, clock: () => NOW });
  await assert.rejects(memory.executeExclusive('cycle-1', () => assert.fail('must not run')), /connection lost/);
  assert.equal(releaseErrors[0], acquireError); acquired.done();
  const unlockError = new Error('unlock failed'), modelError = new Error('model uncertain');
  const locked = mockPool([lockQuery(), { ...unlockQuery(), error: unlockError }]);
  locked.pool.connect = async () => ({ query: locked.pool.query, release: error => releaseErrors.push(error) });
  const other = PostgresResearchMemory({ pool: locked.pool, clock: () => NOW });
  await assert.rejects(other.executeExclusive('cycle-1', async () => { throw modelError; }), error => error === modelError && error.unlockError === unlockError);
  assert.equal(releaseErrors[1], unlockError); locked.done();
});

test('MODEL_REQUESTED commits durably before callback invokes model under the session lock', async () => {
  const { mock, memory } = setup([lockQuery(), ...transactionSteps([cycleSelect(), eventInsert()]), unlockQuery()]);
  await memory.executeExclusive('cycle-1', async () => {
    await memory.addEvent({ cycle_id: 'cycle-1', event_id: 'model-request', type: 'MODEL_REQUESTED', payload: { model_version: 'm1' } });
    assert.equal(mock.calls.at(-1).sql, 'COMMIT'); // Simulated external invocation starts only after durable audit.
    assert.equal(mock.releases, 1); // The short transaction client has been returned; lock session remains held.
  });
  assert.equal(mock.releases, 2); mock.done();
});

const runPostgres = process.env.RUN_POSTGRES_TESTS === '1' && Boolean(process.env.DATABASE_URL);
test('real PostgreSQL: idempotent migration, atomic events, immutable evidence and concurrent identities',
  { skip: runPostgres ? false : 'Opt-in: RUN_POSTGRES_TESTS=1 and DATABASE_URL required', timeout: 120000 }, async t => {
    const require = createRequire(new URL('../../../mcp_gpt_desk/package.json', import.meta.url));
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8, connectionTimeoutMillis: 5000 });
    // Each run owns only this unique schema; the supplied database's existing schemas stay untouched.
    const schema = `t3_memory_test_${randomUUID().replaceAll('-', '')}`;
    const sql = await readFile(new URL('../../../infra/postgres/init/075_oos_research_memory.sql', import.meta.url), 'utf8');
    const scoped = scopedPool(pool, schema);
    const memory = PostgresResearchMemory({ pool: scoped, clock: () => NOW });
    const ownedRoles = [];
    try {
      await t.test('migration on empty schema can be rerun without changing evidence', async () => {
        await scoped.query(sql);
        await memory.beginCycle(COMMAND);
        await scoped.query(sql);
        assert.deepEqual(await memory.getCycle('cycle-1'), ROW);
        const tables = await pool.query('SELECT tablename FROM pg_tables WHERE schemaname=$1', [schema]);
        assert.equal(tables.rowCount, 11);
      });
      await t.test('concurrent begin inserts one cycle and one event', async () => {
        const command = { ...COMMAND, cycle_id: 'parallel' };
        const results = await Promise.all([memory.beginCycle(command), memory.beginCycle(command)]);
        assert.deepEqual(results[0], results[1]);
        assert.equal(await eventCount(scoped, 'parallel'), 1);
        await assert.rejects(memory.beginCycle({ ...command, input_hash: 'other' }), { code: 'CYCLE_CONFLICT' });
      });
      await t.test('optimistic concurrency allows one transition and one audit', async () => {
        const command = { cycle_id: 'parallel', expected_revision: 0, status: 'DIAGNOSING', checkpoint: { step: 1 } };
        const results = await Promise.allSettled([memory.transition(command), memory.transition(command)]);
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
        assert.equal(results.find(result => result.status === 'rejected').reason.code, 'REVISION_CONFLICT');
        assert.equal((await memory.getCycle('parallel')).revision, 1);
        assert.equal(await eventCount(scoped, 'parallel'), 2);
        const completed = await memory.transition({ cycle_id: 'parallel', expected_revision: 1, status: 'COMPLETED', checkpoint: null });
        assert.equal(completed.checkpoint, null);
        assert.equal((await memory.getCycle('parallel')).checkpoint, null);
      });
      await t.test('all artifact kinds are immutable, correctly typed, versioned and audited', async () => {
        for (const [index, kind] of KINDS.entries()) {
          const command = { cycle_id: 'cycle-1', kind, ...ARTIFACT, id: kind };
          assert.deepEqual(await memory.putArtifact(command), { ...ARTIFACT, id: kind });
          await memory.putArtifact(command);
          const result = await scoped.query(`SELECT kind,status,artifact_version FROM research_state.${TABLES[index]} WHERE id=$1`, [kind]);
          assert.deepEqual(result.rows[0], { kind, status: kind === 'hypothesis' ? 'NEW' : 'RECORDED', artifact_version: 'v1' });
          await assert.rejects(scoped.query(`UPDATE research_state.${TABLES[index]} SET payload=$1::jsonb WHERE id=$2`, ['{}', kind]), { code: '55000' });
        }
        assert.equal(await eventCount(scoped, 'cycle-1'), 10);
      });
      await t.test('global hypothesis/experiment IDs deduplicate between cycles and on concurrent writes', async () => {
        await memory.beginCycle({ ...COMMAND, cycle_id: 'cycle-2' });
        for (const kind of ['hypothesis', 'experiment']) {
          const original = { cycle_id: 'cycle-1', kind, ...ARTIFACT, id: kind };
          assert.deepEqual(await memory.putArtifact({ ...original, cycle_id: 'cycle-2' }), { ...ARTIFACT, id: kind });
          await assert.rejects(memory.putArtifact({ ...original, cycle_id: 'cycle-2', payload_hash: 'other' }), { code: 'ARTIFACT_CONFLICT' });
          await assert.rejects(memory.putArtifact({ ...original, cycle_id: 'cycle-2', payload: { other: true } }), { code: 'ARTIFACT_CONFLICT' });
          const same = { ...original, id: `concurrent-${kind}` };
          await Promise.all([memory.putArtifact(same), memory.putArtifact({ ...same, cycle_id: 'cycle-2' })]);
          const count = await scoped.query(`SELECT count(*)::integer AS count FROM research_state.${kind === 'hypothesis' ? 't3_hypotheses' : 't3_experiments'} WHERE id=$1`, [same.id]);
          assert.equal(count.rows[0].count, 1);
        }
      });
      await t.test('scoped artifact IDs can repeat across cycles; pagination resumes by id', async () => {
        const artifact = { ...ARTIFACT, id: 'finding', payload_hash: 'cycle-2-hash', payload: { origin: 'cycle-2' } };
        await memory.putArtifact({ cycle_id: 'cycle-2', kind: 'finding', ...artifact });
        for (const id of ['Z', 'a', 'b', 'é']) await memory.putArtifact({ cycle_id: 'cycle-2', kind: 'finding', ...ARTIFACT, id });
        const first = await memory.listArtifacts({ cycle_id: 'cycle-2', kind: 'finding', limit: 2 });
        assert.deepEqual(first.items.map(item => item.id), ['Z', 'a']);
        await memory.putArtifact({ cycle_id: 'cycle-2', kind: 'finding', ...ARTIFACT, id: 'A' });
        const second = await memory.listArtifacts({ cycle_id: 'cycle-2', kind: 'finding', limit: 10, cursor: first.next_cursor });
        assert.deepEqual(second.items.map(item => item.id), ['b', 'finding', 'é']);
        assert.equal(second.next_cursor, null);
      });
      await t.test('events repeat immutably, conflict on cycle/type/payload and cannot be deleted', async () => {
        const command = { cycle_id: 'cycle-1', event_id: 'explicit-event', type: 'ResearchObserved', payload: { a: 1 } };
        const first = await memory.addEvent(command);
        assert.deepEqual(await memory.addEvent(command), first);
        for (const diff of [{ type: 'Other' }, { cycle_id: 'cycle-2' }, { payload: { a: 2 } }]) {
          await assert.rejects(memory.addEvent({ ...command, ...diff }), { code: 'EVENT_CONFLICT' });
        }
        await assert.rejects(scoped.query('DELETE FROM research_state.t3_events WHERE event_id=$1', ['explicit-event']), { code: '55000' });
        assert.equal(first.namespace, 'T3_RESEARCH'); assert.equal(first.created_at, NOW);
      });
      await t.test('failed audit rolls back begin, transition and artifact writes in real transactions', async () => {
        const failing = PostgresResearchMemory({ pool: scopedPool(pool, schema, failEvent), clock: () => NOW });
        await assert.rejects(failing.beginCycle({ ...COMMAND, cycle_id: 'rolled-back' }), /audit unavailable/);
        assert.equal(await memory.getCycle('rolled-back'), null);
        await assert.rejects(failing.transition({ cycle_id: 'cycle-1', expected_revision: 0, status: 'COMPLETED', checkpoint: null }), /audit unavailable/);
        assert.equal((await memory.getCycle('cycle-1')).revision, 0);
        await assert.rejects(failing.putArtifact({ cycle_id: 'cycle-1', kind: 'finding', ...ARTIFACT, id: 'rolled-back' }), /audit unavailable/);
        const rows = await scoped.query('SELECT id FROM research_state.t3_findings WHERE id=$1', ['rolled-back']);
        assert.equal(rows.rowCount, 0);
      });
      await t.test('foreign keys and status checks reject orphan evidence and unknown cycle states', async () => {
        await assert.rejects(memory.putArtifact({ cycle_id: 'absent', kind: 'finding', ...ARTIFACT }), { code: 'CYCLE_NOT_FOUND' });
        await assert.rejects(scoped.query('UPDATE research_state.t3_cycles SET status=$1 WHERE cycle_id=$2', ['INVALID', 'cycle-1']), { code: '23514' });
        await assert.rejects(scoped.query(`INSERT INTO research_state.t3_hypotheses (cycle_id,id,status,payload,payload_hash)
          VALUES ($1,$2,$3,$4::jsonb,$5)`, ['cycle-1', 'invalid-promotion', 'VALIDATED', '{}', 'hash']), { code: '23514' });
      });
      await t.test('findArtifact sees prior ideas without cycle scope', async () => {
        for (const kind of ['hypothesis', 'experiment']) {
          assert.deepEqual(await memory.findArtifact({ kind, id: kind }), { ...ARTIFACT, id: kind });
        }
        assert.equal(await memory.findArtifact({ kind: 'hypothesis', id: 'absent' }), null);
      });
      await t.test('session lock prevents simultaneous model calls; uncertain result leaves durable request', async () => {
        let entered, failedEntry, resume, calls = 0;
        const entry = new Promise((resolve, reject) => { entered = resolve; failedEntry = reject; });
        const barrier = new Promise(resolve => { resume = resolve; });
        const first = memory.executeExclusive('cycle-1', async () => {
          await memory.addEvent({ cycle_id: 'cycle-1', event_id: 'model-1', type: 'MODEL_REQUESTED', payload: { model_version: 'm1' } });
          calls += 1; entered(); await barrier;
          throw new Error('uncertain result');
        });
        first.catch(failedEntry);
        // Attach a rejection handler before unblocking, avoiding an unhandled model failure.
        const failed = assert.rejects(first, /uncertain result/);
        try {
          await entry;
          await assert.rejects(memory.executeExclusive('cycle-1', async () => { calls += 1; }), { code: 'CYCLE_BUSY' });
          const events = await memory.listEvents('cycle-1');
          assert.equal(events.filter(event => event.type === 'MODEL_REQUESTED').length, 1);
          assert.equal(calls, 1);
          assert.equal(await memory.executeExclusive('cycle-2', async () => 'different cycle'), 'different cycle');
        } finally { resume(); await failed; }
        await memory.addEvent({ cycle_id: 'cycle-1', event_id: 'uncertain-model-1', type: 'MODEL_RESULT_UNCERTAIN', payload: { request_id: 'model-1' } });
        const events = await memory.listEvents('cycle-1');
        assert.equal(events.filter(event => event.type === 'MODEL_REQUESTED').length, 1);
        assert.equal(events.filter(event => event.type === 'MODEL_RESULT_UNCERTAIN').length, 1);
        // Reacquisition tests lock cleanup only; application must block another model request here.
        assert.equal(await memory.executeExclusive('cycle-1', async () => 'lock released'), 'lock released');
      });
      await t.test('physical reader/writer roles grant rights only on isolated research tables', async roleTest => {
        const capability = await pool.query('SELECT rolsuper,rolcreaterole FROM pg_roles WHERE rolname=current_user');
        if (!capability.rows[0].rolsuper && !capability.rows[0].rolcreaterole) {
          roleTest.skip('Role isolation test requires CREATEROLE on the opted-in test server'); return;
        }
        const reader = `${schema}_reader`, writer = `${schema}_writer`;
        for (const role of [reader, writer]) {
          assert.match(role, /^t3_memory_test_[a-f0-9]{32}_(reader|writer)$/);
          await pool.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT`); ownedRoles.push(role);
        }
        await pool.query(`GRANT USAGE ON SCHEMA ${schema} TO ${reader},${writer}`);
        await pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${reader},${writer}`);
        await pool.query(`GRANT INSERT ON ALL TABLES IN SCHEMA ${schema} TO ${writer}`);
        await pool.query(`GRANT UPDATE(status,checkpoint,revision,updated_at) ON ${schema}.t3_cycles TO ${writer}`);
        const client = await pool.connect();
        try {
          await client.query(`SET ROLE ${reader}`);
          assert.equal((await client.query(`SELECT cycle_id FROM ${schema}.t3_cycles WHERE cycle_id=$1`, ['cycle-1'])).rowCount, 1);
          await assert.rejects(client.query(`INSERT INTO ${schema}.t3_findings (cycle_id,id,payload,payload_hash) VALUES ($1,$2,$3::jsonb,$4)`,
            ['cycle-1', 'forbidden-reader', '{}', 'hash']), { code: '42501' });
          await assert.rejects(client.query(`UPDATE ${schema}.t3_cycles SET checkpoint=NULL WHERE cycle_id=$1`, ['cycle-1']), { code: '42501' });
          await client.query('RESET ROLE'); await client.query(`SET ROLE ${writer}`);
          await client.query(`INSERT INTO ${schema}.t3_findings (cycle_id,id,payload,payload_hash) VALUES ($1,$2,$3::jsonb,$4)`, ['cycle-1', 'writer-evidence', '{}', 'hash']);
          await client.query(`UPDATE ${schema}.t3_cycles SET checkpoint=NULL WHERE cycle_id=$1`, ['cycle-1']);
          await assert.rejects(client.query(`UPDATE ${schema}.t3_cycles SET input_hash=$1 WHERE cycle_id=$2`, ['changed-hash', 'cycle-1']), { code: '42501' });
          await assert.rejects(client.query(`UPDATE ${schema}.t3_findings SET payload=$1::jsonb WHERE id=$2`, ['{}', 'writer-evidence']), { code: '42501' });
          await assert.rejects(client.query(`DELETE FROM ${schema}.t3_events WHERE event_id=$1`, ['model-1']), { code: '42501' });
        } finally { try { await client.query('RESET ROLE'); } finally { client.release(); } }
      });
    } finally {
      // Generated, validated schema is the sole cleanup target, never a shared research schema.
      assert.match(schema, /^t3_memory_test_[a-f0-9]{32}$/);
      try {
        await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        for (const role of ownedRoles) await pool.query(`DROP ROLE ${role}`);
      } finally { await pool.end(); }
    }
  });

function scopedPool(pool, schema, check = () => {}) {
  function query(db, sql, params) {
    check(sql);
    return db.query(sql.replaceAll('research_state', schema), params);
  }
  return { query: (sql, params) => query(pool, sql, params), async connect() {
    const client = await pool.connect();
    return { query: (sql, params) => query(client, sql, params), release: () => client.release() };
  } };
}

function failEvent(sql) {
  if (sql.includes('INSERT INTO research_state.t3_events')) throw new Error('audit unavailable');
}

async function eventCount(pool, cycleId) {
  const result = await pool.query('SELECT count(*)::integer AS count FROM research_state.t3_events WHERE cycle_id=$1', [cycleId]);
  return result.rows[0].count;
}
