import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { candlesToRowsBySymbol } from "../src/grains-causal-detection-audit.js";
import {
  CONTEXT_ONLY_HUMAN_GATE,
  replayUsGrainsContextTheoretical,
} from "../src/us-grains-context-theoretical-replay.js";
import { captureGrainsSourceManifest } from "./lib/grains-source-manifest.mjs";

export async function runUsGrainsContextTheoreticalReplayCli(
  argv = process.argv.slice(2),
) {
  const args = parseArgs(argv);
  const inputPath = requiredPath(args.input, "--input");
  const outputPath = requiredPath(args.output, "--output");
  const startDate = requiredDate(args.start, "--start");
  const endDate = requiredDate(args.end, "--end");
  const asOfUtc = requiredTimestamp(args.asOf, "--as-of");
  if (startDate > endDate || asOfUtc.slice(0, 10) < endDate)
    throw new Error("REPLAY_WINDOW_INVALID");
  const instruments = (args.instruments || "ZW,ZC")
    .split(",")
    .map((value) => value.trim().toUpperCase());
  if (!instruments.every((value) => ["ZW", "ZC"].includes(value)))
    throw new Error("GRAIN_INSTRUMENT_REQUIRED");
  if (resolve(inputPath) === resolve(outputPath))
    throw new Error("INPUT_AND_OUTPUT_MUST_DIFFER");
  const inputText = await readFile(inputPath, "utf8");
  const replayInput = normalizedReplayInput(parseSource(inputText));
  const report = replayUsGrainsContextTheoretical({
    ...replayInput,
    startDate,
    endDate,
    asOfUtc,
    instruments,
  });
  const artifact = {
    schema_version: "us_grains_context_theoretical_replay_cli_v1",
    report_title: CONTEXT_ONLY_HUMAN_GATE,
    replay_mode: "OFFLINE_CONTEXT_THEORETICAL",
    manifest: await manifest({
      inputText,
      startDate,
      endDate,
      asOfUtc,
      instruments,
    }),
    report,
  };
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2)
    values[argv[index]] = argv[index + 1];
  return {
    input: values["--input"],
    output: values["--output"],
    start: values["--start"],
    end: values["--end"],
    asOf: values["--as-of"],
    instruments: values["--instruments"],
  };
}

function requiredPath(value, name) {
  if (!value || String(value).startsWith("--"))
    throw new Error(`REQUIRED_ARGUMENT:${name}`);
  return String(value);
}

function requiredDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || "")))
    throw new Error(`VALID_DATE_REQUIRED:${name}`);
  return String(value);
}

function requiredTimestamp(value, name) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed))
    throw new Error(`VALID_TIMESTAMP_REQUIRED:${name}`);
  return new Date(parsed).toISOString();
}

async function manifest({
  inputText,
  startDate,
  endDate,
  asOfUtc,
  instruments,
}) {
  return {
    input_sha256: hash(inputText),
    dependency_sha256: await captureGrainsSourceManifest(),
    start_date: startDate,
    end_date: endDate,
    as_of_utc: asOfUtc,
    instruments,
  };
}

function parseSource(inputText) {
  try {
    const source = JSON.parse(inputText);
    if (!source || typeof source !== "object" || Array.isArray(source))
      throw new Error("source is not an object");
    return source;
  } catch {
    throw new Error("OFFLINE_REPLAY_SOURCE_INVALID");
  }
}

function normalizedReplayInput(source) {
  if (hasRowsBySymbol(source))
    return {
      ...source,
      agriEvents: validEvents(source.agriEvents || source.agri_events),
    };
  const frozen = source.ledgerFrozen || source.ledger_frozen || source;
  if (
    !Array.isArray(frozen.candles) ||
    !Array.isArray(frozen.agriEvents || frozen.agri_events)
  ) {
    throw new Error("OFFLINE_REPLAY_SOURCE_INVALID");
  }
  const rowsBySymbol = candlesToRowsBySymbol(frozen.candles);
  if (!hasM5Rows(rowsBySymbol))
    throw new Error("OFFLINE_REPLAY_FROZEN_CANDLES_UNUSABLE");
  return {
    ...source,
    rowsBySymbol,
    agriEvents: validEvents(frozen.agriEvents || frozen.agri_events),
    agriCalendarCoverage: frozen.agriCalendarCoverage || [],
  };
}

function hasRowsBySymbol(source) {
  if (
    !source.rowsBySymbol ||
    typeof source.rowsBySymbol !== "object" ||
    Array.isArray(source.rowsBySymbol)
  )
    return false;
  if (!Object.values(source.rowsBySymbol).every(Array.isArray))
    throw new Error("OFFLINE_REPLAY_SOURCE_INVALID");
  if (!hasM5Rows(source.rowsBySymbol))
    throw new Error("OFFLINE_REPLAY_ROWS_BY_SYMBOL_M5_REQUIRED");
  return true;
}

function hasM5Rows(rowsBySymbol) {
  return Object.entries(rowsBySymbol).some(
    ([key, rows]) =>
      String(key).toUpperCase().endsWith(":5") && rows.length > 0,
  );
}

function validEvents(events) {
  if (!Array.isArray(events)) throw new Error("OFFLINE_REPLAY_SOURCE_INVALID");
  return events;
}

function hash(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const artifact = await runUsGrainsContextTheoreticalReplayCli();
  process.stdout.write(
    `${JSON.stringify({ report_title: artifact.report_title, output: "written" })}\n`,
  );
}
