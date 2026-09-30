param([Parameter(Mandatory=$true)][string]$ReleaseRoot)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
if ($ReleaseRoot -notmatch '^C:\\DeskOos\\releases\\[A-Za-z0-9_.-]+$') { throw 'OOS_RELEASE_PATH_INVALID' }
$oosRoot = 'C:\ProgramData\DeskOos'
$services = Join-Path $oosRoot 'services'
New-Item -ItemType Directory -Force $services, (Join-Path $oosRoot 'logs'), (Join-Path $oosRoot 'config') | Out-Null
# Copying WinSW reuses the installed neutral Windows service wrapper, not its service definition.
$wrapper = Join-Path $services 'DeskOos.exe'
if (!(Test-Path $wrapper)) { Copy-Item 'C:\ProgramData\DeskFutures\services\DeskApi.exe' $wrapper }
& node (Join-Path $ReleaseRoot 'mcp_gpt_desk\scripts\configure_oos_host.mjs') $ReleaseRoot
if ($LASTEXITCODE -ne 0) { throw 'OOS_CONFIGURATION_FAILED' }
& icacls (Join-Path $oosRoot 'config') /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'OOS_SECRET_ACL_FAILED' }
$xmlPath = Join-Path $services 'DeskOos.xml'
$xml = @"
<service>
  <id>DeskOos</id><name>Desk OOS Batch MCP</name>
  <description>Isolated OOS backend, MCP and capture/replay queue. No broker integration.</description>
  <executable>C:\Program Files\nodejs\node.exe</executable>
  <arguments>--env-file=&quot;$oosRoot\config\oos.env&quot; &quot;$ReleaseRoot\mcp_gpt_desk\scripts\serve_oos.mjs&quot;</arguments>
  <workingdirectory>$ReleaseRoot\mcp_gpt_desk</workingdirectory>
  <startmode>Automatic</startmode><delayedAutoStart>true</delayedAutoStart>
  <onfailure action="restart" delay="10 sec"/><onfailure action="restart" delay="30 sec"/>
  <stoptimeout>120 sec</stoptimeout><logpath>$oosRoot\logs</logpath>
  <log mode="roll-by-size"><sizeThreshold>10485760</sizeThreshold><keepFiles>20</keepFiles></log>
</service>
"@
if (Get-Service DeskOos -ErrorAction SilentlyContinue) { Stop-Service DeskOos }
[IO.File]::WriteAllText($xmlPath, $xml, [Text.UTF8Encoding]::new($false))
if (!(Get-Service DeskOos -ErrorAction SilentlyContinue)) { & $wrapper install; if ($LASTEXITCODE -ne 0) { throw 'OOS_SERVICE_INSTALL_FAILED' } }
Start-Service DeskOos
$ready = $false
for ($i=0; $i -lt 30; $i++) {
  try { $health = Invoke-RestMethod 'http://127.0.0.1:8795/oos/health'; if ($health.ok) { $ready=$true; break } } catch {}
  Start-Sleep -Seconds 1
}
if (!$ready) { throw 'OOS_HEALTH_FAILED' }

# Add one route to the existing HTTPS gateway, retain the exact previous file for rollback.
$caddyPath = 'C:\DeskFutures\current\deploy\caddy\Caddyfile.template'
$caddyOriginal = [IO.File]::ReadAllText($caddyPath)
$marker = '# DESK_OOS_ISOLATED_ROUTE'
if (!$caddyOriginal.Contains($marker)) {
  $route = @"
    # DESK_OOS_ISOLATED_ROUTE
    @oos path /oos /oos/* /.well-known/oauth-protected-resource/oos /.well-known/oauth-protected-resource/oos/mcp /.well-known/oauth-authorization-server/oos
    handle @oos {
        reverse_proxy 127.0.0.1:8795 {
            flush_interval -1
            transport http {
                response_header_timeout 180s
            }
        }
    }

"@
  if (!$caddyOriginal.Contains('@backend path')) { throw 'OOS_CADDY_INSERTION_POINT_MISSING' }
  $backup = Join-Path $oosRoot 'config\Caddyfile.before-oos'
  if (!(Test-Path $backup)) { [IO.File]::WriteAllText($backup, $caddyOriginal, [Text.UTF8Encoding]::new($false)) }
  [IO.File]::WriteAllText($caddyPath, $caddyOriginal.Replace('@backend path', $route + '@backend path'), [Text.UTF8Encoding]::new($false))
}
[xml]$caddyService = Get-Content 'C:\ProgramData\DeskFutures\services\DeskCaddy.xml'
foreach ($entry in $caddyService.service.env) { [Environment]::SetEnvironmentVariable($entry.name,$entry.value,'Process') }
$caddy = 'C:\ProgramData\DeskFutures\bin\caddy.exe'
& $caddy validate --config $caddyPath --adapter caddyfile
if ($LASTEXITCODE -ne 0) {
  [IO.File]::WriteAllText($caddyPath, $caddyOriginal, [Text.UTF8Encoding]::new($false))
  throw 'OOS_CADDY_VALIDATE_FAILED'
}
& $caddy reload --config $caddyPath --adapter caddyfile
if ($LASTEXITCODE -ne 0) {
  [IO.File]::WriteAllText($caddyPath, $caddyOriginal, [Text.UTF8Encoding]::new($false))
  & $caddy reload --config $caddyPath --adapter caddyfile
  throw 'OOS_CADDY_RELOAD_FAILED_ROLLED_BACK'
}
Write-Output 'OOS_DEPLOYED_CAPTURE_ONLY'
