param(
  [Parameter(Mandatory=$true)][string]$PatchRoot,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{7,40}$')][string]$Revision
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# OAuth-only rollout: no installer, migrations, DB setup, captures or replay commands.
$xmlPath = 'C:\ProgramData\DeskOos\services\DeskOos.xml'
$configPath = 'C:\ProgramData\DeskOos\config\oos.json'
$caddyPath = 'C:\DeskFutures\current\deploy\caddy\Caddyfile.template'
$xmlOriginal = [IO.File]::ReadAllText($xmlPath)
$configOriginal = [IO.File]::ReadAllText($configPath)
$caddyOriginal = [IO.File]::ReadAllText($caddyPath)
$oldRoot = Split-Path ([xml]$xmlOriginal).service.workingdirectory -Parent
$newRoot = "C:\DeskOos\releases\$Revision"
if ($oldRoot -notmatch '^C:\\DeskOos\\releases\\[A-Za-z0-9_.-]+$') { throw 'OOS_CURRENT_RELEASE_INVALID' }
if (Test-Path $newRoot) { throw 'OOS_RELEASE_ALREADY_EXISTS' }
$files = @('oauth.js', 'oos-oauth.js', 'oos-http-server.js')
foreach ($file in $files) {
  if (!(Test-Path (Join-Path $PatchRoot "mcp_gpt_desk\src\$file"))) { throw 'OOS_AUTH_PATCH_MISSING' }
}
# Clone unchanged release bytes; dependencies are shared read-only through a junction.
& robocopy $oldRoot $newRoot /E /XJ /XD node_modules /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'OOS_RELEASE_COPY_FAILED' }
New-Item -ItemType Junction -Path "$newRoot\mcp_gpt_desk\node_modules" -Target "$oldRoot\mcp_gpt_desk\node_modules" | Out-Null
foreach ($file in $files) {
  Copy-Item (Join-Path $PatchRoot "mcp_gpt_desk\src\$file") "$newRoot\mcp_gpt_desk\src\$file"
  if ((Get-FileHash (Join-Path $PatchRoot "mcp_gpt_desk\src\$file")).Hash -ne (Get-FileHash "$newRoot\mcp_gpt_desk\src\$file").Hash) { throw 'OOS_AUTH_COPY_HASH_MISMATCH' }
  & node --check "$newRoot\mcp_gpt_desk\src\$file"
  if ($LASTEXITCODE -ne 0) { throw 'OOS_AUTH_SYNTAX_FAILED' }
}
Copy-Item (Join-Path $PatchRoot 'mcp_gpt_desk\scripts\verify_oos_oauth.mjs') "$newRoot\mcp_gpt_desk\scripts\verify_oos_oauth.mjs"
$oldMatcher = '@oos path /oos /oos/* /.well-known/oauth-protected-resource/oos /.well-known/oauth-authorization-server/oos'
$newMatcher = '@oos path /oos /oos/* /.well-known/oauth-protected-resource/oos /.well-known/oauth-protected-resource/oos/mcp /.well-known/oauth-authorization-server/oos'
if (!$caddyOriginal.Contains($oldMatcher) -and !$caddyOriginal.Contains($newMatcher)) { throw 'OOS_CADDY_ROUTE_UNEXPECTED' }
$caddyUpdated = $caddyOriginal.Replace($oldMatcher, $newMatcher)
$backup = "C:\ProgramData\DeskOos\config\oauth-rollback-$Revision"
New-Item -ItemType Directory $backup | Out-Null
Copy-Item $xmlPath "$backup\DeskOos.xml"
Copy-Item $configPath "$backup\oos.json"
Copy-Item $caddyPath "$backup\Caddyfile"
[xml]$caddyService = Get-Content 'C:\ProgramData\DeskFutures\services\DeskCaddy.xml'
foreach ($entry in $caddyService.service.env) { [Environment]::SetEnvironmentVariable($entry.name, $entry.value, 'Process') }
$caddy = 'C:\ProgramData\DeskFutures\bin\caddy.exe'
$utf8 = [Text.UTF8Encoding]::new($false)
try {
  [IO.File]::WriteAllText($caddyPath, $caddyUpdated, $utf8)
  & $caddy validate --config $caddyPath --adapter caddyfile
  if ($LASTEXITCODE -ne 0) { throw 'OOS_CADDY_VALIDATE_FAILED' }
  Stop-Service DeskOos
  [IO.File]::WriteAllText($xmlPath, $xmlOriginal.Replace($oldRoot, $newRoot), $utf8)
  $config = $configOriginal | ConvertFrom-Json
  $config.release = $Revision
  [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 20), $utf8)
  Start-Service DeskOos
  $ready = $false
  for ($i=0; $i -lt 30; $i++) {
    try { $health = Invoke-RestMethod 'http://127.0.0.1:8795/oos/health'; if ($health.ok -and $health.version -eq $Revision) { $ready=$true; break } } catch {}
    Start-Sleep -Seconds 1
  }
  if (!$ready) { throw 'OOS_AUTH_HEALTH_FAILED' }
  & $caddy reload --config $caddyPath --adapter caddyfile
  if ($LASTEXITCODE -ne 0) { throw 'OOS_CADDY_RELOAD_FAILED' }
  Write-Output "OOS_OAUTH_DEPLOYED=$Revision"
  Write-Output "ROLLBACK=$backup"
} catch {
  Stop-Service DeskOos -ErrorAction SilentlyContinue
  [IO.File]::WriteAllText($xmlPath, $xmlOriginal, $utf8)
  [IO.File]::WriteAllText($configPath, $configOriginal, $utf8)
  [IO.File]::WriteAllText($caddyPath, $caddyOriginal, $utf8)
  Start-Service DeskOos
  & $caddy reload --config $caddyPath --adapter caddyfile
  throw 'OOS_OAUTH_DEPLOY_FAILED_ROLLED_BACK'
}
