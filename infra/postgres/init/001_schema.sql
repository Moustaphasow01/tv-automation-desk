CREATE TABLE IF NOT EXISTS desk_documents (
  collection text NOT NULL,
  document_id text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, document_id)
);

CREATE INDEX IF NOT EXISTS desk_documents_collection_updated_idx
  ON desk_documents (collection, updated_at DESC);

CREATE INDEX IF NOT EXISTS desk_documents_data_gin_idx
  ON desk_documents USING gin (data);
