$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = 'C:\ProgramData\DeskOos'
$data = Join-Path $root 'postgres'
$config = Join-Path $root 'config'
$bin = 'C:\Program Files\PostgreSQL\16\bin'
$bootstrap = Join-Path $config 'bootstrap.env'
$operatorSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
New-Item -ItemType Directory -Force $config | Out-Null
& icacls $root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "*${operatorSid}:(OI)(CI)F" '*S-1-5-20:(RX)' | Out-Null
& icacls $config /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "*${operatorSid}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'OOS_CONFIG_ACL_FAILED' }
if (!(Test-Path $bootstrap)) {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes); $rng.Dispose()
  $password = ([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()
  [IO.File]::WriteAllText($bootstrap, "OOS_BOOTSTRAP_DATABASE_URL=postgresql://oos_bootstrap:${password}@127.0.0.1:5434/postgres`n", [Text.UTF8Encoding]::new($false))
}
$url = ([IO.File]::ReadAllText($bootstrap).Trim() -split '=',2)[1]
$password = ([Uri]$url).UserInfo.Split(':')[1]
if ($password -notmatch '^[a-f0-9]{64}$') { throw 'OOS_BOOTSTRAP_FORMAT_INVALID' }
if (!(Test-Path (Join-Path $data 'PG_VERSION'))) {
  if (Test-Path $data) { throw 'OOS_PARTIAL_CLUSTER_REQUIRES_INSPECTION' }
  if (Get-NetTCPConnection -LocalPort 5434 -ErrorAction SilentlyContinue) { throw 'OOS_POSTGRES_PORT_BUSY' }
  $pwFile = Join-Path $config 'initdb-password.tmp'
  [IO.File]::WriteAllText($pwFile, $password, [Text.UTF8Encoding]::new($false))
  try {
    & "$bin\initdb.exe" -D $data -U oos_bootstrap --encoding=UTF8 --locale=C --auth=scram-sha-256 "--pwfile=$pwFile"
    if ($LASTEXITCODE -ne 0) { throw 'OOS_INITDB_FAILED' }
  } finally { Remove-Item -LiteralPath $pwFile -ErrorAction SilentlyContinue }
}
# Only the dedicated cluster is granted to the Windows service identity.
& icacls $data /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-20:(OI)(CI)M' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'OOS_POSTGRES_ACL_FAILED' }
Get-ChildItem -LiteralPath $data -Force | ForEach-Object {
  & icacls $_.FullName /reset /T | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'OOS_POSTGRES_CHILD_ACL_FAILED' }
}
if (!(Get-Service DeskOosPostgres -ErrorAction SilentlyContinue)) {
  & "$bin\pg_ctl.exe" register -N DeskOosPostgres -D $data -S auto -o '-p 5434 -h 127.0.0.1 -c shared_buffers=32MB -c max_connections=40 -c logging_collector=on -c log_min_error_statement=panic'
  if ($LASTEXITCODE -ne 0) { throw 'OOS_POSTGRES_SERVICE_FAILED' }
}
& sc.exe failure DeskOosPostgres reset= 86400 actions= restart/10000/restart/30000/restart/60000 | Out-Null
& sc.exe config DeskOosPostgres obj= 'NT AUTHORITY\NetworkService' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'OOS_POSTGRES_IDENTITY_FAILED' }
Start-Service DeskOosPostgres
Write-Output 'OOS_POSTGRES_ISOLATED_5434_READY'
