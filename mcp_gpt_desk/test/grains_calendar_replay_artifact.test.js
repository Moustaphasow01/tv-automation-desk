import test from "node:test";
import assert from "node:assert/strict";
import { buildReplayArtifact } from "../scripts/replay_us_grains_causal_postgres.mjs";

test("canonical replay artifact preserves ignored legacy input counts and calendar intervals", () => {
  const report = { provider_commands: 0 };
  const artifact = buildReplayArtifact({ inputPath: "input.json", inputText: "{}",
    frozen: { agri_events: [{ id: 1 }], agri_calendar_coverage: [{ id: 2 }] },
    candles: [{ close: 401 }], calendarVersions: [{}], codeHashes: { file: "hash" },
    calendarSeed: {}, calendarRuntime: {}, detection: { calendar_intervals: [{ fromUtc: "2026-09-01" }] },
    seeded: { market_feed_mapping: {}, runtime_signals: [] }, report });
  assert.equal(artifact.replay_bootstrap.calendar.ignored_unversioned_event_count, 1);
  assert.equal(artifact.replay_bootstrap.calendar.ignored_unversioned_coverage_count, 1);
  assert.equal(artifact.replay_bootstrap.calendar.knowledge_intervals.length, 1);
  assert.equal(artifact.input.candle_count, 1);
  assert.equal(artifact.constraints.physical_execution, false);
  assert.equal(artifact.report, report);
});
