param(
    [Parameter(Mandatory = $true)][string]$DatabaseUrl,
    [string]$SchemaDirectory = "",
    [string]$PostgresBin = "",
    [string]$ReleaseVersion = "unversioned",
    [switch]$DryRun
)

. (Join-Path $PSScriptRoot "DeskDatabase.Common.ps1")

if (-not $SchemaDirectory) {
    $SchemaDirectory = Join-Path (Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent) "infra\postgres\init"
}
$SchemaDirectory = Assert-DeskExplicitPath -Path $SchemaDirectory -Label "SchemaDirectory"
if (-not (Test-Path -LiteralPath $SchemaDirectory -PathType Container)) {
    throw "Schema directory not found: $SchemaDirectory"
}
$psql = Resolve-DeskPostgresTool -Name "psql" -PostgresBin $PostgresBin
$files = @(Get-ChildItem -LiteralPath $SchemaDirectory -Filter "*.sql" -File | Sort-Object Name)
if ($files.Count -eq 0) { throw "No SQL migrations found in $SchemaDirectory" }

if ($DryRun) {
    $files | ForEach-Object { Write-Host "$($_.Name) $(Get-DeskFileSha256 $_.FullName)" }
    exit 0
}

$ledgerSql = @"
CREATE TABLE IF NOT EXISTS desk_schema_migrations (
  migration_id text PRIMARY KEY,
  content_sha256 text NOT NULL,
  applied_at_utc timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL DEFAULT current_user,
  release_version text,
  execution_ms integer CHECK (execution_ms IS NULL OR execution_ms >= 0)
);
"@
Invoke-DeskExternal -FilePath $psql -Arguments @("--set", "ON_ERROR_STOP=1", "--dbname", $DatabaseUrl, "--command", $ledgerSql)

foreach ($file in $files) {
    $migrationId = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
    $checksum = Get-DeskFileSha256 $file.FullName
    $query = "SELECT content_sha256 FROM desk_schema_migrations WHERE migration_id = '$migrationId';"
    $existingOutput = @(& $psql --tuples-only --no-align --dbname $DatabaseUrl --command $query)
    if ($LASTEXITCODE -ne 0) { throw "Unable to read migration ledger for $migrationId" }
    $existing = ([string]($existingOutput -join "")).Trim()
    if ($existing) {
        if ($existing -ne $checksum) {
            throw "Migration checksum mismatch for $migrationId. Recorded=$existing current=$checksum"
        }
        Write-Host "SKIP $migrationId"
        continue
    }

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    Invoke-DeskExternal -FilePath $psql -Arguments @(
        "--set", "ON_ERROR_STOP=1",
        "--single-transaction",
        "--dbname", $DatabaseUrl,
        "--file", $file.FullName
    )
    $stopwatch.Stop()
    $releaseSql = ConvertTo-DeskPsqlLiteral $ReleaseVersion
    $recordSql = "INSERT INTO desk_schema_migrations(migration_id, content_sha256, release_version, execution_ms) VALUES ('$migrationId', '$checksum', '$releaseSql', $($stopwatch.ElapsedMilliseconds));"
    Invoke-DeskExternal -FilePath $psql -Arguments @("--set", "ON_ERROR_STOP=1", "--dbname", $DatabaseUrl, "--command", $recordSql)
    Write-Host "APPLIED $migrationId ($($stopwatch.ElapsedMilliseconds) ms)"
}

Write-Host "Desk PostgreSQL schema is current."
