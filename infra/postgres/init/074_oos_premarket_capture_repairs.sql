BEGIN;

CREATE TABLE IF NOT EXISTS oos_premarket_capture_repairs (
  batch_id text NOT NULL,
  day text NOT NULL,
  from_revision bigint NOT NULL CHECK (from_revision >= 0),
  from_manifest_sha256 text NOT NULL CHECK (from_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  to_manifest_sha256 text NOT NULL CHECK (to_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  capture_path text NOT NULL CHECK (capture_path ~ '^(5m|15m|1h|4h)_(global|zoom)\.png$'),
  journal_sha256 text NOT NULL CHECK (journal_sha256 ~ '^[a-f0-9]{64}$'),
  reason text NOT NULL CHECK (reason = 'CLOSED_ONLY_CAPTURE_REPAIR'),
  approved_by text NOT NULL CHECK (approved_by = 'OPERATOR_CAPTURE_REPAIR'),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (batch_id, day, from_revision),
  FOREIGN KEY (batch_id, day) REFERENCES oos_batch_days (batch_id, day),
  CHECK (from_manifest_sha256 <> to_manifest_sha256)
);
CREATE INDEX IF NOT EXISTS oos_capture_repair_manifest_idx
  ON oos_premarket_capture_repairs (batch_id, day, to_manifest_sha256);

CREATE OR REPLACE FUNCTION protect_oos_capture_repair_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'OOS_CAPTURE_REPAIR_RECEIPT_IMMUTABLE';
END;
$$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'oos_premarket_capture_repairs'::regclass AND tgname = 'oos_capture_repair_receipt_immutable') THEN
    CREATE TRIGGER oos_capture_repair_receipt_immutable BEFORE UPDATE OR DELETE ON oos_premarket_capture_repairs
      FOR EACH ROW EXECUTE FUNCTION protect_oos_capture_repair_receipt();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION protect_oos_frozen_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE repair_allowed boolean;
BEGIN
  IF OLD.definition IS DISTINCT FROM NEW.definition
    OR (OLD.plan_sha256 IS NOT NULL AND OLD.plan_sha256 IS DISTINCT FROM NEW.plan_sha256) THEN
    RAISE EXCEPTION 'OOS_IMMUTABLE_IDENTITY';
  END IF;
  IF OLD.manifest_sha256 IS NOT NULL AND OLD.manifest_sha256 IS DISTINCT FROM NEW.manifest_sha256 THEN
    repair_allowed := OLD.plan_sha256 IS NULL AND NEW.plan_sha256 IS NULL
      AND OLD.state = 'PREMARKET_READY' AND OLD.checkpoint = 'PREMARKET_READY' AND OLD.capture_count = 8
      AND NEW.revision = OLD.revision + 1
      AND COALESCE(current_setting('desk_oos.capture_repair', true), '') = 'OPERATOR_CAPTURE_REPAIR'
      AND (to_jsonb(NEW) - ARRAY['manifest_sha256', 'revision', 'updated_at'])
        = (to_jsonb(OLD) - ARRAY['manifest_sha256', 'revision', 'updated_at'])
      AND EXISTS (SELECT 1 FROM oos_premarket_capture_repairs r WHERE r.batch_id = OLD.batch_id AND r.day = OLD.day
        AND r.from_revision = OLD.revision AND r.from_manifest_sha256 = OLD.manifest_sha256
        AND r.to_manifest_sha256 = NEW.manifest_sha256 AND r.reason = 'CLOSED_ONLY_CAPTURE_REPAIR'
        AND r.approved_by = 'OPERATOR_CAPTURE_REPAIR');
    IF NOT COALESCE(repair_allowed, false) THEN RAISE EXCEPTION 'OOS_IMMUTABLE_IDENTITY'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
