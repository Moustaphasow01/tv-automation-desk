param(
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [Parameter(Mandatory = $true)][string]$DataRoot,
    [Parameter(Mandatory = $true)][string]$Domain,
    [Parameter(Mandatory = $true)][string]$TlsEmail,
    [Parameter(Mandatory = $true)][string]$WinSwExecutable,
    [Parameter(Mandatory = $true)][string]$CaddyExecutable,
    [string]$NodeExecutable = "",
    [string]$CodexExecutable = "codex",
    [ValidateSet("disabled", "shadow", "active")][string]$AiWorkerMode = "shadow",
    [string]$PostgresServiceName = "postgresql-x64-16",
    [switch]$KeepAiWorkersDisabled,
    [switch]$SkipStart
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

$InstallRoot = Assert-DeskDeploymentPath -Path $InstallRoot -Label "InstallRoot"
$DataRoot = Assert-DeskDeploymentPath -Path $DataRoot -Label "DataRoot"
$winsw = Resolve-DeskExecutable -Name "WinSW.exe" -ExplicitPath $WinSwExecutable
$caddy = Resolve-DeskExecutable -Name "caddy.exe" -ExplicitPath $CaddyExecutable
$node = Resolve-DeskExecutable -Name "node.exe" -ExplicitPath $NodeExecutable
$serviceRoot = Join-Path $DataRoot "services"
$logRoot = Join-Path $DataRoot "logs"
$binRoot = Join-Path $DataRoot "bin"
$codexHome = Join-Path $DataRoot "codex"
$envFile = Join-Path $DataRoot "config\desk.env"
New-Item -ItemType Directory -Path $serviceRoot, $logRoot, $binRoot, $codexHome -Force | Out-Null
if (-not (Test-Path -LiteralPath $envFile)) { throw "Desk environment file missing: $envFile" }

function Copy-DeskServiceExecutable {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    $sourcePath = [System.IO.Path]::GetFullPath($Source)
    $destinationPath = [System.IO.Path]::GetFullPath($Destination)
    if (
        -not [string]::Equals(
            $sourcePath,
            $destinationPath,
            [System.StringComparison]::OrdinalIgnoreCase
        )
    ) {
        Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
    }
}

Copy-DeskServiceExecutable `
    -Source $caddy `
    -Destination (Join-Path $binRoot "caddy.exe")

$replacements = [ordered]@{
    "__NODE_EXE__" = $node
    "__ENV_FILE__" = $envFile
    "__INSTALL_ROOT__" = $InstallRoot
    "__LOG_ROOT__" = $logRoot
    "__POSTGRES_SERVICE__" = $PostgresServiceName
    "__CADDY_EXE__" = (Join-Path $binRoot "caddy.exe")
    "__DESK_DOMAIN__" = $Domain
    "__TLS_EMAIL__" = $TlsEmail
    "__CODEX_EXE__" = $CodexExecutable
    "__CODEX_HOME__" = $codexHome
    "__AI_WORKER_MODE__" = $AiWorkerMode
    "__AGENT_SUPERVISOR_MODE__" = "shadow"
}

$templates = @(
    "DeskApi",
    "DeskLiveRuntime",
    "DeskReplayPreparation",
    "DeskBrokerManagement",
    "DeskTelegram",
    "DeskAgentRuntimeSupervisor",
    "DeskAgentRuntimeResearch",
    "DeskCodexLive01",
    "DeskCodexLive02",
    "DeskCodexReplay01",
    "DeskCaddy"
)
foreach ($name in $templates) {
    $template = Join-Path $InstallRoot "current\deploy\windows\services\$name.xml.template"
    if (-not (Test-Path -LiteralPath $template)) { throw "Service template missing: $template" }
    $wrapper = Join-Path $serviceRoot "$name.exe"
    $xmlPath = Join-Path $serviceRoot "$name.xml"
    Copy-DeskServiceExecutable -Source $winsw -Destination $wrapper
    $xml = Get-Content -LiteralPath $template -Raw
    foreach ($replacement in $replacements.GetEnumerator()) {
        $xml = $xml.Replace($replacement.Key, $replacement.Value)
    }
    [System.IO.File]::WriteAllText($xmlPath, $xml, [System.Text.UTF8Encoding]::new($false))
    & $wrapper stop 2>$null
    & $wrapper uninstall 2>$null
    Invoke-DeskCommand -FilePath $wrapper -Arguments @("install")
}

if ($KeepAiWorkersDisabled) {
    foreach ($serviceName in @(
        "DeskFuturesCodexLive01",
        "DeskFuturesLiveRuntime",
        "DeskFuturesReplayPreparation",
        "DeskFuturesBrokerManagement",
        "DeskFuturesAgentRuntimeSupervisor",
        "DeskFuturesAgentRuntimeResearch",
        "DeskFuturesCodexLive02",
        "DeskFuturesCodexReplay01"
    )) {
        $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
        if (-not $service) { throw "Frozen Windows service is missing after install: $serviceName" }
        if ($service.Status -ne "Stopped") { Stop-Service -Name $serviceName -Force }
        Set-Service -Name $serviceName -StartupType Disabled
    }
}

if (-not $SkipStart) { Start-DeskServices }
Write-Host "Desk Windows services installed."
