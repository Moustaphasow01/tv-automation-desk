. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

function Assert-DeskRecoveryTest {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "Desk update recovery test failed: $Message" }
}

function New-DeskRecoveryCallLog {
    return New-Object System.Collections.Generic.List[string]
}

$sqlCalls = New-DeskRecoveryCallLog
$sqlFailure = Invoke-DeskUpdateRecovery `
    -DeploymentId "deploy-sql" -InstallAttempted $false -KeepFrozen $false `
    -MarkDeploymentFailed { $sqlCalls.Add("audit") | Out-Null; throw "audit SQL unavailable" } `
    -RollbackInstallation { throw "rollback must not run" } `
    -RestoreServices { $sqlCalls.Add("start") | Out-Null } `
    -PreserveFrozenServices { throw "freeze must not run" } `
    -VerifyLocalHealth { $sqlCalls.Add("health") | Out-Null } `
    -RestoreDrainControls { $sqlCalls.Add("resume") | Out-Null }
Assert-DeskRecoveryTest (($sqlCalls -join ",") -eq "audit,start,health,resume") "SQL audit failure blocked recovery"
Assert-DeskRecoveryTest ($sqlFailure.controls_restored -and $sqlFailure.errors.Count -eq 1) "SQL audit failure result"

$backupCalls = New-DeskRecoveryCallLog
$backupFailure = Invoke-DeskUpdateRecovery `
    -DeploymentId "" -InstallAttempted $false -KeepFrozen $false `
    -MarkDeploymentFailed { $backupCalls.Add("audit") | Out-Null } `
    -RollbackInstallation { $backupCalls.Add("rollback") | Out-Null } `
    -RestoreServices { $backupCalls.Add("start") | Out-Null } `
    -PreserveFrozenServices { $backupCalls.Add("freeze") | Out-Null } `
    -VerifyLocalHealth { $backupCalls.Add("health") | Out-Null } `
    -RestoreDrainControls { $backupCalls.Add("resume") | Out-Null }
Assert-DeskRecoveryTest (-not $backupFailure.recovery_attempted -and $backupCalls.Count -eq 0) "pre-drain backup failure ran recovery"

$drainCalls = New-DeskRecoveryCallLog
$drainFailure = Invoke-DeskUpdateRecovery `
    -DeploymentId "deploy-drain" -InstallAttempted $false -KeepFrozen $false `
    -MarkDeploymentFailed { $drainCalls.Add("audit") | Out-Null } `
    -RollbackInstallation { throw "rollback must not run" } `
    -RestoreServices { $drainCalls.Add("start") | Out-Null } `
    -PreserveFrozenServices { throw "freeze must not run" } `
    -VerifyLocalHealth { $drainCalls.Add("health") | Out-Null } `
    -RestoreDrainControls { $drainCalls.Add("resume") | Out-Null }
Assert-DeskRecoveryTest (($drainCalls -join ",") -eq "audit,start,health,resume") "drain failure recovery order"
Assert-DeskRecoveryTest $drainFailure.controls_restored "drain failure did not restore controls after health"

$canaryCalls = New-DeskRecoveryCallLog
$canaryFailure = Invoke-DeskUpdateRecovery `
    -DeploymentId "deploy-canary" -InstallAttempted $false -KeepFrozen $false `
    -MarkDeploymentFailed { $canaryCalls.Add("audit") | Out-Null } `
    -RollbackInstallation { throw "rollback must not run" } `
    -RestoreServices { $canaryCalls.Add("start") | Out-Null } `
    -PreserveFrozenServices { throw "freeze must not run" } `
    -VerifyLocalHealth { $canaryCalls.Add("health") | Out-Null; throw "schema incompatible" } `
    -RestoreDrainControls { $canaryCalls.Add("resume") | Out-Null }
Assert-DeskRecoveryTest (($canaryCalls -join ",") -eq "audit,start,health") "canary failure resumed without health"
Assert-DeskRecoveryTest (-not $canaryFailure.controls_restored) "canary failure bypassed safety drain"

