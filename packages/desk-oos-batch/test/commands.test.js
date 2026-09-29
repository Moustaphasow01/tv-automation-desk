import test from "node:test";
import assert from "node:assert/strict";
import { PostgresOosCommands } from "../src/adapter/postgres-commands.js";
import { batchDays } from "../src/domain/batch-contract.js";
import { DAY } from "./support.js";
test("ambiguous periods or unexpected strategy fields cannot be silently accepted", () => {
  const request = { batch_id: "TEST", date: "2026-07-01", symbol: "TEST_ONLY", cutoff_time: "09:00" };
  assert.throws(() => batchDays({ ...request, month: "2026-07" }), { code: "PERIOD_SELECTOR_INVALID" });
  assert.throws(() => batchDays({ ...request, rr_min: 2 }), { code: "BATCH_FIELDS_INVALID" });
});
test("resumed replacement command continues its candidate instead of requesting a second new plan", async () => {
  const commands = new PostgresOosCommands({ pool: {}, get: async () => ({ candidate_attempt: 2, state: "WAITING_SCENARIO" }) });
  const observed = [], workflow = { execute: async (day, action) => { observed.push(action); return { state: "FROZEN", error: null }; } };
  const result = await commands.executeDay(workflow, { payload: { action: "new-plan", attempts: [1], days: [DAY] } }, 0);
  assert.deepEqual(observed, ["scenario"]); assert.equal(result.state, "FROZEN");
});
test("rejected replacement remains rejected after command restart, no further builder request", async () => {
  const commands = new PostgresOosCommands({ pool: {}, get: async () => ({ candidate_attempt: 2, state: "FAILED_PLAN_VALIDATION", error: { code: "PLAN_SYNTAX_INVALID" } }) });
  const result = await commands.executeDay({ execute: () => { throw new Error("must not execute"); } }, { payload: { action: "new-plan", attempts: [1], days: [DAY] } }, 0);
  assert.equal(result.state, "FAILED_PLAN_VALIDATION");
});
