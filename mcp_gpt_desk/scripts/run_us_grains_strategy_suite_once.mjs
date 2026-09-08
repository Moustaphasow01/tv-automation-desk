#!/usr/bin/env node
import { createDeskStoreFromEnv } from "../src/store.js";
import { grainsDataPolicyFromEnvironment } from "../src/runtime-config.js";
import {
  createDeploymentProducerClient,
  runWithDeploymentProducerAdmission,
} from "../src/persistence/postgres-deployment-producer-admission.js";
import { isReadOnlyGrainRun, normalizeGrainRunArgs, runUsGrainsStrategySuiteOnce } from "../src/us-grains-strategy-suite-once-runner.js";

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

async function main() {
  const args = normalizeGrainRunArgs(parseArgs(process.argv.slice(2)));
  args["data-policy"] ||= grainsDataPolicyFromEnvironment();
  const client = createDeploymentProducerClient({
    connectionString: process.env.DATABASE_URL,
    applicationName: "desk-us-grains-strategy-suite",
  });
  const outcome = await runWithDeploymentProducerAdmission(client, async () => {
    process.env.DESK_DATABASE_APPLICATION_NAME = "desk-us-grains-strategy-suite-work";
    const store = createDeskStoreFromEnv({ schemaMode: isReadOnlyGrainRun(args) ? "validate" : undefined });
    try {
      return await runUsGrainsStrategySuiteOnce({ store, args, nowUtc: new Date().toISOString() });
    } finally { await store.persistence.close?.(); }
  });
  console.log(JSON.stringify(outcome.executed ? outcome.value : outcome, null, 2));
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
