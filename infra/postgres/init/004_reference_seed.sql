INSERT INTO market_instruments (
  instrument_code,
  display_name,
  asset_class,
  market_family,
  currency,
  tick_size,
  point_value,
  active,
  metadata
) VALUES
  ('MNQ', 'Micro Nasdaq futures', 'futures_index', 'us_indices', 'USD', 0.25, 2, true, '{"desk_primary": true}'::jsonb),
  ('MES', 'Micro S&P 500 futures', 'futures_index', 'us_indices', 'USD', 0.25, 5, true, '{"desk_primary": true}'::jsonb),
  ('NQ', 'Nasdaq futures', 'futures_index', 'us_indices', 'USD', 0.25, 20, true, '{}'::jsonb),
  ('ES', 'S&P 500 futures', 'futures_index', 'us_indices', 'USD', 0.25, 50, true, '{}'::jsonb),
  ('DXY', 'US Dollar Index', 'macro_fx', 'cross_asset', 'USD', NULL, NULL, true, '{}'::jsonb),
  ('VIX', 'CBOE Volatility Index', 'volatility', 'cross_asset', 'USD', NULL, NULL, true, '{}'::jsonb),
  ('US10Y', 'US 10Y Yield', 'rates', 'cross_asset', 'USD', NULL, NULL, true, '{}'::jsonb),
  ('US02Y', 'US 2Y Yield', 'rates', 'cross_asset', 'USD', NULL, NULL, true, '{}'::jsonb),
  ('GC', 'Gold futures', 'commodity', 'cross_asset', 'USD', 0.1, 100, true, '{}'::jsonb),
  ('CL', 'Crude Oil futures', 'commodity', 'cross_asset', 'USD', 0.01, 1000, true, '{}'::jsonb),
  ('DAX', 'DAX Index', 'futures_index', 'eu_indices', 'EUR', NULL, NULL, true, '{}'::jsonb),
  ('AAPL', 'Apple', 'equity', 'mega_caps', 'USD', 0.01, 1, true, '{}'::jsonb),
  ('MSFT', 'Microsoft', 'equity', 'mega_caps', 'USD', 0.01, 1, true, '{}'::jsonb),
  ('NVDA', 'NVIDIA', 'equity', 'mega_caps', 'USD', 0.01, 1, true, '{}'::jsonb),
  ('TSLA', 'Tesla', 'equity', 'mega_caps', 'USD', 0.01, 1, true, '{}'::jsonb),
  ('QQQ', 'Nasdaq 100 ETF', 'etf', 'mega_caps', 'USD', 0.01, 1, true, '{}'::jsonb),
  ('SMH', 'VanEck Semiconductor ETF', 'etf', 'semiconductors', 'USD', 0.01, 1, true, '{}'::jsonb),
  ('SOXX', 'iShares Semiconductor ETF', 'etf', 'semiconductors', 'USD', 0.01, 1, true, '{}'::jsonb)
ON CONFLICT (instrument_code) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  asset_class = EXCLUDED.asset_class,
  market_family = EXCLUDED.market_family,
  currency = EXCLUDED.currency,
  tick_size = EXCLUDED.tick_size,
  point_value = EXCLUDED.point_value,
  active = EXCLUDED.active,
  metadata = market_instruments.metadata || EXCLUDED.metadata,
  updated_at = now();

INSERT INTO market_symbols (
  symbol_id,
  instrument_code,
  provider,
  symbol_code,
  exchange,
  provider_type,
  primary_for_instrument,
  active,
  metadata
) VALUES
  ('tradingview:MNQ1!', 'MNQ', 'tradingview', 'MNQ1!', 'CME', 'continuous_future', true, true, '{}'::jsonb),
  ('tradingview:MES1!', 'MES', 'tradingview', 'MES1!', 'CME', 'continuous_future', true, true, '{}'::jsonb),
  ('tradingview:NQ1!', 'NQ', 'tradingview', 'NQ1!', 'CME', 'continuous_future', true, true, '{}'::jsonb),
  ('tradingview:ES1!', 'ES', 'tradingview', 'ES1!', 'CME', 'continuous_future', true, true, '{}'::jsonb),
  ('tradingview:GC1!', 'GC', 'tradingview', 'GC1!', 'COMEX', 'continuous_future', true, true, '{}'::jsonb),
  ('tradingview:CL1!', 'CL', 'tradingview', 'CL1!', 'NYMEX', 'continuous_future', true, true, '{}'::jsonb),
  ('tradingview:DXY', 'DXY', 'tradingview', 'DXY', NULL, 'index', true, true, '{}'::jsonb),
  ('tradingview:VIX', 'VIX', 'tradingview', 'VIX', 'CBOE', 'index', true, true, '{}'::jsonb),
  ('tradingview:US10Y', 'US10Y', 'tradingview', 'US10Y', NULL, 'yield', true, true, '{}'::jsonb),
  ('tradingview:US02Y', 'US02Y', 'tradingview', 'US02Y', NULL, 'yield', true, true, '{}'::jsonb),
  ('tradingview:DAX', 'DAX', 'tradingview', 'DAX', NULL, 'index', true, true, '{}'::jsonb),
  ('tradingview:AAPL', 'AAPL', 'tradingview', 'AAPL', 'NASDAQ', 'equity', true, true, '{}'::jsonb),
  ('tradingview:MSFT', 'MSFT', 'tradingview', 'MSFT', 'NASDAQ', 'equity', true, true, '{}'::jsonb),
  ('tradingview:NVDA', 'NVDA', 'tradingview', 'NVDA', 'NASDAQ', 'equity', true, true, '{}'::jsonb),
  ('tradingview:TSLA', 'TSLA', 'tradingview', 'TSLA', 'NASDAQ', 'equity', true, true, '{}'::jsonb),
  ('tradingview:QQQ', 'QQQ', 'tradingview', 'QQQ', 'NASDAQ', 'etf', true, true, '{}'::jsonb),
  ('tradingview:SMH', 'SMH', 'tradingview', 'SMH', 'NASDAQ', 'etf', true, true, '{}'::jsonb),
  ('tradingview:SOXX', 'SOXX', 'tradingview', 'SOXX', 'NASDAQ', 'etf', true, true, '{}'::jsonb)
