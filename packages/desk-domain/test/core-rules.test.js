import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DOMAIN_STATUSES,
  DECISION_MODEL_VERSION,
  DECISION_SCHEMA_VERSION,
  DECISION_SOURCE_ROLE,
  assertDecisionAuditWritable,
  buildDecisionAuditEnvelope,
  createDecisionAuditCorrection,
  decisionAuditContentHash,
  finalizeDecisionAudit,
  evaluateAntiLookahead,
  evaluateGates,
  evaluatePositionManagement,
  isDecisionAuditFinalized,
  evaluateRisk,
  normalizeDecision,
  planThesisSetupPositionSplit,
  replayOutcome,
  transitionThesisState,
  validateSetup,
} from "../index.js";

const validAudit = {
  decision_timestamp_paris: "2026-07-02T10:20:00+02:00",
  data_cutoff_paris: "2026-07-02T10:15:00+02:00",
  available_data_until: "2026-07-02T10:15:00+02:00",
  future_data_used: false,
  entry_sl_tp_frozen: true,
  datasets_used: ["asia_open_pack"],
  macro_actuals_visible: [],
  macro_actuals_blocked: [{ event: "NFP", scheduled_at_paris: "2026-07-02T14:30:00+02:00" }],
  source_pack_id: "2026-07-02_asia_open",
};

const validLongSetup = {
  instrument: "MNQ",
  direction: "long",
  setup_type: "buy_limit_pullback",
  entry: 100,
  stop_loss: 95,
  take_profits: [{ name: "TP1", target: 110 }],
  risk_pct: 0.5,
};

const validShortSetup = {
  instrument: "MNQ",
  direction: "short",
  setup_type: "sell_limit_pullback",
  entry: 100,
  stop_loss: 105,
  take_profits: [{ name: "TP1", target: 90 }],
  risk_pct: 0.5,
};

describe("Domain result shape", () => {
  it("uses accepted/rejected/review_required status semantics", () => {
    const result = evaluateAntiLookahead({ decisionAudit: validAudit });
    assert.equal(result.ok, true);
    assert.equal(result.status, DOMAIN_STATUSES.ACCEPTED);
    assert.deepEqual(result.reasons, []);
    assert.deepEqual(result.flags, []);
    assert.equal(typeof result.evidence, "object");
  });
});

describe("Single Decision model", () => {
  it("normalizes audited source proposals into the canonical decision_v2 chain", () => {
    const result = normalizeDecision({
      source_type: "dashboard",
      paper_decision_id: "paper_1",
      requested_by: "operator",
      decision: "prendre",
      direction: "long",
      instrument: "MNQ",
      session: "london_am",
      linked_thesis_id: "thesis_1",
      mission_id: "mission_1",
      linked_setup_id: "setup_1",
      paper_position_id: "position_1",
      paper_outcome_id: "outcome_1",
      audit_id: "audit_1",
      decision_audit: validAudit,
      decision_gates: {
        data_quality_gate: { status: "pass", hard_gate: true },
        market_funnel_gate: { status: "pass", hard_gate: true },
        final_gate: { status: "pass" },
      },
    });

    assert.equal(result.status, "accepted");
    assert.equal(result.decision.schema_version, DECISION_SCHEMA_VERSION);
    assert.equal(result.decision.decision_model, DECISION_MODEL_VERSION);
    assert.equal(result.decision.source_role, DECISION_SOURCE_ROLE);
    assert.equal(result.decision.source_type, "dashboard");
    assert.equal(result.decision.gate_status, "green");
    assert.deepEqual(result.decision.chain, {
      thesis_id: "thesis_1",
      mission_id: "mission_1",
      gate_status: "green",
      decision_id: result.decision.decision_id,
      position_id: "position_1",
      outcome_id: "outcome_1",
      audit_id: "audit_1",
    });
  });

  it("keeps unaudited source proposals review_required instead of silently accepting them", () => {
    const result = normalizeDecision({
      source_type: "strategy",
      candidate_id: "candidate_1",
      side: "short",
      instrument: "MES",
      decision_gates: {
        data_quality_gate: { status: "pass" },
        market_funnel_gate: { status: "pass" },
      },
    });

    assert.equal(result.status, "review_required");
    assert.equal(result.ok, false);
    assert.equal(result.decision.decision, "prendre");
    assert.equal(result.decision.source_type, "strategy");
    assert.equal(result.decision.source_role, "proposer");
    assert.ok(result.reasons.includes("decision_audit_required"));
  });
});

