import { createHash, randomUUID } from 'node:crypto';

const CYCLE_COLUMNS = 'cycle_id,input_hash,corpus_hash,definition,status,checkpoint,revision,created_at,updated_at';
const ARTIFACT_COLUMNS = 'id,payload,payload_hash';
const EVENT_COLUMNS = 'event_id,cycle_id,namespace,type,payload,payload_hash,schema_version,correlation_id,causation_id,created_at';
const TABLES = Object.freeze({
  scenario_audit: 't3_scenario_audits', plan_audit: 't3_plan_audits',
  hypothesis: 't3_hypotheses', finding: 't3_findings', family: 't3_scenario_families',
  failure_pattern: 't3_failure_patterns', winner_pattern: 't3_winner_patterns',
  experiment: 't3_experiments', critique: 't3_critiques',
});
const STATUSES = new Set(['OBSERVING', 'DIAGNOSING', 'CLUSTERING', 'HYPOTHESIZING',
  'COUNTEREXAMPLES', 'CRITIQUING', 'EXPERIMENT_READY', 'COMPLETED', 'FAILED_TECHNICAL', 'BLOCKED_DATA']);

// Storage port only: lifecycle decisions and later hypothesis versions belong to the caller.
// Callable as a factory or with `new`; no pg dependency is needed by the adapter.
export function PostgresResearchMemory({ pool, clock }) {
  requireValue(pool && typeof pool.connect === 'function' && typeof pool.query === 'function', 'POOL_INVALID');
  requireValue(typeof clock === 'function', 'CLOCK_INVALID');
  const context = { pool, clock };
  return Object.freeze({
    beginCycle: command => beginCycle(context, command),
    getCycle: cycleId => getCycle(pool, cycleId),
    transition: command => transition(context, command),
    putArtifact: command => putArtifact(context, command),
    findArtifact: query => findArtifact(pool, query),
    listArtifacts: query => listArtifacts(pool, query),
    addEvent: command => addEvent(context, command),
    listEvents: cycleId => listEvents(pool, cycleId),
    executeExclusive: (cycleId, operation) => executeExclusive(pool, cycleId, operation),
  });
}

function requireValue(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

function textValue(value, code) {
  requireValue(typeof value === 'string' && value.trim().length > 0, code);
  return value;
}

function jsonObject(value) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'JSON_OBJECT_REQUIRED');
  try {
    const copy = JSON.parse(JSON.stringify(value));
    requireValue(copy !== null && typeof copy === 'object' && !Array.isArray(copy), 'JSON_OBJECT_REQUIRED');
    return copy;
  } catch (cause) {
    throw Object.assign(new Error('JSON_OBJECT_REQUIRED', { cause }), { code: 'JSON_OBJECT_REQUIRED' });
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function contentHash(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function timestamp(clock) {
  const value = clock();
  requireValue(typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value)), 'CLOCK_INVALID');
  return new Date(value).toISOString();
}

function cycleReceipt(row) {
  if (!row) return null;
  return { ...row, created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString() };
}

async function withTransaction(pool, work) {
  const client = await pool.connect();
  let connectionError;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query('SET LOCAL synchronous_commit = on');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) {
      error.rollbackError = rollbackError;
      connectionError = rollbackError;
    }
    throw error;
  } finally {
    client.release(connectionError);
  }
}

async function getCycle(db, cycleId) {
  textValue(cycleId, 'CYCLE_ID_REQUIRED');
  const result = await db.query(`SELECT ${CYCLE_COLUMNS} FROM research_state.t3_cycles WHERE cycle_id=$1`, [cycleId]);
  return cycleReceipt(result.rows[0]);
}

async function beginCycle(context, { cycle_id, input_hash, corpus_hash, definition }) {
  textValue(cycle_id, 'CYCLE_ID_REQUIRED');
  textValue(input_hash, 'INPUT_HASH_REQUIRED');
  textValue(corpus_hash, 'CORPUS_HASH_REQUIRED');
  const snapshot = jsonObject(definition), definitionHash = contentHash(snapshot);
  return withTransaction(context.pool, async client => {
    const at = timestamp(context.clock);
    const result = await client.query(`INSERT INTO research_state.t3_cycles
      (cycle_id,input_hash,corpus_hash,definition,definition_hash,model_version,prompt_version,corpus_version,created_at,updated_at)
      VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$9)
      ON CONFLICT (cycle_id) DO NOTHING RETURNING ${CYCLE_COLUMNS}`,
    [cycle_id, input_hash, corpus_hash, JSON.stringify(snapshot), definitionHash,
      optionalVersion(snapshot.model_version), optionalVersion(snapshot.prompt_version), optionalVersion(snapshot.corpus_version), at]);
    const row = cycleReceipt(result.rows[0]) || await getCycle(client, cycle_id);
    requireValue(row && row.input_hash === input_hash && row.corpus_hash === corpus_hash
      && contentHash(row.definition) === definitionHash, 'CYCLE_CONFLICT');
    if (result.rows.length) await insertEvent(client, {
      cycle_id, event_id: randomUUID(), type: 'CycleBegun',
      payload: { input_hash, corpus_hash, definition_hash: definitionHash, revision: 0 }, at,
    });
    return row;
  });
}

