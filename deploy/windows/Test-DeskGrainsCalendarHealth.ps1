param()

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

$ErrorActionPreference = "Stop"

function Assert-Equal {
    param([string]$Label, [object]$Actual, [object]$Expected)
    if ([string]$Actual -ne [string]$Expected) {
        throw "$Label expected '$Expected' but got '$Actual'."
    }
}

function Assert-Reasons {
    param([string]$Label, [object]$Diagnostic, [string[]]$Expected)
    Assert-Equal "$Label degraded" $Diagnostic.degraded ($Expected.Count -gt 0)
    Assert-Equal "$Label reasons" (@($Diagnostic.reason_codes) -join ",") ($Expected -join ",")
}

$now = [datetime]::Parse("2026-09-07T12:00:00Z").ToUniversalTime()

$disabled = Get-DeskGrainsCalendarDiagnostic -Policy disabled -StatusDocument ([pscustomobject]@{
    status = "DISABLED_BY_POLICY"; asOfUtc = "2026-09-07T11:59:00Z"
}) -NowUtc $now
Assert-Equal "disabled status" $disabled.status "DISABLED_BY_POLICY"
Assert-Equal "disabled observed status" $disabled.observed_status "DISABLED_BY_POLICY"
Assert-Reasons "disabled" $disabled @()

$invalidPolicy = Get-DeskGrainsCalendarDiagnostic -Policy invalid -StatusDocument ([pscustomobject]@{
    status = "DISABLED_BY_POLICY"
}) -NowUtc $now
Assert-Equal "invalid policy status" $invalidPolicy.status "CONFIG_INVALID"
Assert-Equal "invalid policy observed status" $invalidPolicy.observed_status "DISABLED_BY_POLICY"
Assert-Reasons "invalid policy" $invalidPolicy @("grains_calendar_config_invalid")

$fresh = Get-DeskGrainsCalendarDiagnostic -Policy enabled -StatusDocument ([pscustomobject]@{
    status = "AVAILABLE"
    asOfUtc = "2026-09-07T11:01:00Z"
    freshUntilUtc = "2026-09-07T17:00:00Z"
    reasonCodes = @()
}) -NowUtc $now
Assert-Reasons "fresh" $fresh @()

$stale = Get-DeskGrainsCalendarDiagnostic -Policy enabled -StatusDocument ([pscustomobject]@{
    status = "AVAILABLE"; asOfUtc = "2026-09-07T10:59:00Z"; freshUntilUtc = "2026-09-07T17:00:00Z"
}) -NowUtc $now
Assert-Reasons "stale cadence" $stale @("grains_calendar_as_of_stale")

$expired = Get-DeskGrainsCalendarDiagnostic -Policy enabled -StatusDocument ([pscustomobject]@{
    status = "AVAILABLE"; asOfUtc = "2026-09-07T11:45:00Z"; freshUntilUtc = "2026-09-07T12:00:00Z"
}) -NowUtc $now
Assert-Reasons "expired ledger" $expired @("grains_calendar_freshness_expired")

$unavailable = Get-DeskGrainsCalendarDiagnostic -Policy enabled -StatusDocument ([pscustomobject]@{
    status = "UNAVAILABLE"; asOfUtc = "2026-09-07T11:59:00Z"; reasonCodes = @("USDA_FAS_HTTP_403")
}) -NowUtc $now
Assert-Reasons "last failure" $unavailable @("grains_calendar_status_unavailable")
Assert-Equal "last failure source reason" (@($unavailable.source_reason_codes) -join ",") "USDA_FAS_HTTP_403"

$missing = Get-DeskGrainsCalendarDiagnostic -Policy enabled -StatusDocument $null -NowUtc $now
Assert-Reasons "missing" $missing @("grains_calendar_status_missing")

$malformed = Get-DeskGrainsCalendarDiagnostic -Policy enabled -StatusDocument ([pscustomobject]@{
    status = "INVALID_JSON"
}) -NowUtc $now
Assert-Reasons "malformed" $malformed @("grains_calendar_status_invalid_json")

