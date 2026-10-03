import { requireFact } from "../domain/batch-contract.js";

/** Explicit read-only dispatch. No capture, replay, plan writer, risk or trading dependency. */
export class ForensicApi {
  constructor({ queries, search, market, artifacts }) {
    this.tools = {
      get_forensic_capabilities: () => queries.capabilities(),
      get_forensic_index: args => queries.dayIndex(args),
      get_frozen_plan: args => queries.frozenPlan(args),
      list_forensic_scenarios: args => queries.scenarios(args),
      get_plan_scenario: args => queries.planScenario(args),
      list_scenario_attempts: args => queries.attempts(args),
      get_scenario_forensic_packet: args => queries.packet(args),
      get_forensic_events: args => queries.events(args),
      get_condition_timeline: args => queries.conditions(args),
      get_decision_snapshot: args => queries.decision(args),
      get_ticket_snapshot: args => queries.ticket(args),
      get_refusal_detail: args => queries.refusal(args),
      get_rearm_history: args => queries.rearm(args),
      get_group_history: args => queries.group(args),
      get_portfolio_timeline: args => queries.portfolio(args),
      list_trades: args => queries.trades(args),
      get_trade_forensics: args => queries.trade(args),
      get_counterfactual_audit: args => queries.counterfactual(args),
      get_persisted_market_bars: args => market.bars(args),
      get_market_window: args => market.window(args),
      get_level_interactions: args => market.interactions(args),
      get_replay_artifact: args => artifacts.artifact(args),
      get_artifact_crop: args => artifacts.cropArtifact(args),
      get_structured_panel: args => artifacts.panel(args),
      get_audit_json: args => artifacts.artifact({ ...args, artifact: "audit_json" }),
      get_run_meta_json: args => artifacts.artifact({ ...args, artifact: "run_meta_json" }),
      get_logs_slice: args => queries.logs(args),
      search_forensic_events: args => search.events(args),
      search_forensic_scenarios: args => search.scenarios(args),
      verify_forensic_integrity: args => artifacts.verify({ ...args, repository: queries.repository }),
      get_forensic_provenance: args => search.provenance(args),
    };
  }
  async call(name, args) {
    requireFact(Object.hasOwn(this.tools, name), "FORENSIC_TOOL_UNKNOWN");
    return this.tools[name](args);
  }
}