describe("AntiLookaheadGuard", () => {
  it("builds a clean T04 DecisionAudit envelope through the public domain export", () => {
    const result = buildDecisionAuditEnvelope({
      ...validAudit,
      audit_id: "audit_envelope_1",
      candles_visible: [{ timestamp_paris: "2026-07-02T10:15:00+02:00", close: 100 }],
      notes: undefined,
    }, {
      mission_id: "mission_1",
      decision_id: "decision_1",
    });

    assert.equal(result.status, "accepted");
    assert.equal(result.audit.contract_name, "DeskDecisionAuditContract");
    assert.equal(result.audit.schema_version, "decision_audit_v2");
    assert.equal(result.audit.timezone, "Europe/Paris");
    assert.equal(result.audit.mission_id, "mission_1");
    assert.equal(result.audit.decision_id, "decision_1");
    assert.equal("notes" in result.audit, false);
    assert.equal(result.record, result.audit);
    assert.equal(result.evidence.contract_name, "DeskDecisionAuditContract");
  });

  it("rejects invalid envelope input", () => {
    const result = buildDecisionAuditEnvelope(null);
    assert.equal(result.status, "rejected");
    assert.equal(result.audit, null);
    assert.ok(result.reasons.includes("missing_decision_audit_input"));
  });

  it("accepts a valid DecisionAudit envelope", () => {
    const result = evaluateAntiLookahead({ decisionAudit: validAudit });
    assert.equal(result.status, "accepted");
  });

  it("rejects a missing audit", () => {
    const result = evaluateAntiLookahead();
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("missing_decision_audit"));
  });

  it("rejects missing or invalid cutoff", () => {
    const result = evaluateAntiLookahead({ decisionAudit: { ...validAudit, data_cutoff_paris: "" } });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("missing_or_invalid_cutoff"));
  });

  it("rejects invalid decision timestamp", () => {
    const result = evaluateAntiLookahead({ decisionAudit: { ...validAudit, decision_timestamp_paris: "not-a-date" } });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("missing_or_invalid_decision_timestamp"));
  });

  it("rejects future data usage", () => {
    const result = evaluateAntiLookahead({ decisionAudit: { ...validAudit, future_data_used: true } });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("future_data_used"));
  });

  it("rejects data available after cutoff", () => {
    const result = evaluateAntiLookahead({
      decisionAudit: { ...validAudit, available_data_until: "2026-07-02T10:16:00+02:00" },
    });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("data_after_cutoff"));
  });

  it("rejects cutoff timestamps that are after the decision timestamp", () => {
    const result = evaluateAntiLookahead({
      decisionAudit: {
        ...validAudit,
        decision_timestamp_paris: "2026-07-02T10:10:00+02:00",
        data_cutoff_paris: "2026-07-02T10:15:00+02:00",
      },
    });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("cutoff_after_decision_timestamp"));
  });

  it("rejects missing available-until timestamps and unfrozen entries", () => {
    const result = evaluateAntiLookahead({
      decisionAudit: {
        ...validAudit,
        available_data_until: null,
        entry_sl_tp_frozen: false,
      },
    });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("missing_or_invalid_available_data_until"));
    assert.ok(result.reasons.includes("entry_sl_tp_not_frozen"));
  });

  it("rejects visible macro actuals published after cutoff", () => {
    const result = evaluateAntiLookahead({
      decisionAudit: {
        ...validAudit,
        macro_actuals_visible: [{ event: "NFP", published_at_paris: "2026-07-02T10:16:00+02:00" }],
      },
    });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("macro_actual_after_cutoff"));
  });

  it("rejects visible macro actuals with invalid publication timestamps", () => {
    const result = evaluateAntiLookahead({
      decisionAudit: {
        ...validAudit,
        macro_actuals_visible: [{ event: "NFP", published_at_paris: "not-a-date" }],
      },
    });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("macro_actual_invalid_publish_time"));
    assert.equal(result.evidence.macro_actual_violations[0].event, "NFP");
  });

  it("rejects visible candles after cutoff and invalid candle timestamps", () => {
    const result = evaluateAntiLookahead({
      decisionAudit: {
        ...validAudit,
        market_candles_visible: [
          { timestamp_utc: "2026-07-02T08:15:00Z", close: 100 },
          { timestamp: "bad-candle-time", close: 101 },
          { time: "2026-07-02T08:16:00Z", close: 102 },
        ],
      },
    });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("candle_invalid_timestamp"));
    assert.ok(result.reasons.includes("candle_after_cutoff"));
    assert.equal(result.evidence.candle_violations.length, 2);
  });

  it("allows blocked macro actuals without publish time", () => {
    const result = evaluateAntiLookahead({
      decisionAudit: {
        ...validAudit,
        macro_actuals_visible: [],
        macro_actuals_blocked: [{ event: "NFP" }],
      },
    });
    assert.equal(result.status, "accepted");
  });
});