function optionalVersion(value) {
  if (value === undefined || value === null) return null;
  return versionValue(value);
}

function versionValue(value) {
  if (Number.isSafeInteger(value) && value >= 0) return String(value);
  return textValue(value, 'VERSION_INVALID');
}

async function transition(context, { cycle_id, expected_revision, status, checkpoint }) {
  textValue(cycle_id, 'CYCLE_ID_REQUIRED');
  requireValue(Number.isSafeInteger(expected_revision) && expected_revision >= 0, 'REVISION_INVALID');
  requireValue(STATUSES.has(status), 'STATUS_INVALID');
  const snapshot = checkpoint === null ? null : jsonObject(checkpoint);
  return withTransaction(context.pool, async client => {
    const at = timestamp(context.clock);
    const result = await client.query(`UPDATE research_state.t3_cycles
      SET status=$3,checkpoint=$4::jsonb,revision=revision+1,updated_at=$5
      WHERE cycle_id=$1 AND revision=$2 RETURNING ${CYCLE_COLUMNS}`,
    [cycle_id, expected_revision, status, snapshot === null ? null : JSON.stringify(snapshot), at]);
    if (!result.rows.length) {
      requireValue(await getCycle(client, cycle_id), 'CYCLE_NOT_FOUND');
      requireValue(false, 'REVISION_CONFLICT');
    }
    await insertEvent(client, { cycle_id, event_id: randomUUID(), type: 'CycleTransitioned',
      payload: { expected_revision, revision: expected_revision + 1, status, checkpoint: snapshot }, at });
    return cycleReceipt(result.rows[0]);
  });
}

function artifactTable(kind) {
  requireValue(Object.hasOwn(TABLES, kind), 'ARTIFACT_KIND_INVALID');
  return `research_state.${TABLES[kind]}`;
}

function artifactMetadata(kind, payload) {
  if (kind === 'hypothesis') requireValue(payload.status === undefined || payload.status === 'NEW', 'HYPOTHESIS_STATUS_INVALID');
  return [kind === 'hypothesis' ? 'NEW' : textValue(payload.status ?? 'RECORDED', 'ARTIFACT_STATUS_INVALID'),
    versionValue(payload.version ?? '1'), versionValue(payload.schema_version ?? '1'),
    optionalVersion(payload.model_version), optionalVersion(payload.prompt_version)];
}

async function putArtifact(context, { cycle_id, kind, id, payload, payload_hash }) {
  const table = artifactTable(kind);
  textValue(cycle_id, 'CYCLE_ID_REQUIRED');
  textValue(id, 'ARTIFACT_ID_REQUIRED');
  textValue(payload_hash, 'PAYLOAD_HASH_REQUIRED');
  const snapshot = jsonObject(payload), metadata = artifactMetadata(kind, snapshot);
  const globalId = kind === 'hypothesis' || kind === 'experiment';
  return withTransaction(context.pool, async client => {
    requireValue(await getCycle(client, cycle_id), 'CYCLE_NOT_FOUND');
    const at = timestamp(context.clock);
    const result = await client.query(`INSERT INTO ${table}
      (cycle_id,id,kind,payload,payload_hash,status,artifact_version,schema_version,model_version,prompt_version,created_at)
      VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (${globalId ? 'id' : 'cycle_id,id'}) DO NOTHING RETURNING ${ARTIFACT_COLUMNS}`,
    [cycle_id, id, kind, JSON.stringify(snapshot), payload_hash, ...metadata, at]);
    const prior = result.rows.length ? result : await client.query(`SELECT ${ARTIFACT_COLUMNS} FROM ${table}
      WHERE ${globalId ? 'id=$1' : 'cycle_id=$1 AND id=$2'}`, globalId ? [id] : [cycle_id, id]);
    const artifact = prior.rows[0];
    requireValue(artifact && artifact.payload_hash === payload_hash
      && canonicalJson(artifact.payload) === canonicalJson(snapshot), 'ARTIFACT_CONFLICT');
    if (result.rows.length) await insertEvent(client, { cycle_id, event_id: randomUUID(), type: 'ArtifactStored',
      payload: { kind, id, payload_hash }, at });
    return artifact;
  });
}

function readCursor(cursor, scope) {
  if (cursor === undefined || cursor === null) return null;
  try {
    textValue(cursor, 'CURSOR_INVALID');
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    requireValue(decoded.cycle_id === scope.cycle_id && decoded.kind === scope.kind, 'CURSOR_INVALID');
    return textValue(decoded.id, 'CURSOR_INVALID');
  } catch (cause) {
    throw Object.assign(new Error('CURSOR_INVALID', { cause }), { code: 'CURSOR_INVALID' });
  }
}

