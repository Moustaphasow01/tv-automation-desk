#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDeskStoreFromEnv } from "../src/store.js";
import { runStrategyRuntimeWindowReplay } from "../src/strategy-runtime-window-replay.js";

const input = parseArgs(process.argv.slice(2));
if (input.help || input.h) {
  process.stdout.write(`Usage:
  node scripts/replay_strategy_runtime_window_optimized.mjs --start-utc 2026-08-21T00:00:00Z --end-utc 2026-08-21T01:00:00Z [options]

Options:
  --run-id <id>                 Certification replay run id.
  --instruments MNQ,MES         Instrument scope.
  --execution-modes SHADOW      Execution mode scope.
  --runtime-states RUNNING      Runtime state scope.
  --persist-signals true|false  Publish found signals to the canonical signal bus.
  --run-pipeline true|false     Run Context/Risk/Target/OrderIntent/Human Gate on published certification signals.
  --record-evaluations true|false
  --limit <n>                   Strategy instance limit.
  --json-out <path>             Write the full result JSON.
  --markdown-out <path>         Write a compact operator report.
`);
  process.exit(0);
}

const store = createDeskStoreFromEnv();
try {
  const result = await runStrategyRuntimeWindowReplay({ store, input });
  if (input.jsonOut || input.json_out) await writeJson(input.jsonOut || input.json_out, result);
  if (input.markdownOut || input.markdown_out) await writeMarkdown(input.markdownOut || input.markdown_out, result);
  process.stdout.write(`${JSON.stringify(compactResult(result), null, 2)}\n`);
} finally {
  await store.persistence.close?.();
}

function compactResult(result) {
  return {
    status: result.status,
    run_id: result.run_id,
    window: result.window,
    instances_seen: result.instances_seen,
    replayed_instance_days: result.replayed_instance_days,
    cutoff_evaluations_virtual: result.cutoff_evaluations_virtual,
    setup_count: result.setup_count,
    signal_count: result.signal_count,
    published_signal_count: result.published_signal_count,
    pipeline_run_count: result.pipeline_run_count,
    pipeline_human_gate_count: result.pipeline_human_gate_count,
    total_r: result.total_r,
    by_instrument: result.by_instrument,
    by_day: result.by_day,
  };
}

async function writeJson(file, value) {
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeMarkdown(file, result) {
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, markdownReport(result), "utf8");
}

function markdownReport(result) {
  const lines = [
    "# Strategy Runtime Window Replay",
    "",
    `- Status: ${result.status}`,
    `- Run ID: ${result.run_id}`,
    `- Window: ${result.window.start_utc} → ${result.window.end_utc}`,
    `- Instances seen: ${result.instances_seen}`,
    `- Replayed instance-days: ${result.replayed_instance_days}`,
    `- Virtual cutoff evaluations: ${result.cutoff_evaluations_virtual}`,
    `- Setups compiled: ${result.setup_count}`,
    `- Signals: ${result.signal_count}`,
    `- Published signals: ${result.published_signal_count}`,
    `- Pipeline runs: ${result.pipeline_run_count}`,
    `- Human gates: ${result.pipeline_human_gate_count}`,
    `- Total theoretical R: ${result.total_r}`,
    "",
    "## By instrument",
    "",
    ...Object.entries(result.by_instrument || {}).map(([instrument, row]) => `- ${instrument}: ${row.signal_count} signals, ${row.total_r} R`),
    "",
    "## By day",
    "",
    ...Object.entries(result.by_day || {}).map(([day, row]) => `- ${day}: ${row.signal_count} signals, ${row.total_r} R`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, value) => value.toUpperCase());
    const next = args[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
