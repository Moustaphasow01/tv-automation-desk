import assert from "node:assert/strict";
import test from "node:test";

import {
  AVERAGE_RANGE_LEGACY_VERSION,
  buildVolatilityIndicators,
  recentAverageRange,
  trueRange,
  wilderAtr,
  WILDER_ATR_14_VERSION,
} from "../src/market-volatility-indicators.js";
import { rangeState, volatilityState } from "../src/desk-market-feature-algorithms.js";

test("true range includes gaps against the previous close", () => {
  assert.equal(trueRange({ high: 105, low: 104 }, 100), 5);
  assert.equal(trueRange({ high: 105, low: 104 }, null), 1);
});

test("Wilder ATR 14 is distinct from the legacy average high-low range", () => {
  const rows = [
    { high: 101, low: 99, close: 100 },
    { high: 105, low: 104, close: 104 },
    ...Array.from({ length: 13 }, (_, index) => ({
      high: 106 + index,
      low: 104 + index,
      close: 105 + index,
    })),
  ];

  assert.equal(recentAverageRange(rows, 14), 1.9286);
  assert.equal(wilderAtr(rows, { period: 14 }), 2.2143);
  assert.notEqual(wilderAtr(rows, { period: 14 }), recentAverageRange(rows, 14));
});

test("volatility indicators expose explicit versions for ATR and legacy average range", () => {
  const rows = [
    { high: 101, low: 99, close: 100 },
    ...Array.from({ length: 14 }, (_, index) => ({
      high: 102 + index,
      low: 100 + index,
      close: 101 + index,
    })),
  ];
  const result = buildVolatilityIndicators(rows);

  assert.equal(result.atr_14_version, WILDER_ATR_14_VERSION);
  assert.equal(result.average_range_legacy_version, AVERAGE_RANGE_LEGACY_VERSION);
  assert.equal(result.volatility_reference_source, "wilder_atr_14");
  assert.equal(result.atr_14, 2);
  assert.equal(result.average_range_14, 2);
});

test("market feature states keep true ATR and average range under distinct names", () => {
  const rows = [
    { high: 101, low: 99, close: 100 },
    { high: 105, low: 104, close: 104 },
    ...Array.from({ length: 13 }, (_, index) => ({
      high: 106 + index,
      low: 104 + index,
      close: 105 + index,
    })),
  ];
  const range = rangeState(rows);
  const volatility = volatilityState(rows);

  assert.equal(range.atr_14, 2.2143);
  assert.equal(range.average_range_14, 1.9286);
  assert.equal(range.legacy_atr_14, 1.9286);
  assert.equal(range.atr_14_version, WILDER_ATR_14_VERSION);
  assert.equal(range.average_range_legacy_version, AVERAGE_RANGE_LEGACY_VERSION);
  assert.equal(volatility.atr_14, 2.2143);
  assert.equal(volatility.average_range_14, 1.9286);
  assert.equal(volatility.volatility_reference_source, "wilder_atr_14");
});