async function listArtifacts(pool, { cycle_id, kind, limit = 50, cursor }) {
  const table = artifactTable(kind);
  textValue(cycle_id, 'CYCLE_ID_REQUIRED');
  requireValue(Number.isInteger(limit) && limit > 0 && limit <= 500, 'LIMIT_INVALID');
  const after = readCursor(cursor, { cycle_id, kind });
  const result = await pool.query(`SELECT ${ARTIFACT_COLUMNS} FROM ${table}
    WHERE cycle_id=$1 AND ($2::text IS NULL OR id COLLATE "C" > $2::text COLLATE "C")
    ORDER BY id COLLATE "C" ASC LIMIT $3`, [cycle_id, after, limit + 1]);
  const items = result.rows.slice(0, limit);
  const next_cursor = result.rows.length > limit
    ? Buffer.from(JSON.stringify({ cycle_id, kind, id: items.at(-1).id })).toString('base64url') : null;
  return { items, next_cursor };
}

async function findArtifact(pool, { kind, id }) {
  const table = artifactTable(kind);
  textValue(id, 'ARTIFACT_ID_REQUIRED');
  const result = await pool.query(`SELECT ${ARTIFACT_COLUMNS} FROM ${table}
    WHERE id=$1 ORDER BY created_at,cycle_id COLLATE "C" LIMIT 1`, [id]);
  return result.rows[0] || null;
}

async function listEvents(pool, cycleId) {
  textValue(cycleId, 'CYCLE_ID_REQUIRED');
  const result = await pool.query(`SELECT ${EVENT_COLUMNS} FROM research_state.t3_events
    WHERE cycle_id=$1 ORDER BY created_at,event_id COLLATE "C"`, [cycleId]);
  return result.rows.map(row => ({ ...row, created_at: new Date(row.created_at).toISOString() }));
}

async function executeExclusive(pool, cycleId, operation) {
  textValue(cycleId, 'CYCLE_ID_REQUIRED');
  requireValue(typeof operation === 'function', 'OPERATION_REQUIRED');
  const client = await pool.connect();
  let acquired = false, failure, connectionError;
  try {
    let result;
    try {
      result = await client.query("SELECT pg_try_advisory_lock(hashtext('T3:' || $1)) AS locked", [cycleId]);
    } catch (error) { connectionError = error; throw error; }
    acquired = result.rows[0]?.locked === true;
    requireValue(acquired, 'CYCLE_BUSY');
    return await operation();
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      if (acquired) {
        const result = await client.query("SELECT pg_advisory_unlock(hashtext('T3:' || $1)) AS unlocked", [cycleId]);
        requireValue(result.rows[0]?.unlocked === true, 'CYCLE_UNLOCK_FAILED');
      }
    } catch (error) {
      connectionError = error;
      if (failure) failure.unlockError = error;
      else throw error;
    } finally {
      // Destroy an uncertain session instead of returning a possibly held lock to the pool.
      client.release(connectionError);
    }
  }
}

async function insertEvent(client, { cycle_id, event_id, type, payload, at }) {
  const payloadHash = contentHash(payload);
  const result = await client.query(`INSERT INTO research_state.t3_events
    (event_id,cycle_id,namespace,type,payload,payload_hash,correlation_id,created_at)
    VALUES ($1,$2,'T3_RESEARCH',$3,$4::jsonb,$5,$2,$6)
    ON CONFLICT (event_id) DO NOTHING RETURNING ${EVENT_COLUMNS}`,
  [event_id, cycle_id, type, JSON.stringify(payload), payloadHash, at]);
  const prior = result.rows.length ? result : await client.query(`SELECT ${EVENT_COLUMNS}
    FROM research_state.t3_events WHERE event_id=$1`, [event_id]);
  const event = prior.rows[0];
  requireValue(event && event.cycle_id === cycle_id && event.type === type
    && event.payload_hash === payloadHash, 'EVENT_CONFLICT');
  return { ...event, created_at: new Date(event.created_at).toISOString() };
}

async function addEvent(context, { cycle_id, event_id, type, payload }) {
  textValue(cycle_id, 'CYCLE_ID_REQUIRED');
  textValue(event_id, 'EVENT_ID_REQUIRED');
  textValue(type, 'EVENT_TYPE_REQUIRED');
  const snapshot = jsonObject(payload);
  return withTransaction(context.pool, async client => {
    requireValue(await getCycle(client, cycle_id), 'CYCLE_NOT_FOUND');
    return insertEvent(client, { cycle_id, event_id, type, payload: snapshot, at: timestamp(context.clock) });
  });
}
