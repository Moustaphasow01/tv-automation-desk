/** Shared transport only: registration, OAuth scope check and actual MCP image blocks. */
export function registerOosTool(server, auth, tool) {
  const scope = `desk.${tool.mode}`;
  server.registerTool(tool.name, { description: tool.description, inputSchema: tool.input,
    annotations: { readOnlyHint: tool.mode === "read", destructiveHint: false, idempotentHint: true,
      openWorldHint: ["request_replay", "prepare_premarket", "prepare_range"].includes(tool.name) },
    _meta: { securitySchemes: [{ type: "oauth2", scopes: [scope] }] },
  }, async args => {
    if (!auth?.scopes?.includes(scope)) return failed("OOS_SCOPE_REQUIRED");
    try { return result(await tool.run(args)); }
    catch (error) { return failed(error.code || "OOS_TOOL_FAILED", tool.forensic ? error.details : undefined); }
  });
}
function failed(code, details) {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ ok: false, code, ...(details ? { details } : {}) }) }] };
}
function result(value) {
  const { images = [], ...metadata } = Array.isArray(value) ? { items: value } : value;
  const content = [{ type: "text", text: JSON.stringify(metadata) }];
  for (const item of images) {
    content.push({ type: "text", text: JSON.stringify({ capture: item.name, sha256: item.sha256 }) });
    content.push({ type: "image", mimeType: item.mime_type, data: item.data });
  }
  return { structuredContent: metadata, content };
}
