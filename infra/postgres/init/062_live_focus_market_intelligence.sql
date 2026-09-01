CREATE TABLE IF NOT EXISTS market_source_coverage_manifests (
  source_id text PRIMARY KEY,
  source_type text NOT NULL,
  source_status text NOT NULL CHECK (source_status IN ('AVAILABLE','STALE','UNAVAILABLE','UNKNOWN_COVERAGE','OPTIONAL_UNAVAILABLE')),
  required_for text[] NOT NULL DEFAULT ARRAY[]::text[],
  coverage_start_utc timestamptz,
  coverage_end_utc timestamptz,
  as_of_utc timestamptz NOT NULL,
  data_cutoff_utc timestamptz,
  last_successful_import_at_utc timestamptz,
  provider text,
  dataset_version text,
  missingness double precision CHECK (missingness IS NULL OR (missingness >= 0 AND missingness <= 1)),
  reason_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  CHECK (coverage_end_utc IS NULL OR coverage_start_utc IS NULL OR coverage_end_utc >= coverage_start_utc)
);

CREATE TABLE IF NOT EXISTS market_agri_events (
  market_agri_event_id text PRIMARY KEY,
  external_key text NOT NULL UNIQUE,
  universe_key text NOT NULL DEFAULT 'US_GRAINS_CBOT',
  event_kind text NOT NULL,
  title text NOT NULL,
  event_timestamp_utc timestamptz NOT NULL,
  importance text NOT NULL CHECK (importance IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  event_status text NOT NULL DEFAULT 'SCHEDULED' CHECK (event_status IN ('SCHEDULED','RELEASED','CANCELLED','REVISED')),
  actual_available_at_utc timestamptz,
  source_published_at_utc timestamptz NOT NULL,
  ingested_at_utc timestamptz NOT NULL DEFAULT now(),
  provider text NOT NULL,
  dataset_version text NOT NULL,
  source_url text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK (source_published_at_utc <= ingested_at_utc),
  CHECK (jsonb_typeof(payload) = 'object'),
  CHECK (jsonb_typeof(provenance) = 'array')
);

CREATE INDEX IF NOT EXISTS market_agri_events_universe_time_idx
  ON market_agri_events(universe_key, event_timestamp_utc);

CREATE TABLE IF NOT EXISTS market_context_snapshots (
  market_context_snapshot_id text PRIMARY KEY,
  schema_version text NOT NULL DEFAULT 'market_context_snapshot_v1',
  universe text NOT NULL,
  status text NOT NULL CHECK (status IN ('AVAILABLE','STALE','PARTIAL','UNAVAILABLE','INVALIDATED','DISABLED_BY_POLICY')),
  created_at_utc timestamptz NOT NULL,
  valid_from_utc timestamptz NOT NULL,
  valid_until_utc timestamptz NOT NULL,
  source_data_cutoff_utc timestamptz NOT NULL,
  market_state text NOT NULL,
  market_session text NOT NULL,
  supersedes_snapshot_id text REFERENCES market_context_snapshots(market_context_snapshot_id) ON DELETE SET NULL,
  invalidation_reason text,
  worker_id text,
  agent_task_id uuid REFERENCES agent_tasks(agent_task_id) ON DELETE SET NULL,
  model_policy_version text,
  prompt_version text,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  correlation_id text NOT NULL,
  causation_id text,
  inserted_at_utc timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until_utc > valid_from_utc),
  CHECK (source_data_cutoff_utc <= created_at_utc),
  CHECK (jsonb_typeof(payload) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS market_context_snapshots_one_current_idx
  ON market_context_snapshots(universe)
  WHERE status = 'AVAILABLE';

CREATE INDEX IF NOT EXISTS market_context_snapshots_universe_time_idx
  ON market_context_snapshots(universe, created_at_utc DESC);

CREATE TABLE IF NOT EXISTS market_desk_briefs (
  market_desk_brief_id text PRIMARY KEY,
  market_context_snapshot_id text NOT NULL REFERENCES market_context_snapshots(market_context_snapshot_id) ON DELETE RESTRICT,
  schema_version text NOT NULL DEFAULT 'market_desk_brief_v1',
  universe text NOT NULL,
  status text NOT NULL CHECK (status IN ('AVAILABLE','STALE','PARTIAL','UNAVAILABLE','INVALIDATED','DISABLED_BY_POLICY')),
  created_at_utc timestamptz NOT NULL,
  valid_from_utc timestamptz NOT NULL,
  valid_until_utc timestamptz NOT NULL,
  source_data_cutoff_utc timestamptz NOT NULL,
  supersedes_brief_id text REFERENCES market_desk_briefs(market_desk_brief_id) ON DELETE SET NULL,
  invalidation_reason text,
  worker_id text,
  agent_task_id uuid REFERENCES agent_tasks(agent_task_id) ON DELETE SET NULL,
  model_policy_version text,
  prompt_version text,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[a-f0-9]{64}$'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  correlation_id text NOT NULL,
  causation_id text,
  inserted_at_utc timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until_utc > valid_from_utc),
  CHECK (source_data_cutoff_utc <= created_at_utc),
  CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS market_desk_briefs_universe_time_idx
  ON market_desk_briefs(universe, created_at_utc DESC);

CREATE TABLE IF NOT EXISTS market_context_prefilter_decisions (
  market_context_prefilter_decision_id text PRIMARY KEY,
  market_context_snapshot_id text REFERENCES market_context_snapshots(market_context_snapshot_id) ON DELETE SET NULL,
  signal_id text NOT NULL,
  universe text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('ADMISSIBLE','WAIT','REJECT')),
  reason_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  source_data_cutoff_utc timestamptz NOT NULL,
  decided_at_utc timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text NOT NULL,
  causation_id text,
  UNIQUE (signal_id, market_context_snapshot_id)
);

CREATE TABLE IF NOT EXISTS market_context_adjustment_proposals (
  context_adjustment_proposal_id text PRIMARY KEY,
  market_context_snapshot_id text NOT NULL REFERENCES market_context_snapshots(market_context_snapshot_id) ON DELETE RESTRICT,
  signal_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('PROPOSED','VALIDATED','REJECTED','EXPIRED')),
  validation_reason_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  source_data_cutoff_utc timestamptz NOT NULL,
  created_at_utc timestamptz NOT NULL,
  validated_at_utc timestamptz,
  proposal jsonb NOT NULL,
  validator_result jsonb,
  correlation_id text NOT NULL,
  causation_id text,
  CHECK (jsonb_typeof(proposal) = 'object')
);

