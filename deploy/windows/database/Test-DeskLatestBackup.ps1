param(
    [Parameter(Mandatory = $true)][string]$BackupDirectory,
    [Parameter(Mandatory = $true)][string]$RestoreDatabaseUrl,
    [string]$PostgresBin = ""
)

. (Join-Path $PSScriptRoot "DeskDatabase.Common.ps1")

$BackupDirectory = Assert-DeskExplicitPath -Path $BackupDirectory -Label "BackupDirectory"
$backup = Get-ChildItem -LiteralPath $BackupDirectory -File -Filter "desk-native-*.dump" |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
if (-not $backup) { throw "No unencrypted Desk backup found in $BackupDirectory" }
$checksumPath = "$($backup.FullName).sha256"
if (-not (Test-Path -LiteralPath $checksumPath)) { throw "Backup checksum file is missing: $checksumPath" }
$expected = ((Get-Content -LiteralPath $checksumPath -Raw).Trim() -split "\s+")[0].ToLowerInvariant()
$actual = Get-DeskFileSha256 $backup.FullName
if ($expected -ne $actual) { throw "Backup checksum mismatch for $($backup.Name)" }
$pgRestore = Resolve-DeskPostgresTool -Name "pg_restore" -PostgresBin $PostgresBin
$psql = Resolve-DeskPostgresTool -Name "psql" -PostgresBin $PostgresBin
& $pgRestore --list $backup.FullName | Out-Null
if ($LASTEXITCODE -ne 0) { throw "pg_restore could not read the backup catalog." }
Invoke-DeskExternal -FilePath $pgRestore -Arguments @(
    "--exit-on-error",
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
    "--dbname", $RestoreDatabaseUrl,
    $backup.FullName
)
$validation = (& $psql --tuples-only --no-align --dbname $RestoreDatabaseUrl --command "SELECT json_build_object('desk_documents', (SELECT count(*) FROM desk_documents), 'market_candles', (SELECT count(*) FROM market_candles), 'schema_migrations', (SELECT count(*) FROM desk_schema_migrations));").Trim()
if ($LASTEXITCODE -ne 0 -or -not $validation) { throw "Restored backup validation query failed." }

$objectBackup = Get-ChildItem -LiteralPath $BackupDirectory -File -Filter "desk-objects-*.tar.gz" |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
if (-not $objectBackup) { throw "No immutable object-store backup found in $BackupDirectory" }
$objectChecksumPath = "$($objectBackup.FullName).sha256"
if (-not (Test-Path -LiteralPath $objectChecksumPath)) { throw "Object backup checksum is missing: $objectChecksumPath" }
$objectExpected = ((Get-Content -LiteralPath $objectChecksumPath -Raw).Trim() -split "\s+")[0].ToLowerInvariant()
$objectActual = Get-DeskFileSha256 $objectBackup.FullName
if ($objectExpected -ne $objectActual) { throw "Object backup checksum mismatch for $($objectBackup.Name)" }
$tar = Get-Command "tar.exe" -ErrorAction SilentlyContinue
if (-not $tar) { throw "tar.exe is required to validate the object-store backup." }
# Consume the complete listing. Select-Object -First closes the pipe early,
# which makes bsdtar report a broken pipe and falsely marks a valid archive as
# unreadable.
& $tar.Source -tzf $objectBackup.FullName | Out-Null
if ($LASTEXITCODE -ne 0) { throw "The latest object-store archive is unreadable." }

Write-Host "Latest backup restored and validated in the isolated restore database: $($backup.FullName)"
Write-Host $validation
Write-Host "Latest immutable object-store archive validated: $($objectBackup.FullName)"
