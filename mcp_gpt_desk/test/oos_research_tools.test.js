import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOosMcpServer } from "../src/oos-mcp-server.js";

async function connection(scopes, research) {
  const forbidden = new Proxy({}, { get() { throw new Error("FORBIDDEN_OOS_MUTATION"); } });
  const server = createOosMcpServer({ auth: { scopes }, portal: forbidden, probe: forbidden,
    contracts: forbidden, forensic: { call: () => assert.fail("not a research dependency") }, research });
  const client = new Client({ name: "SYNTHETIC_RESEARCH_TEST", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(left); await client.connect(right);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
const id = "a".repeat(64);
test("research is optional: legacy public tool catalogue remains 47, no implicit feature activation", async () => {
  const c = await connection(["desk.read", "desk.write"]);
  try { assert.equal((await c.client.listTools()).tools.length, 47); }
  finally { await c.close(); }
});
test("six research tools are actually registered when explicitly enabled, writes only isolated memory", async () => {
  const calls = [], research = {};
  for (const name of ["start", "advance", "status", "artifacts", "scorecard", "experiment"]) {
    research[name] = async args => { calls.push({ name, args }); return { champion_modification_allowed: false }; };
  }
  const c = await connection(["desk.read", "desk.write"], research);
  try {
    const tools = (await c.client.listTools()).tools;
    assert.equal(tools.length, 53);
    const writes = ["start_research_cycle", "advance_research_cycle", "register_research_experiment"];
    for (const name of ["get_research_status", "get_research_artifacts", "get_research_scorecard", ...writes]) {
      const tool = tools.find(t => t.name === name); assert.ok(tool);
      assert.equal(tool.annotations.readOnlyHint, !writes.includes(name));
      assert.equal(tool.annotations.openWorldHint, false);
    }
    assert.equal((await c.client.callTool({ name: "start_research_cycle", arguments: {
      dates: ["2026-07-02"], budget: { maximum_model_calls: 0 } } })).isError, undefined);
    await c.client.callTool({ name: "get_research_status", arguments: { cycle_id: id } });
    assert.deepEqual(calls.map(v => v.name), ["start", "status"]);
    assert.equal((await c.client.callTool({ name: "advance_research_cycle", arguments: { cycle_id: id, execute_replay: true } })).isError, true);
    assert.equal(calls.length, 2);
  } finally { await c.close(); }
});
test("desk.read cannot start model or memory writes; desk.write alone cannot read research", async () => {
  for (const [scopes, name, args] of [[["desk.read"], "start_research_cycle", { dates: ["2026-07-02"], budget: { maximum_model_calls: 0 } }],
    [["desk.write"], "get_research_status", { cycle_id: id }]]) {
    const forbidden = new Proxy({}, { get() { throw new Error("UNAUTHORIZED_RESEARCH_ACCESS"); } });
    const c = await connection(scopes, forbidden);
    try {
      const result = await c.client.callTool({ name, arguments: args });
      assert.equal(result.isError, true); assert.match(result.content[0].text, /OOS_SCOPE_REQUIRED/);
    } finally { await c.close(); }
  }
});
