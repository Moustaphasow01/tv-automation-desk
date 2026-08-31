BEGIN;

ALTER TABLE strategy_runtime_evaluations
  DROP CONSTRAINT IF EXISTS strategy_runtime_evaluations_status_check;

ALTER TABLE strategy_runtime_evaluations
  ADD CONSTRAINT strategy_runtime_evaluations_status_check
  CHECK (status IN ('WAITING_SESSION', 'NO_SIGNAL', 'SIGNAL_CREATED', 'FAILED'));

COMMIT;
