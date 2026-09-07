$global:DeskScheduledTaskTestTasks = @{
    "DeskFutures-UsGrainsShadowRuntime" = @{ Enabled = $true; State = "Running" }
    "DeskFutures-GrainsCalendarRefresh" = @{ Enabled = $false; State = "Disabled" }
}
$global:DeskScheduledTaskTestCalls = New-Object System.Collections.Generic.List[string]
$global:DeskScheduledTaskTestRegistrations = @{}

function Get-ScheduledTask {
    param([string]$TaskName, [object]$ErrorAction)
    $entry = $global:DeskScheduledTaskTestTasks[$TaskName]
    if (-not $entry) { return $null }
    return [pscustomobject]@{
        TaskName = $TaskName
        State = $entry.State
        Settings = [pscustomobject]@{ Enabled = $entry.Enabled }
    }
}

function Disable-ScheduledTask {
    param([string]$TaskName)
    $global:DeskScheduledTaskTestCalls.Add("disable:$TaskName") | Out-Null
    $global:DeskScheduledTaskTestTasks[$TaskName].Enabled = $false
    if ($global:DeskScheduledTaskTestTasks[$TaskName].State -ne "Running") { $global:DeskScheduledTaskTestTasks[$TaskName].State = "Disabled" }
}

function Stop-ScheduledTask {
    param([string]$TaskName)
    $global:DeskScheduledTaskTestCalls.Add("stop:$TaskName") | Out-Null
    $global:DeskScheduledTaskTestTasks[$TaskName].State = "Disabled"
}

function Enable-ScheduledTask {
    param([string]$TaskName)
    $global:DeskScheduledTaskTestCalls.Add("enable:$TaskName") | Out-Null
    $global:DeskScheduledTaskTestTasks[$TaskName].Enabled = $true
    $global:DeskScheduledTaskTestTasks[$TaskName].State = "Ready"
}

function New-ScheduledTaskPrincipal { return [pscustomobject]@{ Kind = "Principal" } }
function New-ScheduledTaskAction { return [pscustomobject]@{ Kind = "Action" } }
function New-ScheduledTaskTrigger { return [pscustomobject]@{ Kind = "Trigger" } }
function New-ScheduledTaskSettingsSet {
    param(
        [switch]$StartWhenAvailable,
        [string]$MultipleInstances,
        [timespan]$ExecutionTimeLimit,
        [switch]$Disable
    )
    return [pscustomobject]@{ Enabled = -not $Disable.IsPresent }
}
function Register-ScheduledTask {
    param(
        [string]$TaskName,
        [object]$Action,
        [object]$Trigger,
        [object]$Principal,
        [object]$Settings,
        [switch]$Force
    )
    $global:DeskScheduledTaskTestRegistrations[$TaskName] = $Settings
    $global:DeskScheduledTaskTestTasks[$TaskName] = @{
        Enabled = [bool]$Settings.Enabled
        State = $(if ($Settings.Enabled) { "Ready" } else { "Disabled" })
    }
}
function Unregister-ScheduledTask {
    param([string]$TaskName, [switch]$Confirm)
    $global:DeskScheduledTaskTestTasks.Remove($TaskName)
}

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

function Assert-DeskScheduledTaskTest {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "Desk producer scheduled task test failed: $Message" }
}

$initial = @(Get-DeskProducerScheduledTaskState)
Assert-DeskScheduledTaskTest ($initial.Count -eq 2) "snapshot count"
Assert-DeskScheduledTaskTest ($initial[0].enabled -and -not $initial[1].enabled) "snapshot enabled state"

Stop-DeskProducerScheduledTasks
Assert-DeskProducerScheduledTasksStopped
Assert-DeskScheduledTaskTest (-not $global:DeskScheduledTaskTestTasks["DeskFutures-UsGrainsShadowRuntime"].Enabled) "running task not disabled"
Assert-DeskScheduledTaskTest ($global:DeskScheduledTaskTestTasks["DeskFutures-UsGrainsShadowRuntime"].State -eq "Disabled") "running task not stopped"

