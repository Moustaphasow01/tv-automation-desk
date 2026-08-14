ALTER TABLE portfolio_candidate_allocations
  ADD COLUMN IF NOT EXISTS account_id text;

UPDATE portfolio_candidate_allocations allocation
SET account_id = COALESCE(
  NULLIF(allocation.payload->>'account_id', ''),
  run.account_id,
  'default'
)
FROM portfolio_arbitration_runs run
WHERE allocation.portfolio_arbitration_run_id = run.portfolio_arbitration_run_id
  AND (allocation.account_id IS NULL OR length(trim(allocation.account_id)) = 0);

UPDATE portfolio_candidate_allocations
SET account_id = 'default'
WHERE account_id IS NULL OR length(trim(account_id)) = 0;

ALTER TABLE portfolio_candidate_allocations
  ALTER COLUMN account_id SET DEFAULT 'default',
  ALTER COLUMN account_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS portfolio_candidate_allocations_account_instrument_time_idx
  ON portfolio_candidate_allocations(account_id, instrument, as_of_utc DESC);
