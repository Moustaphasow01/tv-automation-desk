DO $$
BEGIN
  ALTER TYPE simulation_run_artifact_kind ADD VALUE IF NOT EXISTS 'ROBUSTNESS_REPORT';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
