#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import {
  parseNinjaAtiOutgoingFile,
  renderNinjaOifCommand,
  renderNinjaOifManagementCommand,
} from "@tv-automation/desk-domain";

const CONFIRMATION = "I_CONFIRM_SIM101_ONLY";
const execFileAsync = promisify(execFile);
const accountName = String(process.env.DESK_NINJA_ACCOUNT_NAME || "Sim101").trim();
const instrument = String(process.env.DESK_NINJA_MATRIX_INSTRUMENT || "MNQ 09-26").trim();
const atmStrategyName = String(process.env.DESK_NINJA_ATM_STRATEGY_NAME || "").trim();
const incomingRoot = requiredPath("DESK_NINJA_INCOMING_ROOT", process.env.DESK_NINJA_INCOMING_ROOT, "ninjatrader 8/incoming");
const outgoingRoot = requiredPath("DESK_NINJA_OUTGOING_ROOT", process.env.DESK_NINJA_OUTGOING_ROOT, "ninjatrader 8/outgoing");
const configPath = path.resolve(process.env.DESK_NINJA_CONFIG_PATH || "/mnt/c/Users/CES/Documents/NinjaTrader 8/Config.xml");
const logRoot = path.resolve(process.env.DESK_NINJA_LOG_ROOT || "/mnt/c/Users/CES/Documents/NinjaTrader 8/log");
const atmTemplateRoot = path.resolve(process.env.DESK_NINJA_ATM_TEMPLATE_ROOT || "/mnt/c/Users/CES/Documents/NinjaTrader 8/templates/AtmStrategy");
const evidenceRoot = path.resolve(process.env.DESK_NINJA_MATRIX_EVIDENCE_ROOT || path.join(process.cwd(), ".local/ninjatrader/matrix"));
const timeoutMs = boundedNumber(process.env.DESK_NINJA_MATRIX_TIMEOUT_MS, 30_000, 5_000, 120_000);
const pollMs = boundedNumber(process.env.DESK_NINJA_MATRIX_POLL_MS, 250, 100, 2_000);
const runId = `sim101_matrix_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${process.pid}`;
const results = {
  schema_version: "ninjatrader_sim101_command_matrix_v1",
  run_id: runId,
  started_at: new Date().toISOString(),
  account_name: accountName,
  instrument,
  simulation_only: true,
  live_submission: false,
  steps: [],
};

assertOperatorConfirmation();
await assertSafeRuntime();
await mkdir(evidenceRoot, { recursive: true });

