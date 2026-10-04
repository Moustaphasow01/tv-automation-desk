import { absentEvidence } from "./forensic-evidence.js";

const TERMINAL = new Set(["CLOSED", "INVALIDATED", "EXPIRED", "NON_ELIGIBLE", "CANCELLED_LINK", "OCO_CANCEL", "UNKNOWN_ORDER"]);
const has = (events, names) => events.some(e => names.includes(e.event));
const first = (events, names) => events.find(e => names.includes(e.event))?.timestamp ?? null;

export function forensicEpisodes({ events, scenarios }) {
  const groups = new Map();
  for (const event of events.filter(e => e.scenario_id !== "PLAN")) {
    if (!groups.has(event.episode_id)) groups.set(event.episode_id, []);
    groups.get(event.episode_id).push(event);
  }
  return [...groups.entries()].map(([episode_id, rows]) => {
    const head = rows[0], terminal = rows.filter(e => TERMINAL.has(e.event)).at(-1);
    return { episode_id, scenario_id: head.scenario_id, attempt: head.attempt,
      start_time: head.timestamp, terminal_time: terminal?.timestamp ?? null,
      terminal_state: terminal?.stage_after ?? terminal?.event ?? null,
      activated: has(rows, ["WATCH", "ACTIVE"]), confirmed: has(rows, ["CONFIRMED"]),
      admitted: has(rows, ["ARMED"]), armed: has(rows, ["ARMED"]), filled: has(rows, ["FILLED"]),
      closed: has(rows, ["CLOSED", "TRADE_EXIT"]), fill_count: rows.filter(e => e.event === "FILLED").length,
      confirmation_time: first(rows, ["CONFIRMED"]), admission_time: first(rows, ["ARMED", "NON_ELIGIBLE"]),
      reason_codes: [...new Set(rows.flatMap(e => e.reason_codes))], event_count: rows.length,
      event_ids: rows.map(e => e.event_id), observed_only: true, classification: "DERIVED_LOCAL",
      admission_evidence: has(rows, ["ARMED", "NON_ELIGIBLE"]) ? "ENGINE_EVENT" : absentEvidence("admission"),
      definition_present: scenarios.some(s => s.scenario_id === head.scenario_id) };
  });
}

export function conditionTimeline({ scenario, episode, events }) {
  const conditions = scenario.records.filter(r => ["STEP", "INV", "GUARD"].includes(r.record_type));
  let step = 0;
  return conditions.map(record => {
    const index = record.record_type === "STEP" ? ++step : null;
    const hits = events.filter(e => index && e.event === `STEP_${index}`);
    return { condition_id: record.provenance_ref, definition: record.raw, ...record.decoded,
      record_type: record.record_type, step_index: index,
      first_evaluated_at: absentEvidence("first_evaluated_at"),
      hits: hits.map(e => ({ timestamp: e.timestamp, event_id: e.event_id, source_event_hash: e.source_event_hash })),
      hits_complete: false, hit_semantics: "PUBLISHED_STEP_COMPLETION_ONLY",
      completed_at: hits.at(-1)?.timestamp ?? null, failed_at: absentEvidence("failed_at"),
      reset_at: absentEvidence("reset_at"), available_before_cutoff: absentEvidence("pre_cutoff_condition_evaluation"),
      episode_id: episode.episode_id, provenance: record, classification: "DERIVED_LOCAL",
      limitation: "Only published STEP completions are linked. INV/GUARD evaluation histories are not inferred from reason codes." };
  });
}

export function ticketSnapshot(events) {
  const confirmation = events.find(e => e.event === "CONFIRMED");
  const decision = events.filter(e => ["NON_ELIGIBLE", "ARMED"].includes(e.event)).at(-1);
  const selected = decision ?? confirmation;
  if (!selected) return absentEvidence("ticket_snapshot");
  return { available: true, snapshot_ref: selected.event_id, confirmation_time: confirmation?.timestamp ?? null,
    admission_time: decision?.timestamp ?? null, entry: selected.entry, stop: selected.stop,
    target1: selected.tp1, target2: selected.tp2, risk_points: selected.risk,
    cost_usd: selected.cost, rr_gross: selected.rr_gross, rr_net: selected.rr_net, qty: selected.quantity,
    used_extreme: selected.used_extreme, admitted: decision ? decision.event === "ARMED" : null,
    reason_codes: selected.reason_codes, provenance: selected,
    missing_fields: ["entry_cap", "risk_usd", "cost_ratio", "ready_expiry", "order_expiry",
      "target_seen_since_confirm", "target_before_order"].map(field => absentEvidence(field)) };
}
