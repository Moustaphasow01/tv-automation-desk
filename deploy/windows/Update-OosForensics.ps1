param(
  [Parameter(Mandatory=$true)][string]$PatchRoot,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{7,40}$')][string]$Revision,
  [switch]$PrepareOnly,
  [switch]$ActivatePrepared
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$xmlPath = 'C:\ProgramData\DeskOos\services\DeskOos.xml'
$configPath = 'C:\ProgramData\DeskOos\config\oos.json'
$xmlOriginal = [IO.File]::ReadAllText($xmlPath)
$configOriginal = [IO.File]::ReadAllText($configPath)
$oldRoot = Split-Path ([xml]$xmlOriginal).service.workingdirectory -Parent
$newRoot = "C:\DeskOos\releases\$Revision"
if ($oldRoot -notmatch '^C:\\DeskOos\\releases\\[A-Za-z0-9_.-]+$') { throw 'OOS_RELEASE_INVALID' }
$manifest = Get-Content (Join-Path $PatchRoot 'forensic-patch.json') -Raw | ConvertFrom-Json
if ($manifest.revision -ne $Revision -or $manifest.branch -ne 'feature/oos-batch-mcp-v1') { throw 'OOS_PATCH_IDENTITY_INVALID' }
foreach ($file in $manifest.files) {
  $allowed = $file.path -match '^packages/desk-oos-batch/(forensics\.js|index\.js|src/(domain|adapter|application)/forensic-[a-z-]+\.js|test/forensic-[a-z-]+\.test\.js)$'
  $allowed = $allowed -or $file.path -match '^mcp_gpt_desk/(src/oos-(forensic-tools|mcp-tool|mcp-server|runtime|http-server)\.js|scripts/(build_oos_forensic_index|verify_oos_forensics|oos_forensic_baseline)\.mjs|test/oos_forensic_tools\.test\.js)$'
  if (!$allowed) { throw "OOS_NON_FORENSIC_PATCH_FORBIDDEN: $($file.path)" }
  if ((Get-FileHash (Join-Path $PatchRoot $file.path) -Algorithm SHA256).Hash.ToLower() -ne $file.sha256) { throw 'OOS_PATCH_HASH_INVALID' }
}
if (!$ActivatePrepared) {
  if (Test-Path $newRoot) { throw 'OOS_RELEASE_ALREADY_EXISTS' }
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
  foreach ($file in $manifest.files) {
    $target = Join-Path $newRoot $file.path
    New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
    Copy-Item (Join-Path $PatchRoot $file.path) $target
    & node --check $target
    if ($LASTEXITCODE -ne 0) { throw 'OOS_FORENSIC_SYNTAX_FAILED' }
  }
  & node --env-file='C:\ProgramData\DeskOos\config\oos.env' (Join-Path $newRoot 'mcp_gpt_desk/scripts/build_oos_forensic_index.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'OOS_FORENSIC_INDEX_FAILED' }
  if ($PrepareOnly) { Write-Output "OOS_FORENSIC_PREPARED=$Revision"; exit 0 }
}
foreach ($file in $manifest.files) {
  if ((Get-FileHash (Join-Path $newRoot $file.path)).Hash.ToLower() -ne $file.sha256) { throw 'OOS_PREPARED_RELEASE_HASH_MISMATCH' }
}
$backup = "C:\ProgramData\DeskOos\config\forensic-rollback-$Revision"
New-Item -ItemType Directory $backup | Out-Null
Copy-Item $xmlPath "$backup\DeskOos.xml"
Copy-Item $configPath "$backup\oos.json"
$utf8 = [Text.UTF8Encoding]::new($false)
try {
  Stop-Service DeskOos
  [IO.File]::WriteAllText($xmlPath, $xmlOriginal.Replace($oldRoot, $newRoot), $utf8)
  $config = $configOriginal | ConvertFrom-Json
  $config.release = $Revision
  # Never modify replay flags, OAuth, TradingView config, plans, results, or other services.
  [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 20), $utf8)
  Start-Service DeskOos
  $ready = $false
  for ($i=0; $i -lt 30; $i++) {
    try { $health = Invoke-RestMethod 'http://127.0.0.1:8795/oos/health'; if ($health.ok -and $health.version -eq $Revision) { $ready=$true; break } } catch {}
    Start-Sleep -Seconds 1
  }
  if (!$ready) { throw 'OOS_FORENSIC_HEALTH_FAILED' }
  & node --env-file='C:\ProgramData\DeskOos\config\oos.env' (Join-Path $newRoot 'mcp_gpt_desk/scripts/verify_oos_forensics.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'OOS_FORENSIC_PUBLIC_ACCEPTANCE_FAILED' }
  Write-Output "OOS_FORENSIC_DEPLOYED=$Revision"
} catch {
  Stop-Service DeskOos -ErrorAction SilentlyContinue
  [IO.File]::WriteAllText($xmlPath, $xmlOriginal, $utf8)
  [IO.File]::WriteAllText($configPath, $configOriginal, $utf8)
  Start-Service DeskOos
  throw "OOS_FORENSIC_DEPLOY_FAILED_ROLLED_BACK: $($_.Exception.Message)"
}
