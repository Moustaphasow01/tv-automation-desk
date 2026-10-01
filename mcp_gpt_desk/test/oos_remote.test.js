import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createOosHttpServer } from "../src/oos-http-server.js";
import { createOosMcpServer } from "../src/oos-mcp-server.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PNG } from "../../packages/desk-oos-batch/test/support.js";

test("real HTTP MCP handshake exposes exactly OOS tools and isolated idempotent write probe", async () => {
  process.env.OOS_OPERATOR_TOKEN = "synthetic-http-token";
  process.env.DESK_OAUTH_TOKEN_SECRET = "synthetic-oos-test-secret";
  let record = { value: null }, writes = 0;
  const runtime = { probe: { read: async () => record, write: async value => {
    if (record.value !== value) { writes++; record = { value, source: "mcp", written_at: "2026-09-30T00:00:00Z" }; }
    return record;
  } } };
  const server = createOosHttpServer({ runtime, pool: { query: async () => ({ rows: [] }) },
    config: { public_url: "https://example.test/oos", replay_enabled: false }, log: () => {} });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/oos`;
  const client = new Client({ name: "TEST_ONLY", version: "1" });
  try {
    assert.equal((await fetch(`${base}/mcp`, { method: "POST", body: "{}" })).status, 401);
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: "Bearer synthetic-http-token" } } });
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 16);
    for (const name of ["prepare_premarket", "prepare_range"]) {
      assert.equal(tools.find(tool => tool.name === name).annotations.readOnlyHint, false);
      assert.equal(tools.find(tool => tool.name === name).annotations.idempotentHint, true);
    }
    assert.equal(tools.find(tool => tool.name === "get_batch_status").annotations.readOnlyHint, true);
    assert.equal(tools.find(tool => tool.name === "write_probe").annotations.readOnlyHint, false);
    assert.ok(!tools.some(tool => /broker|risk|master|monitor|av4/.test(tool.name)));
    const read = () => client.callTool({ name: "get_write_probe", arguments: {} });
    assert.equal((await read()).structuredContent.value, null);
    const first = await client.callTool({ name: "write_probe", arguments: { value: "chatgpt-write-test-001" } });
    assert.deepEqual(await client.callTool({ name: "write_probe", arguments: { value: "chatgpt-write-test-001" } }), first);
    assert.equal((await read()).structuredContent.value, "chatgpt-write-test-001"); assert.equal(writes, 1);
    const replay = await client.callTool({ name: "request_replay", arguments: { date: "2026-07-30" } });
    assert.equal(replay.isError, true); assert.match(replay.content[0].text, /OOS_REPLAY_DISABLED/);
  } finally { await client.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test("MCP pixels are ImageContent, not just metadata; read scope cannot write", async () => {
  let wrote = false;
  const server = createOosMcpServer({ auth: { scopes: ["desk.read"] }, probe: { write: async () => { wrote = true; } },
    portal: { premarket: async () => ({ manifest: { date: "2026-07-30" }, images: [{ name: "5m_global.png", mime_type: "image/png", data: PNG, sha256: "test-hash" }] }) } });
  const client = new Client({ name: "TEST_ONLY", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(left); await client.connect(right);
  try {
    const bundle = await client.callTool({ name: "get_premarket_bundle", arguments: { date: "2026-07-30" } });
    assert.equal(bundle.content.find(item => item.type === "image").data, PNG);
    assert.equal(bundle.structuredContent.images, undefined);
    assert.equal((await client.callTool({ name: "write_probe", arguments: { value: "forbidden" } })).isError, true);
    assert.equal(wrote, false);
  } finally { await client.close(); await server.close(); }
});

test("new preparation tools use scoped minimal arguments and neutral status; read-only cannot queue captures", async () => {
  const calls = [];
  const portal = { prepare: async date => { calls.push(date); return { date, state: "CAPTURING" }; },
    prepareRange: async (start, end) => { calls.push([start, end]); return { batch_id: "synthetic", status: "RUNNING" }; },
    batchStatus: async filters => ({ filters, days: [], ready: 0 }) };
  for (const scopes of [["desk.read"], ["desk.read", "desk.write"]]) {
    const server = createOosMcpServer({ auth: { scopes }, portal, probe: {} });
    const client = new Client({ name: "SYNTHETIC", version: "1" });
    const [left, right] = InMemoryTransport.createLinkedPair(); await server.connect(left); await client.connect(right);
    try {
      const prepared = await client.callTool({ name: "prepare_premarket", arguments: { date: "2026-07-29" } });
      assert.equal(!!prepared.isError, !scopes.includes("desk.write"));
      const status = await client.callTool({ name: "get_batch_status", arguments: { month: "2026-07" } });
      assert.deepEqual(status.structuredContent.filters, { month: "2026-07" });
      const rejected = await client.callTool({ name: "prepare_range", arguments: { start_date: "2026-07-27", end_date: "2026-07-29", action: "replay" } });
      assert.equal(rejected.isError, true);
    } finally { await client.close(); await server.close(); }
  }
  assert.deepEqual(calls, ["2026-07-29"]);
});
