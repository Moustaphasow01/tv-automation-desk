. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

function Assert-DeskNodeVersionTest {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "Desk Node version compatibility test failed: $Message" }
}

Assert-DeskNodeVersionTest `
    (Test-DeskNodeVersionCompatibility -RuntimeVersion "v24.18.0" -MinimumVersion "20.6.0") `
    "an older compatible release was rejected on the production runtime"
Assert-DeskNodeVersionTest `
    (-not (Test-DeskNodeVersionCompatibility -RuntimeVersion "v20.20.2" -MinimumVersion "22.0.0")) `
    "a Node 22 release was accepted on Node 20"
Assert-DeskNodeVersionTest `
    (Test-DeskNodeVersionCompatibility -RuntimeVersion "24.19.0" -MinimumVersion "22.0.0") `
    "the local validation runtime was rejected"
Assert-DeskNodeVersionTest `
    (-not (Test-DeskNodeVersionCompatibility -RuntimeVersion "unknown" -MinimumVersion "22.0.0")) `
    "an invalid runtime version was accepted"

Write-Host "Desk Node version compatibility tests passed."
