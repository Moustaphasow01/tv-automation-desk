import test from "node:test";
import assert from "node:assert/strict";
import { loadTheoreticalExposureAsOf } from "../src/portfolio-theoretical-exposure-repository.js";
import { calculateTradeOutcome } from "@tv-automation/desk-domain";

test("unknown/physical mode cannot be read as a healthy theoretical account", async () => {
  const noQuery = { query() { throw new Error("SQL_NOT_EXPECTED"); } };
  for (const execution_mode of ["LIVE", "PAPER", "UNRECOGNIZED_MODE"]) {
    const result = await loadTheoreticalExposureAsOf(noQuery, { execution_mode, as_of_utc: "2026-09-04T15:00Z" });
    assert.equal(result.availability, "UNAVAILABLE");
    assert.equal(result.reason_codes.includes("PHYSICAL_EXPOSURE_READ_UNSUPPORTED"), true);
  }
});

test("a missing/invalid as-of is not an empty known exposure", async () => {
  const noQuery = { query() { throw new Error("SQL_NOT_EXPECTED"); } };
  for (const as_of_utc of [undefined, "invalid"]) {
    await assert.rejects(loadTheoreticalExposureAsOf(noQuery, { as_of_utc }), /THEORETICAL_EXPOSURE_CUTOFF_REQUIRED/);
  }
});

test("pending exposure uses causal request and event clocks, never database ingestion clocks", async () => {
  const client = theoreticalSource({ intents: [{
    portfolio_order_intent_id: "intent-causal-clock", status: "READY", quantity: 1,
    account_id: "shadow-grains", instrument: "ZC", action: "BUY",
    has_execution_state: true,
    lifecycle_status: "AWAITING_MANUAL_CONFIRMATION", filled_quantity: 0,
    requested_at_utc: "2026-09-04T14:00:00.000Z",
    target_computed_at_utc: "2026-09-04T13:59:00.000Z",
    last_event_at_utc: "2026-09-04T14:01:00.000Z",
    latest_event_at_utc: "2026-09-04T14:01:00.000Z",
    state_event_at_utc: "2026-09-04T14:01:00.000Z",
    created_at_utc: "2030-01-01T00:00:00.000Z",
    updated_at_utc: "2031-01-01T00:00:00.000Z",
  }] });

  const result = await loadTheoreticalExposureAsOf(client, {
    execution_mode: "SHADOW", account_id: "shadow-grains", as_of_utc: "2026-09-04T14:05:00.000Z",
  });

  assert.equal(result.availability, "KNOWN");
  assert.deepEqual(result.pending_order_intents[0], {
    portfolio_order_intent_id: "intent-causal-clock", account_id: "shadow-grains", instrument: "ZC",
    action: "BUY", quantity: 1, status: "READY", lifecycle_status: "AWAITING_MANUAL_CONFIRMATION",
    execution_state_provenance: "PERSISTED_CAUSAL_EVENT", filled_quantity: 0,
    requested_at_utc: "2026-09-04T14:00:00.000Z", requested_at_provenance: "ORDER_INTENT_REQUESTED_AT",
    last_event_at_utc: "2026-09-04T14:01:00.000Z", invalid_numeric: false,
    source: "THEORETICAL_ORDER_INTENT",
  });
  assert.equal(result.positions[0].observed_at_utc, "2026-09-04T14:01:00.000Z");
});

test("legacy intents qualify target time fallback and future events fail closed without entering the snapshot", async () => {
  const result = await loadTheoreticalExposureAsOf(theoreticalSource({ intents: [{
    portfolio_order_intent_id: "intent-legacy-clock", status: "READY", quantity: 1,
    account_id: "shadow-grains", instrument: "ZW", action: "SELL",
    has_execution_state: true,
    lifecycle_status: "AWAITING_MANUAL_CONFIRMATION", filled_quantity: 0,
    requested_at_utc: null, target_computed_at_utc: "2026-09-04T14:00:00.000Z",
    last_event_at_utc: "2026-09-04T14:01:00.000Z",
    latest_event_at_utc: "2026-09-04T14:06:00.000Z",
    state_event_at_utc: "2026-09-04T14:01:00.000Z",
  }] }), {
    execution_mode: "SHADOW", account_id: "shadow-grains", as_of_utc: "2026-09-04T14:05:00.000Z",
  });

  assert.equal(result.availability, "PARTIAL");
  assert.ok(result.reason_codes.includes("THEORETICAL_EXECUTION_STATE_AFTER_AS_OF:ZW"));
  assert.equal(result.pending_order_intents[0].requested_at_utc, "2026-09-04T14:00:00.000Z");
  assert.equal(result.pending_order_intents[0].requested_at_provenance, "TARGET_COMPUTED_AT_FALLBACK");
  assert.equal(result.pending_order_intents[0].latest_event_at_utc, undefined);
  assert.equal(result.positions[0].observed_at_utc, "2026-09-04T14:01:00.000Z");
});

