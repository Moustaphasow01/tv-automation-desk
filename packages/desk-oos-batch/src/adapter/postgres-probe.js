import { requireFact } from "../domain/batch-contract.js";
import { sha256 } from "./artifact-archive.js";

/** No foreign key, event, command or dependency on any trading table. */
export class PostgresOosProbe {
  constructor(pool) { this.pool = pool; }
  async write(value) {
    requireFact(typeof value === "string" && value.length > 0 && value.length <= 500
      && value.isWellFormed(), "PROBE_VALUE_INVALID");
    const result = await this.pool.query(`INSERT INTO oos_batch_write_probe (value_hash,value)
      VALUES ($1,$2) ON CONFLICT (value_hash) DO UPDATE SET value=EXCLUDED.value
      RETURNING value,written_at,source`, [sha256(value), value]);
    return this.decode(result.rows[0]);
  }
  async read() {
    const result = await this.pool.query(`SELECT value,written_at,source FROM oos_batch_write_probe
      ORDER BY written_at DESC,value_hash LIMIT 1`);
    return result.rowCount ? this.decode(result.rows[0]) : { value: null, written_at: null, source: "mcp" };
  }
  decode(row) { return { ...row, written_at: new Date(row.written_at).toISOString() }; }
}
