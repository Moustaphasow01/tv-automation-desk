// A read model of the installed ENGINE. No ticket is evaluated or changed here.
export function describeEngineConstraints({ facts, provenance, functions }) {
  const value = name => facts.inputs[name].value;
  return {
    contract_version: "desk-oos-engine-constraints/1", engine_version: `V${facts.version}`, schema: "SMC3",
    book_mode: value("bookMode"), execution_timeframe: `${facts.execution_period}m`,
    intrabar_timeframe: `${facts.intrabar_period}m`, timezone: facts.timezone,
    scope: "INSTALLED_ENGINE_AND_ACTIVE_INPUTS_NOT_NEW_TRADING_POLICY", provenance,
    entry_window: { start: facts.entry_start, end: facts.entry_end, new_entries_after_end: false,
      existing_positions_can_continue: true, end_exclusive: true, alignment_minutes: facts.bar_ms / 60000,
      blocked_by_input: value("blockEntries"), session_end_does_not_force_close: true },
    rr: { minimum_gross: facts.rr_gross, minimum_net: facts.rr_net,
      net_required_when_costs_known: true, net_check: "ALWAYS; undefined RR_NET is rejected, including when costs are zero",
      tolerance: 1e-8, gross_formula: "direction*(TP1-entry) / (direction*(entry-stop))",
      net_formula: "(direction*(TP1-entry)-cost_points)/(direction*(entry-stop)+cost_points)",
      applies_to: "TP1; syntax acceptance is not execution admission" },
    ...riskConstraints(facts), ...episodeConstraints(facts), ...orderConstraints(facts),
    groups: { INDEPENDENT: "No group occupancy lock", SERIAL: "Active positions or pending orders reserve family; priority only allocates among candidates",
      OCO_FILL: "Cancel other ARMED group orders after proven first fill, not after arming; unresolved same-slice competition -> N/D" },
    data: { standard_candles_required: true, native_roots_supported: ["MES", "MNQ"], oos_validator_symbol: "CME_MINI:MES1!",
      mes_tick_size: 0.25, mes_point_value_usd: 5, closed_bar_conditions_only: true,
      undeclared_gap: "Suspend plan; pending/existing unresolved exposure -> N/D; never invent bars", declared_gap: "GAP must exactly match missing interval; reset incomplete condition streaks" },
    capacities: { plan_text_characters: facts.max_text, trade_shadow_store: facts.store_limit,
      event_map_halt_threshold: 49000, journal_capacity: value("journalCapacity"), scenarios_business_limit: null,
      capacity_overflow: "Explicit halt/reject; no truncation" },
    filters: functions.flatMap(item => [...item.source.matchAll(/(?:(?:err|why) \+=|err :=) "([A-Z0-9_]+);"/g)].map(match => match[1]))
      .filter((code, index, values) => values.indexOf(code) === index),
    source_evidence: functions,
  };
}

function riskConstraints(facts) {
  const value = name => facts.inputs[name].value;
  return { stop: { minimum_ticks: value("minStopTicks"), buffer_ticks: { source: "SCN.stop_buffer_ticks", default: 2, minimum: 2, maximum: 100 },
      atr_min: value("minStopAtr"), atr_max: value("maxStopAtr"), dynamic_buffer_atr: facts.stop_atr_buffer,
      dynamic_margin: "max(SCN.stop_buffer_ticks*tick, ceil(previous_ATR14*0.10/tick)*tick)",
      minimum_distance: "max(minimum_ticks*tick, previous_ATR14*atr_min)", maximum_distance: "previous_ATR14*atr_max",
      atr_period: 14, atr_source: "previous closed classic 15m bar; missing/nonpositive ATR rejects ticket", fixed_stop_buffer_applied: false },
    costs: { commission_round_trip_usd_per_contract: value("commissionRoundTrip"),
      slippage_ticks_per_side: value("estimatedSlippageTicks"), cost_per_trade: value("commissionRoundTrip") + 2 * value("estimatedSlippageTicks") * 0.25 * 5,
      currency: "USD", per: "contract_round_trip", formula: "commission_round_trip + 2*slippage_ticks_per_side*tick_size*point_value",
      max_cost_to_risk: value("maxCostRisk"), model: "Hypothetical total round-trip costs; not additional fill-price adjustment" },
    portfolio: { same_direction_multiple_positions: true, opposite_simultaneous_positions: false,
      direction_lock_behavior: "First known fill locks direction while active. Opposite ARMED orders become PAUSED_DIRECTION, not analytically invalid. After FLAT, frozen eligibility is rechecked at a later M15 close; never backfilled.",
      retroactive_fill: false, risk_usd_per_ticket: value("cashBudget"), sim_contracts_when_zero_budget: value("simContracts"),
      max_contracts: value("maxContracts"), portfolio_risk_cap_usd: value("portfolioCap"), zero_cap_means: "unbounded_in_simulation",
      reference_capital_usd: value("initialCapital"), pending_orders_reserve_risk: true,
      unit_risk: "direction*(entry-stop)*point_value + round_trip_cost; open risk uses remaining contracts/current stop",
      unknown_book: "New admission blocked; no winner selected for opposite fills with unresolved chronology" },
  };
}

