#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  buildSimulationRunRegistrationV1,
  runCanonicalSimulationV1,
} from "../index.js";

const input = await readInput(process.argv[2]);
const result = runCanonicalSimulationV1(input.payload || input);
const registration = buildSimulationRunRegistrationV1({
  result,
  simulation_run_id: input.simulation_run_id,
  metadata: input.metadata,
});

process.stdout.write(`${JSON.stringify({ schema_version: "canonical_simulation_cli_result_v1", result, registration })}\n`);

async function readInput(filePath) {
  const content = filePath ? await readFile(filePath, "utf8") : await stdin();
  return JSON.parse(content);
}

function stdin() {
  return new Promise((resolve, reject) => {
    let content = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { content += chunk; });
    process.stdin.on("end", () => resolve(content));
    process.stdin.on("error", reject);
  });
}
