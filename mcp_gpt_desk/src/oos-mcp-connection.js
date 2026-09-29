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
    let transport;
    if (config.transport === "stdio" && config.command) {
      transport = new StdioClientTransport({ command: config.command, args: config.args || [],
        cwd: config.cwd, stderr: "ignore" });
    } else if (config.transport === "http" && config.url) {
      const url = new URL(config.url);
      if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
        throw failed("OOS_MCP_HTTPS_REQUIRED");
      }
      const token = config.token_env ? process.env[config.token_env] : null;
      if (config.token_env && !token) throw failed("OOS_MCP_TOKEN_MISSING");
      transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} } });
    } else throw failed("OOS_MCP_CONFIGURATION_REQUIRED");
    const client = new Client({ name: "oos-batch-technical-client", version: "1.0.0" }, { capabilities: {} });
    try {
      await client.connect(transport, { timeout: 30000 });
      this.client = client;
      return client;
    } catch (error) { await transport.close().catch(() => {}); throw failed("OOS_MCP_CONNECT_FAILED"); }
  }

  async call(operation, args) {
    const name = this.config?.tools?.[operation];
    if (typeof name !== "string" || !name) throw failed("OOS_MCP_TOOL_UNCONFIGURED");
    const client = await this.connect();
    let result;
    try { result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 }); }
    catch { throw failed("OOS_MCP_CALL_FAILED"); }
    if (result.isError) throw failed("OOS_MCP_TOOL_FAILED");
    if (result.structuredContent) return result.structuredContent;
    const content = result.content?.find(item => item.type === "text");
    try { return JSON.parse(content?.text); } catch { throw failed("OOS_MCP_RESULT_INVALID"); }
  }

  async close() { await this.client?.close(); this.client = null; }
}
