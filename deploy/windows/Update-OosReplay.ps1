param(
  [Parameter(Mandatory=$true)][string]$PatchRoot,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{7,40}$')][string]$Revision
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# POST-REPLAY only. No installer, migration, OAuth/Caddy update, plan edit or stable-service restart.
$xmlPath = 'C:\ProgramData\DeskOos\services\DeskOos.xml'
$configPath = 'C:\ProgramData\DeskOos\config\oos.json'
$xmlOriginal = [IO.File]::ReadAllText($xmlPath)
$configOriginal = [IO.File]::ReadAllText($configPath)
$oldRoot = Split-Path ([xml]$xmlOriginal).service.workingdirectory -Parent
$newRoot = "C:\DeskOos\releases\$Revision"
if ($oldRoot -notmatch '^C:\\DeskOos\\releases\\[A-Za-z0-9_.-]+$') { throw 'OOS_CURRENT_RELEASE_INVALID' }
if (Test-Path $newRoot) { throw 'OOS_RELEASE_ALREADY_EXISTS' }
$files = @(
  'mcp_gpt_desk/src/oos-runtime.js',
  'mcp_gpt_desk/src/oos-tradingview-engine.js',
  'mcp_gpt_desk/src/oos-tradingview-replay.js',
  'mcp_gpt_desk/src/oos-tradingview-panels.js',
  'mcp_gpt_desk/src/oos-tradingview-audit.js',
  'packages/desk-oos-batch/src/adapter/tradingview-mcp.js',
  'packages/desk-oos-batch/src/application/replay-workflow.js',
  'packages/desk-oos-batch/src/application/oos-portal.js',
  'packages/desk-oos-batch/src/domain/replay-artifacts.js'
)
foreach ($file in $files) { if (!(Test-Path (Join-Path $PatchRoot $file))) { throw 'OOS_REPLAY_PATCH_MISSING' } }
& robocopy $oldRoot $newRoot /E /XJ /XD node_modules /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'OOS_RELEASE_COPY_FAILED' }
# A shared node_modules junction would resolve the old OOS package. Fork only its package link.
$dependencies = Join-Path $newRoot 'mcp_gpt_desk/node_modules'
New-Item -ItemType Directory $dependencies | Out-Null
foreach ($item in Get-ChildItem (Join-Path $oldRoot 'mcp_gpt_desk/node_modules') -Force) {
  $target = Join-Path $dependencies $item.Name
  if ($item.Name -eq '@tv-automation') {
    New-Item -ItemType Directory $target | Out-Null
    foreach ($package in Get-ChildItem $item.FullName) {
      $source = if ($package.Name -eq 'desk-oos-batch') { Join-Path $newRoot 'packages/desk-oos-batch' } else { $package.FullName }
      New-Item -ItemType Junction -Path (Join-Path $target $package.Name) -Target $source | Out-Null
    }
  } elseif ($item.PSIsContainer) {
    New-Item -ItemType Junction -Path $target -Target $item.FullName | Out-Null
  } else { Copy-Item $item.FullName $target }
}
foreach ($file in $files) {
  $target = Join-Path $newRoot $file
  New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
  Copy-Item (Join-Path $PatchRoot $file) $target
  if ((Get-FileHash (Join-Path $PatchRoot $file)).Hash -ne (Get-FileHash $target).Hash) { throw 'OOS_REPLAY_COPY_HASH_MISMATCH' }
  & node --check $target
  if ($LASTEXITCODE -ne 0) { throw 'OOS_REPLAY_SYNTAX_FAILED' }
}
$backup = "C:\ProgramData\DeskOos\config\replay-rollback-$Revision"
New-Item -ItemType Directory $backup | Out-Null
Copy-Item $xmlPath "$backup\DeskOos.xml"
Copy-Item $configPath "$backup\oos.json"
$utf8 = [Text.UTF8Encoding]::new($false)
try {
  Stop-Service DeskOos
  [IO.File]::WriteAllText($xmlPath, $xmlOriginal.Replace($oldRoot, $newRoot), $utf8)
  $config = $configOriginal | ConvertFrom-Json
  $config.release = $Revision
  $config.replay_enabled = $true
  [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 20), $utf8)
  Start-Service DeskOos
  $ready = $false
  for ($i=0; $i -lt 30; $i++) {
    try { $health = Invoke-RestMethod 'http://127.0.0.1:8795/oos/health'; if ($health.ok -and $health.version -eq $Revision -and $health.replay_enabled) { $ready=$true; break } } catch {}
    Start-Sleep -Seconds 1
  }
  if (!$ready) { throw 'OOS_REPLAY_HEALTH_FAILED' }
  Write-Output "OOS_POST_REPLAY_DEPLOYED=$Revision"
  Write-Output "ROLLBACK=$backup"
} catch {
  Stop-Service DeskOos -ErrorAction SilentlyContinue
  [IO.File]::WriteAllText($xmlPath, $xmlOriginal, $utf8)
  [IO.File]::WriteAllText($configPath, $configOriginal, $utf8)
  Start-Service DeskOos
  throw 'OOS_REPLAY_DEPLOY_FAILED_ROLLED_BACK'
}
