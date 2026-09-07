export const MARKET_CONTEXT_SCHEMA_VERSION_V1 = "market_context_snapshot_v1";
export const MARKET_DESK_BRIEF_SCHEMA_VERSION_V1 = "market_desk_brief_v1";
export const MARKET_CONTEXT_SOURCE_STATUSES_V1 = Object.freeze([
  "AVAILABLE", "STALE", "UNAVAILABLE", "UNKNOWN_COVERAGE", "OPTIONAL_UNAVAILABLE",
]);
export const MARKET_CONTEXT_STATUSES_V1 = Object.freeze([
  "AVAILABLE", "STALE", "PARTIAL", "UNAVAILABLE", "INVALIDATED", "DISABLED_BY_POLICY",
]);
export const CONTEXT_PREFILTER_DECISIONS_V1 = Object.freeze(["ADMISSIBLE", "WAIT", "REJECT"]);

export function normalizeMarketSourceStateV1(input = {}, { cutoff = null } = {}) {
  const status = member(input.status, MARKET_CONTEXT_SOURCE_STATUSES_V1, "UNKNOWN_COVERAGE");
  const coverageStart = nullableIso(input.coverageStart || input.coverage_start);
  const coverageEnd = nullableIso(input.coverageEnd || input.coverage_end);
  const dataCutoff = nullableIso(cutoff || input.dataCutoff || input.data_cutoff);
  const covered = Boolean(dataCutoff && coverageStart && coverageEnd
    && Date.parse(coverageStart) <= Date.parse(dataCutoff)
    && Date.parse(coverageEnd) >= Date.parse(dataCutoff));
  return {
    sourceId: required(input.sourceId || input.source_id, "MARKET_SOURCE_ID_REQUIRED"),
    sourceType: required(input.sourceType || input.source_type, "MARKET_SOURCE_TYPE_REQUIRED"),
    status,
    requiredFor: strings(input.requiredFor || input.required_for),
    coverageStart,
    coverageEnd,
    asOf: nullableIso(input.asOf || input.as_of),
    lastSuccessfulAt: nullableIso(input.lastSuccessfulAt || input.last_successful_at),
    dataCutoff,
    provider: nullable(input.provider),
    datasetVersion: nullable(input.datasetVersion || input.dataset_version),
    missingness: finiteOrNull(input.missingness),
    covered,
    reasonCodes: strings(input.reasonCodes || input.reason_codes),
  };
}

export function evaluateAgriEventCoverageV1({ sourceState, cutoff, familyRequiresAgriEvents = true } = {}) {
  const source = normalizeMarketSourceStateV1(sourceState || {
    sourceId: "market_agri_events", sourceType: "AGRI_EVENT_CALENDAR", status: "UNKNOWN_COVERAGE",
  }, { cutoff });
  const usable = source.status === "AVAILABLE" && source.covered;
  if (usable || !familyRequiresAgriEvents) {
    return { admissible: true, decision: "ADMISSIBLE", source, reasonCodes: usable ? ["AGRI_EVENT_COVERAGE_CONFIRMED"] : ["AGRI_EVENTS_OPTIONAL"] };
  }
  return {
    admissible: false,
    decision: "WAIT",
    source,
    reasonCodes: [source.status === "AVAILABLE" ? "AGRI_EVENT_COVERAGE_GAP" : `AGRI_EVENT_SOURCE_${source.status}`],
  };
}