# Installation must register producer tasks disabled so no trigger is armed before the update restores state.
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("desk-scheduled-task-test-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path (Join-Path $testRoot "data\config") -Force | Out-Null
Set-Content -LiteralPath (Join-Path $testRoot "data\config\maintenance.env") -Value "TEST=true"
& (Join-Path $PSScriptRoot "Register-DeskMaintenanceTasks.ps1") `
    -InstallRoot (Join-Path $testRoot "install") -DataRoot (Join-Path $testRoot "data") `
    -ProducerTasksInitiallyDisabled

Assert-DeskProducerScheduledTasksStopped
foreach ($name in @(Get-DeskProducerScheduledTaskNames)) {
    Assert-DeskScheduledTaskTest (-not $global:DeskScheduledTaskTestRegistrations[$name].Enabled) "producer task armed during installation: $name"
}

# A healthy standard success or rollback restores only the original enabled/disabled state.
Restore-DeskProducerScheduledTaskState -State $initial
Assert-DeskScheduledTaskTest ($global:DeskScheduledTaskTestTasks["DeskFutures-UsGrainsShadowRuntime"].Enabled) "original enabled state not restored"
Assert-DeskScheduledTaskTest ($global:DeskScheduledTaskTestTasks["DeskFutures-UsGrainsShadowRuntime"].State -eq "Ready") "restore started a task"
Assert-DeskScheduledTaskTest (-not $global:DeskScheduledTaskTestTasks["DeskFutures-GrainsCalendarRefresh"].Enabled) "original disabled state not preserved"
Assert-DeskScheduledTaskTest ($global:DeskScheduledTaskTestTasks["DeskFutures-GrainsCalendarRefresh"].State -eq "Disabled") "disabled task started"

# KeepFrozen re-registers but never restores either producer task.
& (Join-Path $PSScriptRoot "Register-DeskMaintenanceTasks.ps1") `
    -InstallRoot (Join-Path $testRoot "install") -DataRoot (Join-Path $testRoot "data") `
    -ProducerTasksInitiallyDisabled
Assert-DeskProducerScheduledTasksStopped

# An initially absent task is restored as disabled if the new release registers it.
$global:DeskScheduledTaskTestTasks.Remove("DeskFutures-GrainsCalendarRefresh")
$absentState = @(Get-DeskProducerScheduledTaskState)
& (Join-Path $PSScriptRoot "Register-DeskMaintenanceTasks.ps1") `
    -InstallRoot (Join-Path $testRoot "install") -DataRoot (Join-Path $testRoot "data") `
    -ProducerTasksInitiallyDisabled
Restore-DeskProducerScheduledTaskState -State $absentState
Assert-DeskScheduledTaskTest (-not $global:DeskScheduledTaskTestTasks["DeskFutures-GrainsCalendarRefresh"].Enabled) "initially absent task was enabled"

# The database hold remains authoritative while original task enablement is restored.
$updateSource = (Get-Content -LiteralPath (Join-Path $PSScriptRoot "Update-Desk.ps1") -Raw).Replace("`r`n", "`n")
$successStart = $updateSource.IndexOf('Test-DeskDeployment.ps1") -PublicBaseUrl')
$successEnd = $updateSource.IndexOf("if (`$KeepFrozen) {", $successStart)
$successBlock = $updateSource.Substring($successStart, $successEnd - $successStart)
$restoreIndex = $successBlock.IndexOf("Restore-DeskProducerScheduledTaskState")
$resumeIndex = $successBlock.IndexOf('Invoke-DeskDrain.ps1")')
Assert-DeskScheduledTaskTest ($restoreIndex -ge 0 -and $resumeIndex -gt $restoreIndex) "tasks not armed behind DRAIN before Resume"
$catchIndex = $updateSource.IndexOf("} catch {", $successEnd)
$recoveryIndex = $updateSource.IndexOf("Invoke-DeskUpdateRecovery", $catchIndex)
$stopIndex = $updateSource.IndexOf("Stop-DeskProducerScheduledTasks", $catchIndex)
Assert-DeskScheduledTaskTest ($stopIndex -gt $catchIndex -and $stopIndex -lt $recoveryIndex) "resume failure does not disable tasks before recovery"

Remove-Item -LiteralPath $testRoot -Recurse -Force
Remove-Variable DeskScheduledTaskTestTasks, DeskScheduledTaskTestCalls, DeskScheduledTaskTestRegistrations -Scope Global
Write-Host "Desk producer scheduled task state tests passed."