describe("DecisionAuditLifecycle", () => {
  it("rejects non-record audits before finalization", () => {
    const result = finalizeDecisionAudit(null);
    assert.equal(result.status, "rejected");
    assert.equal(result.audit, null);
    assert.ok(result.reasons.includes("missing_decision_audit"));
  });

  it("finalizes a valid DecisionAudit as immutable", () => {
    const result = finalizeDecisionAudit(validAudit, {
      audit_id: "audit_valid_1",
      finalized_at_utc: "2026-07-02T08:20:00Z",
      finalized_by: "unit-test",
    });

    assert.equal(result.status, "accepted");
    assert.equal(result.audit.audit_id, "audit_valid_1");
    assert.equal(result.audit.status, "valid");
    assert.equal(result.audit.finalized, true);
    assert.equal(result.audit.immutable, true);
    assert.equal(result.audit.mutation_policy, "immutable_after_validation");
    assert.match(result.audit.content_hash, /^audit_[0-9a-f]{8}$/);
    assert.equal(isDecisionAuditFinalized(result.audit), true);
    assert.equal(decisionAuditContentHash({ ...result.audit, content_hash: "ignored" }), result.audit.content_hash);
  });

  it("allows new, draft, idempotent, and documented migration writes", () => {
    const finalized = finalizeDecisionAudit(validAudit, { audit_id: "audit_writable_cases" }).audit;

    assert.equal(assertDecisionAuditWritable(null, validAudit).status, "accepted");
    assert.equal(assertDecisionAuditWritable({ ...validAudit, finalized: false, status: "draft" }, validAudit).status, "accepted");

    const idempotent = assertDecisionAuditWritable(finalized, validAudit);
    assert.equal(idempotent.status, "accepted");
    assert.ok(idempotent.flags.includes("DECISION_AUDIT_IDEMPOTENT_WRITE"));

    const missingMigrationDocs = assertDecisionAuditWritable(finalized, { source_pack_id: "other" }, {
      allowDocumentedMigration: true,
    });
    assert.equal(missingMigrationDocs.status, "rejected");
    assert.ok(missingMigrationDocs.reasons.includes("decision_audit_migration_documentation_required"));

    const documentedMigration = assertDecisionAuditWritable(finalized, { source_pack_id: "other" }, {
      allow_documented_migration: true,
      migration_id: "migration_1",
      approved_by: "lead",
      reason: "Historical schema migration.",
    });
    assert.equal(documentedMigration.status, "accepted");
    assert.ok(documentedMigration.flags.includes("DECISION_AUDIT_DOCUMENTED_MIGRATION"));
  });

  it("refuses to mutate a finalized DecisionAudit", () => {
    const finalized = finalizeDecisionAudit(validAudit, { audit_id: "audit_locked_1" }).audit;
    const result = assertDecisionAuditWritable(finalized, { future_data_used: true });

    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("decision_audit_immutable"));
    assert.ok(result.flags.includes("DECISION_AUDIT_IMMUTABLE"));
  });

  it("records audited corrections as new immutable records", () => {
    const finalized = finalizeDecisionAudit(validAudit, { audit_id: "audit_original_1" }).audit;
    const result = createDecisionAuditCorrection(finalized, {
      correction_id: "correction_1",
      correction_audit_id: "audit_correction_1",
      correction_reason: "Source pack id was normalized after ingestion audit.",
      corrected_by: "desk-admin",
      corrected_at_utc: "2026-07-02T08:25:00Z",
      patch: { source_pack_id: "asia_open_pack_v2" },
    });

    assert.equal(result.status, "accepted");
    assert.equal(result.correction.schema_version, "decision_audit_correction_v1");
    assert.equal(result.correction.original_audit_id, "audit_original_1");
    assert.equal(result.correction.correction_audit_id, "audit_correction_1");
    assert.equal(result.correction.finalized, true);
    assert.equal(result.correction.immutable, true);
    assert.deepEqual(result.correction.changed_fields, ["source_pack_id"]);
    assert.equal(result.correction.corrected_decision_audit.audit_id, "audit_correction_1");
  });

  it("rejects missing or incomplete correction records", () => {
    const draftResult = createDecisionAuditCorrection(validAudit, {
      correction_id: "correction_draft",
      correction_reason: "Draft records cannot be corrected.",
      corrected_by: "desk-admin",
      corrected_at_utc: "2026-07-02T08:25:00Z",
    });
    assert.equal(draftResult.status, "rejected");
    assert.ok(draftResult.reasons.includes("original_decision_audit_not_finalized"));

    const missingOriginal = createDecisionAuditCorrection(null, {});
    assert.equal(missingOriginal.status, "rejected");
    assert.ok(missingOriginal.reasons.includes("original_decision_audit_required"));

    const finalized = finalizeDecisionAudit(validAudit, { audit_id: "audit_original_missing_fields" }).audit;
    const incomplete = createDecisionAuditCorrection(finalized, { patch: { source_pack_id: "v2" } });
    assert.equal(incomplete.status, "rejected");
    assert.ok(incomplete.reasons.includes("correction_reason_required"));
    assert.ok(incomplete.reasons.includes("corrected_by_required"));
    assert.ok(incomplete.reasons.includes("corrected_at_utc_required"));
    assert.ok(incomplete.reasons.includes("correction_audit_id_required"));
  });

  it("rejects corrections that still violate anti-lookahead rules", () => {
    const finalized = finalizeDecisionAudit(validAudit, { audit_id: "audit_original_2" }).audit;
    const result = createDecisionAuditCorrection(finalized, {
      correction_id: "correction_bad",
      correction_audit_id: "audit_correction_bad",
      correction_reason: "Bad correction tries to use future data.",
      corrected_by: "desk-admin",
      corrected_at_utc: "2026-07-02T08:25:00Z",
      patch: { available_data_until: "2026-07-02T10:16:00+02:00" },
    });

    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("decision_audit_correction_invalid"));
    assert.ok(result.reasons.includes("data_after_cutoff"));
    assert.equal(result.correction, null);
  });
});

