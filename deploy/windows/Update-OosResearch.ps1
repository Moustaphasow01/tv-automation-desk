param(
  [Parameter(Mandatory=$true)][string]$PatchRoot,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{7,40}$')][string]$Revision
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$root='C:\ProgramData\DeskOos'
$xmlPath=Join-Path $root 'services\DeskOos.xml'
$configPath=Join-Path $root 'config\oos.json'
$envPath=Join-Path $root 'config\oos.env'
$xmlOriginal=[IO.File]::ReadAllText($xmlPath)
$configOriginal=[IO.File]::ReadAllText($configPath)
$envOriginal=[IO.File]::ReadAllText($envPath)
$oldRoot=Split-Path ([xml]$xmlOriginal).service.workingdirectory -Parent
$newRoot="C:\DeskOos\releases\$Revision"
if ($oldRoot -notmatch '^C:\\DeskOos\\releases\\[A-Za-z0-9_.-]+$' -or (Test-Path $newRoot)) { throw 'RESEARCH_RELEASE_PATH_INVALID' }
$manifest=Get-Content (Join-Path $PatchRoot 'research-patch.json') -Raw|ConvertFrom-Json
if ($manifest.revision -ne $Revision -or $manifest.branch -ne 'feature/oos-batch-mcp-v1') { throw 'RESEARCH_PATCH_IDENTITY_INVALID' }
foreach($file in $manifest.files) {
  $allowed=$file.path -match '^packages/desk-oos-research/[a-zA-Z0-9_./-]+$'
  $allowed=$allowed -or $file.path -match '^infra/postgres/init/075_oos_research_memory.sql$'
  $allowed=$allowed -or $file.path -match '^mcp_gpt_desk/(package(-lock)?.json|src/oos-(research-[a-z-]+|mcp-server|http-server).js|scripts/(serve_oos|run_oos_research|configure_oos_research).mjs|test/oos_research_[a-z_]+.test.js)$'
  $allowed=$allowed -or $file.path -eq 'deploy/windows/Update-OosResearch.ps1'
  if (!$allowed -or $file.path -match '\.\.') { throw "RESEARCH_PATCH_SCOPE_FORBIDDEN: $($file.path)" }
  if ((Get-FileHash (Join-Path $PatchRoot $file.path)).Hash.ToLower() -ne $file.sha256) { throw 'RESEARCH_PATCH_HASH_INVALID' }
}
$codex=Get-ChildItem 'C:\ProgramData\DeskFutures\bin\codex' -Filter codex.exe -Recurse|Select-Object -First 1 -ExpandProperty FullName
if (!$codex -or !(Test-Path 'C:\ProgramData\DeskFutures\codex\auth.json')) { throw 'RESEARCH_CODEX_RUNTIME_MISSING' }
& robocopy $oldRoot $newRoot /E /XJ /XD node_modules /NFL /NDL /NJH /NJS /NP|Out-Null
if ($LASTEXITCODE -ge 8) { throw 'RESEARCH_RELEASE_COPY_FAILED' }
$deps=Join-Path $newRoot 'mcp_gpt_desk/node_modules'
New-Item -ItemType Directory $deps|Out-Null
foreach($item in Get-ChildItem (Join-Path $oldRoot 'mcp_gpt_desk/node_modules') -Force) {
  $target=Join-Path $deps $item.Name
  if($item.Name -eq '@tv-automation') {
    New-Item -ItemType Directory $target|Out-Null
    foreach($package in Get-ChildItem $item.FullName) {
      $source=if($package.Name -eq 'desk-oos-batch'){Join-Path $newRoot 'packages/desk-oos-batch'}else{$package.FullName}
      New-Item -ItemType Junction -Path (Join-Path $target $package.Name) -Target $source|Out-Null
    }
  } elseif($item.PSIsContainer) { New-Item -ItemType Junction -Path $target -Target $item.FullName|Out-Null }
  else { Copy-Item $item.FullName $target }
}
foreach($file in $manifest.files) {
  $target=Join-Path $newRoot $file.path
  New-Item -ItemType Directory -Force (Split-Path $target)|Out-Null
  Copy-Item (Join-Path $PatchRoot $file.path) $target
  if($file.path -match '\.(mjs|js)$') { & node --check $target; if($LASTEXITCODE -ne 0){throw 'RESEARCH_SYNTAX_FAILED'} }
}
New-Item -ItemType Junction -Path (Join-Path $deps '@tv-automation/desk-oos-research') -Target (Join-Path $newRoot 'packages/desk-oos-research')|Out-Null
$backup=Join-Path $root "backups/research/$Revision"
New-Item -ItemType Directory -Force $backup|Out-Null
& icacls $backup /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'|Out-Null
if($LASTEXITCODE -ne 0){throw 'RESEARCH_BACKUP_ACL_FAILED'}
Copy-Item $xmlPath (Join-Path $backup 'DeskOos.xml')
Copy-Item $configPath (Join-Path $backup 'oos.json')
Copy-Item $envPath (Join-Path $backup 'oos.env')
$configure=Join-Path $newRoot 'mcp_gpt_desk/scripts/configure_oos_research.mjs'
& node $configure backup $newRoot $backup
if($LASTEXITCODE -ne 0){throw 'RESEARCH_BACKUP_FAILED'}
& node $configure install $newRoot $backup
if($LASTEXITCODE -ne 0){throw 'RESEARCH_MIGRATION_FAILED'}
$utf8=[Text.UTF8Encoding]::new($false)
try {
  $envNow=[IO.File]::ReadAllText($envPath)
  if($envNow -match '(?m)^CODEX_HOME='){throw 'RESEARCH_EXISTING_CODEX_HOME_REQUIRES_REVIEW'}
  [IO.File]::WriteAllText($envPath,$envNow+"CODEX_HOME=C:/ProgramData/DeskFutures/codex`n",$utf8)
  $config=$configOriginal|ConvertFrom-Json
  $config.release=$Revision
  $config|Add-Member -NotePropertyName research_enabled -NotePropertyValue $true -Force
  $config|Add-Member -NotePropertyName research -NotePropertyValue @{model=@{codex_bin=$codex;timeout_ms=780000;discovery_timeout_ms=60000}} -Force
  Stop-Service DeskOos
  [IO.File]::WriteAllText($xmlPath,$xmlOriginal.Replace($oldRoot,$newRoot),$utf8)
  [IO.File]::WriteAllText($configPath,($config|ConvertTo-Json -Depth 30),$utf8)
  Start-Service DeskOos
  $ready=$false
  for($i=0;$i -lt 45;$i++) {
    try{$health=Invoke-RestMethod 'http://127.0.0.1:8795/oos/health';if($health.ok -and $health.version -eq $Revision){$ready=$true;break}}catch{}
    Start-Sleep -Seconds 1
  }
  if(!$ready){throw 'RESEARCH_HEALTH_FAILED'}
  & node $configure verify $newRoot $backup
  if($LASTEXITCODE -ne 0){throw 'RESEARCH_HISTORICAL_INTEGRITY_FAILED'}
  Write-Output "RESEARCH_DEPLOYED=$Revision"
} catch {
  Stop-Service DeskOos -ErrorAction SilentlyContinue
  [IO.File]::WriteAllText($xmlPath,$xmlOriginal,$utf8)
  [IO.File]::WriteAllText($configPath,$configOriginal,$utf8)
  [IO.File]::WriteAllText($envPath,$envOriginal,$utf8)
  Start-Service DeskOos
  throw "RESEARCH_ACTIVATION_ROLLED_BACK: $($_.Exception.Message)"
}