CREATE TABLE IF NOT EXISTS market_context_task_dispatches (
  dispatch_id text PRIMARY KEY,
  universe text NOT NULL,
  source_data_cutoff_utc timestamptz NOT NULL,
  reason_hash text NOT NULL,
  trigger_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('PLANNED','ENQUEUED','CLAIMED','COMPLETED','FAILED','SKIPPED')),
  agent_task_id uuid REFERENCES agent_tasks(agent_task_id) ON DELETE SET NULL,
  not_before_utc timestamptz,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (universe, source_data_cutoff_utc, reason_hash)
);

INSERT INTO agents (
  agent_id, agent_key, agent_type, status, worker_group, capabilities, model_policy, metadata
) VALUES (
  'f13b52e4-1955-4c8a-b8c7-216dd65e2c40',
  'us-grains-market-context-analyst',
  'MARKET_CONTEXT_ANALYST',
  'IDLE',
  'live-context',
  '["READ_MARKET_CONTEXT","WRITE_MARKET_CONTEXT_SNAPSHOT","WRITE_MARKET_DESK_BRIEF"]'::jsonb,
  '{"provider":"codex","reasoning_effort":"high","authority":"ADVISORY_ONLY"}'::jsonb,
  '{"universe":"US_GRAINS_CBOT","concurrency":1}'::jsonb
) ON CONFLICT (agent_key) DO UPDATE SET
  capabilities = EXCLUDED.capabilities,
  model_policy = EXCLUDED.model_policy,
  metadata = agents.metadata || EXCLUDED.metadata,
  updated_at_utc = now();

INSERT INTO agent_missions (
  agent_mission_id, mission_key, agent_id, mission_type, lane, objective,
  context_ref, correlation_id, status, priority, model_policy, metadata
) VALUES (
  'f23b52e4-1955-4c8a-b8c7-216dd65e2c40',
  'us-grains-market-context-live',
  'f13b52e4-1955-4c8a-b8c7-216dd65e2c40',
  'MARKET_CONTEXT_ANALYSIS',
  'live',
  'Understand and frame US grains market context without execution authority.',
  'US_GRAINS_CBOT',
  'corr-us-grains-market-context-live',
  'ASSIGNED',
  30,
  '{"provider":"codex","reasoning_effort":"high","timeout_ms":780000,"authority":"ADVISORY_ONLY"}'::jsonb,
  '{"task_type_pattern":"LIVE_US_GRAINS_MARKET_CONTEXT_*","concurrency":1}'::jsonb
) ON CONFLICT (mission_key) DO UPDATE SET
  agent_id = EXCLUDED.agent_id,
  model_policy = EXCLUDED.model_policy,
  metadata = agent_missions.metadata || EXCLUDED.metadata,
  updated_at_utc = now();

