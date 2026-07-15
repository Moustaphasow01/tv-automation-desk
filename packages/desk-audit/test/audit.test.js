import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertDecisionAuditWritable,
  buildDecisionAuditEnvelope,
  createDecisionAuditCorrection,
  evaluateAntiLookahead,
  finalizeDecisionAudit,
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

describe("AntiLookaheadGuard", () => {
  it("accepts a valid DecisionAudit envelope", () => {
    const result = evaluateAntiLookahead({ decisionAudit: validAudit });
    assert.equal(result.status, "accepted");
  });

  it("refuses visible candles after the cutoff", () => {
    const result = evaluateAntiLookahead({
      decisionAudit: {
        ...validAudit,
        candles_visible: [
          { timestamp_paris: "2026-07-02T10:15:00+02:00", close: 100 },
          { timestamp_paris: "2026-07-02T10:16:00+02:00", close: 101 },
        ],
      },
    });

    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("candle_after_cutoff"));
    assert.equal(result.evidence.candle_violations[0].index, 1);
  });

  it("blocks macro actuals visible before their publication time", () => {
    const result = evaluateAntiLookahead({
      decisionAudit: {
        ...validAudit,
        macro_actuals_visible: [{ event: "NFP", published_at_paris: "2026-07-02T10:16:00+02:00" }],
      },
    });

    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("macro_actual_after_cutoff"));
  });

  it("rejects future data flags and unfrozen entry/SL/TP", () => {
    const result = evaluateAntiLookahead({
      decisionAudit: {
        ...validAudit,
        future_data_used: true,
        entry_sl_tp_frozen: false,
      },
    });

    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("future_data_used"));
    assert.ok(result.reasons.includes("entry_sl_tp_not_frozen"));
  });
});

describe("DecisionAudit envelope and lifecycle", () => {
  it("builds the T04 DecisionAudit envelope and validates it", () => {
    const result = buildDecisionAuditEnvelope({
      ...validAudit,
      audit_id: "audit_1",
    });

    assert.equal(result.status, "accepted");
    assert.equal(result.audit.contract_name, "DeskDecisionAuditContract");
    assert.equal(result.audit.schema_version, "decision_audit_v2");
    assert.deepEqual(result.audit.macro_actuals_visible, []);
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
    assert.match(result.audit.content_hash, /^audit_[0-9a-f]{8}$/);
  });

  it("refuses to mutate a finalized DecisionAudit", () => {
    const finalized = finalizeDecisionAudit(validAudit, { audit_id: "audit_locked_1" }).audit;
    const result = assertDecisionAuditWritable(finalized, { future_data_used: true });

    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("decision_audit_immutable"));
  });

  it("records audited corrections as append-only records", () => {
    const finalized = finalizeDecisionAudit(validAudit, { audit_id: "audit_original_1" }).audit;
    const result = createDecisionAuditCorrection(finalized, {
      correction_id: "correction_1",
      correction_audit_id: "audit_correction_1",
      correction_reason: "operator corrected visible macro list",
      corrected_by: "unit-test",
      corrected_at_utc: "2026-07-02T08:30:00Z",
      patch: {
        macro_actuals_visible: [{ event: "ISM", published_at_paris: "2026-07-02T10:10:00+02:00" }],
      },
    });

    assert.equal(result.status, "accepted");
    assert.equal(result.correction.schema_version, "decision_audit_correction_v1");
    assert.equal(result.correction.immutable, true);
    assert.deepEqual(result.correction.changed_fields, ["macro_actuals_visible"]);
  });
});
