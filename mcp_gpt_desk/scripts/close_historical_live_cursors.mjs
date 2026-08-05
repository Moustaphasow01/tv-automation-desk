#!/usr/bin/env node
import process from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createDeskStoreFromEnv } from "../src/store.js";

const CURSOR_COLLECTION = "desk_live_run_cursor";
const EVENT_COLLECTION = "desk_agent_work_events";
const args = parseArgs(process.argv.slice(2));
const store = createDeskStoreFromEnv();

try {
  await store.persistence.initialized;
  const tick = store.clock.now();
  const cutoff = args.before || tick.paris.slice(0, 10);
  const cursors = await store.persistence.listDocuments(CURSOR_COLLECTION, 500);
  const selected = cursors
    .filter((cursor) => String(cursor.trading_date || "") < cutoff)
    .filter((cursor) => cursor.cursor_status !== "CLOSED")
    .sort((left, right) => String(left.cursor_id).localeCompare(String(right.cursor_id)));

  if (args.expectedCount != null && selected.length !== args.expectedCount) {
    throw new Error(`HISTORICAL_CURSOR_COUNT_MISMATCH:expected=${args.expectedCount}:actual=${selected.length}`);
  }

  const backupPath = resolve(args.backup || `./historical-live-cursors-${tick.epochMs}.json`);
  await mkdir(dirname(backupPath), { recursive: true });
  await writeFile(backupPath, `${JSON.stringify({
    schema_version: "historical_live_cursor_backup_v1",
    captured_at_utc: tick.utc,
    cutoff_trading_date: cutoff,
    cursor_count: selected.length,
    cursors: selected,
  }, null, 2)}\n`, "utf8");

  if (!args.apply) {
    output({ ok: true, status: "DRY_RUN", cutoff, count: selected.length, backup_path: backupPath, cursor_ids: selected.map((item) => item.cursor_id) });
    process.exitCode = 0;
  } else {
    const expiresAtUtc = new Date(tick.epochMs + 90 * 24 * 60 * 60 * 1000).toISOString();
    const closed = [];
    for (const selectedCursor of selected) {
      const outcome = await store.persistence.transitionLiveCursor({
        cursorCollection: CURSOR_COLLECTION,
        eventCollection: EVENT_COLLECTION,
        cursorId: selectedCursor.cursor_id,
        transition: (current) => {
          if (String(current.trading_date || "") >= cutoff || current.cursor_status === "CLOSED") {
            return { cursor: current, result: { status: "SKIPPED" }, events: [], dead_letters: [] };
          }
          const leaseExpiry = Date.parse(current.attempt?.lease_expires_at_utc || "");
          if (current.cursor_status === "LEASED" && Number.isFinite(leaseExpiry) && leaseExpiry > tick.epochMs) {
            throw new Error(`HISTORICAL_CURSOR_ACTIVE_LEASE:${current.cursor_id}`);
          }
          const previousStatus = current.cursor_status;
          const cursor = {
            ...current,
            cursor_status: "CLOSED",
            closed_at_utc: current.closed_at_utc || tick.utc,
            expires_at_utc: current.expires_at_utc || expiresAtUtc,
            closure_reason: "historical_cursor_cleanup",
            closed_by: "operator",
            updated_at_utc: tick.utc,
          };
          const event = {
            event_id: `${cursor.cursor_id}__cursor_closed__${tick.epochMs}`,
            scope: "live",
            cursor_id: cursor.cursor_id,
            work_item_id: null,
            run_id: cursor.run_id,
            workflow: cursor.attempt?.workflow || null,
            checkpoint: cursor.attempt?.checkpoint || cursor.target_checkpoint || null,
            event_type: "CURSOR_CLOSED",
            cursor_status: "CLOSED",
            at_utc: tick.utc,
            details: {
              reason: "historical_cursor_cleanup",
              operator_requested: true,
              previous_cursor_status: previousStatus,
              cutoff_trading_date: cutoff,
            },
          };
          return { cursor, result: { status: "CLOSED" }, events: [event], dead_letters: [] };
        },
      });
      if (outcome.result?.status === "CLOSED") closed.push(selectedCursor.cursor_id);
    }
    output({ ok: true, status: "APPLIED", cutoff, selected: selected.length, closed: closed.length, backup_path: backupPath, cursor_ids: closed });
  }
} finally {
  await store.persistence.close?.();
}

function parseArgs(values) {
  const parsed = {
    apply: false,
    before: null,
    expectedCount: null,
    backup: null,
  };
  for (const value of values) {
    if (value === "--apply") parsed.apply = true;
    else if (value.startsWith("--before=")) parsed.before = value.slice("--before=".length);
    else if (value.startsWith("--expected-count=")) parsed.expectedCount = Number(value.slice("--expected-count=".length));
    else if (value.startsWith("--backup=")) parsed.backup = value.slice("--backup=".length);
    else throw new Error(`UNKNOWN_ARGUMENT:${value}`);
  }
  if (parsed.before && !/^\d{4}-\d{2}-\d{2}$/.test(parsed.before)) throw new Error("INVALID_BEFORE_DATE");
  if (parsed.expectedCount != null && (!Number.isInteger(parsed.expectedCount) || parsed.expectedCount < 0)) {
    throw new Error("INVALID_EXPECTED_COUNT");
  }
  return parsed;
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
