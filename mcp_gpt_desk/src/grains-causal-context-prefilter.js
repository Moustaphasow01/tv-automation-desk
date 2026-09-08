import {
  adjudicateGrainSignal,
  US_GRAINS_STRATEGY_SUITE_VERSION,
} from "./us-grains-strategy-suite.js";
import { evaluateGrainsCalendarCoverage } from "./grains-calendar-coverage.js";
import { evaluateGrainsDataContinuity, GRAINS_DATA_POLICIES, normalizeGrainsDataPolicy } from "@tv-automation/desk-domain";
import { grainStrategyIdentity, usGrainsStrategyFamilies } from "./us-grains-strategy-catalog.js";

// This policy runs AFTER raw publication. Detectors never consume its result.
export function evaluateCausalGrainContextAtBus({ signal, nowUtc, dataPolicy }) {
  if (
    signal.signal_quality?.strategy_suite_version !==
    US_GRAINS_STRATEGY_SUITE_VERSION
  )
    return null;
  const context = signal.setup?.context;
  const reason = fallbackPolicyReason({ signal, context, dataPolicy })
    || invalidContextReason({ signal, context, nowUtc });
  if (reason)
    return {
      signal,
      decision: "WAIT",
      admissible: false,
      reasonCodes: [reason],
      marketContextSnapshotId: null,
      contextSource: "CAUSAL_SIGNAL_PREFIX",
    };
  const result = adjudicateGrainSignal({ signal, frame: { context } });
  const recommendation =
    { ACCEPT: "TAKE", ACCEPT_REDUCED: "TAKE_REDUCED" }[result.recommendation] ||
    result.recommendation;
  const contextGate = {
    recommendation,
    confidence: signal.confidence,
    risk_multiplier: result.risk_multiplier,
    reason_codes: result.reason_codes,
    policy_version: result.schema_version,
    model_ref: `deterministic://${result.schema_version}`,
    issued_at_utc: nowUtc,
  };
  return {
    signal: {
      ...signal,
      signal_quality: { ...signal.signal_quality, context_gate: contextGate },
    },
    decision: result.accepted ? "ADMISSIBLE" : result.recommendation,
    admissible: result.accepted,
    reasonCodes: [
      "US_GRAINS_CAUSAL_CONTEXT_EVALUATED_AT_BUS",
      ...result.reason_codes,
    ],
    marketContextSnapshotId: null,
    contextSource: "CAUSAL_SIGNAL_PREFIX",
    contextGate,
  };
}

function fallbackPolicyReason({ signal, context, dataPolicy }) {
  const quality = context?.data_quality;
  if (!quality?.data_policy) return null;
  if (quality.data_policy !== GRAINS_DATA_POLICIES.M5_FALLBACK)
    return "GRAIN_DATA_POLICY_UNSUPPORTED";
  if (normalizeGrainsDataPolicy(dataPolicy) !== GRAINS_DATA_POLICIES.M5_FALLBACK)
    return "GRAIN_M5_FALLBACK_DISABLED";
  if (!fallbackSignalScopeValid(signal)) return "GRAIN_M5_FALLBACK_SCOPE_UNSUPPORTED";
  const continuity = evaluateGrainsDataContinuity({
    policy: dataPolicy, instrument: signal.instrument, timeframes: quality.timeframes,
  });
  if (!continuity.tradeable || quality.data_mode !== continuity.data_mode
    || Date.parse(quality.as_of_utc) !== Date.parse(signal.source_data_cutoff_utc))
    return "GRAIN_M5_FALLBACK_EVIDENCE_INVALID";
  return null;
}

function fallbackSignalScopeValid(signal) {
  const family = signal.setup?.setup_kind;
  if (signal.execution_mode_origin !== "SHADOW" || signal.timeframe !== "M5"
    || !["ZC", "ZW"].includes(signal.instrument) || !usGrainsStrategyFamilies().includes(family))
    return false;
  const identity = grainStrategyIdentity(family, signal.instrument);
  return signal.strategy_instance_id === identity.strategy_instance_id
    && signal.strategy_version_id === identity.strategy_version_id;
}

function invalidContextReason({ signal, context, nowUtc }) {
  const now = Date.parse(nowUtc);
  const generated = Date.parse(signal.generated_at_utc);
  const cutoff = Date.parse(signal.source_data_cutoff_utc);
  const expires = Date.parse(signal.expires_at_utc);
  if (![now, generated, cutoff, expires].every(Number.isFinite))
    return "GRAIN_CONTEXT_TIMING_UNAVAILABLE";
  if (generated > now || cutoff > generated)
    return "GRAIN_CONTEXT_AFTER_DECISION_TIME";
  if (expires <= now) return "GRAIN_CONTEXT_SIGNAL_EXPIRED";
  if (Date.parse(context?.source_data_cutoff_utc) !== cutoff)
    return "GRAIN_CONTEXT_CUTOFF_MISMATCH";
  const contextExpiry = Date.parse(context?.valid_until_utc);
  if (!Number.isFinite(contextExpiry) || contextExpiry <= now)
    return "GRAIN_CONTEXT_EXPIRED_OR_UNAVAILABLE";
  if (
    context?.schema_version !== "us_grains_market_context_v2" ||
    context?.instrument !== signal.instrument
  ) {
    return "GRAIN_CONTEXT_IDENTITY_MISMATCH";
  }
  return invalidContextPayload({ context, cutoff });
}

function invalidContextPayload({ context, cutoff }) {
  if (context?.data_quality?.tradeable !== true)
    return "GRAIN_CONTEXT_SOURCE_DATA_BLOCKED";
  if (
    !Number.isFinite(context?.risk_multiplier) ||
    context.risk_multiplier < 0 ||
    context.risk_multiplier > 1
  ) {
    return "GRAIN_CONTEXT_RISK_MULTIPLIER_INVALID";
  }
  if (
    ![
      context.allowed_sides,
      context.preferred_strategy_families,
      context.discouraged_strategy_families,
    ].every(Array.isArray)
  ) {
    return "GRAIN_CONTEXT_CONTRACT_INCOMPLETE";
  }
  if (!Array.isArray(context?.macro_event_risk?.events))
    return "GRAIN_CONTEXT_CALENDAR_UNAVAILABLE";
  if (
    context.macro_event_risk.events.some(
      (event) => !knownCalendarEvent(event, cutoff),
    )
  )
    return "GRAIN_CONTEXT_CALENDAR_INVALID";
  const coverage = evaluateGrainsCalendarCoverage({
    sources: [context.macro_event_risk.coverage?.source],
    cutoff: new Date(cutoff).toISOString(),
  });
  if (!coverage.admissible) return coverage.reasonCodes[0];
  return null;
}

function knownCalendarEvent(event, cutoff) {
  const scheduled = Date.parse(event?.event_timestamp_utc);
  const known = Date.parse(event?.source_published_at_utc);
  return (
    Number.isFinite(scheduled) && Number.isFinite(known) && known <= cutoff
  );
}
