import { readFile } from "node:fs/promises";
import pg from "pg";
import { assemble, runOosBatch } from "../src/oos-runtime.js";

const [command, requestFile, commandId] = process.argv.slice(2);
if (!["run", "queue", "work"].includes(command) || (command !== "work" && !requestFile)
  || !process.env.OOS_BATCH_CONFIG || !process.env.OOS_DATABASE_URL) {
  console.error("Usage: configure OOS_BATCH_CONFIG and OOS_DATABASE_URL; run request.json | queue request.json command-id | work [--once]");
  process.exitCode = 2;
} else {
  const pool = new pg.Pool({ connectionString: process.env.OOS_DATABASE_URL, max: 8, connectionTimeoutMillis: 10000 });
  let runtime;
  try {
    runtime = await assemble(pool);
    if (command === "work") await work(runtime, requestFile === "--once");
    else if (command === "queue") console.log(JSON.stringify(await runtime.commands.enqueue(JSON.parse(await readFile(requestFile, "utf8")), commandId)));
    else {
      const rows = await runOosBatch(runtime, JSON.parse(await readFile(requestFile, "utf8")));
      console.log(JSON.stringify(rows.map(row => ({ date: row.definition.date, state: row.state, error: row.error })), null, 2));
      if (rows.some(row => row.state.startsWith("FAILED"))) process.exitCode = 1;
    }
  } catch (error) { console.error(JSON.stringify({ code: error.code || "OOS_START_FAILED" })); process.exitCode = 1; }
  finally { await runtime?.close(); await pool.end(); }
}

async function work(runtime, once) {
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    do {
      const receipt = await runtime.commands.processOne(runtime.workflow);
      if (receipt) console.log(JSON.stringify(receipt));
      if (!once && !stopping) await new Promise(resolve => setTimeout(resolve, 2000));
    } while (!once && !stopping);
  } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
}
