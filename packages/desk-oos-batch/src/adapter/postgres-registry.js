import { requireFact } from "../domain/batch-contract.js";

const COLUMNS = "batch_id,day,definition,state,checkpoint,revision,candidate_attempt,capture_count,manifest_sha256,plan_sha256,audit,run_meta,error,updated_at";
function decode(row) {
  return { ...row, day: String(row.day).slice(0, 10), definition: row.definition,
    revision: Number(row.revision), updated_at: new Date(row.updated_at).toISOString() };
}

export class PostgresOosRegistry {
  constructor(pool) { this.pool = pool; }

  async withLock(key, operation) {
    const client = await this.pool.connect();
    let locked = false;
    try {
      const result = await client.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked", [key]);
      locked = result.rows[0].locked;
      requireFact(locked, "OOS_BUSY");
      return await operation();
    } finally {
      try { if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [key]); }
      finally { client.release(); }
    }
  }

  withDayLock(day, operation) { return this.withLock(`oos:day:${day.batch_id}:${day.date}`, operation); }
  withChartLock(operation) { return this.withLock("oos:tradingview:exclusive", operation); }

  async ensureDay(day) {
    await this.pool.query(`INSERT INTO oos_batch_days (batch_id,day,definition) VALUES ($1,$2,$3::jsonb)
      ON CONFLICT (batch_id,day) DO NOTHING`, [day.batch_id, day.date, JSON.stringify(day)]);
    const row = await this.get(day);
    requireFact(Object.keys(day).every(key => row.definition[key] === day[key]), "BATCH_DEFINITION_CONFLICT");
    return row;
  }

  async get(day) {
    const result = await this.pool.query(`SELECT ${COLUMNS} FROM oos_batch_days WHERE batch_id=$1 AND day=$2`, [day.batch_id, day.date]);
    requireFact(result.rows.length === 1, "OOS_DAY_NOT_FOUND");
    return decode(result.rows[0]);
  }

  async list(batchId) {
    const result = await this.pool.query(`SELECT ${COLUMNS} FROM oos_batch_days
      WHERE ($1::text IS NULL OR batch_id=$1) ORDER BY batch_id DESC,day LIMIT 500`, [batchId || null]);
    return result.rows.map(decode);
  }

  async timeline(day) {
    const result = await this.pool.query(`SELECT revision,state,checkpoint,occurred_at,error FROM oos_batch_events
      WHERE batch_id=$1 AND day=$2 ORDER BY revision`, [day.batch_id, day.date]);
    return result.rows;
  }

  async save(previous, change, at) {
    const next = { ...previous, ...change };
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`UPDATE oos_batch_days SET state=$1,checkpoint=$2,revision=revision+1,
        candidate_attempt=$3,capture_count=$4,manifest_sha256=$5,plan_sha256=$6,audit=$7::jsonb,run_meta=$8::jsonb,
        error=$9::jsonb,updated_at=$10 WHERE batch_id=$11 AND day=$12 AND revision=$13 RETURNING ${COLUMNS}`,
      [next.state, next.checkpoint, next.candidate_attempt, next.capture_count, next.manifest_sha256, next.plan_sha256,
        JSON.stringify(next.audit), JSON.stringify(next.run_meta), JSON.stringify(next.error), at,
        previous.batch_id, previous.day, previous.revision]);
      requireFact(result.rowCount === 1, "OOS_VERSION_CONFLICT");
      const saved = decode(result.rows[0]);
      await client.query(`INSERT INTO oos_batch_events (batch_id,day,revision,state,checkpoint,occurred_at,error)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`, [saved.batch_id, saved.day, saved.revision,
        saved.state, saved.checkpoint, at, JSON.stringify(saved.error)]);
      await client.query("COMMIT");
      return saved;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  /** Operator-only repair after an external, durable quarantine of a never-frozen capture. */
  async retireUnfrozenCapture(day, expectedHash) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`SELECT ${COLUMNS} FROM oos_batch_days
        WHERE batch_id=$1 AND day=$2 FOR UPDATE`, [day.batch_id, day.date]);
      const row = result.rows[0];
      requireFact(row && row.plan_sha256 === null && row.manifest_sha256 === expectedHash
        && row.state === "FAILED_TECHNICAL" && row.error?.code === "CAPTURE_PARTIAL_BAR_UNPROVEN", "CAPTURE_RETIRE_FORBIDDEN");
      await client.query("DELETE FROM oos_batch_events WHERE batch_id=$1 AND day=$2", [day.batch_id, day.date]);
      await client.query("DELETE FROM oos_batch_days WHERE batch_id=$1 AND day=$2", [day.batch_id, day.date]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}