export function normalizeMarketContextSnapshotV1(input = {}) {
  const sourceDataCutoff = requiredIso(input.sourceDataCutoff || input.source_data_cutoff, "MARKET_CONTEXT_CUTOFF_REQUIRED");
  const time = normalizeContextTimeContract(input, sourceDataCutoff);
  const sourceStates = normalizeContextSources(input, sourceDataCutoff, time);
  const status = canonicalContextStatus(input.status, sourceStates);
  return {
    marketContextSnapshotId: required(input.marketContextSnapshotId || input.market_context_snapshot_id, "MARKET_CONTEXT_ID_REQUIRED"),
    schemaVersion: MARKET_CONTEXT_SCHEMA_VERSION_V1,
    universe: required(input.universe, "MARKET_CONTEXT_UNIVERSE_REQUIRED"),
    createdAt: requiredIso(input.createdAt || input.created_at, "MARKET_CONTEXT_CREATED_AT_REQUIRED"),
    validFrom: requiredIso(input.validFrom || input.valid_from, "MARKET_CONTEXT_VALID_FROM_REQUIRED"),
    validUntil: requiredIso(input.validUntil || input.valid_until, "MARKET_CONTEXT_VALID_UNTIL_REQUIRED"),
    sourceDataCutoff,
    ...time,
    marketState: required(input.marketState || input.market_state, "MARKET_CONTEXT_MARKET_STATE_REQUIRED"),
    marketSession: required(input.marketSession || input.market_session, "MARKET_CONTEXT_MARKET_SESSION_REQUIRED"),
    marketRegime: required(input.marketRegime || input.market_regime, "MARKET_CONTEXT_REGIME_REQUIRED"),
    volatilityRegime: required(input.volatilityRegime || input.volatility_regime, "MARKET_CONTEXT_VOLATILITY_REQUIRED"),
    globalBias: required(input.globalBias || input.global_bias, "MARKET_CONTEXT_BIAS_REQUIRED"),
    instrumentViews: array(input.instrumentViews || input.instrument_views).map(normalizeInstrumentView),
    preferredStrategyFamilies: strings(input.preferredStrategyFamilies || input.preferred_strategy_families),
    discouragedStrategyFamilies: strings(input.discouragedStrategyFamilies || input.discouraged_strategy_families),
    opportunityZones: array(input.opportunityZones || input.opportunity_zones).map(normalizeZone),
    noTradeZones: array(input.noTradeZones || input.no_trade_zones).map(normalizeZone),
    invalidationConditions: array(input.invalidationConditions || input.invalidation_conditions),
    riskMultiplier: boundedNumber(input.riskMultiplier ?? input.risk_multiplier, 1, 0, 1),
    sourceStates,
    reasonCodes: strings(input.reasonCodes || input.reason_codes),
    provenance: array(input.provenance),
    workerId: nullable(input.workerId || input.worker_id),
    taskId: nullable(input.taskId || input.task_id),
    modelPolicyVersion: nullable(input.modelPolicyVersion || input.model_policy_version),
    promptVersion: nullable(input.promptVersion || input.prompt_version),
    supersedesSnapshotId: nullable(input.supersedesSnapshotId || input.supersedes_snapshot_id),
    invalidationReason: nullable(input.invalidationReason || input.invalidation_reason),
    status,
  };
}

export function normalizeMarketDeskBriefV1(input = {}) {
  const sourceDataCutoff = requiredIso(input.sourceDataCutoff || input.source_data_cutoff, "MARKET_DESK_BRIEF_CUTOFF_REQUIRED");
  const time = normalizeContextTimeContract(input, sourceDataCutoff);
  const sourceStates = normalizeContextSources(input, sourceDataCutoff, time);
  return {
    marketDeskBriefId: required(input.marketDeskBriefId || input.market_desk_brief_id, "MARKET_DESK_BRIEF_ID_REQUIRED"),
    marketContextSnapshotId: required(input.marketContextSnapshotId || input.market_context_snapshot_id, "MARKET_DESK_BRIEF_CONTEXT_REQUIRED"),
    schemaVersion: MARKET_DESK_BRIEF_SCHEMA_VERSION_V1,
    universe: required(input.universe, "MARKET_DESK_BRIEF_UNIVERSE_REQUIRED"),
    createdAt: requiredIso(input.createdAt || input.created_at, "MARKET_DESK_BRIEF_CREATED_AT_REQUIRED"),
    validFrom: requiredIso(input.validFrom || input.valid_from, "MARKET_DESK_BRIEF_VALID_FROM_REQUIRED"),
    validUntil: requiredIso(input.validUntil || input.valid_until, "MARKET_DESK_BRIEF_VALID_UNTIL_REQUIRED"),
    sourceDataCutoff,
    ...time,
    status: canonicalContextStatus(input.status, sourceStates),
    headline: required(input.headline, "MARKET_DESK_BRIEF_HEADLINE_REQUIRED"),
    operatorSummary: required(input.operatorSummary || input.operator_summary, "MARKET_DESK_BRIEF_SUMMARY_REQUIRED"),
    marketInterpretation: nullable(input.marketInterpretation || input.market_interpretation),
    deskIntent: nullable(input.deskIntent || input.desk_intent),
    whyNoTrade: nullable(input.whyNoTrade || input.why_no_trade),
    whatDeskWants: strings(input.whatDeskWants || input.what_desk_wants),
    whatDeskAvoids: strings(input.whatDeskAvoids || input.what_desk_avoids),
    opportunityZones: array(input.opportunityZones || input.opportunity_zones).map(normalizeZone),
    noTradeZones: array(input.noTradeZones || input.no_trade_zones).map(normalizeZone),
    invalidationConditions: array(input.invalidationConditions || input.invalidation_conditions),
    currentCatalysts: array(input.currentCatalysts || input.current_catalysts),
    nextExpectedEvents: array(input.nextExpectedEvents || input.next_expected_events),
    instrumentViews: array(input.instrumentViews || input.instrument_views).map(normalizeInstrumentView),
    riskPosture: object(input.riskPosture || input.risk_posture),
    sourceStates,
    reasonCodes: strings(input.reasonCodes || input.reason_codes),
    provenance: array(input.provenance),
    workerId: nullable(input.workerId || input.worker_id),
    taskId: nullable(input.taskId || input.task_id),
    modelPolicyVersion: nullable(input.modelPolicyVersion || input.model_policy_version),
    promptVersion: nullable(input.promptVersion || input.prompt_version),
    supersedesBriefId: nullable(input.supersedesBriefId || input.supersedes_brief_id),
    invalidationReason: nullable(input.invalidationReason || input.invalidation_reason),
  };
}

