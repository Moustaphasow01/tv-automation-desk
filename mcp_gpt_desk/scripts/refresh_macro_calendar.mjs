#!/usr/bin/env node
import { createDeskStoreFromEnv } from "../src/store.js";

const store = createDeskStoreFromEnv();
const anchorDate = process.argv.find((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
const force = process.argv.includes("--force");

try {
  const result = await store.refreshMacroCalendar({
    anchor_date: anchorDate,
    requested_by: "macro_calendar_cli",
    force,
  });
  console.log(JSON.stringify(result));
  if (result.status === "FETCH_FAILED") process.exitCode = 1;
} finally {
  await store.persistence.close?.();
}
