import assert from "node:assert/strict";
import test from "node:test";

import { callDeskTool, createDeskToolRegistry, listDeskTools } from "../src/tools.js";

function createStore() {
  const calls = [];
  return {
    calls,
    async getDataset(args) {
      calls.push(args);
      return { ok: true, ...args, rows: [] };
    },
    async logTool() {},
  };
}

const baseArgs = {
  pack_id: "pack-row-order",
  pack_build_id: "packbuild-row-order",
  dataset: "MNQ_M5",
  as_of_utc: "2026-07-16T10:00:00.000Z",
};

test("get_dataset V2 defaults to oldest_first and advertises both row orders", async () => {
  const store = createStore();
  const tools = createDeskToolRegistry(store);
  const definition = listDeskTools(tools).find((tool) => tool.name === "get_dataset");

  assert.deepEqual(definition.inputSchema.properties.row_order, {
    type: "string",
    enum: ["oldest_first", "latest_first"],
    default: "oldest_first",
  });

  const result = await callDeskTool(tools, "get_dataset", baseArgs);
  assert.equal(result.isError, false);
  assert.equal(store.calls[0].row_order, "oldest_first");
});

test("get_dataset V2 forwards latest_first and rejects unknown row orders", async () => {
  const store = createStore();
  const tools = createDeskToolRegistry(store);

  const latest = await callDeskTool(tools, "get_dataset", {
    ...baseArgs,
    row_order: "latest_first",
  });
  assert.equal(latest.isError, false);
  assert.equal(store.calls[0].row_order, "latest_first");

  const invalid = await callDeskTool(tools, "get_dataset", {
    ...baseArgs,
    row_order: "newest",
  });
  assert.equal(invalid.isError, true);
  assert.equal(store.calls.length, 1);
});
