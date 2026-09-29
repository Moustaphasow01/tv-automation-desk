// Synthetic transport endpoint only. No market data, scenario construction or TradingView access.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
const server = new Server({ name: "oos-test-fixture", version: "1" }, { capabilities: { tools: {} } });
server.setRequestHandler(CallToolRequestSchema, async request => {
  if (request.params.name === "failed") return { isError: true, content: [{ type: "text", text: "private upstream diagnostic" }] };
  const value = { name: request.params.name, args: request.params.arguments, source: "SYNTHETIC_TEST_ONLY" };
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
});
await server.connect(new StdioServerTransport());
