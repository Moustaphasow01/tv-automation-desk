import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Operator acceptance runner: credentials stay in environment, output is metadata only.
const config = JSON.parse(await readFile(process.env.OOS_BATCH_CONFIG, "utf8"));
const base = config.public_url, mode = process.argv[2] || "check", date = "2026-07-30";
assert.ok(["check", "capture", "retry-capture", "status", "bundle"].includes(mode));
const headers = { authorization: `Bearer ${process.env.OOS_OPERATOR_TOKEN}` };
const health = await fetch(`${base}/health`); assert.equal(health.status, 200);
assert.equal((await health.json()).replay_enabled, config.replay_enabled === true);
if (["capture", "retry-capture"].includes(mode)) {
  const response = await fetch(`${base}/front-api/v1/oos-batch/commands`, { method: "POST",
    headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({
      batch_id: "OOS", symbol: "CME_MINI:MES1!", cutoff_time: "09:00", date, action: mode,
      command_id: mode === "capture" ? "smoke-20260730-capture" : `smoke-20260730-retry-${process.argv[3] || "1"}` }) });
  console.log(JSON.stringify({ mode, status: response.status, receipt: await response.json() }));
  assert.equal(response.status, 202);
} else {
  const client = new Client({ name: "OOS deployment acceptance (not ChatGPT)", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }));
  try {
    if (mode === "check") {
      const tools = (await client.listTools()).tools; assert.equal(tools.length, 16);
      assert.equal((await fetch(`${base}/mcp`, { method: "POST", body: "{}" })).status, 401);
      const first = await client.callTool({ name: "write_probe", arguments: { value: "deployment-sdk-probe-001" } });
      assert.deepEqual(await client.callTool({ name: "write_probe", arguments: { value: "deployment-sdk-probe-001" } }), first);
      assert.equal((await client.callTool({ name: "get_write_probe", arguments: {} })).structuredContent.value, "deployment-sdk-probe-001");
      const login = await fetch(`${base}/login`, { method: "POST", redirect: "manual", body: new URLSearchParams({ pin: process.env.DESK_OAUTH_ADMIN_PIN }) });
      assert.equal(login.status, 303);
      const cookie = login.headers.get("set-cookie").split(";")[0];
      if (process.env.OOS_ACCEPTANCE_BROWSER_STATE === "1") {
        const browserState = { cookies: [{ name: "oos_session", value: cookie.slice("oos_session=".length),
          domain: new URL(base).hostname, path: "/oos/", httpOnly: true, secure: true, sameSite: "Strict",
          expires: Math.floor(Date.now() / 1000) + 3600 }], origins: [] };
        await writeFile(path.join(config.archive_root, "config/browser-state.json"), JSON.stringify(browserState), { mode: 0o600 });
      }
      const ui = await fetch(`${base}/`, { headers: { cookie } }); assert.equal(ui.status, 200);
      const html = await ui.text(), js = html.match(/src="([^"]+\.js)"/)[1];
      assert.equal((await fetch(new URL(js, base), { headers: { cookie } })).status, 200);
      console.log(JSON.stringify({ health: "PASS", https: "PASS", authenticated_ui: "PASS", mcp_tools: tools.map(t => t.name), write_probe: "PASS_REAL_SDK_NOT_CHATGPT" }));
    } else {
      const result = await client.callTool({ name: mode === "bundle" ? "get_premarket_bundle" : "get_run_status", arguments: { date } });
      if (result.isError) { console.log(result.content[0].text); process.exitCode = 1; }
      else if (mode === "bundle") {
        const images = result.content.filter(item => item.type === "image"); assert.equal(images.length, 8);
        const captures = result.structuredContent.manifest.captures;
        for (let i = 0; i < images.length; i++) assert.equal(createHash("sha256").update(Buffer.from(images[i].data, "base64")).digest("hex"), captures[i].sha256);
        console.log(JSON.stringify({ date, captures: images.length, pixel_hashes: "PASS", manifest: result.structuredContent.manifest }));
      } else console.log(JSON.stringify(result.structuredContent));
    }
  } finally { await client.close(); }
}
