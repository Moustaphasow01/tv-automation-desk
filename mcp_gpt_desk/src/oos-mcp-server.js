import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const date = z.string().regex(/^2026-(07|08)-\d{2}$/);
const month = z.string().regex(/^2026-(07|08)$/);
const empty = z.object({}).strict();
const day = z.object({ date }).strict();

/** No legacy MCP registry is imported. Only these explicit OOS capabilities exist. */
export function createOosMcpServer({ portal, probe, auth }) {
  const server = new McpServer({ name: "Desk OOS", version: "1.0.0" });
  const read = (name, description, input, run) => register(server, auth, { name, description, input, mode: "read", run });
  const write = (name, description, input, run) => register(server, auth, { name, description, input, mode: "write", run });
  read("list_pending_days", "List unfinished OOS days. No post-cutoff results are returned before freeze.", empty,
    () => portal.list("pending"));
  read("list_completed_days", "List completed, frozen OOS days, optionally in a month.", z.object({ month: month.optional() }).strict(),
    args => portal.list("completed", args.month));
  read("get_premarket_bundle", "Get only the eight premarket PNG images and their verified manifest. Image content contains actual pixels; never replay data.", day,
    args => portal.premarket(args.date));
  read("get_run_status", "Read the technical state of an OOS day.", day, args => portal.status(args.date));
  read("get_run_result", "Read ENGINE-provided results only after a frozen plan and completed replay.", day, args => portal.result(args.date));
  read("get_month_results", "Read verified completed results. Unfrozen days are excluded.", z.object({ month }).strict(), args => portal.month(args.month));
  write("submit_smc3_plan", "Store the exact externally authored SMC3 text, validate syntax and freeze. Never repairs text or starts replay.",
    z.object({ date, plan_text: z.string().min(1).max(2_000_000) }).strict(), args => portal.submit(args.date, args.plan_text));
  write("request_replay", "Queue a TradingView simulation for an already frozen plan. Never sends a broker order.", day, args => portal.requestReplay(args.date));
  write("write_probe", "Idempotent connection test. Writes only a technical probe record, entirely separate from trading data.",
    z.object({ value: z.string().min(1).max(500) }).strict(), args => probe.write(args.value));
  read("get_write_probe", "Read the latest technical write probe; no trading data.", empty, () => probe.read());
  return server;
}

function register(server, auth, tool) {
  const scope = `desk.${tool.mode}`;
  server.registerTool(tool.name, {
    description: tool.description, inputSchema: tool.input,
    annotations: { readOnlyHint: tool.mode === "read", destructiveHint: false,
      idempotentHint: true, openWorldHint: tool.name === "request_replay" },
    _meta: { securitySchemes: [{ type: "oauth2", scopes: [scope] }] },
  }, async args => {
    if (!auth?.scopes?.includes(scope)) return failed("OOS_SCOPE_REQUIRED");
    try { return result(await tool.run(args)); }
    catch (error) { return failed(error.code || "OOS_TOOL_FAILED"); }
  });
}

function failed(code) { return { isError: true, content: [{ type: "text", text: JSON.stringify({ ok: false, code }) }] }; }
function result(value) {
  const { images = [], ...metadata } = Array.isArray(value) ? { items: value } : value;
  const content = [{ type: "text", text: JSON.stringify(metadata) }];
  for (const item of images) {
    content.push({ type: "text", text: JSON.stringify({ capture: item.name, sha256: item.sha256 }) });
    content.push({ type: "image", mimeType: item.mime_type, data: item.data });
  }
  return { structuredContent: metadata, content };
}
