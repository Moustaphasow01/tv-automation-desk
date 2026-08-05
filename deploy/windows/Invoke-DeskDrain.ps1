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
        $latest = (& $psql --tuples-only --no-align --dbname $DatabaseUrl --command "SELECT deployment_id FROM desk_deployment_runs WHERE status IN ('draining','drained','switching','verifying','failed') ORDER BY started_at_utc DESC LIMIT 1;").Trim()
        if ($LASTEXITCODE -ne 0 -or -not $latest) { throw "No active deployment drain was found." }
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
INSERT INTO desk_deployment_runs (
  deployment_id, release_version, status, previous_claim_controls, previous_execution_lock
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
  ) lock_row)
);
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
UPDATE broker_execution_locks
SET locked = true,
    reason = 'Deployment drain $deploymentSql',
    set_by = 'deployment',
    set_at = now(),
    expires_at = NULL,
    metadata = metadata || jsonb_build_object('deployment_id', '$deploymentSql', 'deployment_drain', true)
WHERE scope_type = 'global' AND scope_value = '*';
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
SELECT (
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
)::integer;
"@
        $activeText = (& $psql --tuples-only --no-align --dbname $DatabaseUrl --command $countSql).Trim()
        if ($LASTEXITCODE -ne 0) { throw "Unable to inspect active work during drain." }
        $active = [int]$activeText
        Write-Host "Drain $DeploymentId`: active work=$active"
        if ($active -eq 0) { break }
        Start-Sleep -Seconds ([Math]::Max(1, $PollSeconds))
    } while ((Get-Date).ToUniversalTime() -lt $deadline)
    if ($active -ne 0) {
        throw "Deployment drain timed out with $active active item(s). Claims remain paused and broker execution remains locked."
    }
    $drainedSql = "UPDATE desk_deployment_runs SET status='drained', drained_at_utc=now(), updated_at_utc=now(), drain_snapshot=jsonb_build_object('active_work',0) WHERE deployment_id='$deploymentSql';"
    Invoke-DeskExternal -FilePath $psql -Arguments @("--set", "ON_ERROR_STOP=1", "--dbname", $DatabaseUrl, "--command", $drainedSql)
    Write-Output $DeploymentId
    return
}

if ($Action -eq "Fail") {
    $failSql = "UPDATE desk_deployment_runs SET status='failed', details=details || jsonb_build_object('failure_reason','$failureSql'), updated_at_utc=now() WHERE deployment_id='$deploymentSql';"
    Invoke-DeskExternal -FilePath $psql -Arguments @("--set", "ON_ERROR_STOP=1", "--dbname", $DatabaseUrl, "--command", $failSql)
    Write-Host "Deployment $DeploymentId marked failed. Safety drain remains active."
    return
}

if ($Action -eq "CompleteFrozen") {
    $frozenSql = @"
BEGIN;
UPDATE desk_documents
SET data = data || jsonb_build_object(
      'enabled', false,
      'status', 'PAUSED',
      'reason', 'ENGINE_V5_VALIDATION_HOLD',
      'changed_by', 'deployment-frozen:$deploymentSql',
      'updated_at_utc', now()
    ),
    updated_at = now()
WHERE collection = 'desk_claim_lane_controls'
  AND document_id IN ('live', 'replay');
UPDATE broker_execution_locks
SET locked = true,
    reason = 'ENGINE_V5_VALIDATION_HOLD',
    set_by = 'deployment-frozen',
    set_at = now(),
    expires_at = NULL,
    metadata = metadata || jsonb_build_object(
      'deployment_id', '$deploymentSql',
      'frozen_release', true
    )
WHERE scope_type = 'global' AND scope_value = '*';
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
WITH deployment AS (
  SELECT previous_claim_controls, previous_execution_lock
  FROM desk_deployment_runs WHERE deployment_id = '$deploymentSql' FOR UPDATE
)
UPDATE desk_documents current
SET data = CASE
      WHEN deployment.previous_claim_controls ? current.document_id
        THEN (deployment.previous_claim_controls -> current.document_id)
             || jsonb_build_object('updated_at_utc', now(), 'changed_by', 'deployment-resume:$deploymentSql')
      ELSE current.data
           || jsonb_build_object('enabled', true, 'status', 'RUNNING', 'reason', NULL, 'updated_at_utc', now(), 'changed_by', 'deployment-resume:$deploymentSql')
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
