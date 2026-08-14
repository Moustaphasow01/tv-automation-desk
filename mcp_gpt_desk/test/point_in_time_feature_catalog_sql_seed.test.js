import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationPath = path.join(repoRoot, "infra/postgres/init/031_feature_initial_point_in_time_catalog.sql");
const lot011MigrationPath = path.join(repoRoot, "infra/postgres/init/054_data_engine_extended_point_in_time_features.sql");
const engineeringDocPath = path.join(repoRoot, "docs/engineering/point-in-time-feature-catalog.md");
const registryDocPath = path.join(repoRoot, "docs/engineering/data-foundation-registry.md");

const migration = readFileSync(migrationPath, "utf8");
const lot011Migration = readFileSync(lot011MigrationPath, "utf8");

test("TD2-208 seeds the initial point-in-time feature definitions", () => {
  for (const key of [
    "wilder_atr_14",
    "session_vwap",
    "volume_profile_poc",
    "volume_profile_vah",
    "volume_profile_val",
    "initial_balance_range",
    "overnight_high_low",
    "intermarket_mnq_mes_spread",
    "cross_asset_risk_state",
    "macro_event_blackout_window",
  ]) {
    assert.match(migration, new RegExp(`'${key}'`));
  }
  assert.match(migration, /INSERT INTO feature_definitions/);
  assert.match(migration, /ON CONFLICT \(feature_key\) DO UPDATE/);
});

test("TD2-208 publishes safe deterministic feature versions", () => {
  assert.match(migration, /INSERT INTO feature_versions/);
  assert.match(migration, /'1.0.0', 'PUBLISHED'::feature_version_status/);
  assert.match(migration, /true, true, 'dataset_v1'/);
  assert.match(migration, /formula_hash/);
  assert.match(migration, /point_in_time_contract/);
  assert.match(migration, /cutoff_policy/);
  assert.match(migration, /published_at_utc/);
});

test("TD2-208 documents feature catalog and API lineage", () => {
  const engineeringDoc = readFileSync(engineeringDocPath, "utf8");
  const registryDoc = readFileSync(registryDocPath, "utf8");

  assert.match(engineeringDoc, /npm run catalog:features/);
  assert.match(engineeringDoc, /macro_event_blackout_window/);
  assert.match(engineeringDoc, /published_at_utc > cutoff/);
  assert.match(registryDoc, /Addendum TD2-208/);
  assert.match(registryDoc, /feature_definitions/);
  assert.match(registryDoc, /feature_versions/);
});

test("Lot011 extends the point-in-time catalog with data-engine certification features", () => {
  for (const key of [
    "rsi_wilder_14",
    "developing_volume_profile",
    "prior_day_week_levels",
    "realized_volatility",
    "downside_semivariance",
    "rolling_correlation_beta",
  ]) {
    assert.match(lot011Migration, new RegExp(`'${key}'`));
  }
  assert.match(lot011Migration, /INSERT INTO feature_definitions/);
  assert.match(lot011Migration, /INSERT INTO feature_versions/);
  assert.match(lot011Migration, /point_in_time_contract/);
  assert.match(lot011Migration, /matched_closed_returns_lte_cutoff/);
});

test("Lot011 documentation records extended deterministic features and capability limits", () => {
  const engineeringDoc = readFileSync(engineeringDocPath, "utf8");
  const registryDoc = readFileSync(registryDocPath, "utf8");

  assert.match(engineeringDoc, /developing_volume_profile/);
  assert.match(engineeringDoc, /ohlcv_typical_price_volume_bucket/);
  assert.match(registryDoc, /Addendum Lot011/);
  assert.match(registryDoc, /tick\/bid\/ask\/open interest/);
});
