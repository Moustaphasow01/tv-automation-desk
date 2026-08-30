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
