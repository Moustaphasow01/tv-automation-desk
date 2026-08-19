#!/usr/bin/env node
import process from "node:process";
import { createDeskStoreFromEnv } from "../src/store.js";
import { bootstrapDataDrivenMegaResearchBatch } from "../src/research/data-driven-mega-research-batch.js";

const store = createDeskStoreFromEnv();

try {
  await store.persistence.initialized;
  const result = await bootstrapDataDrivenMegaResearchBatch({
    store,
    input: parseArgs(process.argv.slice(2)),
    actor: { kind: "cli", email: "local-operator" },
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await store.persistence.close?.();
}

function parseArgs(args) {
  const input = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, value) => value.toUpperCase());
    const next = args[index + 1];
    if (!next || next.startsWith("--")) input[key] = true;
    else {
      input[key] = next;
      index += 1;
    }
  }
  return input;
}
