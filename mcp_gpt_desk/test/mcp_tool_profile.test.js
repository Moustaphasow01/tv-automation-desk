import assert from "node:assert/strict";
import test from "node:test";
import { createDeskToolRegistry } from "../src/tools.js";
import {
  AUTOPILOT_V4_MCP_TOOL_NAMES,
  filterMcpTools,
  getMcpToolProfileSummary,
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

test("Strict role MCP profiles isolate Live, Replay, Research and Execution surfaces", () => {
  const live = filterMcpTools(allTools, "live_worker").map((tool) => tool.name);
  const replay = filterMcpTools(allTools, "replay_worker").map((tool) => tool.name);
  const research = filterMcpTools(allTools, "research_worker").map((tool) => tool.name);
  const execution = filterMcpTools(allTools, "execution_gateway").map((tool) => tool.name);

  assert.equal(normalizeMcpToolProfile("live"), "live_worker");
  assert.equal(normalizeMcpToolProfile("replay"), "replay_worker");
  assert.equal(normalizeMcpToolProfile("research"), "research_worker");
  assert.equal(normalizeMcpToolProfile("execution"), "execution_gateway");
  assert.equal(live.includes("claim_next_live_work"), true);
  assert.equal(live.includes("start_or_resume_replay_autopilot"), false);
  assert.equal(live.includes("claim_next_desk_work"), false);
  assert.equal(replay.includes("claim_next_replay_work"), true);
  assert.equal(replay.includes("claim_next_live_work"), false);
  assert.equal(replay.includes("get_master_analysis_bundle"), false);
  assert.equal(research.some((name) => /^(save_|claim_|complete_|fail_)/.test(name)), false);
  assert.deepEqual(execution, ["desk_ping", "get_active_contracts", "get_contract", "list_contract_versions"]);
});

test("Strict role MCP profile summaries are explicit for prompt and policy binding", () => {
  const summary = getMcpToolProfileSummary("replay_worker");
  assert.equal(summary.profile, "replay_worker");
  assert.equal(summary.role, "replay_worker");
  assert.ok(summary.tool_count > 10);
  assert.ok(summary.denied_patterns.includes("live"));
  assert.equal(getMcpToolProfileSummary("autopilot_v4").role, "autopilot_v4_compat");
});