INSERT INTO market_agri_events (
  market_agri_event_id, external_key, event_kind, title, event_timestamp_utc,
  importance, source_published_at_utc, provider, dataset_version, source_url, provenance
) VALUES
  ('agri-2026-03-10-wasde', 'USDA:WASDE:2026-03-10', 'WASDE', 'World Agricultural Supply and Demand Estimates', '2026-03-10T16:00:00Z', 'CRITICAL', '2026-03-01T00:00:00Z', 'USDA_WAOB', 'usda_high_impact_calendar_2026_v1', 'https://www.usda.gov/about-usda/general-information/staff-offices/office-chief-economist/commodity-markets/wasde-report', '[{"kind":"OFFICIAL_CALENDAR"}]'),
  ('agri-2026-03-31-stocks', 'USDA:NASS:GRAIN_STOCKS:2026-03-31', 'GRAIN_STOCKS', 'Prospective Plantings and Grain Stocks', '2026-03-31T16:00:00Z', 'CRITICAL', '2026-03-01T00:00:00Z', 'USDA_NASS', 'usda_high_impact_calendar_2026_v1', 'https://www.nass.usda.gov/Publications/Calendar/2026/2026ReleaseCalendar_12Months_11x17_Color.pdf', '[{"kind":"OFFICIAL_CALENDAR"}]'),
  ('agri-2026-04-09-wasde', 'USDA:WASDE:2026-04-09', 'WASDE', 'WASDE and Crop Production', '2026-04-09T16:00:00Z', 'CRITICAL', '2026-03-01T00:00:00Z', 'USDA_WAOB', 'usda_high_impact_calendar_2026_v1', 'https://www.usda.gov/about-usda/general-information/staff-offices/office-chief-economist/commodity-markets/wasde-report', '[{"kind":"OFFICIAL_CALENDAR"}]'),
  ('agri-2026-05-12-wasde', 'USDA:WASDE:2026-05-12', 'WASDE', 'WASDE and Crop Production', '2026-05-12T16:00:00Z', 'CRITICAL', '2026-03-01T00:00:00Z', 'USDA_WAOB', 'usda_high_impact_calendar_2026_v1', 'https://www.usda.gov/about-usda/general-information/staff-offices/office-chief-economist/commodity-markets/wasde-report', '[{"kind":"OFFICIAL_CALENDAR"}]'),
  ('agri-2026-06-11-wasde', 'USDA:WASDE:2026-06-11', 'WASDE', 'WASDE and Crop Production', '2026-06-11T16:00:00Z', 'CRITICAL', '2026-03-01T00:00:00Z', 'USDA_WAOB', 'usda_high_impact_calendar_2026_v1', 'https://www.usda.gov/about-usda/general-information/staff-offices/office-chief-economist/commodity-markets/wasde-report', '[{"kind":"OFFICIAL_CALENDAR"}]'),
  ('agri-2026-06-30-acreage', 'USDA:NASS:ACREAGE_STOCKS:2026-06-30', 'ACREAGE_GRAIN_STOCKS', 'Acreage and Grain Stocks', '2026-06-30T16:00:00Z', 'CRITICAL', '2026-03-01T00:00:00Z', 'USDA_NASS', 'usda_high_impact_calendar_2026_v1', 'https://www.nass.usda.gov/Publications/Calendar/2026/2026ReleaseCalendar_12Months_11x17_Color.pdf', '[{"kind":"OFFICIAL_CALENDAR"}]'),
  ('agri-2026-07-10-wasde', 'USDA:WASDE:2026-07-10', 'WASDE', 'WASDE and Crop Production', '2026-07-10T16:00:00Z', 'CRITICAL', '2026-03-01T00:00:00Z', 'USDA_WAOB', 'usda_high_impact_calendar_2026_v1', 'https://www.usda.gov/about-usda/general-information/staff-offices/office-chief-economist/commodity-markets/wasde-report', '[{"kind":"OFFICIAL_CALENDAR"}]'),
  ('agri-2026-08-12-wasde', 'USDA:WASDE:2026-08-12', 'WASDE', 'WASDE and Crop Production', '2026-08-12T16:00:00Z', 'CRITICAL', '2026-03-01T00:00:00Z', 'USDA_WAOB', 'usda_high_impact_calendar_2026_v1', 'https://www.usda.gov/about-usda/general-information/staff-offices/office-chief-economist/commodity-markets/wasde-report', '[{"kind":"OFFICIAL_CALENDAR"}]'),
  ('agri-2026-09-01-crushings', 'USDA:NASS:GRAIN_CRUSHINGS:2026-09-01', 'GRAIN_CRUSHINGS', 'Grain Crushings and Annual Summary', '2026-09-01T19:00:00Z', 'HIGH', '2026-03-01T00:00:00Z', 'USDA_NASS', 'usda_high_impact_calendar_2026_v1', 'https://www.nass.usda.gov/Publications/Calendar/reports_by_date.php?month=09&view=l&year=2026', '[{"kind":"OFFICIAL_CALENDAR"}]'),
  ('agri-2026-09-11-wasde', 'USDA:WASDE:2026-09-11', 'WASDE', 'WASDE and Crop Production', '2026-09-11T16:00:00Z', 'CRITICAL', '2026-03-01T00:00:00Z', 'USDA_WAOB', 'usda_high_impact_calendar_2026_v1', 'https://www.usda.gov/about-usda/general-information/staff-offices/office-chief-economist/commodity-markets/wasde-report', '[{"kind":"OFFICIAL_CALENDAR"}]'),
  ('agri-2026-09-30-stocks', 'USDA:NASS:GRAIN_STOCKS:2026-09-30', 'GRAIN_STOCKS', 'Small Grains Summary and Grain Stocks', '2026-09-30T16:00:00Z', 'CRITICAL', '2026-03-01T00:00:00Z', 'USDA_NASS', 'usda_high_impact_calendar_2026_v1', 'https://www.nass.usda.gov/Publications/Calendar/reports_by_date.php?month=09&view=l&year=2026', '[{"kind":"OFFICIAL_CALENDAR"}]'),
  ('agri-2026-10-09-wasde', 'USDA:WASDE:2026-10-09', 'WASDE', 'WASDE and Crop Production', '2026-10-09T16:00:00Z', 'CRITICAL', '2026-03-01T00:00:00Z', 'USDA_WAOB', 'usda_high_impact_calendar_2026_v1', 'https://www.usda.gov/about-usda/general-information/staff-offices/office-chief-economist/commodity-markets/wasde-report', '[{"kind":"OFFICIAL_CALENDAR"}]'),
  ('agri-2026-11-10-wasde', 'USDA:WASDE:2026-11-10', 'WASDE', 'WASDE and Crop Production', '2026-11-10T17:00:00Z', 'CRITICAL', '2026-03-01T00:00:00Z', 'USDA_WAOB', 'usda_high_impact_calendar_2026_v1', 'https://www.usda.gov/about-usda/general-information/staff-offices/office-chief-economist/commodity-markets/wasde-report', '[{"kind":"OFFICIAL_CALENDAR"}]'),
  ('agri-2026-12-10-wasde', 'USDA:WASDE:2026-12-10', 'WASDE', 'WASDE and Crop Production', '2026-12-10T17:00:00Z', 'CRITICAL', '2026-03-01T00:00:00Z', 'USDA_WAOB', 'usda_high_impact_calendar_2026_v1', 'https://www.usda.gov/about-usda/general-information/staff-offices/office-chief-economist/commodity-markets/wasde-report', '[{"kind":"OFFICIAL_CALENDAR"}]')
