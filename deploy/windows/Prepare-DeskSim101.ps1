param(
    [string]$DataRoot = "C:\ProgramData\DeskFutures",
    [string]$PostgresBin = "C:\Program Files\PostgreSQL\16\bin",
    [int]$MaxContracts = 10,
    [decimal]$MaxDailyLoss = 1000
)

$ErrorActionPreference = "Stop"

$envFile = Join-Path $DataRoot "config\desk.env"
if (-not (Test-Path -LiteralPath $envFile)) {
    throw "Desk environment not found: $envFile"
}

function Read-DeskEnvValue {
    param([Parameter(Mandatory = $true)][string]$Name)

    $line = Get-Content -LiteralPath $envFile |
        Where-Object { $_ -like "$Name=*" } |
        Select-Object -First 1
    if (-not $line) {
        throw "Missing environment value: $Name"
    }
    return $line.Substring($line.IndexOf("=") + 1)
}

$databaseUrl = Read-DeskEnvValue -Name "DATABASE_URL"
$psql = Join-Path $PostgresBin "psql.exe"
if (-not (Test-Path -LiteralPath $psql)) {
    throw "psql.exe not found: $psql"
}

$sql = @"
BEGIN;
DO `$`$
DECLARE latest broker_addon_snapshots%ROWTYPE;
BEGIN
  SELECT * INTO latest
  FROM broker_addon_snapshots
  WHERE broker_account_id = 'ninjatrader_paper_local'
  ORDER BY captured_at DESC
  LIMIT 1;
  IF latest.addon_snapshot_id IS NULL
     OR latest.account_name !~* '^Sim[0-9]*`$'
     OR latest.connection->>'status' <> 'Connected'
     OR jsonb_array_length(latest.orders) <> 0
     OR jsonb_array_length(latest.positions) <> 0
     OR latest.captured_at < now() - interval '2 minutes' THEN
    RAISE EXCEPTION 'Fresh empty connected Sim snapshot required before preparation';
  END IF;
END `$`$;

WITH reconciled AS (
  UPDATE broker_orders
  SET status = 'cancelled',
      last_broker_update_at = now(),
      updated_at = now(),
      raw = raw || jsonb_build_object(
        'reconciled_absent_from_broker', true,
        'reconciliation_source', 'fresh_ninja_addon_snapshot',
        'reconciled_at', now()
      )
  WHERE broker_order_id = 'broker_order_0b25b7a58e0f4859a12e4e98a8ebadb5'
    AND status = 'accepted'
  RETURNING broker_order_id
)
INSERT INTO broker_order_events (
  broker_order_event_id, broker_order_id, event_type, status, occurred_at,
  payload, raw, external_event_key
)
SELECT
  'broker_event_reconcile_20260726_stale_stop',
  broker_order_id,
  'sync_reconciled',
  'cancelled',
  now(),
  jsonb_build_object(
    'reason', 'closed_trade_and_fresh_broker_snapshot_has_no_orders'
  ),
  jsonb_build_object(
    'source', 'vps_cutover_reconciliation',
    'operator', 'codex'
  ),
  'vps_cutover_reconcile_stale_stop_20260726'
FROM reconciled
ON CONFLICT (external_event_key)
WHERE external_event_key IS NOT NULL
DO NOTHING;

UPDATE broker_providers
SET enabled = true,
    metadata = metadata || jsonb_build_object(
      'runtime', 'ninjatrader_addon',
      'sim101_only', true
    ),
    updated_at = now()
WHERE broker_provider_code = 'ninjatrader';

UPDATE broker_accounts
SET account_label = 'NinjaTrader Sim101',
    read_only = false,
    order_submission_enabled = true,
    max_contracts = $MaxContracts,
    metadata = metadata || jsonb_build_object(
      'account_name_allowlist', jsonb_build_array('Sim101'),
      'sim_only', true,
      'armed_for_week_observation', true
    ),
    updated_at = now()
WHERE broker_account_id = 'ninjatrader_paper_local'
  AND mode = 'paper';

UPDATE broker_contracts
SET active = (instrument_code IN ('MNQ','MES')),
    metadata = metadata || jsonb_build_object(
      'sim101_enabled', instrument_code IN ('MNQ','MES')
    ),
    updated_at = now()
WHERE broker_provider_code = 'ninjatrader'
  AND expiry_date >= current_date;

UPDATE trade_policy_profiles
SET display_name = 'NinjaTrader Sim101 - AUTO',
    enabled = true,
    max_contracts = $MaxContracts,
    max_daily_loss = $MaxDailyLoss,
    risk_per_trade_pct = 0.25,
    max_decision_age_seconds = 120,
    min_reward_risk = 2,
    fallback_capital_enabled = false,
    fallback_capital = NULL,
    execution_authority_mode = 'auto',
    require_operator_approval = false,
    metadata = metadata || jsonb_build_object(
      'live_forbidden', true,
      'account_name_allowlist', jsonb_build_array('Sim101'),
      'contract_rounding_mode', 'ceil',
      'daily_loss_limit_basis', '1pct_of_100k_initial_sim_capital'
    ),
    updated_at = now()
WHERE policy_profile_id = 'ninjatrader_sim101_local';
COMMIT;

SELECT json_build_object(
  'provider_enabled', (
    SELECT enabled FROM broker_providers
    WHERE broker_provider_code = 'ninjatrader'
  ),
  'account_writable', (
    SELECT NOT read_only AND order_submission_enabled
    FROM broker_accounts
    WHERE broker_account_id = 'ninjatrader_paper_local'
  ),
  'active_contracts', (
    SELECT json_agg(instrument_code ORDER BY instrument_code)
    FROM broker_contracts
    WHERE broker_provider_code = 'ninjatrader' AND active
  ),
  'mode', (
    SELECT execution_authority_mode
    FROM trade_policy_profiles
    WHERE policy_profile_id = 'ninjatrader_sim101_local'
  ),
  'max_decision_age_seconds', (
    SELECT max_decision_age_seconds
    FROM trade_policy_profiles
    WHERE policy_profile_id = 'ninjatrader_sim101_local'
  ),
  'risk_pct', (
    SELECT risk_per_trade_pct
    FROM trade_policy_profiles
    WHERE policy_profile_id = 'ninjatrader_sim101_local'
  ),
  'min_reward_risk', (
    SELECT min_reward_risk
    FROM trade_policy_profiles
    WHERE policy_profile_id = 'ninjatrader_sim101_local'
  ),
  'max_contracts', (
    SELECT max_contracts
    FROM trade_policy_profiles
    WHERE policy_profile_id = 'ninjatrader_sim101_local'
  ),
  'max_daily_loss', (
    SELECT max_daily_loss
    FROM trade_policy_profiles
    WHERE policy_profile_id = 'ninjatrader_sim101_local'
  ),
  'global_lock', (
    SELECT locked FROM broker_execution_locks
    WHERE execution_lock_id = 'global_default_kill_switch'
  ),
  'nonterminal_orders', (
    SELECT count(*) FROM broker_orders
    WHERE broker_account_id = 'ninjatrader_paper_local'
      AND status NOT IN ('filled','cancelled','rejected','expired')
  )
)::text;
"@

& $psql "--dbname=$databaseUrl" "--set=ON_ERROR_STOP=1" "--no-align" "--tuples-only" "--command=$sql"
if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL preparation failed with exit code $LASTEXITCODE"
}
