#!/usr/bin/env node
import { mkdir, rename, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { renderNinjaOifCommand } from "@tv-automation/desk-domain";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const mode = String(process.env.DESK_NINJA_BRIDGE_MODE || "disabled");
const accountName = String(process.env.DESK_NINJA_ACCOUNT_NAME || "Sim101");
const bridgeId = String(process.env.DESK_NINJA_BRIDGE_ID || `ninja_bridge_${hostname().replace(/[^A-Za-z0-9_-]/g, "_")}`);
const apiBase = String(process.env.DESK_NINJA_API_BASE_URL || "http://127.0.0.1:8787/api/v1").replace(/\/+$/, "");
const apiKey = String(process.env.DESK_MCP_API_KEY || process.env.DESK_GPT_MCP_API_KEY || "");
const dryRunRoot = path.resolve(process.env.DESK_NINJA_DRY_RUN_ROOT || path.join(packageRoot, "../.local/ninjatrader/dry-run"));
const incomingRoot = process.env.DESK_NINJA_INCOMING_ROOT ? path.resolve(process.env.DESK_NINJA_INCOMING_ROOT) : null;
const atmStrategyName = String(process.env.DESK_NINJA_ATM_STRATEGY_NAME || "").trim();
const pollMs = Math.max(1_000, Math.min(Number(process.env.DESK_NINJA_POLL_MS) || 5_000, 60_000));
const execFileAsync = promisify(execFile);

assertSafeMode();

if (args.has("--self-test")) {
  const command = renderNinjaOifCommand({
    order_intent_id: "self_test_no_submit",
    payload: { broker_symbol: "MNQ 09-26", action: "BUY", quantity: 1, order_type: "limit", limit_price: 30000, time_in_force: "DAY" },
  }, { accountName: "Sim101" });
  const file = await atomicWrite(dryRunRoot, "self_test_no_submit.txt", command);
  console.log(JSON.stringify({ ok: true, mode: "dry_run_file", submitted: false, file }));
  process.exit(0);
}

if (mode === "disabled") {
  await heartbeat({ ninjaConnected: false, atiEnabled: false });
  console.log(JSON.stringify({ ok: true, status: "DISABLED", bridgeId }));
  process.exit(0);
}

let stopped = false;
process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });

do {
  const runtime = await detectNinjaRuntime();
  await heartbeat(runtime);
  if (mode.startsWith("sim101_") && (!runtime.ninjaConnected || !runtime.atiEnabled)) {
    console.log(JSON.stringify({ ok: true, status: "WAITING_MANUAL_NINJA_ARM", processRunning: runtime.processRunning, ninjaConnected: runtime.ninjaConnected, atiEnabled: runtime.atiEnabled }));
    if (args.has("--once")) break;
    await delay(pollMs);
    continue;
  }
  const claim = await post("/execution/bridge/claim", { bridgeId, accountName, leaseSeconds: 30 });
  if (claim.status === "CLAIMED" && claim.work) await executeWork(claim.work);
  else if (args.has("--once")) console.log(JSON.stringify({ ok: true, status: claim.status, reason: claim.reason || null }));
  if (args.has("--once")) break;
  await delay(pollMs);
} while (!stopped);

async function executeWork(work) {
  const runtime = await detectNinjaRuntime();
  if (mode.startsWith("sim101_") && (!runtime.processRunning || !runtime.ninjaConnected || !runtime.atiEnabled)) {
    throw new Error("NinjaTrader process, confirmed connection and ATI confirmation are required immediately before delivery.");
  }
  const management = work.work_type === "management";
  const command = management
    ? String(work.rendered_command || work.command_payload?.rendered_command || "")
    : mode.startsWith("sim101_ati_")
    ? renderNinjaOifCommand({ ...work.command_payload, order_intent_id: work.order_intent_id }, {
      accountName,
      strategyName: atmStrategyName,
      strategyId: String(work.command_payload?.atm_strategy_id || `desk_${safe(work.order_intent_id)}`).slice(0, 48),
    })
    : String(work.rendered_command || "");
  validateSimCommand(command, management ? work.command_payload?.action : "entry");
  const workId = management ? work.management_intent_id : work.order_intent_id;
  const filename = `oif_${safe(workId)}_${Date.now()}.txt`;
  if (mode === "dry_run_file") {
    const file = await atomicWrite(dryRunRoot, filename, command);
    await complete(work, "rendered", { renderedCommand: command });
    console.log(JSON.stringify({ ok: true, status: "DRY_RUN_RENDERED", submitted: false, file, workType: work.work_type || "entry", intentId: workId }));
    return;
  }
  if (!incomingRoot) throw new Error("DESK_NINJA_INCOMING_ROOT is required for Sim101 ATI submission.");
  const normalized = incomingRoot.replaceAll("\\", "/").toLowerCase();
  if (!normalized.includes("ninjatrader 8/incoming")) throw new Error("Ninja incoming path must target a NinjaTrader 8/incoming directory.");
  const file = await atomicWrite(incomingRoot, filename, command);
  await complete(work, "delivered", { renderedCommand: command });
  console.log(JSON.stringify({ ok: true, status: "SIM101_DELIVERED", file, workType: work.work_type || "entry", intentId: workId }));
}

