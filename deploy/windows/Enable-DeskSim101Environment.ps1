param(
    [string]$DataRoot = "C:\ProgramData\DeskFutures",
    [int]$MaxContracts = 10,
    [string]$AtmStrategyName = "TVA_SIM_SAFE_1X_320_400",
    [switch]$SkipServiceRestart
)

$ErrorActionPreference = "Stop"

$envFile = Join-Path $DataRoot "config\desk.env"
if (-not (Test-Path -LiteralPath $envFile)) {
    throw "Desk environment not found: $envFile"
}

$backupPath = "$envFile.before-sim101-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')).bak"
Copy-Item -LiteralPath $envFile -Destination $backupPath -Force

$values = [ordered]@{
    DESK_BROKER_EXECUTION_ENABLED = "true"
    DESK_BROKER_PROVIDER = "ninjatrader"
    DESK_NINJA_BRIDGE_MODE = "sim101_addon_approved_only"
    DESK_NINJA_REQUIRE_OPERATOR_APPROVAL = "false"
    DESK_NINJA_DEFAULT_ACCOUNT = "ninjatrader_paper_local"
    DESK_NINJA_ACCOUNT_ALLOWLIST = "ninjatrader_paper_local"
    DESK_NINJA_MAX_CONTRACTS = [string]$MaxContracts
    DESK_NINJA_ALLOWED_INSTRUMENTS = "MNQ,MES"
    DESK_NINJA_KILL_SWITCH = "false"
    DESK_NINJA_ORDER_TTL_SECONDS = "60"
    DESK_NINJA_BRIDGE_STALE_SECONDS = "30"
    DESK_NINJA_ACCOUNT_SNAPSHOT_STALE_SECONDS = "60"
    DESK_NINJA_ALLOW_LIVE_ACCOUNT = "false"
    DESK_NINJA_ACCOUNT_NAME = "Sim101"
    DESK_NINJA_BROKER_ACCOUNT_ID = "ninjatrader_paper_local"
    DESK_NINJA_ADDON_API_BASE_URL = "http://127.0.0.1:8787/api/v1"
    DESK_NINJA_ADDON_COMMANDS_ENABLED = "true"
    DESK_NINJA_ATM_STRATEGY_NAME = $AtmStrategyName
}

$lines = [System.Collections.Generic.List[string]]::new()
foreach ($line in [System.IO.File]::ReadAllLines($envFile)) {
    $separator = $line.IndexOf("=")
    if ($separator -gt 0) {
        $key = $line.Substring(0, $separator).Trim()
        if ($values.Contains($key)) {
            continue
        }
    }
    $lines.Add($line)
}
foreach ($entry in $values.GetEnumerator()) {
    $lines.Add("$($entry.Key)=$($entry.Value)")
}
[System.IO.File]::WriteAllLines(
    $envFile,
    $lines,
    [System.Text.UTF8Encoding]::new($false)
)

if (-not $SkipServiceRestart) {
    $serviceNames = @(
        "DeskFuturesApi",
        "DeskFuturesBrokerManagement",
        "DeskFuturesLiveRuntime"
    )
    foreach ($serviceName in $serviceNames) {
        Restart-Service -Name $serviceName -Force
    }
    foreach ($serviceName in $serviceNames) {
        $service = Get-Service -Name $serviceName
        $service.WaitForStatus(
            [System.ServiceProcess.ServiceControllerStatus]::Running,
            [TimeSpan]::FromSeconds(30)
        )
    }
}

[pscustomobject]@{
    BackupPath = $backupPath
    ExecutionEnabled = $values.DESK_BROKER_EXECUTION_ENABLED
    BridgeMode = $values.DESK_NINJA_BRIDGE_MODE
    CommandsEnabled = $values.DESK_NINJA_ADDON_COMMANDS_ENABLED
    AccountName = $values.DESK_NINJA_ACCOUNT_NAME
    MaxContracts = $values.DESK_NINJA_MAX_CONTRACTS
    LiveAccountAllowed = $values.DESK_NINJA_ALLOW_LIVE_ACCOUNT
    AtmStrategyName = $values.DESK_NINJA_ATM_STRATEGY_NAME
} | ConvertTo-Json -Compress
