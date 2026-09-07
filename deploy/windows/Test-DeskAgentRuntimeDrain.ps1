. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

function Assert-DeskAgentRuntimeDrainTest {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "Desk Agent Runtime drain test failed: $Message" }
}

$drain = (Get-Content -LiteralPath (Join-Path $PSScriptRoot "Invoke-DeskDrain.ps1") -Raw).Replace("`r`n", "`n")
Assert-DeskAgentRuntimeDrainTest ($drain -match "FROM agent_tasks\s+WHERE status IN \('CLAIMED', 'RUNNING'\)") `
    "CLAIMED/RUNNING Agent Runtime tasks are absent from active work"
Assert-DeskAgentRuntimeDrainTest ($drain -notmatch "FROM agent_tasks[\s\S]{0,180}lease_expires_at_utc\s*>") `
    "expired Agent Runtime rows were treated as proof that the process stopped"
Assert-DeskAgentRuntimeDrainTest ($drain -match '\$requireEmptyAgentQueueSql AND status IN \(''PENDING'', ''READY'', ''WAITING_DEPENDENCY''\)') `
    "transitional empty-queue flag does not include every non-terminal waiting status"
Assert-DeskAgentRuntimeDrainTest ($drain -match 'if \(\$RequireEmptyAgentQueue\) \{ "TRUE" \} else \{ "FALSE" \}') `
    "normal deployments do not leave READY work paused behind DRAIN"

$update = (Get-Content -LiteralPath (Join-Path $PSScriptRoot "Update-Desk.ps1") -Raw).Replace("`r`n", "`n")
$pause = $update.IndexOf('$pauseOutput = @(& $drainScript -Action Pause')
$wait = $update.IndexOf('& $drainScript -Action Wait', $pause)
$stop = $update.IndexOf('Stop-DeskProducerServices', $pause)
Assert-DeskAgentRuntimeDrainTest ($pause -ge 0 -and $wait -gt $pause -and $stop -gt $wait) `
    "producer services stop before in-flight Agent Runtime tasks drain"
Assert-DeskAgentRuntimeDrainTest ($update -match '-RequireEmptyAgentQueue:\$RequireEmptyAgentQueue') `
    "Update does not forward the transitional flag only to Drain Wait"
Assert-DeskAgentRuntimeDrainTest (([regex]::Matches($update, '-RequireEmptyAgentQueue:\$RequireEmptyAgentQueue')).Count -eq 1) `
    "transitional flag is forwarded outside the single Drain Wait call"
$waitFailure = $update.IndexOf('$emptyAgentQueueWaitFailed = $true', $wait)
$recovery = $update.IndexOf('$recovery = Invoke-DeskUpdateRecovery', $wait)
Assert-DeskAgentRuntimeDrainTest ($waitFailure -gt $wait -and $recovery -gt $waitFailure) `
    "empty-queue timeout is not distinguished before automatic recovery"
$failureGuard = $update.IndexOf('if ($emptyAgentQueueWaitFailed)', $waitFailure)
Assert-DeskAgentRuntimeDrainTest ($failureGuard -gt $waitFailure -and $failureGuard -lt $recovery) `
    "empty-queue timeout can restore claims instead of remaining in DRAIN"
$failureGuardBody = $update.Substring($failureGuard, $recovery - $failureGuard)
Assert-DeskAgentRuntimeDrainTest ($failureGuardBody -match 'remains in DRAIN' -and $failureGuardBody -match 'throw \$updateError') `
    "empty-queue timeout does not fail closed before automatic recovery"

Write-Host "Desk Agent Runtime drain tests passed."
