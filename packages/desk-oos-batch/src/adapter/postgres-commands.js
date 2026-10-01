import { batchDays, requireFact } from "../domain/batch-contract.js";
import { sha256, jsonBytes } from "./artifact-archive.js";
import { hasPremarket } from "../domain/premarket-batch.js";

const COLUMNS = "command_id,request_hash,payload,status,next_day,receipts,created_at,updated_at";
export class PostgresOosCommands {
  constructor(repository) { this.repository = repository; this.pool = repository.pool; }

  async enqueue(input, commandId) {
    requireFact(/^[A-Za-z0-9_-]{1,100}$/.test(commandId || ""), "COMMAND_ID_REQUIRED");
    const action = input.action || "run", days = batchDays(input);
    requireFact(["capture", "retry-capture", "scenario", "replay", "run", "retry", "new-plan"].includes(action), "ACTION_INVALID");
    const payload = { days, action }, hash = sha256(jsonBytes(payload));
    return this.repository.withLock(`oos:command:${commandId}`, async () => {
      const prior = await this.pool.query(`SELECT ${COLUMNS} FROM oos_batch_commands WHERE command_id=$1`, [commandId]);
      if (prior.rowCount) {
        requireFact(prior.rows[0].request_hash === hash, "COMMAND_ID_CONFLICT");
        return this.receipt(prior.rows[0]);
      }
      const attempts = [];
      for (const day of days) {
        const row = await this.repository.ensureDay(day);
        if (action === "new-plan") requireFact(row.state === "FAILED_PLAN_VALIDATION", "PLAN_REPLACEMENT_FORBIDDEN");
        attempts.push(row.candidate_attempt);
      }
      const result = await this.pool.query(`INSERT INTO oos_batch_commands (command_id,request_hash,payload)
        VALUES ($1,$2,$3::jsonb) RETURNING ${COLUMNS}`, [commandId, hash, JSON.stringify({ ...payload, attempts })]);
      return this.receipt(result.rows[0]);
    });
  }

  receipt(row) {
    return { command_id: row.command_id, status: row.status, completed_days: row.next_day,
      total_days: row.payload.days.length, receipts: row.receipts };
  }

  async get(commandId) {
    const result = await this.pool.query(`SELECT ${COLUMNS} FROM oos_batch_commands WHERE command_id=$1`, [commandId]);
    requireFact(result.rowCount === 1, "COMMAND_NOT_FOUND");
    return this.receipt(result.rows[0]);
  }

  async processOne(workflow) {
    return this.repository.withLock("oos:command-worker", async () => {
      const result = await this.pool.query(`SELECT ${COLUMNS} FROM oos_batch_commands
        WHERE status IN ('QUEUED','RUNNING') ORDER BY updated_at,created_at,command_id LIMIT 1`);
      if (!result.rowCount) return null;
      const command = result.rows[0];
      await this.pool.query("UPDATE oos_batch_commands SET status='RUNNING',updated_at=clock_timestamp() WHERE command_id=$1", [command.command_id]);
      if (command.next_day < command.payload.days.length) {
        const index = command.next_day;
        const receipt = await this.executeDay(workflow, command, index);
        command.receipts.push(receipt);
        command.next_day = index + 1;
        await this.pool.query(`UPDATE oos_batch_commands SET next_day=$2,receipts=$3::jsonb,updated_at=clock_timestamp()
          WHERE command_id=$1`, [command.command_id, index + 1, JSON.stringify(command.receipts)]);
      }
      const status = command.next_day === command.payload.days.length ? "COMPLETED" : "RUNNING";
      await this.pool.query("UPDATE oos_batch_commands SET status=$2,updated_at=clock_timestamp() WHERE command_id=$1", [command.command_id, status]);
      return this.receipt({ ...command, status });
    });
  }

  async executeDay(workflow, command, index) {
    const day = command.payload.days[index];
    try {
      if (command.payload.premarket_only) return await this.executePremarketDay(workflow, day);
      let action = command.payload.action;
      if (action === "new-plan") {
        const row = await this.repository.get(day);
        // A resumed command may already have requested its one replacement. Never increment twice.
        if (row.candidate_attempt > command.payload.attempts[index]) {
          if (row.state.startsWith("FAILED")) return { date: day.date, state: row.state, error: row.error };
          action = "scenario";
        }
      }
      const row = await workflow.execute(day, action);
      return { date: day.date, state: row.state, error: row.error };
    } catch (error) { return { date: day.date, state: "COMMAND_FAILED", error: { code: error.code || "OOS_COMMAND_FAILED" } }; }
  }

  async executePremarketDay(workflow, day) {
    const prior = await this.repository.getPreparation(day);
    if (hasPremarket(prior)) return { date: day.date, state: prior.state, error: null };
    const action = prior?.state === "FAILED_TECHNICAL" ? "retry-capture" : "capture";
    const row = await workflow.execute(day, action);
    return { date: day.date, state: row.state, error: row.error };
  }
}
