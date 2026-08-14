DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'strategy_signal_outbox_status') THEN
    CREATE TYPE strategy_signal_outbox_status AS ENUM ('pending', 'published', 'consumed', 'failed', 'cancelled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS strategy_signal_outbox (
  signal_outbox_id uuid PRIMARY KEY,
  signal_id uuid NOT NULL,
  strategy_instance_id uuid NOT NULL REFERENCES strategy_instances(strategy_instance_id) ON DELETE CASCADE,
  strategy_version_id uuid,
  signal_type text NOT NULL DEFAULT 'signal.emitted',
  instrument text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('LONG', 'SHORT', 'FLAT')),
  confidence numeric,
  execution_mode_origin strategy_instance_execution_mode NOT NULL,
  generated_at_utc timestamptz NOT NULL,
  expires_at_utc timestamptz NOT NULL,
  correlation_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  status strategy_signal_outbox_status NOT NULL DEFAULT 'pending',
  notify_attempt_count integer NOT NULL DEFAULT 0,
  published_at_utc timestamptz,
  consumed_at_utc timestamptz,
  consumer_id text,
  last_error text,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at_utc > generated_at_utc)
);

CREATE INDEX IF NOT EXISTS strategy_signal_outbox_poll_idx
  ON strategy_signal_outbox(status, generated_at_utc, created_at_utc)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS strategy_signal_outbox_instance_idx
  ON strategy_signal_outbox(strategy_instance_id, generated_at_utc DESC);

CREATE OR REPLACE FUNCTION notify_strategy_signal_outbox_ready()
RETURNS trigger AS $$
DECLARE
  payload jsonb;
BEGIN
  IF NEW.status = 'pending' THEN
    payload := jsonb_build_object(
      'signal_outbox_id', NEW.signal_outbox_id,
      'signal_id', NEW.signal_id,
      'strategy_instance_id', NEW.strategy_instance_id,
      'generated_at_utc', NEW.generated_at_utc,
      'dedupe_key', NEW.dedupe_key
    );
    PERFORM pg_notify('desk_strategy_signal_ready', payload::text);
    UPDATE strategy_signal_outbox
      SET notify_attempt_count = notify_attempt_count + 1,
          updated_at_utc = now()
      WHERE signal_outbox_id = NEW.signal_outbox_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS strategy_signal_outbox_notify_ready_trg ON strategy_signal_outbox;
CREATE TRIGGER strategy_signal_outbox_notify_ready_trg
  AFTER INSERT ON strategy_signal_outbox
  FOR EACH ROW EXECUTE FUNCTION notify_strategy_signal_outbox_ready();
