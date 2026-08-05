DO $$
BEGIN
  CREATE TYPE broker_execution_authority_mode AS ENUM ('semi_auto', 'auto');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE trade_policy_profiles
  ADD COLUMN IF NOT EXISTS execution_authority_mode broker_execution_authority_mode NOT NULL DEFAULT 'semi_auto';

UPDATE trade_policy_profiles
SET execution_authority_mode = CASE
      WHEN require_operator_approval = false THEN 'auto'::broker_execution_authority_mode
      ELSE 'semi_auto'::broker_execution_authority_mode
    END
WHERE execution_authority_mode IS NULL;

ALTER TABLE trade_management_approvals
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE broker_policy_audit_events
  DROP CONSTRAINT IF EXISTS broker_policy_audit_events_action_check;

ALTER TABLE broker_policy_audit_events
  ADD CONSTRAINT broker_policy_audit_events_action_check
  CHECK (action IN ('configure_sizing', 'configure_execution_authority'));

COMMENT ON COLUMN trade_policy_profiles.execution_authority_mode IS
  'semi_auto: operator approval for entry, automatic risk-reducing management; auto: automatic entry and management after deterministic gates.';
