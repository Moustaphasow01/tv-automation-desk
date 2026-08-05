import { numberOrNull } from "./setup-shape.js";
import { normalizeOpportunityGateCodeV1 } from "./opportunity-gate-normalizer-v1.js";

export const HARD_GATE_CODES_V5 = Object.freeze([
  "ANTI_LOOKAHEAD_FAILED",
  "SCOPE_CONTRACT_MISMATCH",
  "CANONICAL_TRIGGER_DATA_MISSING",
  "GEOMETRY_INVALID",
  "RR_BELOW_MINIMUM",
  "STOP_INVALID",
  "TARGET_INVALID",
  "SETUP_EXPIRED_OR_TERMINAL",
  "DETERMINISTIC_VETO_ACTIVE",
  "BROKER_SAFETY_FAILED",
  "MAJOR_EVENT_ENTRY_BLOCK",
  "MANDATORY_INDICATOR_MISSING",
]);

export const SOFT_GATE_CODES_V5 = Object.freeze([
  "PACK_DEGRADED",
  "MEGA_CAPS_MISSING_FOR_NQ",
  "PRICE_MID_RANGE",
  "CROSS_ASSET_PARTIAL",
  "MACRO_NEUTRAL",
  "NQ_ES_DIVERGENCE",
  "HIGH_VOLATILITY",
  "LEVEL_CONSUMED",
  "CONTEXTUAL_DATA_GAP",
  "OPTIONAL_INDICATOR_MISSING",
]);

export const OPPORTUNITY_EVALUATION_PHASES_V1 = Object.freeze([
  "PLAN_COMPILE",
  "SETUP_ARM",
  "ENTRY_TRIGGER",
  "BROKER_SUBMIT",
]);

export const HARD_GATE_ENFORCEMENT_PHASES_V5 = Object.freeze({
  ANTI_LOOKAHEAD_FAILED: "PLAN_COMPILE",
  SCOPE_CONTRACT_MISMATCH: "PLAN_COMPILE",
  CANONICAL_TRIGGER_DATA_MISSING: "ENTRY_TRIGGER",
  GEOMETRY_INVALID: "SETUP_ARM",
  RR_BELOW_MINIMUM: "SETUP_ARM",
  STOP_INVALID: "SETUP_ARM",
  TARGET_INVALID: "SETUP_ARM",
  SETUP_EXPIRED_OR_TERMINAL: "ENTRY_TRIGGER",
  DETERMINISTIC_VETO_ACTIVE: "ENTRY_TRIGGER",
  BROKER_SAFETY_FAILED: "BROKER_SUBMIT",
  MAJOR_EVENT_ENTRY_BLOCK: "ENTRY_TRIGGER",
  MANDATORY_INDICATOR_MISSING: "ENTRY_TRIGGER",
});

const EVALUATION_PHASE_RANK = new Map(
  OPPORTUNITY_EVALUATION_PHASES_V1.map((phase, index) => [phase, index]),
);

const HARD_GATE_CODE_SET = new Set(HARD_GATE_CODES_V5);
const SOFT_GATE_CODE_SET = new Set(SOFT_GATE_CODES_V5);
export const OPPORTUNITY_POLICY_VERSION_V1 = "1.2.0";
export const OPPORTUNITY_POLICY_EVALUATION_SCHEMA_VERSION_V1 = "opportunity_policy_evaluation_v1_2";
export const OPPORTUNITY_SEEKING_CONTROLLED = Object.freeze({
  policy_id: "OPPORTUNITY_SEEKING_CONTROLLED",
  policy_version: OPPORTUNITY_POLICY_VERSION_V1,
  weighted_confirmation_threshold: 0.55,
  max_risk_pct: 0.25,
  min_rr: 2,
  optional_advisory_in_score: false,
  unknown_context_is_soft: true,
  gpt_may_trigger: false,
});

