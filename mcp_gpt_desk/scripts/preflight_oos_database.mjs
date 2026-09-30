import { readFile } from "node:fs/promises";
import pg from "pg";

// Read-only diagnostic: prints role capabilities, never URLs or credentials.
for (const filename of ["maintenance.env", "desk.env"]) {
  const text = await readFile(`C:/ProgramData/DeskFutures/config/${filename}`, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!/^[A-Z_]*(?:DATABASE|DB_)[A-Z_]*URL=/.test(line)) continue;
    const i = line.indexOf("="), key = line.slice(0, i), url = line.slice(i + 1).replace(/^"(.*)"$/, "$1");
    const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 5000, max: 1 });
    try {
      const result = await pool.query("SELECT current_user,rolsuper,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user");
      console.log(JSON.stringify({ source: filename, key, ...result.rows[0] }));
    } catch (error) { console.log(JSON.stringify({ source: filename, key, error: error.code || "CONNECTION_FAILED" })); }
    finally { await pool.end(); }
  }
}
