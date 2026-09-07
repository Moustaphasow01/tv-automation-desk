param(
    [string]$InstallRoot = "C:\DeskFutures",
    [string]$DataRoot = "C:\ProgramData\DeskFutures"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")
$InstallRoot = Assert-DeskDeploymentPath -Path $InstallRoot -Label "InstallRoot"
$DataRoot = Assert-DeskDeploymentPath -Path $DataRoot -Label "DataRoot"
$node = "C:\Program Files\nodejs\node.exe"
$envFile = Join-Path $DataRoot "config\desk.env"
$script = Join-Path $InstallRoot "current\app\mcp_gpt_desk\scripts\refresh_usda_grains_calendar.mjs"
$outputRoot = Join-Path $DataRoot "objects\grains-calendar"
$statusFile = Join-Path $DataRoot "status\grains-calendar.json"
foreach ($required in @($node, $envFile, $script)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Grains calendar refresh dependency missing."
    }
}
# A database session lock also excludes manual CLI launches. No provider or trading action.
& $node --env-file=$envFile $script --output-root $outputRoot --status-file $statusFile
if ($LASTEXITCODE -ne 0) { throw "Grains calendar refresh failed; inspect status/grains-calendar.json." }
