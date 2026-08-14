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
  mockJarvisSource = readJarvisFixture(repoRoot),
} = {}) {
  const violations = [];
  const matrix = [];

  matrix.push({
    tool: "front-api:/views/jarvis-workspace",
    readWrite: "READ",
    domain: "jarvis-supervisor",
    permission: "jarvis.read",
    critical: false,
    humanGate: false,
    stepUp: false,
    brokerEffect: false,
    status: bffJarvisIsReadOnlyNotImplemented(bffSource) ? "READ_ONLY_NOT_IMPLEMENTED" : "UNVERIFIED",
  });

  if (!bffJarvisIsReadOnlyNotImplemented(bffSource)) {
    violations.push({
      area: "bff",
      reason: "JARVIS_BFF_VIEW_NOT_READ_ONLY_NOT_IMPLEMENTED",
      detail: "jarvisWorkspace must remain read-only with empty pendingActions/commands until a certified supervisor backend exists.",
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

function bffJarvisIsReadOnlyNotImplemented(source) {
  return source.includes("function jarvisWorkspace")
    && source.includes('warnings.push("jarvis-workspace:NOT_IMPLEMENTED")')
    && /pendingActions:\s*\[\]/.test(source)
    && /commands:\s*\[\]/.test(source);
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
