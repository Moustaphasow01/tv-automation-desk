import { readFile } from "node:fs/promises";
import { ResearchRunner } from "@tv-automation/desk-oos-research";
import { openResearchHost } from "../src/oos-research-host.js";

// Explicit one-shot operator CLI. No TradingView connection or OOS command runtime is constructed.
const configPath = process.env.OOS_RESEARCH_CONFIG;
if (!configPath || !process.env.OOS_RESEARCH_DATABASE_URL || !process.env.OOS_FORENSIC_DATABASE_URL) {
  throw Object.assign(new Error("OOS_RESEARCH_CONFIGURATION_REQUIRED"), { code: "OOS_RESEARCH_CONFIGURATION_REQUIRED" });
}
const config = JSON.parse(await readFile(configPath, "utf8"));
const host = await openResearchHost({ config });
try {
  const research = host.api;
  const [action, text = "{}"] = process.argv.slice(2), args = JSON.parse(text);
  const actions = { start: () => research.start(args), advance: () => research.advance(args),
    status: () => research.status(args), artifacts: () => research.artifacts(args), scorecard: () => research.scorecard(args),
    experiment: () => research.experiment(args), run: () => new ResearchRunner({ api: research }).run(args,
      checkpoint => console.error(JSON.stringify({ event: "t3.research.checkpoint", ...checkpoint }))) };
  if (!Object.hasOwn(actions, action)) throw Object.assign(new Error("OOS_RESEARCH_ACTION_UNKNOWN"), { code: "OOS_RESEARCH_ACTION_UNKNOWN" });
  console.log(JSON.stringify(await actions[action](), null, 2));
} finally { await host.close(); }
