import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOosMcpServer } from "../src/oos-mcp-server.js";
import { FORENSIC_TOOL_INPUTS } from "../src/oos-forensic-tools.js";

async function connection(scopes, forensic) {
  const forbidden = new Proxy({}, { get() { throw new Error("FORBIDDEN_TRADING_DEPENDENCY"); } });
  const server = createOosMcpServer({ auth: { scopes }, forensic, portal: forbidden, probe: forbidden, contracts: forbidden });
  const client = new Client({ name: "SYNTHETIC_FORENSIC_TEST", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair(); await server.connect(left); await client.connect(right);
  return { server, client, async close() { await client.close(); await server.close(); } };
}
test("public catalogue registers all 31 forensic read tools, 47 total, desk.read only", async () => {
  const calls = [], c = await connection(["desk.read"], { call: async (name, args) => {
    calls.push({ name, args }); return { available: true, images: [{ name: "SYNTHETIC", mime_type: "image/png", data: "AA==", sha256: "test" }] };
  } });
  try {
    const tools = (await c.client.listTools()).tools; assert.equal(tools.length, 47);
    assert.equal(Object.keys(FORENSIC_TOOL_INPUTS).length, 31);
    for (const name of Object.keys(FORENSIC_TOOL_INPUTS)) {
      const tool = tools.find(t => t.name === name); assert.ok(tool);
      assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool.annotations.openWorldHint, false);
      assert.deepEqual(tool._meta.securitySchemes[0].scopes, ["desk.read"]);
    }
    const result = await c.client.callTool({ name: "get_replay_artifact", arguments: { date: "2026-07-02", artifact: "5m_final" } });
    assert.equal(result.content.filter(item => item.type === "image").length, 1); assert.equal(calls.length, 1);
    assert.equal((await c.client.callTool({ name: "get_frozen_plan", arguments: { date: "../../secret", path: "replay" } })).isError, true);
    assert.equal(calls.length, 1);
  } finally { await c.close(); }
});
test("write-only token is denied before any forensic dependency; unauthorised cannot read", async () => {
  let reads = 0;
  const c = await connection(["desk.write"], { call() { reads++; } });
  try {
    const result = await c.client.callTool({ name: "get_forensic_capabilities", arguments: {} });
    assert.equal(result.isError, true); assert.match(result.content[0].text, /OOS_SCOPE_REQUIRED/); assert.equal(reads, 0);
  } finally { await c.close(); }
});
