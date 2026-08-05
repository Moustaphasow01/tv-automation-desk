param(
    [string]$PostgresBin = "",
    [string]$AdminDatabaseUrl = "postgresql://postgres@127.0.0.1:5432/postgres",
    [string]$DatabaseName = "desk",
    [string]$RestoreDatabaseName = "desk_restore_check",
    [string]$OwnerRole = "desk_owner",
    [string]$RuntimeRole = "desk_runtime",
    [string]$BackupRole = "desk_backup",
    [string]$ContextRole = "desk_ai_context"
)

. (Join-Path $PSScriptRoot "DeskDatabase.Common.ps1")

$ownerPassword = [Environment]::GetEnvironmentVariable("DESK_DB_OWNER_PASSWORD")
$runtimePassword = [Environment]::GetEnvironmentVariable("DESK_DB_RUNTIME_PASSWORD")
$backupPassword = [Environment]::GetEnvironmentVariable("DESK_DB_BACKUP_PASSWORD")
$contextPassword = [Environment]::GetEnvironmentVariable("DESK_DB_CONTEXT_PASSWORD")
foreach ($item in @(
    @{ Name = "DESK_DB_OWNER_PASSWORD"; Value = $ownerPassword },
    @{ Name = "DESK_DB_RUNTIME_PASSWORD"; Value = $runtimePassword },
    @{ Name = "DESK_DB_BACKUP_PASSWORD"; Value = $backupPassword },
    @{ Name = "DESK_DB_CONTEXT_PASSWORD"; Value = $contextPassword }
)) {
    if ([string]::IsNullOrWhiteSpace($item.Value) -or $item.Value.Length -lt 20) {
        throw "$($item.Name) must be supplied through the process environment and contain at least 20 characters."
    }
}

$psql = Resolve-DeskPostgresTool -Name "psql" -PostgresBin $PostgresBin
$safeDatabase = $DatabaseName -replace "[^a-zA-Z0-9_]", ""
$safeRestoreDatabase = $RestoreDatabaseName -replace "[^a-zA-Z0-9_]", ""
$safeOwner = $OwnerRole -replace "[^a-zA-Z0-9_]", ""
$safeRuntime = $RuntimeRole -replace "[^a-zA-Z0-9_]", ""
$safeBackup = $BackupRole -replace "[^a-zA-Z0-9_]", ""
$safeContext = $ContextRole -replace "[^a-zA-Z0-9_]", ""
if ($safeDatabase -ne $DatabaseName -or $safeRestoreDatabase -ne $RestoreDatabaseName -or $safeOwner -ne $OwnerRole -or $safeRuntime -ne $RuntimeRole -or $safeBackup -ne $BackupRole -or $safeContext -ne $ContextRole) {
    throw "Database and role names may only contain letters, numbers and underscores."
}

$ownerPasswordSql = ConvertTo-DeskPsqlLiteral $ownerPassword
$runtimePasswordSql = ConvertTo-DeskPsqlLiteral $runtimePassword
$backupPasswordSql = ConvertTo-DeskPsqlLiteral $backupPassword
$contextPasswordSql = ConvertTo-DeskPsqlLiteral $contextPassword
$bootstrapSql = @"
DO `$desk`$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$safeOwner') THEN
    CREATE ROLE $safeOwner LOGIN PASSWORD '$ownerPasswordSql' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSE
    ALTER ROLE $safeOwner WITH LOGIN PASSWORD '$ownerPasswordSql' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$safeRuntime') THEN
    CREATE ROLE $safeRuntime LOGIN PASSWORD '$runtimePasswordSql' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSE
    ALTER ROLE $safeRuntime WITH LOGIN PASSWORD '$runtimePasswordSql' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$safeBackup') THEN
    CREATE ROLE $safeBackup LOGIN PASSWORD '$backupPasswordSql' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSE
    ALTER ROLE $safeBackup WITH LOGIN PASSWORD '$backupPasswordSql' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$safeContext') THEN
    CREATE ROLE $safeContext LOGIN PASSWORD '$contextPasswordSql' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSE
    ALTER ROLE $safeContext WITH LOGIN PASSWORD '$contextPasswordSql' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
`$desk`$;

ALTER ROLE $safeContext SET default_transaction_read_only = on;
ALTER ROLE $safeContext SET statement_timeout = '30s';
ALTER ROLE $safeContext SET lock_timeout = '5s';
ALTER ROLE $safeContext SET idle_in_transaction_session_timeout = '30s';

SELECT format('CREATE DATABASE %I OWNER %I', '$safeDatabase', '$safeOwner')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$safeDatabase')\gexec

SELECT format('CREATE DATABASE %I OWNER %I', '$safeRestoreDatabase', '$safeOwner')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$safeRestoreDatabase')\gexec
"@

$tempFile = Join-Path ([System.IO.Path]::GetTempPath()) ("desk-bootstrap-" + [guid]::NewGuid().ToString("N") + ".sql")
try {
    [System.IO.File]::WriteAllText($tempFile, $bootstrapSql, [System.Text.UTF8Encoding]::new($false))
    Invoke-DeskExternal -FilePath $psql -Arguments @("--set", "ON_ERROR_STOP=1", "--dbname", $AdminDatabaseUrl, "--file", $tempFile)

    $targetUrl = $AdminDatabaseUrl -replace "/[^/?]+(?=\?|$)", "/$safeDatabase"
    $grants = @"
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE $safeDatabase TO $safeRuntime, $safeBackup, $safeContext;
GRANT USAGE ON SCHEMA public TO $safeRuntime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO $safeRuntime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO $safeRuntime;
ALTER DEFAULT PRIVILEGES FOR ROLE $safeOwner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO $safeRuntime;
ALTER DEFAULT PRIVILEGES FOR ROLE $safeOwner IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO $safeRuntime;
GRANT CONNECT ON DATABASE $safeDatabase TO $safeBackup;
GRANT USAGE ON SCHEMA public TO $safeBackup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO $safeBackup;
ALTER DEFAULT PRIVILEGES FOR ROLE $safeOwner IN SCHEMA public GRANT SELECT ON TABLES TO $safeBackup;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM $safeContext;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM $safeContext;
GRANT USAGE ON SCHEMA public TO $safeContext;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO $safeContext;
ALTER DEFAULT PRIVILEGES FOR ROLE $safeOwner IN SCHEMA public GRANT SELECT ON TABLES TO $safeContext;
"@
    $grantFile = Join-Path ([System.IO.Path]::GetTempPath()) ("desk-grants-" + [guid]::NewGuid().ToString("N") + ".sql")
    [System.IO.File]::WriteAllText($grantFile, $grants, [System.Text.UTF8Encoding]::new($false))
    try {
        Invoke-DeskExternal -FilePath $psql -Arguments @("--set", "ON_ERROR_STOP=1", "--dbname", $targetUrl, "--file", $grantFile)
    } finally {
        Remove-Item -LiteralPath $grantFile -Force -ErrorAction SilentlyContinue
    }
} finally {
    Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
}

Write-Host "PostgreSQL roles and database initialized for Desk Futures."
