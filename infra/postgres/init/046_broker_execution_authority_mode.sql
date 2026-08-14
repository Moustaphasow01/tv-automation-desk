BEGIN;

DO $$
BEGIN
  CREATE TYPE broker_execution_authority_mode AS ENUM ('semi_auto', 'auto');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE trade_policy_profiles
  ADD COLUMN IF NOT EXISTS execution_authority_mode broker_execution_authority_mode;

UPDATE trade_policy_profiles
SET execution_authority_mode = CASE
      WHEN require_operator_approval IS false THEN 'auto'::broker_execution_authority_mode
      ELSE 'semi_auto'::broker_execution_authority_mode
    END,
    updated_at = now()
WHERE execution_authority_mode IS NULL;

ALTER TABLE trade_policy_profiles
  ALTER COLUMN execution_authority_mode SET DEFAULT 'semi_auto'::broker_execution_authority_mode,
  ALTER COLUMN execution_authority_mode SET NOT NULL;

ALTER TABLE broker_policy_audit_events
  DROP CONSTRAINT IF EXISTS broker_policy_audit_events_action_check;

ALTER TABLE broker_policy_audit_events
  ADD CONSTRAINT broker_policy_audit_events_action_check
  CHECK (action IN ('configure_sizing', 'configure_execution_authority'));

COMMIT;
