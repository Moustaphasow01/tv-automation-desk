CREATE TABLE IF NOT EXISTS desk_pack_objects (
  object_id text PRIMARY KEY,
  source_storage_path text NOT NULL,
  source_generation text NOT NULL DEFAULT '',
  local_relative_path text NOT NULL UNIQUE,
  content_sha256 text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  content_type text,
  status text NOT NULL DEFAULT 'READY'
    CHECK (status IN ('READY', 'MISSING', 'CORRUPT', 'QUARANTINED')),
  source_kind text NOT NULL DEFAULT 'LOCAL'
    CHECK (source_kind IN ('LOCAL', 'GCS_MIRROR', 'POSTGRES_BUILD')),
  immutable boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  verified_at_utc timestamptz,
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_storage_path, source_generation)
);

CREATE INDEX IF NOT EXISTS idx_desk_pack_objects_source_path
  ON desk_pack_objects (source_storage_path);

CREATE INDEX IF NOT EXISTS idx_desk_pack_objects_status
  ON desk_pack_objects (status, source_kind);

CREATE TABLE IF NOT EXISTS desk_runtime_migrations (
  migration_id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at_utc timestamptz NOT NULL DEFAULT now(),
  completed_at_utc timestamptz,
  updated_at_utc timestamptz NOT NULL DEFAULT now()
);