const INTERNAL_HARD_GATE_ALIASES = new Set([
  "ANTI_LOOKAHEAD_FAILED",
  "BROKER_ACCOUNT_SAFETY_FAILED",
  "BROKER_RECONCILIATION_FAILED",
  "CANONICAL_TRIGGER_DATA_MISSING",
  "CONTRACT_MISMATCH",
  "CUTOFF_MISMATCH",
  "DATA_SCOPE_MISMATCH",
  "EXECUTION_GEOMETRY_INVALID",
  "HARD_BLOCKER_ACTIVE",
  "INVALID_STOP",
  "INVALID_TARGET",
  "PACK_MISMATCH",
  "RISK_BUDGET_EXCEEDED",
  "RR_BELOW_MINIMUM",
  "SCOPE_MISMATCH",
  "SETUP_EXPIRED",
  "SETUP_TERMINAL",
]);

const CONTEXTUAL_GATE_PREFIXES = Object.freeze([
  "CALENDAR_",
  "CL_",
  "DXY_",
  "ES_",
  "GC_",
  "INDICES_",
  "MEGACAPS_",
  "NEWS_",
  "NQ_",
  "RATES_",
  "SEMIS_",
  "VIX_",
]);

export function evaluateOpportunitySeekingControlledV1({
  setup = {},
  conditionEvaluation = {},
  gates = [],
  nowParis = null,
  policy = OPPORTUNITY_SEEKING_CONTROLLED,
  phase = "ENTRY_TRIGGER",
} = {}) {
  const hardGateCandidates = [];
  const softGaps = [];
  const evaluationPhase = normalizeEvaluationPhase(phase);
  const geometry = evaluateCanonicalGeometry(setup, policy);
  hardGateCandidates.push(...geometry.hard_failures);

  const status = normalizeEnum(setup.status || setup.lifecycle_status || setup.setup_status);
  if (["TRIGGERED", "CANCELLED", "EXPIRED", "INVALIDATED", "REPLACED"].includes(status)) {
    hardGateCandidates.push(issue("SETUP_TERMINAL", { status }));
  }

  const nowMs = parseTimestamp(nowParis);
  const validFromMs = parseTimestamp(setup.valid_from_paris || setup.valid_from);
  const expiresAtMs = parseTimestamp(
    setup.expires_at_paris || setup.expires_at || setup.valid_until_paris || setup.valid_until,
  );
  if (nowParis && nowMs === null) {
    hardGateCandidates.push(issue("INVALID_EVALUATION_TIME", { now_paris: nowParis }));
  } else if (nowMs !== null && validFromMs !== null && nowMs < validFromMs) {
    hardGateCandidates.push(issue("SETUP_NOT_YET_VALID", {
      now_paris: nowParis,
      valid_from_paris: setup.valid_from_paris || setup.valid_from,
    }));
  } else if (nowMs !== null && expiresAtMs !== null && nowMs >= expiresAtMs) {
    hardGateCandidates.push(issue("SETUP_EXPIRED", {
      now_paris: nowParis,
      expires_at_paris: setup.expires_at_paris || setup.expires_at || setup.valid_until_paris || setup.valid_until,
    }));
  }

  if (Number(conditionEvaluation.hard_blockers_active || 0) > 0) {
    hardGateCandidates.push(issue("HARD_BLOCKER_ACTIVE", {
      condition_ids: conditionEvaluation.hard_blocker_condition_ids || [],
    }));
  }
  if (Number(conditionEvaluation.hard_blockers_unknown || 0) > 0) {
    hardGateCandidates.push(issue("CANONICAL_TRIGGER_DATA_MISSING", {
      reason: "HARD_BLOCKER_DATA_UNAVAILABLE",
      condition_ids: conditionEvaluation.hard_blocker_unknown_condition_ids || [],
    }));
  }
  if (Number(conditionEvaluation.required_failed || 0) > 0) {
    hardGateCandidates.push(issue("REQUIRED_STRUCTURAL_CONDITION_FAILED", {
      condition_ids: conditionEvaluation.required_failed_condition_ids || [],
    }));
  }
  if (Number(conditionEvaluation.required_unknown || 0) > 0) {
    hardGateCandidates.push(issue("REQUIRED_STRUCTURAL_DATA_UNAVAILABLE", {
      condition_ids: conditionEvaluation.required_unknown_condition_ids || [],
    }));
  }
  const structuralPending = Number(conditionEvaluation.required_pending || 0);
  const structuralNotStarted = Number(conditionEvaluation.required_not_started || 0);
  if (conditionEvaluation.sequence_valid === false) {
    hardGateCandidates.push(issue("REQUIRED_CONDITION_SEQUENCE_INVALID", {
      condition_ids: conditionEvaluation.sequence_violation_condition_ids || [],
    }));
  }

  const weightedScore = numberOrNull(conditionEvaluation.weighted_confirmation_score);
  const knownWeightedScore = numberOrNull(
    conditionEvaluation.weighted_known_confirmation_score,
  ) ?? weightedScore;
  const scoredCount = Number(conditionEvaluation.scored_confirmation_count || 0);
  const configuredCount = Number(conditionEvaluation.configured_confirmation_count || 0);
  const primaryTotal = Number(conditionEvaluation.primary_confirmation_total || 0);
  const primaryKnown = Number(conditionEvaluation.primary_confirmation_known || 0);
  const primaryCoverageReady = primaryTotal === 0 || primaryKnown > 0;
  if (scoredCount > 0
    && primaryCoverageReady
    && (knownWeightedScore === null || knownWeightedScore < policy.weighted_confirmation_threshold)) {
    hardGateCandidates.push(issue("WEIGHTED_CONFIRMATION_BELOW_THRESHOLD", {
      score: knownWeightedScore,
      threshold: policy.weighted_confirmation_threshold,
    }));
  }
  if (scoredCount === 0) {
    softGaps.push(issue("NO_CONTEXTUAL_CONFIRMATION_AVAILABLE", {
      threshold: policy.weighted_confirmation_threshold,
    }));
  }
  if (!primaryCoverageReady) {
    softGaps.push(issue("CONTEXTUAL_DATA_GAP", {
      reason: "PRIMARY_CONFIRMATION_NOT_YET_KNOWN",
      primary_total: primaryTotal,
    }));
  }
  const triggerScoreReady = configuredCount === 0
    || (primaryCoverageReady
      && knownWeightedScore !== null
      && knownWeightedScore >= policy.weighted_confirmation_threshold);
  const structuralConditionsReady = structuralPending === 0 && structuralNotStarted === 0;

  for (const gate of normalizeGates(gates)) {
    if (!gate.failed) continue;
    const classification = classifyOpportunityGateV1(gate);
    const canonicalCode = canonicalOpportunityGateCodeV1(gate.code, { classification });
    const evidence = gate.code === canonicalCode
      ? gate.evidence
      : { internal_gate_code: gate.code, evidence: gate.evidence };
    if (classification === "hard") hardGateCandidates.push(issue(canonicalCode, evidence));
    else softGaps.push(issue(canonicalCode, evidence));
  }

  for (const conditionId of conditionEvaluation.soft_unknown_condition_ids || []) {
    softGaps.push(issue("CONTEXTUAL_CONDITION_DATA_UNAVAILABLE", { condition_id: conditionId }));
  }

  const { hardFailures, deferredHardGates } = partitionHardGatesByPhase(
    hardGateCandidates,
    evaluationPhase,
  );

  return {
    schema_version: OPPORTUNITY_POLICY_EVALUATION_SCHEMA_VERSION_V1,
    policy_id: policy.policy_id,
    policy_version: policy.policy_version,
    evaluation_phase: evaluationPhase,
    eligible: hardFailures.length === 0,
    trigger_eligible: hardFailures.length === 0 && triggerScoreReady && structuralConditionsReady,
    decision: hardFailures.length === 0 ? "ALLOW_CONDITIONAL_OPPORTUNITY" : "BLOCK",
    weighted_confirmation_score: weightedScore,
    weighted_known_confirmation_score: knownWeightedScore,
    primary_confirmation_coverage_ready: primaryCoverageReady,
    structural_conditions_ready: structuralConditionsReady,
    weighted_confirmation_threshold: policy.weighted_confirmation_threshold,
    max_risk_pct: policy.max_risk_pct,
    min_rr: policy.min_rr,
    hard_failures: dedupeIssues(hardFailures),
    deferred_hard_gates: dedupeIssues(deferredHardGates),
    soft_gaps: dedupeIssues(softGaps),
    geometry,
  };
}

