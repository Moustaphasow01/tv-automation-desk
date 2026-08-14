DO $$
BEGIN
  CREATE TYPE strategy_version_status AS ENUM (
    'draft',
    'in_simulation',
    'validated',
    'published',
    'deprecated'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE strategy_instance_runtime_state AS ENUM (
    'created',
    'starting',
    'running',
    'paused',
    'stopping',
    'stopped',
    'failed_to_start',
    'errored'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE strategy_instance_execution_mode AS ENUM (
    'shadow',
    'paper',
    'live'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS strategy_definitions (
  strategy_definition_id uuid PRIMARY KEY,
  external_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  owner text NOT NULL,
  asset_class text,
  default_instruments text[] NOT NULL DEFAULT '{}'::text[],
  tags text[] NOT NULL DEFAULT '{}'::text[],
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(trim(external_key)) >= 3),
  CHECK (length(trim(name)) >= 3),
  CHECK (length(trim(owner)) >= 3)
);

CREATE INDEX IF NOT EXISTS strategy_definitions_owner_idx
  ON strategy_definitions(owner, created_at DESC);

CREATE INDEX IF NOT EXISTS strategy_definitions_default_instruments_idx
  ON strategy_definitions USING gin(default_instruments);

CREATE TABLE IF NOT EXISTS strategy_versions (
  strategy_version_id uuid PRIMARY KEY,
  strategy_definition_id uuid NOT NULL REFERENCES strategy_definitions(strategy_definition_id) ON DELETE RESTRICT,
  version_label text NOT NULL,
  status strategy_version_status NOT NULL DEFAULT 'draft',
  dsl_language text NOT NULL DEFAULT 'desk_strategy_dsl',
  dsl_source_hash text NOT NULL,
  dsl_source_ref text,
  compiled_artifact_ref text NOT NULL,
  compiled_artifact_hash text,
  validated_metrics_ref text,
  runtime_contract_bundle_version text NOT NULL,
  published_at timestamptz,
  deprecated_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(strategy_definition_id, version_label),
  CHECK (length(trim(version_label)) >= 1),
  CHECK (dsl_source_hash ~ '^sha256:[a-f0-9]{64}$'),
  CHECK (compiled_artifact_hash IS NULL OR compiled_artifact_hash ~ '^sha256:[a-f0-9]{64}$'),
  CHECK (status NOT IN ('published', 'deprecated') OR published_at IS NOT NULL),
  CHECK (status <> 'deprecated' OR deprecated_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS strategy_versions_definition_status_idx
  ON strategy_versions(strategy_definition_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS strategy_versions_runtime_bundle_idx
  ON strategy_versions(runtime_contract_bundle_version, status);

CREATE TABLE IF NOT EXISTS strategy_instances (
  strategy_instance_id uuid PRIMARY KEY,
  strategy_version_id uuid NOT NULL REFERENCES strategy_versions(strategy_version_id) ON DELETE RESTRICT,
  runtime_state strategy_instance_runtime_state NOT NULL DEFAULT 'created',
  execution_mode strategy_instance_execution_mode NOT NULL DEFAULT 'shadow',
  account_scope text REFERENCES broker_accounts(broker_account_id),
  instrument_scope text[] NOT NULL DEFAULT '{}'::text[],
  session_scope text[] NOT NULL DEFAULT '{}'::text[],
  risk_budget_ref text,
  triple_lock_validated boolean NOT NULL DEFAULT false,
  last_heartbeat_at timestamptz,
  started_at timestamptz,
  stopped_at timestamptz,
  failed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (execution_mode = 'shadow' OR account_scope IS NOT NULL),
  CHECK (runtime_state NOT IN ('running', 'paused') OR last_heartbeat_at IS NOT NULL),
  CHECK (runtime_state <> 'stopped' OR stopped_at IS NOT NULL),
  CHECK (runtime_state NOT IN ('failed_to_start', 'errored') OR failed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS strategy_instances_version_state_idx
  ON strategy_instances(strategy_version_id, runtime_state, execution_mode);

CREATE INDEX IF NOT EXISTS strategy_instances_account_mode_idx
  ON strategy_instances(account_scope, execution_mode, runtime_state)
  WHERE account_scope IS NOT NULL;

CREATE INDEX IF NOT EXISTS strategy_instances_instrument_scope_idx
  ON strategy_instances USING gin(instrument_scope);

CREATE UNIQUE INDEX IF NOT EXISTS strategy_instances_single_unlocked_live_account_idx
  ON strategy_instances(account_scope)
  WHERE execution_mode = 'live'
    AND runtime_state IN ('created', 'starting', 'running', 'paused')
    AND triple_lock_validated = false
    AND account_scope IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_published_strategy_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('published', 'deprecated') THEN
    IF NEW.strategy_definition_id IS DISTINCT FROM OLD.strategy_definition_id
      OR NEW.version_label IS DISTINCT FROM OLD.version_label
      OR NEW.dsl_language IS DISTINCT FROM OLD.dsl_language
      OR NEW.dsl_source_hash IS DISTINCT FROM OLD.dsl_source_hash
      OR NEW.dsl_source_ref IS DISTINCT FROM OLD.dsl_source_ref
      OR NEW.compiled_artifact_ref IS DISTINCT FROM OLD.compiled_artifact_ref
      OR NEW.compiled_artifact_hash IS DISTINCT FROM OLD.compiled_artifact_hash
      OR NEW.validated_metrics_ref IS DISTINCT FROM OLD.validated_metrics_ref
      OR NEW.runtime_contract_bundle_version IS DISTINCT FROM OLD.runtime_contract_bundle_version
      OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN
      RAISE EXCEPTION 'PUBLISHED_STRATEGY_VERSION_IMMUTABLE'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'strategy_versions_prevent_published_mutation'
  ) THEN
    CREATE TRIGGER strategy_versions_prevent_published_mutation
    BEFORE UPDATE ON strategy_versions
    FOR EACH ROW
    EXECUTE FUNCTION prevent_published_strategy_version_mutation();
  END IF;
END $$;
