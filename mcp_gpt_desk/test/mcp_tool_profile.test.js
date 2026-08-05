import assert from "node:assert/strict";
import test from "node:test";
import { createDeskToolRegistry } from "../src/tools.js";
import {
  AUTOPILOT_V4_MCP_TOOL_NAMES,
  filterMcpTools,
  isMcpToolExposed,
  normalizeMcpToolProfile,
} from "../src/mcp-tool-profile.js";

const allTools = createDeskToolRegistry({});

test("Autopilot V4 MCP profile exposes only the current replay/live workflow", () => {
  const names = filterMcpTools(allTools, "autopilot_v4").map((tool) => tool.name);
  assert.deepEqual(names, AUTOPILOT_V4_MCP_TOOL_NAMES);
  assert.equal(names.includes("get_cross_asset_delta"), false);
  assert.equal(names.includes("run_feature_engine"), false);
  assert.equal(names.includes("create_backtest_run"), false);
  assert.equal(names.includes("create_desk_job"), false);
  assert.equal(names.includes("get_desk_methodology"), false);
  assert.equal(names.includes("save_replay_monitor"), true);
  assert.equal(names.includes("claim_next_desk_work"), true);
});

test("MCP legacy compatibility profile is no longer executable", () => {
  assert.equal(allTools.some((tool) => tool.name === "get_cross_asset_delta"), false);
  assert.throws(() => filterMcpTools(allTools, "all"), /MCP_LEGACY_PROFILE_REMOVED/);
  assert.throws(() => isMcpToolExposed("get_cross_asset_delta", "compatibility"), /MCP_LEGACY_PROFILE_REMOVED/);
  assert.equal(isMcpToolExposed("get_cross_asset_delta", "autopilot_v4"), false);
  assert.equal(normalizeMcpToolProfile("v4"), "autopilot_v4");
  assert.throws(() => normalizeMcpToolProfile("unknown"), /MCP_TOOL_PROFILE_INVALID/);
});
