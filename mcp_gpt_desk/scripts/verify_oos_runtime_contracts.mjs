import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { validateSmc3Syntax } from "@tv-automation/desk-oos-batch";

// Operator-only acceptance. SELECT and file reads only; no writes, probe, plan submission or replay.
const hash = value => createHash("sha256").update(value).digest("hex");
const config = JSON.parse(await readFile(process.env.OOS_BATCH_CONFIG, "utf8"));
const date = "2026-07-30", pool = new pg.Pool({ connectionString: process.env.OOS_DATABASE_URL });
const dayRoot = path.join(config.archive_root, config.batch_id, "2026-07", date);
const names = ["get_engine_constraints", "get_smc3_contract", "get_runtime_contract"];

async function artifacts(dir, prefix = "") {
  const rows = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = `${prefix}${entry.name}`, file = path.join(dir, entry.name);
    if (entry.isDirectory()) rows.push(...await artifacts(file, `${relative}/`));
    else { assert.equal(entry.isFile(), true); rows.push({ path: relative, sha256: hash(await readFile(file)) }); }
  }
  return rows;
}

async function snapshot() {
  const counts = {};
  for (const table of ["oos_batch_days", "oos_batch_events", "oos_batch_commands", "oos_premarket_batches", "oos_premarket_batch_days"]) {
    // Table identifiers are exclusively the constant allowlist above.
    const rows = (await pool.query(`SELECT to_jsonb(t) AS value FROM ${table} t`)).rows.map(row => row.value);
    rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    counts[table] = { rows: rows.length, sha256: hash(JSON.stringify(rows)) };
  }
  const commands = await pool.query("SELECT count(*)::int AS count FROM oos_batch_commands WHERE status IN ('QUEUED','RUNNING')");
  assert.equal(commands.rows[0].count, 0, "OOS_PENDING_COMMANDS_PREVENT_READ_ONLY_ACCEPTANCE");
  return { database: counts, frozen_artifacts: await artifacts(dayRoot) };
}

async function checkFrozenPlan(engine) {
  const text = await readFile(path.join(dayRoot, "plan/PLAN_SMC3.txt"), "utf8");
  const meta = JSON.parse(await readFile(path.join(dayRoot, "plan/plan_meta.json"), "utf8"));
  const run = JSON.parse(await readFile(path.join(dayRoot, "replay/run_meta.json"), "utf8"));
  assert.equal(meta.status, "FROZEN"); assert.equal(hash(text), meta.plan_sha256);
  const receipt = validateSmc3Syntax({ date, symbol: "CME_MINI:MES1!", engine_version: engine.engine_version,
    schema: "SMC3", plan_text: text, plan_sha256: meta.plan_sha256 });
  assert.equal(receipt.syntax_valid, true); assert.equal(run.config_hash, engine.provenance.config_sha256);
  assert.equal(run.engine_version, engine.engine_version); assert.equal(run.book_mode, engine.book_mode);
  return { syntax: "PASS", frozen_plan_sha256: meta.plan_sha256, executed_config_match: "PASS" };
}

async function publicContracts() {
  const client = new Client({ name: "Read-only OOS contract acceptance", version: "1" });
  const headers = { authorization: `Bearer ${process.env.OOS_OPERATOR_TOKEN}` };
  await client.connect(new StreamableHTTPClientTransport(new URL(`${config.public_url}/mcp`), { requestInit: { headers } }));
  try {
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 16);
    for (const name of names) {
      const tool = tools.find(item => item.name === name); assert.ok(tool);
      assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool.annotations.destructiveHint, false);
      assert.deepEqual(tool._meta.securitySchemes, [{ type: "oauth2", scopes: ["desk.read"] }]);
    }
    const responses = [];
    for (const name of names) {
      const result = await client.callTool({ name, arguments: {} });
      assert.notEqual(result.isError, true, JSON.stringify(result.content)); responses.push(result.structuredContent);
    }
    const [engine, smc3, combined] = responses;
    assert.deepEqual(combined.engine_constraints, engine); assert.deepEqual(combined.smc3_contract, smc3);
    for (const [document, key] of [[engine, "engine_constraints_sha256"], [smc3, "contract_sha256"]]) {
      const { [key]: expected, ...original } = document;
      assert.equal(hash(`${JSON.stringify(original, null, 2)}\n`), expected);
    }
    for (const example of smc3.valid_examples) assert.equal(validateSmc3Syntax({ ...example,
      engine_version: engine.engine_version, schema: smc3.schema, plan_sha256: hash(example.plan_text) }).syntax_valid, true);
    const rejected = await client.callTool({ name: names[0], arguments: { date, replay: true } });
    assert.equal(rejected.isError, true);
    return { tools: tools.map(tool => tool.name), engine, smc3 };
  } finally { await client.close(); }
}

try {
  const before = await snapshot();
  if (process.argv[2] === "preflight") console.log(JSON.stringify(before));
  else {
    if (process.argv[2]) assert.deepEqual(before, JSON.parse(await readFile(process.argv[2], "utf8")), "DEPLOYMENT_CHANGED_FROZEN_STATE");
    const health = await fetch(`${config.public_url}/health`); assert.equal(health.status, 200);
    const { tools, engine, smc3 } = await publicContracts();
    const plan = await checkFrozenPlan(engine), after = await snapshot();
    assert.deepEqual(after, before, "READ_ONLY_CONTRACT_CALLS_CHANGED_OOS_STATE");
    console.log(JSON.stringify({ health: "PASS", public_tools_count: tools.length, public_tools: tools,
      engine_version: engine.engine_version, schema: smc3.schema, book_mode: engine.book_mode,
      engine_constraints_sha256: engine.engine_constraints_sha256, smc3_contract_sha256: smc3.contract_sha256,
      engine_constraints_runtime_match: "PASS", smc3_examples_validator: "PASS", examples: smc3.valid_examples.length,
      read_only: "PASS", anti_hindsight: "PASS", compatibility_30jul: plan, replay_triggered: false }));
  }
} finally { await pool.end(); }
