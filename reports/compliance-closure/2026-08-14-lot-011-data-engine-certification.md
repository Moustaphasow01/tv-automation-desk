# Lot 011 — Data Engine Certification

Date: 2026-08-14
Repository: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD`
Branch: `codex/preprod-v4-local-parity-cleanup`
HEAD at audit start: `e18b48a310085679c94639420ca0b0b8c78ee70f`

## Objective

Close the repository-certifiable gaps for the Data Engine:

- primary execution feeds remain MNQ/MES;
- broad market context includes indices, rates, DXY, oil, gold, VIX and mega caps;
- deterministic point-in-time features exist for VWAP, volume profile levels, RSI, ATR, session levels, realized volatility, semivariance, correlation and beta;
- freshness/provenance is explicit;
- execution feeds fail closed while optional context can degrade without fabricating missing data.

## Initial audit

Already present before this lot:

- Canonical V5 data profile with required `MNQ_M1`, `MES_M1`, derived `MNQ_M5`, derived `MES_M5`.
- Market data coverage service with required-vs-optional freshness semantics.
- Macro calendar service with Forex Factory actual enrichment and first-observation timestamps.
- TradingView M1 backfill importer with manifest, hash, allowlist, exact row-grid and conflict quarantine.
- Data source, ingestion batch, dataset, feature, calendar, capability and storage SQL foundations.
- Anti-lookahead tests around cutoff-visible candles and macro actuals.

Gaps found:

1. `mega_caps_premarket` did not fully align with the target context list: `AMZN`, `META`, `GOOGL`, `AVGO` were not covered by both batch exporters, and `AVGO` was absent from the profile.
2. The point-in-time feature catalog exposed 10 features but missed several Lot011 families: RSI, developing volume profile, prior day/week levels, realized volatility, downside semivariance, rolling correlation/beta.
3. `buildSessionSnapshotDoc()` still emitted `poc_vah_val: {}` instead of a deterministic developing profile.
4. Tick/bid-ask/order-flow is only supportable through capability profiling until a certified provider feed supplies those fields.

## Implementation

### Market context coverage

- Extended the canonical V5 profile mega-cap context to:
  `AAPL`, `MSFT`, `NVDA`, `AMZN`, `META`, `GOOGL`, `AVGO`, `TSLA`, `SMH`, `SOXX`.
- Extended TradingView M5/H4 batch exporters for `AMZN`, `META`, `GOOGL`, `AVGO`.
- Kept the context feeds optional/degraded, not blocking, while MNQ/MES execution feeds remain required.

Files:

- `mcp_gpt_desk/src/v5-replay-data-profile.js`
- `tradingview/market_feed_batch_m5_exporter.pine`
- `tradingview/market_feed_batch_h4_exporter.pine`
- `mcp_gpt_desk/test/v5_replay_data_profile.test.js`
- `mcp_gpt_desk/test/tradingview_batch_exporters.test.js`
- `mcp_gpt_desk/test/market_data_coverage_service.test.js`

### Deterministic derived features

Created `mcp_gpt_desk/src/market-derived-features.js` with:

- `buildVolumeProfileLevels()`
- `buildDevelopingVolumeProfile()`
- `rsiWilderSeries()`
- `latestRsiWilder()`
- `priorDayLevels()`
- `priorWeekLevels()`
- `initialBalanceLevels()`
- `realizedVolatility()`
- `downsideSemivariance()`
- `rollingCorrelation()`
- `rollingBeta()`

Important invariants:

- closed rows only: `is_closed !== false`;
- developing volume profile filters `timestamp_utc <= cutoffUtc`;
- volume profile is explicitly marked as an OHLCV typical-price volume-bucket proxy, not a certified tick/order-flow volume profile;
- correlations and beta use matched closed-return timestamps only.

Files:

- `mcp_gpt_desk/src/market-derived-features.js`
- `mcp_gpt_desk/test/market_derived_features.test.js`

### Snapshot POC/VAH/VAL

Replaced the empty `poc_vah_val` placeholder with a deterministic developing profile.

Proof:

- `mcp_gpt_desk/src/desk-market-feature-algorithms.js:396`
- `mcp_gpt_desk/test/market_derived_features.test.js:91`

### Point-in-time catalog persistence

Added migration:

- `infra/postgres/init/054_data_engine_extended_point_in_time_features.sql`

It publishes:

- `rsi_wilder_14`
- `developing_volume_profile`
- `prior_day_week_levels`
- `realized_volatility`
- `downside_semivariance`
- `rolling_correlation_beta`

Each version is:

- `status = PUBLISHED`;
- `deterministic = true`;
- `point_in_time_safe = true`;
- `min_dataset_schema_version = dataset_v1`;
- tagged with `cutoff_policy` and `point_in_time_contract`.

Docs:

- `docs/engineering/point-in-time-feature-catalog.md`
- `docs/engineering/data-foundation-registry.md`

## PostgreSQL proof

Migration 054 was applied idempotently to local PostgreSQL:

```text
INSERT 0 6
INSERT 0 6
```

Runtime DB query:

```text
feature_key|category|output_kind|version|status|deterministic|point_in_time_safe|cutoff_policy|pit_contract
developing_volume_profile|volume_profile|MAP|1.0.0|PUBLISHED|t|t|cutoff_lte_closed_bars|no_future_volume
downside_semivariance|volatility|SERIES|1.0.0|PUBLISHED|t|t|closed_return_window_lte_cutoff|no_future_return
prior_day_week_levels|session_structure|MAP|1.0.0|PUBLISHED|t|t|strictly_before_trading_date_or_cutoff|no_future_session_levels
realized_volatility|volatility|SERIES|1.0.0|PUBLISHED|t|t|closed_return_window_lte_cutoff|no_future_return
rolling_correlation_beta|intermarket|MAP|1.0.0|PUBLISHED|t|t|matched_closed_returns_lte_cutoff|no_future_pair_bar
rsi_wilder_14|momentum|SERIES|1.0.0|PUBLISHED|t|t|closed_bar_only|no_future_candle
(6 rows)
```

## Runtime coverage proof

`auditMarketDataCoverage()` was executed against the real local PostgreSQL pool.

Result summary at `2026-07-27T08:03:00.000Z`:

```json
{
  "database_status": "queried",
  "coverage_status": "degraded",
  "execution_allowed": true,
  "profile_version": "1.1.0",
  "summary": {
    "dataset_count": 20,
    "required_count": 4,
    "required_ready_count": 4,
    "blocking_count": 0,
    "degraded_count": 16,
    "missing_count": 0,
    "stale_count": 16
  }
}
```

Selected feed proof:

```text
MNQ_M1 ready          prod__tradingview__MNQ1!__1  rows=17929
MES_M1 ready          prod__tradingview__MES1!__1  rows=17927
MNQ_M5 ready_derived  source=MNQ_M1               rows=17929
MES_M5 ready_derived  source=MES_M1               rows=17927
DXY_CL_GC_VIX stale   optional/degraded
US10Y_US02Y stale     optional/degraded
mega_caps_premarket stale optional/degraded
```

Interpretation: required execution feeds are ready, so execution data coverage is not blocked. Optional context is honestly degraded/stale and does not get fabricated.

## Tests

Targeted Lot011 suite:

```text
node --test \
  mcp_gpt_desk/test/market_derived_features.test.js \
  mcp_gpt_desk/test/point_in_time_feature_catalog.test.js \
  mcp_gpt_desk/test/point_in_time_feature_catalog_sql_seed.test.js \
  mcp_gpt_desk/test/market_data_coverage_service.test.js \
  mcp_gpt_desk/test/market_data_capability_profiler.test.js \
  mcp_gpt_desk/test/tradingview_batch_exporters.test.js \
  mcp_gpt_desk/test/v5_replay_data_profile.test.js \
  mcp_gpt_desk/test/tradingview_m1_backfill_importer.test.js \
  mcp_gpt_desk/test/macro_calendar_service.test.js \
  packages/desk-audit/test/audit.test.js \
  packages/desk-domain/test/runtime-data-adapters-v1.test.js
