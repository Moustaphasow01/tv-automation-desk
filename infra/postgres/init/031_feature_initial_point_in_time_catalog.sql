WITH catalog(feature_definition_id, feature_version_id, feature_key, name, category, output_kind, description, formula_ref, formula_hash, input_schema, output_schema, parameters_schema, metadata) AS (
  VALUES
    ('20800000-0000-4000-8000-000000000001'::uuid, '20810000-0000-4000-8000-000000000001'::uuid, 'wilder_atr_14', 'Wilder ATR 14', 'volatility', 'SERIES'::feature_output_kind, 'Average True Range Wilder 14, calculé uniquement sur bougies clôturées disponibles au cutoff.', 'feature://price/atr/wilder/14/v1', 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["high","low","close"],"timeframes":["M1","M5","M15"]}'::jsonb,
      '{"kind":"series","value":"number","unit":"points"}'::jsonb,
      '{"length":{"type":"integer","const":14},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb,
      '{"lineage_role":"risk_volatility","cutoff_policy":"closed_bar_only","point_in_time_contract":"no_future_candle"}'::jsonb),
    ('20800000-0000-4000-8000-000000000002'::uuid, '20810000-0000-4000-8000-000000000002'::uuid, 'session_vwap', 'Session VWAP', 'price', 'SERIES'::feature_output_kind, 'VWAP de session calculé avec prix typique et volume disponible au cutoff.', 'feature://price/session-vwap/v1', 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["high","low","close","volume"],"session_calendar":"market_session_occurrences"}'::jsonb,
      '{"kind":"series","value":"number","unit":"price"}'::jsonb,
      '{"session_scope":{"enum":["asia_open","ny_open","full_day"]},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb,
      '{"lineage_role":"session_anchor","cutoff_policy":"session_cutoff_closed_bars","point_in_time_contract":"session_occurrence_bound"}'::jsonb),
    ('20800000-0000-4000-8000-000000000003'::uuid, '20810000-0000-4000-8000-000000000003'::uuid, 'volume_profile_poc', 'Volume Profile POC', 'volume_profile', 'SCALAR'::feature_output_kind, 'Point of Control de la fenêtre de session, calculé sur distribution volume-prix disponible au cutoff.', 'feature://volume-profile/poc/v1', 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["high","low","close","volume"],"session_calendar":"market_session_occurrences"}'::jsonb,
      '{"kind":"scalar","value":"number","unit":"price"}'::jsonb,
      '{"price_bucket_ticks":{"type":"integer","minimum":1},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb,
      '{"lineage_role":"volume_acceptance","cutoff_policy":"session_cutoff_closed_bars","point_in_time_contract":"no_future_volume"}'::jsonb),
    ('20800000-0000-4000-8000-000000000004'::uuid, '20810000-0000-4000-8000-000000000004'::uuid, 'volume_profile_vah', 'Volume Profile VAH', 'volume_profile', 'SCALAR'::feature_output_kind, 'Value Area High calculé depuis le profil de volume disponible au cutoff.', 'feature://volume-profile/vah/v1', 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["high","low","close","volume"],"session_calendar":"market_session_occurrences"}'::jsonb,
      '{"kind":"scalar","value":"number","unit":"price"}'::jsonb,
      '{"value_area_percent":{"type":"number","const":0.7},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb,
      '{"lineage_role":"volume_acceptance","cutoff_policy":"session_cutoff_closed_bars","point_in_time_contract":"no_future_volume"}'::jsonb),
    ('20800000-0000-4000-8000-000000000005'::uuid, '20810000-0000-4000-8000-000000000005'::uuid, 'volume_profile_val', 'Volume Profile VAL', 'volume_profile', 'SCALAR'::feature_output_kind, 'Value Area Low calculé depuis le profil de volume disponible au cutoff.', 'feature://volume-profile/val/v1', 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["high","low","close","volume"],"session_calendar":"market_session_occurrences"}'::jsonb,
      '{"kind":"scalar","value":"number","unit":"price"}'::jsonb,
      '{"value_area_percent":{"type":"number","const":0.7},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb,
      '{"lineage_role":"volume_acceptance","cutoff_policy":"session_cutoff_closed_bars","point_in_time_contract":"no_future_volume"}'::jsonb),
    ('20800000-0000-4000-8000-000000000006'::uuid, '20810000-0000-4000-8000-000000000006'::uuid, 'initial_balance_range', 'Initial Balance Range', 'session_structure', 'MAP'::feature_output_kind, 'High/low/range de la fenêtre IB définie par calendrier de session, sans lecture après cutoff.', 'feature://session/initial-balance/v1', 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["high","low"],"session_calendar":"market_session_occurrences"}'::jsonb,
      '{"kind":"map","fields":{"high":"number","low":"number","range_points":"number"}}'::jsonb,
      '{"ib_minutes":{"type":"integer","enum":[30,60]},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb,
      '{"lineage_role":"session_structure","cutoff_policy":"ib_window_closed","point_in_time_contract":"session_occurrence_bound"}'::jsonb),
    ('20800000-0000-4000-8000-000000000007'::uuid, '20810000-0000-4000-8000-000000000007'::uuid, 'overnight_high_low', 'Overnight High Low', 'session_structure', 'MAP'::feature_output_kind, 'High/low overnight avant session courante, défini par calendrier et cutoff.', 'feature://session/overnight-high-low/v1', 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["high","low"],"session_calendar":"market_session_occurrences"}'::jsonb,
      '{"kind":"map","fields":{"high":"number","low":"number","mid":"number"}}'::jsonb,
      '{"reference_session":{"enum":["overnight","asia_to_ny"]},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb,
      '{"lineage_role":"overnight_context","cutoff_policy":"pre_session_closed_window","point_in_time_contract":"session_occurrence_bound"}'::jsonb),
    ('20800000-0000-4000-8000-000000000008'::uuid, '20810000-0000-4000-8000-000000000008'::uuid, 'intermarket_mnq_mes_spread', 'MNQ MES Intermarket Spread', 'intermarket', 'SERIES'::feature_output_kind, 'Écart normalisé MNQ/MES au cutoff pour confirmer divergence ou alignement.', 'feature://intermarket/mnq-mes-spread/v1', 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["close"],"alignment":"timestamp_lte_cutoff"}'::jsonb,
      '{"kind":"series","value":"number","unit":"normalized_points"}'::jsonb,
      '{"normalization":{"enum":["zscore","percent"]},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb,
      '{"lineage_role":"intermarket_confirmation","cutoff_policy":"matched_closed_bars","point_in_time_contract":"no_future_pair_bar"}'::jsonb),
    ('20800000-0000-4000-8000-000000000009'::uuid, '20810000-0000-4000-8000-000000000009'::uuid, 'cross_asset_risk_state', 'Cross Asset Risk State', 'cross_asset', 'MAP'::feature_output_kind, 'État DXY/VIX/taux/or/pétrole disponible au cutoff pour qualifier risk-on/risk-off.', 'feature://cross-asset/risk-state/v1', 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
      '{"required_datasets":["DXY_CL_GC_VIX","US10Y_US02Y"],"optional_datasets":["DXY_CL_GC_VIX_H4","US10Y_US02Y_H4"],"required_fields":["close"]}'::jsonb,
      '{"kind":"map","fields":{"risk_regime":"string","dxy_bias":"string","vix_bias":"string","rates_bias":"string"}}'::jsonb,
      '{"lookback_bars":{"type":"integer","minimum":1},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb,
      '{"lineage_role":"cross_asset_context","cutoff_policy":"closed_bar_lte_cutoff","point_in_time_contract":"no_macro_or_price_after_cutoff"}'::jsonb),
    ('20800000-0000-4000-8000-000000000010'::uuid, '20810000-0000-4000-8000-000000000010'::uuid, 'macro_event_blackout_window', 'Macro Event Blackout Window', 'macro', 'EVENT'::feature_output_kind, 'Fenêtre de blackout construite depuis calendrier macro et publication connue au cutoff.', 'feature://macro/event-blackout-window/v1', 'sha256:4444444444444444444444444444444444444444444444444444444444444444',
      '{"required_datasets":["macro_calendar"],"required_fields":["event_time_utc","importance","published_at_utc"]}'::jsonb,
      '{"kind":"event","fields":{"blackout_active":"boolean","event_id":"string","minutes_to_event":"number"}}'::jsonb,
      '{"pre_event_minutes":{"type":"integer","minimum":0},"post_event_minutes":{"type":"integer","minimum":0},"actuals_visible_only_if_published":{"type":"boolean","const":true}}'::jsonb,
      '{"lineage_role":"macro_risk_veto","cutoff_policy":"published_at_lte_cutoff","point_in_time_contract":"actuals_blocked_until_published"}'::jsonb)
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
    ('20810000-0000-4000-8000-000000000001'::uuid, 'wilder_atr_14', 'feature://price/atr/wilder/14/v1', 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["high","low","close"],"timeframes":["M1","M5","M15"]}'::jsonb, '{"kind":"series","value":"number","unit":"points"}'::jsonb, '{"length":{"type":"integer","const":14},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb, '{"lineage_role":"risk_volatility","cutoff_policy":"closed_bar_only","point_in_time_contract":"no_future_candle"}'::jsonb),
    ('20810000-0000-4000-8000-000000000002'::uuid, 'session_vwap', 'feature://price/session-vwap/v1', 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["high","low","close","volume"],"session_calendar":"market_session_occurrences"}'::jsonb, '{"kind":"series","value":"number","unit":"price"}'::jsonb, '{"session_scope":{"enum":["asia_open","ny_open","full_day"]},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb, '{"lineage_role":"session_anchor","cutoff_policy":"session_cutoff_closed_bars","point_in_time_contract":"session_occurrence_bound"}'::jsonb),
    ('20810000-0000-4000-8000-000000000003'::uuid, 'volume_profile_poc', 'feature://volume-profile/poc/v1', 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["high","low","close","volume"],"session_calendar":"market_session_occurrences"}'::jsonb, '{"kind":"scalar","value":"number","unit":"price"}'::jsonb, '{"price_bucket_ticks":{"type":"integer","minimum":1},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb, '{"lineage_role":"volume_acceptance","cutoff_policy":"session_cutoff_closed_bars","point_in_time_contract":"no_future_volume"}'::jsonb),
    ('20810000-0000-4000-8000-000000000004'::uuid, 'volume_profile_vah', 'feature://volume-profile/vah/v1', 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["high","low","close","volume"],"session_calendar":"market_session_occurrences"}'::jsonb, '{"kind":"scalar","value":"number","unit":"price"}'::jsonb, '{"value_area_percent":{"type":"number","const":0.7},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb, '{"lineage_role":"volume_acceptance","cutoff_policy":"session_cutoff_closed_bars","point_in_time_contract":"no_future_volume"}'::jsonb),
    ('20810000-0000-4000-8000-000000000005'::uuid, 'volume_profile_val', 'feature://volume-profile/val/v1', 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["high","low","close","volume"],"session_calendar":"market_session_occurrences"}'::jsonb, '{"kind":"scalar","value":"number","unit":"price"}'::jsonb, '{"value_area_percent":{"type":"number","const":0.7},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb, '{"lineage_role":"volume_acceptance","cutoff_policy":"session_cutoff_closed_bars","point_in_time_contract":"no_future_volume"}'::jsonb),
    ('20810000-0000-4000-8000-000000000006'::uuid, 'initial_balance_range', 'feature://session/initial-balance/v1', 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["high","low"],"session_calendar":"market_session_occurrences"}'::jsonb, '{"kind":"map","fields":{"high":"number","low":"number","range_points":"number"}}'::jsonb, '{"ib_minutes":{"type":"integer","enum":[30,60]},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb, '{"lineage_role":"session_structure","cutoff_policy":"ib_window_closed","point_in_time_contract":"session_occurrence_bound"}'::jsonb),
    ('20810000-0000-4000-8000-000000000007'::uuid, 'overnight_high_low', 'feature://session/overnight-high-low/v1', 'sha256:1111111111111111111111111111111111111111111111111111111111111111', '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["high","low"],"session_calendar":"market_session_occurrences"}'::jsonb, '{"kind":"map","fields":{"high":"number","low":"number","mid":"number"}}'::jsonb, '{"reference_session":{"enum":["overnight","asia_to_ny"]},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb, '{"lineage_role":"overnight_context","cutoff_policy":"pre_session_closed_window","point_in_time_contract":"session_occurrence_bound"}'::jsonb),
    ('20810000-0000-4000-8000-000000000008'::uuid, 'intermarket_mnq_mes_spread', 'feature://intermarket/mnq-mes-spread/v1', 'sha256:2222222222222222222222222222222222222222222222222222222222222222', '{"required_datasets":["MNQ_M1","MES_M1"],"required_fields":["close"],"alignment":"timestamp_lte_cutoff"}'::jsonb, '{"kind":"series","value":"number","unit":"normalized_points"}'::jsonb, '{"normalization":{"enum":["zscore","percent"]},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb, '{"lineage_role":"intermarket_confirmation","cutoff_policy":"matched_closed_bars","point_in_time_contract":"no_future_pair_bar"}'::jsonb),
    ('20810000-0000-4000-8000-000000000009'::uuid, 'cross_asset_risk_state', 'feature://cross-asset/risk-state/v1', 'sha256:3333333333333333333333333333333333333333333333333333333333333333', '{"required_datasets":["DXY_CL_GC_VIX","US10Y_US02Y"],"optional_datasets":["DXY_CL_GC_VIX_H4","US10Y_US02Y_H4"],"required_fields":["close"]}'::jsonb, '{"kind":"map","fields":{"risk_regime":"string","dxy_bias":"string","vix_bias":"string","rates_bias":"string"}}'::jsonb, '{"lookback_bars":{"type":"integer","minimum":1},"closed_bars_only":{"type":"boolean","const":true}}'::jsonb, '{"lineage_role":"cross_asset_context","cutoff_policy":"closed_bar_lte_cutoff","point_in_time_contract":"no_macro_or_price_after_cutoff"}'::jsonb),
    ('20810000-0000-4000-8000-000000000010'::uuid, 'macro_event_blackout_window', 'feature://macro/event-blackout-window/v1', 'sha256:4444444444444444444444444444444444444444444444444444444444444444', '{"required_datasets":["macro_calendar"],"required_fields":["event_time_utc","importance","published_at_utc"]}'::jsonb, '{"kind":"event","fields":{"blackout_active":"boolean","event_id":"string","minutes_to_event":"number"}}'::jsonb, '{"pre_event_minutes":{"type":"integer","minimum":0},"post_event_minutes":{"type":"integer","minimum":0},"actuals_visible_only_if_published":{"type":"boolean","const":true}}'::jsonb, '{"lineage_role":"macro_risk_veto","cutoff_policy":"published_at_lte_cutoff","point_in_time_contract":"actuals_blocked_until_published"}'::jsonb)
)
INSERT INTO feature_versions (
  feature_version_id, feature_definition_id, version, status, formula_ref, formula_hash,
  input_schema, output_schema, parameters_schema, deterministic, point_in_time_safe,
  min_dataset_schema_version, published_at_utc, metadata
)
SELECT catalog.feature_version_id, fd.feature_definition_id, '1.0.0', 'PUBLISHED'::feature_version_status,
       catalog.formula_ref, catalog.formula_hash, catalog.input_schema, catalog.output_schema,
       catalog.parameters_schema, true, true, 'dataset_v1', '2026-08-09T00:00:00.000Z'::timestamptz,
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
