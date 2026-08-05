-- Isolate the bulk Firestore import from the PREPROD operational runtime.
-- The import completed before this cutover; later local documents remain active.
DO $$
DECLARE
  cutover timestamptz := '2026-07-20T00:00:00Z'::timestamptz;
BEGIN
  UPDATE desk_documents
  SET data = data || jsonb_build_object(
        'data_origin', 'prod_import',
        'runtime_environment', 'preprod',
        'operational_visibility', 'history',
        'read_only', true
      ),
      updated_at = now()
  WHERE created_at < cutover
    AND (
      collection LIKE 'desk_replay_%'
      OR collection IN (
        'desk_agent_work_items',
        'desk_agent_work_events',
        'desk_agent_work_dead_letter',
        'desk_live_run_cursor',
        'desk_backtests',
        'desk_backtest_steps',
        'desk_simulated_trades'
      )
    )
    AND COALESCE(data->>'data_origin', '') <> 'preprod_local';

  UPDATE desk_documents
  SET data = data || jsonb_build_object(
        'enabled', false,
        'operational_visibility', 'history',
        'data_origin', 'prod_import',
        'runtime_environment', 'preprod',
        'read_only', true,
        'disabled_reason', 'prod_import_isolated_from_preprod_runtime'
      ),
      updated_at = now()
  WHERE collection = 'desk_replay_autopilot_configs'
    AND created_at < cutover;

  UPDATE desk_documents alert
  SET data = alert.data || jsonb_build_object(
        'status', 'RESOLVED',
        'lifecycle_status', 'resolved',
        'operational_visibility', 'history',
        'data_origin', 'prod_import',
        'runtime_environment', 'preprod',
        'read_only', true,
        'resolved_reason', 'prod_import_isolated_from_preprod_runtime',
        'resolved_at_utc', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ),
      updated_at = now()
  WHERE alert.collection = 'desk_alerts'
    AND (
      alert.created_at < cutover
      OR EXISTS (
        SELECT 1
        FROM desk_documents run
        WHERE run.collection = 'desk_replay_runs'
          AND run.data->>'operational_visibility' = 'history'
          AND run.document_id = COALESCE(
            alert.data->>'run_id',
            alert.data#>>'{evidence,runId}'
          )
      )
    );

  UPDATE desk_documents
  SET data = data || jsonb_build_object(
        'operational_visibility', 'history',
        'data_origin', 'prod_import',
        'runtime_environment', 'preprod',
        'read_only', true
      ),
      updated_at = now()
  WHERE collection IN ('desk_alert_events', 'desk_notification_outbox')
    AND created_at < cutover;

  INSERT INTO desk_runtime_migrations (
    migration_id, status, details, completed_at_utc, updated_at_utc
  ) VALUES (
    '006_runtime_origin_20260720',
    'COMPLETED',
    jsonb_build_object('cutover_utc', cutover, 'purpose', 'isolate_prod_import'),
    now(),
    now()
  )
  ON CONFLICT (migration_id) DO UPDATE
  SET status = 'COMPLETED',
      details = EXCLUDED.details,
      completed_at_utc = EXCLUDED.completed_at_utc,
      updated_at_utc = now();
END $$;
