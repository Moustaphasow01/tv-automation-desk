import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const failed = code => Object.assign(new Error(code), { code });

/** This client transports explicit technical calls; it never requests model sampling. */
export class OosMcpConnection {
  constructor(config) { this.config = config; this.client = null; this.connecting = null; }

  async connect() {
    if (this.client) return this.client;
    if (!this.connecting) this.connecting = this.open().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async open() {
    const config = this.config;
    if (!config?.tools) throw failed("OOS_MCP_CONFIGURATION_REQUIRED");
    const transport = createTransport(config);
    const client = new Client({ name: "oos-batch-technical-client", version: "1.0.0" }, { capabilities: {} });
    try {
      await client.connect(transport, { timeout: 30000 });
      this.client = client;
      return client;
    } catch (error) { await transport.close().catch(() => {}); throw failed("OOS_MCP_CONNECT_FAILED"); }
  }

  async call(operation, args, options = {}) {
    const name = this.config?.tools?.[operation];
    if (typeof name !== "string" || !name) throw failed("OOS_MCP_TOOL_UNCONFIGURED");
    const client = await this.connect();
    let result;
    const timeout = options.timeoutMs || this.config.command_timeout_ms || 120000;
    const started = Date.now();
    try { result = await client.callTool({ name, arguments: args }, undefined, { timeout }); }
    catch (error) { throw Object.assign(failed("OOS_MCP_CALL_FAILED"), { details: {
      operation, tool: name, timeout_ms: timeout, elapsed_ms: Date.now() - started,
      upstream_code: typeof error.code === "number" ? error.code : null } }); }
    if (result.isError) throw failed("OOS_MCP_TOOL_FAILED");
    return parseOosMcpResult(result, operation);
  }

  async close() { await this.client?.close(); this.client = null; }
}

function createTransport(config) {
  if (config.transport === "stdio" && config.command) return new StdioClientTransport({
    command: config.command, args: config.args || [], cwd: config.cwd, stderr: "ignore" });
  if (config.transport !== "http" || !config.url) throw failed("OOS_MCP_CONFIGURATION_REQUIRED");
  const url = new URL(config.url);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw failed("OOS_MCP_HTTPS_REQUIRED");
  const token = config.token_env ? process.env[config.token_env] : null;
  if (config.token_env && !token) throw failed("OOS_MCP_TOKEN_MISSING");
  return new StreamableHTTPClientTransport(url, { requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} } });
}

export function parseOosMcpResult(result, operation) {
  let value;
  try { value = result.structuredContent || JSON.parse(result.content?.find(item => item.type === "text")?.text); }
  catch { throw failed("OOS_MCP_RESULT_INVALID"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw failed("OOS_MCP_RESULT_INVALID");
  const images = result.content?.filter(item => item.type === "image") || [];
  if (operation === "capture" && images.length) return attachImage(value, images);
  return value;
}

function attachImage(value, images) {
  if (images.length !== 1 || images[0].mimeType !== "image/png") throw failed("OOS_MCP_IMAGE_INVALID");
  if (value.image_base64 && value.image_base64 !== images[0].data) throw failed("OOS_MCP_IMAGE_CONFLICT");
  return { ...value, image_base64: images[0].data };
}
