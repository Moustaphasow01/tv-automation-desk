import assert from "node:assert/strict";
import test from "node:test";
import { cleanupLegacyResearchQueue } from "../scripts/cleanup_legacy_research_queue.mjs";

test("legacy research queue cleanup dry-run lists superseded tasks without mutating them", async () => {
  const pool = {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return {
        rows: [
          {
            agent_task_id: "agent_task_legacy_1",
            task_key: "research:legacy:1",
            task_type: "RESEARCH_BACKTEST_REVIEW",
            status: "READY",
            priority: 10,
            payload: { generator_version: "research_strategy_iteration_generator_v0", iteration_index: 2 },
            created_at_utc: "2026-08-01T00:00:00.000Z",
          },
        ],
      };
    },
  };

  const result = await cleanupLegacyResearchQueue({ pool, apply: false, limit: 25 });

  assert.equal(result.status, "DRY_RUN");
  assert.equal(result.matched_count, 1);
  assert.equal(result.cancelled_count, 0);
  assert.equal(result.tasks[0].task_id, "agent_task_legacy_1");
  assert.equal(pool.queries.length, 1);
});

test("legacy research queue cleanup refuses apply mode without a maintenance clock", async () => {
  await assert.rejects(
    () => cleanupLegacyResearchQueue({ pool: { query: async () => ({ rows: [] }) }, apply: true }),
    (error) => error.code === "MAINTENANCE_CLOCK_REQUIRED",
  );
});
