import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Explicit real acceptance targets only. Never creates a scenario, plan or replay.
const config = JSON.parse(await readFile(process.env.OOS_BATCH_CONFIG, "utf8"));
const mode = process.argv[2]; assert.ok(["single", "range", "status"].includes(mode));
const client = new Client({ name: "OOS preparation acceptance (not Scenario Builder)", version: "1" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${config.public_url}/mcp`), {
  requestInit: { headers: { authorization: `Bearer ${process.env.OOS_OPERATOR_TOKEN}` } } }));
try {
  const tools = (await client.listTools()).tools;
  for (const name of ["prepare_premarket", "prepare_range", "get_batch_status"]) assert.ok(tools.some(t => t.name === name));
  if (mode === "status") console.log(JSON.stringify(await call("get_batch_status", { start_date: "2026-07-27", end_date: "2026-07-29" })));
  if (mode === "single") await single();
  if (mode === "range") await range();
} finally { await client.close(); }

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, `${name}: ${result.content[0]?.text}`);
  return result.structuredContent;
}

async function waitReady(filters) {
  let last;
  for (let attempt = 0; attempt < 180; attempt++) {
    const result = await call("get_batch_status", filters);
    const progress = JSON.stringify({ ready: result.ready, failed: result.failed, queued: result.queued,
      days: result.days.map(d => ({ date: d.date, state: d.state, captures: d.capture_count, error: d.error })) });
    if (progress !== last) { console.log(progress); last = progress; }
    if (result.failed) throw new Error("PREMARKET_TECHNICAL_FAILURE");
    if (result.ready === result.total_days && result.total_days > 0 &&
        (!filters.batch_id || result.status === "COMPLETED")) return result;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error("PREMARKET_ACCEPTANCE_TIMEOUT");
}

async function checkBundle(date) {
  const result = await client.callTool({ name: "get_premarket_bundle", arguments: { date } });
  assert.ok(!result.isError);
  const { manifest, manifest_sha256 } = result.structuredContent;
  assert.equal(manifest.date, date); assert.equal(manifest.captures.length, 8);
  assert.equal(result.content.filter(c => c.type === "image").length, 8);
  for (let i = 0; i < result.content.length; i++) {
    const item = result.content[i]; if (item.type !== "image") continue;
    const proof = JSON.parse(result.content[i - 1].text);
    assert.equal(createHash("sha256").update(Buffer.from(item.data, "base64")).digest("hex"), proof.sha256);
  }
  for (const capture of manifest.captures) {
    assert.equal(capture.bar_policy, "CLOSED_ONLY");
    assert.ok(Date.parse(capture.last_bar_close) <= Date.parse(manifest.cutoff));
    assert.ok(Date.parse(capture.visible_as_of) <= Date.parse(manifest.cutoff));
  }
  const root = path.join(config.archive_root, config.batch_id, date.slice(0, 7), date);
  for (const folder of ["plan", "replay"]) {
    const exists = await stat(path.join(root, folder)).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });
    assert.equal(exists, false, `${folder} must not exist during premarket-only acceptance`);
  }
  return manifest_sha256;
}

async function single() {
  console.log(JSON.stringify(await call("prepare_premarket", { date: "2026-07-29" })));
  const ready = await waitReady({ start_date: "2026-07-29", end_date: "2026-07-29" });
  const hash = await checkBundle("2026-07-29"), prior = ready.days[0];
  const repeat = await call("prepare_premarket", { date: "2026-07-29" });
  assert.equal(repeat.manifest_sha256, hash); assert.equal(repeat.capture_count, 8);
  assert.equal(repeat.updated_at, prior.updated_at); assert.equal(repeat.plan_sha256, null);
  assert.equal(await checkBundle("2026-07-29"), hash);
  console.log(JSON.stringify({ date: "2026-07-29", state: repeat.state, captures: "8/8", manifest_sha256: hash,
    idempotency: "PASS", plan: "ABSENT", replay: "ABSENT" }));
}

async function range() {
  const before = await call("get_batch_status", { start_date: "2026-07-29", end_date: "2026-07-29" });
  const hash29 = before.days[0].manifest_sha256;
  const queued = await call("prepare_range", { start_date: "2026-07-27", end_date: "2026-07-29" });
  console.log(JSON.stringify({ batch_id: queued.batch_id, status: queued.status, ready: queued.ready, queued: queued.queued }));
  await waitReady({ batch_id: queued.batch_id });
  const final = await call("get_batch_status", { batch_id: queued.batch_id });
  assert.equal(final.total_days, 3); assert.equal(final.ready, 3); assert.equal(final.failed, 0); assert.equal(final.status, "COMPLETED");
  assert.equal(final.concurrency, 1);
  for (const day of final.days) {
    assert.equal(day.state, "PREMARKET_READY"); assert.equal(day.plan_sha256, null); assert.equal(day.replay_status, "NOT_REQUESTED");
    const hash = await checkBundle(day.date); if (day.date === "2026-07-29") assert.equal(hash, hash29);
  }
  assert.equal((await call("prepare_range", { start_date: "2026-07-27", end_date: "2026-07-29" })).batch_id, queued.batch_id);
  console.log(JSON.stringify({ batch_id: final.batch_id, status: final.status, ready: final.ready, failed: final.failed,
    dates: final.days.map(d => ({ date: d.date, manifest_sha256: d.manifest_sha256 })), replay: "ABSENT" }));
}
