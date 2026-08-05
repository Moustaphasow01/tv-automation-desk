CREATE TABLE IF NOT EXISTS desk_schema_migrations (
  migration_id text PRIMARY KEY,
  content_sha256 text NOT NULL,
  applied_at_utc timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL DEFAULT current_user,
  release_version text,
  execution_ms integer CHECK (execution_ms IS NULL OR execution_ms >= 0)
);

CREATE TABLE IF NOT EXISTS desk_service_heartbeats (
  service_id text PRIMARY KEY,
  service_kind text NOT NULL,
  instance_id text NOT NULL,
  release_version text,
  status text NOT NULL CHECK (status IN ('starting', 'healthy', 'degraded', 'stopping', 'stopped', 'failed')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at_utc timestamptz,
  heartbeat_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS desk_service_heartbeats_status_idx
  ON desk_service_heartbeats (status, heartbeat_at_utc DESC);

CREATE TABLE IF NOT EXISTS desk_backup_catalog (
  backup_id text PRIMARY KEY,
  database_name text NOT NULL,
  release_version text,
  storage_kind text NOT NULL CHECK (storage_kind IN ('local', 'offsite', 'object_storage')),
  storage_path text NOT NULL,
  content_sha256 text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  encrypted boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('created', 'verified', 'restored', 'failed', 'expired')),
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  verified_at_utc timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS desk_backup_catalog_created_idx
  ON desk_backup_catalog (created_at_utc DESC);
