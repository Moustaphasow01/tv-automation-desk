import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHash } from "node:crypto";
import { FORENSIC_TOOL_INPUTS } from "../src/oos-forensic-tools.js";

// Credential is piped through encrypted SSH/stdin, never printed, logged or written to disk.
let token = "";
for await (const chunk of process.stdin) token += chunk;
token = token.trim();
if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("OPERATOR_CREDENTIAL_INPUT_INVALID");
const client = new Client({ name: "External forensic read-only acceptance", version: "2" });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL("https://vps-6d6969db.vps.ovh.net/oos/mcp"), {
    requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  const tools = (await client.listTools()).tools;
  if (tools.length !== 47 || !Object.keys(FORENSIC_TOOL_INPUTS).every(n => tools.some(t => t.name === n && t.annotations.readOnlyHint)))
    throw new Error("PUBLIC_FORENSIC_CATALOGUE_MISMATCH");
  const result = await client.callTool({ name: "get_forensic_capabilities", arguments: {} });
  if (result.isError || result.structuredContent.corpus_days !== 44) throw new Error("FORENSIC_CAPABILITIES_INVALID");
  const image = await client.callTool({ name: "get_replay_artifact", arguments: { date: "2026-07-02", artifact: "5m_final" } });
  const pixels = image.content.find(c => c.type === "image");
  if (!pixels || createHash("sha256").update(Buffer.from(pixels.data, "base64")).digest("hex") !== image.structuredContent.source_sha256)
    throw new Error("FORENSIC_IMAGE_HASH_MISMATCH");
  console.log(JSON.stringify({ external_authenticated_mcp: "PASS", public_tools_count: tools.length,
    forensic_tools_count: Object.keys(FORENSIC_TOOL_INPUTS).length, corpus_days: result.structuredContent.corpus_days,
    actual_pixels: "PASS", write_tools_called: 0 }));
} finally { token = ""; await client.close(); }
