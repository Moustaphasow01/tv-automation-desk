param(
    [string]$DataRoot = "C:\ProgramData\DeskFutures",
    [ValidateSet('Preview','Apply')][string]$Mode = 'Preview',
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedConfigSha256,
    [string]$Actor = '',
    [string]$Reason = ''
)

. (Join-Path $PSScriptRoot 'DeskDeployment.Common.ps1')

# Operations owns configuration delivery, not domain sizing or execution authority.
# Fixed values are the explicit operator mandate dated 2026-09-07 (TD2-429).
$approved = [ordered]@{
    DESK_SHADOW_RISK_SIZING_MODE='MONETARY_RISK_BUDGET'
    DESK_SHADOW_RISK_MAX_MONETARY_RISK='500'
    DESK_SHADOW_RISK_CURRENCY='USD'
    DESK_SHADOW_RISK_MAX_DAILY_LOSS_MONETARY='2000'
    DESK_SHADOW_RISK_MAX_WEEKLY_LOSS_MONETARY='4000'
}
$safety = @{
    DESK_BROKER_EXECUTION_ENABLED='false'; DESK_NINJA_BRIDGE_MODE='disabled'
    DESK_NINJA_KILL_SWITCH='true'; DESK_NINJA_MAX_CONTRACTS='0'
    DESK_NINJA_ALLOW_LIVE_ACCOUNT='false'; DESK_LEGACY_POSITION_EXECUTION_ENABLED='false'
}
$envFile = Join-Path (Assert-DeskDeploymentPath -Path $DataRoot -Label DataRoot) 'config\desk.env'
$beforeHash = (Get-FileHash -LiteralPath $envFile -Algorithm SHA256).Hash.ToLowerInvariant()
if ($beforeHash -ne $ExpectedConfigSha256.ToLowerInvariant()) { throw 'RISK_CONFIG_REVISION_CONFLICT' }
$before = Read-DeskEnvFile $envFile
foreach ($entry in $safety.GetEnumerator()) {
    if ($before[$entry.Key] -ne $entry.Value) { throw "RISK_CONFIG_PHYSICAL_SAFETY_REQUIRED: $($entry.Key)" }
}
$changes = @($approved.GetEnumerator() | Where-Object { $before[$_.Key] -ne $_.Value } | ForEach-Object { $_.Key })
$result = [ordered]@{ mode=$Mode; changedKeys=$changes; approvedPolicy=$approved; configBeforeSha256=$beforeHash; servicesRestarted=$false }
if ($Mode -eq 'Preview' -or $changes.Count -eq 0) {
    $result.status = if ($changes.Count -eq 0) { 'ALREADY_CONFIGURED' } else { 'PREVIEW_ONLY' }
    $result | ConvertTo-Json -Depth 5
    return
}
if ([string]::IsNullOrWhiteSpace($Actor) -or [string]::IsNullOrWhiteSpace($Reason)) { throw 'RISK_CONFIG_AUDIT_REQUIRED' }
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ')
$backup = "$envFile.pre-grains-risk-$stamp"
$pending = "$envFile.pending-grains-risk-$stamp"
$receipt = "$envFile.grains-risk-$stamp.json"
$lines = [System.Collections.Generic.List[string]]::new()
foreach ($line in [System.IO.File]::ReadAllLines($envFile)) {
    $separator = $line.IndexOf('=')
    if ($separator -gt 0 -and $approved.Contains($line.Substring(0,$separator).Trim())) { continue }
    $lines.Add($line)
}
foreach ($entry in $approved.GetEnumerator()) { $lines.Add("$($entry.Key)=$($entry.Value)") }
try {
    # Create with an empty, restricted file before writing any private environment data.
    [System.IO.File]::WriteAllText($pending,'')
    Set-DeskRestrictedAcl $pending
    [System.IO.File]::WriteAllLines($pending,$lines,[System.Text.UTF8Encoding]::new($false))
    if ((Get-FileHash -LiteralPath $envFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $beforeHash) {
        throw 'RISK_CONFIG_REVISION_CONFLICT'
    }
    [System.IO.File]::Replace($pending,$envFile,$backup)
    Set-DeskRestrictedAcl $backup
    Set-DeskRestrictedAcl $envFile
    $result.status='CONFIGURED_RESTART_AND_RUNTIME_VERIFICATION_REQUIRED'
    $result.configAfterSha256=(Get-FileHash -LiteralPath $envFile -Algorithm SHA256).Hash.ToLowerInvariant()
    $result.backupPath=$backup
    $result.actor=$Actor
    $result.reason=$Reason
    $result.configuredAtUtc=[DateTime]::UtcNow.ToString('o')
    $result.physicalPolicyUnchanged=$true
    $json=$result | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText($receipt,'')
    Set-DeskRestrictedAcl $receipt
    [System.IO.File]::WriteAllText($receipt,$json,[System.Text.UTF8Encoding]::new($false))
    $json
} finally {
    if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending -Force }
}
