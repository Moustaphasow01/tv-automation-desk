-- Owner: research. Technical memory only; no dependency on simulation or legacy policies.
-- JSONB contains integration snapshots; identities, lifecycle and versions stay relational.
-- Operations runbook: provision separate dedicated research reader/writer roles externally.
-- Reader: schema USAGE and table SELECT. Writer: schema USAGE, table SELECT/INSERT,
-- UPDATE(status,checkpoint,revision,updated_at) on t3_cycles only. Neither needs
-- schema CREATE, identity/definition UPDATE, or evidence UPDATE/DELETE.
-- Do not grant to existing OOS roles. Validate privileges using SET ROLE on a test schema.
-- executeExclusive needs a dedicated session plus another available pool connection for
-- short writes; size the pool above the number of simultaneous exclusive operations,
-- with at least two connections and a finite connectionTimeoutMillis.
-- Commit MODEL_REQUESTED before invoking the model; persisted requests without a confirmed
-- result must block automatic retries in the application to avoid paying twice.
-- Rollback deployment by disconnecting the adapter; retain this additive schema and evidence.
BEGIN;
CREATE SCHEMA IF NOT EXISTS research_state;

CREATE TABLE IF NOT EXISTS research_state.t3_cycles (
  cycle_id text PRIMARY KEY CHECK (length(btrim(cycle_id)) > 0),
  input_hash text NOT NULL CHECK (length(btrim(input_hash)) > 0),
  corpus_hash text NOT NULL CHECK (length(btrim(corpus_hash)) > 0),
  definition_hash text NOT NULL CHECK (definition_hash ~ '^[a-f0-9]{64}$'),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  schema_version text NOT NULL DEFAULT '1' CHECK (length(btrim(schema_version)) > 0),
  model_version text,
  prompt_version text,
  corpus_version text,
  status text NOT NULL DEFAULT 'OBSERVING' CHECK (status IN (
    'OBSERVING','DIAGNOSING','CLUSTERING','HYPOTHESIZING','COUNTEREXAMPLES',
    'CRITIQUING','EXPERIMENT_READY','COMPLETED','FAILED_TECHNICAL','BLOCKED_DATA')),
  checkpoint jsonb CHECK (checkpoint IS NULL OR jsonb_typeof(checkpoint) = 'object'),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS t3_cycles_status_updated_idx
  ON research_state.t3_cycles (status,updated_at,cycle_id);

CREATE TABLE IF NOT EXISTS research_state.t3_scenario_audits (
  cycle_id text NOT NULL REFERENCES research_state.t3_cycles(cycle_id),
  id text COLLATE "C" NOT NULL CHECK (length(btrim(id)) > 0),
  kind text NOT NULL DEFAULT 'scenario_audit' CHECK (kind = 'scenario_audit'),
  status text NOT NULL DEFAULT 'RECORDED' CHECK (length(btrim(status)) > 0),
  artifact_version text NOT NULL DEFAULT '1' CHECK (length(btrim(artifact_version)) > 0),
  schema_version text NOT NULL DEFAULT '1' CHECK (length(btrim(schema_version)) > 0),
  model_version text,
  prompt_version text,
  payload_hash text NOT NULL CHECK (length(btrim(payload_hash)) > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (cycle_id,id)
);
CREATE INDEX IF NOT EXISTS t3_scenario_audits_cycle_page_idx
  ON research_state.t3_scenario_audits (cycle_id,id);
CREATE INDEX IF NOT EXISTS t3_scenario_audits_identity_idx
  ON research_state.t3_scenario_audits (id,created_at,cycle_id COLLATE "C");

CREATE TABLE IF NOT EXISTS research_state.t3_plan_audits (
  cycle_id text NOT NULL REFERENCES research_state.t3_cycles(cycle_id),
  id text COLLATE "C" NOT NULL CHECK (length(btrim(id)) > 0),
  kind text NOT NULL DEFAULT 'plan_audit' CHECK (kind = 'plan_audit'),
  status text NOT NULL DEFAULT 'RECORDED' CHECK (length(btrim(status)) > 0),
  artifact_version text NOT NULL DEFAULT '1' CHECK (length(btrim(artifact_version)) > 0),
  schema_version text NOT NULL DEFAULT '1' CHECK (length(btrim(schema_version)) > 0),
  model_version text,
  prompt_version text,
  payload_hash text NOT NULL CHECK (length(btrim(payload_hash)) > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (cycle_id,id)
);
CREATE INDEX IF NOT EXISTS t3_plan_audits_cycle_page_idx
  ON research_state.t3_plan_audits (cycle_id,id);
CREATE INDEX IF NOT EXISTS t3_plan_audits_identity_idx
  ON research_state.t3_plan_audits (id,created_at,cycle_id COLLATE "C");

CREATE TABLE IF NOT EXISTS research_state.t3_hypotheses (
  cycle_id text NOT NULL REFERENCES research_state.t3_cycles(cycle_id),
  id text COLLATE "C" NOT NULL CHECK (length(btrim(id)) > 0),
  kind text NOT NULL DEFAULT 'hypothesis' CHECK (kind = 'hypothesis'),
  status text NOT NULL DEFAULT 'NEW' CHECK (status = 'NEW'),
  artifact_version text NOT NULL DEFAULT '1' CHECK (length(btrim(artifact_version)) > 0),
  schema_version text NOT NULL DEFAULT '1' CHECK (length(btrim(schema_version)) > 0),
  model_version text,
  prompt_version text,
  payload_hash text NOT NULL CHECK (length(btrim(payload_hash)) > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS t3_hypotheses_cycle_page_idx
  ON research_state.t3_hypotheses (cycle_id,id);

CREATE TABLE IF NOT EXISTS research_state.t3_findings (
  cycle_id text NOT NULL REFERENCES research_state.t3_cycles(cycle_id),
  id text COLLATE "C" NOT NULL CHECK (length(btrim(id)) > 0),
  kind text NOT NULL DEFAULT 'finding' CHECK (kind = 'finding'),
  status text NOT NULL DEFAULT 'RECORDED' CHECK (length(btrim(status)) > 0),
  artifact_version text NOT NULL DEFAULT '1' CHECK (length(btrim(artifact_version)) > 0),
  schema_version text NOT NULL DEFAULT '1' CHECK (length(btrim(schema_version)) > 0),
  model_version text,
  prompt_version text,
  payload_hash text NOT NULL CHECK (length(btrim(payload_hash)) > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (cycle_id,id)
);
CREATE INDEX IF NOT EXISTS t3_findings_cycle_page_idx
  ON research_state.t3_findings (cycle_id,id);
CREATE INDEX IF NOT EXISTS t3_findings_identity_idx
  ON research_state.t3_findings (id,created_at,cycle_id COLLATE "C");

CREATE TABLE IF NOT EXISTS research_state.t3_scenario_families (
  cycle_id text NOT NULL REFERENCES research_state.t3_cycles(cycle_id),
  id text COLLATE "C" NOT NULL CHECK (length(btrim(id)) > 0),
  kind text NOT NULL DEFAULT 'family' CHECK (kind = 'family'),
  status text NOT NULL DEFAULT 'RECORDED' CHECK (length(btrim(status)) > 0),
  artifact_version text NOT NULL DEFAULT '1' CHECK (length(btrim(artifact_version)) > 0),
  schema_version text NOT NULL DEFAULT '1' CHECK (length(btrim(schema_version)) > 0),
  model_version text,
  prompt_version text,
  payload_hash text NOT NULL CHECK (length(btrim(payload_hash)) > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (cycle_id,id)
);
CREATE INDEX IF NOT EXISTS t3_scenario_families_cycle_page_idx
  ON research_state.t3_scenario_families (cycle_id,id);
CREATE INDEX IF NOT EXISTS t3_scenario_families_identity_idx
  ON research_state.t3_scenario_families (id,created_at,cycle_id COLLATE "C");

CREATE TABLE IF NOT EXISTS research_state.t3_failure_patterns (
  cycle_id text NOT NULL REFERENCES research_state.t3_cycles(cycle_id),
  id text COLLATE "C" NOT NULL CHECK (length(btrim(id)) > 0),
  kind text NOT NULL DEFAULT 'failure_pattern' CHECK (kind = 'failure_pattern'),
  status text NOT NULL DEFAULT 'RECORDED' CHECK (length(btrim(status)) > 0),
  artifact_version text NOT NULL DEFAULT '1' CHECK (length(btrim(artifact_version)) > 0),
  schema_version text NOT NULL DEFAULT '1' CHECK (length(btrim(schema_version)) > 0),
  model_version text,
  prompt_version text,
  payload_hash text NOT NULL CHECK (length(btrim(payload_hash)) > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (cycle_id,id)
);
CREATE INDEX IF NOT EXISTS t3_failure_patterns_cycle_page_idx
  ON research_state.t3_failure_patterns (cycle_id,id);
CREATE INDEX IF NOT EXISTS t3_failure_patterns_identity_idx
  ON research_state.t3_failure_patterns (id,created_at,cycle_id COLLATE "C");

CREATE TABLE IF NOT EXISTS research_state.t3_winner_patterns (
  cycle_id text NOT NULL REFERENCES research_state.t3_cycles(cycle_id),
  id text COLLATE "C" NOT NULL CHECK (length(btrim(id)) > 0),
  kind text NOT NULL DEFAULT 'winner_pattern' CHECK (kind = 'winner_pattern'),
  status text NOT NULL DEFAULT 'RECORDED' CHECK (length(btrim(status)) > 0),
  artifact_version text NOT NULL DEFAULT '1' CHECK (length(btrim(artifact_version)) > 0),
  schema_version text NOT NULL DEFAULT '1' CHECK (length(btrim(schema_version)) > 0),
  model_version text,
  prompt_version text,
  payload_hash text NOT NULL CHECK (length(btrim(payload_hash)) > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (cycle_id,id)
);
CREATE INDEX IF NOT EXISTS t3_winner_patterns_cycle_page_idx
  ON research_state.t3_winner_patterns (cycle_id,id);
CREATE INDEX IF NOT EXISTS t3_winner_patterns_identity_idx
  ON research_state.t3_winner_patterns (id,created_at,cycle_id COLLATE "C");

CREATE TABLE IF NOT EXISTS research_state.t3_experiments (
  cycle_id text NOT NULL REFERENCES research_state.t3_cycles(cycle_id),
  id text COLLATE "C" NOT NULL CHECK (length(btrim(id)) > 0),
  kind text NOT NULL DEFAULT 'experiment' CHECK (kind = 'experiment'),
  status text NOT NULL DEFAULT 'RECORDED' CHECK (length(btrim(status)) > 0),
  artifact_version text NOT NULL DEFAULT '1' CHECK (length(btrim(artifact_version)) > 0),
  schema_version text NOT NULL DEFAULT '1' CHECK (length(btrim(schema_version)) > 0),
  model_version text,
  prompt_version text,
  payload_hash text NOT NULL CHECK (length(btrim(payload_hash)) > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS t3_experiments_cycle_page_idx
  ON research_state.t3_experiments (cycle_id,id);

CREATE TABLE IF NOT EXISTS research_state.t3_critiques (
  cycle_id text NOT NULL REFERENCES research_state.t3_cycles(cycle_id),
  id text COLLATE "C" NOT NULL CHECK (length(btrim(id)) > 0),
  kind text NOT NULL DEFAULT 'critique' CHECK (kind = 'critique'),
  status text NOT NULL DEFAULT 'RECORDED' CHECK (length(btrim(status)) > 0),
  artifact_version text NOT NULL DEFAULT '1' CHECK (length(btrim(artifact_version)) > 0),
  schema_version text NOT NULL DEFAULT '1' CHECK (length(btrim(schema_version)) > 0),
  model_version text,
  prompt_version text,
  payload_hash text NOT NULL CHECK (length(btrim(payload_hash)) > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (cycle_id,id)
);
CREATE INDEX IF NOT EXISTS t3_critiques_cycle_page_idx
  ON research_state.t3_critiques (cycle_id,id);
CREATE INDEX IF NOT EXISTS t3_critiques_identity_idx
  ON research_state.t3_critiques (id,created_at,cycle_id COLLATE "C");

CREATE TABLE IF NOT EXISTS research_state.t3_events (
  event_id text PRIMARY KEY CHECK (length(btrim(event_id)) > 0),
  cycle_id text NOT NULL REFERENCES research_state.t3_cycles(cycle_id),
  namespace text NOT NULL DEFAULT 'T3_RESEARCH' CHECK (namespace = 'T3_RESEARCH'),
  type text NOT NULL CHECK (length(btrim(type)) > 0),
  schema_version text NOT NULL DEFAULT '1' CHECK (length(btrim(schema_version)) > 0),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  correlation_id text NOT NULL,
  causation_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS t3_events_cycle_time_idx
  ON research_state.t3_events (cycle_id,created_at,event_id);

-- Protect immutable evidence even against accidental direct SQL writes.
CREATE OR REPLACE FUNCTION research_state.reject_t3_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'T3_RESEARCH_IMMUTABLE_EVIDENCE' USING ERRCODE = '55000';
END;
$$;

DO $$
DECLARE
  evidence_table text;
BEGIN
  FOREACH evidence_table IN ARRAY ARRAY[
    't3_scenario_audits','t3_plan_audits','t3_hypotheses','t3_findings',
    't3_scenario_families','t3_failure_patterns','t3_winner_patterns',
    't3_experiments','t3_critiques','t3_events'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = format('research_state.%I', evidence_table)::regclass
        AND tgname = 't3_evidence_immutable' AND NOT tgisinternal
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER t3_evidence_immutable BEFORE UPDATE OR DELETE ON research_state.%I '
        'FOR EACH ROW EXECUTE FUNCTION research_state.reject_t3_evidence_mutation()',
        evidence_table
      );
    END IF;
  END LOOP;
END;
$$;
COMMIT;
