param(
    [string]$DataRoot = "C:\ProgramData\DeskFutures",
    [string]$PostgresBin = ""
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

$maintenanceFile = Join-Path $DataRoot "config\maintenance.env"
if (-not (Test-Path -LiteralPath $maintenanceFile)) {
    throw "Desk maintenance environment missing: $maintenanceFile"
}
$values = Read-DeskEnvFile $maintenanceFile
$restoreUrl = $values["DESK_DB_RESTORE_URL"]
if (-not $restoreUrl) { throw "DESK_DB_RESTORE_URL is missing from the maintenance environment." }

& (Join-Path $PSScriptRoot "database\Test-DeskLatestBackup.ps1") `
    -BackupDirectory (Join-Path $DataRoot "backups") `
    -RestoreDatabaseUrl $restoreUrl `
    -PostgresBin $PostgresBin
