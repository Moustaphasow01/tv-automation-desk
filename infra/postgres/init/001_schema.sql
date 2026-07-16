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

CREATE INDEX IF NOT EXISTS desk_documents_collection_backtest_idx
  ON desk_documents (collection, ((data ->> 'backtest_id')));

CREATE INDEX IF NOT EXISTS desk_documents_collection_status_idx
  ON desk_documents (collection, ((data ->> 'status')));

CREATE INDEX IF NOT EXISTS desk_documents_collection_trading_date_idx
  ON desk_documents (collection, ((data ->> 'trading_date')));

CREATE INDEX IF NOT EXISTS desk_documents_collection_work_item_idx
  ON desk_documents (collection, ((data ->> 'work_item_id')));
