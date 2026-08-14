#!/usr/bin/env node
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ninjaAtiExternalEventKey, parseNinjaAtiOutgoingFile } from "@tv-automation/desk-domain";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const apiBase = String(process.env.DESK_NINJA_API_BASE_URL || "http://127.0.0.1:8787/api/v1").replace(/\/+$/, "");
const apiKey = String(process.env.DESK_MCP_API_KEY || process.env.DESK_GPT_MCP_API_KEY || "");
const bridgeId = String(process.env.DESK_NINJA_BRIDGE_ID || `ninja_ati_observer_${hostname().replace(/[^A-Za-z0-9_-]/g, "_")}`);
const brokerAccountId = String(process.env.DESK_NINJA_DEFAULT_ACCOUNT || "ninjatrader_paper_local");
const accountName = String(process.env.DESK_NINJA_ACCOUNT_NAME || "Sim101");
const bridgeMode = String(process.env.DESK_NINJA_BRIDGE_MODE || "disabled");
const outgoingRoot = process.env.DESK_NINJA_OUTGOING_ROOT ? path.resolve(process.env.DESK_NINJA_OUTGOING_ROOT) : null;
const statePath = path.resolve(process.env.DESK_NINJA_WATCHER_STATE || path.join(packageRoot, "../.local/ninjatrader/outgoing-watcher-state.json"));
const pollMs = Math.max(1_000, Math.min(Number(process.env.DESK_NINJA_OUTGOING_POLL_MS) || 2_000, 60_000));
const exchanges = csv(process.env.DESK_NINJA_EXCHANGES || "Globex,CME,NYMEX,COMEX,CBOT");
const reconciliationEnabled = args.has("--reconcile") || process.env.DESK_NINJA_RECONCILE_ENABLED === "true";
const reconciliationMode = String(process.env.DESK_BROKER_RECONCILIATION_MODE || "alert_only").toLowerCase();

assertSafeObserver();

if (args.has("--self-test")) {
  const order = parseNinjaAtiOutgoingFile({ filename: "order_intent_self_test.txt", contents: "Working;0;0", accountName });
  const position = parseNinjaAtiOutgoingFile({ filename: `MNQ 09-26 Globex_${accountName}_Position.txt`, contents: "FLAT;0;0", accountName, exchanges });
  console.log(JSON.stringify({ ok: true, submitted: false, writesToNinjaTrader: false, order, position }));
  process.exit(0);
}

if (!outgoingRoot) throw new Error("DESK_NINJA_OUTGOING_ROOT is required (NinjaTrader 8/outgoing). The watcher never guesses a Windows user directory.");
if (!outgoingRoot.replaceAll("\\", "/").toLowerCase().includes("ninjatrader 8/outgoing")) {
  throw new Error("DESK_NINJA_OUTGOING_ROOT must target a NinjaTrader 8/outgoing directory.");
}

let stopped = false;
process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });

do {
  const result = await scanOnce();
  console.log(JSON.stringify(result));
  if (args.has("--once")) break;
  await delay(pollMs);
} while (!stopped);

async function scanOnce() {
  const previous = await loadState();
  const next = { version: 1, files: { ...(previous.files || {}) }, updated_at: new Date().toISOString() };
  const parsedFiles = [];
  const names = (await readdir(outgoingRoot)).filter((name) => name.toLowerCase().endsWith(".txt")).sort();
  for (const filename of names) {
    const target = path.join(outgoingRoot, filename);
    const [contents, info] = await Promise.all([readFile(target, "utf8"), stat(target)]);
    const modifiedAt = info.mtime.toISOString();
    const parsed = parseNinjaAtiOutgoingFile({ filename, contents, observedAt: modifiedAt, accountName, exchanges });
    if (!parsed) continue;
    const key = ninjaAtiExternalEventKey({ filename, contents, modifiedAt: info.mtimeMs });
    parsedFiles.push({ parsed, key, changed: previous.files?.[filename] !== key });
  }

  const connections = parsedFiles.filter((item) => item.parsed.kind === "connection").map((item) => item.parsed);
  const ninjaConnected = connections.some((item) => item.state === "CONNECTED");
  await post("/execution/bridge/heartbeat", {
    bridgeId, brokerAccountId, mode: bridgeMode, status: "observer", hostName: hostname(), processId: process.pid,
    ninjaConnected, atiEnabled: process.env.DESK_NINJA_ATI_ENABLED === "true", accountName,
    version: "desk-ninja-ati-observer/0.1.0",
  });

  let eventsPersisted = 0;
  for (const item of parsedFiles) {
    if (!item.changed) continue;
    if (item.parsed.kind === "order") {
      const management = item.parsed.order_id.startsWith("management_intent_");
      const entry = item.parsed.order_id.startsWith("order_intent_");
      await post("/execution/bridge/events", {
        ...(management ? { managementIntentId: item.parsed.order_id } : entry ? { intentId: item.parsed.order_id } : { managementOrderRef: true }),
        externalEventKey: item.key,
        update: {
          order_id: item.parsed.order_id,
          order_state: item.parsed.status,
          filled_quantity: item.parsed.filled_quantity,
          average_fill_price: item.parsed.average_fill_price,
          occurred_at: item.parsed.observed_at,
          source: "ninjatrader_ati_outgoing",
          filename: item.parsed.filename,
        },
      });
      eventsPersisted += 1;
    }
    next.files[item.parsed.filename] = item.key;
  }

  let reconciliation = null;
  const positionChanged = parsedFiles.some((item) => item.changed && item.parsed.kind === "position");
  if (reconciliationEnabled && (positionChanged || args.has("--once"))) {
    const orders = parsedFiles
      .filter((item) => item.parsed.kind === "order" && /^(order_intent_|management_intent_)/.test(item.parsed.order_id) && !item.parsed.terminal)
      .map((item) => ({ order_id: item.parsed.order_id, status: item.parsed.status, filled_quantity: item.parsed.filled_quantity }));
    const positions = parsedFiles
      .filter((item) => item.parsed.kind === "position")
      .map((item) => ({ instrument: item.parsed.instrument, market_position: item.parsed.market_position, quantity: item.parsed.market_position === "FLAT" ? 0 : item.parsed.quantity, average_entry_price: item.parsed.average_entry_price }));
    reconciliation = await post("/execution/bridge/reconcile", {
      bridgeId,
      brokerAccountId,
      reconciliationMode,
      triggeredBy: "scheduled",
      operatorConfirmation: process.env.DESK_BROKER_RECONCILIATION_CONFIRMATION || undefined,
      brokerSnapshot: { orders, positions, account: { account_name: accountName } },
    });
  }
  await saveState(next);
  return { ok: true, submitted: false, writesToNinjaTrader: false, scanned: parsedFiles.length, eventsPersisted, ninjaConnected, reconciliation: reconciliation?.reconciliation?.status || null };
}

async function loadState() {
  try { return JSON.parse(await readFile(statePath, "utf8")); } catch { return { version: 1, files: {} }; }
}

async function saveState(state) {
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8" });
  await rename(temporary, statePath);
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

function assertSafeObserver() {
  if (!/^Sim\d*$/i.test(accountName)) throw new Error("The local ATI observer accepts Sim* accounts only.");
  if (!brokerAccountId.includes("paper")) throw new Error("The local ATI observer accepts the paper broker account only.");
  if (["live_read_only_reconciliation", "live_limited_approved_only"].includes(bridgeMode)) throw new Error("Live modes are forbidden in local PREPROD.");
}
function csv(value) { return String(value || "").split(",").map((item) => item.trim()).filter(Boolean); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