function normalizeContextTimeContract(input, sourceDataCutoff) {
  const analysis = input.analysisAsOfUtc ?? input.analysis_as_of_utc;
  const market = input.marketDataCutoffUtc ?? input.market_data_cutoff_utc;
  if (analysis === undefined && market === undefined) return {};
  const analysisAsOfUtc = requiredIso(analysis, "MARKET_CONTEXT_ANALYSIS_AS_OF_REQUIRED");
  const marketDataCutoffUtc = requiredIso(market, "MARKET_CONTEXT_MARKET_DATA_CUTOFF_REQUIRED");
  if (sourceDataCutoff !== analysisAsOfUtc) throw coded("MARKET_CONTEXT_KNOWLEDGE_CUTOFF_MISMATCH");
  if (Date.parse(marketDataCutoffUtc) > Date.parse(analysisAsOfUtc)) throw coded("MARKET_CONTEXT_MARKET_DATA_LOOKAHEAD");
  const createdAt = requiredIso(input.createdAt || input.created_at, "MARKET_CONTEXT_CREATED_AT_REQUIRED");
  const validFrom = requiredIso(input.validFrom || input.valid_from, "MARKET_CONTEXT_VALID_FROM_REQUIRED");
  const validUntil = requiredIso(input.validUntil || input.valid_until, "MARKET_CONTEXT_VALID_UNTIL_REQUIRED");
  if (Date.parse(analysisAsOfUtc) > Date.parse(createdAt)
    || Date.parse(validFrom) < Date.parse(createdAt)
    || Date.parse(validUntil) <= Date.parse(validFrom)) throw coded("MARKET_CONTEXT_PUBLICATION_TIME_INVALID");
  return { analysisAsOfUtc, marketDataCutoffUtc };
}

function normalizeContextSources(input, sourceDataCutoff, time) {
  return array(input.sourceStates || input.source_states).map((source) => {
    const sourceType = source.sourceType || source.source_type;
    const cutoff = time.analysisAsOfUtc && sourceType === "OHLCV"
      ? time.marketDataCutoffUtc : sourceDataCutoff;
    const normalized = normalizeMarketSourceStateV1(source, { cutoff });
    if (time.analysisAsOfUtc && normalized.asOf
      && Date.parse(normalized.asOf) > Date.parse(time.analysisAsOfUtc)) throw coded("MARKET_CONTEXT_SOURCE_KNOWLEDGE_LOOKAHEAD");
    return normalized;
  });
}

function canonicalContextStatus(requestedStatus, sourceStates) {
  const requested = member(requestedStatus, MARKET_CONTEXT_STATUSES_V1, "UNAVAILABLE");
  if (requested !== "AVAILABLE") return requested;
  const required = sourceStates.filter((source) => source.requiredFor.length > 0);
  if (required.some((source) => source.status === "UNAVAILABLE" || source.status === "UNKNOWN_COVERAGE")) return "UNAVAILABLE";
  if (required.some((source) => source.status !== "AVAILABLE" || !source.covered)) return "PARTIAL";
  return "AVAILABLE";
}