let finalCleanupAttempted = false;
try {
  await deliverGlobal("CANCELALLORDERS", "preflight_cancel_all");
  await deliverGlobal("FLATTENEVERYTHING", "preflight_flatten_all");
  await waitForFlat({ optionalWhenNoPositionFile: true });

  const restingOrderId = id("resting_limit");
  await deliverPlace({
    orderId: restingOrderId,
    action: "BUY",
    quantity: 1,
    orderType: "limit",
    limitPrice: 1,
  }, "place_resting_limit");
  const workingLimit = await waitForOrder(restingOrderId, ["working", "accepted"]);
  record("PLACE_LIMIT", "passed", { order_id: restingOrderId, observed: workingLimit.parsed });

  const beforeChange = workingLimit.modifiedMs;
  await deliverManagement({ command: "CHANGE", order_id: restingOrderId, quantity: 1, limit_price: 2, stop_price: 0 }, "change_resting_limit");
  const changedLimit = await waitForOrder(restingOrderId, ["working", "accepted"], { modifiedAfter: beforeChange });
  record("CHANGE_LIMIT", "passed", { order_id: restingOrderId, observed: changedLimit.parsed });

  await deliverManagement({ command: "CANCEL", order_id: restingOrderId }, "cancel_resting_limit");
  const cancelledLimit = await waitForOrder(restingOrderId, ["cancelled"]);
  record("CANCEL", "passed", { order_id: restingOrderId, observed: cancelledLimit.parsed });

  const entryOrderId = id("market_entry");
  await deliverPlace({ orderId: entryOrderId, action: "BUY", quantity: 1, orderType: "market" }, "place_market_entry");
  const entryFill = await waitForOrder(entryOrderId, ["filled"]);
  const fillPrice = requiredPositiveNumber(entryFill.parsed.average_fill_price, "market fill price");
  const longPosition = await waitForPosition("LONG");
  record("PLACE_MARKET", "passed", { order_id: entryOrderId, fill: entryFill.parsed, position: longPosition.parsed });

  const ocoId = id("protective_oco");
  const targetOrderId = id("protective_target");
  const stopOrderId = id("protective_stop");
  await deliverPlace({
    orderId: targetOrderId,
    action: "SELL",
    quantity: 1,
    orderType: "limit",
    limitPrice: tick(fillPrice + 100),
    ocoId,
  }, "place_protective_target");
  await deliverPlace({
    orderId: stopOrderId,
    action: "SELL",
    quantity: 1,
    orderType: "stop_market",
    stopPrice: tick(fillPrice - 100),
    ocoId,
  }, "place_protective_stop");
  const [targetWorking, stopWorking] = await Promise.all([
    waitForOrder(targetOrderId, ["working", "accepted"]),
    waitForOrder(stopOrderId, ["working", "accepted"]),
  ]);
  record("PROTECTIVE_OCO", "passed", { oco_id: ocoId, target: targetWorking.parsed, stop: stopWorking.parsed });

  await deliverManagement({
    command: "CHANGE",
    order_id: stopOrderId,
    quantity: 1,
    limit_price: 0,
    stop_price: tick(fillPrice - 80),
  }, "change_protective_stop");
  const stopChanged = await waitForOrder(stopOrderId, ["working", "accepted"], { modifiedAfter: stopWorking.modifiedMs });
  record("CHANGE_STOP", "passed", { order_id: stopOrderId, observed: stopChanged.parsed });

  await deliverManagement({ command: "CANCEL", order_id: targetOrderId }, "cancel_protective_oco");
  const targetCancelled = await waitForOrder(targetOrderId, ["cancelled"]);
  record("CANCEL_OCO_LEG", "passed", { order_id: targetOrderId, observed: targetCancelled.parsed });

  await deliverManagement({ command: "CLOSEPOSITION", instrument }, "close_long_position");
  const flatAfterClose = await waitForFlat();
  record("CLOSEPOSITION", "passed", { position: flatAfterClose.parsed });

  const reverseSeedId = id("reverse_seed");
  await deliverPlace({ orderId: reverseSeedId, action: "BUY", quantity: 1, orderType: "market" }, "place_reverse_seed");
  await waitForOrder(reverseSeedId, ["filled"]);
  await waitForPosition("LONG");
  const reverseOrderId = id("reverse_to_short");
  await deliverManagement({
    command: "REVERSEPOSITION",
    instrument,
    action: "SELL",
    quantity: 1,
    order_type: "market",
    time_in_force: "DAY",
    order_id: reverseOrderId,
  }, "reverse_position");
  const reversedPosition = await waitForPosition("SHORT");
  record("REVERSEPOSITION", "passed", { order_id: reverseOrderId, position: reversedPosition.parsed });

  await deliverManagement({ command: "CLOSEPOSITION", instrument }, "close_reversed_position");
  await waitForFlat();

  if (atmStrategyName) {
    const atmEntryOrderId = id("atm_entry");
    const atmStrategyId = id("atm_strategy");
    await deliverPlace({
      orderId: atmEntryOrderId,
      action: "BUY",
      quantity: 1,
      orderType: "market",
      strategyName: atmStrategyName,
      strategyId: atmStrategyId,
    }, "place_atm_entry");
    const atmEntryFill = await waitForOrder(atmEntryOrderId, ["filled"]);
    await waitForPosition("LONG");
    const protectiveChildren = await waitForProtectiveChildren(atmEntryOrderId, atmEntryFill.modifiedMs);
    record("ATM_PROTECTIVE_CHILDREN", "passed", { strategy_id: atmStrategyId, template: atmStrategyName, children: protectiveChildren.map((item) => item.parsed) });
    await deliverManagement({ command: "CLOSESTRATEGY", strategy_id: atmStrategyId }, "close_active_strategy");
    const flatAfterStrategyClose = await waitForFlat();
    const cancelledChildren = [];
    for (const child of protectiveChildren) cancelledChildren.push((await waitForOrder(child.parsed.order_id, ["cancelled"])).parsed);
    record("CLOSESTRATEGY", "passed", {
      strategy_id: atmStrategyId,
      template: atmStrategyName,
      position: flatAfterStrategyClose.parsed,
      protective_children: cancelledChildren,
    });
  } else {
    const unusedStrategyId = id("no_active_strategy");
    await deliverManagement({ command: "CLOSESTRATEGY", strategy_id: unusedStrategyId }, "close_strategy_transport");
    record("CLOSESTRATEGY", "transport_only", {
      strategy_id: unusedStrategyId,
      reason: "No operator-validated ATM template exists locally, so no active ATM strategy was created.",
    });
  }

  await finalCleanup("success");
  results.status = atmStrategyName ? "passed" : "passed_with_close_strategy_transport_only";
} catch (error) {
  results.status = "failed";
  results.error = { message: error instanceof Error ? error.message : String(error) };
  try {
    await finalCleanup("failure");
  } catch (cleanupError) {
    results.cleanup_error = { message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) };
  }
  throw error;
} finally {
  results.finished_at = new Date().toISOString();
  results.final_cleanup_attempted = finalCleanupAttempted;
  const evidencePath = path.join(evidenceRoot, `${runId}.json`);
  await writeFile(evidencePath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: results.status?.startsWith("passed") === true, status: results.status, evidence_path: evidencePath, steps: results.steps }, null, 2));
}

