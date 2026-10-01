-- Additive technical preparation registry. Existing day identities/archives remain unchanged.
BEGIN;
CREATE TABLE IF NOT EXISTS oos_premarket_batches (
  batch_id text PRIMARY KEY,
  archive_batch_id text NOT NULL,
  batch_type text NOT NULL CHECK (batch_type = 'PREMARKET'),
  selector_kind text NOT NULL CHECK (selector_kind IN ('DAY','RANGE')),
  start_date text NOT NULL CHECK (start_date ~ '^2026-(07|08)-[0-9]{2}$'),
  end_date text NOT NULL CHECK (end_date ~ '^2026-(07|08)-[0-9]{2}$' AND end_date >= start_date),
  status text NOT NULL CHECK (status IN ('RUNNING','COMPLETED','PARTIAL','FAILED')),
  command_id text NOT NULL REFERENCES oos_batch_commands(command_id),
  concurrency integer NOT NULL CHECK (concurrency BETWEEN 1 AND 3),
  requested_concurrency integer NOT NULL CHECK (requested_concurrency BETWEEN 1 AND 3),
  last_error jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS oos_premarket_batch_days (
  batch_id text NOT NULL REFERENCES oos_premarket_batches(batch_id),
  archive_batch_id text NOT NULL,
  day text NOT NULL,
  PRIMARY KEY (batch_id,day),
  FOREIGN KEY (archive_batch_id,day) REFERENCES oos_batch_days(batch_id,day)
);
CREATE INDEX IF NOT EXISTS oos_premarket_batches_period
  ON oos_premarket_batches(archive_batch_id,start_date,end_date);
CREATE INDEX IF NOT EXISTS oos_premarket_batch_days_archive
  ON oos_premarket_batch_days(archive_batch_id,day);
COMMIT;
