#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { buildReplayOutcomeRecord, replaySetupOutcome } from "../index.js";

function main() {
  try {
    const raw = readPayload();
    const payload = JSON.parse(raw || "{}");
    const clock = clockFrom(payload.clock);
    const mode = payload.mode || "record";
    const common = {
      setup: payload.setup || {},
      candles: Array.isArray(payload.candles) ? payload.candles : [],
      cutoff: payload.cutoff || null,
      meta: payload.meta || {},
      clock,
    };

    const result = mode === "raw"
      ? replaySetupOutcome(common)
      : buildReplayOutcomeRecord({
        outcome_id: payload.outcome_id,
        simulation_id: payload.simulation_id,
        step_id: payload.step_id,
        setup: common.setup,
        candles: common.candles,
        cutoff: common.cutoff,
        feed: payload.feed || null,
        meta: common.meta,
        existing: payload.existing || null,
        correction_audit_id: payload.correction_audit_id || null,
        clock,
      });

    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })}\n`);
    process.exitCode = 1;
  }
}

function readPayload() {
  const path = process.argv[2];
  if (path) return readFileSync(path, "utf8");
  return readFileSync(0, "utf8");
}

function clockFrom(value) {
  if (!value) return undefined;
  if (typeof value === "string") {
    return {
      now() {
        return tick(value, value);
      },
    };
  }
  if (typeof value === "object") {
    const utc = value.utc || value.replayed_at_utc || value.created_at_utc || new Date().toISOString();
    const paris = value.paris || value.replayed_at_paris || value.created_at_paris || utc;
    return {
      now() {
        return tick(utc, paris);
      },
    };
  }
  return undefined;
}

function tick(utc, paris) {
  const epochMs = Date.parse(utc);
  return {
    utc,
    paris,
    epochMs: Number.isFinite(epochMs) ? epochMs : Date.now(),
  };
}

main();
