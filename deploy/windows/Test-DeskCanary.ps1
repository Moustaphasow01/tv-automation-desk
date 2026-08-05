param(
    [Parameter(Mandatory = $true)][string]$ReleaseRoot,
    [Parameter(Mandatory = $true)][string]$EnvFile,
    [string]$NodeExecutable = "",
    [int]$Port = 18787,
    [int]$TimeoutSeconds = 30
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

$node = Resolve-DeskExecutable -Name "node.exe" -ExplicitPath $NodeExecutable
$server = Join-Path $ReleaseRoot "app\mcp_gpt_desk\src\server.js"
if (-not (Test-Path -LiteralPath $server -PathType Leaf)) { throw "Canary server missing: $server" }
if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) { throw "Canary environment missing: $EnvFile" }

$overrides = [ordered]@{
    "DESK_PUBLIC_MODE" = "false"
    "DESK_BIND_HOST" = "127.0.0.1"
    "PORT" = [string]$Port
    "DESK_SERVICE_ROLE" = "front"
    # The pre-switch canary runs before the target-only worker service is
    # installed. Validate the dependencies already expected to be alive, then
    # let the post-switch health check require ReplayPreparation as well.
    "DESK_EXPECTED_SERVICE_IDS" = "live_runtime_scheduler,broker_management,telegram_alert_worker"
    "DESK_OBSERVABILITY_INCIDENT_EVALUATION_MS" = "0"
    "DESK_REPLAY_PREPARATION_POLL_MS" = "0"
    "DESK_PREWARM_OPERATIONS_SUMMARY" = "false"
}
$previous = @{}
foreach ($entry in $overrides.GetEnumerator()) {
    $previous[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, "Process")
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
}

$process = $null
try {
    $process = Start-Process -FilePath $node -ArgumentList @("--env-file=$EnvFile", $server) `
        -WorkingDirectory (Split-Path $server -Parent) -WindowStyle Hidden -PassThru
    $deadline = (Get-Date).ToUniversalTime().AddSeconds([Math]::Max(10, $TimeoutSeconds))
    do {
        if ($process.HasExited) { throw "Canary process exited with code $($process.ExitCode)." }
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/readyz" -TimeoutSec 3
            if ($health.ready -eq $true -and $health.ok -eq $true) {
                Write-Host "Canary passed on loopback port $Port."
                return
            }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    } while ((Get-Date).ToUniversalTime() -lt $deadline)
    throw "Canary did not become ready within $TimeoutSeconds seconds."
} finally {
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        [void]$process.WaitForExit(5000)
    }
    foreach ($entry in $previous.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
    }
}
