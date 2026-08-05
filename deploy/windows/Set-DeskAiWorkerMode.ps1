param(
    [ValidateSet("Live01", "Live02", "Replay01", "All")]
    [string]$Target = "All",
    [ValidateSet("disabled", "shadow", "active")]
    [string]$Mode = "shadow",
    [string]$DataRoot = "C:\ProgramData\DeskFutures"
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

$DataRoot = Assert-DeskDeploymentPath -Path $DataRoot -Label "DataRoot"
$serviceRoot = Join-Path $DataRoot "services"
$stateRoot = Join-Path $DataRoot "state"
New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null

$targets = [ordered]@{
    "Live01" = @{
        Service = "DeskFuturesCodexLive01"
        Config = "DeskCodexLive01.xml"
    }
    "Live02" = @{
        Service = "DeskFuturesCodexLive02"
        Config = "DeskCodexLive02.xml"
    }
    "Replay01" = @{
        Service = "DeskFuturesCodexReplay01"
        Config = "DeskCodexReplay01.xml"
    }
}

$selected = if ($Target -eq "All") {
    @($targets.Keys)
} else {
    @($Target)
}

function Get-DeskServiceEnvironmentValue {
    param(
        [Parameter(Mandatory = $true)][xml]$Config,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $entry = @($Config.service.env) | Where-Object { [string]$_.name -eq $Name } | Select-Object -First 1
    if (-not $entry) { throw "Service environment entry '$Name' is missing." }
    return [string]$entry.value
}

function Set-DeskServiceEnvironmentValue {
    param(
        [Parameter(Mandatory = $true)][xml]$Config,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )

    $entry = @($Config.service.env) | Where-Object { [string]$_.name -eq $Name } | Select-Object -First 1
    if (-not $entry) { throw "Service environment entry '$Name' is missing." }
    $entry.value = $Value
}

$configs = @()
foreach ($key in $selected) {
    $definition = $targets[$key]
    $configPath = Join-Path $serviceRoot $definition.Config
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
        throw "Codex service configuration is missing: $configPath"
    }
    $service = Get-Service -Name $definition.Service -ErrorAction SilentlyContinue
    if (-not $service) { throw "Codex Windows service is not installed: $($definition.Service)" }
    [xml]$config = Get-Content -LiteralPath $configPath -Raw
    $configs += @{
        Key = $key
        Definition = $definition
        Path = $configPath
        Xml = $config
    }
}

if ($Mode -eq "active") {
    $sample = $configs[0].Xml
    $codexExecutable = Get-DeskServiceEnvironmentValue -Config $sample -Name "DESK_CODEX_BIN"
    $codexHome = Get-DeskServiceEnvironmentValue -Config $sample -Name "CODEX_HOME"
    $codex = Resolve-DeskExecutable -Name "codex.cmd" -ExplicitPath $codexExecutable
    if (-not (Test-Path -LiteralPath $codexHome -PathType Container)) {
        throw "Service-owned CODEX_HOME is missing: $codexHome"
    }

    $previousCodexHome = $env:CODEX_HOME
    try {
        $env:CODEX_HOME = $codexHome
        Invoke-DeskCommand -FilePath $codex -Arguments @("--version")
        Invoke-DeskCommand -FilePath $codex -Arguments @("login", "status")
    } finally {
        $env:CODEX_HOME = $previousCodexHome
    }
}

$changed = @()
foreach ($item in $configs) {
    Set-DeskServiceEnvironmentValue -Config $item.Xml -Name "DESK_AI_WORKER_MODE" -Value $Mode
    [System.IO.File]::WriteAllText(
        $item.Path,
        $item.Xml.OuterXml,
        [System.Text.UTF8Encoding]::new($false)
    )

    $serviceName = $item.Definition.Service
    if ($Mode -eq "disabled") {
        $service = Get-Service -Name $serviceName
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
    $changed += @{
        target = $item.Key
        service = $serviceName
        mode = $Mode
        status = [string](Get-Service -Name $serviceName).Status
        start_type = [string](Get-Service -Name $serviceName).StartType
    }
}

$receipt = [ordered]@{
    schema = "desk_ai_worker_mode_change_v1"
    changed_at_utc = [DateTime]::UtcNow.ToString("o")
    operator = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    target = $Target
    mode = $Mode
    services = $changed
}
$receiptPath = Join-Path $stateRoot ("codex-worker-mode-{0}.json" -f [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss"))
[System.IO.File]::WriteAllText(
    $receiptPath,
    ($receipt | ConvertTo-Json -Depth 6),
    [System.Text.UTF8Encoding]::new($false)
)

Write-Host "Codex worker mode applied: target=$Target mode=$Mode"
Write-Host "Receipt: $receiptPath"
