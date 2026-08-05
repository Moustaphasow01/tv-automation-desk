param(
    [string]$CodexHome = "C:\ProgramData\DeskFutures\codex",
    [string]$CodexExecutable = "",
    [string]$DataRoot = "C:\ProgramData\DeskFutures",
    [string]$InstallRoot = "C:\DeskFutures",
    [string]$NodeExecutable = ""
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

$CodexHome = Assert-DeskDeploymentPath -Path $CodexHome -Label "CodexHome"
$DataRoot = Assert-DeskDeploymentPath -Path $DataRoot -Label "DataRoot"
$InstallRoot = Assert-DeskDeploymentPath -Path $InstallRoot -Label "InstallRoot"
if (-not $CodexExecutable) {
    $CodexExecutable = Resolve-DeskCodexServiceExecutable -InstallDirectory (Join-Path $DataRoot "bin\codex")
}
$codex = Resolve-DeskExecutable -Name "codex.exe" -ExplicitPath $CodexExecutable
$node = Resolve-DeskExecutable -Name "node.exe" -ExplicitPath $NodeExecutable
$canaryRoot = Join-Path $DataRoot "status\codex-inference-canary"
New-Item -ItemType Directory -Path $canaryRoot -Force | Out-Null
$canaryScript = Join-Path $InstallRoot "current\app\mcp_gpt_desk\scripts\test_codex_inference_canary.mjs"
if (-not (Test-Path -LiteralPath $canaryScript -PathType Leaf)) {
    throw "Codex inference canary script is missing: $canaryScript"
}

$previousCodexHome = $env:CODEX_HOME
$previousCodexBin = $env:DESK_CODEX_BIN
try {
    $env:CODEX_HOME = $CodexHome
    $env:DESK_CODEX_BIN = $codex
    $output = Invoke-DeskCapturedCommand `
        -FilePath $node `
        -Arguments @($canaryScript) `
        -WorkingDirectory $canaryRoot
    $result = $output.Trim() | ConvertFrom-Json
    if (-not $result.ok -or [string]$result.status -ne "CANARY_OK") {
        throw "Codex inference canary returned an unexpected structured output."
    }
} finally {
    $env:CODEX_HOME = $previousCodexHome
    $env:DESK_CODEX_BIN = $previousCodexBin
}

$receiptPath = Join-Path $canaryRoot "receipt.json"
[System.IO.File]::WriteAllText(
    $receiptPath,
    ($result | ConvertTo-Json -Depth 8),
    [System.Text.UTF8Encoding]::new($false)
)
Set-DeskRestrictedAcl $canaryRoot

Write-Host ($result | ConvertTo-Json -Depth 8 -Compress)