describe("GateEvaluator", () => {
  const validGates = {
    data_quality_gate: { status: "pass", hard_gate: true },
    market_funnel_gate: { status: "pass", hard_gate: true },
    final_gate: { status: "pass" },
  };
  const decision = {
    decision: "prendre",
    direction: "long",
    risk_pct: 0.5,
    decision_timestamp_paris: "2026-07-02T10:20:00+02:00",
  };

  it("accepts passing gates outside blocking windows", () => {
    const result = evaluateGates({ decision, decisionGates: validGates });
    assert.equal(result.status, "accepted");
  });

  it("rejects missing data quality gate", () => {
    const result = evaluateGates({ decision, decisionGates: { ...validGates, data_quality_gate: undefined } });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("data_quality_gate_failed"));
  });

  it("rejects hard market funnel failure", () => {
    const result = evaluateGates({
      decision,
      decisionGates: { ...validGates, market_funnel_gate: { status: "failed", hard_gate: true } },
    });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("market_funnel_gate_failed"));
  });

  it("requires review when final gate fallback wait contradicts prendre", () => {
    const result = evaluateGates({
      decision,
      decisionGates: { ...validGates, final_gate: { status: "conditional_pass", fallback_decision: "wait" } },
    });
    assert.equal(result.status, "review_required");
    assert.ok(result.reasons.includes("final_gate_conflict"));
  });

  it("rejects a new entry during a red window", () => {
    const result = evaluateGates({
      decision,
      decisionGates: validGates,
      timeWindows: [{
        id: "macro_blackout",
        status: "red",
        start: "2026-07-02T10:00:00+02:00",
        end: "2026-07-02T10:30:00+02:00",
      }],
    });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("red_window_no_new_entry"));
  });

  it("allows management-only decisions during a red window", () => {
    const result = evaluateGates({
      decision: { ...decision, decision: "gestion_seule", direction: "neutral", risk_pct: 0 },
      decisionGates: validGates,
      timeWindows: [{ status: "red" }],
    });
    assert.equal(result.status, "accepted");
  });
});

