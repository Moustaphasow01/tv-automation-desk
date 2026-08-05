BEGIN;

-- A historical paper catch-up may still be evaluated and audited, but only a
-- fresh deterministic trigger may cross the BROKER_SUBMIT boundary.
ALTER TABLE trade_policy_profiles
  ADD COLUMN IF NOT EXISTS max_decision_age_seconds integer NOT NULL DEFAULT 120;

ALTER TABLE trade_policy_profiles
  DROP CONSTRAINT IF EXISTS trade_policy_profiles_max_decision_age_seconds_check;

ALTER TABLE trade_policy_profiles
  ADD CONSTRAINT trade_policy_profiles_max_decision_age_seconds_check
  CHECK (max_decision_age_seconds BETWEEN 5 AND 3600);

UPDATE trade_policy_profiles
SET max_decision_age_seconds = 120
WHERE max_decision_age_seconds IS NULL;

COMMENT ON COLUMN trade_policy_profiles.max_decision_age_seconds IS
  'Maximum age of a deterministic entry decision at BROKER_SUBMIT. Catch-up remains paper/auditable when stale.';

COMMIT;
