import { isWithinTimeWindow } from "./instant.js";
import { resultFromIssues } from "./result.js";
import { numberOrNull } from "./setup-shape.js";

const PASS_STATUSES = new Set(["pass", "passed", "ok", "accepted", "conditional_pass"]);
const FAIL_STATUSES = new Set(["fail", "failed", "blocked", "block", "rejected", "no_go", "red"]);
const ENTRY_BLOCKING_WINDOW_STATUSES = new Set(["red", "no_entry", "no_entries", "no_new_entries", "blocked"]);

export function evaluateGates({ decision = {}, decisionGates, timeWindows = [], decisionTimestamp } = {}) {
  const gates = decisionGates || decision.decision_gates || {};
  const rejectReasons = [];
  const reviewReasons = [];
  const flags = [];
  const evidence = {
    checked_gates: Object.keys(gates),
  };

  if (!gatePasses(gates.data_quality_gate)) {
    rejectReasons.push("data_quality_gate_failed");
    flags.push("GATE_DATA_QUALITY_FAILED");
  }

  if (marketFunnelBlocks(gates.market_funnel_gate)) {
    rejectReasons.push("market_funnel_gate_failed");
    flags.push("GATE_MARKET_FUNNEL_FAILED");
  }

  if (finalGateConflicts(gates.final_gate, decision)) {
    reviewReasons.push("final_gate_conflict");
    flags.push("GATE_FINAL_CONFLICT");
  }

  const blockingWindows = timeWindows.filter((window) => windowBlocksNewEntry(window, decision, decisionTimestamp));
  if (blockingWindows.length > 0) {
    rejectReasons.push("red_window_no_new_entry");
    flags.push("GATE_RED_WINDOW_NO_NEW_ENTRY");
    evidence.blocking_windows = blockingWindows.map((window) => ({
      id: window.id ?? window.name ?? null,
      status: window.status ?? null,
      start: window.start ?? window.start_paris ?? null,
      end: window.end ?? window.end_paris ?? null,
    }));
  }

  return resultFromIssues({ rejectReasons, reviewReasons, flags, evidence });
}

function gatePasses(gate) {
  const status = gateStatus(gate);
  return PASS_STATUSES.has(status);
}

function marketFunnelBlocks(gate) {
  const status = gateStatus(gate);
  if (!status) return true;
  if (FAIL_STATUSES.has(status)) return true;
  const hardGate = gate && typeof gate === "object" && gate.hard_gate === true;
  return hardGate && !PASS_STATUSES.has(status);
}

function finalGateConflicts(finalGate, decision) {
  if (!finalGate || typeof finalGate !== "object") return false;
  const fallback = String(finalGate.fallback_decision || finalGate.fallback || "").toLowerCase();
  const finalDecision = String(finalGate.final_decision || finalGate.decision || "").toLowerCase();
  const gateAsksWait = ["wait", "ne_pas_prendre", "no_trade"].includes(fallback)
    || ["wait", "ne_pas_prendre", "no_trade"].includes(finalDecision);
  return gateAsksWait && opensNewRisk(decision);
}

function windowBlocksNewEntry(window, decision, decisionTimestamp) {
  if (!window || typeof window !== "object" || !opensNewRisk(decision)) return false;
  const status = String(window.status || window.entry_status || "").toLowerCase();
  const blocksByStatus = ENTRY_BLOCKING_WINDOW_STATUSES.has(status) || window.new_entries_allowed === false;
  return blocksByStatus && isWithinTimeWindow(decisionTimestamp || decision.created_at || decision.decision_timestamp_paris, window);
}

function opensNewRisk(decision = {}) {
  const rawDecision = String(decision.decision || decision.action || "").toLowerCase();
  if (["wait", "no_trade", "ne_pas_prendre", "gestion_seule", "management_only"].includes(rawDecision)) {
    return false;
  }
  const direction = String(decision.direction || "").toLowerCase();
  const riskPct = numberOrNull(decision.risk_pct);
  return rawDecision === "prendre" || ["long", "short"].includes(direction) || (riskPct !== null && riskPct > 0);
}

function gateStatus(gate) {
  if (gate === true) return "pass";
  if (gate === false || gate === null || gate === undefined) return "";
  if (typeof gate === "string") return gate.toLowerCase();
  if (typeof gate === "object") {
    return String(gate.status || gate.result || gate.verdict || "").toLowerCase();
  }
  return "";
}
