DO $$
BEGIN
  CREATE TYPE desk_news_provider AS ENUM ('GDELT', 'FINNHUB', 'MANUAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE desk_news_importance AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE desk_news_ingestion_status AS ENUM ('RUNNING', 'READY', 'PARTIAL', 'FETCH_FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS news_sources (
  source_id text PRIMARY KEY,
  provider desk_news_provider NOT NULL,
  display_name text NOT NULL,
  base_url text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  refresh_interval_seconds integer NOT NULL DEFAULT 900 CHECK (refresh_interval_seconds BETWEEN 60 AND 21600),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_success_at_utc timestamptz,
  last_attempt_at_utc timestamptz,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS news_articles (
  article_id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES news_sources(source_id),
  provider_article_id text NOT NULL,
  canonical_url text NOT NULL UNIQUE,
  original_url text NOT NULL,
  title text NOT NULL,
  summary text,
  source_domain text NOT NULL,
  language text NOT NULL DEFAULT 'English',
  source_country text,
  published_at_utc timestamptz NOT NULL,
  importance desk_news_importance NOT NULL DEFAULT 'LOW',
  assets text[] NOT NULL DEFAULT '{}',
  instruments text[] NOT NULL DEFAULT '{}',
  topics text[] NOT NULL DEFAULT '{}',
  sentiment numeric(7, 4),
  content_hash text NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at_utc timestamptz NOT NULL DEFAULT now(),
  last_seen_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, provider_article_id)
);

CREATE INDEX IF NOT EXISTS news_articles_published_idx
  ON news_articles (published_at_utc DESC);

CREATE INDEX IF NOT EXISTS news_articles_importance_published_idx
  ON news_articles (importance, published_at_utc DESC);

CREATE INDEX IF NOT EXISTS news_articles_assets_gin_idx
  ON news_articles USING gin (assets);

CREATE INDEX IF NOT EXISTS news_articles_instruments_gin_idx
  ON news_articles USING gin (instruments);

CREATE INDEX IF NOT EXISTS news_articles_topics_gin_idx
  ON news_articles USING gin (topics);

CREATE TABLE IF NOT EXISTS news_ingestion_runs (
  run_id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES news_sources(source_id),
  requested_by text NOT NULL,
  status desk_news_ingestion_status NOT NULL DEFAULT 'RUNNING',
  started_at_utc timestamptz NOT NULL,
  completed_at_utc timestamptz,
  received_count integer NOT NULL DEFAULT 0 CHECK (received_count >= 0),
  normalized_count integer NOT NULL DEFAULT 0 CHECK (normalized_count >= 0),
  inserted_count integer NOT NULL DEFAULT 0 CHECK (inserted_count >= 0),
  updated_count integer NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  discarded_count integer NOT NULL DEFAULT 0 CHECK (discarded_count >= 0),
  pruned_count integer NOT NULL DEFAULT 0 CHECK (pruned_count >= 0),
  error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_utc timestamptz NOT NULL DEFAULT now(),
  updated_at_utc timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS news_ingestion_runs_source_started_idx
  ON news_ingestion_runs (source_id, started_at_utc DESC);

CREATE INDEX IF NOT EXISTS news_ingestion_runs_status_started_idx
  ON news_ingestion_runs (status, started_at_utc DESC);