test("a future request or persisted state without causal evidence remains unavailable", async () => {
  const result = await loadTheoreticalExposureAsOf(theoreticalSource({ intents: [
    {
      portfolio_order_intent_id: "intent-orphan-state", status: "READY", quantity: 1,
      account_id: "shadow-grains", instrument: "ZC", action: "BUY", has_execution_state: true,
      lifecycle_status: "AWAITING_MANUAL_CONFIRMATION", filled_quantity: 0,
      requested_at_utc: "2026-09-04T14:00:00.000Z", target_computed_at_utc: "2026-09-04T14:00:00.000Z",
      last_event_at_utc: null, latest_event_at_utc: null,
    },
    {
      portfolio_order_intent_id: "intent-future-request", status: "READY", quantity: 1,
      account_id: "shadow-grains", instrument: "ZW", action: "SELL", has_execution_state: false,
      lifecycle_status: null, filled_quantity: null,
      requested_at_utc: "2026-09-04T14:06:00.000Z", target_computed_at_utc: "2026-09-04T14:00:00.000Z",
      last_event_at_utc: null, latest_event_at_utc: null,
    },
  ] }), {
    execution_mode: "SHADOW", account_id: "shadow-grains", as_of_utc: "2026-09-04T14:05:00.000Z",
  });

  assert.equal(result.availability, "PARTIAL");
  assert.ok(result.reason_codes.includes("THEORETICAL_EXECUTION_STATE_CAUSAL_EVENT_UNAVAILABLE:ZC"));
  assert.ok(result.reason_codes.includes("THEORETICAL_INTENT_REQUESTED_AFTER_AS_OF:ZW"));
  assert.equal(result.pending_order_intents[0].execution_state_provenance, "PERSISTED_CAUSAL_EVENT_UNAVAILABLE");
  assert.equal(result.pending_order_intents[1].execution_state_provenance, "LINEAGE_DEFAULT");
  assert.equal(result.pending_order_intents[1].requested_at_utc, "2026-09-04T14:06:00.000Z");
});

test("provider claim and dispatch transition clocks after the cutoff fail closed", async () => {
  const base = {
    portfolio_order_intent_id: "intent-provider-transition", status: "READY", quantity: 1,
    account_id: "shadow-grains", instrument: "ZC", action: "BUY", has_execution_state: true,
    lifecycle_status: "LEASED", filled_quantity: 0,
    requested_at_utc: "2026-09-04T14:00:00.000Z", target_computed_at_utc: "2026-09-04T14:00:00.000Z",
    last_event_at_utc: "2026-09-04T14:00:00.000Z", latest_event_at_utc: "2026-09-04T14:00:00.000Z",
  };
  const request = { execution_mode: "SHADOW", account_id: "shadow-grains", as_of_utc: "2026-09-04T14:05:00.000Z" };

  const futureClaim = await loadTheoreticalExposureAsOf(theoreticalSource({ intents: [{
    ...base, state_leased_at_utc: "2026-09-04T14:10:00.000Z",
  }] }), request);
  assert.equal(futureClaim.availability, "PARTIAL");
  assert.ok(futureClaim.reason_codes.includes("THEORETICAL_EXECUTION_STATE_AFTER_AS_OF:ZC"));
  assert.equal(futureClaim.positions[0].observed_at_utc, "2026-09-04T14:00:00.000Z");

  const provenClaim = await loadTheoreticalExposureAsOf(theoreticalSource({ intents: [{
    ...base, state_leased_at_utc: "2026-09-04T14:04:00.000Z",
    state_dispatch_completed_at_utc: "2026-09-04T14:05:00.000Z", state_command_status: "sent", lifecycle_status: "SENT",
  }] }), request);
  assert.equal(provenClaim.availability, "KNOWN");
  assert.equal(provenClaim.positions[0].observed_at_utc, "2026-09-04T14:05:00.000Z");
});