function normalizeEvaluationPhase(value) {
  const normalized = normalizeEnum(value);
  if (EVALUATION_PHASE_RANK.has(normalized)) return normalized;
  // Legacy transport aliases are accepted only at this public boundary. All
  // internal evaluation and emitted artifacts use the normative phase names.
  if (normalized === "COMPILE") return "PLAN_COMPILE";
  if (normalized === "TRIGGER") return "ENTRY_TRIGGER";
  return "ENTRY_TRIGGER";
}

function partitionHardGatesByPhase(candidates, evaluationPhase) {
  const hardFailures = [];
  const deferredHardGates = [];
  const evaluationRank = EVALUATION_PHASE_RANK.get(evaluationPhase);
  for (const candidate of dedupeIssues(candidates)) {
    const enforcementPhase = HARD_GATE_ENFORCEMENT_PHASES_V5[candidate.code]
      || "PLAN_COMPILE";
    const enforcementRank = EVALUATION_PHASE_RANK.get(enforcementPhase);
    if (evaluationRank < enforcementRank) deferredHardGates.push(candidate);
    else hardFailures.push(candidate);
  }
  return { hardFailures, deferredHardGates };
}

export function classifyOpportunityGateV1(gate = {}) {
  const code = normalizeEnum(gate.code || gate.gate_id || gate.name || "UNSPECIFIED_GATE");
  if (HARD_GATE_CODE_SET.has(code)) return "hard";
  if (SOFT_GATE_CODE_SET.has(code)) return "soft";
  if (gate.hard_gate === true || gate.required_for_trigger === true || gate.classification === "hard") {
    return "hard";
  }
  if (INTERNAL_HARD_GATE_ALIASES.has(code)) return "hard";
  if (CONTEXTUAL_GATE_PREFIXES.some((prefix) => code.startsWith(prefix))) return "soft";
  return gate.classification === "soft" || gate.contextual === true ? "soft" : "hard";
}

