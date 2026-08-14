#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FRONT_COMMAND_CATALOG } from "../../mcp_gpt_desk/src/front-control-plane-command.js";
import { MCP_TOOL_SLICES } from "../../mcp_gpt_desk/src/mcp-tool-slices.js";

const BROKER_AUTHORITY_PATTERN = /\b(broker|providercommand|provider_command|ninja|ninjatrader|tradovate|rithmic|pickmytrade|live\.enable|auto\.enable|human_gate\.confirm|order\.submit|position\.open)\b/i;
const FORBIDDEN_JARVIS_COMMAND_PATTERN = /\b(broker|provider|ninja|ninjatrader|tradovate|rithmic|pickmytrade|order_intent\.confirm|human_gate|order\.submit|position\.open|auto\.enable|live\.enable)\b/i;

export function checkJarvisAuthority({
  repoRoot = process.cwd(),
  commandCatalog = FRONT_COMMAND_CATALOG,
  mcpSlices = MCP_TOOL_SLICES,
  bffSource = readIfExists(path.join(repoRoot, "mcp_gpt_desk/src/front-control-plane-api.js")),
  jarvisProjectionSource = readIfExists(path.join(repoRoot, "mcp_gpt_desk/src/front-jarvis-projection.js")),
  assistantRuntimeSource = readIfExists(path.join(repoRoot, "mcp_gpt_desk/src/domain-assistant-runtime-service.js")),
  assistantSqlSource = readIfExists(path.join(repoRoot, "infra/postgres/init/055_domain_assistant_runtime.sql")),
  mockJarvisSource = readJarvisFixture(repoRoot),
} = {}) {
  const violations = [];
  const matrix = [];
  const jarvisAuthority = bffJarvisAuthorityStatus({ bffSource, jarvisProjectionSource, assistantRuntimeSource, assistantSqlSource });

  matrix.push({
    tool: "front-api:/views/jarvis-workspace",
    readWrite: "READ",
    domain: "jarvis-supervisor",
    permission: "jarvis.read",
    critical: false,
    humanGate: false,
    stepUp: false,
    brokerEffect: false,
    status: jarvisAuthority.status,
  });

  if (!jarvisAuthority.ok) {
    violations.push({
      area: "bff",
      reason: "JARVIS_BFF_VIEW_NOT_CERTIFIED_READ_ONLY",
      detail: jarvisAuthority.reason,
    });
  }

  for (const [commandType, definition] of Object.entries(commandCatalog || {})) {
    matrix.push({
      tool: `front-command:${commandType}`,
      readWrite: definition?.mutation ? "WRITE" : "READ",
      domain: commandDomain(commandType),
      permission: definition?.capability || "UNKNOWN",
      critical: commandType.startsWith("execution."),
      humanGate: commandType === "execution.order_intent.confirm" || commandType === "execution.order_intent.reject",
      stepUp: definition?.capability === "execution.paper",
      brokerEffect: definition?.brokerExecution === true,
      status: definition?.brokerExecution === true ? "BROKER_EFFECT" : "NO_DIRECT_BROKER_EFFECT",
    });

    if (definition?.brokerExecution === true) {
      violations.push({
        area: "front-command",
        tool: commandType,
        reason: "FRONT_COMMAND_BROKER_EXECUTION_FORBIDDEN",
      });
    }

    if (commandType.startsWith("jarvis.")) {
      violations.push({
        area: "front-command",
        tool: commandType,
        reason: "JARVIS_COMMAND_NOT_CERTIFIED",
      });
    }
  }

  for (const commandType of jarvisFixtureCommandTypes(mockJarvisSource)) {
    matrix.push({
      tool: `jarvis-fixture-action:${commandType}`,
      readWrite: "WRITE_REQUEST_FIXTURE",
      domain: commandDomain(commandType),
      permission: "fixture-only",
      critical: false,
      humanGate: true,
      stepUp: false,
      brokerEffect: false,
      status: "TEST_FIXTURE_ONLY",
    });

    if (FORBIDDEN_JARVIS_COMMAND_PATTERN.test(commandType)) {
      violations.push({
        area: "jarvis-fixture",
        tool: commandType,
        reason: "JARVIS_FIXTURE_FORBIDDEN_COMMAND_TYPE",
      });
    }
  }

  for (const slice of mcpSlices || []) {
    for (const toolName of allSliceTools(slice)) {
      const readWrite = inferredMcpReadWrite(toolName);
      const brokerEffect = BROKER_AUTHORITY_PATTERN.test(toolName);
      matrix.push({
        tool: `mcp:${toolName}`,
        readWrite,
        domain: slice.key,
        permission: readWrite === "READ" ? "desk.read" : "desk.write",
        critical: ["gpt-work.lifecycle", "agent-runtime.admin", "analysis.legacy-documents", "replay.autopilot"].includes(slice.key),
        humanGate: false,
        stepUp: readWrite !== "READ",
        brokerEffect,
        status: brokerEffect ? "FORBIDDEN_AUTHORITY_MATCH" : "NO_DIRECT_BROKER_EFFECT",
      });

      if (brokerEffect) {
        violations.push({
          area: "mcp",
          tool: toolName,
          reason: "MCP_TOOL_BROKER_AUTHORITY_PATTERN",
          slice: slice.key,
        });
      }
    }
  }

  return {
    ok: violations.length === 0,
    matrix,
    summary: {
      matrixRows: matrix.length,
      frontCommands: Object.keys(commandCatalog || {}).length,
      mcpTools: (mcpSlices || []).reduce((sum, slice) => sum + allSliceTools(slice).length, 0),
      jarvisFixtureActions: jarvisFixtureCommandTypes(mockJarvisSource).length,
      violations: violations.length,
    },
    violations,
  };
}

