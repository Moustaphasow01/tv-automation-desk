import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { createNinjaAddonAuthenticator, signNinjaAddonRequest } from "../src/ninja-addon-auth.js";

const args = new Set(process.argv.slice(2));
const secret = process.env.DESK_NINJA_ADDON_SHARED_SECRET || "";
const apiBase = String(process.env.DESK_NINJA_ADDON_API_BASE_URL || "http://127.0.0.1:8787/api/v1").replace(/\/+$/, "");
const bridgeId = process.env.DESK_NINJA_ADDON_ID || `addon_simulator_${hostname().replace(/[^A-Za-z0-9_.:-]/g, "_")}`;
const accountName = process.env.DESK_NINJA_ACCOUNT_NAME || "Sim101";
const brokerAccountId = process.env.DESK_NINJA_BROKER_ACCOUNT_ID || "ninjatrader_paper_local";

if (args.has("--self-test")) {
  const rawBody = JSON.stringify({ bridgeId });
  const timestamp = String(Date.now());
  const nonce = randomUUID().replaceAll("-", "");
  const pathname = "/api/v1/execution/addon/heartbeat";
  const signature = signNinjaAddonRequest({ secret: secret || "self-test-addon-secret-at-least-32-characters", method: "POST", pathname, timestamp, nonce, rawBody });
  const auth = createNinjaAddonAuthenticator({ secret: secret || "self-test-addon-secret-at-least-32-characters" });
  const result = auth.verify({ method: "POST", pathname, rawBody, headers: signedHeaders(timestamp, nonce, signature) });
  process.stdout.write(`${JSON.stringify({ ok: result.ok, signed: true, submitted: false, protocol: "desk_ninja_addon_v1" })}\n`);
  process.exit(result.ok ? 0 : 1);
}

if (!/^Sim\d*$/i.test(accountName)) throw new Error("DESK_NINJA_ACCOUNT_NAME must match Sim*.");
if (secret.length < 32) throw new Error("DESK_NINJA_ADDON_SHARED_SECRET must contain at least 32 characters.");

const now = new Date().toISOString();
const heartbeat = await post("/execution/addon/heartbeat", {
  bridgeId, brokerAccountId, mode: "sim101_addon_approved_only", status: "simulator_shadow",
  hostName: hostname(), processId: process.pid, ninjaConnected: true, commandEnabled: false,
  accountName, protocolVersion: "desk_ninja_addon_v1",
  capabilities: { simulator: true, heartbeat: true, snapshots: true, events: true, approved_commands: false },
});
const snapshot = await post("/execution/addon/snapshot", {
  bridgeId, brokerAccountId, reconcile: false, lockOnDivergence: false,
  snapshot: {
    captured_at: now,
    connection: { status: "Connected", source: "n14_simulator" },
    account: { account_name: accountName },
    orders: [], positions: [],
  },
});
const events = await post("/execution/addon/events", {
  bridgeId, brokerAccountId,
  events: [{
    event_id: `addon_event_${randomUUID().replaceAll("-", "")}`,
    event_type: "connection", occurred_at: now,
    external_event_key: `addon_simulator_${randomUUID().replaceAll("-", "")}`,
    payload: { status: "Connected", source: "n14_simulator", submitted: false },
  }],
});
const claim = args.has("--claim") ? await post("/execution/addon/claim", { bridgeId, brokerAccountId, accountName, leaseSeconds: 30 }) : null;
process.stdout.write(`${JSON.stringify({ ok: true, bridgeId, heartbeat: heartbeat.heartbeat?.status, snapshot: snapshot.snapshot?.addon_snapshot_id, parity: snapshot.parity?.status, events: events.count, claim: claim ? { status: claim.status, reason: claim.reason || null } : null, submitted: false }, null, 2)}\n`);

async function post(path, payload) {
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const nonce = randomUUID().replaceAll("-", "");
  const pathname = `/api/v1${path}`;
  const signature = signNinjaAddonRequest({ secret, method: "POST", pathname, timestamp, nonce, rawBody });
  const response = await fetch(`${apiBase}${path}`, { method: "POST", headers: { "content-type": "application/json", ...signedHeaders(timestamp, nonce, signature) }, body: rawBody });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${response.status} ${body.error || text}`);
  return body;
}

function signedHeaders(timestamp, nonce, signature) {
  return { "x-desk-addon-id": bridgeId, "x-desk-addon-timestamp": timestamp, "x-desk-addon-nonce": nonce, "x-desk-addon-signature": signature };
}