export function canonicalOpportunityGateCodeV1(code, { classification = null } = {}) {
  return normalizeOpportunityGateCodeV1(code, { classification });
}

export function evaluateCanonicalGeometry(setup = {}, policy = OPPORTUNITY_SEEKING_CONTROLLED) {
  const hardFailures = [];
  const direction = normalizeDirection(setup.direction || setup.side);
  const entry = canonicalEntryPrice(setup);
  const stop = numberOrNull(setup.stop_loss ?? setup.stop ?? setup.sl);
  const target = canonicalTargetPrice(setup);
  const riskPct = numberOrNull(setup.risk_pct ?? setup.risk_percent);
  const explicitRr = numberOrNull(setup.rr_minimum ?? setup.rr ?? setup.reward_risk);
  const riskPoints = entry === null || stop === null ? null : Math.abs(entry - stop);
  const rewardPoints = entry === null || target === null ? null : Math.abs(target - entry);
  const computedRr = riskPoints && rewardPoints !== null ? round(rewardPoints / riskPoints, 4) : null;
  const effectiveRr = computedRr ?? explicitRr;

  if (!["long", "short"].includes(direction)) hardFailures.push(issue("DIRECTION_INVALID"));
  if (entry === null) hardFailures.push(issue("ENTRY_GEOMETRY_MISSING"));
  if (stop === null) hardFailures.push(issue("INVALID_STOP"));
  if (target === null) hardFailures.push(issue("INVALID_TARGET"));
  if (entry !== null && stop !== null && target !== null) {
    const ordered = direction === "long"
      ? stop < entry && entry < target
      : direction === "short"
        ? target < entry && entry < stop
        : false;
    if (!ordered) hardFailures.push(issue("EXECUTION_GEOMETRY_INVALID"));
  }
  if (effectiveRr === null || effectiveRr < policy.min_rr) {
    hardFailures.push(issue("RR_BELOW_MINIMUM", {
      rr: effectiveRr,
      minimum: policy.min_rr,
    }));
  }
  if (riskPct === null || riskPct <= 0 || riskPct > policy.max_risk_pct) {
    hardFailures.push(issue("RISK_BUDGET_EXCEEDED", {
      risk_pct: riskPct,
      maximum: policy.max_risk_pct,
    }));
  }

  return {
    valid: hardFailures.length === 0,
    direction,
    entry_price: entry,
    stop_loss: stop,
    take_profit_1: target,
    risk_points: riskPoints,
    reward_points: rewardPoints,
    computed_rr: computedRr,
    effective_rr: effectiveRr,
    risk_pct: riskPct,
    hard_failures: dedupeIssues(hardFailures),
  };
}

