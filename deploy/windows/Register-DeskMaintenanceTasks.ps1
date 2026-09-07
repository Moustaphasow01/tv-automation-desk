param(
    [string]$InstallRoot = "C:\DeskFutures",
    [string]$DataRoot = "C:\ProgramData\DeskFutures",
    [string]$PostgresBin = "",
    [switch]$ProducerTasksInitiallyDisabled
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

$InstallRoot = Assert-DeskDeploymentPath -Path $InstallRoot -Label "InstallRoot"
$DataRoot = Assert-DeskDeploymentPath -Path $DataRoot -Label "DataRoot"
$maintenanceFile = Join-Path $DataRoot "config\maintenance.env"
if (-not (Test-Path -LiteralPath $maintenanceFile)) {
    throw "Desk maintenance environment missing: $maintenanceFile"
}
$powerShell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)

$healthScript = Join-Path $InstallRoot "current\deploy\windows\Test-DeskLocalHealth.ps1"
$healthAction = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$healthScript`" -DataRoot `"$DataRoot`""
$healthTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName "DeskFutures-Health" -Action $healthAction -Trigger $healthTrigger -Principal $principal -Settings $settings -Force | Out-Null

$runtimeMaintenanceScript = Join-Path $InstallRoot "current\deploy\windows\Invoke-DeskRuntimeMaintenance.ps1"
$runtimeMaintenanceAction = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runtimeMaintenanceScript`" -InstallRoot `"$InstallRoot`" -DataRoot `"$DataRoot`""
$runtimeMaintenanceTrigger = New-ScheduledTaskTrigger -Daily -At "03:00"
Register-ScheduledTask -TaskName "DeskFutures-RuntimeMaintenance" -Action $runtimeMaintenanceAction -Trigger $runtimeMaintenanceTrigger -Principal $principal -Settings $settings -Force | Out-Null

$backupScript = Join-Path $InstallRoot "current\deploy\windows\Invoke-DeskScheduledBackup.ps1"
$backupAction = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backupScript`" -DataRoot `"$DataRoot`" -PostgresBin `"$PostgresBin`""
$backupTrigger = New-ScheduledTaskTrigger -Daily -At "02:15"
Register-ScheduledTask -TaskName "DeskFutures-Backup" -Action $backupAction -Trigger $backupTrigger -Principal $principal -Settings $settings -Force | Out-Null

$objectBackupScript = Join-Path $InstallRoot "current\deploy\windows\Invoke-DeskScheduledObjectBackup.ps1"
$objectBackupAction = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$objectBackupScript`" -DataRoot `"$DataRoot`""
$objectBackupTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday -At "03:30"
Register-ScheduledTask -TaskName "DeskFutures-ObjectBackup" -Action $objectBackupAction -Trigger $objectBackupTrigger -Principal $principal -Settings $settings -Force | Out-Null

$verifyScript = Join-Path $InstallRoot "current\deploy\windows\Invoke-DeskBackupVerification.ps1"
$verifyAction = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$verifyScript`" -DataRoot `"$DataRoot`" -PostgresBin `"$PostgresBin`""
$verifyTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "04:00"
Register-ScheduledTask -TaskName "DeskFutures-BackupVerify" -Action $verifyAction -Trigger $verifyTrigger -Principal $principal -Settings $settings -Force | Out-Null

$grainsRuntimeScript = Join-Path $InstallRoot "current\deploy\windows\Run-UsGrainsShadowRuntime.ps1"
$grainsRuntimeAction = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$grainsRuntimeScript`" -InstallRoot `"$InstallRoot`" -DataRoot `"$DataRoot`""
$grainsRuntimeTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$grainsRuntimeSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -Disable:$ProducerTasksInitiallyDisabled
Register-ScheduledTask -TaskName "DeskFutures-UsGrainsShadowRuntime" -Action $grainsRuntimeAction -Trigger $grainsRuntimeTrigger -Principal $principal -Settings $grainsRuntimeSettings -Force | Out-Null
if (Get-ScheduledTask -TaskName "DeskFuturesUsGrainsShadowRuntime" -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName "DeskFuturesUsGrainsShadowRuntime" -Confirm:$false
}

$calendarScript = Join-Path $InstallRoot "current\deploy\windows\Run-GrainsCalendarRefresh.ps1"
$calendarAction = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$calendarScript`" -InstallRoot `"$InstallRoot`" -DataRoot `"$DataRoot`""
$calendarTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 30)
$calendarSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -Disable:$ProducerTasksInitiallyDisabled
Register-ScheduledTask -TaskName "DeskFutures-GrainsCalendarRefresh" -Action $calendarAction -Trigger $calendarTrigger -Principal $principal -Settings $calendarSettings -Force | Out-Null

Write-Host "Desk maintenance tasks registered: health, runtime retention, database/object backup, backup verification, US grains shadow runtime, grains calendar refresh."
