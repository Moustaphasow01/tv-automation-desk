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
$grainsCalendarPolicy = "disabled"
if (Test-Path -LiteralPath $envFile -PathType Leaf) {
    $envValues = Read-DeskEnvFile $envFile
    if ($envValues["DESK_RUNTIME_PROFILE"] -eq "deterministic_strategy_v5_frozen") {
        $isFrozenRuntime = $true
    }
    if ($isFrozenRuntime -or $envValues["DESK_AI_WORKER_MODE"] -eq "disabled") {
        $AllowDisabledAiWorkers = $true
    }
    if ($envValues.ContainsKey("DESK_GRAINS_CALENDAR_ENABLED")) {
        $configuredCalendarPolicy = [string]$envValues["DESK_GRAINS_CALENDAR_ENABLED"]
        if ($configuredCalendarPolicy -ceq "true") {
            $grainsCalendarPolicy = "enabled"
        } elseif ($configuredCalendarPolicy -cne "false") {
            $grainsCalendarPolicy = "invalid"
        }
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
    "DeskFuturesAgentRuntimeSupervisor",
    "DeskFuturesAgentRuntimeResearch",
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
        "DeskFuturesAgentRuntimeSupervisor",
        "DeskFuturesAgentRuntimeResearch",
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

$grainsStatusPath = Join-Path $statusRoot "grains-calendar.json"
$grainsStatus = $null
if (Test-Path -LiteralPath $grainsStatusPath -PathType Leaf) {
    try {
        $grainsStatus = Get-Content -LiteralPath $grainsStatusPath -Raw | ConvertFrom-Json
    } catch {
        $grainsStatus = [pscustomobject]@{ status = "INVALID_JSON" }
    }
}
$grainsCalendar = Get-DeskGrainsCalendarDiagnostic `
    -Policy $grainsCalendarPolicy `
    -StatusDocument $grainsStatus `
    -NowUtc (Get-Date).ToUniversalTime() `
    -MaxCadenceMinutes 60
$degradations = @($grainsCalendar.reason_codes)

$payload = [ordered]@{
    schema = "desk_local_health_v1"
    ok = $failures.Count -eq 0
    checked_at_utc = (Get-Date).ToUniversalTime().ToString("o")
    services = $serviceStates
    api = $api
    ninja = $ninja
    degraded = $degradations.Count -gt 0
    grains_calendar = $grainsCalendar
    degradations = $degradations
    failures = $failures
}
$temporary = Join-Path $statusRoot ("health-" + [guid]::NewGuid().ToString("N") + ".tmp")
$destination = Join-Path $statusRoot "health.json"
$payload | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $temporary -Encoding UTF8
Move-Item -LiteralPath $temporary -Destination $destination -Force
if ($failures.Count -gt 0) { throw "Desk health failed: $($failures -join ', ')" }
if ($degradations.Count -gt 0) {
    Write-Host "Desk local health passed with non-blocking degradations: $($degradations -join ', ')"
} else {
    Write-Host "Desk local health passed."
}
