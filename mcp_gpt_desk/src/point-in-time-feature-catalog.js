export const POINT_IN_TIME_FEATURE_CATALOG_SCHEMA_VERSION = "point_in_time_feature_catalog_v1";

export const INITIAL_POINT_IN_TIME_FEATURE_CATALOG = Object.freeze([
  feature("wilder_atr_14", "Wilder ATR 14", "volatility", "SERIES", "feature://price/atr/wilder/14/v1", "a", {
    required_datasets: ["MNQ_M1", "MES_M1"],
    required_fields: ["high", "low", "close"],
    lineage_role: "risk_volatility",
    cutoff_policy: "closed_bar_only",
    point_in_time_contract: "no_future_candle",
  }),
  feature("rsi_wilder_14", "RSI Wilder 14", "momentum", "SERIES", "feature://price/rsi/wilder/14/v1", "5", {
    required_datasets: ["MNQ_M1", "MES_M1"],
    required_fields: ["close"],
    lineage_role: "momentum_filter",
    cutoff_policy: "closed_bar_only",
    point_in_time_contract: "no_future_candle",
  }),
  feature("session_vwap", "Session VWAP", "price", "SERIES", "feature://price/session-vwap/v1", "b", {
    required_datasets: ["MNQ_M1", "MES_M1"],
    required_fields: ["high", "low", "close", "volume"],
    session_calendar: "market_session_occurrences",
    lineage_role: "session_anchor",
    cutoff_policy: "session_cutoff_closed_bars",
    point_in_time_contract: "session_occurrence_bound",
  }),
  feature("volume_profile_poc", "Volume Profile POC", "volume_profile", "SCALAR", "feature://volume-profile/poc/v1", "c", {
    required_datasets: ["MNQ_M1", "MES_M1"],
    required_fields: ["high", "low", "close", "volume"],
    lineage_role: "volume_acceptance",
    cutoff_policy: "session_cutoff_closed_bars",
    point_in_time_contract: "no_future_volume",
  }),
  feature("volume_profile_vah", "Volume Profile VAH", "volume_profile", "SCALAR", "feature://volume-profile/vah/v1", "d", {
    required_datasets: ["MNQ_M1", "MES_M1"],
    required_fields: ["high", "low", "close", "volume"],
    lineage_role: "volume_acceptance",
    cutoff_policy: "session_cutoff_closed_bars",
    point_in_time_contract: "no_future_volume",
  }),
  feature("volume_profile_val", "Volume Profile VAL", "volume_profile", "SCALAR", "feature://volume-profile/val/v1", "e", {
    required_datasets: ["MNQ_M1", "MES_M1"],
    required_fields: ["high", "low", "close", "volume"],
    lineage_role: "volume_acceptance",
    cutoff_policy: "session_cutoff_closed_bars",
    point_in_time_contract: "no_future_volume",
  }),
  feature("developing_volume_profile", "Developing Volume Profile", "volume_profile", "MAP", "feature://volume-profile/developing/v1", "6", {
    required_datasets: ["MNQ_M1", "MES_M1"],
    required_fields: ["high", "low", "close", "volume"],
    lineage_role: "developing_volume_acceptance",
    cutoff_policy: "cutoff_lte_closed_bars",
    point_in_time_contract: "no_future_volume",
  }),
  feature("initial_balance_range", "Initial Balance Range", "session_structure", "MAP", "feature://session/initial-balance/v1", "f", {
    required_datasets: ["MNQ_M1", "MES_M1"],
    required_fields: ["high", "low"],
    session_calendar: "market_session_occurrences",
    lineage_role: "session_structure",
    cutoff_policy: "ib_window_closed",
    point_in_time_contract: "session_occurrence_bound",
  }),
  feature("overnight_high_low", "Overnight High Low", "session_structure", "MAP", "feature://session/overnight-high-low/v1", "1", {
    required_datasets: ["MNQ_M1", "MES_M1"],
    required_fields: ["high", "low"],
    session_calendar: "market_session_occurrences",
    lineage_role: "overnight_context",
    cutoff_policy: "pre_session_closed_window",
    point_in_time_contract: "session_occurrence_bound",
  }),
  feature("prior_day_week_levels", "Prior Day and Week Levels", "session_structure", "MAP", "feature://session/prior-day-week-levels/v1", "7", {
    required_datasets: ["MNQ_M1", "MES_M1"],
    required_fields: ["high", "low", "close"],
    lineage_role: "historical_levels",
    cutoff_policy: "strictly_before_trading_date_or_cutoff",
    point_in_time_contract: "no_future_session_levels",
  }),
  feature("realized_volatility", "Realized Volatility", "volatility", "SERIES", "feature://returns/realized-volatility/v1", "8", {
    required_datasets: ["MNQ_M1", "MES_M1"],
    optional_datasets: ["NQ_H1", "ES_H1"],
    required_fields: ["close"],
    lineage_role: "risk_volatility",
    cutoff_policy: "closed_return_window_lte_cutoff",
    point_in_time_contract: "no_future_return",
  }),
  feature("downside_semivariance", "Downside Semivariance", "volatility", "SERIES", "feature://returns/downside-semivariance/v1", "9", {
    required_datasets: ["MNQ_M1", "MES_M1"],
    required_fields: ["close"],
    lineage_role: "risk_asymmetry",
    cutoff_policy: "closed_return_window_lte_cutoff",
    point_in_time_contract: "no_future_return",
  }),
  feature("intermarket_mnq_mes_spread", "MNQ MES Intermarket Spread", "intermarket", "SERIES", "feature://intermarket/mnq-mes-spread/v1", "2", {
    required_datasets: ["MNQ_M1", "MES_M1"],
    required_fields: ["close"],
    lineage_role: "intermarket_confirmation",
    cutoff_policy: "matched_closed_bars",
    point_in_time_contract: "no_future_pair_bar",
  }),
  feature("rolling_correlation_beta", "Rolling Correlation and Beta", "intermarket", "MAP", "feature://intermarket/rolling-correlation-beta/v1", "0", {
    required_datasets: ["MNQ_M1", "MES_M1"],
    optional_datasets: ["NQ_H1", "ES_H1", "DXY_CL_GC_VIX", "US10Y_US02Y", "mega_caps_premarket"],
    required_fields: ["close"],
    lineage_role: "portfolio_relationships",
    cutoff_policy: "matched_closed_returns_lte_cutoff",
    point_in_time_contract: "no_future_pair_bar",
  }),
  feature("cross_asset_risk_state", "Cross Asset Risk State", "cross_asset", "MAP", "feature://cross-asset/risk-state/v1", "3", {
    required_datasets: ["DXY_CL_GC_VIX", "US10Y_US02Y"],
    optional_datasets: ["DXY_CL_GC_VIX_H4", "US10Y_US02Y_H4"],
    required_fields: ["close"],
    lineage_role: "cross_asset_context",
    cutoff_policy: "closed_bar_lte_cutoff",
    point_in_time_contract: "no_macro_or_price_after_cutoff",
  }),
  feature("macro_event_blackout_window", "Macro Event Blackout Window", "macro", "EVENT", "feature://macro/event-blackout-window/v1", "4", {
    required_datasets: ["macro_calendar"],
    required_fields: ["event_time_utc", "importance", "published_at_utc"],
    lineage_role: "macro_risk_veto",
    cutoff_policy: "published_at_lte_cutoff",
    point_in_time_contract: "actuals_blocked_until_published",
  }),
]);

