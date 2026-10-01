import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOosRuntimeContracts } from "../../packages/desk-oos-batch/index.js";
import { readRuntimeContractSource } from "../../packages/desk-oos-batch/src/adapter/runtime-contract-source.js";
import { createOosMcpServer } from "../src/oos-mcp-server.js";
import { readOosInstalledEngine } from "../src/oos-tradingview-contract-source.js";

const names = ["get_engine_constraints", "get_smc3_contract", "get_runtime_contract"];
test("three public read tools work with desk.read alone and cannot reach any trading mutation", async () => {
  const basis = await readRuntimeContractSource();
  const contracts = await createOosRuntimeContracts({ readInstalled: async () => basis.snapshot.installed });
  const forbidden = new Proxy({}, { get() { throw Error("MUTATION_OR_ARCHIVE_READ_FORBIDDEN"); } });
  const server = createOosMcpServer({ auth: { scopes: ["desk.read"] }, contracts, portal: forbidden, probe: forbidden });
  const client = new Client({ name: "SYNTHETIC_CONTRACT_READ", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair(); await server.connect(left); await client.connect(right);
  try {
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 16);
    for (const name of names) {
      const tool = tools.find(tool => tool.name === name);
      assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool.annotations.destructiveHint, false);
      assert.equal(tool.annotations.openWorldHint, false); assert.deepEqual(tool._meta.securitySchemes[0].scopes, ["desk.read"]);
      const result = await client.callTool({ name, arguments: {} });
      assert.notEqual(result.isError, true); assert.equal(result.structuredContent.engine_version, "V3.9.8");
      assert.equal(result.content.filter(item => item.type === "image").length, 0);
    }
  } finally { await client.close(); await server.close(); }
});

test("write-only scope cannot read contracts and day/path injection is rejected", async () => {
  let read = 0;
  const server = createOosMcpServer({ auth: { scopes: ["desk.write"] }, contracts: { runtimeContract() { read++; } } });
  const client = new Client({ name: "SYNTHETIC_DENIED", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair(); await server.connect(left); await client.connect(right);
  try {
    for (const name of names) {
      const result = await client.callTool({ name, arguments: {} });
      assert.equal(result.isError, true); assert.match(result.content[0].text, /OOS_SCOPE_REQUIRED/);
    }
    assert.equal((await client.callTool({ name: names[2], arguments: { date: "2026-07-30", path: "replay/audit.json" } })).isError, true);
    assert.equal(read, 0);
  } finally { await client.close(); await server.close(); }
});

test("TradingView contract source reads only study metadata and excludes plan input", async () => {
  let checked = false, expression;
  const capture = { assertChart: async () => { checked = true; }, evaluate: async value => { expression = value; return { synthetic: true }; } };
  assert.deepEqual(await readOosInstalledEngine(capture), { synthetic: true });
  assert.equal(checked, true);
  assert.match(expression, /getInputsInfo/); assert.match(expression, /name!=='COLLER LE PLAN COMPACT ICI'/);
  assert.doesNotMatch(expression, /setInput|\.logs\(|oosTables|bars\(|fetch\(|replayApi|setValue/);
});
