import { resultFromIssues } from "./result.js";
import {
  computeRewardRisk,
  numberOrNull,
  setupDirection,
  setupEntry,
  setupStop,
} from "./setup-shape.js";

const WAIT_VALUES = new Set(["wait", "wait_only", "no_trade", "ne_pas_prendre", "gestion_seule", "management_only"]);

export function validateSetup({ setup, decision } = {}) {
  const candidate = setup || decision || {};
  const rejectReasons = [];
  const flags = [];
  const direction = setupDirection(candidate);
  const riskPct = numberOrNull(candidate.risk_pct ?? decision?.risk_pct);
  const evidence = {
    normalized_price_geometry: computeRewardRisk(candidate),
  };

  if (isWaitLike(candidate, decision)) {
    if (riskPct !== null && riskPct > 0) {
      rejectReasons.push("wait_has_risk");
      flags.push("SETUP_WAIT_HAS_RISK");
    }
    return resultFromIssues({ rejectReasons, flags, evidence });
  }

  const entry = setupEntry(candidate);
  const stop = setupStop(candidate);
  const geometry = computeRewardRisk(candidate);
  evidence.normalized_price_geometry = geometry;

  if (!["long", "short"].includes(direction) || entry === null || stop === null || geometry.target === null) {
    rejectReasons.push("setup_incomplete");
    flags.push("SETUP_INCOMPLETE");
    return resultFromIssues({ rejectReasons, flags, evidence });
  }

  if (direction === "long" && !(geometry.stop < geometry.entry && geometry.entry < geometry.target)) {
    rejectReasons.push("invalid_long_prices");
    flags.push("SETUP_INVALID_LONG_PRICES");
  }

  if (direction === "short" && !(geometry.target < geometry.entry && geometry.entry < geometry.stop)) {
    rejectReasons.push("invalid_short_prices");
    flags.push("SETUP_INVALID_SHORT_PRICES");
  }

  return resultFromIssues({ rejectReasons, flags, evidence });
}

function isWaitLike(setup = {}, decision = {}) {
  const values = [
    setup.decision,
    setup.direction,
    setup.setup_type,
    setup.status,
    decision?.decision,
    decision?.direction,
    decision?.setup_type,
  ].map((value) => String(value || "").toLowerCase());
  return values.some((value) => WAIT_VALUES.has(value));
}
