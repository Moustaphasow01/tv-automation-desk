#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  auditCausalDetection,
  inputSha256,
} from "../src/grains-causal-detection-audit.js";
import { detectUsGrainsStrategySignals } from "../src/us-grains-strategy-suite.js";
import { captureGrainsSourceManifest } from "./lib/grains-source-manifest.mjs";

const args = parseArgs(process.argv.slice(2));
const inputPath = required(args.input);
const outputPath = required(args.output);
if (resolve(inputPath) === resolve(outputPath))
  throw new Error("Input and output must differ.");
const bytes = await readFile(resolve(inputPath));
const source = JSON.parse(bytes);
const startDate = args.start || args.startDate;
const endDate = args.end || args.endDate;
if (
  !/^\d{4}-\d{2}-\d{2}$/.test(startDate || "") ||
  !/^\d{4}-\d{2}-\d{2}$/.test(endDate || "")
) {
  throw new Error("--start and --end must be YYYY-MM-DD.");
}
const codeHashes = await captureGrainsSourceManifest();
const report = auditCausalDetection({
  source: { ...source, input_sha256: inputSha256(bytes) },
  detect: detectUsGrainsStrategySignals,
  startDate,
  endDate,
  codeHashes,
});
await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(
  resolve(outputPath),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
console.log(
  JSON.stringify(
    {
      input_sha256: report.input.input_sha256,
      detector: report.detector,
      invariance: report.invariance,
      legacy_comparison: report.legacy_comparison,
    },
    null,
    2,
  ),
);

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index].startsWith("--")
      ? args[index].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      : null;
    if (!key) continue;
    result[key] = args[index + 1];
    index += 1;
  }
  return result;
}

function required(value) {
  if (!value) throw new Error("--input and --output are required.");
  return value;
}