async function detectNinjaRuntime() {
  if (mode === "disabled" || mode === "dry_run_file") return { processRunning: false, ninjaConnected: false, atiEnabled: false };
  let processRunning = false;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", "if (Get-Process NinjaTrader -ErrorAction SilentlyContinue) { 'RUNNING' }"], { timeout: 5_000, windowsHide: true });
    processRunning = String(stdout || "").includes("RUNNING");
  } catch {
    processRunning = false;
  }
  return {
    processRunning,
    ninjaConnected: processRunning && process.env.DESK_NINJA_CONFIRMED_CONNECTED === "true",
    atiEnabled: processRunning && process.env.DESK_NINJA_ATI_ENABLED === "true",
  };
}

async function heartbeat({ ninjaConnected, atiEnabled }) {
  return post("/execution/bridge/heartbeat", {
    bridgeId,
    mode,
    status: mode === "disabled" ? "offline" : "starting",
    hostName: hostname(),
    processId: process.pid,
    ninjaConnected,
    atiEnabled,
    accountName,
    version: "desk-ninja-bridge/0.1.0",
  });
}

async function complete(work, status, extra = {}) {
  return post("/execution/bridge/complete", {
    bridgeId,
    outboxId: work.work_type === "management" ? work.management_outbox_id : work.execution_outbox_id,
    workType: work.work_type || "entry",
    leaseToken: work.lease_token,
    status,
    ...extra,
  });
}

async function post(endpoint, body) {
  const response = await fetch(`${apiBase}${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}`, "x-desk-api-key": apiKey } : {}) },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || `${endpoint} returned ${response.status}`);
  return payload;
}

async function atomicWrite(directory, filename, contents) {
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, filename);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
  await rename(temporary, target);
  return target;
}

function assertSafeMode() {
  if (!/^Sim\d*$/i.test(accountName)) throw new Error("Only NinjaTrader simulation accounts (Sim*) are accepted locally.");
  if (["live_read_only_reconciliation", "live_limited_approved_only"].includes(mode)) throw new Error("Live NinjaTrader modes are forbidden in the local PREPROD bridge.");
  if (!["disabled", "dry_run_file", "sim101_ati_manual_arm", "sim101_ati_approved_only", "sim101_addon_approved_only"].includes(mode)) throw new Error(`Unsupported bridge mode: ${mode}`);
  if (mode.startsWith("sim101_") && process.env.DESK_BROKER_EXECUTION_ENABLED !== "true") throw new Error("DESK_BROKER_EXECUTION_ENABLED=true is required for Sim101 delivery.");
  if (mode.startsWith("sim101_") && process.env.DESK_NINJA_KILL_SWITCH !== "false") throw new Error("DESK_NINJA_KILL_SWITCH=false is required for Sim101 delivery.");
  if (mode.startsWith("sim101_ati_") && !atmStrategyName) throw new Error("DESK_NINJA_ATM_STRATEGY_NAME is required: ATI entries must use an operator-validated protective ATM template.");
  if (mode === "sim101_addon_approved_only") throw new Error("The ATI file bridge cannot execute AddOn mode. Use the dedicated signed AddOn adapter.");
}
function safe(value) { return String(value || "unknown").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80); }
function validateSimCommand(command, action) {
  const prefix = String(command || "").split(";", 1)[0];
  const expected = action === "move_stop" ? ["CHANGE"]
    : action === "close_position" ? ["CLOSEPOSITION", "CLOSESTRATEGY"]
    : ["PLACE"];
  if (!expected.includes(prefix)) throw new Error(`Bridge refuses ${prefix || "an empty command"} for ${action}.`);
  const fields = String(command).split(";");
  if (["PLACE", "CLOSEPOSITION"].includes(prefix) && !/^Sim\d*$/i.test(String(fields[1] || ""))) throw new Error("Bridge refuses a non-Sim OIF command.");
  if (["CHANGE", "CLOSESTRATEGY"].includes(prefix) && !/^Sim\d*$/i.test(accountName)) throw new Error("Bridge refuses management outside a Sim account context.");
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
