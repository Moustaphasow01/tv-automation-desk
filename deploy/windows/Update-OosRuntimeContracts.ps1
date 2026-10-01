param(
  [Parameter(Mandatory=$true)][string]$PatchRoot,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{7,40}$')][string]$Revision
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Query-only OOS contract rollout. No Pine, parser, migration, OAuth, queue action or replay changes.
$xmlPath = 'C:\ProgramData\DeskOos\services\DeskOos.xml'
$configPath = 'C:\ProgramData\DeskOos\config\oos.json'
$envPath = 'C:\ProgramData\DeskOos\config\oos.env'
$xmlOriginal = [IO.File]::ReadAllText($xmlPath)
$configOriginal = [IO.File]::ReadAllText($configPath)
$oldRoot = Split-Path ([xml]$xmlOriginal).service.workingdirectory -Parent
$newRoot = "C:\DeskOos\releases\$Revision"
if ($oldRoot -notmatch '^C:\\DeskOos\\releases\\[A-Za-z0-9_.-]+$') { throw 'OOS_CURRENT_RELEASE_INVALID' }
if (Test-Path $newRoot) { throw 'OOS_RELEASE_ALREADY_EXISTS' }
$files = @(
  'mcp_gpt_desk/src/oos-runtime.js',
  'mcp_gpt_desk/src/oos-mcp-server.js',
  'mcp_gpt_desk/src/oos-http-server.js',
  'mcp_gpt_desk/src/oos-tradingview-contract-source.js',
  'mcp_gpt_desk/scripts/verify_oos_runtime_contracts.mjs',
  'mcp_gpt_desk/scripts/verify_oos_host.mjs',
  'mcp_gpt_desk/scripts/verify_oos_oauth.mjs',
  'packages/desk-oos-batch/index.js',
  'packages/desk-oos-batch/contracts/engine-v3.9.8.source.json',
  'packages/desk-oos-batch/src/adapter/runtime-contract-source.js',
  'packages/desk-oos-batch/src/application/runtime-contracts.js',
  'packages/desk-oos-batch/src/domain/engine-constraints-contract.js',
  'packages/desk-oos-batch/src/domain/smc3-record-contract.js',
  'packages/desk-oos-batch/src/domain/smc3-contract-examples.js'
)
foreach ($file in $files) { if (!(Test-Path (Join-Path $PatchRoot $file))) { throw 'OOS_CONTRACT_PATCH_MISSING' } }
& robocopy $oldRoot $newRoot /E /XJ /XD node_modules /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'OOS_RELEASE_COPY_FAILED' }
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
  if ((Get-FileHash (Join-Path $PatchRoot $file)).Hash -ne (Get-FileHash $target).Hash) { throw 'OOS_CONTRACT_COPY_HASH_MISMATCH' }
  if ($file -match '\.(js|mjs)$') { & node --check $target; if ($LASTEXITCODE -ne 0) { throw 'OOS_CONTRACT_SYNTAX_FAILED' } }
}
# Prove parser bytes unchanged before switching the only OOS service.
foreach ($name in @('smc3-syntax.js','smc3-syntax-values.js','smc3-syntax-records.js')) {
  $file = "packages/desk-oos-batch/src/domain/$name"
  if ((Get-FileHash (Join-Path $oldRoot $file)).Hash -ne (Get-FileHash (Join-Path $newRoot $file)).Hash) { throw 'OOS_PARSER_CHANGED' }
}
$backup = "C:\ProgramData\DeskOos\config\contracts-rollback-$Revision"
New-Item -ItemType Directory $backup | Out-Null
Copy-Item $xmlPath "$backup\DeskOos.xml"
Copy-Item $configPath "$backup\oos.json"
$runner = Join-Path $newRoot 'mcp_gpt_desk/scripts/verify_oos_runtime_contracts.mjs'
$baseline = & node "--env-file=$envPath" $runner preflight
if ($LASTEXITCODE -ne 0) { throw 'OOS_READ_ONLY_PREFLIGHT_FAILED' }
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText("$backup\read-only-baseline.json", $baseline, $utf8)
try {
  Stop-Service DeskOos
  [IO.File]::WriteAllText($xmlPath, $xmlOriginal.Replace($oldRoot, $newRoot), $utf8)
  $config = $configOriginal | ConvertFrom-Json
  $config.release = $Revision
  $config.front_root = Join-Path $newRoot 'apps/desk-control-plane/dist-oos'
  [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 20), $utf8)
  Start-Service DeskOos
  $ready = $false
  for ($i=0; $i -lt 30; $i++) {
    try { $health = Invoke-RestMethod 'http://127.0.0.1:8795/oos/health'; if ($health.ok -and $health.version -eq $Revision) { $ready=$true; break } } catch {}
    Start-Sleep -Seconds 1
  }
  if (!$ready) { throw 'OOS_CONTRACT_HEALTH_FAILED' }
  & node "--env-file=$envPath" $runner "$backup\read-only-baseline.json"
  if ($LASTEXITCODE -ne 0) { throw 'OOS_PUBLIC_CONTRACT_ACCEPTANCE_FAILED' }
  Write-Output "OOS_RUNTIME_CONTRACTS_DEPLOYED=$Revision"
  Write-Output "ROLLBACK=$backup"
} catch {
  Stop-Service DeskOos -ErrorAction SilentlyContinue
  [IO.File]::WriteAllText($xmlPath, $xmlOriginal, $utf8)
  [IO.File]::WriteAllText($configPath, $configOriginal, $utf8)
  Start-Service DeskOos
  throw 'OOS_RUNTIME_CONTRACT_DEPLOY_FAILED_ROLLED_BACK'
}
