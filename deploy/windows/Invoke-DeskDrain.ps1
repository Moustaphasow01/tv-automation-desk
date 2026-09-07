param(
    [Parameter(Mandatory = $true)][ValidateSet("Begin", "Pause", "Wait", "Resume", "CompleteFrozen", "Fail")][string]$Action,
    [Parameter(Mandatory = $true)][string]$DatabaseUrl,
    [string]$ReleaseVersion = "unversioned",
    [string]$DeploymentId = "",
    [string]$PostgresBin = "",
    [int]$TimeoutSeconds = 900,
    [int]$PollSeconds = 5,
    [string]$FailureReason = "",
    [ValidateSet("verified", "rolled_back")][string]$CompletionStatus = "verified"
)

. (Join-Path $PSScriptRoot "database\DeskDatabase.Common.ps1")

$psql = Resolve-DeskPostgresTool -Name "psql" -PostgresBin $PostgresBin
if (-not $DeploymentId) {
    if ($Action -in @("Begin", "Pause")) {
        $DeploymentId = "deploy-" + (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ") + "-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
    } else {
        $latest = (Invoke-DeskExternal -FilePath $psql -Arguments @(
            "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--dbname", $DatabaseUrl,
            "--command", "SELECT data->>'deployment_id' FROM desk_documents WHERE collection='desk_deployment_controls' AND document_id='producer_hold';"
        ) -PassThru).Trim()
        if (-not $latest) { throw "No active deployment drain was found." }
        $DeploymentId = $latest
    }
}
if ($DeploymentId -notmatch "^[a-zA-Z0-9._-]+$") { throw "DeploymentId contains unsupported characters." }
$deploymentSql = ConvertTo-DeskPsqlLiteral $DeploymentId
$releaseSql = ConvertTo-DeskPsqlLiteral $ReleaseVersion
$failureSql = if ([string]::IsNullOrEmpty($FailureReason)) { "" } else { ConvertTo-DeskPsqlLiteral $FailureReason }
$completionSql = ConvertTo-DeskPsqlLiteral $CompletionStatus

if ($Action -in @("Begin", "Pause")) {
    $beginSql = @"
BEGIN;
SET LOCAL lock_timeout = '$([Math]::Max(30, $TimeoutSeconds))s';
SELECT pg_advisory_xact_lock(741912, 90);
DO `$producer_hold`$
DECLARE control jsonb;
DECLARE producer_pid integer;
BEGIN
  SELECT data INTO control FROM desk_documents
  WHERE collection = 'desk_deployment_controls' AND document_id = 'producer_hold'
  FOR UPDATE;
  IF control IS NOT NULL THEN
    IF COALESCE(
      jsonb_typeof(control) = 'object'
      AND control->>'schema_version' = 'desk_deployment_producer_hold_v1'
      AND control->>'revision' ~ '^[1-9][0-9]*$'
      AND (
        (control->>'state' = 'OPEN' AND control->'held' = 'false'::jsonb AND control->'deployment_id' = 'null'::jsonb)
        OR (control->>'state' = 'FROZEN' AND control->'held' = 'true'::jsonb
            AND jsonb_typeof(control->'deployment_id') = 'string' AND NULLIF(control->>'deployment_id', '') IS NOT NULL)
      ), false
    ) IS NOT TRUE THEN
      RAISE EXCEPTION 'DEPLOYMENT_PRODUCER_HOLD_NOT_AVAILABLE' USING ERRCODE = '55000';
    END IF;
  END IF;
  FOR producer_pid IN
    SELECT pid FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid()
      AND application_name IN (
        'desk-us-grains-strategy-suite-work',
        'desk-strategy-signal-decision-pipeline-work',
        'desk-grains-calendar-refresh'
      )
  LOOP
    IF pg_terminate_backend(producer_pid, 10000) IS NOT TRUE THEN
      RAISE EXCEPTION 'DEPLOYMENT_PRODUCER_CONNECTION_TERMINATION_FAILED' USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid()
      AND application_name IN (
        'desk-us-grains-strategy-suite-work',
        'desk-strategy-signal-decision-pipeline-work',
        'desk-grains-calendar-refresh'
      )
  ) THEN
    RAISE EXCEPTION 'DEPLOYMENT_PRODUCER_CONNECTION_STILL_PRESENT' USING ERRCODE = '55000';
  END IF;
END
`$producer_hold`$;
INSERT INTO desk_deployment_runs (
  deployment_id, release_version, status, previous_claim_controls, previous_execution_lock, details
) VALUES (
  '$deploymentSql',
  '$releaseSql',
  'draining',
  COALESCE((
    SELECT jsonb_object_agg(document_id, data)
    FROM desk_documents
    WHERE collection = 'desk_claim_lane_controls' AND document_id IN ('live', 'replay')
  ), '{}'::jsonb),
  (SELECT to_jsonb(lock_row) FROM (
    SELECT execution_lock_id, locked, reason, set_by, set_at, expires_at, metadata
    FROM broker_execution_locks
    WHERE scope_type = 'global' AND scope_value = '*'
    LIMIT 1
  ) lock_row),
  jsonb_build_object(
    'previous_producer_hold', COALESCE((
      SELECT data FROM desk_documents
      WHERE collection = 'desk_deployment_controls' AND document_id = 'producer_hold'
    ), jsonb_build_object(
      'schema_version', 'desk_deployment_producer_hold_v1',
      'state', 'OPEN', 'held', false, 'deployment_id', NULL,
      'revision', 1, 'reason', NULL, 'changed_by', 'deployment-bootstrap',
      'updated_at_utc', now()
    )),
    'producer_hold_initialized', NOT EXISTS (
      SELECT 1 FROM desk_documents
      WHERE collection = 'desk_deployment_controls' AND document_id = 'producer_hold'
    )
  )
);
INSERT INTO desk_documents(collection, document_id, data)
VALUES ('desk_deployment_controls', 'producer_hold', jsonb_build_object(
  'schema_version', 'desk_deployment_producer_hold_v1',
  'state', 'DRAIN', 'held', true, 'deployment_id', '$deploymentSql',
  'revision', COALESCE((
    SELECT (data->>'revision')::bigint FROM desk_documents
    WHERE collection = 'desk_deployment_controls' AND document_id = 'producer_hold'
  ), 1) + 1,
  'reason', 'DEPLOYMENT_DRAIN', 'changed_by', 'deployment:$deploymentSql',
  'updated_at_utc', now()
))
ON CONFLICT(collection, document_id) DO UPDATE
SET data = EXCLUDED.data, updated_at = now();
INSERT INTO desk_documents(collection, document_id, data)
SELECT
  'desk_claim_lane_controls',
  lane,
  COALESCE(existing.data, '{}'::jsonb) || jsonb_build_object(
    'lane', lane,
    'enabled', false,
    'status', 'PAUSED',
    'revision', COALESCE((existing.data->>'revision')::integer, 0) + 1,
    'reason', 'DEPLOYMENT_DRAIN',
    'changed_by', 'deployment:$deploymentSql',
    'updated_at_utc', now()
  )
FROM (VALUES ('live'), ('replay')) lanes(lane)
LEFT JOIN desk_documents existing
  ON existing.collection = 'desk_claim_lane_controls' AND existing.document_id = lane
ON CONFLICT(collection, document_id) DO UPDATE
  SET data = EXCLUDED.data, updated_at = now();
INSERT INTO broker_execution_locks(
  execution_lock_id, scope_type, scope_value, locked, reason, set_by, set_at, expires_at, metadata
) VALUES (
  'global_default_kill_switch', 'global', '*', true, 'Deployment drain $deploymentSql',
  'deployment', now(), NULL, jsonb_build_object('deployment_id', '$deploymentSql', 'deployment_drain', true)
)
ON CONFLICT(scope_type, scope_value) DO UPDATE
SET locked = true,
    reason = EXCLUDED.reason,
    set_by = EXCLUDED.set_by,
    set_at = EXCLUDED.set_at,
    expires_at = NULL,
    metadata = broker_execution_locks.metadata || EXCLUDED.metadata;
COMMIT;
"@
    Invoke-DeskExternal -FilePath $psql -Arguments @("--set", "ON_ERROR_STOP=1", "--dbname", $DatabaseUrl, "--command", $beginSql)
    Write-Host "Claims paused and broker execution locked for $DeploymentId."
    if ($Action -eq "Pause") {
        Write-Output $DeploymentId
        return
    }
}

