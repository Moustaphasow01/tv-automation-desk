import { createDeskStoreFromEnv } from "../src/store.js";
import { prepareDueLiveMonitorBundle } from "../src/live-orchestration.js";

const args = parseArgs(process.argv.slice(2));
const now = args.nowUtc || Date.now();
const session = args.session || "asia_open";
const store = createDeskStoreFromEnv();

const result = await prepareDueLiveMonitorBundle(store, {
  session,
  trading_date: args.tradingDate,
  timestamp_paris: args.timestampParis,
  as_of_utc: args.asOfUtc,
  mode: args.mode || "live",
  include_raw_refs: args.includeRawRefs !== "false",
  save: args.save !== "false",
  force_rebuild: args.forceRebuild === true || args.forceRebuild === "true",
}, { now });
console.log(JSON.stringify(result, null, 2));

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    result[key] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
  }
  return result;
}