ON CONFLICT (provider, symbol_code) DO UPDATE
SET
  instrument_code = EXCLUDED.instrument_code,
  exchange = EXCLUDED.exchange,
  provider_type = EXCLUDED.provider_type,
  primary_for_instrument = EXCLUDED.primary_for_instrument,
  active = EXCLUDED.active,
  metadata = market_symbols.metadata || EXCLUDED.metadata,
  updated_at = now();

INSERT INTO market_timeframes (timeframe, seconds, group_name, intraday, active, metadata) VALUES
  ('1', 60, 'intraday', true, true, '{"aliases": ["M1", "1M"]}'::jsonb),
  ('5', 300, 'intraday', true, true, '{"aliases": ["M5", "5M"]}'::jsonb),
  ('15', 900, 'intraday', true, true, '{"aliases": ["M15", "15M"]}'::jsonb),
  ('30', 1800, 'intraday', true, true, '{"aliases": ["M30", "30M"]}'::jsonb),
  ('1H', 3600, 'higher_timeframe', true, true, '{"aliases": ["H1", "60"]}'::jsonb),
  ('4H', 14400, 'higher_timeframe', true, true, '{"aliases": ["H4", "240"]}'::jsonb),
  ('1D', 86400, 'daily', false, true, '{"aliases": ["D", "D1"]}'::jsonb)
ON CONFLICT (timeframe) DO UPDATE
SET
  seconds = EXCLUDED.seconds,
  group_name = EXCLUDED.group_name,
  intraday = EXCLUDED.intraday,
  active = EXCLUDED.active,
  metadata = market_timeframes.metadata || EXCLUDED.metadata;

INSERT INTO broker_providers (broker_provider_code, display_name, enabled, metadata) VALUES
  ('ninjatrader', 'NinjaTrader', false, '{"runtime": "future", "default_state": "disabled"}'::jsonb)
ON CONFLICT (broker_provider_code) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  enabled = EXCLUDED.enabled,
  metadata = broker_providers.metadata || EXCLUDED.metadata,
  updated_at = now();

INSERT INTO broker_accounts (
  broker_account_id,
  broker_provider_code,
  account_label,
  environment,
  mode,
  currency,
  read_only,
  order_submission_enabled,
  max_contracts,
  metadata
) VALUES
  ('ninjatrader_paper_local', 'ninjatrader', 'NinjaTrader paper local — disabled', 'preprod', 'paper', 'USD', true, false, 0, '{"reason": "prepared_for_future_bridge"}'::jsonb),
  ('ninjatrader_live_disabled', 'ninjatrader', 'NinjaTrader live — disabled', 'preprod', 'live', 'USD', true, false, 0, '{"reason": "safety_default_no_live_execution"}'::jsonb)
ON CONFLICT (broker_account_id) DO UPDATE
SET
  account_label = EXCLUDED.account_label,
  environment = EXCLUDED.environment,
  mode = EXCLUDED.mode,
  currency = EXCLUDED.currency,
  read_only = EXCLUDED.read_only,
  order_submission_enabled = EXCLUDED.order_submission_enabled,
  max_contracts = EXCLUDED.max_contracts,
  metadata = broker_accounts.metadata || EXCLUDED.metadata,
  updated_at = now();

INSERT INTO broker_contracts (
  broker_contract_id,
  instrument_code,
  broker_provider_code,
  broker_symbol,
  exchange,
  currency,
  expiry_date,
  multiplier,
  tick_size,
  point_value,
  active,
  metadata
) VALUES
  ('ninjatrader:MNQ:2026-09', 'MNQ', 'ninjatrader', 'MNQ 09-26', 'CME', 'USD', DATE '2026-09-18', 2, 0.25, 2, false, '{"continuous_symbol": "MNQ1!", "prepared_only": true}'::jsonb),
  ('ninjatrader:MES:2026-09', 'MES', 'ninjatrader', 'MES 09-26', 'CME', 'USD', DATE '2026-09-18', 5, 0.25, 5, false, '{"continuous_symbol": "MES1!", "prepared_only": true}'::jsonb),
  ('ninjatrader:NQ:2026-09', 'NQ', 'ninjatrader', 'NQ 09-26', 'CME', 'USD', DATE '2026-09-18', 20, 0.25, 20, false, '{"continuous_symbol": "NQ1!", "prepared_only": true}'::jsonb),
  ('ninjatrader:ES:2026-09', 'ES', 'ninjatrader', 'ES 09-26', 'CME', 'USD', DATE '2026-09-18', 50, 0.25, 50, false, '{"continuous_symbol": "ES1!", "prepared_only": true}'::jsonb)
ON CONFLICT (broker_provider_code, broker_symbol, expiry_date) DO UPDATE
SET
  instrument_code = EXCLUDED.instrument_code,
  exchange = EXCLUDED.exchange,
  currency = EXCLUDED.currency,
  multiplier = EXCLUDED.multiplier,
  tick_size = EXCLUDED.tick_size,
  point_value = EXCLUDED.point_value,
  active = EXCLUDED.active,
  metadata = broker_contracts.metadata || EXCLUDED.metadata,
  updated_at = now();
