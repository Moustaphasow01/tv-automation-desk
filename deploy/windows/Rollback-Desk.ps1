param(
    [string]$InstallRoot = "C:\DeskFutures",
    [string]$DataRoot = "C:\ProgramData\DeskFutures",
    [string]$TargetVersion = "",
    [switch]$SkipStart
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

$InstallRoot = Assert-DeskDeploymentPath -Path $InstallRoot -Label "InstallRoot"
if ($TargetVersion) {
    if ($TargetVersion -notmatch "^[a-zA-Z0-9._-]+$") { throw "TargetVersion contains unsupported characters." }
    $target = Join-Path $InstallRoot "releases\$TargetVersion"
} else {
    $previousFile = Join-Path $InstallRoot "previous-release.txt"
    if (-not (Test-Path -LiteralPath $previousFile)) { throw "No previous release is recorded." }
    $target = (Get-Content -LiteralPath $previousFile -Raw).Trim()
}
$target = Assert-DeskDeploymentPath -Path $target -Label "TargetRelease"
if (-not (Test-Path -LiteralPath (Join-Path $target "release-manifest.json"))) { throw "Target release is invalid: $target" }
$DataRoot = Assert-DeskDeploymentPath -Path $DataRoot -Label "DataRoot"
$envFile = Join-Path $DataRoot "config\desk.env"
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { throw "Desk environment is missing: $envFile" }

& (Join-Path $PSScriptRoot "Test-DeskRelease.ps1") -ReleaseRoot $target
$manifest = Get-Content -LiteralPath (Join-Path $target "release-manifest.json") -Raw | ConvertFrom-Json
Stop-DeskServices
Set-DeskCurrentJunction -InstallRoot $InstallRoot -ReleaseRoot $target
$envContent = Get-Content -LiteralPath $envFile -Raw
$envContent = [regex]::Replace($envContent, "(?m)^DESK_RELEASE_VERSION=.*$", "DESK_RELEASE_VERSION=$($manifest.version)")
[System.IO.File]::WriteAllText($envFile, $envContent, [System.Text.UTF8Encoding]::new($false))
$targetAiWorker = Join-Path $target "app\mcp_gpt_desk\scripts\run_desk_ai_worker.mjs"
if (-not (Test-Path -LiteralPath $targetAiWorker -PathType Leaf)) {
    foreach ($serviceName in @("DeskFuturesCodexLive01", "DeskFuturesCodexLive02", "DeskFuturesCodexReplay01")) {
        $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
        if ($service) {
            Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
            Set-Service -Name $serviceName -StartupType Disabled
        }
    }
    $legacyExpected = "live_runtime_scheduler,replay_preparation_worker,broker_management,telegram_alert_worker"
    $envContent = Get-Content -LiteralPath $envFile -Raw
    $envContent = [regex]::Replace(
        $envContent,
        "(?m)^DESK_EXPECTED_SERVICE_IDS=.*$",
        "DESK_EXPECTED_SERVICE_IDS=$legacyExpected"
    )
    [System.IO.File]::WriteAllText($envFile, $envContent, [System.Text.UTF8Encoding]::new($false))
}
if (-not $SkipStart) { Start-DeskServices }
Write-Host "Desk code rolled back to $($manifest.version). PostgreSQL migrations are forward-only and were not reverted."
