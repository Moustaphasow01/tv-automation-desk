import { resultFromIssues } from "./result.js";
import {
  computeRewardRisk,
  firstPresent,
  numberOrNull,
  setupDirection,
  setupInstrument,
  setupKey,
} from "./setup-shape.js";

const ACTIVE_STATUSES = new Set(["", "active", "open", "pending", "paper_ready", "triggered"]);
const WAIT_VALUES = new Set(["wait", "wait_only", "no_trade", "ne_pas_prendre", "gestion_seule", "management_only"]);
const CORRELATION_GROUPS = Object.freeze({
  equity_index: ["MES", "ES", "MNQ", "NQ", "MYM", "YM", "M2K", "RTY"],
  energy_crude: ["MCL", "CL"],
});

export function evaluateRisk({
  setup = {},
  rules = {},
  activeOrders = [],
  activeExposures = [],
} = {}) {
  const rejectReasons = [];
  const flags = [];
  const geometry = computeRewardRisk(setup);
  const riskPct = numberOrNull(setup.risk_pct);
  const maxRiskPct = numberOrNull(firstPresent(
    rules.maxRiskPct,
    rules.max_risk_pct,
    rules.max_risk_pct_primary_setup,
    rules.max_risk_pct_session,
  )) ?? 1;
  const rr = effectiveRR(setup, geometry);
  const minRR = minRequiredRR(setup, rules);
  const evidence = {
    computed_rr: rr,
    min_rr_required: minRR,
    max_risk_allowed: maxRiskPct,
    normalized_price_geometry: geometry,
  };

  if (isWaitLike(setup) && riskPct === 0) {
    return resultFromIssues({
      flags,
      evidence: {
        ...evidence,
        risk_mode: "wait_no_trade",
      },
    });
  }

  if (riskPct === null) {
    rejectReasons.push("risk_pct_missing");
    flags.push("RISK_PCT_MISSING");
  } else if (riskPct > maxRiskPct) {
    rejectReasons.push("risk_pct_above_limit");
    flags.push("RISK_PCT_ABOVE_LIMIT");
  }

  if (rr === null) {
    rejectReasons.push("rr_missing");
    flags.push("RISK_RR_MISSING");
  } else if (rr < minRR) {
    rejectReasons.push("rr_below_minimum");
    flags.push("RISK_RR_BELOW_MINIMUM");
  }

  const duplicateMatches = duplicateSignalMatches(setup, activeOrders);
  if (duplicateMatches.length > 0 && rules.allowDuplicateSignal !== true) {
    rejectReasons.push("duplicate_signal");
    flags.push("RISK_DUPLICATE_SIGNAL");
    evidence.duplicate_matches = duplicateMatches;
  }

  const correlated = correlatedExposure(setup, activeOrders, activeExposures, rules);
  if (correlated.blocking) {
    rejectReasons.push("correlated_active_exposure");
    flags.push("RISK_CORRELATED_ACTIVE_EXPOSURE");
    evidence.correlated_active_exposure = correlated;
  }

  return resultFromIssues({ rejectReasons, flags, evidence });
}

function isWaitLike(setup = {}) {
  return [
    setup.decision,
    setup.direction,
    setup.setup_type,
    setup.status,
  ].some((value) => WAIT_VALUES.has(String(value || "").toLowerCase()));
}

function effectiveRR(setup, geometry) {
  const explicit = numberOrNull(firstPresent(setup.rr, setup.reward_risk, setup.r_multiple));
  if (explicit !== null) return explicit;
  if (geometry.rr !== null) return geometry.rr;
  return numberOrNull(setup.rr_minimum);
}

function minRequiredRR(setup, rules) {
  const riskMode = String(setup.risk_mode || setup.riskMode || "").toUpperCase();
  if (riskMode === "REDUCED_SIZE") {
    return numberOrNull(firstPresent(rules.conditionalMinRR, rules.conditional_min_rr)) ?? 1.2;
  }
  return numberOrNull(firstPresent(rules.minRR, rules.min_rr)) ?? 1.5;
}

function duplicateSignalMatches(setup, activeOrders) {
  const candidateInstrument = setupInstrument(setup);
  const candidateDirection = setupDirection(setup);
  const candidateKey = setupKey(setup);
  if (!candidateInstrument || !["long", "short"].includes(candidateDirection)) return [];
  const matches = [];
  for (const row of activeOrders || []) {
    const order = row && typeof row.ready_order === "object" ? row.ready_order : row;
    if (!order || typeof order !== "object") continue;
    const status = String(row.status || order.status || "").toLowerCase();
    if (!ACTIVE_STATUSES.has(status)) continue;
    if (setupInstrument(order) !== candidateInstrument) continue;
    if (setupDirection(order) !== candidateDirection) continue;
    const orderKey = setupKey(order);
    if (candidateKey && orderKey && candidateKey !== orderKey) continue;
    matches.push(String(row.cycle_id || row.candidate_id || row.doc_id || order.order_id || "-"));
  }
  return matches;
}

function correlatedExposure(setup, activeOrders, activeExposures, rules) {
  const candidateInstrument = setupInstrument(setup);
  const candidateDirection = setupDirection(setup);
  const candidateGroup = correlationGroup(candidateInstrument);
  const maxAllowed = Math.max(1, numberOrNull(firstPresent(rules.maxCorrelatedActive, rules.max_correlated_active)) ?? 1);
  if (!candidateInstrument || !["long", "short"].includes(candidateDirection) || candidateGroup === "single_name") {
    return { blocking: false, correlation_group: candidateGroup, count_with_candidate: 1, max_allowed: maxAllowed };
  }

  const exposures = [
    ...(activeExposures || []),
    ...(activeOrders || []).map((row) => (row && typeof row.ready_order === "object" ? { ...row.ready_order, status: row.status } : row)),
  ].filter((row) => row && typeof row === "object");
  const matching = exposures.filter((row) => {
    const status = String(row.status || row.position_status || "").toLowerCase();
    if (!ACTIVE_STATUSES.has(status)) return false;
    const symbol = setupInstrument(row);
    return correlationGroup(symbol) === candidateGroup && setupDirection(row) === candidateDirection;
  });
  return {
    blocking: matching.length + 1 > maxAllowed,
    correlation_group: candidateGroup,
    direction: candidateDirection,
    active_count: matching.length,
    count_with_candidate: matching.length + 1,
    max_allowed: maxAllowed,
    symbols: [...new Set(matching.map((row) => setupInstrument(row)).filter(Boolean))],
  };
}

function correlationGroup(symbol) {
  const compact = String(symbol || "").replace("CME_MINI:", "").replace("NYMEX:", "").replace("!", "").toUpperCase();
  for (const [group, prefixes] of Object.entries(CORRELATION_GROUPS)) {
    if (prefixes.some((prefix) => compact.startsWith(prefix))) return group;
  }
  return "single_name";
}
