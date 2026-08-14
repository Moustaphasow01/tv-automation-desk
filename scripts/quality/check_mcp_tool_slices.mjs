#!/usr/bin/env node
import { createDeskToolRegistry } from "../../mcp_gpt_desk/src/tools.js";
import {
  AUTOPILOT_V4_MCP_TOOL_NAMES,
  assertMcpToolSliceCoverage,
  listMcpToolSliceSummaries,
} from "../../mcp_gpt_desk/src/mcp-tool-slices.js";

const tools = createDeskToolRegistry({});
const coverage = assertMcpToolSliceCoverage(tools.map((tool) => tool.name));
const actualToolSet = new Set(tools.map((tool) => tool.name));
const failures = [];

for (const toolName of coverage.missing_assignments) failures.push(`unassigned tool: ${toolName}`);
for (const toolName of coverage.stale_assignments) failures.push(`stale slice assignment: ${toolName}`);
for (const duplicate of coverage.duplicate_assignments) failures.push(`duplicate slice assignment: ${duplicate}`);
for (const toolName of AUTOPILOT_V4_MCP_TOOL_NAMES) {
  if (!actualToolSet.has(toolName)) failures.push(`autopilot profile exposes missing tool: ${toolName}`);
}
for (const forbiddenTool of ["get_cross_asset_delta", "run_feature_engine", "create_backtest_run", "create_desk_job"]) {
  if (AUTOPILOT_V4_MCP_TOOL_NAMES.includes(forbiddenTool)) {
    failures.push(`autopilot profile exposes forbidden legacy tool: ${forbiddenTool}`);
  }
}

if (failures.length) {
  console.error("[mcp-tool-slices] FAILED");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    actual_tools: coverage.actual_count,
    assigned_tools: coverage.assigned_count,
    slice_count: coverage.slice_count,
    autopilot_v4_tools: AUTOPILOT_V4_MCP_TOOL_NAMES.length,
    slices: listMcpToolSliceSummaries(),
  }, null, 2));
}
