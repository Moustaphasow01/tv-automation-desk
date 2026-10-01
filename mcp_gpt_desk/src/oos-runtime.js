import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createOosRuntime, batchDays, validateSmc3Syntax, createPremarketOrchestration, createOosRuntimeContracts } from "@tv-automation/desk-oos-batch";
import { readOosInstalledEngine } from "./oos-tradingview-contract-source.js";
import { OosMcpConnection } from "./oos-mcp-connection.js";
import { OosTradingViewCapture, OOS_TV_TOOLS } from "./oos-tradingview-capture.js";
import { OosTradingViewReplay, OOS_REPLAY_TOOLS } from "./oos-tradingview-replay.js";

const instances = new WeakMap();
export async function getOosRuntime(store) {
  if (!process.env.OOS_BATCH_CONFIG) throw Object.assign(new Error("OOS_NOT_CONFIGURED"), { code: "OOS_NOT_CONFIGURED", statusCode: 503 });
  if (!instances.has(store)) instances.set(store, assemble(store.persistence.pool).catch(error => { instances.delete(store); throw error; }));
  return instances.get(store);
}

export async function assemble(pool) {
  const config = JSON.parse(await readFile(process.env.OOS_BATCH_CONFIG, "utf8"));
  if (!path.isAbsolute(config.archive_root || "")) throw Object.assign(new Error("OOS_ARCHIVE_ROOT_REQUIRED"), { code: "OOS_ARCHIVE_ROOT_REQUIRED" });
  const tv = new OosMcpConnection(config.tradingview?.adapter === "tradingview-jackson"
    ? { ...config.tradingview, tools: { ...OOS_TV_TOOLS, ...OOS_REPLAY_TOOLS } } : config.tradingview);
  const capture = config.tradingview?.adapter === "tradingview-jackson" ? new OosTradingViewCapture({ connection: tv,
    chartId: config.tradingview.chart_id, screenshotRoot: config.tradingview.screenshot_root }) : tv;
  const provider = config.tradingview?.adapter === "tradingview-jackson"
    ? await import(new URL("./connection.js", pathToFileURL(config.tradingview.args[0]))) : null;
  const bridge = provider ? new OosTradingViewReplay({ capture, provider }) : capture;
  const builder = new OosMcpConnection(config.scenario_builder);
  const validator = new OosMcpConnection(config.syntax_validator);
  const runtime = createOosRuntime({ pool, root: config.archive_root, tradingViewCall: bridge.call.bind(bridge),
    builderCall: args => config.scenario_builder ? builder.call("requestPlan", args) : Promise.resolve({ status: "PENDING" }),
    validatorCall: args => {
      if (config.syntax_validator === "builtin-v3.9.8") return validateSmc3Syntax(args);
      if (!config.syntax_validator) throw Object.assign(new Error("PLAN_VALIDATOR_UNCONFIGURED"), { code: "PLAN_VALIDATOR_UNCONFIGURED" });
      return validator.call("validatePlanSyntax", args);
    } });
  const preparations = createPremarketOrchestration({ batches: runtime.batches,
    batchId: config.batch_id, symbol: config.symbol, cutoffTime: config.cutoff_time,
    requestedConcurrency: Number(process.env.OOS_CAPTURE_CONCURRENCY || config.capture_concurrency || 1) });
  const contracts = await createOosRuntimeContracts({ readInstalled: () => readOosInstalledEngine(capture) });
  return { ...runtime, preparations, contracts, async close() { await Promise.all([tv.close(), builder.close(), validator.close(), provider?.disconnect()]); } };
}

export async function runOosBatch(runtime, input) {
  const days = batchDays(input);
  const rows = [];
  for (const day of days) {
    try { rows.push(await runtime.workflow.execute(day, input.action || "run")); }
    catch (error) { rows.push({ definition: day, state: "FAILED_TECHNICAL", error: { code: error.code || "OOS_COMMAND_FAILED" } }); }
  }
  return rows;
}
