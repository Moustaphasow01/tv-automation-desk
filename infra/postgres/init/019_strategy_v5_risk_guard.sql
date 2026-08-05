BEGIN;

-- Strategy V5: configurable risk remains operator-selectable, but never above
-- 0.25% of net equity. Normalize legacy policies before tightening the check.
UPDATE trade_policy_profiles
SET risk_per_trade_pct = 0.25,
    updated_at = now()
WHERE risk_per_trade_pct > 0.25;

ALTER TABLE trade_policy_profiles
  ALTER COLUMN risk_per_trade_pct SET DEFAULT 0.25;

ALTER TABLE trade_policy_profiles
  DROP CONSTRAINT IF EXISTS trade_policy_profiles_risk_per_trade_pct_check;

ALTER TABLE trade_policy_profiles
  ADD CONSTRAINT trade_policy_profiles_risk_per_trade_pct_check
  CHECK (risk_per_trade_pct BETWEEN 0.01 AND 0.25);

-- Strategy V5 requires a reward/risk ratio of at least 2 for every policy.
UPDATE trade_policy_profiles
SET min_reward_risk = 2,
    updated_at = now()
WHERE min_reward_risk < 2;

ALTER TABLE trade_policy_profiles
  ALTER COLUMN min_reward_risk SET DEFAULT 2;

ALTER TABLE trade_policy_profiles
  DROP CONSTRAINT IF EXISTS trade_policy_profiles_min_reward_risk_check;

ALTER TABLE trade_policy_profiles
  ADD CONSTRAINT trade_policy_profiles_min_reward_risk_check
  CHECK (min_reward_risk >= 2);

COMMIT;
