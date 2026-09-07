param()
$ErrorActionPreference='Stop'
$root=Join-Path ([System.IO.Path]::GetTempPath()) ('desk-risk-policy-test-'+[guid]::NewGuid())
$config=Join-Path $root 'config'
New-Item -ItemType Directory -Path $config | Out-Null
$file=Join-Path $config 'desk.env'
$script=Join-Path $PSScriptRoot 'Set-DeskGrainsRiskPolicy.ps1'
$original=@'
# Preserve other settings and private values verbatim.
DESK_BROKER_EXECUTION_ENABLED=false
DESK_NINJA_BRIDGE_MODE=disabled
DESK_NINJA_KILL_SWITCH=true
DESK_NINJA_MAX_CONTRACTS=0
DESK_NINJA_ALLOW_LIVE_ACCOUNT=false
DESK_LEGACY_POSITION_EXECUTION_ENABLED=false
DESK_GRAINS_CALENDAR_ENABLED=false
DESK_SHADOW_PORTFOLIO_SELECTION_POLICY=NET_BY_DIRECTION
EXAMPLE_PRIVATE_VALUE=fixture-only-not-a-secret
'@
function Assert-True([bool]$Condition,[string]$Label) { if (-not $Condition) { throw $Label } }
try {
    [System.IO.File]::WriteAllText($file,$original,[System.Text.UTF8Encoding]::new($false))
    $hash=(Get-FileHash $file -Algorithm SHA256).Hash
    $preview=& $script -DataRoot $root -ExpectedConfigSha256 $hash | ConvertFrom-Json
    Assert-True ($preview.status -eq 'PREVIEW_ONLY') 'preview status'
    Assert-True ((Get-FileHash $file -Algorithm SHA256).Hash -eq $hash) 'preview must not write'
    $denied=$false
    try { & $script -DataRoot $root -Mode Apply -ExpectedConfigSha256 $hash | Out-Null } catch { $denied=$_.Exception.Message -eq 'RISK_CONFIG_AUDIT_REQUIRED' }
    Assert-True $denied 'audit required'
    $applied=& $script -DataRoot $root -Mode Apply -ExpectedConfigSha256 $hash -Actor test -Reason 'approved policy fixture' | ConvertFrom-Json
    Assert-True ($applied.status -eq 'CONFIGURED_RESTART_AND_RUNTIME_VERIFICATION_REQUIRED') 'explicit restart requirement'
    Assert-True (-not $applied.servicesRestarted) 'no service mutation'
    $content=[System.IO.File]::ReadAllText($file)
    Assert-True ($content.Contains('DESK_SHADOW_RISK_MAX_MONETARY_RISK=500')) 'position limit'
    Assert-True ($content.Contains('DESK_SHADOW_RISK_MAX_DAILY_LOSS_MONETARY=2000')) 'day limit'
    Assert-True ($content.Contains('DESK_SHADOW_RISK_MAX_WEEKLY_LOSS_MONETARY=4000')) 'week limit'
    Assert-True ($content.Contains('DESK_GRAINS_CALENDAR_ENABLED=false')) 'calendar unchanged'
    Assert-True ($content.Contains('DESK_SHADOW_PORTFOLIO_SELECTION_POLICY=NET_BY_DIRECTION')) 'selection unchanged'
    Assert-True ($content.Contains('EXAMPLE_PRIVATE_VALUE=fixture-only-not-a-secret')) 'other values unchanged'
    Assert-True ([System.IO.File]::ReadAllText($applied.backupPath) -eq $original) 'exact rollback backup'
    Assert-True (-not (($applied | ConvertTo-Json).Contains('fixture-only-not-a-secret'))) 'no private value in receipt'
    $denied=$false
    try { & $script -DataRoot $root -ExpectedConfigSha256 $hash | Out-Null } catch { $denied=$_.Exception.Message -eq 'RISK_CONFIG_REVISION_CONFLICT' }
    Assert-True $denied 'old revision rejected'
    $nowHash=(Get-FileHash $file -Algorithm SHA256).Hash
    $again=& $script -DataRoot $root -Mode Apply -ExpectedConfigSha256 $nowHash | ConvertFrom-Json
    Assert-True ($again.status -eq 'ALREADY_CONFIGURED') 'idempotence'
    [System.IO.File]::WriteAllText($file,$content.Replace('DESK_BROKER_EXECUTION_ENABLED=false','DESK_BROKER_EXECUTION_ENABLED=true'))
    $denied=$false
    try { & $script -DataRoot $root -ExpectedConfigSha256 (Get-FileHash $file -Algorithm SHA256).Hash | Out-Null } catch { $denied=$_.Exception.Message -like 'RISK_CONFIG_PHYSICAL_SAFETY_REQUIRED*' }
    Assert-True $denied 'physical authority never changed'
    Write-Output 'PASS: grains risk configuration preview, audit, revision, preservation, backup, idempotence and safety'
} finally { Remove-Item -LiteralPath $root -Recurse -Force }
