import assert from "node:assert/strict";
import test from "node:test";
import { analysisSchema, decisionSchema, manualMonitorSchema } from "../src/schemas.js";
import { validDecisionAudit } from "./fixtures/decision_audit_payloads.js";
import { makeNativeMonitorV2 } from "./support/native-strategy-fixtures.js";

test("manual monitor schema normalizes readiness status for persistence", () => {
  const monitorOutput = makeNativeMonitorV2();
  const parsed = manualMonitorSchema.parse({
    monitor_id: monitorOutput.source.monitor_id,
    contract_name: "DeskHourlyThesisMonitorContract",
    schema_version: "2.4.0",
    contract_hash: "monitor-contract-hash",
    timestamp_paris: monitorOutput.checkpoint.checkpoint_paris,
    status: "ready",
    monitor_output: monitorOutput,
  });

  assert.equal(parsed.status, "SAVED");
});

test("decision schema accepts advisory wait decision", () => {
  const parsed = decisionSchema.parse({
    session: "asia_open",
    date: "2026-06-25",
    instrument: "WAIT",
    decision: "wait",
    direction: "wait",
    setup_type: "wait",
    confidence_pct: 20,
    risk_pct: 0,
    rr_minimum: 0,
    invalidation: "No valid setup",
    reason_summary: "Risk context incomplete",
    decision_audit: validDecisionAudit({
      decision_timestamp_paris: "2026-06-25T00:10:00+02:00",
      data_cutoff_paris: "2026-06-25T00:10:00+02:00",
      available_data_until: "2026-06-25T00:10:00+02:00",
      macro_actuals_visible: [],
      macro_actuals_blocked: [],
      source_pack_id: "2026-06-25_asia_open",
    }),
  });
  assert.equal(parsed.timezone, "Europe/Paris");
  assert.equal(parsed.asset_class, "futures");
});

test("decision schema rejects unsupported broker-like instrument", () => {
  assert.throws(() => decisionSchema.parse({
    session: "asia_open",
    date: "2026-06-25",
    instrument: "BTC",
    decision: "prendre",
    direction: "long",
    setup_type: "buy_stop_breakout",
    confidence_pct: 70,
    risk_pct: 1,
    rr_minimum: 2,
      invalidation: "Invalid",
      reason_summary: "Invalid",
      decision_audit: validDecisionAudit(),
    }));
});

