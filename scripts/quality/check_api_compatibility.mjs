import { buildFrontApiV2Catalog } from "../../mcp_gpt_desk/src/front-api-catalog-v2.js";
import { frontApiOpenApiDocument } from "../../mcp_gpt_desk/src/front-api-openapi.js";
import { buildFrontOperationsEvent, frontEventSseFrame, shouldEmitFrontEvent } from "../../mcp_gpt_desk/src/front-events-contract-v1.js";
import { filterMcpTools } from "../../mcp_gpt_desk/src/mcp-tool-profile.js";
import { operatorAccessPolicyForFrontRoute, hasOperatorScopes } from "../../mcp_gpt_desk/src/operator-access-policy-v1.js";
import { createDeskToolRegistry } from "../../mcp_gpt_desk/src/tools.js";

const CRITICAL_OPERATIONS = [
  ["GET", "/live-desk/current"],
  ["GET", "/operations/summary"],
  ["GET", "/replays"],
  ["POST", "/replays"],
  ["GET", "/events"],
  ["POST", "/execution/actions"],
  ["GET", "/strategy-v2/overview"],
  ["GET", "/data-foundation/overview"],
  ["GET", "/ai-context/overview"],
  ["GET", "/portfolio-risk/overview"],
  ["GET", "/openapi.json"],
];

export function checkApiCompatibility() {
  const openApi = frontApiOpenApiDocument();
  const catalog = buildFrontApiV2Catalog({ openApi });
  const violations = [];

  for (const [method, path] of CRITICAL_OPERATIONS) {
    const operation = openApi.paths?.[path]?.[method.toLowerCase()];
    if (!operation) violations.push(`critical_operation_missing:${method}:${path}`);
    if (!catalog.operations.some((item) => item.method === method && item.path === path)) violations.push(`critical_catalog_entry_missing:${method}:${path}`);
  }

  for (const [path, pathItem] of Object.entries(openApi.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (operation?.deprecated && (!operation["x-desk-sunset"] || !operation["x-desk-replacement"])) {
        violations.push(`deprecated_operation_missing_sunset:${method.toUpperCase()}:${path}`);
      }
    }
  }

  const event = buildFrontOperationsEvent({ contract: "OperationsSummary", version: 1 });
  if (!frontEventSseFrame(event).startsWith(`id: ${event.event_id}\n`)) violations.push("sse_frame_missing_resumable_id");
  if (shouldEmitFrontEvent(event, { lastEventId: event.event_id })) violations.push("sse_cursor_dedupe_failed");

  const replayPolicy = operatorAccessPolicyForFrontRoute({ path: "/replays", method: "POST" });
  const executionPolicy = operatorAccessPolicyForFrontRoute({ path: "/execution/actions", method: "POST" });
  if (!replayPolicy.requiredScopes.includes("desk.automation.write")) violations.push("replay_write_scope_not_granular");
  if (!executionPolicy.requiredScopes.includes("desk.execution.write")) violations.push("execution_write_scope_not_granular");
  if (hasOperatorScopes(["desk.automation.read"], ["desk.execution.read"])) violations.push("automation_read_grants_execution_read");

  const tools = createDeskToolRegistry({});
  const live = filterMcpTools(tools, "live_worker").map((tool) => tool.name);
  const replay = filterMcpTools(tools, "replay_worker").map((tool) => tool.name);
  const research = filterMcpTools(tools, "research_worker").map((tool) => tool.name);
  const execution = filterMcpTools(tools, "execution_gateway").map((tool) => tool.name);
  if (live.some((name) => name.includes("replay"))) violations.push("live_surface_contains_replay_tool");
  if (replay.some((name) => name.includes("live"))) violations.push("replay_surface_contains_live_tool");
  if (research.some((name) => /^(save_|claim_|complete_|fail_)/.test(name))) violations.push("research_surface_contains_mutator");
  if (execution.some((name) => /(?:live|replay|save_|claim_|complete_|fail_)/.test(name))) violations.push("execution_surface_contains_ai_workflow_tool");

  return {
    ok: violations.length === 0,
    violations,
    critical_operations: CRITICAL_OPERATIONS.length,
    catalog_operations: catalog.operations.length,
    compatibility_fingerprint: catalog.compatibilityFingerprint,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkApiCompatibility();
  if (!result.ok) {
    console.error("[api-compatibility-guard] FAILED");
    for (const violation of result.violations) console.error(`- ${violation}`);
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}
