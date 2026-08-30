import assert from "node:assert/strict";
import test from "node:test";

import { signalRow } from "../src/front-control-plane-row-mappers.js";

test("signalRow removes resolved trade-plan availability errors from the current projection", () => {
  const signal = signalRow({
    signal_outbox_id: "signal-grain-1",
    instrument: "ZC",
    direction: "LONG",
    reason_codes: [
      "US_GRAINS_RTH_ONLY",
      "ENTRY_UNAVAILABLE",
      "INSTRUMENT_SPEC_UNAVAILABLE",
    ],
    proposed_trade_plan: {
      availability: "KNOWN",
      instrument: "ZC",
      direction: "LONG",
      entry: {
        availability: "KNOWN",
        type: "ZONE",
        price: 512.5,
        low: 512.25,
        high: 512.75,
        calculation_price: 512.5,
      },
      units: {
        availability: "KNOWN",
        tick_size: 0.25,
        tick_value: 12.5,
        point_value: 50,
        currency: "USD",
      },
    },
    trade_plan_economics: {
      availability: "KNOWN",
      units: {
        availability: "KNOWN",
        tick_size: 0.25,
        tick_value: 12.5,
        point_value: 50,
        currency: "USD",
      },
    },
  });

  assert.deepEqual(signal.reasonCodes, ["US_GRAINS_RTH_ONLY"]);
  assert.deepEqual(signal.rawReasonCodes, [
    "US_GRAINS_RTH_ONLY",
    "ENTRY_UNAVAILABLE",
    "INSTRUMENT_SPEC_UNAVAILABLE",
  ]);
});

test("signalRow preserves unresolved trade-plan availability errors", () => {
  const signal = signalRow({
    signal_outbox_id: "signal-grain-2",
    instrument: "UNKNOWN_CONTRACT",
    direction: "LONG",
    reason_codes: ["ENTRY_UNAVAILABLE", "INSTRUMENT_SPEC_UNAVAILABLE"],
    proposed_trade_plan: {
      availability: "UNAVAILABLE",
      entry: { availability: "UNAVAILABLE", price: null },
      units: { availability: "UNAVAILABLE" },
    },
  });

  assert.deepEqual(signal.reasonCodes, ["ENTRY_UNAVAILABLE", "INSTRUMENT_SPEC_UNAVAILABLE"]);
  assert.deepEqual(signal.rawReasonCodes, signal.reasonCodes);
});

test("signalRow exposes the canonical StrategySignal identity and R from trade-plan economics", () => {
  const signal = signalRow({
    signal_outbox_id: "outbox-grain-1",
    signal_id: "signal-grain-domain-1",
    instrument: "ZW",
    direction: "LONG",
    proposed_trade_plan: {
      availability: "KNOWN",
      entry: { availability: "KNOWN", price: 754 },
      stop: { availability: "KNOWN", price: 752.25 },
      targets: [{ availability: "KNOWN", label: "TP1", price: 756.75 }],
    },
    trade_plan_economics: {
      availability: "KNOWN",
      targets: [{ label: "TP1", price: 756.75, reward_risk: 1.5714, expected_r: 1.5714 }],
    },
  });

  assert.equal(signal.signalId, "signal-grain-domain-1");
  assert.equal(signal.signalOutboxId, "outbox-grain-1");
  assert.equal(signal.expectancyR, 1.5714);
  assert.equal(signal.rewardRisk, 1.5714);
});

test("signalRow publishes null rather than a false zero when no R metric exists", () => {
  const signal = signalRow({
    signal_id: "signal-without-r",
    instrument: "ZC",
    direction: "LONG",
  });

  assert.equal(signal.expectancyR, null);
  assert.equal(signal.rewardRisk, null);
});
