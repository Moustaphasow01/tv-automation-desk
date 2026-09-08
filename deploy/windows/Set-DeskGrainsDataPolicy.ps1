param(
    [string]$DataRoot = 'C:\ProgramData\DeskFutures',
    [ValidateSet('Preview','Apply')][string]$Mode = 'Preview',
    [ValidateSet('M1_M5_STRICT','M5_FALLBACK')][string]$Policy = 'M1_M5_STRICT',
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedConfigSha256,
    [string]$Actor = '',
    [string]$Reason = ''
)
. (Join-Path $PSScriptRoot 'DeskDeployment.Common.ps1')

# Delivery adapter only: market-data owns admission; this never changes execution authority.
$envFile = Join-Path (Assert-DeskDeploymentPath -Path $DataRoot -Label DataRoot) 'config\desk.env'
$beforeHash = (Get-FileHash -LiteralPath $envFile -Algorithm SHA256).Hash.ToLowerInvariant()
if ($beforeHash -ne $ExpectedConfigSha256.ToLowerInvariant()) { throw 'GRAINS_DATA_CONFIG_REVISION_CONFLICT' }
$before = Read-DeskEnvFile $envFile
$safety = @{
    DESK_BROKER_EXECUTION_ENABLED='false'; DESK_NINJA_BRIDGE_MODE='disabled'
    DESK_NINJA_KILL_SWITCH='true'; DESK_NINJA_MAX_CONTRACTS='0'
    DESK_NINJA_ALLOW_LIVE_ACCOUNT='false'; DESK_LEGACY_POSITION_EXECUTION_ENABLED='false'
}
foreach ($entry in $safety.GetEnumerator()) {
    if ($before[$entry.Key] -ne $entry.Value) { throw "GRAINS_DATA_PHYSICAL_SAFETY_REQUIRED: $($entry.Key)" }
}
$key = 'DESK_US_GRAINS_M5_FALLBACK_ENABLED'
$value = if ($Policy -eq 'M5_FALLBACK') { 'true' } else { 'false' }
$result = [ordered]@{ mode=$Mode; policy=$Policy; changedKey=$key; configBeforeSha256=$beforeHash; servicesRestarted=$false }
if ($Mode -eq 'Preview' -or $before[$key] -eq $value) {
    $result.status = if ($before[$key] -eq $value) { 'ALREADY_CONFIGURED' } else { 'PREVIEW_ONLY' }
    $result | ConvertTo-Json
    return
}
if (-not $Actor -or -not $Reason) { throw 'GRAINS_DATA_CONFIG_AUDIT_REQUIRED' }
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'GRAINS_DATA_CONFIG_ADMINISTRATOR_REQUIRED'
}
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ')
$backup = "$envFile.pre-grains-data-$stamp"
$pending = "$envFile.pending-grains-data-$stamp"
$receipt = "$envFile.grains-data-$stamp.json"
$lines = @([IO.File]::ReadAllLines($envFile) | Where-Object { $_ -notmatch '^\s*DESK_US_GRAINS_M5_FALLBACK_ENABLED\s*=' })
try {
    [IO.File]::WriteAllText($pending,'')
    Set-DeskRestrictedAcl $pending
    [IO.File]::WriteAllLines($pending,@($lines)+@("$key=$value"),[Text.UTF8Encoding]::new($false))
    if ((Get-FileHash -LiteralPath $envFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $beforeHash) {
        throw 'GRAINS_DATA_CONFIG_REVISION_CONFLICT'
    }
    [IO.File]::Replace($pending,$envFile,$backup)
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
    [IO.File]::WriteAllText($receipt,'')
    Set-DeskRestrictedAcl $receipt
    [IO.File]::WriteAllText($receipt,$json,[Text.UTF8Encoding]::new($false))
    $json
} finally {
    if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending -Force }
}
