param(
    [switch]$IncludePostgreSql,
    [switch]$Apply
)

$ErrorActionPreference = "Stop"
$isAdministrator = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $Apply) {
    Write-Host "DRY_RUN winget install OpenJS.NodeJS.LTS"
    Write-Host "DRY_RUN winget install CaddyServer.Caddy"
    Write-Host "DRY_RUN winget install CloudBees.WindowsServiceWrapper.3"
    if ($IncludePostgreSql) { Write-Host "DRY_RUN winget install PostgreSQL.PostgreSQL.16 (interactive password/data-directory selection)" }
    exit 0
}
if (-not $isAdministrator) { throw "Run this prerequisite installer from an elevated PowerShell session." }

$winget = (Get-Command winget.exe -ErrorAction Stop).Source
foreach ($id in @("OpenJS.NodeJS.LTS", "CaddyServer.Caddy", "CloudBees.WindowsServiceWrapper.3")) {
    & $winget install --id $id --exact --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "winget failed for $id with exit code $LASTEXITCODE" }
}
if ($IncludePostgreSql) {
    Write-Warning "PostgreSQL setup will request the superuser password and data directory. Store the password in the encrypted recovery vault."
    & $winget install --id "PostgreSQL.PostgreSQL.16" --exact --interactive --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "winget failed for PostgreSQL with exit code $LASTEXITCODE" }
}
Write-Host "Desk prerequisite installation completed. Open a new PowerShell session before running Test-DeskPrerequisites.ps1."
