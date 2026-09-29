import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { OosMcpConnection } from "../src/oos-mcp-connection.js";
import { TradingViewMcpAdapter } from "../../packages/desk-oos-batch/src/adapter/tradingview-mcp.js";
test("real SDK stdio handshake forwards exact argument bytes and redacts provider errors", async () => {
  const client = new OosMcpConnection({ transport: "stdio", command: process.execPath,
    args: [fileURLToPath(new URL("./fixtures/oos_mcp_fixture.mjs", import.meta.url))], tools: { loadPlan: "load", fail: "failed" } });
  try {
    const args = { plan_text: "SYNTHETIC\r\n  spacing\n", replay_only: true };
    assert.deepEqual((await client.call("loadPlan", args)).args, args);
    await assert.rejects(() => client.call("unconfigured", {}), { code: "OOS_MCP_TOOL_UNCONFIGURED" });
    await assert.rejects(() => client.call("fail", {}), { message: "OOS_MCP_TOOL_FAILED" });
  } finally { await client.close(); }
});
test("TradingView cannot load an unfrozen plan and does not receive any trading instruction", async () => {
  const calls = [], tv = new TradingViewMcpAdapter(async (operation, args) => calls.push({ operation, args }));
  await assert.rejects(() => tv.prepareFrozenReplay({ meta: { status: "RECEIVED" } }), { code: "PLAN_NOT_FROZEN" });
  assert.equal(calls.length, 0);
  const input = { symbol: "TEST_ONLY", date: "2026-07-01", cutoff: "2026-07-01T09:00:00+02:00", timezone: "Europe/Paris",
    engine_version: "V3.9.8", book_mode: "PORTEFEUILLE_REALISTE", plan_text: "opaque\r\n", meta: { status: "FROZEN", plan_sha256: "a".repeat(64) } };
  await tv.prepareFrozenReplay(input);
  assert.equal(calls.find(c => c.operation === "loadPlan").args.plan_text, input.plan_text);
  assert.equal(calls.at(-1).operation, "setReplayCutoff");
  assert.ok(calls.every(c => c.args.replay_only === true));
});
