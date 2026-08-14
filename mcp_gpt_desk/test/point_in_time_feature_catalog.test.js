import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_POINT_IN_TIME_FEATURE_CATALOG,
  buildPointInTimeFeatureCatalog,
  validatePointInTimeFeatureCatalog,
} from "../src/point-in-time-feature-catalog.js";

test("initial point-in-time feature catalog publishes required desk features", () => {
  const catalog = buildPointInTimeFeatureCatalog();
  const keys = catalog.features.map((feature) => feature.feature_key);

  assert.equal(catalog.feature_count, 16);
  assert.deepEqual(keys, [
    "wilder_atr_14",
    "rsi_wilder_14",
    "session_vwap",
    "volume_profile_poc",
    "volume_profile_vah",
    "volume_profile_val",
    "developing_volume_profile",
    "initial_balance_range",
    "overnight_high_low",
    "prior_day_week_levels",
    "realized_volatility",
    "downside_semivariance",
    "intermarket_mnq_mes_spread",
    "rolling_correlation_beta",
    "cross_asset_risk_state",
    "macro_event_blackout_window",
  ]);
  assert.equal(catalog.summary.by_category.volume_profile, 4);
  assert.equal(catalog.summary.by_output_kind.MAP, 6);
});

test("initial point-in-time feature catalog enforces version, hash and anti-lookahead metadata", () => {
  const validation = validatePointInTimeFeatureCatalog();

  assert.equal(validation.ok, true);
  assert.equal(validation.feature_count, INITIAL_POINT_IN_TIME_FEATURE_CATALOG.length);
  for (const feature of INITIAL_POINT_IN_TIME_FEATURE_CATALOG) {
    assert.equal(feature.version, "1.0.0");
    assert.equal(feature.status, "PUBLISHED");
    assert.equal(feature.deterministic, true);
    assert.equal(feature.point_in_time_safe, true);
    assert.match(feature.formula_hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(feature.min_dataset_schema_version, "dataset_v1");
    assert.ok(feature.metadata.required_datasets.length > 0);
    assert.ok(feature.metadata.cutoff_policy);
    assert.ok(feature.metadata.point_in_time_contract);
  }
});

test("initial point-in-time feature catalog marks cross-asset and macro actuals as cutoff-bound", () => {
  const crossAsset = INITIAL_POINT_IN_TIME_FEATURE_CATALOG.find((feature) => feature.feature_key === "cross_asset_risk_state");
  const macro = INITIAL_POINT_IN_TIME_FEATURE_CATALOG.find((feature) => feature.feature_key === "macro_event_blackout_window");

  assert.deepEqual(crossAsset.metadata.required_datasets, ["DXY_CL_GC_VIX", "US10Y_US02Y"]);
  assert.equal(crossAsset.metadata.point_in_time_contract, "no_macro_or_price_after_cutoff");
  assert.deepEqual(macro.metadata.required_datasets, ["macro_calendar"]);
  assert.equal(macro.metadata.cutoff_policy, "published_at_lte_cutoff");
  assert.equal(macro.metadata.point_in_time_contract, "actuals_blocked_until_published");
});

test("initial point-in-time feature catalog covers Lot011 deterministic feature families", () => {
  const catalog = buildPointInTimeFeatureCatalog();
  const byKey = new Map(catalog.features.map((feature) => [feature.feature_key, feature]));

  for (const key of [
    "rsi_wilder_14",
    "developing_volume_profile",
    "prior_day_week_levels",
    "realized_volatility",
    "downside_semivariance",
    "rolling_correlation_beta",
  ]) {
    const feature = byKey.get(key);
    assert.equal(feature.status, "PUBLISHED", key);
    assert.equal(feature.deterministic, true, key);
    assert.equal(feature.point_in_time_safe, true, key);
    assert.ok(feature.metadata.cutoff_policy, key);
    assert.ok(feature.metadata.point_in_time_contract, key);
  }

  assert.deepEqual(byKey.get("rolling_correlation_beta").metadata.optional_datasets, [
    "NQ_H1",
    "ES_H1",
    "DXY_CL_GC_VIX",
    "US10Y_US02Y",
    "mega_caps_premarket",
  ]);
});

test("initial point-in-time feature catalog reports validation errors on drift", () => {
  const broken = INITIAL_POINT_IN_TIME_FEATURE_CATALOG.map((feature) => ({ ...feature }));
  broken[0].formula_hash = "not-a-hash";
  const sessionVwap = broken.find((feature) => feature.feature_key === "session_vwap");
  sessionVwap.metadata = { ...sessionVwap.metadata, cutoff_policy: "" };

  const validation = validatePointInTimeFeatureCatalog(broken);

  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes("formula_hash_invalid:wilder_atr_14"));
  assert.ok(validation.errors.includes("cutoff_policy_missing:session_vwap"));
});
