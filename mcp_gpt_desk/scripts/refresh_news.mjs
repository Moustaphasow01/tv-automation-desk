#!/usr/bin/env node
import process from "node:process";
import { createDeskStoreFromEnv } from "../src/store.js";

const store = createDeskStoreFromEnv();

try {
  await store.persistence.initialized;
  const result = await store.refreshNews({
    requested_by: process.env.DESK_NEWS_REQUESTED_BY || "manual_refresh_script",
    force: process.argv.includes("--force"),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally {
  await store.persistence.close?.();
}
