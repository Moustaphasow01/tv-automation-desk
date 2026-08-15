import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TRADE_PLAN_ECONOMICS_SCHEMA_VERSION_V1,
  TRADE_PLAN_SCHEMA_VERSION_V1,
  canonicalFuturesInstrumentV1,
  computeTradePlanEconomicsV1,
  instrumentContractSpecV1,
  normalizeProposedTradePlanV1,
} from "../index.js";

describe("trade plan economics V1", () => {
  it("publishes MNQ units and deterministic stop/target economics", () => {
    const result = normalizeProposedTradePlanV1({
      instrument: "CME_MINI:MNQ1!",
      direction: "LONG",
      order_type: "LIMIT",
      entry_price: 28000,
      stop_price: 27980,
      targets: [{ label: "T1", price: 28060 }],
      time_in_force: "DAY",
      source_data_cutoff_utc: "2026-08-15T08:15:00.000Z",
    });

    assert.equal(result.proposed_trade_plan.schema_version, TRADE_PLAN_SCHEMA_VERSION_V1);
    assert.equal(result.economics.schema_version, TRADE_PLAN_ECONOMICS_SCHEMA_VERSION_V1);
    assert.equal(result.proposed_trade_plan.instrument, "MNQ");
    assert.equal(result.proposed_trade_plan.units.tick_size, 0.25);
    assert.equal(result.proposed_trade_plan.units.tick_value, 0.5);
    assert.equal(result.economics.stop_distance_points, 20);
    assert.equal(result.economics.stop_distance_ticks, 80);
    assert.equal(result.economics.risk_per_contract, 40);
    assert.equal(result.economics.targets[0].reward_risk, 3);
    assert.match(result.proposed_trade_plan.plan_hash, /^sha256:[a-f0-9]{64}$/);
  });

  it("supports MES with exchange tick value without frontend-side inference", () => {
    const economics = computeTradePlanEconomicsV1({
      instrument: "MES",
      direction: "SHORT",
      entry_price: 6500,
      stop_price: 6508,
      targets: [{ label: "T1", price: 6476 }],
    });

    assert.equal(economics.instrument, "MES");
    assert.equal(economics.tick_size, 0.25);
    assert.equal(economics.tick_value, 1.25);
    assert.equal(economics.stop_distance_ticks, 32);
    assert.equal(economics.risk_per_contract, 40);
    assert.equal(economics.targets[0].reward_risk, 3);
  });

  it("does not default unavailable risk economics to zero", () => {
    const economics = computeTradePlanEconomicsV1({
      instrument: "UNKNOWN",
      direction: "LONG",
      entry_price: 100,
      targets: [{ price: 110 }],
    });

    assert.equal(economics.availability, "UNAVAILABLE");
    assert.equal(economics.stop_price, null);
    assert.equal(economics.tick_size, null);
    assert.equal(economics.tick_value, null);
    assert.equal(economics.risk_per_contract, null);
    assert.ok(economics.reason_codes.includes("INSTRUMENT_SPEC_UNAVAILABLE"));
    assert.ok(economics.reason_codes.includes("STOP_UNAVAILABLE"));
  });

  it("canonicalizes common futures symbols", () => {
    assert.equal(canonicalFuturesInstrumentV1("CME_MINI:MNQ1!__5"), "MNQ");
    assert.equal(canonicalFuturesInstrumentV1("CME_MINI:MES1!"), "MES");
    assert.equal(instrumentContractSpecV1("NQ1!").tick_value, 5);
  });
});
