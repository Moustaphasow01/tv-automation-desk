import { readFile } from "node:fs/promises";
import path from "node:path";
import { createOosRuntime, batchDays, validateSmc3Syntax } from "@tv-automation/desk-oos-batch";
import { OosMcpConnection } from "./oos-mcp-connection.js";
import { OosTradingViewCapture, OOS_TV_TOOLS } from "./oos-tradingview-capture.js";

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
    ? { ...config.tradingview, tools: OOS_TV_TOOLS } : config.tradingview);
  const capture = config.tradingview?.adapter === "tradingview-jackson" ? new OosTradingViewCapture({ connection: tv,
    chartId: config.tradingview.chart_id, screenshotRoot: config.tradingview.screenshot_root }) : tv;
  const builder = new OosMcpConnection(config.scenario_builder);
  const validator = new OosMcpConnection(config.syntax_validator);
  const runtime = createOosRuntime({ pool, root: config.archive_root, tradingViewCall: capture.call.bind(capture),
    builderCall: args => config.scenario_builder ? builder.call("requestPlan", args) : Promise.resolve({ status: "PENDING" }),
    validatorCall: args => {
      if (config.syntax_validator === "builtin-v3.9.8") return validateSmc3Syntax(args);
      if (!config.syntax_validator) throw Object.assign(new Error("PLAN_VALIDATOR_UNCONFIGURED"), { code: "PLAN_VALIDATOR_UNCONFIGURED" });
      return validator.call("validatePlanSyntax", args);
    } });
  return { ...runtime, async close() { await Promise.all([tv.close(), builder.close(), validator.close()]); } };
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
