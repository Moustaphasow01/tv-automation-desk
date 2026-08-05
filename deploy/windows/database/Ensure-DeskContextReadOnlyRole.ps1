param(
    [Parameter(Mandatory = $true)][string]$AdminDatabaseUrl,
    [string]$PostgresBin = "",
    [string]$DatabaseName = "desk",
    [string]$OwnerRole = "desk_owner",
    [string]$ContextRole = "desk_ai_context"
)

. (Join-Path $PSScriptRoot "DeskDatabase.Common.ps1")

$contextPassword = [Environment]::GetEnvironmentVariable("DESK_DB_CONTEXT_PASSWORD")
if ([string]::IsNullOrWhiteSpace($contextPassword) -or $contextPassword.Length -lt 20) {
    throw "DESK_DB_CONTEXT_PASSWORD must be supplied through the process environment and contain at least 20 characters."
}

$safeDatabase = $DatabaseName -replace "[^a-zA-Z0-9_]", ""
$safeOwner = $OwnerRole -replace "[^a-zA-Z0-9_]", ""
$safeContext = $ContextRole -replace "[^a-zA-Z0-9_]", ""
if (
    $safeDatabase -ne $DatabaseName `
    -or $safeOwner -ne $OwnerRole `
    -or $safeContext -ne $ContextRole
) {
    throw "Database and role names may only contain letters, numbers and underscores."
}

$psql = Resolve-DeskPostgresTool -Name "psql" -PostgresBin $PostgresBin
$contextPasswordSql = ConvertTo-DeskPsqlLiteral $contextPassword
$adminSql = @"
DO `$desk`$
BEGIN
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
GRANT CONNECT ON DATABASE $safeDatabase TO $safeContext;
"@

$databaseUrl = $AdminDatabaseUrl -replace "/[^/?]+(?=\?|$)", "/$safeDatabase"
$grantSql = @"
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM $safeContext;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM $safeContext;
GRANT USAGE ON SCHEMA public TO $safeContext;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO $safeContext;
ALTER DEFAULT PRIVILEGES FOR ROLE $safeOwner IN SCHEMA public GRANT SELECT ON TABLES TO $safeContext;
"@

function Invoke-PrivateDeskSql {
    param(
        [Parameter(Mandatory = $true)][string]$DatabaseUrl,
        [Parameter(Mandatory = $true)][string]$Sql
    )
    $tempFile = Join-Path ([System.IO.Path]::GetTempPath()) (
        "desk-context-role-" + [guid]::NewGuid().ToString("N") + ".sql"
    )
    try {
        [System.IO.File]::WriteAllText(
            $tempFile,
            $Sql,
            [System.Text.UTF8Encoding]::new($false)
        )
        if ($env:OS -eq "Windows_NT" -or $PSVersionTable.PSEdition -eq "Desktop") {
            & icacls.exe $tempFile /inheritance:r /grant:r `
                "*S-1-5-18:F" "*S-1-5-32-544:F" | Out-Null
            if ($LASTEXITCODE -ne 0) {
                throw "Could not secure the temporary PostgreSQL role script."
            }
        }
        Invoke-DeskExternal -FilePath $psql -Arguments @(
            "--set", "ON_ERROR_STOP=1",
            "--dbname", $DatabaseUrl,
            "--file", $tempFile
        )
    } finally {
        if (Test-Path -LiteralPath $tempFile) {
            [System.IO.File]::WriteAllText(
                $tempFile,
                "",
                [System.Text.UTF8Encoding]::new($false)
            )
            Remove-Item -LiteralPath $tempFile -Force -ErrorAction Stop
        }
    }
}

Invoke-PrivateDeskSql -DatabaseUrl $AdminDatabaseUrl -Sql $adminSql
Invoke-PrivateDeskSql -DatabaseUrl $databaseUrl -Sql $grantSql

$verification = @"
SELECT CASE
  WHEN rolcanlogin
   AND NOT rolsuper
   AND NOT rolcreaterole
   AND NOT rolcreatedb
   AND COALESCE(rolconfig, ARRAY[]::text[]) @> ARRAY['default_transaction_read_only=on']
  THEN 'context-role-ready'
  ELSE 'context-role-invalid'
END
FROM pg_roles
WHERE rolname = '$safeContext';
"@
$result = & $psql --tuples-only --no-align --set ON_ERROR_STOP=1 `
    --dbname $AdminDatabaseUrl --command $verification
if ($LASTEXITCODE -ne 0 -or ([string]$result).Trim() -ne "context-role-ready") {
    throw "The dedicated Desk context role did not pass verification."
}

Write-Host "Dedicated Desk AI context role is ready with SELECT-only grants."
