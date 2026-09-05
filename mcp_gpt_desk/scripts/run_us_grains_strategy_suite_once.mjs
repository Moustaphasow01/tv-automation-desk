#!/usr/bin/env node
import { createDeskStoreFromEnv } from "../src/store.js";
import { isReadOnlyGrainRun, normalizeGrainRunArgs, runUsGrainsStrategySuiteOnce } from "../src/us-grains-strategy-suite-once-runner.js";

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

async function main() {
  const args = normalizeGrainRunArgs(parseArgs(process.argv.slice(2)));
  const store = createDeskStoreFromEnv({ schemaMode: isReadOnlyGrainRun(args) ? "validate" : undefined });
  try {
    const result = await runUsGrainsStrategySuiteOnce({ store, args, nowUtc: new Date().toISOString() });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await store.persistence.close?.();
  }
}

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}