function episodeConstraints(facts) {
  const value = name => facts.inputs[name].value;
  return { rearm: { enabled_only_if_rearm_record: true, fresh_proof_required: true, old_confirmation_reuse_allowed: false,
      eligible_terminal: ["CLOSED", "NON_ELIGIBLE", "INVALIDATED", "EXPIRED_except_SESSION_END", "REARM_WAIT"],
      forbidden_terminal: ["CANCELLED_LINK", "UNKNOWN", "PLAN_HALTED", "EXPIRED_SESSION_END"],
      behavior: "Cooldown since terminal bar; consecutive entire M15 bars outside the zone plus away_ticks on the same side; later return intersects zone; increment episode and clear all proofs. New proof begins next M15 bar.",
      max_attempts_zero: "unbounded", group_unknown_blocks_rearm: true },
    intrabar_ambiguity: { favorable_assumption_allowed: false, unknown_policy: "N/D, not an assumed stop-first or target-first outcome",
      enabled: value("useIntrabars"), complete_1m_required: 15, fallback: "whole classic M15 OHLC if M1 coverage incomplete",
      coverage: "15 contiguous valid 1m OHLC; exact timestamps; aggregate O/C/H/L match M15 within 0.1 tick",
      chronological_open_precedence: true, entry_conflict: "entry/stop/TP in same unresolved slice -> UNKNOWN_ORDER when chronology not provable",
      position_conflict: "SL and TP in same unresolved slice -> UNKNOWN unless open establishes precedence",
      oco_conflict: "OCO_CHRONOLOGIE_INCONNUE; family suspended", direction_conflict: "DIRECTION_CHRONOLOGIE_INCONNUE; book unknown" },
  };
}

function orderConstraints(facts) {
  const value = name => facts.inputs[name].value;
  return { orders: { earliest_fill: "slice.start >= armedTime; armedTime is confirmation/admission close; never a previous bar",
      next_open: "First slice open after admission only; recheck geometry at actual open", limit_penetration_ticks: value("limitPenTicks"),
      target_penetration_ticks: value("limitPenTicks"), limit_fill_price: "Open if penetrated at slice open, otherwise requested limit",
      ttl_bars: { min: 1, max: 44, default: 44, starts: "first STEP confirmation" },
      order_bars: { min: 1, max: 16, default: 4 }, order_expiry: "min(scenario.end,confirmation_close+order_bars*15m); NEXT_OPEN uses 1 bar",
      target_before_order: "Sequence extreme reaches TP1 before admission -> rejected",
      target_before_fill: "TP1 reached without entry -> invalidated; unresolved entry/TP chronology -> N/D" },
    sizing_and_targets: { targets_per_scenario: 2, tp2_optional: true, default_tp1_fraction: 1,
      partial_qty: "floor(quantity*EXIT.tp1_fraction); must be >=1 and <quantity; otherwise PARTIAL_QTY",
      break_even: "Cost-adjusted rounded price; effective from the next slice, never retroactive",
      qty_with_budget: "min(max_contracts,floor(ticket_budget/unit_risk)); <1 rejected" },
  };
}