describe("SetupValidator", () => {
  it("accepts valid long geometry", () => {
    const result = validateSetup({ setup: validLongSetup });
    assert.equal(result.status, "accepted");
  });

  it("accepts valid short geometry", () => {
    const result = validateSetup({ setup: validShortSetup });
    assert.equal(result.status, "accepted");
  });

  it("rejects missing stop", () => {
    const { stop_loss, ...withoutStop } = validLongSetup;
    const result = validateSetup({ setup: withoutStop });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("setup_incomplete"));
  });

  it("rejects missing target", () => {
    const result = validateSetup({ setup: { ...validLongSetup, take_profits: [] } });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("setup_incomplete"));
  });

  it("rejects invalid long price ordering", () => {
    const result = validateSetup({ setup: { ...validLongSetup, stop_loss: 101 } });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("invalid_long_prices"));
  });

  it("rejects invalid short price ordering", () => {
    const result = validateSetup({ setup: { ...validShortSetup, take_profits: [{ name: "TP1", target: 102 }] } });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("invalid_short_prices"));
  });

  it("rejects wait/no-trade decisions carrying positive risk", () => {
    const result = validateSetup({
      setup: { direction: "wait", setup_type: "wait", risk_pct: 0.25 },
      decision: { decision: "wait" },
    });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("wait_has_risk"));
  });
});

describe("RiskEngine", () => {
  it("accepts a clean setup within limits", () => {
    const result = evaluateRisk({ setup: validLongSetup, rules: { maxRiskPct: 1, minRR: 1.5 } });
    assert.equal(result.status, "accepted");
    assert.equal(result.evidence.computed_rr, 2);
  });

  it("rejects risk above configured max", () => {
    const result = evaluateRisk({ setup: { ...validLongSetup, risk_pct: 1.25 }, rules: { maxRiskPct: 1, minRR: 1.5 } });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("risk_pct_above_limit"));
  });

  it("rejects missing RR", () => {
    const result = evaluateRisk({
      setup: { instrument: "MNQ", direction: "long", risk_pct: 0.5 },
      rules: { maxRiskPct: 1, minRR: 1.5 },
    });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("rr_missing"));
  });

  it("accepts wait/no-trade with zero risk without RR", () => {
    const result = evaluateRisk({
      setup: { instrument: "WAIT", decision: "wait", direction: "wait", setup_type: "wait_only", risk_pct: 0 },
      rules: { maxRiskPct: 1, minRR: 1.5 },
    });
    assert.equal(result.status, "accepted");
    assert.equal(result.evidence.risk_mode, "wait_no_trade");
  });

  it("rejects RR below threshold", () => {
    const result = evaluateRisk({
      setup: { ...validLongSetup, take_profits: [{ name: "TP1", target: 104 }] },
      rules: { maxRiskPct: 1, minRR: 1.5 },
    });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("rr_below_minimum"));
  });

  it("rejects duplicate active signal", () => {
    const result = evaluateRisk({
      setup: { ...validLongSetup, setup_id: "A" },
      rules: { maxRiskPct: 1, minRR: 1.5 },
      activeOrders: [{ doc_id: "existing", instrument: "MNQ", direction: "long", setup_id: "A", status: "ACTIVE" }],
    });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("duplicate_signal"));
  });

  it("rejects correlated active exposure", () => {
    const result = evaluateRisk({
      setup: { ...validLongSetup, instrument: "MNQ" },
      rules: { maxRiskPct: 1, minRR: 1.5, maxCorrelatedActive: 1 },
      activeExposures: [{ doc_id: "mes_active", symbol: "MES", direction: "long", status: "ACTIVE" }],
    });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("correlated_active_exposure"));
  });

  it("uses the reduced-size conditional RR threshold", () => {
    const result = evaluateRisk({
      setup: { ...validLongSetup, risk_mode: "REDUCED_SIZE", take_profits: [{ name: "TP1", target: 106.5 }] },
      rules: { maxRiskPct: 1, minRR: 1.5, conditionalMinRR: 1.2 },
    });
    assert.equal(result.status, "accepted");
    assert.equal(result.evidence.min_rr_required, 1.2);
  });
});

