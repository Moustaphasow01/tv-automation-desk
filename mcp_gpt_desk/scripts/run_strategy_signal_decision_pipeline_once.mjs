#!/usr/bin/env node
import { createDeskStoreFromEnv } from "../src/store.js";
import { createStrategySignalDecisionPipelineService } from "../src/strategy-signal-decision-pipeline-service.js";

const input = parseArgs(process.argv.slice(2));
const store = createDeskStoreFromEnv();

try {
  await store.persistence.initialized;
  const service = createStrategySignalDecisionPipelineService({ store });
  const result = await service.runOnce({
    now_utc: input.asOf || input.as_of || input.nowUtc || input.now_utc || new Date().toISOString(),
    limit: input.limit ? Number(input.limit) : 100,
    account_id: input.accountId || input.account_id || process.env.DESK_SHADOW_RUNTIME_ACCOUNT_ID || "shadow_live",
    source_classes: (input.sourceClasses || input.source_classes || "LIVE,SHADOW").split(",").map((item) => item.trim()).filter(Boolean),
    execution_modes: (input.executionModes || input.execution_modes || "SHADOW").split(",").map((item) => item.trim()).filter(Boolean),
    prefer_embedded_context_gate_decision: boolArg(
      input.preferEmbeddedContextGateDecision ?? input.prefer_embedded_context_gate_decision,
      process.env.DESK_STRATEGY_SIGNAL_PREFER_EMBEDDED_CONTEXT_GATE !== "false",
    ),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await store.persistence.close?.();
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, value) => value.toUpperCase());
    const next = args[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function boolArg(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (value === true || value === false) return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}
