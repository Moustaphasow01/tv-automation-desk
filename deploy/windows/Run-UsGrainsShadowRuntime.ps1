param(
    [string]$InstallRoot = "C:\DeskFutures",
    [string]$DataRoot = "C:\ProgramData\DeskFutures",
    [string]$Instruments = "ZW,ZC",
    [int]$PipelineLimit = 100
)

$ErrorActionPreference = "Stop"
$mutex = New-Object System.Threading.Mutex($false, "Global\DeskFuturesUsGrainsShadowRuntime")
$acquired = $false

function Import-DeskEnv {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "desk.env missing: $Path" }
    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = [string]$_
        if (-not $line -or $line.TrimStart().StartsWith("#") -or -not $line.Contains("=")) { return }
        $key, $value = $line.Split("=", 2)
        if ($key) { [Environment]::SetEnvironmentVariable($key.Trim(), $value.Trim().Trim('"'), "Process") }
    }
}

try {
    $acquired = $mutex.WaitOne(0)
    if (-not $acquired) { exit 0 }

    $envFile = Join-Path $DataRoot "config\desk.env"
    Import-DeskEnv -Path $envFile

    $appRoot = Join-Path $InstallRoot "current\app\mcp_gpt_desk"
    $node = "C:\Program Files\nodejs\node.exe"
    $runtime = Join-Path $appRoot "scripts\run_us_grains_strategy_suite_once.mjs"
    $pipeline = Join-Path $appRoot "scripts\run_strategy_signal_decision_pipeline_once.mjs"
    foreach ($path in @($appRoot, $node, $runtime, $pipeline)) {
        if (-not (Test-Path -LiteralPath $path)) { throw "US grains runtime dependency missing: $path" }
    }

    Set-Location $appRoot
    & $node --env-file=$envFile $runtime --instruments $Instruments --source-class SHADOW
    if ($LASTEXITCODE -ne 0) { throw "US grains shadow runtime failed with exit code $LASTEXITCODE" }

    & $node --env-file=$envFile $pipeline --limit $PipelineLimit --source-classes SHADOW --execution-modes SHADOW --prefer-embedded-context-gate-decision true
    if ($LASTEXITCODE -ne 0) { throw "US grains signal pipeline failed with exit code $LASTEXITCODE" }
} finally {
    if ($acquired) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