$invalidDates = Get-DeskGrainsCalendarDiagnostic -Policy enabled -StatusDocument ([pscustomobject]@{
    status = "AVAILABLE"; asOfUtc = "not-a-date"; freshUntilUtc = "not-a-date"
}) -NowUtc $now
Assert-Reasons "invalid dates" $invalidDates @(
    "grains_calendar_as_of_invalid",
    "grains_calendar_fresh_until_invalid"
)

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("desk-health-" + [guid]::NewGuid().ToString("N"))
try {
    $configRoot = Join-Path $testRoot "config"
    $statusRoot = Join-Path $testRoot "status"
    New-Item -ItemType Directory -Path $configRoot, $statusRoot -Force | Out-Null

    function Get-Service {
        param([string]$Name, [object]$ErrorAction)
        return [pscustomobject]@{ Status = "Running"; StartType = "Automatic" }
    }
    function Invoke-RestMethod {
        param([string]$Uri, [int]$TimeoutSec)
        return [pscustomobject]@{ ok = $true; ready = $true }
    }

    Set-Content -LiteralPath (Join-Path $configRoot "desk.env") `
        -Value "DESK_GRAINS_CALENDAR_ENABLED=true" -Encoding ASCII
    [pscustomobject]@{
        status = "UNAVAILABLE"
        asOfUtc = $now.ToString("o")
        reasonCodes = @("USDA_FAS_HTTP_403")
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $statusRoot "grains-calendar.json") -Encoding UTF8

    & (Join-Path $PSScriptRoot "Test-DeskLocalHealth.ps1") -DataRoot $testRoot -TimeoutSeconds 15
    $health = Get-Content -LiteralPath (Join-Path $statusRoot "health.json") -Raw | ConvertFrom-Json
    Assert-Equal "mock health remains ok" $health.ok $true
    Assert-Equal "mock health is degraded" $health.degraded $true
    Assert-Equal "mock health failures" @($health.failures).Count 0
    Assert-Equal "mock health source failure" (@($health.grains_calendar.source_reason_codes) -join ",") "USDA_FAS_HTTP_403"

    Set-Content -LiteralPath (Join-Path $configRoot "desk.env") `
        -Value "DESK_GRAINS_CALENDAR_ENABLED=false" -Encoding ASCII
    [pscustomobject]@{
        status = "DISABLED_BY_POLICY"
        asOfUtc = $now.ToString("o")
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $statusRoot "grains-calendar.json") -Encoding UTF8

    & (Join-Path $PSScriptRoot "Test-DeskLocalHealth.ps1") -DataRoot $testRoot -TimeoutSeconds 15
    $disabledHealth = Get-Content -LiteralPath (Join-Path $statusRoot "health.json") -Raw | ConvertFrom-Json
    Assert-Equal "mock disabled health remains ok" $disabledHealth.ok $true
    Assert-Equal "mock disabled health not degraded" $disabledHealth.degraded $false
    Assert-Equal "mock disabled status preserved" $disabledHealth.grains_calendar.observed_status "DISABLED_BY_POLICY"

    Set-Content -LiteralPath (Join-Path $configRoot "desk.env") `
        -Value "DESK_GRAINS_CALENDAR_ENABLED=TRUE" -Encoding ASCII
    & (Join-Path $PSScriptRoot "Test-DeskLocalHealth.ps1") -DataRoot $testRoot -TimeoutSeconds 15
    $invalidHealth = Get-Content -LiteralPath (Join-Path $statusRoot "health.json") -Raw | ConvertFrom-Json
    Assert-Equal "mock invalid config remains process healthy" $invalidHealth.ok $true
    Assert-Equal "mock invalid config degrades health" $invalidHealth.degraded $true
    Assert-Equal "mock invalid config status" $invalidHealth.grains_calendar.status "CONFIG_INVALID"
} finally {
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Desk grains-calendar health diagnostics passed."