test("an unrelated earlier event cannot prove a later lifecycle transition", async () => {
  const request = { execution_mode: "SHADOW", account_id: "shadow-grains", as_of_utc: "2026-09-04T14:05:00.100Z" };
  const base = {
    portfolio_order_intent_id: "intent-state-mismatch", status: "READY", quantity: 1,
    account_id: "shadow-grains", instrument: "ZC", action: "BUY", has_execution_state: true,
    requested_at_utc: "2026-09-04T14:00:00.000Z", target_computed_at_utc: "2026-09-04T14:00:00.000Z",
    last_event_at_utc: new Date("2026-09-04T14:00:00.000Z"),
    latest_event_at_utc: new Date("2026-09-04T14:00:00.000Z"),
  };

  for (const intent of [
    { ...base, lifecycle_status: "BLOCKED", filled_quantity: 0 },
    { ...base, lifecycle_status: "LEASED", filled_quantity: 0, state_command_status: "leased" },
  ]) {
    const result = await loadTheoreticalExposureAsOf(theoreticalSource({ intents: [intent] }), request);
    assert.equal(result.availability, "PARTIAL");
    assert.equal(result.pending_order_intents[0].execution_state_provenance, "PERSISTED_CAUSAL_EVENT_UNAVAILABLE");
    assert.ok(result.reason_codes.includes("THEORETICAL_EXECUTION_STATE_CAUSAL_EVENT_UNAVAILABLE:ZC"));
  }

  const futureAtMillisecond = await loadTheoreticalExposureAsOf(theoreticalSource({ intents: [{
    ...base, lifecycle_status: "LEASED", filled_quantity: 0,
    state_leased_at_utc: new Date("2026-09-04T14:05:00.500Z"),
  }] }), request);
  assert.equal(futureAtMillisecond.availability, "PARTIAL");
  assert.ok(futureAtMillisecond.reason_codes.includes("THEORETICAL_EXECUTION_STATE_AFTER_AS_OF:ZC"));
});

test("a malformed supplied request time is not masked by the legacy target fallback", async () => {
  const result = await loadTheoreticalExposureAsOf(theoreticalSource({ intents: [{
    portfolio_order_intent_id: "intent-malformed-request", status: "READY", quantity: 1,
    account_id: "shadow-grains", instrument: "ZC", action: "BUY", has_execution_state: false,
    lifecycle_status: null, filled_quantity: null, requested_at_utc: "not-a-timestamp",
    target_computed_at_utc: "2026-09-04T14:00:00.000Z", last_event_at_utc: null, latest_event_at_utc: null,
  }] }), {
    execution_mode: "SHADOW", account_id: "shadow-grains", as_of_utc: "2026-09-04T14:05:00.000Z",
  });

  assert.equal(result.availability, "PARTIAL");
  assert.ok(result.reason_codes.includes("THEORETICAL_INTENT_REQUESTED_AT_INVALID:ZC"));
  assert.equal(result.pending_order_intents[0].requested_at_utc, null);
  assert.equal(result.pending_order_intents[0].requested_at_provenance, "ORDER_INTENT_REQUESTED_AT_INVALID");
});

test("SEMI_MANUAL accepts only proven final-outcome usage and missing proof is partial", async () => {
  const proven = {
    async query() {
      return { rows: [{ positions: [], intents: [], qualified: [], loss_usage: {
        daily_realized_r: 0, weekly_realized_r: 0, final_outcome_count: 0, unproven_final_outcome_count: 0, missing_closed_final_outcome_count: 0,
        period_timezone: "UTC", provenance: "THEORETICAL_FINAL_OUTCOMES",
      } }] };
    },
  };
  const semiManual = await loadTheoreticalExposureAsOf(proven, { execution_mode: "SEMI_MANUAL", as_of_utc: "2026-09-04T15:00Z" });
  assert.equal(semiManual.availability, "KNOWN");
  assert.equal(semiManual.loss_usage_availability, "KNOWN");
  assert.equal(semiManual.loss_usage.period_timezone, "UTC");
  assert.equal(semiManual.loss_usage.monetary_availability, "UNAVAILABLE");
  assert.equal(semiManual.loss_usage.daily_loss_monetary, null);

  const missingProof = { async query() { return { rows: [{ positions: [], intents: [], qualified: [] }] }; } };
  const result = await loadTheoreticalExposureAsOf(missingProof, { execution_mode: "SHADOW", as_of_utc: "2026-09-04T15:00Z" });
  assert.equal(result.availability, "PARTIAL");
  assert.equal(result.loss_usage_availability, "UNAVAILABLE");
  assert.ok(result.reason_codes.includes("THEORETICAL_FINAL_OUTCOME_R_UNAVAILABLE"));
});

