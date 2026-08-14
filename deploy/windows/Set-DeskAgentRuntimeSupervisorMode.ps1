param(
    [ValidateSet("disabled", "shadow", "active")]
    [string]$Mode = "shadow",
    [string]$DataRoot = "C:\ProgramData\DeskFutures"
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

$DataRoot = Assert-DeskDeploymentPath -Path $DataRoot -Label "DataRoot"
$serviceRoot = Join-Path $DataRoot "services"
$stateRoot = Join-Path $DataRoot "state"
$serviceName = "DeskFuturesAgentRuntimeSupervisor"
$configPath = Join-Path $serviceRoot "DeskAgentRuntimeSupervisor.xml"
New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null

if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw "Agent Runtime Supervisor service configuration is missing: $configPath"
}
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if (-not $service) { throw "Agent Runtime Supervisor Windows service is not installed: $serviceName" }

[xml]$config = Get-Content -LiteralPath $configPath -Raw

function Get-ServiceEnvValue {
    param([Parameter(Mandatory = $true)][string]$Name)
    $entry = @($config.service.env) | Where-Object { [string]$_.name -eq $Name } | Select-Object -First 1
    if (-not $entry) { return "" }
    return [string]$entry.value
}

function Set-ServiceEnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )
    $entry = @($config.service.env) | Where-Object { [string]$_.name -eq $Name } | Select-Object -First 1
    if (-not $entry) { throw "Service environment entry '$Name' is missing." }
    $entry.value = $Value
}

if ($Mode -eq "active" -and -not (Get-ServiceEnvValue -Name "DESK_AGENT_SUPERVISOR_RUNNER_COMMAND")) {
    throw "DESK_AGENT_SUPERVISOR_RUNNER_COMMAND must be configured before active mode."
}

Set-ServiceEnvValue -Name "DESK_AGENT_SUPERVISOR_MODE" -Value $Mode
[System.IO.File]::WriteAllText($configPath, $config.OuterXml, [System.Text.UTF8Encoding]::new($false))

if ($Mode -eq "disabled") {
    if ($service.Status -ne "Stopped") {
        Stop-Service -Name $serviceName -Force
        $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
    }
    Set-Service -Name $serviceName -StartupType Disabled
} else {
    Set-Service -Name $serviceName -StartupType Automatic
    Restart-Service -Name $serviceName -Force
    (Get-Service -Name $serviceName).WaitForStatus("Running", [TimeSpan]::FromSeconds(30))
}

$receipt = [ordered]@{
    schema = "desk_agent_runtime_supervisor_mode_change_v1"
    changed_at_utc = [DateTime]::UtcNow.ToString("o")
    operator = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    mode = $Mode
    service = $serviceName
    status = [string](Get-Service -Name $serviceName).Status
}
$receiptPath = Join-Path $stateRoot ("agent-runtime-supervisor-mode-{0}.json" -f [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss"))
[System.IO.File]::WriteAllText($receiptPath, ($receipt | ConvertTo-Json -Depth 6), [System.Text.UTF8Encoding]::new($false))

Write-Host "Agent Runtime Supervisor mode applied: mode=$Mode"
Write-Host "Receipt: $receiptPath"