export function evaluateMarketContextPrefilterV1({ signal = {}, snapshot = null, at = null, familyRequiresAgriEvents = true } = {}) {
  if (!snapshot) return decision("WAIT", ["MARKET_CONTEXT_MISSING"]);
  const context = normalizeMarketContextSnapshotV1(snapshot);
  const evaluatedAt = Date.parse(at || signal.createdAt || signal.created_at || context.sourceDataCutoff);
  if (context.status !== "AVAILABLE") return decision("WAIT", [`MARKET_CONTEXT_${context.status}`]);
  if (!Number.isFinite(evaluatedAt) || evaluatedAt < Date.parse(context.validFrom) || evaluatedAt > Date.parse(context.validUntil)) {
    return decision("WAIT", ["MARKET_CONTEXT_STALE"]);
  }
  const agri = context.sourceStates.find((source) => source.sourceId === "market_agri_events");
  const coverage = evaluateAgriEventCoverageV1({ sourceState: agri, cutoff: context.sourceDataCutoff, familyRequiresAgriEvents });
  if (!coverage.admissible) return decision("WAIT", coverage.reasonCodes);
  const instrument = String(signal.instrument || signal.symbol || "").toUpperCase();
  const side = String(signal.side || signal.direction || "").toUpperCase();
  const family = String(signal.strategyFamily || signal.strategy_family || signal.family || "").toUpperCase();
  const view = context.instrumentViews.find((candidate) => candidate.instrument === instrument);
  if (!view) return decision("WAIT", ["INSTRUMENT_CONTEXT_MISSING"]);
  const contextReasons = [...context.reasonCodes, ...view.reasonCodes].map((value) => value.toUpperCase());
  if (contextReasons.some((code) => code.includes("BLACKOUT"))) return decision("WAIT", ["CONTEXT_BLACKOUT_ACTIVE"]);
  if (context.invalidationConditions.some(conditionActive)) return decision("REJECT", ["CONTEXT_INVALIDATION_ACTIVE"]);
  if (!view.allowedSides.length) return decision("WAIT", ["CONTEXT_NO_ACTIVE_ALLOWED_SIDE"]);
  if (view.allowedSides.length && !view.allowedSides.includes(side)) return decision("REJECT", ["CONTEXT_SIDE_NOT_ALLOWED"]);
  if (context.discouragedStrategyFamilies.includes(family) || view.discouragedFamilies.includes(family)) {
    return decision("REJECT", ["CONTEXT_FAMILY_DISCOURAGED"]);
  }
  const entry = signalEntry(signal);
  const noTradeZones = relevantZones(context.noTradeZones, instrument, side, evaluatedAt);
  if (finite(entry) && noTradeZones.some((zone) => priceInZone(entry, zone))) return decision("REJECT", ["CONTEXT_NO_TRADE_ZONE"]);
  const opportunityZones = relevantZones([...context.opportunityZones, ...view.zones], instrument, side, evaluatedAt);
  if (opportunityZones.length && (!finite(entry) || !opportunityZones.some((zone) => priceInZone(entry, zone)))) {
    return decision("WAIT", ["CONTEXT_OPPORTUNITY_ZONE_MISMATCH"]);
  }
  return decision("ADMISSIBLE", ["CONTEXT_SNAPSHOT_VALID", "CONTEXT_INSTRUMENT_COMPATIBLE"]);
}

