DO $$
BEGIN
  CREATE TYPE prompt_version_status AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'DEPRECATED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE prompt_deployment_stage AS ENUM ('SHADOW', 'CANARY', 'ACTIVE', 'ROLLED_BACK', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE prompt_evaluation_status AS ENUM ('PASS', 'FAIL', 'REVIEW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS prompt_definitions (
  prompt_definition_id uuid PRIMARY KEY,
  prompt_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  mission_key text NOT NULL,
  output_contract text NOT NULL,
  owner_role text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prompt_definitions_key_not_blank CHECK (length(trim(prompt_key)) > 0),
  CONSTRAINT prompt_definitions_mission_not_blank CHECK (length(trim(mission_key)) > 0),
  CONSTRAINT prompt_definitions_contract_not_blank CHECK (length(trim(output_contract)) > 0)
);

CREATE INDEX IF NOT EXISTS prompt_definitions_mission_idx
  ON prompt_definitions (mission_key, active);

CREATE TABLE IF NOT EXISTS prompt_versions (
  prompt_version_id uuid PRIMARY KEY,
  prompt_definition_id uuid NOT NULL REFERENCES prompt_definitions(prompt_definition_id) ON DELETE RESTRICT,
  semantic_version text NOT NULL,
  status prompt_version_status NOT NULL DEFAULT 'DRAFT',
  prompt_text text NOT NULL,
  variables_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_contracts jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_sha256 text NOT NULL,
  published_at_utc timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prompt_definition_id, semantic_version),
  CONSTRAINT prompt_versions_semver_not_blank CHECK (length(trim(semantic_version)) > 0),
  CONSTRAINT prompt_versions_text_not_blank CHECK (length(trim(prompt_text)) > 0),
  CONSTRAINT prompt_versions_hash_format CHECK (content_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT prompt_versions_published_has_time CHECK (status <> 'PUBLISHED' OR published_at_utc IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS prompt_versions_definition_status_idx
  ON prompt_versions (prompt_definition_id, status, semantic_version);

CREATE TABLE IF NOT EXISTS instruction_definitions (
  instruction_definition_id uuid PRIMARY KEY,
  instruction_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  responsibility text NOT NULL,
  owner_role text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instruction_definitions_key_not_blank CHECK (length(trim(instruction_key)) > 0),
  CONSTRAINT instruction_definitions_responsibility_not_blank CHECK (length(trim(responsibility)) > 0)
);

CREATE INDEX IF NOT EXISTS instruction_definitions_active_idx
  ON instruction_definitions (active, instruction_key);

CREATE TABLE IF NOT EXISTS instruction_versions (
  instruction_version_id uuid PRIMARY KEY,
  instruction_definition_id uuid NOT NULL REFERENCES instruction_definitions(instruction_definition_id) ON DELETE RESTRICT,
  semantic_version text NOT NULL,
  status prompt_version_status NOT NULL DEFAULT 'DRAFT',
  instruction_text text NOT NULL,
  content_sha256 text NOT NULL,
  published_at_utc timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instruction_definition_id, semantic_version),
  CONSTRAINT instruction_versions_semver_not_blank CHECK (length(trim(semantic_version)) > 0),
  CONSTRAINT instruction_versions_text_not_blank CHECK (length(trim(instruction_text)) > 0),
  CONSTRAINT instruction_versions_hash_format CHECK (content_sha256 ~ '^sha256:[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS instruction_versions_definition_status_idx
  ON instruction_versions (instruction_definition_id, status, semantic_version);

CREATE TABLE IF NOT EXISTS prompt_compositions (
  prompt_composition_id uuid PRIMARY KEY,
  composition_key text NOT NULL UNIQUE,
  status prompt_version_status NOT NULL DEFAULT 'DRAFT',
  prompt_version_id uuid NOT NULL REFERENCES prompt_versions(prompt_version_id) ON DELETE RESTRICT,
  rendered_sha256 text NOT NULL,
  environment text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at_utc timestamptz,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prompt_compositions_key_not_blank CHECK (length(trim(composition_key)) > 0),
  CONSTRAINT prompt_compositions_environment_not_blank CHECK (length(trim(environment)) > 0),
  CONSTRAINT prompt_compositions_rendered_hash_format CHECK (rendered_sha256 ~ '^sha256:[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS prompt_compositions_status_env_idx
  ON prompt_compositions (status, environment, updated_at_utc DESC);

CREATE TABLE IF NOT EXISTS prompt_composition_items (
  prompt_composition_item_id uuid PRIMARY KEY,
  prompt_composition_id uuid NOT NULL REFERENCES prompt_compositions(prompt_composition_id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  item_kind text NOT NULL CHECK (item_kind IN ('PROMPT', 'INSTRUCTION', 'STATIC_TEXT')),
  prompt_version_id uuid REFERENCES prompt_versions(prompt_version_id) ON DELETE RESTRICT,
  instruction_version_id uuid REFERENCES instruction_versions(instruction_version_id) ON DELETE RESTRICT,
  static_text text,
  content_sha256 text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prompt_composition_id, ordinal),
  CONSTRAINT prompt_composition_items_hash_format CHECK (content_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT prompt_composition_items_exact_source CHECK (
    (item_kind = 'PROMPT' AND prompt_version_id IS NOT NULL AND instruction_version_id IS NULL AND static_text IS NULL)
    OR (item_kind = 'INSTRUCTION' AND instruction_version_id IS NOT NULL AND prompt_version_id IS NULL AND static_text IS NULL)
    OR (item_kind = 'STATIC_TEXT' AND static_text IS NOT NULL AND prompt_version_id IS NULL AND instruction_version_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS prompt_composition_items_composition_idx
  ON prompt_composition_items (prompt_composition_id, ordinal);

CREATE TABLE IF NOT EXISTS agent_prompt_bindings (
  agent_prompt_binding_id uuid PRIMARY KEY,
  binding_key text NOT NULL UNIQUE,
  agent_role text NOT NULL,
  mission_key text NOT NULL,
  lane text NOT NULL,
  environment text NOT NULL,
  prompt_composition_id uuid NOT NULL REFERENCES prompt_compositions(prompt_composition_id) ON DELETE RESTRICT,
  last_known_good_composition_id uuid REFERENCES prompt_compositions(prompt_composition_id) ON DELETE RESTRICT,
  deployment_stage prompt_deployment_stage NOT NULL DEFAULT 'SHADOW',
  canary_weight_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (canary_weight_pct >= 0 AND canary_weight_pct <= 100),
  valid_from_utc timestamptz NOT NULL DEFAULT now(),
  valid_until_utc timestamptz,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_prompt_bindings_key_not_blank CHECK (length(trim(binding_key)) > 0),
  CONSTRAINT agent_prompt_bindings_role_not_blank CHECK (length(trim(agent_role)) > 0),
  CONSTRAINT agent_prompt_bindings_mission_not_blank CHECK (length(trim(mission_key)) > 0),
  CONSTRAINT agent_prompt_bindings_valid_range CHECK (valid_until_utc IS NULL OR valid_until_utc > valid_from_utc)
);

CREATE INDEX IF NOT EXISTS agent_prompt_bindings_lookup_idx
  ON agent_prompt_bindings (agent_role, mission_key, lane, environment, active);

CREATE TABLE IF NOT EXISTS prompt_deployments (
  prompt_deployment_id uuid PRIMARY KEY,
  agent_prompt_binding_id uuid NOT NULL REFERENCES agent_prompt_bindings(agent_prompt_binding_id) ON DELETE RESTRICT,
  prompt_composition_id uuid NOT NULL REFERENCES prompt_compositions(prompt_composition_id) ON DELETE RESTRICT,
  last_known_good_composition_id uuid REFERENCES prompt_compositions(prompt_composition_id) ON DELETE RESTRICT,
  deployment_stage prompt_deployment_stage NOT NULL,
  rollback_of_deployment_id uuid REFERENCES prompt_deployments(prompt_deployment_id) ON DELETE SET NULL,
  deployed_by text NOT NULL,
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prompt_deployments_actor_not_blank CHECK (length(trim(deployed_by)) > 0),
  CONSTRAINT prompt_deployments_reason_not_blank CHECK (length(trim(reason)) > 0)
);

CREATE INDEX IF NOT EXISTS prompt_deployments_binding_stage_idx
  ON prompt_deployments (agent_prompt_binding_id, deployment_stage, created_at_utc DESC);

CREATE TABLE IF NOT EXISTS prompt_evaluations (
  prompt_evaluation_id uuid PRIMARY KEY,
  prompt_composition_id uuid NOT NULL REFERENCES prompt_compositions(prompt_composition_id) ON DELETE RESTRICT,
  dataset_id uuid REFERENCES datasets(dataset_id) ON DELETE SET NULL,
  evaluation_status prompt_evaluation_status NOT NULL,
  quality_score numeric(8,4),
  security_status prompt_evaluation_status NOT NULL,
  regression_status prompt_evaluation_status NOT NULL,
  input_token_count integer CHECK (input_token_count IS NULL OR input_token_count >= 0),
  output_token_count integer CHECK (output_token_count IS NULL OR output_token_count >= 0),
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  cost_usd numeric(12,6) CHECK (cost_usd IS NULL OR cost_usd >= 0),
  report_hash text NOT NULL,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prompt_evaluations_report_hash_format CHECK (report_hash ~ '^sha256:[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS prompt_evaluations_composition_status_idx
  ON prompt_evaluations (prompt_composition_id, evaluation_status, created_at_utc DESC);

CREATE TABLE IF NOT EXISTS prompt_render_snapshots (
  prompt_render_snapshot_id uuid PRIMARY KEY,
  prompt_composition_id uuid NOT NULL REFERENCES prompt_compositions(prompt_composition_id) ON DELETE RESTRICT,
  agent_prompt_binding_id uuid REFERENCES agent_prompt_bindings(agent_prompt_binding_id) ON DELETE SET NULL,
  rendered_sha256 text NOT NULL,
  variables_sha256 text NOT NULL,
  rendered_prompt text NOT NULL,
  variables_redacted jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prompt_render_snapshots_render_hash_format CHECK (rendered_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT prompt_render_snapshots_variables_hash_format CHECK (variables_sha256 ~ '^sha256:[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS prompt_render_snapshots_composition_idx
  ON prompt_render_snapshots (prompt_composition_id, created_at_utc DESC);

CREATE TABLE IF NOT EXISTS prompt_audit_events (
  prompt_audit_event_id uuid PRIMARY KEY,
  event_type text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  actor text NOT NULL,
  reason text,
  previous_hash text,
  next_hash text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prompt_audit_events_type_not_blank CHECK (length(trim(event_type)) > 0),
  CONSTRAINT prompt_audit_events_target_type_not_blank CHECK (length(trim(target_type)) > 0),
  CONSTRAINT prompt_audit_events_actor_not_blank CHECK (length(trim(actor)) > 0),
  CONSTRAINT prompt_audit_events_previous_hash_format CHECK (previous_hash IS NULL OR previous_hash ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT prompt_audit_events_next_hash_format CHECK (next_hash IS NULL OR next_hash ~ '^sha256:[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS prompt_audit_events_target_idx
  ON prompt_audit_events (target_type, target_id, created_at_utc DESC);

CREATE OR REPLACE FUNCTION prevent_published_prompt_registry_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('APPROVED', 'PUBLISHED', 'DEPRECATED', 'REVOKED') THEN
    IF TG_TABLE_NAME = 'prompt_versions'
      AND (NEW.prompt_text IS DISTINCT FROM OLD.prompt_text
        OR NEW.variables_schema IS DISTINCT FROM OLD.variables_schema
        OR NEW.output_contracts IS DISTINCT FROM OLD.output_contracts
        OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256) THEN
      RAISE EXCEPTION 'PUBLISHED_PROMPT_VERSION_IMMUTABLE';
    END IF;
    IF TG_TABLE_NAME = 'instruction_versions'
      AND (NEW.instruction_text IS DISTINCT FROM OLD.instruction_text
        OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256) THEN
      RAISE EXCEPTION 'PUBLISHED_INSTRUCTION_VERSION_IMMUTABLE';
    END IF;
    IF TG_TABLE_NAME = 'prompt_compositions'
      AND (NEW.prompt_version_id IS DISTINCT FROM OLD.prompt_version_id
        OR NEW.rendered_sha256 IS DISTINCT FROM OLD.rendered_sha256) THEN
      RAISE EXCEPTION 'PUBLISHED_PROMPT_COMPOSITION_IMMUTABLE';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prompt_versions_immutable_when_published ON prompt_versions;
CREATE TRIGGER prompt_versions_immutable_when_published
BEFORE UPDATE ON prompt_versions
FOR EACH ROW EXECUTE FUNCTION prevent_published_prompt_registry_mutation();

DROP TRIGGER IF EXISTS instruction_versions_immutable_when_published ON instruction_versions;
CREATE TRIGGER instruction_versions_immutable_when_published
BEFORE UPDATE ON instruction_versions
FOR EACH ROW EXECUTE FUNCTION prevent_published_prompt_registry_mutation();

DROP TRIGGER IF EXISTS prompt_compositions_immutable_when_published ON prompt_compositions;
CREATE TRIGGER prompt_compositions_immutable_when_published
BEFORE UPDATE ON prompt_compositions
FOR EACH ROW EXECUTE FUNCTION prevent_published_prompt_registry_mutation();
