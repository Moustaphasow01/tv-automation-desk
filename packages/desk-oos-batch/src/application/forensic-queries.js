import { absentEvidence, eventMatches, forensicPage } from "../domain/forensic-evidence.js";
import { conditionTimeline, ticketSnapshot } from "../domain/forensic-episodes.js";
import { requireFact } from "../domain/batch-contract.js";

const reference = e => ({ date: e.date, scenario_id: e.scenario_id, attempt: e.attempt,
  episode_id: e.episode_id, event_id: e.event_id, timestamp: e.timestamp, event: e.event,
  source_event_hash: e.source_event_hash, provenance_ref: e.provenance_ref });
const briefTrade = t => Object.fromEntries(["trade_id", "scenario_id", "attempt", "direction", "entry_time", "entry",
  "stop_initial", "tp1", "tp2", "exit_time", "exit_reason", "real_R", "real_USD", "source", "recalculated"].map(k => [k, t[k] ?? null]));

export class ForensicQueries {
  constructor({ index, artifacts, repository, fingerprint }) { Object.assign(this, { index, artifacts, repository, fingerprint }); }
  async page(items, query) {
    const catalogue = await this.index.catalogue();
    return forensicPage({ items, query, indexHash: catalogue.index_hash, fingerprint: this.fingerprint });
  }
  async context(args) {
    const day = await this.index.get(args.date), scenario = day.scenarios.find(s => s.scenario_id === args.scenario_id);
    requireFact(scenario, "FORENSIC_SCENARIO_NOT_FOUND");
    const attempts = day.episodes.filter(e => e.scenario_id === args.scenario_id);
    const episode = args.attempt === undefined ? attempts.at(-1) : attempts.find(e => e.attempt === args.attempt);
    const events = episode ? day.events.filter(e => e.episode_id === episode.episode_id) : [];
    return { day, scenario, attempts, episode, events };
  }
  async capabilities() {
    const catalogue = await this.index.catalogue(), days = await Promise.all(catalogue.days.map(d => this.index.get(d.date)));
    return { schema: "OOS_FORENSIC_V2", corpus_days: days.length, index_hash: catalogue.index_hash,
      frozen_plan: days.some(d => d.plan_text), normalized_events: days.some(d => d.events.length),
      episode_ledger: days.some(d => d.episodes.length), published_logs: days.some(d => d.logs.length),
      persisted_1m_bars: false, persisted_5m_bars: false, persisted_15m_bars: false,
      market_bars: absentEvidence("complete_OOS_bar_series"),
      dashboard_structured: days.some(d => d.audit?.published_tables?.length),
      positions_structured: days.some(d => d.audit?.published_position_tables?.length),
      chart_images: days.some(d => d.sources.some(s => s.path === "replay/5m_final.png")),
      counterfactual_audit: days.some(d => d.trades.some(t => t.cf_BE_1 !== null && t.cf_BE_1 !== undefined)),
      rearm_history: days.some(d => d.events.some(e => ["DETACHED", "REARMED"].includes(e.event))),
      classification: "DERIVED_LOCAL", extractor_version: "2.0.0", read_only: true,
      episode_ledger_basis: "Indexed published ENGINE events, not a pre-existing EPISODE_LEDGER file",
      event_ledger_basis: "Indexed SMC_AUDIT/SMC_SHADOW JSONL; exact duplicate publications retained as source offsets",
      other_persisted_artifacts: [...new Set(days.flatMap(d => (d.inventory ?? d.sources).map(s => s.path)))],
      persisted_files_indexed: days.reduce((n, d) => n + (d.inventory?.length ?? d.sources.length), 0),
      file_inventory_classification: "DERIVED_LOCAL",
      limitations: ["No continuous OHLC history was found in the OOS corpus. Sparse event OHLC is not a market series.",
        "Unpublished condition evaluations, portfolio risk and ticket fields remain NOT_PERSISTED."] };
  }
  async dayIndex(args) {
    const catalogue = await this.index.catalogue();
    const items = catalogue.days.filter(d => (!args.date || d.date === args.date) && (!args.month || d.date.startsWith(args.month))
      && (!args.state || d.state === args.state) && (!args.sample_purpose || d.sample_purpose === args.sample_purpose)
      && (args.scorable === undefined || d.scorable === args.scorable));
    return this.page(items, args);
  }
  async frozenPlan({ date }) {
    const day = await this.index.get(date), source = day.sources.find(s => s.path === "plan/PLAN_SMC3.txt");
    const bytes = await this.artifacts.archive.read(day.definition, source.path);
    requireFact(this.fingerprint(bytes) === day.identity.plan_sha256, "FORENSIC_INTEGRITY_VIOLATION");
    return { available: true, date, ...day.plan_meta, manifest_sha256: day.identity.manifest_sha256,
      plan_text: bytes.toString("utf8"), exact_utf8: true, provenance: source.provenance };
  }
  async scenarios(args) {
    const day = await this.index.get(args.date);
    return this.page(day.scenarios.map(({ records, global_records, provenance, ...s }) => ({ ...s,
      provenance_ref: provenance.provenance_ref, attempt_count: day.episodes.filter(e => e.scenario_id === s.scenario_id).length,
      terminal_state_final: day.episodes.filter(e => e.scenario_id === s.scenario_id).at(-1)?.terminal_state ?? absentEvidence("terminal_state") })), args);
  }
  async planScenario(args) {
    const { scenario } = await this.context(args);
    return { available: true, ...scenario, associated_record_semantics: "Frozen records verbatim; shared PLAN/NOTICE/GAP/GROUP are labelled global_records" };
  }
  async attempts(args) {
    const { attempts } = await this.context(args);
    if (!attempts.length) return absentEvidence("published_scenario_attempts");
    return this.page(attempts, args);
  }
  async packet(args) {
    const { day, scenario, episode, events } = await this.context(args);
    const confirmation = events.find(e => e.event === "CONFIRMED");
    const terminal = events.filter(e => e.timestamp === episode?.terminal_time && e.stage_after === episode?.terminal_state).at(-1);
    return { available: true, date: args.date, scenario_id: args.scenario_id, attempt: episode?.attempt ?? null,
      PLAN_DEFINITION: { ...scenario, global_records: undefined }, EPISODE_METADATA: episode ?? absentEvidence("episode"),
      TIMELINE_SUMMARY: events.map(reference), CONFIRMATION_SNAPSHOT: confirmation ? reference(confirmation) : absentEvidence("confirmation"),
      TICKET_SNAPSHOT: this.lightTicket(ticketSnapshot(events)), TERMINAL_SNAPSHOT: terminal ? reference(terminal) : absentEvidence("terminal_event"),
      TRADE_REF: day.trades.filter(t => t.episode_id === episode?.episode_id).map(briefTrade),
      MARKET_WINDOW_REF: { date: args.date, start_time: episode?.start_time, end_time: episode?.terminal_time,
        available: false, reason: "NOT_PERSISTED" },
      ARTIFACT_REFS: day.sources.filter(s => s.path.startsWith("replay/")).map(({ path, sha256, provenance }) => ({ path, sha256, provenance_ref: provenance.provenance_ref })),
      EVENT_CURSOR: { tool: "get_forensic_events", arguments: { date: args.date, scenario_id: args.scenario_id, attempt: episode?.attempt } },
      provenance: scenario.provenance, no_automatic_images_or_logs: true };
  }
  lightTicket(ticket) {
    if (!ticket.available) return ticket;
    const { provenance, ...value } = ticket; return { ...value, provenance_ref: provenance.provenance_ref };
  }
  async events(args) {
    const day = await this.index.get(args.date);
    if (!day.events.length) return absentEvidence("published_events");
    return this.page(day.events.filter(e => eventMatches(e, args)), args);
  }
  async conditions(args) {
    const context = await this.context(args);
    if (!context.episode) return absentEvidence("episode");
    return { ...await this.page(conditionTimeline(context), args), classification: "DERIVED_LOCAL" };
  }
  async decision(args) {
    requireFact(Boolean(args.event_id) !== Boolean(args.timestamp), "FORENSIC_DECISION_REFERENCE_REQUIRED");
    const { events } = await this.context(args);
    const matches = events.filter(e => args.event_id ? e.event_id === args.event_id : e.timestamp === new Date(args.timestamp).toISOString());
    if (!matches.length) return absentEvidence("exact_decision_snapshot");
    if (matches.length > 1) return { available: false, reason: "AMBIGUOUS_TIMESTAMP", event_ids: matches.map(e => e.event_id) };
    return { available: true, snapshot: matches[0], missing_fields: ["costRatio", "entry_zone_runtime", "all_filters_evaluated",
      "portfolio_state", "group_state"].map(absentEvidence), no_future_lookup: true };
  }
  async ticket(args) {
    const { scenario, events } = await this.context(args);
    return { ...ticketSnapshot(events), plan_definition: { entry_type: scenario.entry_type, entry_rule: scenario.entry_rule,
      entry_zone: scenario.entry_zone, stop_rule: scenario.stop_rule }, plan_provenance: scenario.provenance };
  }
  async refusal(args) {
    const { events } = await this.context(args), refusals = events.filter(e => e.event === "NON_ELIGIBLE");
    return { available: refusals.length > 0, ...(refusals.length ? {} : { reason: "NOT_PERSISTED" }),
      all_refusal_events: refusals.map(e => ({ timestamp: e.timestamp, reason_codes: e.reason_codes, snapshot_ref: e.event_id,
        proof: { entry: e.entry, stop: e.stop, tp1: e.tp1, tp2: e.tp2, risk: e.risk, cost: e.cost,
          minRisk: e.minRisk, maxRisk: e.maxRisk, rr_gross: e.rr_gross, rr_net: e.rr_net, detail: e.detail, OHLC: e.OHLC },
        unpublished_proofs: absentEvidence("filter-specific_evaluation_values"), provenance: e })) };
  }
  async rearm(args) {
    const { day, scenario, attempts } = await this.context(args);
    const timeline = await this.page(day.events.filter(e => e.scenario_id === args.scenario_id
      && ["DETACHED", "REARMED", "CONFIRMED"].includes(e.event)), args);
    return { ...timeline, definition: scenario.rearm, attempts,
      outside_count: absentEvidence("outside_count"), outside_side: absentEvidence("outside_side"),
      reset_gate: absentEvidence("reset_gate"), fresh_proof_start: absentEvidence("fresh_proof_start") };
  }
  async group(args) {
    const day = await this.index.get(args.date), definition = day.records.find(r => r.record_type === "GROUP" && r.decoded.group_id === args.group_id);
    if (!definition) return absentEvidence("group_definition");
    const members = day.records.filter(r => r.record_type === "MEMBER" && r.decoded.group_id === args.group_id).map(r => r.decoded.scenario_id);
    const timeline = await this.page(day.events.filter(e => members.includes(e.scenario_id)
      && ["PAUSED_GROUP", "OCO_CANCEL", "UNKNOWN_ORDER", "FILLED", "CLOSED", "CANCELLED_LINK"].includes(e.event)), args);
    return { ...timeline, definition, policy: definition.decoded.policy, member_scenarios: members,
      occupancy_timeline: absentEvidence("published_group_occupancy"), family_state: absentEvidence("published_family_state") };
  }
  async portfolio(args) {
    const day = await this.index.get(args.date), events = day.events.filter(e => ["PAUSED_DIRECTION", "FILLED", "CLOSED", "ARMED", "UNKNOWN_ORDER"].includes(e.event));
    if (!events.length) return absentEvidence("published_portfolio_events");
    return { ...await this.page(events, args),
      flat_long_short: absentEvidence("published_portfolio_snapshot"), reserved_risk: absentEvidence("reserved_risk"),
      open_risk: absentEvidence("open_risk"), no_reconstructed_portfolio: true };
  }
  async trades(args) {
    const day = await this.index.get(args.date);
    if (!day.scorable) return absentEvidence("published_trades");
    return this.page(day.trades.map(briefTrade), args);
  }
  async trade(args) {
    const day = await this.index.get(args.date), trade = day.trades.find(t => t.trade_id === args.trade_id);
    return trade ? { available: true, ...trade } : absentEvidence("trade");
  }
  async counterfactual(args) {
    const days = await this.selectedDays(args), items = days.flatMap(d => d.trades.filter(t => (!args.trade_id || t.trade_id === args.trade_id)
      && (!args.scenario_id || t.scenario_id === args.scenario_id)).map(t => ({ date: d.identity.date, trade_id: t.trade_id,
      scenario_id: t.scenario_id, attempt: t.attempt, REAL: t.real_R ?? absentEvidence("REAL"),
      "BE0.5": t.cf_BE_0_5 ?? absentEvidence("BE0.5"), BE1: t.cf_BE_1 ?? absentEvidence("BE1"),
      "BE1.5": t.cf_BE_1_5 ?? absentEvidence("BE1.5"), "P1@1R": t.cf_P1_at_1R ?? absentEvidence("P1@1R"),
      source: "ENGINE_PUBLISHED_ONLY", recalculated: false, provenance_ref: t.provenance.provenance_ref })));
    return this.page(items, args);
  }
  async logs(args) {
    const day = await this.index.get(args.date), source = day.sources.find(s => s.path === "replay/logs.txt");
    if (!source) return absentEvidence("published_logs");
    const events = day.events.filter(e => eventMatches(e, args));
    const offsets = new Set(events.flatMap(e => e.source_offsets));
    const filtered = args.scenario_id || args.attempt !== undefined || args.event || args.start_time || args.end_time;
    return this.page(day.logs.filter(l => !filtered || offsets.has(l.record_offset)).map(l => ({ ...l, provenance: {
      ...source.provenance, record_offset: l.record_offset, source_event_hash: l.source_event_hash,
      provenance_ref: this.fingerprint(`${source.provenance.source_path}|${source.sha256}|${l.record_offset}`) } })), args);
  }
  async selectedDays(args) {
    const catalogue = await this.index.catalogue();
    return Promise.all(catalogue.days.filter(d => (!args.date || d.date === args.date)
      && (!args.months || args.months.some(m => d.date.startsWith(m)))).map(d => this.index.get(d.date)));
  }
}

export { reference };