if ($Action -in @("Begin", "Wait")) {
    $deadline = (Get-Date).ToUniversalTime().AddSeconds([Math]::Max(30, $TimeoutSeconds))
    $active = -1
    do {
        $countSql = @"
SELECT CASE WHEN
  EXISTS (
    SELECT 1 FROM desk_documents
    WHERE collection = 'desk_deployment_controls' AND document_id = 'producer_hold'
      AND data->>'schema_version' = 'desk_deployment_producer_hold_v1'
      AND data->>'state' = 'DRAIN' AND data->>'held' = 'true'
      AND data->>'deployment_id' = '$deploymentSql'
  )
  AND EXISTS (
    SELECT 1 FROM desk_deployment_runs
    WHERE deployment_id = '$deploymentSql' AND status = 'draining'
  )
THEN (
  (SELECT count(*) FROM desk_documents
   WHERE collection = 'desk_agent_work_items'
     AND data->>'status' = 'CLAIMED'
     AND NULLIF(data->>'lease_expires_at_utc','')::timestamptz > now())
  +
  (SELECT count(*) FROM desk_documents
   WHERE collection = 'desk_live_run_cursor'
     AND data#>>'{attempt,status}' = 'LEASED'
     AND NULLIF(data#>>'{attempt,lease_expires_at_utc}','')::timestamptz > now())
  +
  (SELECT count(*) FROM desk_documents
   WHERE collection = 'desk_replay_preparation_jobs'
     AND data->>'status' IN ('DATA_CHECK','PACK_BUILDING')
     AND NULLIF(data->>'lease_expires_at_utc','')::timestamptz > now())
  +
  (SELECT count(*) FROM broker_execution_outbox
   WHERE status IN ('rendered','delivered')
      OR (status = 'leased' AND (lease_expires_at IS NULL OR lease_expires_at > now())))
  +
  (SELECT count(*) FROM broker_management_outbox
   WHERE status IN ('rendered','delivered')
      OR (status = 'leased' AND (lease_expires_at IS NULL OR lease_expires_at > now())))
)::integer ELSE -1 END;
"@
        $activeText = (Invoke-DeskExternal -FilePath $psql -Arguments @(
            "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align",
            "--dbname", $DatabaseUrl, "--command", $countSql
        ) -PassThru).Trim()
        $active = [int]$activeText
        if ($active -lt 0) {
            throw "Deployment drain ownership or active status changed while waiting."
        }
        Write-Host "Drain $DeploymentId`: active work=$active"
        if ($active -eq 0) { break }
        Start-Sleep -Seconds ([Math]::Max(1, $PollSeconds))
    } while ((Get-Date).ToUniversalTime() -lt $deadline)
    if ($active -ne 0) {
        throw "Deployment drain timed out with $active active item(s). Claims remain paused and broker execution remains locked."
    }
    $drainedSql = @"
BEGIN;
SET LOCAL lock_timeout = '$([Math]::Max(30, $TimeoutSeconds))s';
SELECT pg_advisory_xact_lock(741912, 90);
DO `$producer_hold`$
DECLARE control jsonb;
BEGIN
  SELECT data INTO control FROM desk_documents
  WHERE collection = 'desk_deployment_controls' AND document_id = 'producer_hold'
  FOR UPDATE;
  IF COALESCE(
    control->>'schema_version' = 'desk_deployment_producer_hold_v1'
    AND control->>'state' = 'DRAIN' AND control->'held' = 'true'::jsonb
    AND control->>'deployment_id' = '$deploymentSql', false
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'DEPLOYMENT_PRODUCER_HOLD_OWNER_MISMATCH' USING ERRCODE = '55000';
  END IF;
  UPDATE desk_deployment_runs
  SET status='drained', drained_at_utc=now(), updated_at_utc=now(),
      drain_snapshot=jsonb_build_object('active_work',0)
  WHERE deployment_id='$deploymentSql' AND status='draining';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEPLOYMENT_DRAIN_RUN_NOT_ACTIVE' USING ERRCODE = '55000';
  END IF;
END
`$producer_hold`$;
COMMIT;
"@
    Invoke-DeskExternal -FilePath $psql -Arguments @("--set", "ON_ERROR_STOP=1", "--dbname", $DatabaseUrl, "--command", $drainedSql)
    Write-Output $DeploymentId
    return
}

if ($Action -eq "Fail") {
    $failSql = @"
BEGIN;
SET LOCAL lock_timeout = '$([Math]::Max(30, $TimeoutSeconds))s';
SELECT pg_advisory_xact_lock(741912, 90);
DO `$producer_hold`$
DECLARE control jsonb;
BEGIN
  SELECT data INTO control FROM desk_documents
  WHERE collection = 'desk_deployment_controls' AND document_id = 'producer_hold'
  FOR UPDATE;
  IF COALESCE(
    jsonb_typeof(control) = 'object'
    AND control->>'schema_version' = 'desk_deployment_producer_hold_v1'
    AND control->>'revision' ~ '^[1-9][0-9]*$'
    AND control->>'state' IN ('DRAIN', 'FROZEN', 'FAILED')
    AND control->'held' = 'true'::jsonb
    AND control->>'deployment_id' = '$deploymentSql', false
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'DEPLOYMENT_PRODUCER_HOLD_OWNER_MISMATCH' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM desk_deployment_runs WHERE deployment_id = '$deploymentSql' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEPLOYMENT_RUN_NOT_FOUND' USING ERRCODE = '55000';
  END IF;
END
`$producer_hold`$;
UPDATE desk_documents
SET data = data || jsonb_build_object(
      'schema_version', 'desk_deployment_producer_hold_v1',
      'state', 'FAILED', 'held', true, 'deployment_id', '$deploymentSql',
      'revision', (data->>'revision')::bigint + 1,
      'reason', 'DEPLOYMENT_RECOVERY_FAILURE',
      'changed_by', 'deployment-fail:$deploymentSql',
      'updated_at_utc', now()
    ),
    updated_at = now()
WHERE collection = 'desk_deployment_controls' AND document_id = 'producer_hold';
INSERT INTO desk_documents(collection, document_id, data)
SELECT 'desk_claim_lane_controls', lane,
  COALESCE(existing.data, '{}'::jsonb) || jsonb_build_object(
    'lane', lane, 'enabled', false, 'status', 'PAUSED',
    'revision', COALESCE((existing.data->>'revision')::bigint, 0) + 1,
    'reason', 'DEPLOYMENT_RECOVERY_FAILURE',
    'changed_by', 'deployment-fail:$deploymentSql', 'updated_at_utc', now()
  )
FROM (VALUES ('live'), ('replay')) lanes(lane)
LEFT JOIN desk_documents existing
  ON existing.collection = 'desk_claim_lane_controls' AND existing.document_id = lane
ON CONFLICT(collection, document_id) DO UPDATE
SET data = EXCLUDED.data, updated_at = now();
INSERT INTO broker_execution_locks(
  execution_lock_id, scope_type, scope_value, locked, reason, set_by, set_at, expires_at, metadata
) VALUES (
  'global_default_kill_switch', 'global', '*', true, 'Deployment recovery failure $deploymentSql',
  'deployment-fail', now(), NULL, jsonb_build_object('deployment_id', '$deploymentSql', 'deployment_failure', true)
)
ON CONFLICT(scope_type, scope_value) DO UPDATE
SET locked = true,
    reason = EXCLUDED.reason,
    set_by = EXCLUDED.set_by,
    set_at = EXCLUDED.set_at,
    expires_at = NULL,
    metadata = broker_execution_locks.metadata || EXCLUDED.metadata;
UPDATE desk_deployment_runs
SET status = 'failed',
    details = details || jsonb_build_object('failure_reason', '$failureSql'),
    updated_at_utc = now()
WHERE deployment_id = '$deploymentSql';
COMMIT;
"@
    Invoke-DeskExternal -FilePath $psql -Arguments @("--set", "ON_ERROR_STOP=1", "--dbname", $DatabaseUrl, "--command", $failSql)
    Write-Host "Deployment $DeploymentId marked failed. Safety drain was reasserted."
    return
}

if ($Action -eq "CompleteFrozen") {
    $frozenSql = @"
BEGIN;
SET LOCAL lock_timeout = '$([Math]::Max(30, $TimeoutSeconds))s';
SELECT pg_advisory_xact_lock(741912, 90);
DO `$producer_hold`$
DECLARE control jsonb;
BEGIN
  SELECT data INTO control FROM desk_documents
  WHERE collection = 'desk_deployment_controls' AND document_id = 'producer_hold'
  FOR UPDATE;
  IF COALESCE(
    jsonb_typeof(control) = 'object'
    AND control->>'schema_version' = 'desk_deployment_producer_hold_v1'
    AND control->>'revision' ~ '^[1-9][0-9]*$'
    AND control->>'state' IN ('DRAIN', 'FAILED', 'FROZEN')
    AND control->'held' = 'true'::jsonb
    AND control->>'deployment_id' = '$deploymentSql', false
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'DEPLOYMENT_PRODUCER_HOLD_OWNER_MISMATCH' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM desk_deployment_runs
  WHERE deployment_id = '$deploymentSql' AND status IN ('drained', 'failed')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEPLOYMENT_RUN_NOT_FOUND' USING ERRCODE = '55000';
  END IF;
END
`$producer_hold`$;
UPDATE desk_documents
SET data = data || jsonb_build_object(
      'schema_version', 'desk_deployment_producer_hold_v1',
      'state', 'FROZEN', 'held', true, 'deployment_id', '$deploymentSql',
      'revision', (data->>'revision')::bigint + 1,
      'reason', 'ENGINE_V5_VALIDATION_HOLD',
      'changed_by', 'deployment-frozen:$deploymentSql',
      'updated_at_utc', now()
    ),
    updated_at = now()
WHERE collection = 'desk_deployment_controls' AND document_id = 'producer_hold';
INSERT INTO desk_documents(collection, document_id, data)
SELECT 'desk_claim_lane_controls', lane,
  COALESCE(existing.data, '{}'::jsonb) || jsonb_build_object(
    'lane', lane, 'enabled', false, 'status', 'PAUSED',
    'revision', COALESCE((existing.data->>'revision')::bigint, 0) + 1,
    'reason', 'ENGINE_V5_VALIDATION_HOLD',
    'changed_by', 'deployment-frozen:$deploymentSql', 'updated_at_utc', now()
  )
FROM (VALUES ('live'), ('replay')) lanes(lane)
LEFT JOIN desk_documents existing
  ON existing.collection = 'desk_claim_lane_controls' AND existing.document_id = lane
ON CONFLICT(collection, document_id) DO UPDATE
SET data = EXCLUDED.data, updated_at = now();
INSERT INTO broker_execution_locks(
  execution_lock_id, scope_type, scope_value, locked, reason, set_by, set_at, expires_at, metadata
) VALUES (
  'global_default_kill_switch', 'global', '*', true, 'ENGINE_V5_VALIDATION_HOLD',
  'deployment-frozen', now(), NULL,
  jsonb_build_object('deployment_id', '$deploymentSql', 'frozen_release', true)
)
ON CONFLICT(scope_type, scope_value) DO UPDATE
SET locked = true,
    reason = EXCLUDED.reason,
    set_by = EXCLUDED.set_by,
    set_at = EXCLUDED.set_at,
    expires_at = NULL,
    metadata = broker_execution_locks.metadata || EXCLUDED.metadata;
UPDATE desk_deployment_runs
SET status = '$completionSql',
    completed_at_utc = COALESCE(completed_at_utc, now()),
    updated_at_utc = now(),
    details = details || jsonb_build_object(
      'frozen', true,
      'claim_lanes', 'paused',
      'broker_execution', 'locked'
    )
WHERE deployment_id = '$deploymentSql';
COMMIT;
"@
    Invoke-DeskExternal -FilePath $psql -Arguments @(
        "--set", "ON_ERROR_STOP=1", "--dbname", $DatabaseUrl, "--command", $frozenSql
    )
    Write-Host "Deployment $DeploymentId completed as $CompletionStatus under strict freeze."
    return
}


$resumeSql = @"
BEGIN;
SET LOCAL lock_timeout = '$([Math]::Max(30, $TimeoutSeconds))s';
SELECT pg_advisory_xact_lock(741912, 90);
DO `$producer_hold`$
DECLARE control jsonb;
DECLARE previous_control jsonb;
DECLARE previous_lock jsonb;
DECLARE deployment_status text;
BEGIN
  SELECT data INTO control FROM desk_documents
  WHERE collection = 'desk_deployment_controls' AND document_id = 'producer_hold'
  FOR UPDATE;
  SELECT details->'previous_producer_hold', previous_execution_lock, status
  INTO previous_control, previous_lock, deployment_status
  FROM desk_deployment_runs WHERE deployment_id = '$deploymentSql' FOR UPDATE;
  PERFORM 1 FROM desk_documents
  WHERE collection = 'desk_claim_lane_controls' AND document_id IN ('live', 'replay')
  FOR UPDATE;
  PERFORM 1 FROM broker_execution_locks
  WHERE scope_type = 'global' AND scope_value = '*'
  FOR UPDATE;
  IF COALESCE(
    jsonb_typeof(control) = 'object'
    AND control->>'schema_version' = 'desk_deployment_producer_hold_v1'
    AND control->>'revision' ~ '^[1-9][0-9]*$'
    AND control->>'state' IN ('DRAIN', 'FAILED')
    AND control->'held' = 'true'::jsonb
    AND control->>'deployment_id' = '$deploymentSql', false
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'DEPLOYMENT_PRODUCER_HOLD_OWNER_MISMATCH' USING ERRCODE = '55000';
  END IF;
  IF deployment_status NOT IN ('drained', 'failed') THEN
    RAISE EXCEPTION 'DEPLOYMENT_RUN_NOT_READY_TO_RESUME' USING ERRCODE = '55000';
  END IF;
  IF COALESCE(
    jsonb_typeof(previous_control) = 'object'
    AND previous_control->>'schema_version' = 'desk_deployment_producer_hold_v1'
    AND previous_control->>'revision' ~ '^[1-9][0-9]*$'
    AND (
      (previous_control->>'state' = 'OPEN' AND previous_control->'held' = 'false'::jsonb
       AND previous_control->'deployment_id' = 'null'::jsonb)
      OR (previous_control->>'state' = 'FROZEN' AND previous_control->'held' = 'true'::jsonb
          AND jsonb_typeof(previous_control->'deployment_id') = 'string'
          AND NULLIF(previous_control->>'deployment_id', '') IS NOT NULL)
    ), false
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'DEPLOYMENT_PRODUCER_PREVIOUS_HOLD_INVALID' USING ERRCODE = '55000';
  END IF;
  IF (
    SELECT count(*) FROM desk_documents
    WHERE collection = 'desk_claim_lane_controls'
      AND document_id IN ('live', 'replay')
      AND data->>'enabled' = 'false'
      AND data->>'status' = 'PAUSED'
      AND data->>'changed_by' IN ('deployment:$deploymentSql', 'deployment-fail:$deploymentSql')
  ) <> 2 THEN
    RAISE EXCEPTION 'DEPLOYMENT_CLAIM_CONTROLS_OWNER_MISMATCH' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM broker_execution_locks
    WHERE scope_type = 'global' AND scope_value = '*' AND locked = true
      AND metadata->>'deployment_id' = '$deploymentSql'
      AND (
        (set_by = 'deployment' AND reason = 'Deployment drain $deploymentSql'
         AND metadata = COALESCE(previous_lock->'metadata', '{}'::jsonb)
                        || jsonb_build_object('deployment_id', '$deploymentSql', 'deployment_drain', true))
        OR (set_by = 'deployment-fail' AND reason = 'Deployment recovery failure $deploymentSql'
            AND metadata IN (
              COALESCE(previous_lock->'metadata', '{}'::jsonb)
                || jsonb_build_object('deployment_id', '$deploymentSql', 'deployment_drain', true, 'deployment_failure', true),
              COALESCE(previous_lock->'metadata', '{}'::jsonb)
                || jsonb_build_object('deployment_id', '$deploymentSql', 'deployment_drain', true,
                                      'frozen_release', true, 'deployment_failure', true)
            ))
      )
  ) THEN
    RAISE EXCEPTION 'DEPLOYMENT_EXECUTION_LOCK_OWNER_MISMATCH' USING ERRCODE = '55000';
  END IF;
END
`$producer_hold`$;
UPDATE desk_documents control
SET data = (deployment.details->'previous_producer_hold') || jsonb_build_object(
      'revision', (control.data->>'revision')::bigint + 1,
      'changed_by', 'deployment-resume:$deploymentSql',
      'updated_at_utc', now()
    ),
    updated_at = now()
FROM desk_deployment_runs deployment
WHERE deployment.deployment_id = '$deploymentSql'
  AND control.collection = 'desk_deployment_controls'
  AND control.document_id = 'producer_hold';
WITH deployment AS (
  SELECT previous_claim_controls, previous_execution_lock
  FROM desk_deployment_runs WHERE deployment_id = '$deploymentSql' FOR UPDATE
)
UPDATE desk_documents current
SET data = CASE
      WHEN deployment.previous_claim_controls ? current.document_id
        THEN (deployment.previous_claim_controls -> current.document_id)
             || jsonb_build_object(
                  'revision', COALESCE((current.data->>'revision')::bigint, 0) + 1,
                  'updated_at_utc', now(), 'changed_by', 'deployment-resume:$deploymentSql'
                )
      ELSE current.data
           || jsonb_build_object(
                'enabled', true, 'status', 'RUNNING', 'reason', NULL,
                'revision', COALESCE((current.data->>'revision')::bigint, 0) + 1,
                'updated_at_utc', now(), 'changed_by', 'deployment-resume:$deploymentSql'
              )
    END,
    updated_at = now()
FROM deployment
WHERE current.collection = 'desk_claim_lane_controls'
  AND current.document_id IN ('live', 'replay');
WITH deployment AS (
  SELECT previous_execution_lock
  FROM desk_deployment_runs WHERE deployment_id = '$deploymentSql'
)
UPDATE broker_execution_locks lock
SET locked = COALESCE((deployment.previous_execution_lock->>'locked')::boolean, true),
    reason = COALESCE(deployment.previous_execution_lock->>'reason', 'Default safety lock: broker execution is not armed.'),
    set_by = COALESCE(deployment.previous_execution_lock->>'set_by', 'deployment-resume'),
    set_at = COALESCE((deployment.previous_execution_lock->>'set_at')::timestamptz, now()),
    expires_at = (deployment.previous_execution_lock->>'expires_at')::timestamptz,
    metadata = COALESCE(deployment.previous_execution_lock->'metadata', '{}'::jsonb)
FROM deployment
WHERE lock.scope_type = 'global' AND lock.scope_value = '*';
UPDATE desk_deployment_runs
SET status = '$completionSql', completed_at_utc = now(), updated_at_utc = now()
WHERE deployment_id = '$deploymentSql';
COMMIT;
"@
Invoke-DeskExternal -FilePath $psql -Arguments @("--set", "ON_ERROR_STOP=1", "--dbname", $DatabaseUrl, "--command", $resumeSql)
Write-Host "Deployment $DeploymentId completed as $CompletionStatus; previous claim and execution controls restored."