test("analysis schema accepts multiple executable setups with ranged targets", () => {
  const parsed = analysisSchema.parse({
    schema_version: "1.1.0",
    contract_name: "DeskFuturesAnalysisContract",
    analysis_id: "2026-07-02_asia_open_analysis_v1",
    created_at_paris: "2026-07-02T00:10:00+02:00",
    mode: "live",
    analysis_type: "asia_open",
    pack_id: "2026-07-02_asia_open",
    session: "asia_open",
    date: "2026-07-02",
    timezone: "Europe/Paris",
    title: "Asia Open GPT analysis",
    status: "ready",
    scope: {
      market: "futures",
      allowed_instruments: ["MNQ", "NQ", "MES", "ES"],
      workflow: "asia_to_london",
    },
    source_pack: {
      pack_id: "2026-07-02_asia_open",
      source: "Desk_Futures_Data.get_latest_asia_open_pack",
      data_quality: { status: "ready", row_count_total: 6500 },
    },
    executive_summary: {
      summary: "WAIT at open, then short MNQ only on pullback.",
      final_decision: "prendre",
      final_instrument: "MNQ",
      final_direction: "short",
      primary_setup_id: "A",
      confidence_pct: 67,
      risk_pct: 0.5,
    },
    context: {
      relative_strength: { mnq_vs_mes: "MNQ weaker than MES" },
    },
    market_funnel: {
      calendar_macro: { status: "pass", evidence: ["calendar loaded"] },
      mega_caps_semis: { status: "pass", evidence: ["NVDA/SMH not contradictory"] },
      final_funnel_conclusion: { decision_bias: "short_conditionnel_mnq" },
    },
    levels: {
      MNQ: { latest_close: 30080.25, rsi_m15: 31.84 },
    },
    strategic_brief: {
      desk_bias: "short_conditionnel_mnq",
      forbidden_actions: ["short market sur le bas"],
    },
    decision_gates: {
      data_quality_gate: { status: "pass", hard_gate: true },
      market_funnel_gate: { status: "pass", hard_gate: true },
      final_gate: { status: "conditional_pass", fallback_decision: "wait" },
    },
    setups: [
      {
        setup_id: "A",
        label: "Short MNQ pullback",
        priority: 1,
        instrument: "MNQ",
        direction: "short",
        setup_type: "sell_limit_pullback",
        order_type: "sell_limit",
        status: "active",
        entry_zone: { from: 30140, to: 30170 },
        stop_loss: 30235,
        take_profits: [
          { name: "TP1", target: { from: 30020, to: 30050 }, action: "partial_and_be" },
          { name: "TP2", target: { from: 29935, to: 29950 }, action: "reduce" },
        ],
        extension_target: { from: 29740, to: 29770 },
        invalidation: { type: "m15_close_above", level: 30235, text: "M15 close above 30235" },
        risk_pct: 0.5,
        confidence_pct: 67,
        rr_minimum: 2,
        reason: "MNQ is weak, but short only after technical rebound.",
        management: { move_to_be_at_r: 0.6 },
        executable: true,
      },
      {
        setup_id: "B",
        label: "Short breakdown MNQ",
        instrument: "MNQ",
        direction: "short",
        setup_type: "sell_stop_breakdown_retest",
        order_type: "sell_stop_or_retest",
        entry_trigger: {
          type: "break_and_retest",
          level: 29935,
          required_confirmation: "M5 close below 29935 then rejected retest",
        },
        entry_zone: { from: 29935, to: 29950 },
        stop_loss: 30040,
        take_profits: [{ name: "TP1", target: { from: 29860, to: 29880 } }],
        invalidation: { type: "m5_reclaim_above", level: 30040, text: "Reintegration above 30040" },
        risk_pct: 0.5,
        confidence_pct: 61,
        reason: "Less clean because it sells lower.",
      },
    ],
    executable_decision: {
      pack_id: "2026-07-02_asia_open",
      session: "asia_open",
      date: "2026-07-02",
      instrument: "MNQ",
      decision: "prendre",
      direction: "short",
      setup_id: "A",
      setup_type: "sell_limit_pullback",
      order_type: "sell_limit",
      confidence_pct: 67,
      risk_pct: 0.5,
      rr_minimum: 2,
      entry_zone: { from: 30140, to: 30170 },
      stop_loss: 30235,
      take_profits: {
        tp1: { from: 30020, to: 30050 },
        tp2: { from: 29935, to: 29950 },
        tp3: { from: 29860, to: 29880 },
      },
      extension_target: { from: 29740, to: 29770 },
      invalidation: "M15 close above 30235",
      reason_summary: "Priority short MNQ pullback setup.",
      action_now: "wait_for_pullback",
      no_trade_condition: "If MNQ accepts above 30235.",
      decision_audit: validDecisionAudit({
        decision_id: "2026-07-02_asia_open_analysis_v1_primary",
        source_pack_id: "2026-07-02_asia_open",
      }),
    },
    session_matrix: [
      { day: "Jeu. 02/07", start: "00:00", end: "00:45", status: "orange", new_entries_allowed: false },
    ],
    authorized_windows_summary: [
      { day: "Jeu. 02/07", windows: ["00:45 - 02:00"], rule: "Only if setup is clean." },
    ],
    update_agenda: [
      { day: "Jeu. 02/07", time: "00:45", update_type: "Validation de continuation" },
    ],
    risk_management: {
      max_risk_pct_session: 1.0,
      max_risk_pct_primary_setup: 0.5,
    },
    monitoring_rules: {
      if_trade_triggered: ["Move to BE at +0.6R"],
      if_invalidated: ["Passer en WAIT"],
    },
    final_sections: {
      decision_executable: "WAIT then short MNQ on pullback 30140-30170.",
      regle_finale: "On ne vend pas le bas. On vend le rebond MNQ.",
    },
  });

  assert.equal(parsed.setups.length, 2);
  assert.equal(parsed.final_instrument, "MNQ");
  assert.equal(parsed.executable_decision.take_profits.tp1.from, 30020);
});