function canonicalEntryPrice(setup) {
  const direct = numberOrNull(setup.entry_price ?? setup.entry);
  if (direct !== null) return direct;
  const zone = setup.entry_zone || setup.entry_range || setup.zone;
  if (!zone || typeof zone !== "object") return null;
  const lower = numberOrNull(zone.lower ?? zone.from ?? zone.min);
  const upper = numberOrNull(zone.upper ?? zone.to ?? zone.max);
  if (lower === null || upper === null) return null;
  const low = Math.min(lower, upper);
  const high = Math.max(lower, upper);
  const direction = normalizeDirection(setup.direction || setup.side);
  // Use the same conservative execution boundary as the position engine:
  // long enters at the upper bound, short at the lower bound. This prevents
  // a setup from passing RR at the midpoint and being submitted below min_rr.
  if (direction === "long") return high;
  if (direction === "short") return low;
  return (low + high) / 2;
}

function canonicalTargetPrice(setup) {
  const direct = numberOrNull(setup.take_profit_1 ?? setup.tp1 ?? setup.take_profit ?? setup.target);
  if (direct !== null) return direct;
  const collection = setup.take_profits;
  if (Array.isArray(collection)) {
    const first = collection[0];
    return numberOrNull(first?.target ?? first?.price ?? first?.level ?? first);
  }
  if (collection && typeof collection === "object") {
    return numberOrNull(collection.tp1 ?? collection.take_profit_1 ?? collection.target);
  }
  return null;
}

function normalizeGates(gates) {
  if (Array.isArray(gates)) {
    return gates.map((gate, index) => normalizeGate(gate, `GATE_${index + 1}`));
  }
  if (!gates || typeof gates !== "object") return [];
  return Object.entries(gates).map(([name, gate]) => normalizeGate(gate, name));
}

function normalizeGate(gate, fallbackCode) {
  if (typeof gate === "boolean") {
    return { code: normalizeEnum(fallbackCode), failed: gate === false };
  }
  if (typeof gate === "string") {
    return {
      code: normalizeEnum(fallbackCode),
      failed: ["FAIL", "FAILED", "BLOCK", "BLOCKED", "REJECTED", "RED", "UNKNOWN"].includes(normalizeEnum(gate)),
    };
  }
  const value = gate && typeof gate === "object" ? gate : {};
  const status = normalizeEnum(value.state || value.status || value.result || value.verdict);
  return {
    ...value,
    code: normalizeEnum(value.code || value.gate_id || value.name || fallbackCode),
    failed: value.failed === true
      || value.passed === false
      || ["FAIL", "FAILED", "BLOCK", "BLOCKED", "REJECTED", "RED", "UNKNOWN"].includes(status),
    evidence: value.evidence || null,
  };
}

function issue(code, evidence = null) {
  const canonicalCode = normalizeOpportunityGateCodeV1(code);
  return {
    code: canonicalCode,
    evidence: canonicalCode === code ? evidence : { internal_gate_code: code, evidence },
  };
}

function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter((entry) => {
    const key = `${entry.code}:${JSON.stringify(entry.evidence || null)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseTimestamp(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDirection(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "buy") return "long";
  if (normalized === "sell") return "short";
  return normalized;
}

function normalizeEnum(value) {
  return String(value || "").trim().toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
