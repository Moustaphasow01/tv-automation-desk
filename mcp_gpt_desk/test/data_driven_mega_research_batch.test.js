import test from "node:test";
import assert from "node:assert/strict";
import {
  DATA_DRIVEN_STRATEGY_FAMILIES,
  buildDataDrivenMegaResearchPlan,
} from "../src/research/data-driven-mega-research-batch.js";
import { getDataDrivenStrategyFamilies } from "../src/research/data-driven-strategy-family-catalog.js";

test("mega research plan generates 1000 variants across distinct data-driven families", () => {
  const scope = {
    batch_id: "mega-test",
    instrument: "MNQ",
    timeframe: "5",
    start_utc: "2026-06-01T00:00:00.000Z",
    end_utc: "2026-07-01T00:00:00.000Z",
  };
  const dataset = { dataset_key: "dataset-test", dataset_id: "dataset-id", cutoff_paris: "2026-07-01T02:00:00.000+02:00" };
  const tradingDays = Array.from({ length: 24 }, (_, index) => fakeTradingDay(index));

  const variants = buildDataDrivenMegaResearchPlan({ scope, dataset, tradingDays, count: 1_000 });

  assert.equal(variants.length, 1_000);
  assert.equal(new Set(variants.map((variant) => variant.candidate_key)).size, 1_000);
  assert.equal(new Set(variants.map((variant) => variant.family_id)).size, DATA_DRIVEN_STRATEGY_FAMILIES.length);
  assert.deepEqual(
    [...familyCounts(variants).values()].sort((left, right) => left - right),
    Array.from({ length: DATA_DRIVEN_STRATEGY_FAMILIES.length }, () => 50),
  );
  assert.ok(variants.some((variant) => variant.direction === "long"));
  assert.ok(variants.some((variant) => variant.direction === "short"));
  assert.ok(variants.some((variant) => variant.parameters.order_type === "LIMIT"));
  assert.ok(variants.some((variant) => variant.parameters.order_type === "MARKET"));
  assert.ok(variants.every((variant) => variant.runtime_setups.length <= 5));
  assert.ok(variants.every((variant) => variant.runtime_setups.length >= 1));
  assert.ok(variants.every((variant) => variant.runtime_setups.every((setup) => setup.break_level > 10_000)));
});

test("diversified v2 mega research plan expands families without changing v1 ordering", () => {
  const scope = {
    batch_id: "mega-test-v2",
    instrument: "MNQ",
    timeframe: "5",
    start_utc: "2026-06-01T00:00:00.000Z",
    end_utc: "2026-07-01T00:00:00.000Z",
    family_set: "diversified_v2",
    setups_per_variant: 5,
  };
  const dataset = { dataset_key: "dataset-test-v2", dataset_id: "dataset-id-v2", cutoff_paris: "2026-07-01T02:00:00.000+02:00" };
  const tradingDays = Array.from({ length: 24 }, (_, index) => fakeTradingDay(index));
  const v1Families = DATA_DRIVEN_STRATEGY_FAMILIES.map((item) => item.family_id);
  const v2Families = getDataDrivenStrategyFamilies("diversified_v2");

  const variants = buildDataDrivenMegaResearchPlan({ scope, dataset, tradingDays, count: 1_000 });

  assert.equal(v2Families.length, 40);
  assert.deepEqual(v2Families.slice(0, v1Families.length).map((item) => item.family_id), v1Families);
  assert.equal(variants.length, 1_000);
  assert.equal(new Set(variants.map((variant) => variant.family_id)).size, 40);
  assert.deepEqual(
    [...familyCounts(variants).values()].sort((left, right) => left - right),
    Array.from({ length: 40 }, () => 25),
  );
  assert.ok(variants.some((variant) => variant.family_id === "previous_day_high_reject_short"));
  assert.ok(variants.some((variant) => variant.family_id === "rolling_three_day_mean_reclaim_long"));
  assert.ok(variants.every((variant) => variant.runtime_setups.length <= 5));
  assert.ok(variants.every((variant) => variant.runtime_setups.length >= 1));
});

function familyCounts(variants) {
  const result = new Map();
  for (const variant of variants) {
    result.set(variant.family_id, (result.get(variant.family_id) || 0) + 1);
  }
  return result;
}

function fakeTradingDay(index) {
  const day = String(index + 1).padStart(2, "0");
  const base = 20_000 + index * 20;
  const rows = [
    row(base, base + 20, base - 8, base + 12),
    row(base + 12, base + 28, base + 2, base + 22),
    row(base + 20, base + 36, base + 10, base + 30),
    row(base + 26, base + 42, base + 16, base + 34),
  ];
  const high = base + 90 + (index % 5) * 8;
  const low = base - 55 - (index % 3) * 6;
  const daySummary = {
    trading_date: `2026-06-${day}`,
    first_time: `2026-06-${day}T09:15:00.000+02:00`,
    last_time: `2026-06-${day}T21:45:00.000+02:00`,
    open: base,
    high,
    low,
    close: base + 15,
    range: high - low,
    vwap: base + 18,
    asia: { high: base + 45, low: base - 20, open: base, close: base + 12 },
    nyOpening: { high: base + 70, low: base - 12, open: base + 20, close: base + 35 },
    dataset_stats: {
      range_p35: 120,
      range_p35_high: base + 65,
      range_p35_low: base - 35,
    },
    opening: (bars) => rangeSummary(rows.slice(0, Math.max(1, bars))),
  };
  daySummary.previous = index === 0 ? null : {
    open: base - 18,
    high: base + 70,
    low: base - 45,
    close: base - 5,
    range: 115,
  };
  return daySummary;
}

function row(open, high, low, close) {
  return { open, high, low, close };
}

function rangeSummary(rows) {
  return {
    high: Math.max(...rows.map((item) => item.high)),
    low: Math.min(...rows.map((item) => item.low)),
    open: rows[0]?.open,
    close: rows.at(-1)?.close,
  };
}
