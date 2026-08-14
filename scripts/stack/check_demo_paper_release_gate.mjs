#!/usr/bin/env node
import { SystemClock } from "../../packages/desk-time/index.js";
import { evaluateDemoPaperGate, fetchStatus } from "./check_demo_paper_gate.mjs";
import { buildDemoPaperDiagnosis, deriveExecutionOverviewUrl } from "./diagnose_demo_paper_readiness.mjs";
import { runVNextOperatorE2E } from "./check_vnext_operator_e2e.mjs";
import { isCliEntrypoint } from "../runtime/cli-entrypoint.mjs";

const DEFAULT_STATUS_URL = "http://127.0.0.1:8787/status";
const DEFAULT_VNEXT_BASE_URL = "http://127.0.0.1:8090";

export function parseDemoPaperReleaseGateArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    statusUrl: env.DESK_STATUS_URL || DEFAULT_STATUS_URL,
    vnextBaseUrl: env.DESK_VNEXT_BASE_URL || DEFAULT_VNEXT_BASE_URL,
    executionOverviewUrl: env.DESK_EXECUTION_OVERVIEW_URL || "",
    operatorPin: env.DESK_OPERATOR_ADMIN_PIN || env.DESK_OAUTH_ADMIN_PIN || "",
    output: "pretty",
    exitZero: false,
  };

  for (const arg of argv) {
    if (arg === "--json") {
      options.output = "json";
    } else if (arg === "--exit-zero") {
      options.exitZero = true;
    } else if (arg.startsWith("--status-url=")) {
      options.statusUrl = arg.slice("--status-url=".length);
    } else if (arg.startsWith("--vnext-base-url=")) {
      options.vnextBaseUrl = arg.slice("--vnext-base-url=".length);
    } else if (arg.startsWith("--execution-overview-url=")) {
      options.executionOverviewUrl = arg.slice("--execution-overview-url=".length);
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export async function runDemoPaperReleaseGate({
  statusUrl = DEFAULT_STATUS_URL,
  vnextBaseUrl = DEFAULT_VNEXT_BASE_URL,
  executionOverviewUrl = "",
  operatorPin = "",
  fetchImpl = fetch,
} = {}) {
  const checkedAt = new SystemClock().now().utc;
  const status = await fetchStatus(statusUrl, { fetchImpl });
  const demoPaper = evaluateDemoPaperGate(status, { profile: "demo-paper" });
  demoPaper.status_url = statusUrl;
  const overview = await fetchJson(executionOverviewUrl || deriveExecutionOverviewUrl(statusUrl), { fetchImpl });
  const demoPaperDiagnosis = buildDemoPaperDiagnosis({ status, overview, gate: demoPaper });
  const vnextOperator = await runVNextOperatorE2E({
    baseUrl: vnextBaseUrl,
    pin: operatorPin,
    fetchImpl,
  });
  return combineReleaseGate({
    checkedAt,
    statusUrl,
    vnextBaseUrl,
    demoPaper,
    demoPaperDiagnosis,
    vnextOperator,
  });
}

export function combineReleaseGate({ checkedAt, statusUrl, vnextBaseUrl, demoPaper, demoPaperDiagnosis = null, vnextOperator }) {
  const blockers = [
    ...componentBlockers("demo-paper", demoPaper.blockers || []),
    ...componentBlockers("vnext-operator", vnextOperator.blockers || []),
  ];
  const warnings = [
    ...componentBlockers("demo-paper", demoPaper.warnings || []),
    ...componentBlockers("vnext-operator", vnextOperator.warnings || []),
  ];
  const actions = [
    ...componentActions("demo-paper", demoPaperDiagnosis?.actions || []),
    ...componentActions("vnext-operator", vnextOperator.actions || []),
  ];

  return {
    ok: blockers.length === 0,
    status: blockers.length === 0 ? "READY" : "BLOCKED",
    checked_at_utc: checkedAt,
    status_url: statusUrl,
    vnext_base_url: vnextBaseUrl,
    blockers,
    warnings,
    actions,
    components: {
      demo_paper: {
        ok: demoPaper.ok === true,
        status: demoPaper.ok === true ? "READY" : "BLOCKED",
        blockers: (demoPaper.blockers || []).map((blocker) => blocker.id),
        warnings: (demoPaper.warnings || []).map((warning) => warning.id),
        actions: (demoPaperDiagnosis?.actions || []).map((action) => action.id || action.title),
      },
      vnext_operator: {
        ok: vnextOperator.ok === true,
        status: vnextOperator.status || (vnextOperator.ok ? "READY" : "BLOCKED"),
        blockers: (vnextOperator.blockers || []).map((blocker) => blocker.id),
        checks: (vnextOperator.checks || []).map((check) => ({ id: check.id, ok: check.ok })),
      },
    },
    final_decision: blockers.length === 0
      ? "OPEN_DEMO_PAPER_AGENTS_ALLOWED"
      : "KEEP_AGENTS_CLOSED_OR_SHADOW",
  };
}

function componentBlockers(component, blockers) {
  return blockers.map((blocker) => ({
    component,
    id: blocker.id,
    detail: blocker.detail || null,
  }));
}

function componentActions(component, actions) {
  return actions.map((action) => ({
    component,
    id: action.id || safeActionId(action.title),
    title: action.title || action.id || "Action requise",
    severity: action.severity || "blocker",
    evidence: action.evidence || action.detail || null,
    action: action.action || action.detail || null,
    command: action.command || null,
  }));
}

function safeActionId(value) {
  return String(value || "action_required")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "action_required";
}

async function fetchJson(url, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Execution overview endpoint returned HTTP ${response.status}`);
  }
  return response.json();
}

function formatReleaseGate(gate) {
  const lines = [];
  lines.push(`Demo PAPER release gate: ${gate.status}`);
  lines.push(`decision=${gate.final_decision}`);
  lines.push(`status_url=${gate.status_url}`);
  lines.push(`vnext_base_url=${gate.vnext_base_url}`);
  lines.push("");
  lines.push("Components:");
  lines.push(`- demo-paper: ${gate.components.demo_paper.status}`);
  lines.push(`- vnext-operator: ${gate.components.vnext_operator.status}`);
  if (gate.blockers.length) {
    lines.push("");
    lines.push("Blockers:");
    for (const blocker of gate.blockers) {
      lines.push(`- ${blocker.component}.${blocker.id}`);
    }
  }
  if (gate.actions.length) {
    lines.push("");
    lines.push("Actions opérateur:");
    for (const [index, action] of gate.actions.entries()) {
      lines.push(`${index + 1}. ${action.title}`);
      if (action.evidence) lines.push(`   preuve: ${action.evidence}`);
      if (action.action) lines.push(`   action: ${action.action}`);
      if (action.command) lines.push(`   diagnostic: ${action.command}`);
    }
  }
  return lines.join("\n");
}

function printUsage() {
  console.log([
    "Usage: node scripts/stack/check_demo_paper_release_gate.mjs [--json] [--exit-zero]",
    "",
    "Options:",
    "  --status-url=http://127.0.0.1:8787/status",
    "  --vnext-base-url=http://127.0.0.1:8090",
    "  --execution-overview-url=http://127.0.0.1:8787/api/v1/execution/overview",
    "",
    "Environment:",
    "  DESK_OPERATOR_ADMIN_PIN or DESK_OAUTH_ADMIN_PIN is required for the VNext operator sub-gate.",
  ].join("\n"));
}

async function main() {
  const options = parseDemoPaperReleaseGateArgs();
  if (options.help) {
    printUsage();
    return;
  }
  const gate = await runDemoPaperReleaseGate(options);
  if (options.output === "json") {
    console.log(JSON.stringify(gate, null, 2));
  } else {
    console.log(formatReleaseGate(gate));
  }
  if (!gate.ok && !options.exitZero) process.exitCode = 1;
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(`Demo PAPER release gate failed: ${error.message}`);
    process.exitCode = 1;
  });
}