export function validateContextAdjustmentProposalV1({ signal = {}, proposal = {}, policy = {}, snapshot = null } = {}) {
  const reasons = [];
  const context = snapshot ? normalizeMarketContextSnapshotV1(snapshot) : null;
  const cutoff = nullableIso(signal.sourceDataCutoff || signal.source_data_cutoff || signal.createdAt || signal.created_at);
  if (!context || context.status !== "AVAILABLE") reasons.push("CONTEXT_SNAPSHOT_NOT_AVAILABLE");
  else if (!cutoff || Date.parse(cutoff) < Date.parse(context.validFrom) || Date.parse(cutoff) > Date.parse(context.validUntil)) reasons.push("CONTEXT_SNAPSHOT_EXPIRED_FOR_SIGNAL");
  const proposalCutoff = nullableIso(proposal.sourceDataCutoff || proposal.source_data_cutoff);
  if (proposalCutoff && context && Date.parse(proposalCutoff) > Date.parse(context.sourceDataCutoff)) reasons.push("ADJUSTMENT_LOOKAHEAD_FORBIDDEN");
  if (text(signal.instrument || signal.symbol).toUpperCase() !== text(proposal.instrument).toUpperCase()) reasons.push("INSTRUMENT_CHANGE_FORBIDDEN");
  if (text(signal.side || signal.direction).toUpperCase() !== text(proposal.side).toUpperCase()) reasons.push("SIDE_CHANGE_FORBIDDEN");
  if (proposal.account !== undefined) reasons.push("ACCOUNT_CHANGE_FORBIDDEN");
  if (proposal.quantity !== undefined && Number(proposal.quantity) > Number(signal.quantity || 0)) reasons.push("QUANTITY_INCREASE_FORBIDDEN");
  if (proposal.orderMode !== undefined || proposal.order_mode !== undefined) reasons.push("ORDER_MODE_CHANGE_FORBIDDEN");
  if (!strings(proposal.reasonCodes || proposal.reason_codes).length) reasons.push("ADJUSTMENT_REASON_CODES_REQUIRED");
  if (!array(proposal.evidenceRefs || proposal.evidence_refs).length) reasons.push("ADJUSTMENT_EVIDENCE_REQUIRED");
  validateEntryAdjustment({ signal, proposal, policy, reasons });
  validateRiskAdjustment({ signal, proposal, reasons });
  validateTargetsAdjustment({ signal, proposal, reasons });
  if (finite(proposal.confidence) && finite(signal.confidence) && Number(proposal.confidence) > Number(signal.confidence)) reasons.push("CONFIDENCE_INCREASE_FORBIDDEN");
  if (finite(proposal.riskMultiplier ?? proposal.risk_multiplier) && Number(proposal.riskMultiplier ?? proposal.risk_multiplier) > 1) reasons.push("RISK_MULTIPLIER_INCREASE_FORBIDDEN");
  return { valid: reasons.length === 0, reasonCodes: reasons.length ? reasons : ["CONTEXT_ADJUSTMENT_VALID"] };
}

function validateEntryAdjustment({ signal, proposal, policy, reasons }) {
  const original = signalEntry(signal);
  const adjusted = finite(proposal.entry) ? Number(proposal.entry) : original;
  const plan = object(signal.proposedTradePlan || signal.proposed_trade_plan);
  const entry = object(plan.entry);
  const low = finite(entry.low) ? Number(entry.low) : null;
  const high = finite(entry.high) ? Number(entry.high) : null;
  if (finite(adjusted) && low !== null && high !== null && (adjusted < low || adjusted > high)) reasons.push("ENTRY_OUTSIDE_STRATEGY_ENVELOPE");
  const maxEntryDelta = Number(policy.maxEntryDelta || policy.max_entry_delta || 0);
  if ((low === null || high === null) && finite(adjusted) && finite(original) && Math.abs(adjusted - original) > maxEntryDelta) reasons.push("ENTRY_OUTSIDE_ENVELOPE");
}

function validateRiskAdjustment({ signal, proposal, reasons }) {
  const entry = finite(proposal.entry) ? Number(proposal.entry) : signalEntry(signal);
  const originalStop = signalStop(signal);
  const adjustedStop = finite(proposal.stop) ? Number(proposal.stop) : originalStop;
  if (![entry, originalStop, adjustedStop].every(finite)) return;
  const side = text(signal.side || signal.direction).toUpperCase();
  const originalRisk = side === "SHORT" ? originalStop - signalEntry(signal) : signalEntry(signal) - originalStop;
  const adjustedRisk = side === "SHORT" ? adjustedStop - entry : entry - adjustedStop;
  if (adjustedRisk > originalRisk + 1e-9) reasons.push("STOP_RISK_INCREASE_FORBIDDEN");
}

function validateTargetsAdjustment({ signal, proposal, reasons }) {
  const original = signalTargets(signal);
  const adjusted = numberArray(proposal.targets);
  if (!original.length || !adjusted.length) return;
  const side = text(signal.side || signal.direction).toUpperCase();
  if (side === "SHORT" && Math.min(...adjusted) < Math.min(...original)) reasons.push("TARGET_EXTENSION_FORBIDDEN");
  if (side !== "SHORT" && Math.max(...adjusted) > Math.max(...original)) reasons.push("TARGET_EXTENSION_FORBIDDEN");
}

function relevantZones(zones, instrument, side, evaluatedAt) {
  return zones.filter((zone) => zone.instrument === instrument)
    .filter((zone) => !zone.direction || zone.direction.toUpperCase() === side)
    .filter((zone) => (!zone.validFrom || evaluatedAt >= Date.parse(zone.validFrom)) && (!zone.validUntil || evaluatedAt <= Date.parse(zone.validUntil)));
}

function priceInZone(price, zone) {
  return (zone.minPrice === null || Number(price) >= zone.minPrice) && (zone.maxPrice === null || Number(price) <= zone.maxPrice);
}

