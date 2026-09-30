import { readFile } from "node:fs/promises";
import pg from "pg";
import { assemble } from "../src/oos-runtime.js";
import { createOosHttpServer } from "../src/oos-http-server.js";

const config = JSON.parse(await readFile(process.env.OOS_BATCH_CONFIG, "utf8"));
if (!/^https:\/\//.test(config.public_url || "") || !process.env.DESK_OAUTH_TOKEN_SECRET
  || !process.env.DESK_OAUTH_ADMIN_PIN || !process.env.OOS_DATABASE_URL) throw new Error("OOS_HOST_CONFIGURATION_REQUIRED");
const pool = new pg.Pool({ connectionString: process.env.OOS_DATABASE_URL, max: 12, connectionTimeoutMillis: 10000 });
const runtime = await assemble(pool);
const server = createOosHttpServer({ runtime, pool, config });
await pool.query("SELECT 1 FROM oos_batch_days LIMIT 1");
server.listen(config.port || 8795, "127.0.0.1", () => console.log(JSON.stringify({ event: "oos.ready", service: "Desk OOS", port: config.port || 8795 })));
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { stopping = true; server.close(); });
try {
  while (!stopping) {
    try {
      const receipt = await runtime.commands.processOne({ execute: async (day, action) => {
        if (config.replay_enabled !== true && !["capture", "retry-capture"].includes(action)) throw Object.assign(new Error("OOS_CAPTURE_ONLY"), { code: "OOS_CAPTURE_ONLY" });
        return runtime.workflow.execute(day, action);
      } });
      if (receipt) console.log(JSON.stringify({ event: "oos.command", ...receipt }));
    } catch (error) { console.error(JSON.stringify({ event: "oos.worker_error", code: error.code || "OOS_WORKER_FAILED" })); }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 2000));
  }
} finally { await runtime.close(); await pool.end(); }
