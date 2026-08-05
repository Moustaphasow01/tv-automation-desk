param(
    [string]$PostgresBin = "",
    [string]$PostgresServiceName = "postgresql-x64-16",
    [switch]$RequireNinjaTrader
)

$ErrorActionPreference = "Stop"
$results = @()
$failures = @()

function Add-Check([string]$Name, [bool]$Ok, [string]$Details) {
    $script:results += [pscustomobject]@{ Check = $Name; Ok = $Ok; Details = $Details }
    if (-not $Ok) { $script:failures += $Name }
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
$nodeVersion = if ($node) { (& $node.Source --version).TrimStart("v") } else { "" }
$nodeOk = $false
if ($nodeVersion) {
    try { $nodeOk = [version]$nodeVersion -ge [version]"20.6.0" } catch { $nodeOk = $false }
}
Add-Check "Node.js >= 20.6" $nodeOk $nodeVersion

$caddy = Get-Command caddy.exe -ErrorAction SilentlyContinue
Add-Check "Caddy" ($null -ne $caddy) $(if ($caddy) { $caddy.Source } else { "missing" })
$winsw = Get-Command winsw.exe -ErrorAction SilentlyContinue
Add-Check "WinSW" ($null -ne $winsw) $(if ($winsw) { $winsw.Source } else { "missing" })

$psqlCandidates = @()
if ($PostgresBin) { $psqlCandidates += (Join-Path $PostgresBin "psql.exe") }
$psqlCandidates += @(
    "C:\Program Files\PostgreSQL\17\bin\psql.exe",
    "C:\Program Files\PostgreSQL\16\bin\psql.exe"
)
$psql = $psqlCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
Add-Check "PostgreSQL tools" ($null -ne $psql) $(if ($psql) { $psql } else { "missing" })
$postgresService = Get-Service -Name $PostgresServiceName -ErrorAction SilentlyContinue
Add-Check "PostgreSQL service" ($postgresService -and $postgresService.Status -eq "Running") $(if ($postgresService) { [string]$postgresService.Status } else { "missing" })

$ninjaPath = "C:\Program Files\NinjaTrader 8\bin\NinjaTrader.exe"
$ninjaOk = Test-Path -LiteralPath $ninjaPath
if ($RequireNinjaTrader) { Add-Check "NinjaTrader 8" $ninjaOk $(if ($ninjaOk) { $ninjaPath } else { "missing" }) }

$results | Format-Table -AutoSize
if ($failures.Count -gt 0) { throw "Desk prerequisites failed: $($failures -join ', ')" }
Write-Host "Desk prerequisites passed."
