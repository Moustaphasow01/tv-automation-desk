import assert from "node:assert/strict";
import test from "node:test";
import {
  handleFrontOperations,
  isFrontOperationsMethodAllowed,
  isFrontOperationsPath,
  isFrontOperationsWriteRequest,
} from "../src/front-operations-api.js";

test("operations router recognizes deep read and protected write routes", () => {
  assert.equal(isFrontOperationsPath("/api/v1/operations/summary"), true);
  assert.equal(isFrontOperationsPath("/api/v1/workflows/replay%3Arun-1/events"), true);
  assert.equal(isFrontOperationsPath("/api/v1/replays/run-1/days/2026-07-16"), true);
  assert.equal(isFrontOperationsPath("/api/v1/replays/run-1/sessions/run-2"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/workflows/run-1/actions", "POST"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/workflows/run-1/actions", "GET"), false);
});

test("operations router delegates normalized workflow IDs and filters", async () => {
  const calls = [];
  const store = {
    async listOperationsWorkflows(input) { calls.push(input); return { ok: true }; },
    async getOperationsWorkflow({ workflow_id }) { return { workflow: { id: workflow_id }, steps: [], events: [] }; },
  };
  await handleFrontOperations(store, { pathname: "/api/v1/workflows", method: "GET", query: { status: "running", strategy_id: "asia_open", limit: "25" } });
  const detail = await handleFrontOperations(store, { pathname: "/api/v1/workflows/replay%3Arun-1", method: "GET" });
  assert.deepEqual(calls[0], { kind: null, status: "running", session: null, strategyId: "asia_open", date: null, from: null, to: null, q: null, limit: 25 });
  assert.equal(detail.workflow.id, "replay:run-1");
});

test("replay creation rejects incomplete input before reaching the store", async () => {
  const store = { async createOrchestratedReplayDay() { throw new Error("must_not_be_called"); } };
  await assert.rejects(
    handleFrontOperations(store, { pathname: "/api/v1/replays", method: "POST", body: { backtest_id: "run-1" } }),
    (error) => error.code === "INVALID_REPLAY_CREATE_INPUT" && error.statusCode === 400,
  );
});