function bffJarvisAuthorityStatus({ bffSource, jarvisProjectionSource, assistantRuntimeSource, assistantSqlSource }) {
  const projectionSource = jarvisProjectionSource || bffSource;
  if (!projectionSource.includes("function jarvisWorkspace")) {
    return { ok: false, status: "MISSING", reason: "jarvisWorkspace projection is missing from the certified BFF projection source." };
  }

  const readOnlyView = /pendingActions:\s*\[\]/.test(projectionSource)
    && /commands:\s*\[\]/.test(projectionSource)
    && /voice:\s*\{[\s\S]*?serviceStatus:\s*"OFF"/.test(projectionSource);

  if (!readOnlyView) {
    return { ok: false, status: "WRITE_SURFACE_EXPOSED", reason: "jarvisWorkspace must expose empty pendingActions/commands and disabled voice until sensitive actions are certified." };
  }

  if (bffSource.includes('warnings.push("jarvis-workspace:NOT_IMPLEMENTED")')) {
    return { ok: true, status: "READ_ONLY_NOT_IMPLEMENTED", reason: "" };
  }

  if (!bffSource.includes("jarvisWorkspace")) {
    return { ok: false, status: "BFF_ROUTE_NOT_WIRED", reason: "BFF source does not wire the certified jarvisWorkspace projection." };
  }

  const requiredProfiles = [
    "assistant_research",
    "assistant_live_runtime",
    "assistant_portfolio_risk",
    "assistant_execution",
    "assistant_data",
    "assistant_platform_ops",
  ];
  const missingBffProfiles = requiredProfiles.filter((profileId) => !projectionSource.includes(profileId));
  const missingRuntimeProfiles = requiredProfiles.filter((profileId) => !assistantRuntimeSource.includes(profileId));

  if (missingBffProfiles.length || missingRuntimeProfiles.length) {
    return {
      ok: false,
      status: "ASSISTANT_PROFILE_DRIFT",
      reason: `Jarvis BFF/runtime profile mismatch. Missing in BFF: ${missingBffProfiles.join(",") || "none"}; missing in runtime: ${missingRuntimeProfiles.join(",") || "none"}.`,
    };
  }

  const runtimeReadOnly = assistantRuntimeSource.includes("DEFAULT_DOMAIN_ASSISTANT_PROFILES")
    && assistantRuntimeSource.includes("requireReadOnlyProfile")
    && assistantRuntimeSource.includes("forbiddenActionCodes")
    && assistantRuntimeSource.includes("forbidden_actions")
    && assistantRuntimeSource.includes("can_create_provider_command: false")
    && assistantRuntimeSource.includes("can_confirm_human_gate: false")
    && assistantRuntimeSource.includes("can_activate_live: false")
    && assistantRuntimeSource.includes("can_activate_auto_execution: false");

  if (!runtimeReadOnly) {
    return { ok: false, status: "ASSISTANT_RUNTIME_NOT_READ_ONLY", reason: "DomainAssistantRuntimeService does not prove read-only profiles and forbidden sensitive actions." };
  }

  const sqlReadOnly = assistantSqlSource.includes("assistant_profiles_read_only_default")
    && assistantSqlSource.includes("assistant_tasks_no_sensitive_bypass")
    && assistantSqlSource.includes("can_create_provider_command")
    && assistantSqlSource.includes("can_confirm_human_gate")
    && assistantSqlSource.includes("activate_live")
    && assistantSqlSource.includes("activate_auto_execution");

  if (!sqlReadOnly) {
    return { ok: false, status: "ASSISTANT_SQL_NOT_READ_ONLY", reason: "Assistant SQL migration does not prove read-only and no sensitive bypass constraints." };
  }

  return { ok: true, status: "READ_ONLY_CERTIFIED", reason: "" };
}

function jarvisFixtureCommandTypes(source) {
  const block = source.match(/export const jarvisWorkspaceView:[\s\S]+?export const operationsQueueView:/)?.[0] || "";
  return [...block.matchAll(/commandType:\s*["']([^"']+)["']/g)].map((match) => match[1]);
}

function readJarvisFixture(repoRoot) {
  return readIfExists(path.join(repoRoot, "apps/desk-control-plane/src/mocks/canonicalDataset.ts"));
}

function readIfExists(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

function allSliceTools(slice) {
  return [...new Set(Object.values(slice.tools || {}).flatMap((tools) => tools || []))].sort();
}

function inferredMcpReadWrite(toolName) {
  return /^(get|list|peek|desk_ping)/.test(toolName) ? "READ" : "WRITE";
}

function commandDomain(commandType) {
  return String(commandType || "").split(".")[0] || "unknown";
}

function runCli() {
  const result = checkJarvisAuthority();
  if (result.ok) {
    console.log(JSON.stringify({
      ok: true,
      summary: result.summary,
      matrix_sample: result.matrix.slice(0, 12),
    }, null, 2));
    return;
  }

  console.error("JARVIS_AUTHORITY_GUARD_FAILED");
  console.error(JSON.stringify({ ok: false, summary: result.summary, violations: result.violations }, null, 2));
  process.exitCode = 1;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
