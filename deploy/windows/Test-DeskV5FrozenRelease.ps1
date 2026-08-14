param(
    [string]$InstallRoot = "C:\DeskFutures",
    [string]$DataRoot = "C:\ProgramData\DeskFutures",
    [string]$VerifierRoot = "",
    [string]$NodeExecutable = "",
    [switch]$FreezeOnly,
    [switch]$AllowUnlockedBroker
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

$InstallRoot = Assert-DeskDeploymentPath -Path $InstallRoot -Label "InstallRoot"
$DataRoot = Assert-DeskDeploymentPath -Path $DataRoot -Label "DataRoot"
$node = Resolve-DeskExecutable -Name "node.exe" -ExplicitPath $NodeExecutable
$VerifierRoot = if ($VerifierRoot) {
    Assert-DeskDeploymentPath -Path $VerifierRoot -Label "VerifierRoot"
} else { Join-Path $InstallRoot "current" }
$envFile = Join-Path $DataRoot "config\desk.env"
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
    throw "Desk environment is missing: $envFile"
}
$envValues = Read-DeskEnvFile $envFile
if ($envValues["DESK_RUNTIME_PROFILE"] -ne "deterministic_strategy_v5_frozen" -or $envValues["DESK_AI_WORKER_MODE"] -ne "disabled") {
    throw "Strict freeze environment profile is not persisted in desk.env."
}


$failures = @()
$services = @()
foreach ($serviceName in @(
    "DeskFuturesLiveRuntime",
    "DeskFuturesReplayPreparation",
    "DeskFuturesBrokerManagement",
    "DeskFuturesAgentRuntimeSupervisor",
    "DeskFuturesAgentRuntimeResearch",
    "DeskFuturesCodexLive01",
    "DeskFuturesCodexLive02",
    "DeskFuturesCodexReplay01"
)) {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    $status = if ($service) { [string]$service.Status } else { "Missing" }
    $startType = if ($service) { [string]$service.StartType } else { "Missing" }
    $services += [ordered]@{
        name = $serviceName
        status = $status
        start_type = $startType
    }
    if ($status -ne "Stopped" -or $startType -ne "Disabled") {
        $failures += "$serviceName=$status/$startType"
    }
}
if ($failures.Count -gt 0) {
    throw "Strict freeze service check failed: $($failures -join ', ')"
}

$script = Join-Path $VerifierRoot "app\mcp_gpt_desk\scripts\verify_v5_frozen_state.mjs"
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
    throw "Frozen state verifier is missing: $script"
}
$arguments = @("--env-file=$envFile", $script)
if ($FreezeOnly) { $arguments += "--freeze-only" }
if (-not $AllowUnlockedBroker) { $arguments += "--require-broker-lock" }
& $node @arguments
if ($LASTEXITCODE -ne 0) { throw "Desk database freeze verification failed." }

$receipt = [ordered]@{
    ok = $true
    schema = "desk_v5_frozen_release_check_v1"
    checked_at_utc = [DateTime]::UtcNow.ToString("o")
    mode = if ($FreezeOnly) { "freeze_only" } else { "v5_release" }
    services = $services
}
Write-Output ($receipt | ConvertTo-Json -Depth 6)
