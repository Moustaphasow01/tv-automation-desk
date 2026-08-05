#!/usr/bin/env node
import process from "node:process";
import { createDeskStoreFromEnv } from "../src/store.js";
import {
  parseV5FrozenQuiesceArgs,
  quiesceV5FrozenState,
} from "../src/v5-frozen-quiesce.js";

const options = parseV5FrozenQuiesceArgs(process.argv.slice(2), process.env);
const store = createDeskStoreFromEnv();
try {
  await store.persistence.initialized;
  const result = await quiesceV5FrozenState(store.persistence.pool, options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await store.persistence.close?.();
}