```

Result:

```text
61 pass / 0 fail
```

Full backend suite:

```text
npm --prefix mcp_gpt_desk test
1073 pass / 0 fail
```

Full domain suite:

```text
npm --prefix packages/desk-domain test
460 pass / 0 fail
```

## Guards

Passed:

```text
guard:architecture        OK
guard:runtime-safety      OK
guard:mcp-slices          OK
guard:sql-migrations      OK, migration_files=54
guard:exceptions          OK
guard:problem-details     OK
guard:windows-deployment  OK
```

Known historical failure, not hidden:

```text
guard:static-quality      KO connu
```

Current static-quality failures:

```text
mcp_gpt_desk/src/front-control-plane-api.js has 2075 lines; allowed 600
packages/desk-domain/src/strategy-dsl-compiler-v1.js has 624 lines; allowed 600
packages/desk-replay-engine/src/canonical-simulation-engine-v1.js has 881 lines; allowed 600
oversized functions: 249; allowed 243
high complexity functions: 644; allowed 592
duplicate blocks: 72; allowed 50
possibly dead files: 17; allowed 14
```

Lot011 temporarily added a new line-budget violation in `desk-market-feature-algorithms.js`; it was corrected before finalizing the lot. The remaining static-quality KO is the known Lot017 backlog.

## Requirement matrix

| Requirement | Final status | Proof / gap |
|---|---:|---|
| MNQ/MES are primary execution instruments | FAIT | Required canonical feeds in `v5-replay-data-profile.js`; coverage runtime shows 4/4 required ready. |
| Broad context beyond MNQ/MES | FAIT | Profile includes indices, H4, rates, DXY/oil/gold/VIX and mega caps. Optional context degrades honestly. |
| Big caps AAPL/MSFT/NVDA/AMZN/META/GOOGL/AVGO | FAIT | Profile/exporters/tests include target mega caps plus TSLA/SMH/SOXX. |
| VIX/DXY/rates/oil/gold context | FAIT | `DXY_CL_GC_VIX`, `US10Y_US02Y` profile groups + coverage tests. Runtime state currently stale/degraded but not missing/fabricated. |
| Macro calendar point-in-time | FAIT | Macro calendar tests validate provider timestamps, actual publication, failure/degraded state and cutoff filtering. |
| OHLCV support | FAIT | `market_candles`, TradingView webhook/importer/backfill tests, V5 profile tests. |
| Bid/ask/ticks/order-flow support when feed permits | PARTIEL | Capability profiler can represent missing microstructure without blocking OHLCV, but no certified provider feed/runtime proof currently supplies usable bid/ask/tick/order-flow. |
| VWAP deterministic | FAIT | Existing `session_vwap` PIT catalog and runtime-data-adapter tests. |
| Volume Profile / POC / VAH / VAL | FAIT | Deterministic OHLCV proxy implemented and tested; true tick/order-flow profile remains provider-dependent. |
| Developing POC/VAH/VAL | FAIT | `buildDevelopingVolumeProfile()` + session snapshot test. |
| ATR/RSI | FAIT | ATR already exists; RSI Wilder 14 added to code/catalog/migration/tests. |
| Overnight, prior day/week, Initial Balance | FAIT | Existing overnight/IB features plus new prior day/week deterministic feature/tests. |
| Realized volatility, semivariance, correlation, beta | FAIT | New deterministic functions/catalog/migration/tests. |
| Provenance/freshness/stale/missing visible | FAIT | `market-data-coverage-service.js` and runtime coverage DB proof. |
| No future/revised/synthetic undeclared contamination | FAIT for certified repository paths | Anti-lookahead tests, closed-row filtering, cutoff contracts, explicit OHLCV proxy approximation. |
| Futures roll | FAIT | Existing market calendar/session/rollover SQL and tests remain green. |
| Durable feed vs rescue feed | PARTIEL | Ingestion/backfill manifests, hot/cold storage and quarantine exist; provider-side durability of new optional context feeds needs runtime observation after live TradingView batches. |

## Blockers / external proof needed

- `BLOQUÉ EXTERNE`: certified tick/bid-ask/order-flow feed. Required human/provider action: provide a feed or provider contract that exposes these fields; expected proof is capability profile run with `supports_bid_ask/ticks/order_flow=true` and at least one persisted dataset sample.
- `BLOQUÉ EXTERNE`: optional context freshness in current local DB. TradingView context feeds are present but stale at the runtime proof timestamp. Expected proof is fresh batch alerts/backfill for `DXY`, `CL`, `GC`, `VIX`, `US10Y`, `US02Y`, mega caps and indices.

## Git status classification

This repository contains a large amount of ongoing untracked/modified work from previous lots and the Front VNext agent.

Lot011 required/untracked files include:

- `infra/postgres/init/054_data_engine_extended_point_in_time_features.sql`
- `mcp_gpt_desk/src/market-derived-features.js`
- `mcp_gpt_desk/test/market_derived_features.test.js`
- this report.

Tracked Lot011 modified files include:

- `mcp_gpt_desk/src/v5-replay-data-profile.js`
- `mcp_gpt_desk/src/desk-market-feature-algorithms.js`
- `mcp_gpt_desk/test/v5_replay_data_profile.test.js`
- `mcp_gpt_desk/test/tradingview_batch_exporters.test.js`
- `mcp_gpt_desk/test/point_in_time_feature_catalog.test.js`
- `mcp_gpt_desk/test/point_in_time_feature_catalog_sql_seed.test.js`
- `mcp_gpt_desk/test/market_data_coverage_service.test.js`
- `tradingview/market_feed_batch_m5_exporter.pine`
- `tradingview/market_feed_batch_h4_exporter.pine`
- `docs/engineering/point-in-time-feature-catalog.md`
- `docs/engineering/data-foundation-registry.md`

No secret file was intentionally created or printed in the report.

## Final status

`LOT 011 PARTIAL`

Repository-certifiable OHLCV/PIT Data Engine requirements are closed with code, tests and PostgreSQL proof. The remaining partials are provider/runtime availability items: certified microstructure feed and fresh optional context observations.

## Next lot

`LOT 012 — SEMI_MANUAL / PAPER Readiness`

Focus:

- certify Signal → Context → Portfolio → Risk → TargetPosition → OrderIntent → operator notification → Human Gate;
- prove manual actions do not fabricate fills;
- prove external manual broker fills reconcile separately from theoretical fills;
- keep `AUTO_EXECUTION` OFF by policy.
