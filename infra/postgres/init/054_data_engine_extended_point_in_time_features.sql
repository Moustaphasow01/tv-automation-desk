WITH catalog(feature_definition_id, feature_version_id, feature_key, name, category, output_kind, description, formula_ref, formula_hash, input_schema, output_schema, parameters_schema, metadata) AS (
  VALUES
    ('20800000-0000-4000-8000-000000000011'::uuid, '20810000-0000-4000-8000-000000000011'::uuid, 'rsi_wilder_14', 'RSI Wilder 14', 'momentum', 'SERIES'::feature_output_kind, 'RSI Wilder 14 calculé uniquement sur clôtures disponibles au cutoff.', 'feature://price/rsi/wilder/14/v1', 'sha256:5555555555555555555555555555555555555555555555555555555555555555',
      '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["close"],"timeframes":["M1","M5","M15"]}'::jsonb,
      '{"kind":"series","value":"number","unit":"index_0_100"}'::jsonb,
      '{"length":{"type":"integer","const":14},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb,
      '{"lineage_role":"momentum_filter","cutoff_policy":"closed_bar_only","point_in_time_contract":"no_future_candle"}'::jsonb),
    ('20800000-0000-4000-8000-000000000012'::uuid, '20810000-0000-4000-8000-000000000012'::uuid, 'developing_volume_profile', 'Developing Volume Profile', 'volume_profile', 'MAP'::feature_output_kind, 'POC/VAH/VAL developing calculés sur volume-prix disponible au cutoff.', 'feature://volume-profile/developing/v1', 'sha256:6666666666666666666666666666666666666666666666666666666666666666',
      '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["high","low","close","volume"],"session_calendar":"market_session_occurrences"}'::jsonb,
      '{"kind":"map","fields":{"poc":"number","vah":"number","val":"number","developing":"boolean"}}'::jsonb,
      '{"price_bucket_ticks":{"type":"integer","minimum":1},"value_area_percent":{"type":"number","const":0.7},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb,
      '{"lineage_role":"developing_volume_acceptance","cutoff_policy":"cutoff_lte_closed_bars","point_in_time_contract":"no_future_volume"}'::jsonb),
    ('20800000-0000-4000-8000-000000000013'::uuid, '20810000-0000-4000-8000-000000000013'::uuid, 'prior_day_week_levels', 'Prior Day and Week Levels', 'session_structure', 'MAP'::feature_output_kind, 'Niveaux high/low/close du jour précédent et semaine roulante avant trading date/cutoff.', 'feature://session/prior-day-week-levels/v1', 'sha256:7777777777777777777777777777777777777777777777777777777777777777',
      '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["high","low","close"],"session_calendar":"market_session_occurrences"}'::jsonb,
      '{"kind":"map","fields":{"prior_day_high":"number","prior_day_low":"number","prior_week_high":"number","prior_week_low":"number"}}'::jsonb,
      '{"closed_bars_only":{"type":"boolean","const":true},"strictly_before_trading_date":{"type":"boolean","const":true}}'::jsonb,
      '{"lineage_role":"historical_levels","cutoff_policy":"strictly_before_trading_date_or_cutoff","point_in_time_contract":"no_future_session_levels"}'::jsonb),
    ('20800000-0000-4000-8000-000000000014'::uuid, '20810000-0000-4000-8000-000000000014'::uuid, 'realized_volatility', 'Realized Volatility', 'volatility', 'SERIES'::feature_output_kind, 'Volatilité réalisée calculée sur rendements de clôture disponibles au cutoff.', 'feature://returns/realized-volatility/v1', 'sha256:8888888888888888888888888888888888888888888888888888888888888888',
      '{"required_datasets":["MNQ_M1","MES_M1"],"optional_datasets":["NQ_H1","ES_H1"],"required_fields":["close"]}'::jsonb,
      '{"kind":"series","value":"number","unit":"return_volatility"}'::jsonb,
      '{"lookback_returns":{"type":"integer","minimum":2},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb,
      '{"lineage_role":"risk_volatility","cutoff_policy":"closed_return_window_lte_cutoff","point_in_time_contract":"no_future_return"}'::jsonb),
    ('20800000-0000-4000-8000-000000000015'::uuid, '20810000-0000-4000-8000-000000000015'::uuid, 'downside_semivariance', 'Downside Semivariance', 'volatility', 'SERIES'::feature_output_kind, 'Semivariance négative calculée sur rendements de clôture disponibles au cutoff.', 'feature://returns/downside-semivariance/v1', 'sha256:9999999999999999999999999999999999999999999999999999999999999999',
      '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["close"]}'::jsonb,
      '{"kind":"series","value":"number","unit":"return_variance"}'::jsonb,
      '{"lookback_returns":{"type":"integer","minimum":2},"threshold":{"type":"number","default":0},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb,
      '{"lineage_role":"risk_asymmetry","cutoff_policy":"closed_return_window_lte_cutoff","point_in_time_contract":"no_future_return"}'::jsonb),
    ('20800000-0000-4000-8000-000000000016'::uuid, '20810000-0000-4000-8000-000000000016'::uuid, 'rolling_correlation_beta', 'Rolling Correlation and Beta', 'intermarket', 'MAP'::feature_output_kind, 'Corrélation et beta roulants calculés sur rendements appairés strictement disponibles au cutoff.', 'feature://intermarket/rolling-correlation-beta/v1', 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      '{"required_datasets":["MNQ_M1","MES_M1"],"optional_datasets":["NQ_H1","ES_H1","DXY_CL_GC_VIX","US10Y_US02Y","mega_caps_premarket"],"required_fields":["close"]}'::jsonb,
      '{"kind":"map","fields":{"correlation":"number","beta":"number","pair":"string"}}'::jsonb,
      '{"lookback_returns":{"type":"integer","minimum":2},"matched_timestamps_only":{"type":"boolean","const":true},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb,
      '{"lineage_role":"portfolio_relationships","cutoff_policy":"matched_closed_returns_lte_cutoff","point_in_time_contract":"no_future_pair_bar"}'::jsonb)
)
INSERT INTO feature_definitions (
  feature_definition_id, feature_key, name, category, output_kind, status, description, metadata
)
SELECT feature_definition_id, feature_key, name, category, output_kind, 'ACTIVE'::feature_definition_status, description, metadata
FROM catalog
ON CONFLICT (feature_key) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  output_kind = EXCLUDED.output_kind,
  status = EXCLUDED.status,
  description = EXCLUDED.description,
  metadata = EXCLUDED.metadata,
  updated_at_utc = now();

