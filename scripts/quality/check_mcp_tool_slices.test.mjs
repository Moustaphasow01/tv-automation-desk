import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import {
  AUTOPILOT_V4_MCP_TOOL_NAMES,
  assertMcpToolSliceCoverage,
  getMcpToolSlice,
  listMcpToolSliceSummaries,
} from "../../mcp_gpt_desk/src/mcp-tool-slices.js";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const guardPath = path.join(repoRoot, "scripts/quality/check_mcp_tool_slices.mjs");

describe("MCP tool slice guard", () => {
  it("passes on the current repository slices", () => {
    const result = spawnSync(process.execPath, [guardPath], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"actual_tools": 117/);
    assert.match(result.stdout, /"slice_count": 10/);
  });

  it("detects missing and stale assignments", () => {
    const coverage = assertMcpToolSliceCoverage(["desk_ping", "new_tool_without_owner"]);
    assert.equal(coverage.ok, false);
    assert.deepEqual(coverage.missing_assignments, ["new_tool_without_owner"]);
    assert.ok(coverage.stale_assignments.includes("get_contract"));
  });

  it("keeps Autopilot V4 exposure narrower than the legacy registry", () => {
    assert.equal(getMcpToolSlice("claim_next_live_work"), "gpt-work.lifecycle");
    assert.equal(getMcpToolSlice("run_feature_engine"), "backtest.legacy");
    assert.equal(AUTOPILOT_V4_MCP_TOOL_NAMES.includes("save_replay_monitor"), true);
    assert.equal(AUTOPILOT_V4_MCP_TOOL_NAMES.includes("requeue_agent_runtime_dead_letter"), true);
    assert.equal(AUTOPILOT_V4_MCP_TOOL_NAMES.includes("run_feature_engine"), false);
    assert.equal(AUTOPILOT_V4_MCP_TOOL_NAMES.includes("create_desk_job"), false);
    assert.ok(listMcpToolSliceSummaries().every((slice) => slice.total > 0));
  });
});