async function finalCleanup(reason) {
  finalCleanupAttempted = true;
  await assertSafeRuntime();
  await deliverGlobal("CANCELALLORDERS", `final_cancel_all_${reason}`);
  await deliverGlobal("FLATTENEVERYTHING", `final_flatten_all_${reason}`);
  const flat = await waitForFlat({ optionalWhenNoPositionFile: true });
  record("FINAL_CLEANUP", "passed", { reason, position: flat?.parsed || null });
}

async function deliverPlace({ orderId, action, quantity, orderType, limitPrice = null, stopPrice = null, ocoId = "", strategyName = "", strategyId = "" }, label) {
  const command = renderNinjaOifCommand({
    order_intent_id: orderId,
    payload: {
      broker_symbol: instrument,
      action,
      quantity,
      order_type: orderType,
      limit_price: limitPrice,
      stop_price: stopPrice,
      time_in_force: "DAY",
      oco_id: ocoId,
    },
  }, { accountName, orderId, strategyName, strategyId });
  return deliver(command, label);
}

async function deliverManagement(input, label) {
  return deliver(renderNinjaOifManagementCommand(input, { accountName }), label);
}

async function deliverGlobal(commandName, label) {
  return deliver(renderNinjaOifManagementCommand({ command: commandName }, { accountName, allowGlobalCommand: true }), label);
}

async function deliver(command, label) {
  await assertSafeRuntime();
  const baseline = await countOifLogEntries(command);
  const filename = `oif_${safe(label)}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}.txt`;
  const target = path.join(incomingRoot, filename);
  await retryFileOperation(() => writeFile(target, command, { encoding: "utf8", flag: "wx" }), `Unable to create ${filename} for NinjaTrader`);
  await waitUntil(async () => (await countOifLogEntries(command)) > baseline, `NinjaTrader did not log processing for ${filename}`);
  let retained = false;
  try { await unlink(target); } catch (error) { retained = error?.code !== "ENOENT"; }
  record("OIF_DELIVERY", "processed", { label, filename, retained_until_ninja_shutdown: retained, command: redactCommand(command) });
  return { filename, command };
}

async function countOifLogEntries(command) {
  const needle = `OIF, '${String(command || "").trim()}' processing`;
  const names = (await readdir(logRoot)).filter((name) => /^log\.\d+\.\d+\.txt$/i.test(name));
  let count = 0;
  for (const filename of names) {
    const contents = await readFile(path.join(logRoot, filename), "utf8");
    let from = 0;
    while ((from = contents.indexOf(needle, from)) >= 0) {
      count += 1;
      from += needle.length;
    }
  }
  return count;
}

