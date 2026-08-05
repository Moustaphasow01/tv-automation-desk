BEGIN;

-- Integer futures contracts require upward rounding. Keep the requested V5 risk
-- capped at 0.25% while making the permitted rounding excess explicit, bounded
-- and operator-configurable.
ALTER TABLE trade_policy_profiles
  ADD COLUMN IF NOT EXISTS max_rounding_excess_pct numeric NOT NULL DEFAULT 0.25;

ALTER TABLE trade_policy_profiles
  DROP CONSTRAINT IF EXISTS trade_policy_profiles_max_rounding_excess_pct_check;

ALTER TABLE trade_policy_profiles
  ADD CONSTRAINT trade_policy_profiles_max_rounding_excess_pct_check
  CHECK (max_rounding_excess_pct BETWEEN 0 AND 0.25);

COMMIT;