describe("ThesisStateMachine", () => {
  it("accepts NO_ACTIVE_THESIS -> THESIS_ACTIVE without audit", () => {
    const result = transitionThesisState({
      currentState: "NO_ACTIVE_THESIS",
      nextState: "THESIS_ACTIVE",
      context: {},
    });
    assert.equal(result.status, "accepted");
    assert.equal(result.evidence.accepted_state, "THESIS_ACTIVE");
  });

  it("accepts NO_ACTIVE_THESIS -> WAIT_MONITORED", () => {
    const result = transitionThesisState({
      currentState: "NO_ACTIVE_THESIS",
      nextState: "WAIT_MONITORED",
      context: {},
    });
    assert.equal(result.status, "accepted");
    assert.equal(result.evidence.accepted_state, "WAIT_MONITORED");
  });

  it("accepts THESIS_ACTIVE -> SETUP_ARMED", () => {
    const result = transitionThesisState({
      currentState: "THESIS_ACTIVE",
      nextState: "SETUP_ARMED",
      context: { decisionAudit: validAudit },
    });
    assert.equal(result.status, "accepted");
  });

  it("accepts idempotent state updates", () => {
    const result = transitionThesisState({
      currentState: "THESIS_ACTIVE",
      nextState: "THESIS_ACTIVE",
      context: {},
    });
    assert.equal(result.status, "accepted");
    assert.ok(result.flags.includes("STATE_UNCHANGED"));
    assert.equal(result.evidence.state_unchanged, true);
  });

  it("rejects legacy position states inside the thesis state machine", () => {
    const result = transitionThesisState({
      currentState: "SETUP_TRIGGERED",
      nextState: "POSITION_ACTIVE",
      context: { decisionAudit: validAudit, fill_proof: { filled_at_paris: "2026-07-02T10:45:00+02:00" } },
    });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("position_state_requires_position_store"));
    assert.ok(result.flags.includes("STATE_POSITION_SPLIT_REQUIRED"));
  });

  it("plans a non-destructive split from legacy thesis position state", () => {
    const result = planThesisSetupPositionSplit({
      thesis_id: "thesis_split_1",
      linked_setup_id: "setup_split_1",
      status: "POSITION_PROTECTED",
      instrument: "MNQ",
      direction: "long",
      entry_price: 100,
      stop_loss: 95,
      take_profits: [{ name: "TP1", target: 110 }],
      risk_pct: 0.5,
    }, {
      tick: {
        utc: "2026-07-02T08:45:00.000Z",
        paris: "2026-07-02T10:45:00+02:00",
      },
    });

    assert.equal(result.status, "accepted");
    assert.equal(result.migration_required, true);
    assert.equal(result.thesis_patch.status, "SETUP_TRIGGERED");
    assert.equal(result.thesis_patch.legacy_position_status, "POSITION_PROTECTED");
    assert.equal(result.position_record.position_id, "position_thesis_split_1_setup_split_1");
    assert.equal(result.position_record.status, "protected");
    assert.equal(result.position_record.linked_thesis_id, "thesis_split_1");
  });

  it("rejects INVALIDATED -> THESIS_ACTIVE without replan", () => {
    const result = transitionThesisState({
      currentState: "INVALIDATED",
      nextState: "THESIS_ACTIVE",
      context: { decisionAudit: validAudit },
    });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("replan_required"));
  });

  it("rejects unknown transitions", () => {
    const result = transitionThesisState({
      currentState: "SOMETHING_ELSE",
      nextState: "THESIS_ACTIVE",
      context: { decisionAudit: validAudit },
    });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("invalid_transition"));
  });

  it("accepts EXPIRED -> REPLAN_REQUIRED", () => {
    const result = transitionThesisState({
      currentState: "EXPIRED",
      nextState: "REPLAN_REQUIRED",
      context: {},
    });
    assert.equal(result.status, "accepted");
  });
});

