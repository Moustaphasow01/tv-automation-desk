-- Phase 15 / lot 1: remove data that has no reader in Autopilot V4.
DO $$
DECLARE
  removed_cross_asset_deltas bigint := 0;
BEGIN
  DELETE FROM desk_documents
  WHERE collection = 'desk_cross_asset_deltas';
  GET DIAGNOSTICS removed_cross_asset_deltas = ROW_COUNT;

  INSERT INTO desk_runtime_migrations (
    migration_id, status, details, completed_at_utc, updated_at_utc
  ) VALUES (
    '007_remove_legacy_v4_20260720',
    'COMPLETED',
    jsonb_build_object(
      'removed_cross_asset_deltas', removed_cross_asset_deltas,
      'replacement', 'immutable_pack_datasets_and_bundle_snapshots'
    ),
    now(),
    now()
  )
  ON CONFLICT (migration_id) DO UPDATE
  SET status = 'COMPLETED',
      details = EXCLUDED.details,
      completed_at_utc = EXCLUDED.completed_at_utc,
      updated_at_utc = now();
END $$;