export function buildPointInTimeFeatureCatalog() {
  return {
    schema_version: POINT_IN_TIME_FEATURE_CATALOG_SCHEMA_VERSION,
    version: "1.0.0",
    feature_count: INITIAL_POINT_IN_TIME_FEATURE_CATALOG.length,
    features: INITIAL_POINT_IN_TIME_FEATURE_CATALOG.map((item) => ({ ...item, metadata: { ...item.metadata } })),
    summary: summarizeFeatureCatalog(INITIAL_POINT_IN_TIME_FEATURE_CATALOG),
  };
}

export function validatePointInTimeFeatureCatalog(features = INITIAL_POINT_IN_TIME_FEATURE_CATALOG) {
  const errors = [];
  const keys = new Set();
  for (const item of features) {
    if (!item.feature_key) errors.push("feature_key_missing");
    if (keys.has(item.feature_key)) errors.push(`feature_key_duplicate:${item.feature_key}`);
    keys.add(item.feature_key);
    if (!["SCALAR", "SERIES", "EVENT", "MAP"].includes(item.output_kind)) errors.push(`output_kind_invalid:${item.feature_key}`);
    if (!/^feature:\/\//.test(item.formula_ref || "")) errors.push(`formula_ref_invalid:${item.feature_key}`);
    if (!/^sha256:[a-f0-9]{64}$/.test(item.formula_hash || "")) errors.push(`formula_hash_invalid:${item.feature_key}`);
    if (item.status !== "PUBLISHED") errors.push(`status_not_published:${item.feature_key}`);
    if (item.deterministic !== true) errors.push(`not_deterministic:${item.feature_key}`);
    if (item.point_in_time_safe !== true) errors.push(`not_point_in_time_safe:${item.feature_key}`);
    if (!item.metadata?.cutoff_policy) errors.push(`cutoff_policy_missing:${item.feature_key}`);
    if (!item.metadata?.point_in_time_contract) errors.push(`pit_contract_missing:${item.feature_key}`);
    if (!Array.isArray(item.metadata?.required_datasets) || !item.metadata.required_datasets.length) errors.push(`required_datasets_missing:${item.feature_key}`);
  }
  return {
    ok: errors.length === 0,
    errors,
    feature_count: features.length,
    categories: [...new Set(features.map((item) => item.category))].sort(),
  };
}

export function summarizeFeatureCatalog(features = INITIAL_POINT_IN_TIME_FEATURE_CATALOG) {
  return {
    by_category: countBy(features, "category"),
    by_output_kind: countBy(features, "output_kind"),
    macro_feature_count: features.filter((item) => item.category === "macro").length,
    cross_asset_feature_count: features.filter((item) => item.category === "cross_asset").length,
    point_in_time_safe_count: features.filter((item) => item.point_in_time_safe === true).length,
  };
}

function feature(featureKey, name, category, outputKind, formulaRef, hashChar, metadata) {
  return Object.freeze({
    feature_key: featureKey,
    name,
    category,
    output_kind: outputKind,
    version: "1.0.0",
    status: "PUBLISHED",
    formula_ref: formulaRef,
    formula_hash: `sha256:${hashChar.repeat(64)}`,
    deterministic: true,
    point_in_time_safe: true,
    min_dataset_schema_version: "dataset_v1",
    metadata: Object.freeze({ ...metadata }),
  });
}

function countBy(items, field) {
  return items.reduce((acc, item) => {
    const key = item[field] || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}
