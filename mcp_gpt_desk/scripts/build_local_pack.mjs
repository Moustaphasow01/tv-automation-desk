#!/usr/bin/env node
import { createDeskStoreFromEnv } from "../src/store.js";

const args = parseArgs(process.argv.slice(2));
const store = createDeskStoreFromEnv();

try {
  const date = required(args.date, "--date");
  const session = args.session || "asia_open";
  const purpose = args.purpose || "replay_source";
  const cutoffParis = required(args["cutoff-paris"] || args["end-paris"], "--cutoff-paris");
  const result = await store.localPacks.build({
    date,
    session,
    purpose,
    cutoffUtc: new Date(cutoffParis).toISOString(),
    cutoffParis,
    packId: args["pack-id"] || null,
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await store.persistence.close?.();
}

function parseArgs(values) {
  const output = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    output[key] = next && !next.startsWith("--") ? values[++index] : true;
  }
  return output;
}

function required(value, name) {
  if (value === null || value === undefined || value === "") {
    throw new Error(`Missing required argument ${name}`);
  }
  return value;
}
