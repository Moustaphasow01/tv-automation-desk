#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { auditMarketDataLatency } from "../src/market-data-latency-audit.js";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("usage: node scripts/audit_market_data_latency.mjs INPUT_JSON OUTPUT_JSON");
if (resolve(inputPath) === resolve(outputPath)) throw new Error("input_and_output_paths_must_differ");
const inputBytes = await readFile(inputPath);
const input = JSON.parse(inputBytes.toString("utf8"));
if (!Array.isArray(input.candles) || !Array.isArray(input.signals)) throw new Error("input_requires_candles_and_signals_arrays");
const inputHash = createHash("sha256").update(inputBytes).digest("hex");
const report = auditMarketDataLatency({ candles: input.candles, signals: input.signals, asOfUtc: input.asOf || null, inputHash });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: outputPath, input_hash: report.input_hash, groups: report.latency_by_date_instrument_timeframe.length, signal_rows: report.signal_cohort.rows.length }));
