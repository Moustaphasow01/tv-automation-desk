param(
    [string]$CodexHome = "C:\ProgramData\DeskFutures\codex",
    [string]$InstallDirectory = "C:\ProgramData\DeskFutures\bin\codex",
    [string]$NpmExecutable = "",
    [switch]$SkipInstall,
    [switch]$DeviceLogin
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

$CodexHome = Assert-DeskDeploymentPath -Path $CodexHome -Label "CodexHome"
$InstallDirectory = Assert-DeskDeploymentPath -Path $InstallDirectory -Label "InstallDirectory"
New-Item -ItemType Directory -Path $CodexHome -Force | Out-Null
New-Item -ItemType Directory -Path $InstallDirectory -Force | Out-Null
Set-DeskRestrictedAcl $CodexHome
Set-DeskRestrictedAcl $InstallDirectory

if (-not $SkipInstall) {
    $npm = Resolve-DeskExecutable -Name "npm.cmd" -ExplicitPath $NpmExecutable
    Invoke-DeskCommand -FilePath $npm -Arguments @(
        "install",
        "--global",
        "--prefix",
        $InstallDirectory,
        "@openai/codex@latest"
    )
}

$codexExecutable = Resolve-DeskCodexServiceExecutable -InstallDirectory $InstallDirectory
if (-not $codexExecutable) {
    throw "Codex CLI was not found after installation in $InstallDirectory."
}

$env:CODEX_HOME = $CodexHome
Invoke-DeskCommand -FilePath $codexExecutable -Arguments @("--version")

if ($DeviceLogin) {
    Write-Host "Starting the official Codex device login for the service-owned CODEX_HOME."
    Write-Host "Complete the displayed browser/device flow. Never paste auth.json or its tokens into chat."
    Invoke-DeskCommand -FilePath $codexExecutable -Arguments @("login", "--device-auth")
    $authFile = Join-Path $CodexHome "auth.json"
    if (-not (Test-Path -LiteralPath $authFile -PathType Leaf)) {
        throw "Codex device login completed without creating $authFile"
    }
    Set-DeskRestrictedAcl $authFile
}

Write-Host "Codex CLI ready: $codexExecutable"
Write-Host "CODEX_HOME: $CodexHome"
