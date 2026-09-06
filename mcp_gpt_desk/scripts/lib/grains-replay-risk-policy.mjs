import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { resolveStrategySignalRiskBudget } from "../../src/strategy-signal-risk-policy.js";

export async function loadGrainsReplayRiskPolicy(path, environment = process.env) {
  if (!path) {
    const accountId = "causal-replay-shadow";
    const budget = resolveStrategySignalRiskBudget({ environment, accountId });
    const allocationPolicy = parseAllocationPolicy({ conflict_resolution: environment.DESK_SHADOW_PORTFOLIO_SELECTION_POLICY || "NET_BY_DIRECTION" });
    return { accountId, pipelinePolicy: { risk_budget: budget, allocation_policy: allocationPolicy }, provenance: {
      source: "PINNED_LOCAL_CONFIGURATION_NOT_VPS_CERTIFIED", sha256: hash(JSON.stringify({ budget, allocationPolicy })), budget,
      allocation_policy: allocationPolicy,
    } };
  }
  const sourceText = await readFile(path, "utf8");
  return parseGrainsReplayRiskPolicy(sourceText, path);
}

export function parseGrainsReplayRiskPolicy(sourceText, path) {
  const source = JSON.parse(sourceText);
  if (source?.schema_version !== "grains_risk_replay_policy_v1") throw new Error("REPLAY_RISK_POLICY_SCHEMA_INVALID");
  const allowed = new Set(["schema_version", "policy_id", "account_id", "risk_budget", "allocation_policy", "account_capital_reference", "provenance"]);
  if (Object.keys(source).some(key => !allowed.has(key))) throw new Error("REPLAY_RISK_POLICY_FIELD_NOT_ALLOWED");
  if (!source.policy_id || typeof source.account_id !== "string" || !source.account_id.trim()) throw new Error("REPLAY_RISK_POLICY_IDENTITY_REQUIRED");
  if (!source.risk_budget) throw new Error("REPLAY_RISK_BUDGET_REQUIRED");
  const budget = resolveStrategySignalRiskBudget({ input: { risk_budget: source.risk_budget }, accountId: source.account_id });
  const allocationPolicy = parseAllocationPolicy(source.allocation_policy);
  return {
    accountId: source.account_id,
    pipelinePolicy: { risk_budget: budget, allocation_policy: allocationPolicy,
      account_capital_reference: source.account_capital_reference },
    provenance: { source: "EXPLICIT_REPLAY_POLICY_NOT_VPS_CONFIGURATION", path: path ? resolve(path) : null,
      policy_id: source.policy_id, sha256: hash(sourceText), budget,
      allocation_policy: allocationPolicy, operator_provenance: source.provenance || null },
  };
}

function parseAllocationPolicy(value) {
  if (value === undefined) return { conflict_resolution: "NET_BY_DIRECTION" };
  if (!value || Array.isArray(value) || typeof value !== "object"
    || Object.keys(value).some(key => key !== "conflict_resolution")
    || !["NET_BY_DIRECTION", "BEST_COMPLETE_PLAN_V1"].includes(value.conflict_resolution)) {
    throw new Error("REPLAY_ALLOCATION_POLICY_INVALID");
  }
  return { conflict_resolution: value.conflict_resolution };
}

function hash(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
