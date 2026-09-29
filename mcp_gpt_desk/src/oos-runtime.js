import { readFile } from "node:fs/promises";
import path from "node:path";
import { createOosRuntime, batchDays } from "@tv-automation/desk-oos-batch";
import { OosMcpConnection } from "./oos-mcp-connection.js";

const instances = new WeakMap();
export async function getOosRuntime(store) {
  if (!process.env.OOS_BATCH_CONFIG) throw Object.assign(new Error("OOS_NOT_CONFIGURED"), { code: "OOS_NOT_CONFIGURED", statusCode: 503 });
  if (!instances.has(store)) instances.set(store, assemble(store.persistence.pool).catch(error => { instances.delete(store); throw error; }));
  return instances.get(store);
}

export async function assemble(pool) {
  const config = JSON.parse(await readFile(process.env.OOS_BATCH_CONFIG, "utf8"));
  if (!path.isAbsolute(config.archive_root || "")) throw Object.assign(new Error("OOS_ARCHIVE_ROOT_REQUIRED"), { code: "OOS_ARCHIVE_ROOT_REQUIRED" });
  const tv = new OosMcpConnection(config.tradingview);
  const builder = new OosMcpConnection(config.scenario_builder);
  const validator = new OosMcpConnection(config.syntax_validator);
  const runtime = createOosRuntime({ pool, root: config.archive_root, tradingViewCall: tv.call.bind(tv),
    builderCall: args => builder.call("requestPlan", args), validatorCall: args => validator.call("validatePlanSyntax", args) });
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
