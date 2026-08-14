import assert from "node:assert/strict";
import test from "node:test";
import { buildPromptRegistryOverview } from "../src/prompt-registry-front-projection.js";

test("prompt registry projection exposes Live and Replay seed parity", async () => {
  const overview = await buildPromptRegistryOverview({ nowUtc: "2026-08-09T12:30:00.000Z" });

  assert.equal(overview.contract, "DeskPromptRegistryOverviewV1");
  assert.equal(overview.summary.activePrompts, 2);
  assert.equal(overview.summary.parityDrift, 0);
  assert.equal(overview.source.writeApiEnabled, false);

  const live = overview.items.find((item) => item.lane === "live");
  const replay = overview.items.find((item) => item.lane === "replay");
  assert.equal(live.parityStatus, "OK");
  assert.equal(replay.parityStatus, "OK");
  assert.equal(live.sourceBytes, 15220);
  assert.equal(replay.sourceBytes, 16059);
  assert.equal(live.evaluation.status, "PENDING_BASELINE_RUN");
  assert.ok(live.consumers.includes("mcp_gpt_desk/src/store.js"));
});
