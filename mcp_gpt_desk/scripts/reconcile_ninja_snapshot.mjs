#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";

const snapshotPath = process.argv[2];
if (!snapshotPath) throw new Error("Usage: node scripts/reconcile_ninja_snapshot.mjs <snapshot.json>");
const brokerSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
const apiBase = String(process.env.DESK_NINJA_API_BASE_URL || "http://127.0.0.1:8787/api/v1").replace(/\/+$/, "");
const apiKey = String(process.env.DESK_MCP_API_KEY || process.env.DESK_GPT_MCP_API_KEY || "");
const response = await fetch(`${apiBase}/execution/bridge/reconcile`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}`, "x-desk-api-key": apiKey } : {}) },
  body: JSON.stringify({
    bridgeId: process.env.DESK_NINJA_BRIDGE_ID || "ninja_bridge_local",
    brokerAccountId: process.env.DESK_NINJA_DEFAULT_ACCOUNT || "ninjatrader_paper_local",
    brokerSnapshot,
  }),
});
const payload = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(payload.message || payload.error || `reconciliation returned ${response.status}`);
console.log(JSON.stringify(payload, null, 2));
