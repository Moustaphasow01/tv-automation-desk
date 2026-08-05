param(
    [string]$DataRoot = "C:\ProgramData\DeskFutures",
    [int]$ApiPort = 8787,
    [int]$TimeoutSeconds = 90,
    [switch]$AllowDisabledAiWorkers
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

$ErrorActionPreference = "Stop"
$envFile = Join-Path $DataRoot "config\desk.env"
$isFrozenRuntime = $false
if (Test-Path -LiteralPath $envFile -PathType Leaf) {
    $envValues = Read-DeskEnvFile $envFile
    if ($envValues["DESK_RUNTIME_PROFILE"] -eq "deterministic_strategy_v5_frozen") {
        $isFrozenRuntime = $true
    }
    if ($isFrozenRuntime -or $envValues["DESK_AI_WORKER_MODE"] -eq "disabled") {
        $AllowDisabledAiWorkers = $true
    }
}
$statusRoot = Join-Path $DataRoot "status"
New-Item -ItemType Directory -Path $statusRoot -Force | Out-Null
$services = @(
    "DeskFuturesApi",
    "DeskFuturesLiveRuntime",
    "DeskFuturesReplayPreparation",
    "DeskFuturesBrokerManagement",
    "DeskFuturesTelegram",
    "DeskFuturesCodexLive01",
    "DeskFuturesCodexLive02",
    "DeskFuturesCodexReplay01",
    "DeskFuturesCaddy"
)
$aiServices = @(
    "DeskFuturesCodexLive01",
    "DeskFuturesCodexLive02",
    "DeskFuturesCodexReplay01"
)
$disabledServices = if ($isFrozenRuntime) {
    @(
        "DeskFuturesLiveRuntime",
        "DeskFuturesReplayPreparation",
        "DeskFuturesBrokerManagement",
        "DeskFuturesCodexLive01",
        "DeskFuturesCodexLive02",
        "DeskFuturesCodexReplay01"
    )
} elseif ($AllowDisabledAiWorkers) { $aiServices } else { @() }
$deadline = (Get-Date).ToUniversalTime().AddSeconds([Math]::Max(15, $TimeoutSeconds))
$serviceStates = @()
$api = $null
$failures = @()
do {
    $serviceStates = @()
    $failures = @()
    foreach ($name in $services) {
        $service = Get-Service -Name $name -ErrorAction SilentlyContinue
        $state = if ($service) { [string]$service.Status } else { "Missing" }
        $startType = if ($service) { [string]$service.StartType } else { "Missing" }
        $serviceStates += [ordered]@{ name = $name; status = $state; start_type = $startType }
        if ($name -in $disabledServices) {
            if ($state -ne "Stopped" -or $startType -ne "Disabled") {
                $failures += "$name=$state/$startType"
            }
        } elseif ($state -ne "Running") {
            $failures += "$name=$state"
        }
    }
    try {
        $api = Invoke-RestMethod -Uri "http://127.0.0.1:$ApiPort/readyz" -TimeoutSec 5
        if ($api.ok -ne $true -or $api.ready -ne $true) { $failures += "api_not_ready" }
    } catch {
        $api = $null
        $failures += "api_unreachable"
    }
    if ($failures.Count -eq 0) { break }
    Start-Sleep -Seconds 2
} while ((Get-Date).ToUniversalTime() -lt $deadline)

$ninjaStatusPath = Join-Path $DataRoot "ninjatrader-control\supervisor-status.json"
$ninja = $null
if (Test-Path -LiteralPath $ninjaStatusPath) {
    try { $ninja = Get-Content -LiteralPath $ninjaStatusPath -Raw | ConvertFrom-Json } catch { $failures += "ninja_status_invalid" }
}

$payload = [ordered]@{
    schema = "desk_local_health_v1"
    ok = $failures.Count -eq 0
    checked_at_utc = (Get-Date).ToUniversalTime().ToString("o")
    services = $serviceStates
    api = $api
    ninja = $ninja
    failures = $failures
}
$temporary = Join-Path $statusRoot ("health-" + [guid]::NewGuid().ToString("N") + ".tmp")
$destination = Join-Path $statusRoot "health.json"
$payload | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $temporary -Encoding UTF8
Move-Item -LiteralPath $temporary -Destination $destination -Force
if ($failures.Count -gt 0) { throw "Desk health failed: $($failures -join ', ')" }
Write-Host "Desk local health passed."