test("monetary loss usage exposes canonical amounts only with complete currency provenance", async () => {
  const complete = monetarySource();
  const result = await loadTheoreticalExposureAsOf(complete, monetaryRequest());
  assert.deepEqual({
    daily: result.loss_usage.daily_loss_monetary,
    weekly: result.loss_usage.weekly_loss_monetary,
    reserved: result.loss_usage.reserved_monetary_risk,
    currency: result.loss_usage.currency,
    availability: result.loss_usage.monetary_availability,
  }, { daily: 600, weekly: 850, reserved: 500, currency: "USD", availability: "KNOWN" });

  const incomplete = monetarySource({ monetary_reservation_gap_count: 1 });
  const unavailable = await loadTheoreticalExposureAsOf(incomplete, monetaryRequest());
  assert.equal(unavailable.loss_usage_availability, "KNOWN");
  assert.equal(unavailable.loss_usage.monetary_availability, "UNAVAILABLE");
  assert.equal(unavailable.loss_usage.daily_loss_monetary, null);
  assert.equal(unavailable.loss_usage.reserved_monetary_risk, null);
  assert.equal(unavailable.loss_usage.currency, "UNAVAILABLE");
  const missingEvidence = await loadTheoreticalExposureAsOf(monetarySource({ monetary_outcome_proofs: null }), monetaryRequest());
  assert.equal(missingEvidence.loss_usage.monetary_availability, "UNAVAILABLE");
});

test("final-outcome provenance failure remains ordered before missing closed outcomes", async () => {
  const source = { async query() { return { rows: [{ positions: [], intents: [], qualified: [], loss_usage: {
    daily_realized_r: 0, weekly_realized_r: 0, final_outcome_count: 2,
    unproven_final_outcome_count: 1, missing_closed_final_outcome_count: 1,
  } }] }; } };
  const result = await loadTheoreticalExposureAsOf(source, {
    execution_mode: "SHADOW", as_of_utc: "2026-09-04T15:00Z",
  });
  assert.equal(result.loss_usage_availability, "UNAVAILABLE");
  assert.ok(result.reason_codes.includes("THEORETICAL_FINAL_OUTCOME_PROVENANCE_UNAVAILABLE"));
  assert.equal(result.reason_codes.includes("THEORETICAL_CLOSED_TRADE_OUTCOME_UNAVAILABLE"), false);
});

function monetaryRequest() {
  return {
    execution_mode: "SHADOW", as_of_utc: "2026-09-04T15:00Z",
    risk_budget: { max_monetary_risk_currency: "USD" },
  };
}

function theoreticalSource({ intents = [] } = {}) {
  return { async query() { return { rows: [{ positions: [], intents, qualified: [], loss_usage: {
    daily_realized_r: 0, weekly_realized_r: 0, final_outcome_count: 0,
    unproven_final_outcome_count: 0, missing_closed_final_outcome_count: 0,
    period_timezone: "UTC", provenance: "THEORETICAL_FINAL_OUTCOMES",
  } }] }; } };
}

function monetarySource(overrides = {}) {
  return { async query() { return { rows: [{ positions: [], intents: [], qualified: [], loss_usage: {
    daily_realized_r: -0.6, weekly_realized_r: -0.85,
    daily_loss_monetary: 600, weekly_loss_monetary: 850, reserved_monetary_risk: 500,
    currency: "USD", monetary_reservation_gap_count: 0, monetary_outcome_gap_count: 0,
    monetary_outcome_proofs: [monetaryProof(95, "2026-09-03T14:00Z"), monetaryProof(88, "2026-09-04T14:00Z")],
    final_outcome_count: 2, unproven_final_outcome_count: 0, missing_closed_final_outcome_count: 0,
    period_timezone: "UTC", provenance: "THEORETICAL_FINAL_OUTCOMES", ...overrides,
  } }] }; } };
}

function monetaryProof(exitPrice, calculatedAt) {
  return calculateTradeOutcome({ side: "long", entryPrice: 100, initialStopPrice: 80,
    initialQuantity: 1, pointValue: 50, exitFills: [{ price: exitPrice, quantity: 1 }], calculatedAt });
}