ON CONFLICT (external_key) DO NOTHING;

INSERT INTO market_source_coverage_manifests (
  source_id, source_type, source_status, required_for, coverage_start_utc, coverage_end_utc,
  as_of_utc, data_cutoff_utc, last_successful_import_at_utc, provider, dataset_version, missingness,
  reason_codes, metadata
) VALUES (
  'market_agri_events', 'AGRI_EVENT_CALENDAR', 'AVAILABLE',
  ARRAY['MARKET_CONTEXT_SNAPSHOT','CONTEXT_PREFILTER'],
  '2026-03-01T00:00:00Z', '2026-12-31T23:59:59Z', now(), now(), now(),
  'USDA_NASS_USDA_WAOB', 'usda_high_impact_calendar_2026_v1', 0,
  ARRAY['OFFICIAL_USDA_HIGH_IMPACT_CALENDAR_LOADED'],
  '{"scope":"scheduled_high_impact_grains_events","anti_lookahead":"source_published_at_utc <= cutoff"}'::jsonb
) ON CONFLICT (source_id) DO UPDATE SET
  source_type=EXCLUDED.source_type,
  source_status=EXCLUDED.source_status,
  required_for=EXCLUDED.required_for,
  coverage_start_utc=EXCLUDED.coverage_start_utc,
  coverage_end_utc=EXCLUDED.coverage_end_utc,
  as_of_utc=EXCLUDED.as_of_utc,
  data_cutoff_utc=EXCLUDED.data_cutoff_utc,
  last_successful_import_at_utc=EXCLUDED.last_successful_import_at_utc,
  provider=EXCLUDED.provider,
  dataset_version=EXCLUDED.dataset_version,
  missingness=EXCLUDED.missingness,
  reason_codes=EXCLUDED.reason_codes,
  metadata=EXCLUDED.metadata,
  updated_at_utc=now();
