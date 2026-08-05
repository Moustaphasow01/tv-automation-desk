param(
    [Parameter(Mandatory = $true)][string]$PublicBaseUrl,
    [int]$TimeoutSeconds = 15
)

$base = $PublicBaseUrl.TrimEnd("/")
if (-not $base.StartsWith("https://")) { throw "PublicBaseUrl must use HTTPS." }
$checks = @(
    @{ Name = "front"; Url = "$base/" },
    @{ Name = "health"; Url = "$base/status" },
    @{ Name = "readiness"; Url = "$base/readyz" },
    @{ Name = "oauth-resource"; Url = "$base/.well-known/oauth-protected-resource" },
    @{ Name = "oauth-server"; Url = "$base/.well-known/oauth-authorization-server" }
)
$failures = @()
foreach ($check in $checks) {
    try {
        $response = Invoke-WebRequest -Uri $check.Url -UseBasicParsing -TimeoutSec $TimeoutSeconds
        if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) { throw "HTTP $($response.StatusCode)" }
        Write-Host "PASS $($check.Name) $($response.StatusCode)"
    } catch {
        $failures += "$($check.Name):$($_.Exception.Message)"
    }
}
try {
    Invoke-WebRequest -Uri "$base/api/v1/webhooks/tradingview" -Method Post -ContentType "application/json" -Body "{}" -UseBasicParsing -TimeoutSec $TimeoutSeconds | Out-Null
    $failures += "webhook accepted an unauthenticated payload"
} catch {
    $status = [int]$_.Exception.Response.StatusCode
    if ($status -ne 401) { $failures += "webhook expected 401, received $status" } else { Write-Host "PASS webhook rejects missing secret" }
}
if ($failures.Count -gt 0) { throw "Deployment smoke test failed: $($failures -join '; ')" }
Write-Host "Desk public deployment smoke test passed."