WITH catalog(feature_version_id, feature_key, formula_ref, formula_hash, input_schema, output_schema, parameters_schema, metadata) AS (
  VALUES
    ('20810000-0000-4000-8000-000000000011'::uuid, 'rsi_wilder_14', 'feature://price/rsi/wilder/14/v1', 'sha256:5555555555555555555555555555555555555555555555555555555555555555', '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["close"],"timeframes":["M1","M5","M15"]}'::jsonb, '{"kind":"series","value":"number","unit":"index_0_100"}'::jsonb, '{"length":{"type":"integer","const":14},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb, '{"lineage_role":"momentum_filter","cutoff_policy":"closed_bar_only","point_in_time_contract":"no_future_candle"}'::jsonb),
    ('20810000-0000-4000-8000-000000000012'::uuid, 'developing_volume_profile', 'feature://volume-profile/developing/v1', 'sha256:6666666666666666666666666666666666666666666666666666666666666666', '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["high","low","close","volume"],"session_calendar":"market_session_occurrences"}'::jsonb, '{"kind":"map","fields":{"poc":"number","vah":"number","val":"number","developing":"boolean"}}'::jsonb, '{"price_bucket_ticks":{"type":"integer","minimum":1},"value_area_percent":{"type":"number","const":0.7},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb, '{"lineage_role":"developing_volume_acceptance","cutoff_policy":"cutoff_lte_closed_bars","point_in_time_contract":"no_future_volume"}'::jsonb),
    ('20810000-0000-4000-8000-000000000013'::uuid, 'prior_day_week_levels', 'feature://session/prior-day-week-levels/v1', 'sha256:7777777777777777777777777777777777777777777777777777777777777777', '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["high","low","close"],"session_calendar":"market_session_occurrences"}'::jsonb, '{"kind":"map","fields":{"prior_day_high":"number","prior_day_low":"number","prior_week_high":"number","prior_week_low":"number"}}'::jsonb, '{"closed_bars_only":{"type":"boolean","const":true},"strictly_before_trading_date":{"type":"boolean","const":true}}'::jsonb, '{"lineage_role":"historical_levels","cutoff_policy":"strictly_before_trading_date_or_cutoff","point_in_time_contract":"no_future_session_levels"}'::jsonb),
    ('20810000-0000-4000-8000-000000000014'::uuid, 'realized_volatility', 'feature://returns/realized-volatility/v1', 'sha256:8888888888888888888888888888888888888888888888888888888888888888', '{"required_datasets":["MNQ_M1","MES_M1"],"optional_datasets":["NQ_H1","ES_H1"],"required_fields":["close"]}'::jsonb, '{"kind":"series","value":"number","unit":"return_volatility"}'::jsonb, '{"lookback_returns":{"type":"integer","minimum":2},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb, '{"lineage_role":"risk_volatility","cutoff_policy":"closed_return_window_lte_cutoff","point_in_time_contract":"no_future_return"}'::jsonb),
    ('20810000-0000-4000-8000-000000000015'::uuid, 'downside_semivariance', 'feature://returns/downside-semivariance/v1', 'sha256:9999999999999999999999999999999999999999999999999999999999999999', '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["close"]}'::jsonb, '{"kind":"series","value":"number","unit":"return_variance"}'::jsonb, '{"lookback_returns":{"type":"integer","minimum":2},"threshold":{"type":"number","default":0},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb, '{"lineage_role":"risk_asymmetry","cutoff_policy":"closed_return_window_lte_cutoff","point_in_time_contract":"no_future_return"}'::jsonb),
    ('20810000-0000-4000-8000-000000000016'::uuid, 'rolling_correlation_beta', 'feature://intermarket/rolling-correlation-beta/v1', 'sha256:0000000000000000000000000000000000000000000000000000000000000000', '{"required_datasets":["MNQ_M1","MES_M1"],"optional_datasets":["NQ_H1","ES_H1","DXY_CL_GC_VIX","US10Y_US02Y","mega_caps_premarket"],"required_fields":["close"]}'::jsonb, '{"kind":"map","fields":{"correlation":"number","beta":"number","pair":"string"}}'::jsonb, '{"lookback_returns":{"type":"integer","minimum":2},"matched_timestamps_only":{"type":"boolean","const":true},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb, '{"lineage_role":"portfolio_relationships","cutoff_policy":"matched_closed_returns_lte_cutoff","point_in_time_contract":"no_future_pair_bar"}'::jsonb)
)
INSERT INTO feature_versions (
  feature_version_id, feature_definition_id, version, status, formula_ref, formula_hash,
  input_schema, output_schema, parameters_schema, deterministic, point_in_time_safe,
  min_dataset_schema_version, published_at_utc, metadata
)
SELECT catalog.feature_version_id, fd.feature_definition_id, '1.0.0', 'PUBLISHED'::feature_version_status,
       catalog.formula_ref, catalog.formula_hash, catalog.input_schema, catalog.output_schema,
       catalog.parameters_schema, true, true, 'dataset_v1', '2026-08-14T00:00:00.000Z'::timestamptz,
       catalog.metadata
FROM catalog
JOIN feature_definitions fd ON fd.feature_key = catalog.feature_key
ON CONFLICT (feature_definition_id, version) DO UPDATE SET
  status = EXCLUDED.status,
  formula_ref = EXCLUDED.formula_ref,
  formula_hash = EXCLUDED.formula_hash,
  input_schema = EXCLUDED.input_schema,
  output_schema = EXCLUDED.output_schema,
  parameters_schema = EXCLUDED.parameters_schema,
  deterministic = EXCLUDED.deterministic,
  point_in_time_safe = EXCLUDED.point_in_time_safe,
  min_dataset_schema_version = EXCLUDED.min_dataset_schema_version,
  published_at_utc = EXCLUDED.published_at_utc,
  metadata = EXCLUDED.metadata,
  updated_at_utc = now();
