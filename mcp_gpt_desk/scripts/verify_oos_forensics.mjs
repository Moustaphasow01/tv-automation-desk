import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOosForensics, PostgresOosRegistry } from "@tv-automation/desk-oos-batch";
import { createOosMcpServer } from "../src/oos-mcp-server.js";
import { FORENSIC_TOOL_INPUTS } from "../src/oos-forensic-tools.js";
import { forensicBusinessBaseline } from "./oos_forensic_baseline.mjs";

// Acceptance client uses only the 31 forensic tools. It cannot enqueue commands.
const config = JSON.parse(await readFile(process.env.OOS_BATCH_CONFIG, "utf8"));
const root = path.join(config.archive_root, "forensic-index-v2"), sha = bytes => createHash("sha256").update(bytes).digest("hex");
const pool = new pg.Pool({ connectionString: process.env.OOS_DATABASE_URL });
const client = new Client({ name: "Desk OOS forensic public acceptance", version: "2" });
const report = { dates: {}, tools: {}, t0_t4: {}, new_replays: 0, plan_writes: 0, recalculations: 0 };
const local = process.argv[2] === "local";
let server;
async function call(name, args = {}) {
  assert.ok(Object.hasOwn(FORENSIC_TOOL_INPUTS, name), "FORBIDDEN_NON_FORENSIC_TOOL");
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, `${name}: ${result.content?.[0]?.text}`);
  report.tools[name] = "PASS"; return result;
}
const metadata = result => result.structuredContent;
const pictureArgs = { x: 0, y: 0, width: 320, height: 200 };
try {
  if (local) {
    const forensic = createOosForensics({ repository: new PostgresOosRegistry(pool), root: config.archive_root, indexRoot: root });
    server = createOosMcpServer({ auth: { scopes: ["desk.read"] }, forensic });
    const [left, right] = InMemoryTransport.createLinkedPair(); await server.connect(left); await client.connect(right);
  } else await client.connect(new StreamableHTTPClientTransport(new URL(`${config.public_url}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${process.env.OOS_OPERATOR_TOKEN}` } } }));
  report.transport = local ? "LOCAL_MCP_WITH_REAL_ARCHIVE" : "PUBLIC_AUTHENTICATED_HTTPS";
  const tools = (await client.listTools()).tools; assert.equal(tools.length, 47);
  for (const name of Object.keys(FORENSIC_TOOL_INPUTS)) {
    const tool = tools.find(t => t.name === name); assert.ok(tool); assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.openWorldHint, false); assert.deepEqual(tool._meta.securitySchemes[0].scopes, ["desk.read"]);
  }
  report.public_tools = tools.map(t => t.name); report.capabilities = metadata(await call("get_forensic_capabilities"));
  assert.equal(metadata(await call("get_forensic_index", { month: "2026-07" })).items.length, 23);
  for (const date of ["2026-07-01", "2026-07-02", "2026-07-08", "2026-07-24", "2026-07-29", "2026-07-03", "2026-07-30", "2026-08-03"]) {
    const result = await verifyDay(date); report.dates[date] = result;
  }
  for (const args of [{ reason_code: "TARGET_BEFORE_ORDER" }, { has_rearm: true }, { filled: true }]) {
    const name = Object.hasOwn(args, "reason_code") ? "search_forensic_events" : "search_forensic_scenarios";
    const result = metadata(await call(name, { ...args, limit: 20 }));
    assert.ok(result.items.length, `${name} ${JSON.stringify(args)} empty`);
    for (const item of result.items) assert.ok(item.provenance_ref);
    report[JSON.stringify(args)] = { total: result.total, references: result.items.length };
  }
  const after = await forensicBusinessBaseline({ pool, config });
  const before = JSON.parse(await readFile(path.join(root, "acceptance-baseline.json"), "utf8"));
  assert.equal(after.business_sha256, before.business_sha256, "BUSINESS_MUTATED");
  assert.equal(after.archive_sha256, before.archive_sha256, "ARCHIVE_MUTATED");
  report.read_only = "PASS"; report.artifacts_unchanged = after.file_count;
  assert.equal(Object.keys(report.tools).length, 31);
  await writeFile(path.join(root, local ? "local-acceptance.json" : "public-acceptance.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await client.close(); await server?.close(); await pool.end(); }

async function verifyDay(date) {
  const frozen = metadata(await call("get_frozen_plan", { date })); assert.equal(sha(frozen.plan_text), frozen.plan_sha256);
  const scenarios = metadata(await call("list_forensic_scenarios", { date, limit: 200 })).items; assert.ok(scenarios.length);
  await call("get_plan_scenario", { date, scenario_id: scenarios[0].scenario_id });
  const events = metadata(await call("get_forensic_events", { date, limit: 200 }));
  const integrity = metadata(await call("verify_forensic_integrity", { date })); assert.equal(integrity.status, "PASS");
  const index = metadata(await call("get_forensic_index", { date })).items[0];
  const trades = metadata(await call("list_trades", { date })).items;
  await call("get_counterfactual_audit", { date }); await call("get_portfolio_timeline", { date });
  const window = { date, start_time: `${date}T07:00:00Z`, end_time: `${date}T18:00:00Z` };
  for (const timeframe of ["1m", "5m", "15m"]) assert.equal(metadata(await call("get_persisted_market_bars", { ...window, timeframe })).reason, "NOT_PERSISTED");
  await call("get_market_window", { ...window, timeframes: ["1m", "5m", "15m"] });
  assert.equal(metadata(await call("get_level_interactions", { ...window, levels: [{ id: "TEST", price: 7000 }] })).available, false);
  if (!index.scorable) {
    assert.equal(date, "2026-07-03"); assert.equal(events.reason, "NOT_PERSISTED");
    assert.equal(metadata(await call("get_audit_json", { date })).available, false);
    return { frozen: true, scorable: false, classification: "UNSCORABLE_MARKET_GAP", integrity: "PASS" };
  }
  assert.ok(events.items.length);
  const firstTrade = trades[0];
  const candidate = firstTrade ? { scenario_id: firstTrade.scenario_id, attempt: firstTrade.attempt,
    event_id: firstTrade.fill_event_id } : events.items.find(e => e.event === "CONFIRMED") ?? events.items.find(e => e.scenario_id !== "PLAN");
  const args = { date, scenario_id: candidate.scenario_id, attempt: candidate.attempt };
  await call("get_plan_scenario", { date, scenario_id: args.scenario_id });
  await call("list_scenario_attempts", { date, scenario_id: args.scenario_id });
  const packet = metadata(await call("get_scenario_forensic_packet", args));
  await call("get_condition_timeline", args); await call("get_ticket_snapshot", args); await call("get_refusal_detail", args);
  await call("get_rearm_history", { date, scenario_id: args.scenario_id });
  const episodeEvents = metadata(await call("get_forensic_events", { ...args, limit: 200 })).items;
  const exactEvent = episodeEvents.find(e => e.event === "CONFIRMED") ?? episodeEvents[0];
  await call("get_decision_snapshot", { ...args, event_id: exactEvent.event_id });
  await call("get_forensic_provenance", { ref: exactEvent.event_id });
  const grouped = scenarios.find(s => s.group);
  await call("get_group_history", { date, group_id: grouped ? grouped.group.group_id : "NOT_PERSISTED_GROUP" });
  await call("get_logs_slice", { date, scenario_id: args.scenario_id, attempt: args.attempt, limit: 10 });
  for (const view of ["AUDIT", "POSITIONS"]) assert.equal(metadata(await call("get_structured_panel", { date, view })).native_table, true);
  const audit = metadata(await call("get_audit_json", { date })); assert.equal(sha(audit.text), audit.source_sha256);
  assert.equal(audit.document.recalculated, false); assert.equal(audit.document.source, "ENGINE_PUBLISHED_ONLY");
  const meta = metadata(await call("get_run_meta_json", { date })); assert.equal(sha(meta.text), meta.source_sha256);
  for (const artifact of ["5m_final", "15m_final", "dashboard_final", "positions_final"]) {
    const result = await call("get_replay_artifact", { date, artifact });
    const pixels = result.content.find(c => c.type === "image"); assert.ok(pixels);
    assert.equal(sha(Buffer.from(pixels.data, "base64")), metadata(result).source_sha256);
  }
  const cropped = await call("get_artifact_crop", { date, artifact: "5m_final", ...pictureArgs });
  assert.ok(cropped.content.some(c => c.type === "image"));
  for (const trade of trades) {
    const forensic = metadata(await call("get_trade_forensics", { date, trade_id: trade.trade_id }));
    assert.equal(forensic.source, "ENGINE_PUBLISHED_ONLY"); assert.equal(forensic.recalculated, false);
    assert.equal(typeof forensic.real_R, "number"); assert.equal(typeof forensic.real_USD, "number");
    assert.equal(typeof forensic.mfe_rp, "number"); assert.equal(typeof forensic.mae_rp, "number");
    assert.equal(typeof forensic.cf_BE_1, "number"); assert.equal(typeof forensic.cf_P1_at_1R, "number");
  }
  if (["2026-07-01", "2026-07-02", "2026-07-29"].includes(date)) await t0t4({ date, packet, audit: audit.document });
  return { frozen: true, scenarios: scenarios.length, events: events.total, fills: trades.length, integrity: "PASS", pixels: "PASS" };
}

async function t0t4({ date, packet, audit }) {
  const events = metadata(await call("get_forensic_events", { date, scenario_id: packet.scenario_id, attempt: packet.attempt, limit: 200 })).items;
  const t0 = events.find(e => /^STEP_/.test(e.event)), t1 = events.find(e => e.event === "CONFIRMED");
  const t2 = events.find(e => ["ARMED", "NON_ELIGIBLE"].includes(e.event));
  const t3 = events.find(e => e.event === "FILLED");
  const t4 = events.filter(e => ["TRADE_EXIT", "CLOSED", "INVALIDATED", "EXPIRED", "NON_ELIGIBLE"].includes(e.event)).at(-1);
  assert.ok(t0 && t1 && t2 && t4, `T0-T4 evidence missing ${date}`);
  assert.ok(t3 || audit.fills === 0, "No-fill requires published ENGINE fills=0");
  report.t0_t4[date] = { status: "PASS", episode_id: packet.EPISODE_METADATA.episode_id,
    T0: t0.event_id, T1: t1.event_id, T2: t2.event_id, T3: t3?.event_id ?? "ENGINE_AUDIT_FILLS_ZERO", T4: t4.event_id,
    limitation: "T0 is first published prerequisite completion, not unpublished first evaluation. No intrabar market path invented." };
}
