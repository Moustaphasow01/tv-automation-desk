import { absentEvidence, eventMatches } from "../domain/forensic-evidence.js";
import { reference } from "./forensic-queries.js";

function scenarioMatches({ scenario, episodes, trades, events, query }) {
  const filters = [!query.direction || scenario.direction === query.direction,
    !query.entry_rule || scenario.entry_rule === query.entry_rule,
    !query.stop_rule || scenario.stop_rule === query.stop_rule,
    query.has_rearm === undefined || Boolean(scenario.rearm) === query.has_rearm,
    query.filled === undefined || (trades.length > 0) === query.filled,
    query.wins === undefined || trades.some(t => t.real_R > 0) === query.wins,
    query.losses === undefined || trades.some(t => t.real_R < 0) === query.losses,
    !query.reason_code || events.some(e => e.reason_codes.includes(query.reason_code)),
    !query.group_policy || scenario.group?.policy === query.group_policy,
    query.step_count === undefined || scenario.steps_count === query.step_count,
    !query.terminal_state || episodes.some(e => e.terminal_state === query.terminal_state)];
  return filters.every(Boolean);
}

export class ForensicSearch {
  constructor(queries) { this.queries = queries; }
  async events(args) {
    const days = await this.queries.selectedDays(args), items = [];
    for (const day of days) for (const event of day.events.filter(e => eventMatches(e, args))) {
      const scenario = day.scenarios.find(s => s.scenario_id === event.scenario_id);
      const episode = day.episodes.find(e => e.episode_id === event.episode_id);
      const facts = { direction: scenario?.direction, confirmed: episode?.confirmed, admitted: episode?.admitted, filled: episode?.filled };
      const checks = [!args.scenario_pattern || event.scenario_id.includes(args.scenario_pattern),
        Object.entries(facts).every(([key, value]) => args[key] === undefined || args[key] === value),
        args.attempt_min === undefined || event.attempt >= args.attempt_min,
        args.attempt_max === undefined || event.attempt <= args.attempt_max,
        !args.terminal_state || episode?.terminal_state === args.terminal_state];
      if (checks.every(Boolean)) items.push(reference(event));
    }
    return this.queries.page(items, args);
  }
  async scenarios(args) {
    const days = await this.queries.selectedDays(args), items = [];
    for (const day of days) for (const scenario of day.scenarios) {
      const episodes = day.episodes.filter(e => e.scenario_id === scenario.scenario_id);
      const trades = day.trades.filter(e => e.scenario_id === scenario.scenario_id);
      const events = day.events.filter(e => e.scenario_id === scenario.scenario_id);
      if (scenarioMatches({ scenario, episodes, trades, events, query: args })) items.push({ date: day.identity.date,
        scenario_id: scenario.scenario_id, provenance_ref: scenario.provenance.provenance_ref,
        episode_ids: episodes.map(e => e.episode_id), trade_ids: trades.map(t => t.trade_id) });
    }
    return this.queries.page(items, args);
  }
  async provenance({ ref }) {
    const days = await this.queries.selectedDays({});
    for (const day of days) {
      const direct = [...day.sources.map(s => s.provenance), ...day.records, ...day.events].find(p =>
        p.provenance_ref === ref || p.event_id === ref || p.source_event_hash === ref);
      if (direct) return { available: true, ...direct };
      const episode = day.episodes.find(e => e.episode_id === ref);
      if (episode) return { available: true, classification: "DERIVED_LOCAL", episode,
        sources: day.events.filter(e => e.episode_id === ref).map(reference) };
      const trade = day.trades.find(t => t.trade_id === ref);
      if (trade) return { available: true, ...trade.provenance, trade_id: ref };
      const log = day.logs.find(l => l.source_event_hash === ref);
      if (log) return { available: true, ...day.sources.find(s => s.path === "replay/logs.txt").provenance, ...log };
    }
    return absentEvidence("provenance_ref");
  }
}
