import { missing, observation, RESEARCH_VERSION, requireResearch } from "./research-evidence.js";

export const QUALITY_LAYERS = ["MAP", "CONFIRMATION", "EXECUTION_GEOMETRY", "PORTFOLIO_REENTRY", "MANAGEMENT"];
export const AUDIT_QUESTIONS = {
  A: "Why did this scenario exist? PREMARKET observations, HTF, zone, liquidity, structure, hypothesis.",
  B: "What exactly was expected? Direction, ordered steps, confirmation, entry, stop, targets, invalidation, RR, time window.",
  C: "What actually happened? Published activation, steps, confirmation, admission/refusal, fill, excursion, exit, end-state.",
  D: "If not triggered, what is known about the missing prerequisites and path? Do not equate no publication with false.",
  E: "If confirmed but not traded, what ENGINE reason and historical snapshot explain the admission/non-fill?",
  F: "If traded, which quality layer is implicated, and which alternative explanations remain possible?",
  G: "After T1/T2/T3, does persisted evidence distinguish direction understood but unmonetized from an initially wrong thesis?",
};
const seen = (rows, event) => rows.some(r => r.event === event);
const refs = rows => rows.map(r => r.provenance_ref ?? r.source_event_hash ?? r.event_id).filter(Boolean);
const firstTime = (rows, event) => rows.find(r => r.event === event)?.timestamp;
const elapsed = (start, end) => start && end && Date.parse(end) >= Date.parse(start) ? (Date.parse(end) - Date.parse(start)) / 60000 : null;

export function createScenarioSelfAudit({ identity, packet, events, trades, fingerprint }) {
  const definition = packet.PLAN_DEFINITION, records = definition.records ?? [];
  requireResearch(definition.scenario_id === packet.scenario_id, "RESEARCH_SCENARIO_MISMATCH");
  const caseId = fingerprint(`${identity.date}|${packet.scenario_id}|${packet.attempt ?? "UNOBSERVED"}|${identity.plan_sha256}`);
  const evidenceRefs = [...new Set([...refs(events), ...refs(records), definition.provenance?.provenance_ref,
    ...trades.map(t => t.provenance?.provenance_ref)].filter(Boolean))];
  return { schema: RESEARCH_VERSION, audit_type: "SCENARIO_SELF_AUDIT", case_id: caseId, identity,
    scenario_id: packet.scenario_id, attempt: packet.attempt, episode_id: packet.EPISODE_METADATA?.episode_id ?? null,
    expected_path: records.filter(r => ["SCN", "STEP", "INV", "GUARD", "ENTRY_ZONE", "STOP_ZONE", "REARM", "EXIT"].includes(r.record_type)),
    planner_rationale: missing("original_planner_rationale_not_in_frozen_SMC3"),
    observations: observedLifecycle({ packet, events, trades }), features: scenarioFeatures({ definition, events }),
    questions: Object.fromEntries(Object.entries(AUDIT_QUESTIONS).map(([id, question]) => [id, { question, status: "UNANSWERED" }])),
    quality_layers: QUALITY_LAYERS, attribution: "UNKNOWN", conclusions: [],
    trade_autopsy: tradeAutopsies(trades),
    evidence_refs: evidenceRefs, classification: "DERIVED_LOCAL", causal_claims_established: false,
    coverage: { engine_publications_only: true, absence_is_not_negative_evidence: true,
      continuous_market_path: packet.MARKET_WINDOW_REF ?? missing("continuous_market_path") } };
}

function tradeAutopsies(trades) {
  return trades.map(t => ({ trade_id: t.trade_id, kind: Number.isFinite(t.real_R)
    ? (t.real_R > 0 ? "WINNER_AUTOPSY" : t.real_R < 0 ? "LOSER_AUTOPSY" : "FLAT_AUTOPSY") : "UNKNOWN_AUTOPSY",
    engine_real_R: t.real_R ?? missing("real_R"), interpretation: "UNKNOWN" }));
}

function observedLifecycle({ packet, events, trades }) {
  const episode = packet.EPISODE_METADATA;
  return { episode: episode, published_event_count: events.length,
    activated: seen(events, "ACTIVE") || seen(events, "WATCH"), confirmed: seen(events, "CONFIRMED"),
    admitted: seen(events, "ARMED"), refused: seen(events, "NON_ELIGIBLE"), filled: seen(events, "FILLED"),
    closed: seen(events, "CLOSED") || seen(events, "TRADE_EXIT"),
    lifecycle_flag_semantics: "PUBLICATION_PRESENT_ONLY_FALSE_IS_NOT_A_NEGATIVE_MARKET_FACT",
    reason_codes: [...new Set(events.flatMap(e => e.reason_codes ?? []))],
    timeline: events.map(e => ({ event_id: e.event_id, timestamp: e.timestamp, event: e.event,
      reason_codes: e.reason_codes, provenance_ref: e.provenance_ref, source_event_hash: e.source_event_hash })),
    ticket: packet.TICKET_SNAPSHOT, trades, terminal_state: episode?.terminal_state ?? missing("terminal_state") };
}

function scenarioFeatures({ definition, events }) {
  const planRefs = [definition.provenance?.provenance_ref], eventRefs = refs(events);
  const confirmation = events.find(e => e.event === "CONFIRMED");
  const width = definition.entry_zone && Number.isFinite(definition.entry_zone.lo) && Number.isFinite(definition.entry_zone.hi)
    ? definition.entry_zone.hi - definition.entry_zone.lo : null;
  return { direction: observation(definition.direction, planRefs, "direction"),
    priority: observation(definition.priority, planRefs, "priority"),
    entry_rule: observation(definition.entry_rule, planRefs, "entry_rule"),
    stop_rule: observation(definition.stop_rule, planRefs, "stop_rule"),
    confirmation_step_count: observation(definition.steps_count, planRefs, "confirmation_step_count"),
    entry_zone_width: observation(width, planRefs, "entry_zone_width"),
    confirmation_duration_minutes: observation(elapsed(firstTime(events, "STEP_1"), confirmation?.timestamp), eventRefs, "confirmation_duration_minutes"),
    time_to_entry_minutes: observation(elapsed(confirmation?.timestamp, firstTime(events, "FILLED")), eventRefs, "time_to_entry_minutes"),
    atr_at_confirmation: observation(confirmation?.atr, eventRefs, "atr_at_confirmation"),
    rr_gross: observation(confirmation?.rr_gross, eventRefs, "rr_gross"),
    rr_net: observation(confirmation?.rr_net, eventRefs, "rr_net"),
    htf_bias: missing("HTF_bias"), distance_to_liquidity: missing("distance_to_liquidity"),
    distance_to_vwap: missing("distance_to_VWAP"), market_regime: missing("predefined_point_in_time_regime"),
    movement_consumed_before_confirmation: missing("continuous_market_path"), portfolio_state: missing("portfolio_snapshot") };
}

/** A family is an exact structural signature, NOT an assertion of similar market opportunity. */
export function scenarioFamilyKey(audit, fingerprint) {
  const fields = ["direction", "entry_rule", "stop_rule", "confirmation_step_count"];
  const conditions = audit.expected_path.filter(r => r.record_type === "STEP").map(r => ({
    operator: r.decoded?.operator ?? r.decoded?.type ?? null, timeframe: r.decoded?.timeframe ?? null }));
  return fingerprint(JSON.stringify({ fields: fields.map(k => audit.features[k]?.value ?? null), conditions }));
}
