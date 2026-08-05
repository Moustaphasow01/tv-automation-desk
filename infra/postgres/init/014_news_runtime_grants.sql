DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'desk_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE news_sources, news_articles, news_ingestion_runs
      TO desk_runtime;

    GRANT USAGE
      ON TYPE desk_news_provider, desk_news_importance, desk_news_ingestion_status
      TO desk_runtime;
  END IF;
END $$;
