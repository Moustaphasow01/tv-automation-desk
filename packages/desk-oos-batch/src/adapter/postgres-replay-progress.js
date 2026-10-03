import { requireFact } from "../domain/batch-contract.js";

const COLUMNS = "plan_sha256,replay_current_time,replay_target_time,last_confirmed_bar_time,steps_completed,last_success_at,retry_count,last_error,browser_session_id,tv_replay_state,config_hash";
const METADATA = ["immutable_scope_hash", "replay_scope_hash", "ephemeral_scope", "last_confirmed_bar_open",
  "last_confirmed_bar_close", "expected_next_bar_open", "observed_bar_open", "overshoot_count", "resume_count"];
export class PostgresReplayProgress {
  constructor(pool) { this.pool = pool; }
  async read(day, hash) {
    const result = await this.pool.query(`SELECT ${COLUMNS} FROM oos_replay_progress WHERE batch_id=$1 AND day=$2`, [day.batch_id, day.date]);
    const row = result.rows[0];
    if (!row) return null;
    requireFact(row.plan_sha256 === hash, "REPLAY_PROGRESS_HASH_MISMATCH");
    for (const key of ["replay_current_time", "replay_target_time", "last_confirmed_bar_time", "last_success_at"]) {
      row[key] = new Date(row[key]).toISOString();
    }
    for (const key of METADATA) if (Object.hasOwn(row.tv_replay_state || {}, key)) row[key] = row.tv_replay_state[key];
    return row;
  }
  async save(day, hash, value) {
    const metadata = { ...value.tv_replay_state };
    for (const key of METADATA) if (Object.hasOwn(value, key)) metadata[key] = value[key];
    const args = [day.batch_id, day.date, hash, value.replay_current_time, value.replay_target_time,
      value.last_confirmed_bar_time, value.steps_completed, value.last_success_at, value.retry_count,
      JSON.stringify(value.last_error), value.browser_session_id, JSON.stringify(metadata), value.config_hash];
    const result = await this.pool.query(`INSERT INTO oos_replay_progress (batch_id,day,${COLUMNS})
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13
      WHERE EXISTS (SELECT 1 FROM oos_batch_days WHERE batch_id=$1 AND day=$2 AND plan_sha256=$3)
      ON CONFLICT (batch_id,day) DO UPDATE SET replay_current_time=EXCLUDED.replay_current_time,
      replay_target_time=EXCLUDED.replay_target_time,last_confirmed_bar_time=EXCLUDED.last_confirmed_bar_time,
      steps_completed=EXCLUDED.steps_completed,last_success_at=EXCLUDED.last_success_at,retry_count=EXCLUDED.retry_count,
      last_error=EXCLUDED.last_error,browser_session_id=EXCLUDED.browser_session_id,
      tv_replay_state=EXCLUDED.tv_replay_state,config_hash=EXCLUDED.config_hash,updated_at=clock_timestamp()
      WHERE oos_replay_progress.plan_sha256=EXCLUDED.plan_sha256
        AND oos_replay_progress.last_confirmed_bar_time<=EXCLUDED.last_confirmed_bar_time
        AND oos_replay_progress.steps_completed<=EXCLUDED.steps_completed
        AND oos_replay_progress.retry_count<=EXCLUDED.retry_count`, args);
    requireFact(result.rowCount === 1, "REPLAY_PROGRESS_CONFLICT");
  }
}
