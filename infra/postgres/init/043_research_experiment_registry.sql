DO $$
BEGIN
  CREATE TYPE research_experiment_status AS ENUM (
    'DRAFT',
    'ACTIVE',
    'COMPLETED',
    'CANCELLED',
    'ARCHIVED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE research_hypothesis_status AS ENUM (
    'PROPOSED',
    'TESTING',
    'SUPPORTED',
    'FALSIFIED',
    'INCONCLUSIVE',
    'RETIRED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE research_candidate_status AS ENUM (
    'IDEA',
    'BASELINE_REQUIRED',
    'IN_SIMULATION',
    'UNDER_REVIEW',
    'PROMOTION_READY',
    'REJECTED',
    'RETIRED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE research_candidate_source_type AS ENUM (
    'AI_GENERATED',
    'OPERATOR',
    'DERIVED',
    'BASELINE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE research_evaluation_report_kind AS ENUM (
    'TRAIN',
    'VALIDATION',
    'OUT_OF_SAMPLE',
    'WALK_FORWARD',
    'ROBUSTNESS',
    'CONTRADICTORY_REVIEW',
    'QUALITATIVE_REPLAY'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE research_evaluation_verdict AS ENUM (
    'PASS',
    'FAIL',
    'INCONCLUSIVE',
    'NEEDS_REVIEW'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS research_experiments (
  research_experiment_id uuid PRIMARY KEY,
  experiment_key text UNIQUE,
  name text NOT NULL,
  objective text NOT NULL,
  owner text NOT NULL,
  status research_experiment_status NOT NULL DEFAULT 'DRAFT',
  comparison_metric text NOT NULL,
  winner_simulation_run_id uuid REFERENCES simulation_runs(simulation_run_id) ON DELETE RESTRICT,
  candidate_selection_cutoff_utc timestamptz,
  budget jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  completed_at_utc timestamptz,
  CONSTRAINT research_experiments_key_format CHECK (
    experiment_key IS NULL
    OR experiment_key ~ '^[a-z0-9][a-z0-9_.:-]{1,190}[a-z0-9]$'
  ),
  CONSTRAINT research_experiments_name_not_blank CHECK (length(trim(name)) >= 3),
  CONSTRAINT research_experiments_objective_not_blank CHECK (length(trim(objective)) >= 8),
  CONSTRAINT research_experiments_owner_not_blank CHECK (length(trim(owner)) >= 2),
  CONSTRAINT research_experiments_metric_not_blank CHECK (length(trim(comparison_metric)) >= 2),
  CONSTRAINT research_experiments_completed_closed CHECK (
    status <> 'COMPLETED'
    OR completed_at_utc IS NOT NULL
  ),
  CONSTRAINT research_experiments_winner_requires_completed CHECK (
    winner_simulation_run_id IS NULL
    OR status = 'COMPLETED'
  )
);

CREATE INDEX IF NOT EXISTS research_experiments_status_created_idx
  ON research_experiments (status, created_at_utc DESC);

CREATE INDEX IF NOT EXISTS research_experiments_owner_status_idx
  ON research_experiments (owner, status, created_at_utc DESC);

CREATE TABLE IF NOT EXISTS research_hypotheses (
  research_hypothesis_id uuid PRIMARY KEY,
  research_experiment_id uuid NOT NULL REFERENCES research_experiments(research_experiment_id) ON DELETE CASCADE,
  statement text NOT NULL,
  falsifiable_question text NOT NULL,
  instrument_scope text[] NOT NULL DEFAULT '{}'::text[],
  timeframe_scope text[] NOT NULL DEFAULT '{}'::text[],
  population_scope text,
  variable_set jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_outcome text NOT NULL,
  invalidation_criteria text NOT NULL,
  status research_hypothesis_status NOT NULL DEFAULT 'PROPOSED',
  confidence_score numeric(6,4),
  source_agent_mission_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT research_hypotheses_statement_not_blank CHECK (length(trim(statement)) >= 8),
  CONSTRAINT research_hypotheses_question_not_blank CHECK (length(trim(falsifiable_question)) >= 8),
  CONSTRAINT research_hypotheses_expected_not_blank CHECK (length(trim(expected_outcome)) >= 4),
  CONSTRAINT research_hypotheses_invalidation_not_blank CHECK (length(trim(invalidation_criteria)) >= 4),
  CONSTRAINT research_hypotheses_confidence_range CHECK (
    confidence_score IS NULL
    OR confidence_score BETWEEN 0 AND 1
  )
);

CREATE INDEX IF NOT EXISTS research_hypotheses_experiment_status_idx
  ON research_hypotheses (research_experiment_id, status, created_at_utc DESC);

CREATE INDEX IF NOT EXISTS research_hypotheses_instrument_scope_idx
  ON research_hypotheses USING gin(instrument_scope);

CREATE TABLE IF NOT EXISTS research_candidates (
  research_candidate_id uuid PRIMARY KEY,
  research_experiment_id uuid NOT NULL REFERENCES research_experiments(research_experiment_id) ON DELETE CASCADE,
  research_hypothesis_id uuid NOT NULL REFERENCES research_hypotheses(research_hypothesis_id) ON DELETE CASCADE,
  candidate_key text UNIQUE,
  source_type research_candidate_source_type NOT NULL DEFAULT 'AI_GENERATED',
  status research_candidate_status NOT NULL DEFAULT 'IDEA',
  strategy_definition_id uuid REFERENCES strategy_definitions(strategy_definition_id) ON DELETE SET NULL,
  strategy_version_id uuid REFERENCES strategy_versions(strategy_version_id) ON DELETE SET NULL,
  primary_change_summary text NOT NULL,
  deterministic_plan_ref text,
  novelty_score numeric(6,4),
  evaluation_score numeric(6,4),
  last_evaluation_verdict research_evaluation_verdict,
  promotion_blocked boolean NOT NULL DEFAULT false,
  promotion_block_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT research_candidates_key_format CHECK (
    candidate_key IS NULL
    OR candidate_key ~ '^[a-z0-9][a-z0-9_.:-]{1,190}[a-z0-9]$'
  ),
  CONSTRAINT research_candidates_summary_not_blank CHECK (length(trim(primary_change_summary)) >= 8),
  CONSTRAINT research_candidates_novelty_range CHECK (
    novelty_score IS NULL
    OR novelty_score BETWEEN 0 AND 1
  ),
  CONSTRAINT research_candidates_evaluation_range CHECK (
    evaluation_score IS NULL
    OR evaluation_score BETWEEN 0 AND 1
  ),
  CONSTRAINT research_candidates_block_reason_required CHECK (
    promotion_blocked = false
    OR promotion_block_reason IS NOT NULL
  ),
  CONSTRAINT research_candidates_promotion_has_strategy_version CHECK (
    status <> 'PROMOTION_READY'
    OR strategy_version_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS research_candidates_experiment_status_idx
  ON research_candidates (research_experiment_id, status, created_at_utc DESC);

CREATE INDEX IF NOT EXISTS research_candidates_hypothesis_idx
  ON research_candidates (research_hypothesis_id, status, created_at_utc DESC);

CREATE TABLE IF NOT EXISTS research_experiment_run_links (
  research_experiment_run_link_id uuid PRIMARY KEY,
  research_experiment_id uuid NOT NULL REFERENCES research_experiments(research_experiment_id) ON DELETE CASCADE,
  simulation_run_id uuid NOT NULL REFERENCES simulation_runs(simulation_run_id) ON DELETE RESTRICT,
  research_candidate_id uuid REFERENCES research_candidates(research_candidate_id) ON DELETE SET NULL,
  role text NOT NULL,
  included_in_selection boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  linked_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE (research_experiment_id, simulation_run_id, role),
  CONSTRAINT research_experiment_run_links_role_not_blank CHECK (length(trim(role)) >= 2)
);

CREATE INDEX IF NOT EXISTS research_experiment_run_links_experiment_idx
  ON research_experiment_run_links (research_experiment_id, linked_at_utc DESC);

CREATE INDEX IF NOT EXISTS research_experiment_run_links_candidate_idx
  ON research_experiment_run_links (research_candidate_id, role)
  WHERE research_candidate_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS research_evaluation_reports (
  research_evaluation_report_id uuid PRIMARY KEY,
  research_experiment_id uuid NOT NULL REFERENCES research_experiments(research_experiment_id) ON DELETE CASCADE,
  research_candidate_id uuid NOT NULL REFERENCES research_candidates(research_candidate_id) ON DELETE CASCADE,
  simulation_run_id uuid NOT NULL REFERENCES simulation_runs(simulation_run_id) ON DELETE RESTRICT,
  report_kind research_evaluation_report_kind NOT NULL,
  verdict research_evaluation_verdict NOT NULL,
  score numeric(6,4) NOT NULL,
  metric_snapshot jsonb NOT NULL,
  criteria_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  artifact_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  reviewer_ref text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE (research_candidate_id, report_kind, simulation_run_id),
  CONSTRAINT research_evaluation_reports_score_range CHECK (score BETWEEN 0 AND 1),
  CONSTRAINT research_evaluation_reports_metrics_not_empty CHECK (metric_snapshot <> '{}'::jsonb),
  CONSTRAINT research_evaluation_reports_artifact_refs_array CHECK (jsonb_typeof(artifact_refs) = 'array')
);

CREATE INDEX IF NOT EXISTS research_evaluation_reports_candidate_kind_idx
  ON research_evaluation_reports (research_candidate_id, report_kind, created_at_utc DESC);

CREATE INDEX IF NOT EXISTS research_evaluation_reports_experiment_idx
  ON research_evaluation_reports (research_experiment_id, verdict, created_at_utc DESC);

CREATE TABLE IF NOT EXISTS research_audit_events (
  research_audit_event_id uuid PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  idempotency_key text,
  actor text NOT NULL,
  reason text,
  previous_status text,
  next_status text,
  previous_hash text,
  next_hash text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT research_audit_events_aggregate_type_not_blank CHECK (length(trim(aggregate_type)) > 0),
  CONSTRAINT research_audit_events_event_type_not_blank CHECK (length(trim(event_type)) > 0),
  CONSTRAINT research_audit_events_actor_not_blank CHECK (length(trim(actor)) > 0),
  CONSTRAINT research_audit_previous_hash_format CHECK (
    previous_hash IS NULL
    OR previous_hash ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT research_audit_next_hash_format CHECK (
    next_hash IS NULL
    OR next_hash ~ '^sha256:[a-f0-9]{64}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS research_audit_events_idempotency_idx
  ON research_audit_events (aggregate_type, aggregate_id, event_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS research_audit_events_aggregate_idx
  ON research_audit_events (aggregate_type, aggregate_id, created_at_utc DESC);

CREATE OR REPLACE FUNCTION prevent_terminal_research_candidate_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('REJECTED', 'RETIRED') THEN
    IF NEW.research_experiment_id IS DISTINCT FROM OLD.research_experiment_id
      OR NEW.research_hypothesis_id IS DISTINCT FROM OLD.research_hypothesis_id
      OR NEW.strategy_definition_id IS DISTINCT FROM OLD.strategy_definition_id
      OR NEW.strategy_version_id IS DISTINCT FROM OLD.strategy_version_id
      OR NEW.primary_change_summary IS DISTINCT FROM OLD.primary_change_summary
      OR NEW.deterministic_plan_ref IS DISTINCT FROM OLD.deterministic_plan_ref THEN
      RAISE EXCEPTION 'TERMINAL_RESEARCH_CANDIDATE_IMMUTABLE'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS research_candidates_terminal_immutable_trg ON research_candidates;
CREATE TRIGGER research_candidates_terminal_immutable_trg
  BEFORE UPDATE ON research_candidates
  FOR EACH ROW EXECUTE FUNCTION prevent_terminal_research_candidate_mutation();

CREATE OR REPLACE FUNCTION prevent_research_evaluation_report_mutation()
RETURNS trigger AS $$
BEGIN
  IF NEW.research_experiment_id IS DISTINCT FROM OLD.research_experiment_id
    OR NEW.research_candidate_id IS DISTINCT FROM OLD.research_candidate_id
    OR NEW.simulation_run_id IS DISTINCT FROM OLD.simulation_run_id
    OR NEW.report_kind IS DISTINCT FROM OLD.report_kind
    OR NEW.verdict IS DISTINCT FROM OLD.verdict
    OR NEW.score IS DISTINCT FROM OLD.score
    OR NEW.metric_snapshot IS DISTINCT FROM OLD.metric_snapshot
    OR NEW.criteria_snapshot IS DISTINCT FROM OLD.criteria_snapshot
    OR NEW.artifact_refs IS DISTINCT FROM OLD.artifact_refs THEN
    RAISE EXCEPTION 'RESEARCH_EVALUATION_REPORT_IMMUTABLE'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS research_evaluation_reports_immutable_trg ON research_evaluation_reports;
CREATE TRIGGER research_evaluation_reports_immutable_trg
  BEFORE UPDATE ON research_evaluation_reports
  FOR EACH ROW EXECUTE FUNCTION prevent_research_evaluation_report_mutation();