function conditionActive(value) {
  if (!value || typeof value !== "object") return false;
  return value.active === true || value.triggered === true || value.state === "ACTIVE" || value.state === "TRIGGERED";
}

function signalEntry(signal) {
  const plan = object(signal.proposedTradePlan || signal.proposed_trade_plan);
  const entry = object(plan.entry);
  return firstFinite(signal.entry, signal.entry_price, plan.entryPrice, plan.entry_price, entry.price, entry.calculation_price);
}

function signalStop(signal) {
  const plan = object(signal.proposedTradePlan || signal.proposed_trade_plan);
  return firstFinite(signal.stop, signal.stop_price, plan.stopPrice, plan.stop_price, object(plan.stop).price);
}

function signalTargets(signal) {
  const plan = object(signal.proposedTradePlan || signal.proposed_trade_plan);
  return numberArray(signal.targets || plan.targets);
}

function numberArray(value) { return array(value).map((item) => typeof item === "object" ? firstFinite(item.price) : firstFinite(item)).filter(finite); }
function firstFinite(...values) { const value = values.find(finite); return value === undefined ? null : Number(value); }

function normalizeInstrumentView(input = {}) {
  return {
    instrument: required(input.instrument, "MARKET_CONTEXT_INSTRUMENT_REQUIRED").toUpperCase(),
    bias: required(input.bias, "MARKET_CONTEXT_INSTRUMENT_BIAS_REQUIRED"),
    confidence: boundedNumber(input.confidence, 0, 0, 1),
    allowedSides: strings(input.allowedSides || input.allowed_sides).map((value) => value.toUpperCase()),
    preferredFamilies: strings(input.preferredFamilies || input.preferred_families).map((value) => value.toUpperCase()),
    discouragedFamilies: strings(input.discouragedFamilies || input.discouraged_families).map((value) => value.toUpperCase()),
    ownReturn: finiteOrNull(input.ownReturn ?? input.own_return),
    peerReturn: finiteOrNull(input.peerReturn ?? input.peer_return),
    regime: nullable(input.regime),
    volatilityRegime: nullable(input.volatilityRegime || input.volatility_regime),
    zones: array(input.zones).map(normalizeZone),
    reasonCodes: strings(input.reasonCodes || input.reason_codes),
  };
}

function normalizeZone(input = {}) {
  return {
    zoneId: required(input.zoneId || input.zone_id, "MARKET_CONTEXT_ZONE_ID_REQUIRED"),
    instrument: required(input.instrument, "MARKET_CONTEXT_ZONE_INSTRUMENT_REQUIRED").toUpperCase(),
    minPrice: finiteOrNull(input.minPrice ?? input.min_price),
    maxPrice: finiteOrNull(input.maxPrice ?? input.max_price),
    direction: nullable(input.direction),
    priority: nullable(input.priority),
    preferredFamilies: strings(input.preferredFamilies || input.preferred_families),
    requiredConditions: array(input.requiredConditions || input.required_conditions),
    forbiddenConditions: array(input.forbiddenConditions || input.forbidden_conditions),
    validFrom: nullableIso(input.validFrom || input.valid_from),
    validUntil: nullableIso(input.validUntil || input.valid_until),
    confidence: boundedNumber(input.confidence, 0, 0, 1),
    reasonCodes: strings(input.reasonCodes || input.reason_codes),
  };
}

function decision(value, reasonCodes) { return { decision: value, admissible: value === "ADMISSIBLE", reasonCodes }; }
function array(value) { return Array.isArray(value) ? value : []; }
function strings(value) { return array(value).map(text).filter(Boolean); }
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function text(value) { return String(value ?? "").trim(); }
function nullable(value) { return text(value) || null; }
function required(value, code) { const normalized = nullable(value); if (normalized) return normalized; throw coded(code); }
function requiredIso(value, code) { const normalized = nullableIso(value); if (normalized) return normalized; throw coded(code); }
function nullableIso(value) { const parsed = value instanceof Date ? value.getTime() : Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function finite(value) { return (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) && Number.isFinite(Number(value)); }
function finiteOrNull(value) { return finite(value) ? Number(value) : null; }
function boundedNumber(value, fallback, min, max) { const parsed = finite(value) ? Number(value) : fallback; return Math.max(min, Math.min(max, parsed)); }
function member(value, members, fallback) { const normalized = text(value).toUpperCase(); return members.includes(normalized) ? normalized : fallback; }
function coded(code) { const error = new Error(code); error.code = code; return error; }
