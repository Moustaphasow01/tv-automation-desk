import { createHash } from "node:crypto";
import path from "node:path";

const TERMINAL_ORDER_STATES = new Set(["filled", "cancelled", "rejected", "expired", "error"]);

export function parseNinjaAtiOutgoingFile({ filename, contents, observedAt = new Date().toISOString(), accountName = "Sim101", exchanges = [] } = {}) {
  const name = path.basename(String(filename || ""));
  const stem = name.replace(/\.txt$/i, "");
  const raw = String(contents ?? "").replace(/^\uFEFF/, "").trim();
  if (!name.toLowerCase().endsWith(".txt") || !raw) return null;

  if (/_Position$/i.test(stem)) {
    const suffix = `_${accountName}_Position`;
    if (!stem.toLowerCase().endsWith(suffix.toLowerCase())) return null;
    const instrumentWithExchange = stem.slice(0, -suffix.length).trim();
    const [marketPosition = "", quantity = "", averageEntryPrice = ""] = raw.split(";").map((value) => value.trim());
    const position = String(marketPosition).toUpperCase();
    if (!["LONG", "SHORT", "FLAT"].includes(position)) return null;
    return Object.freeze({
      kind: "position",
      filename: name,
      account_name: accountName,
      instrument: normalizeContractInstrument(stripExchange(instrumentWithExchange, exchanges)),
      instrument_with_exchange: instrumentWithExchange,
      market_position: position,
      quantity: nonNegativeNumber(quantity),
      average_entry_price: finiteNumber(averageEntryPrice),
      observed_at: iso(observedAt),
      raw,
    });
  }

  const connection = raw.toUpperCase();
  if (!raw.includes(";") && ["CONNECTED", "DISCONNECTED"].includes(connection)) {
    return Object.freeze({
      kind: "connection",
      filename: name,
      connection_name: stem,
      state: connection,
      observed_at: iso(observedAt),
      raw,
    });
  }

  const fields = raw.split(";").map((value) => value.trim());
  if (fields.length < 3) return null;
  const expectedAccountPrefix = `${accountName}_`;
  let orderId = stem;
  if (stem.toLowerCase().startsWith(expectedAccountPrefix.toLowerCase())) {
    orderId = stem.slice(expectedAccountPrefix.length);
  } else if (/^(sim\d+|live[^_]*)_/i.test(stem)) {
    return null;
  }
  const status = normalizeAtiOrderState(fields[0]);
  const filledQuantity = nonNegativeNumber(fields[1]);
  return Object.freeze({
    kind: "order",
    filename: name,
    order_id: orderId,
    status,
    terminal: TERMINAL_ORDER_STATES.has(status),
    filled_quantity: filledQuantity,
    average_fill_price: finiteNumber(fields[2]),
    observed_at: iso(observedAt),
    raw,
  });
}

export function normalizeAtiOrderState(value) {
  const state = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  return ({
    initialized: "submitted",
    pendingsubmit: "submitted",
    submitted: "submitted",
    accepted: "accepted",
    working: "working",
    suspended: "working",
    changesubmitted: "working",
    changepending: "working",
    cancelpending: "cancel_requested",
    cancelsubmitted: "cancel_requested",
    triggerpending: "working",
    partfilled: "partially_filled",
    partiallyfilled: "partially_filled",
    filled: "filled",
    cancelled: "cancelled",
    canceled: "cancelled",
    rejected: "rejected",
    expired: "expired",
    error: "error",
  })[state] || "unknown";
}

export function ninjaAtiExternalEventKey({ filename, contents, modifiedAt } = {}) {
  return createHash("sha256")
    .update(String(filename || ""))
    .update("\0")
    .update(String(contents ?? ""))
    .update("\0")
    .update(String(modifiedAt || ""))
    .digest("hex");
}

function stripExchange(value, exchanges) {
  const normalized = String(value || "").trim();
  const candidates = [...new Set([...(exchanges || []), "Globex", "CME", "NYMEX", "COMEX", "CBOT"])]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  for (const exchange of candidates) {
    const suffix = ` ${exchange}`;
    if (normalized.toLowerCase().endsWith(suffix.toLowerCase())) return normalized.slice(0, -suffix.length).trim();
  }
  return normalized;
}

function normalizeContractInstrument(value) {
  const normalized = String(value || "").trim();
  const match = normalized.match(/^(.+?)\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})$/i);
  if (!match) return normalized;
  const month = ({ JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" })[match[2].toUpperCase()];
  return `${match[1]} ${month}-${match[3]}`;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeNumber(value) {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : 0;
}

function iso(value) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ATI observation timestamp: ${value}`);
  return new Date(parsed).toISOString();
}
