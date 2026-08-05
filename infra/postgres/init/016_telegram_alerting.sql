DO $$
BEGIN
  CREATE TYPE telegram_profile AS ENUM ('admin', 'trading');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE telegram_delivery_status AS ENUM (
    'pending',
    'sending',
    'sent',
    'failed',
    'suppressed',
    'uncertain'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS telegram_runtime_config (
  config_id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  admin_enabled boolean NOT NULL DEFAULT true,
  trading_enabled boolean NOT NULL DEFAULT true,
  commands_enabled boolean NOT NULL DEFAULT true,
  muted_until_utc timestamptz,
  baseline_completed_at_utc timestamptz,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_by text NOT NULL DEFAULT 'schema_seed',
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now()
);

INSERT INTO telegram_runtime_config (
  config_id,
  enabled,
  admin_enabled,
  trading_enabled,
  commands_enabled
) VALUES (
  'desk_telegram',
  false,
  true,
  true,
  true
)
ON CONFLICT (config_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS telegram_source_state (
  source_key text PRIMARY KEY,
  profile telegram_profile NOT NULL,
  source_kind text NOT NULL,
  fingerprint text NOT NULL,
  source_state text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at_utc timestamptz NOT NULL DEFAULT now(),
  last_seen_at_utc timestamptz NOT NULL DEFAULT now(),
  last_queued_at_utc timestamptz,
  last_sent_at_utc timestamptz
);

CREATE INDEX IF NOT EXISTS telegram_source_state_profile_seen_idx
  ON telegram_source_state (profile, last_seen_at_utc DESC);

CREATE TABLE IF NOT EXISTS telegram_delivery_outbox (
  delivery_id text PRIMARY KEY,
  profile telegram_profile NOT NULL,
  source_key text NOT NULL,
  source_kind text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  priority integer NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  silent boolean NOT NULL DEFAULT false,
  status telegram_delivery_status NOT NULL DEFAULT 'pending',
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at_utc timestamptz NOT NULL DEFAULT now(),
  lease_token text,
  lease_expires_at_utc timestamptz,
  telegram_message_id bigint,
  sent_at_utc timestamptz,
  last_error text,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_delivery_outbox_poll_idx
  ON telegram_delivery_outbox (status, available_at_utc, priority DESC, created_at_utc)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS telegram_delivery_outbox_recent_idx
  ON telegram_delivery_outbox (created_at_utc DESC);

CREATE TABLE IF NOT EXISTS telegram_delivery_attempts (
  attempt_id text PRIMARY KEY,
  delivery_id text NOT NULL REFERENCES telegram_delivery_outbox(delivery_id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  status telegram_delivery_status NOT NULL,
  telegram_message_id bigint,
  error_code text,
  error_message text,
  started_at_utc timestamptz NOT NULL DEFAULT now(),
  completed_at_utc timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (delivery_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS telegram_delivery_attempts_recent_idx
  ON telegram_delivery_attempts (started_at_utc DESC);

CREATE TABLE IF NOT EXISTS telegram_runtime_state (
  state_key text PRIMARY KEY,
  state_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at_utc timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_command_requests (
  command_id text PRIMARY KEY,
  telegram_update_id bigint NOT NULL UNIQUE,
  chat_id text NOT NULL,
  command text NOT NULL,
  arguments text,
  authorized boolean NOT NULL DEFAULT false,
  outcome text NOT NULL,
  requested_at_utc timestamptz NOT NULL DEFAULT now(),
  completed_at_utc timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS telegram_command_requests_recent_idx
  ON telegram_command_requests (requested_at_utc DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'desk_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE
        telegram_runtime_config,
        telegram_source_state,
        telegram_delivery_outbox,
        telegram_delivery_attempts,
        telegram_runtime_state,
        telegram_command_requests
      TO desk_runtime;

    GRANT USAGE
      ON TYPE telegram_profile, telegram_delivery_status
      TO desk_runtime;
  END IF;
END $$;
