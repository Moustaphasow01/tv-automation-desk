import { requireFact } from "../domain/batch-contract.js";
import { hasPremarket, preparationStatus } from "../domain/premarket-batch.js";
import { jsonBytes, sha256 } from "./artifact-archive.js";
import { PREPARATION_COLUMNS as TECHNICAL } from "./postgres-registry.js";

const BATCH = "batch_id,archive_batch_id,batch_type,selector_kind,start_date,end_date,status,command_id,concurrency,requested_concurrency,last_error,created_at,updated_at";

/** Shares the existing durable command runner; never reads audit, results, plans or archive files. */
export class PostgresPremarketBatches {
  constructor(repository) { this.repository = repository; this.pool = repository.pool; }

  async transaction(key, operation) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='15s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async day(day, client = this.pool) {
    return this.repository.getPreparation(day, client);
  }

  async ensureDay(day, client) {
    await client.query(`INSERT INTO oos_batch_days(batch_id,day,definition) VALUES ($1,$2,$3::jsonb)
      ON CONFLICT (batch_id,day) DO NOTHING`, [day.batch_id, day.date, JSON.stringify(day)]);
    const row = await this.day(day, client);
    requireFact(Object.keys(day).every(key => row.definition[key] === day[key]), "BATCH_DEFINITION_CONFLICT");
    if (row.state === "NEW") {
      const staged = await client.query(`UPDATE oos_batch_days SET state='CAPTURING',checkpoint='CAPTURING',revision=revision+1,
        updated_at=clock_timestamp() WHERE batch_id=$1 AND day=$2 AND state='NEW' RETURNING revision,updated_at`, [day.batch_id, day.date]);
      if (staged.rowCount) await client.query(`INSERT INTO oos_batch_events(batch_id,day,revision,state,checkpoint,occurred_at,error)
        VALUES ($1,$2,$3,'CAPTURING','CAPTURING',$4,NULL)`, [day.batch_id, day.date, staged.rows[0].revision, staged.rows[0].updated_at]);
    }
    return this.day(day, client);
  }

  async enqueue({ batch, days }) {
    return this.transaction(`oos:prepare:${batch.batch_id}`, async client => {
      const prior = (await client.query(`SELECT ${BATCH} FROM oos_premarket_batches WHERE batch_id=$1`, [batch.batch_id])).rows[0];
      const rows = [];
      for (const day of days) rows.push(await this.ensureDay(day, client));
      const active = prior && (await client.query("SELECT status FROM oos_batch_commands WHERE command_id=$1", [prior.command_id])).rows[0];
      if (prior && (active.status !== "COMPLETED" || rows.every(hasPremarket))) return prior;
      const commandId = prior ? `${batch.batch_id}-r-${sha256(jsonBytes(rows.map(row => [row.day, row.revision]))).slice(0, 12)}` : batch.batch_id;
      const payload = { days, action: "capture", premarket_only: true };
      await client.query(`INSERT INTO oos_batch_commands(command_id,request_hash,payload) VALUES ($1,$2,$3::jsonb)
        ON CONFLICT (command_id) DO NOTHING`, [commandId, sha256(jsonBytes(payload)), JSON.stringify(payload)]);
      await this.storeBatch(client, { ...batch, command_id: commandId });
      for (const day of days) await client.query(`INSERT INTO oos_premarket_batch_days(batch_id,archive_batch_id,day)
        VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [batch.batch_id, day.batch_id, day.date]);
      return (await client.query(`SELECT ${BATCH} FROM oos_premarket_batches WHERE batch_id=$1`, [batch.batch_id])).rows[0];
    });
  }

  async storeBatch(client, batch) {
    await client.query(`INSERT INTO oos_premarket_batches(batch_id,archive_batch_id,batch_type,selector_kind,start_date,end_date,
      status,command_id,concurrency,requested_concurrency) VALUES ($1,$2,'PREMARKET',$3,$4,$5,'RUNNING',$6,$7,$8)
      ON CONFLICT (batch_id) DO UPDATE SET command_id=EXCLUDED.command_id,status='RUNNING',updated_at=clock_timestamp()`,
    [batch.batch_id, batch.archive_batch_id, batch.selector_kind, batch.start_date, batch.end_date,
      batch.command_id, batch.concurrency, batch.requested_concurrency]);
  }

  async refresh() {
    const batches = (await this.pool.query(`SELECT ${BATCH} FROM oos_premarket_batches WHERE status='RUNNING'`)).rows;
    for (const batch of batches) {
      const rows = await this.members(batch.batch_id);
      const command = (await this.pool.query("SELECT status FROM oos_batch_commands WHERE command_id=$1", [batch.command_id])).rows[0];
      const status = preparationStatus({ rows, commandStatus: command.status });
      const error = rows.find(row => !hasPremarket(row) && row.error)?.error ?? null;
      await this.pool.query(`UPDATE oos_premarket_batches SET status=$2,last_error=$3::jsonb,updated_at=clock_timestamp()
        WHERE batch_id=$1 AND command_id=$4 AND (status<>$2 OR last_error IS DISTINCT FROM $3::jsonb)`,
      [batch.batch_id, status, JSON.stringify(error ? { code: error.code } : null), batch.command_id]);
    }
  }

  async members(batchId) {
    const result = await this.pool.query(`SELECT ${TECHNICAL.split(",").map(c => `d.${c}`).join(",")}
      FROM oos_batch_days d JOIN oos_premarket_batch_days m ON m.archive_batch_id=d.batch_id AND m.day=d.day
      WHERE m.batch_id=$1 ORDER BY d.day`, [batchId]);
    return result.rows;
  }

  async read({ archiveBatchId, batchId, startDate, endDate }) {
    const batches = (await this.pool.query(`SELECT ${BATCH} FROM oos_premarket_batches WHERE archive_batch_id=$1
      AND ($2::text IS NULL OR batch_id=$2) AND start_date<=$4 AND end_date>=$3 ORDER BY created_at,batch_id`,
    [archiveBatchId, batchId ?? null, startDate, endDate])).rows;
    if (batchId) requireFact(batches.length === 1, "PREMARKET_BATCH_NOT_FOUND");
    const rows = batchId ? await this.members(batchId) : (await this.pool.query(`SELECT ${TECHNICAL} FROM oos_batch_days
      WHERE batch_id=$1 AND day BETWEEN $2 AND $3 ORDER BY day`, [archiveBatchId, startDate, endDate])).rows;
    return { batches, rows, queue: await this.queue(archiveBatchId) };
  }

  async queue(archiveBatchId) {
    const commands = (await this.pool.query(`SELECT command_id,status,payload,next_day FROM oos_batch_commands
      WHERE status IN ('QUEUED','RUNNING') ORDER BY created_at,command_id`)).rows;
    const capture = new Set(), replay = new Set();
    for (const command of commands) for (const day of command.payload.days.slice(command.next_day)) {
      if (day.batch_id !== archiveBatchId) continue;
      if (["capture", "retry-capture"].includes(command.payload.action)) capture.add(day.date);
      if (["replay", "retry"].includes(command.payload.action)) replay.add(day.date);
    }
    return { capture, replay };
  }
}
