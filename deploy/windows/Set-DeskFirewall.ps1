param(
    [int]$HttpPort = 80,
    [int]$HttpsPort = 443,
    [switch]$Apply
)

$rules = @(
    @{ Name = "DeskFutures-HTTP"; Port = $HttpPort },
    @{ Name = "DeskFutures-HTTPS"; Port = $HttpsPort }
)
if (-not $Apply) {
    $rules | ForEach-Object { Write-Host "DRY_RUN allow inbound TCP $($_.Port) as $($_.Name)" }
    Write-Host "API 8787 and PostgreSQL 5432 remain loopback-only and receive no inbound firewall rule."
    exit 0
}

Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled True
foreach ($rule in $rules) {
    Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName $rule.Name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $rule.Port -Profile Any | Out-Null
}
Write-Host "Desk firewall rules applied. Review the existing RDP allowlist separately before public cutover."