$rollbackCalls = New-DeskRecoveryCallLog
$rollbackFailure = Invoke-DeskUpdateRecovery `
    -DeploymentId "deploy-rollback" -InstallAttempted $true -KeepFrozen $false `
    -MarkDeploymentFailed { $rollbackCalls.Add("audit") | Out-Null } `
    -RollbackInstallation { $rollbackCalls.Add("rollback") | Out-Null; throw "rollback failed" } `
    -RestoreServices { $rollbackCalls.Add("start") | Out-Null } `
    -PreserveFrozenServices { throw "freeze must not run" } `
    -VerifyLocalHealth { $rollbackCalls.Add("health") | Out-Null } `
    -RestoreDrainControls { $rollbackCalls.Add("resume") | Out-Null }
Assert-DeskRecoveryTest (($rollbackCalls -join ",") -eq "audit,rollback") "failed rollback allowed restart or resume"
Assert-DeskRecoveryTest (-not $rollbackFailure.health_verified) "failed rollback reported health"

$startCalls = New-DeskRecoveryCallLog
$startFailure = Invoke-DeskUpdateRecovery `
    -DeploymentId "deploy-start" -InstallAttempted $true -KeepFrozen $false `
    -MarkDeploymentFailed { $startCalls.Add("audit") | Out-Null } `
    -RollbackInstallation { $startCalls.Add("rollback") | Out-Null } `
    -RestoreServices { $startCalls.Add("start") | Out-Null; throw "one service did not start" } `
    -PreserveFrozenServices { throw "freeze must not run" } `
    -VerifyLocalHealth { $startCalls.Add("health") | Out-Null; throw "service set unhealthy" } `
    -RestoreDrainControls { $startCalls.Add("resume") | Out-Null }
Assert-DeskRecoveryTest (($startCalls -join ",") -eq "audit,rollback,start,health") "restart failure blocked independent health verification"
Assert-DeskRecoveryTest (-not $startFailure.health_verified -and -not $startFailure.controls_restored) "restart failure bypassed safety drain"
Assert-DeskRecoveryTest ($startFailure.errors.Count -eq 2) "restart and health failures were not both preserved"

$resumeCalls = New-DeskRecoveryCallLog
$resumeFailure = Invoke-DeskUpdateRecovery `
    -DeploymentId "deploy-resume" -InstallAttempted $true -KeepFrozen $false `
    -MarkDeploymentFailed { $resumeCalls.Add("audit") | Out-Null } `
    -RollbackInstallation { $resumeCalls.Add("rollback") | Out-Null } `
    -RestoreServices { $resumeCalls.Add("start") | Out-Null } `
    -PreserveFrozenServices { throw "freeze must not run" } `
    -VerifyLocalHealth { $resumeCalls.Add("health") | Out-Null } `
    -RestoreDrainControls { $resumeCalls.Add("resume") | Out-Null; throw "resume SQL unavailable" }
Assert-DeskRecoveryTest (($resumeCalls -join ",") -eq "audit,rollback,start,health,resume") "install recovery order"
Assert-DeskRecoveryTest ($resumeFailure.health_verified -and -not $resumeFailure.controls_restored) "resume failure did not remain drained"

$frozenCalls = New-DeskRecoveryCallLog
$frozenFailure = Invoke-DeskUpdateRecovery `
    -DeploymentId "deploy-frozen" -InstallAttempted $true -KeepFrozen $true `
    -MarkDeploymentFailed { $frozenCalls.Add("audit") | Out-Null } `
    -RollbackInstallation { $frozenCalls.Add("rollback") | Out-Null } `
    -RestoreServices { throw "standard restart must not run" } `
    -PreserveFrozenServices { $frozenCalls.Add("freeze") | Out-Null } `
    -VerifyLocalHealth { $frozenCalls.Add("health") | Out-Null } `
    -RestoreDrainControls { $frozenCalls.Add("complete-frozen") | Out-Null }
Assert-DeskRecoveryTest (($frozenCalls -join ",") -eq "audit,rollback,freeze,health,complete-frozen") "frozen recovery order"
Assert-DeskRecoveryTest $frozenFailure.controls_restored "frozen recovery did not preserve hold"

Write-Host "Desk update recovery failure matrix passed."