describe("OutcomeReplayer", () => {
  it("rejects candles after the replay cutoff", () => {
    const result = replayOutcome({
      setup: validLongSetup,
      cutoff: "2026-07-02T10:05:00+02:00",
      candles: [{ timestamp_paris: "2026-07-02T10:06:00+02:00", high: 102, low: 99, close: 101 }],
    });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("replay_lookahead"));
  });

  it("requires review when stop and target are touched in the same candle", () => {
    const result = replayOutcome({
      setup: validLongSetup,
      cutoff: "2026-07-02T10:20:00+02:00",
      candles: [{ timestamp_paris: "2026-07-02T10:05:00+02:00", high: 111, low: 94, close: 100 }],
    });
    assert.equal(result.status, "review_required");
    assert.ok(result.reasons.includes("ambiguous_candle_path"));
  });

  it("returns a deterministic TP1 result in R", () => {
    const result = replayOutcome({
      setup: validLongSetup,
      cutoff: "2026-07-02T10:20:00+02:00",
      candles: [
        { timestamp_paris: "2026-07-02T10:05:00+02:00", high: 104, low: 99, close: 103 },
        { timestamp_paris: "2026-07-02T10:06:00+02:00", high: 110, low: 103, close: 109 },
      ],
    });
    assert.equal(result.status, "accepted");
    assert.equal(result.evidence.outcome, "TP1");
    assert.equal(result.evidence.r_multiple, 2);
  });

  it("rejects missing risk distance", () => {
    const result = replayOutcome({
      setup: { ...validLongSetup, stop_loss: 100 },
      cutoff: "2026-07-02T10:20:00+02:00",
      candles: [{ timestamp_paris: "2026-07-02T10:05:00+02:00", high: 102, low: 99, close: 101 }],
    });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("invalid_r_distance"));
  });
});

describe("PositionManager", () => {
  it("rejects break-even before the configured R threshold", () => {
    const result = evaluatePositionManagement({
      position: { status: "active", open_size: 1, current_r: 0.6 },
      action: { action: "break_even" },
      rules: { be_threshold_r: 1 },
    });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("be_threshold_not_reached"));
  });

  it("rejects partial actions larger than the open size", () => {
    const result = evaluatePositionManagement({
      position: { status: "active", open_size: 1 },
      action: { action: "partial", close_size: 1.25 },
    });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("partial_size_invalid"));
  });

  it("requires review for full-risk positions before a major event", () => {
    const result = evaluatePositionManagement({
      position: { status: "active", open_size: 1, risk_remaining_pct: 1 },
      action: { action: "hold" },
      rules: { major_event_window_minutes: 60 },
      macroEvents: [{ event: "NFP", importance: "high", minutes_until: 30 }],
    });
    assert.equal(result.status, "review_required");
    assert.ok(result.reasons.includes("major_event_full_risk"));
  });
});