async function retryFileOperation(operation, failureMessage) {
  const deadline = Date.now() + Math.min(timeoutMs, 15_000);
  let lastError = null;
  while (Date.now() < deadline) {
    try { return await operation(); } catch (error) { lastError = error; }
    await delay(pollMs);
  }
  throw new Error(`${failureMessage}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function waitForOrder(orderId, acceptedStatuses, { modifiedAfter = 0 } = {}) {
  return waitUntil(async () => {
    const candidates = [path.join(outgoingRoot, `${accountName}_${orderId}.txt`), path.join(outgoingRoot, `${orderId}.txt`)];
    const target = (await firstExisting(candidates));
    if (!target) return null;
    const [contents, info] = await Promise.all([readFile(target, "utf8"), stat(target)]);
    const parsed = parseNinjaAtiOutgoingFile({ filename: path.basename(target), contents, accountName, observedAt: info.mtime.toISOString() });
    if (!parsed || info.mtimeMs <= modifiedAfter) return null;
    if (["rejected", "error", "expired"].includes(parsed.status)) throw new Error(`${orderId} reached ${parsed.status}: ${parsed.raw}`);
    return acceptedStatuses.includes(parsed.status) ? { parsed, modifiedMs: info.mtimeMs } : null;
  }, `${orderId} did not reach ${acceptedStatuses.join("/")}`);
}

async function firstExisting(targets) {
  for (const target of targets) if (await exists(target)) return target;
  return null;
}

async function waitForPosition(expected, options = {}) {
  return waitUntil(async () => {
    const positions = await positionSnapshots();
    const matching = positions.find((item) => canonicalInstrument(item.parsed.instrument) === canonicalInstrument(instrument));
    if (!matching && options.optionalWhenNoPositionFile) return { parsed: null, modifiedMs: 0 };
    return matching?.parsed.market_position === expected ? matching : null;
  }, `${instrument} did not reach position ${expected}`);
}

async function waitForProtectiveChildren(entryOrderId, modifiedAfter) {
  return waitUntil(async () => {
    const names = (await readdir(outgoingRoot)).filter((name) => name.toLowerCase().startsWith(`${accountName.toLowerCase()}_`) && name.toLowerCase().endsWith(".txt"));
    const children = [];
    for (const filename of names) {
      const target = path.join(outgoingRoot, filename);
      const [contents, info] = await Promise.all([readFile(target, "utf8"), stat(target)]);
      if (info.mtimeMs <= modifiedAfter) continue;
      const parsed = parseNinjaAtiOutgoingFile({ filename, contents, accountName, observedAt: info.mtime.toISOString() });
      if (parsed?.kind === "order" && parsed.order_id !== entryOrderId && ["working", "accepted"].includes(parsed.status)) children.push({ parsed, modifiedMs: info.mtimeMs });
    }
    return children.length >= 2 ? children.slice(0, 2) : null;
  }, `ATM strategy ${atmStrategyName} did not create two protective child orders`);
}

async function waitForFlat(options = {}) {
  return waitForPosition("FLAT", options);
}

async function positionSnapshots() {
  const names = (await readdir(outgoingRoot)).filter((name) => name.toLowerCase().endsWith(`_${accountName.toLowerCase()}_position.txt`));
  const parsed = [];
  for (const filename of names) {
    const target = path.join(outgoingRoot, filename);
    const [contents, info] = await Promise.all([readFile(target, "utf8"), stat(target)]);
    const event = parseNinjaAtiOutgoingFile({ filename, contents, accountName, observedAt: info.mtime.toISOString() });
    if (event?.kind === "position") parsed.push({ parsed: event, modifiedMs: info.mtimeMs });
  }
  return parsed;
}

async function assertSafeRuntime() {
  if (!/^Sim\d*$/i.test(accountName)) throw new Error(`Simulation account required, received ${accountName}.`);
  const config = await readFile(configPath, "utf8");
  requireXmlValue(config, "IsAtiEnabled", "true");
  requireXmlValue(config, "IsGlobalSimulationMode", "true");
  requireXmlValue(config, "StartInGlobalSimulationMode", "true");
  requireXmlValue(config, "DefaultAccount", accountName);
  if (!/<AccountType>Simulation<\/AccountType>/i.test(config)) throw new Error("No Simulation connection account type was found in NinjaTrader Config.xml.");
  if (atmStrategyName) {
    if (!/^[A-Za-z0-9_-]+$/.test(atmStrategyName)) throw new Error("The ATM template name contains unsafe characters.");
    const template = await readFile(path.join(atmTemplateRoot, `${atmStrategyName}.xml`), "utf8");
    if (!/<DefaultQuantity>1<\/DefaultQuantity>/i.test(template) || !/<Quantity>1<\/Quantity>/i.test(template)) throw new Error("The matrix ATM template must be fixed to one contract.");
    if (!/<StopLoss>[1-9]\d*<\/StopLoss>/i.test(template) || !/<Target>[1-9]\d*<\/Target>/i.test(template)) throw new Error("The matrix ATM template requires a positive stop and target.");
    if (!/<ReverseAtStop>false<\/ReverseAtStop>/i.test(template) || !/<ReverseAtTarget>false<\/ReverseAtTarget>/i.test(template)) throw new Error("ATM auto-reversal is forbidden in the matrix.");
  }
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", "if (Get-Process NinjaTrader -ErrorAction SilentlyContinue) { 'RUNNING' }"], { timeout: 5_000, windowsHide: true });
  if (!String(stdout || "").includes("RUNNING")) throw new Error("NinjaTrader is not running.");
  const connectionFiles = (await readdir(outgoingRoot)).filter((name) => name.toLowerCase().endsWith(".txt"));
  let connected = false;
  for (const filename of connectionFiles) {
    const contents = await readFile(path.join(outgoingRoot, filename), "utf8");
    const parsed = parseNinjaAtiOutgoingFile({ filename, contents, accountName });
    if (parsed?.kind === "connection" && parsed.state === "CONNECTED") connected = true;
  }
  if (!connected) throw new Error("No CONNECTED NinjaTrader connection was observed in outgoing files.");
  if (process.env.DESK_NINJA_NO_LIVE_CONNECTIONS_CONFIRMED !== "true") throw new Error("DESK_NINJA_NO_LIVE_CONNECTIONS_CONFIRMED=true is required.");
}

function assertOperatorConfirmation() {
  if (process.env.DESK_NINJA_MATRIX_CONFIRMATION !== CONFIRMATION) throw new Error(`DESK_NINJA_MATRIX_CONFIRMATION=${CONFIRMATION} is required.`);
}

async function waitUntil(check, failureMessage) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
      break;
    }
    await delay(pollMs);
  }
  throw lastError || new Error(`${failureMessage} within ${timeoutMs}ms.`);
}

function record(command, status, details = {}) {
  results.steps.push({ sequence: results.steps.length + 1, at: new Date().toISOString(), command, status, details });
}

function redactCommand(command) {
  const fields = String(command || "").trim().split(";");
  if (fields[1] && !/^Sim\d*$/i.test(fields[1])) fields[1] = "[BLOCKED_NON_SIM]";
  return fields.join(";");
}

function id(label) {
  return `${runId}_${safe(label)}`.slice(0, 48);
}

function safe(value) {
  return String(value || "unknown").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
}

function tick(value) {
  return Math.round(Number(value) / 0.25) * 0.25;
}

function canonicalInstrument(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+(GLOBEX|CME|NYMEX|COMEX|CBOT)$/i, "");
}

function requiredPositiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`A positive ${label} is required, received ${value}.`);
  return parsed;
}

function requireXmlValue(xml, element, expected) {
  const match = String(xml).match(new RegExp(`<${element}>([^<]*)<\\/${element}>`, "i"));
  if (!match || match[1].trim().toLowerCase() !== String(expected).trim().toLowerCase()) {
    throw new Error(`NinjaTrader ${element} must equal ${expected}.`);
  }
}

function requiredPath(name, value, expectedFragment) {
  if (!value) throw new Error(`${name} is required.`);
  const resolved = path.resolve(value);
  if (!resolved.replaceAll("\\", "/").toLowerCase().includes(expectedFragment)) throw new Error(`${name} must target ${expectedFragment}.`);
  return resolved;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

async function exists(target) {
  try { await stat(target); return true; } catch { return false; }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
