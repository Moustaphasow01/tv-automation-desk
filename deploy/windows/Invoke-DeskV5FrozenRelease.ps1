param(
    [ValidateSet("Build", "DeployFrozen", "VerifyFrozen", "ImportJune11R2", "PrepareJune11", "RollbackFrozen")]
    [string]$Stage = "Build",
    [string]$ReleaseName = "2026.08.01-engine-v5-1-hold.3",
    [string]$ProjectRoot = "",
    [string]$OutputRoot = "",
    [string]$ReleasePath = "",
    [string]$Domain = "",
    [string]$TlsEmail = "",
    [string]$InstallRoot = "C:\DeskFutures",
    [string]$DataRoot = "C:\ProgramData\DeskFutures",
    [string]$NodeExecutable = "",
    [string]$PostgresBin = "",
    [string]$June11R2PackagePath = "",
    [string]$MigrationDatabaseUrl = "",
    [switch]$SkipTests,
    [switch]$AllowDirty,
    [switch]$PrepareJune11AfterDeploy
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")
. (Join-Path $PSScriptRoot "database\DeskDatabase.Common.ps1")

function Invoke-Main {
if ($ReleaseName -notmatch "^[a-zA-Z0-9._-]+$") { throw "ReleaseName contains unsupported characters." }
if (-not $ProjectRoot) { $ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent }
if (-not $OutputRoot) { $OutputRoot = Join-Path $ProjectRoot ".local\releases" }

if ($Stage -eq "Build") {
    $buildParameters = @{
        ProjectRoot = $ProjectRoot
        OutputRoot = $OutputRoot
        Version = $ReleaseName
    }
    if ($SkipTests) { $buildParameters["SkipTests"] = $true }
    if ($AllowDirty) { $buildParameters["AllowDirty"] = $true }
    & (Join-Path $PSScriptRoot "Build-DeskRelease.ps1") @buildParameters
    $releaseRoot = Join-Path $OutputRoot $ReleaseName
    & (Join-Path $PSScriptRoot "Test-DeskRelease.ps1") -ReleaseRoot $releaseRoot -RequireV5Frozen
    Write-Host "Frozen V5 release artifact ready: $releaseRoot.zip"
    return
}

$InstallRoot = Assert-DeskDeploymentPath -Path $InstallRoot -Label "InstallRoot"
$DataRoot = Assert-DeskDeploymentPath -Path $DataRoot -Label "DataRoot"
$envFile = Join-Path $DataRoot "config\desk.env"
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { throw "Desk environment is missing: $envFile" }
$node = Resolve-DeskExecutable -Name "node.exe" -ExplicitPath $NodeExecutable
if ($Stage -in @("VerifyFrozen", "ImportJune11R2", "PrepareJune11")) {
    Assert-InstalledFrozenRelease -ExpectedVersion $ReleaseName
}

if ($Stage -eq "DeployFrozen") {
    if ($PrepareJune11AfterDeploy) {
        throw "-PrepareJune11AfterDeploy is forbidden. Run ImportJune11R2, then PrepareJune11 as explicit frozen stages."
    }
    if (-not $ReleasePath) { throw "ReleasePath is required for DeployFrozen." }
    if (-not $Domain -or -not $TlsEmail) { throw "Domain and TlsEmail are required for DeployFrozen." }
    Assert-DeskFrozenProducerServices
    & (Join-Path $PSScriptRoot "Update-Desk.ps1") `
        -ReleasePath $ReleasePath `
        -Domain $Domain `
        -TlsEmail $TlsEmail `
        -InstallRoot $InstallRoot `
        -DataRoot $DataRoot `
        -NodeExecutable $node `
        -PostgresBin $PostgresBin `
        -AiWorkerMode disabled `
        -KeepFrozen `
        -QuiesceFrozenState

    $manifest = Assert-InstalledFrozenRelease -ExpectedVersion $ReleaseName

    Invoke-ReleaseNodeScript -RelativePath "scripts\seed_contracts.mjs"
    & (Join-Path $InstallRoot "current\deploy\windows\Test-DeskV5FrozenRelease.ps1") `
        -InstallRoot $InstallRoot -DataRoot $DataRoot -NodeExecutable $node

    Write-FrozenReceipt -Status "deployed_frozen" -Version $manifest.version
    Write-Host "V5 release deployed and verified under strict freeze. No lane or AI worker was activated."
    return
}

if ($Stage -eq "VerifyFrozen") {
    & (Join-Path $InstallRoot "current\deploy\windows\Test-DeskV5FrozenRelease.ps1") `
        -InstallRoot $InstallRoot -DataRoot $DataRoot -NodeExecutable $node
    return
}

if ($Stage -eq "ImportJune11R2") {
    Assert-DeskFrozenProducerServices
    & (Join-Path $InstallRoot "current\deploy\windows\Test-DeskV5FrozenRelease.ps1") `
        -InstallRoot $InstallRoot -DataRoot $DataRoot -NodeExecutable $node

    $manifestPath = Resolve-June11R2ManifestPath -PackagePath $June11R2PackagePath
    $expectedManifestSha256 = "0fd35d23ff12a8e3bdc84781266458350b02a55bf00a7d5eb8e924846c13e054"
    $actualManifestSha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualManifestSha256 -ne $expectedManifestSha256) {
        throw "June 11 r2 manifest checksum mismatch. Expected=$expectedManifestSha256 Actual=$actualManifestSha256"
    }

    $databaseUrl = Resolve-FrozenMigrationDatabaseUrl -ExplicitValue $MigrationDatabaseUrl -DataRootPath $DataRoot
    $runtimeValues = Read-DeskEnvFile $envFile
    Assert-SamePostgresTarget `
        -RuntimeDatabaseUrl $runtimeValues["DATABASE_URL"] `
        -MigrationDatabaseUrl $databaseUrl
    $importer = Join-Path $InstallRoot "current\app\mcp_gpt_desk\scripts\import_tradingview_m1_backfill.mjs"
    $verifier = Join-Path $InstallRoot "current\app\mcp_gpt_desk\scripts\verify_v5_june11_r2_import.mjs"
    foreach ($script in @($importer, $verifier)) {
        if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
            throw "Required June 11 r2 release script is missing: $script"
        }
    }

    $previousDatabaseUrl = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Process")
    try {
        [Environment]::SetEnvironmentVariable("DATABASE_URL", $databaseUrl, "Process")

        $dryRun = Invoke-ReleaseNodeJsonCommand -Script $importer -Arguments @(
            "--manifest=$manifestPath",
            "--dry-run"
        )
        if ($dryRun.status -ne "DRY_RUN_VALIDATED" -or $dryRun.committed -ne $false) {
            throw "June 11 r2 dry-run did not produce DRY_RUN_VALIDATED/committed=false."
        }
        if (
            [int]$dryRun.cross_timeframe.expected_complete_buckets -ne 528 -or
            [int]$dryRun.cross_timeframe.complete_buckets -ne 528 -or
            [int]$dryRun.cross_timeframe.compared_buckets -ne 528 -or
            [int]$dryRun.cross_timeframe.missing_m5_buckets -ne 0 -or
            [int]$dryRun.cross_timeframe.exact_match_buckets -ne 528 -or
            [int]$dryRun.cross_timeframe.mismatched_buckets -ne 0 -or
            [int]$dryRun.cross_timeframe.divergent_buckets -ne 0 -or
            [int]$dryRun.rows.conflicts -ne 0 -or
            [int]$dryRun.rows.overwritten -ne 0
        ) {
            throw "June 11 r2 dry-run did not prove exact M1/M5 parity; import was not committed."
        }

        $import = Invoke-ReleaseNodeJsonCommand -Script $importer -Arguments @(
            "--manifest=$manifestPath"
        )
        if ($import.status -notin @("IMPORTED", "ALREADY_IMPORTED") -or $import.committed -ne $true) {
            throw "June 11 r2 import did not commit or confirm the exact prior receipt."
        }

        $rerun = Invoke-ReleaseNodeJsonCommand -Script $importer -Arguments @(
            "--manifest=$manifestPath"
        )
        if ($rerun.status -ne "ALREADY_IMPORTED" -or $rerun.committed -ne $true -or $rerun.idempotent -ne $true) {
            throw "June 11 r2 idempotency re-run did not return ALREADY_IMPORTED."
        }

        $verified = Invoke-ReleaseNodeJsonCommand -Script $verifier -Arguments @()
        if (
            $verified.status -ne "V5_JUNE11_R2_IMPORT_VERIFIED" -or
            $verified.manifest_sha256 -ne $expectedManifestSha256 -or
            [int]$verified.total_m1_rows -ne 2640 -or
            [int]$verified.expected_complete_m5_buckets -ne 528
        ) {
            throw "June 11 r2 persisted receipt or canonical row lineage verification failed."
        }
    } finally {
        [Environment]::SetEnvironmentVariable("DATABASE_URL", $previousDatabaseUrl, "Process")
    }

    Assert-DeskFrozenProducerServices
    & (Join-Path $InstallRoot "current\deploy\windows\Test-DeskV5FrozenRelease.ps1") `
        -InstallRoot $InstallRoot -DataRoot $DataRoot -NodeExecutable $node
    Write-FrozenReceipt -Status "june11_r2_import_verified" -Version $ReleaseName
    Write-Host "June 11 r2 import is exact, committed, idempotent and verified. No replay was prepared or started."
    return
}


if ($Stage -eq "PrepareJune11") {
    & (Join-Path $InstallRoot "current\deploy\windows\Test-DeskV5FrozenRelease.ps1") `
        -InstallRoot $InstallRoot -DataRoot $DataRoot -NodeExecutable $node
    Invoke-ReleaseNodeScript -RelativePath "scripts\prepare_v5_frozen_replay.mjs"
    & (Join-Path $InstallRoot "current\deploy\windows\Test-DeskV5FrozenRelease.ps1") `
        -InstallRoot $InstallRoot -DataRoot $DataRoot -NodeExecutable $node
    Write-FrozenReceipt -Status "june11_config_prepared_paused" -Version $ReleaseName
    return
}

if ($Stage -eq "RollbackFrozen") {
    $controlManifest = Get-Content -LiteralPath (Join-Path $InstallRoot "current\release-manifest.json") -Raw | ConvertFrom-Json
    $controlVersion = [string]$controlManifest.version
    if ($controlVersion -ne $ReleaseName) {
        throw "Rollback control release mismatch. Expected=$ReleaseName actual=$controlVersion"
    }
    $controlReleaseRoot = Assert-DeskDeploymentPath -Path (Join-Path $InstallRoot "releases\$controlVersion") -Label "ControlReleaseRoot"
    $controlWindowsRoot = Join-Path $controlReleaseRoot "deploy\windows"
    $drain = Join-Path $controlWindowsRoot "Invoke-DeskDrain.ps1"
    $previousFile = Join-Path $InstallRoot "previous-release.txt"
    if (-not (Test-Path -LiteralPath $previousFile -PathType Leaf)) { throw "No previous release is recorded." }
    $previousRelease = (Get-Content -LiteralPath $previousFile -Raw).Trim()
    $previousSeed = Join-Path $previousRelease "app\mcp_gpt_desk\scripts\seed_contracts.mjs"
    if (-not (Test-Path -LiteralPath $previousSeed -PathType Leaf)) {
        throw "Previous release cannot restore its contract activation: $previousSeed"
    }
    $envValues = Read-DeskEnvFile $envFile
    $pauseOutput = @(& $drain -Action Pause -DatabaseUrl $envValues["DATABASE_URL"] -ReleaseVersion "rollback-$ReleaseName" -PostgresBin $PostgresBin)
    $deploymentId = [string]($pauseOutput | Select-Object -Last 1)
    Stop-DeskProducerServices
    & $drain -Action Wait -DatabaseUrl $envValues["DATABASE_URL"] -DeploymentId $deploymentId -PostgresBin $PostgresBin
    & (Join-Path $controlWindowsRoot "Rollback-Desk.ps1") -InstallRoot $InstallRoot -DataRoot $DataRoot
    & $node "--env-file=$envFile" $previousSeed
    if ($LASTEXITCODE -ne 0) { throw "Previous contract activation restore failed; safety drain remains active." }
    & $drain -Action CompleteFrozen -DatabaseUrl $envValues["DATABASE_URL"] `
        -DeploymentId $deploymentId -PostgresBin $PostgresBin -CompletionStatus rolled_back
    & (Join-Path $controlWindowsRoot "Test-DeskV5FrozenRelease.ps1") `
        -InstallRoot $InstallRoot -DataRoot $DataRoot -NodeExecutable $node `
        -VerifierRoot $controlReleaseRoot -FreezeOnly
    Write-FrozenReceipt -Status "rolled_back_frozen" -Version (Split-Path $previousRelease -Leaf)
    return
}

}
function Invoke-ReleaseNodeScript {
    param([Parameter(Mandatory = $true)][string]$RelativePath)
    $script = Join-Path $InstallRoot "current\app\mcp_gpt_desk\$RelativePath"
    if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw "Release script is missing: $script" }
    & $node "--env-file=$envFile" $script
    if ($LASTEXITCODE -ne 0) { throw "Release script failed: $RelativePath" }
}

function Invoke-ReleaseNodeJsonCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Script,
        [string[]]$Arguments = @()
    )
    $global:LASTEXITCODE = 0
    $output = @(& $node $Script @Arguments)
    if ($LASTEXITCODE -ne 0) {
        throw "Release JSON command failed with exit code $LASTEXITCODE`: $Script"
    }
    $text = ($output -join [Environment]::NewLine).Trim()
    if (-not $text) { throw "Release JSON command returned no output: $Script" }
    try {
        return $text | ConvertFrom-Json
    } catch {
        throw "Release JSON command returned invalid JSON: $Script"
    }
}

function Resolve-June11R2ManifestPath {
    param([Parameter(Mandatory = $true)][string]$PackagePath)
    if ([string]::IsNullOrWhiteSpace($PackagePath)) {
        throw "-June11R2PackagePath is required for ImportJune11R2. The market-data package remains external to the application archive."
    }
    $resolved = [System.IO.Path]::GetFullPath($PackagePath)
    if (Test-Path -LiteralPath $resolved -PathType Leaf) {
        return $resolved
    }
    if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
        throw "June 11 r2 package path does not exist: $resolved"
    }
    foreach ($candidate in @(
        (Join-Path $resolved "tradingview_m1_backfill_manifest.json"),
        (Join-Path $resolved "import-ready\tradingview_m1_backfill_manifest.json")
    )) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return [System.IO.Path]::GetFullPath($candidate)
        }
    }
    throw "June 11 r2 manifest was not found under: $resolved"
}

function Resolve-FrozenMigrationDatabaseUrl {
    param(
        [string]$ExplicitValue,
        [Parameter(Mandatory = $true)][string]$DataRootPath
    )
    if (-not [string]::IsNullOrWhiteSpace($ExplicitValue)) { return $ExplicitValue }
    $fromProcess = [Environment]::GetEnvironmentVariable("DESK_DB_MIGRATION_URL")
    if (-not [string]::IsNullOrWhiteSpace($fromProcess)) { return $fromProcess }
    $maintenanceFile = Join-Path $DataRootPath "config\maintenance.env"
    if (Test-Path -LiteralPath $maintenanceFile -PathType Leaf) {
        $maintenanceValues = Read-DeskEnvFile $maintenanceFile
        if (-not [string]::IsNullOrWhiteSpace($maintenanceValues["DESK_DB_MIGRATION_URL"])) {
            return [string]$maintenanceValues["DESK_DB_MIGRATION_URL"]
        }
    }
    throw "DESK_DB_MIGRATION_URL is required in the process environment, protected maintenance.env, or -MigrationDatabaseUrl."
}

function Assert-InstalledFrozenRelease {
    param([Parameter(Mandatory = $true)][string]$ExpectedVersion)
    $manifestPath = Join-Path $InstallRoot "current\release-manifest.json"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Installed release manifest is missing: $manifestPath"
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.version -ne $ExpectedVersion) {
        throw "Installed release mismatch. Expected=$ExpectedVersion actual=$($manifest.version)"
    }
    if ($manifest.release_profile -ne "deterministic_strategy_v5_frozen") {
        throw "Installed release is not a deterministic_strategy_v5_frozen artifact."
    }
    return $manifest
}

function Assert-SamePostgresTarget {
    param(
        [Parameter(Mandatory = $true)][string]$RuntimeDatabaseUrl,
        [Parameter(Mandatory = $true)][string]$MigrationDatabaseUrl
    )
    $psql = Resolve-DeskPostgresTool -Name "psql" -PostgresBin $PostgresBin
    $sql = "SELECT json_build_object('database', current_database(), 'server_address', COALESCE(inet_server_addr()::text, 'local'), 'server_port', inet_server_port())::text;"
    $runtimeOutput = @(& $psql --tuples-only --no-align --dbname $RuntimeDatabaseUrl --command $sql)
    if ($LASTEXITCODE -ne 0) { throw "Unable to fingerprint the runtime PostgreSQL target." }
    $migrationOutput = @(& $psql --tuples-only --no-align --dbname $MigrationDatabaseUrl --command $sql)
    if ($LASTEXITCODE -ne 0) { throw "Unable to fingerprint the migration PostgreSQL target." }
    try {
        $runtime = (($runtimeOutput -join [Environment]::NewLine).Trim() | ConvertFrom-Json)
        $migration = (($migrationOutput -join [Environment]::NewLine).Trim() | ConvertFrom-Json)
    } catch {
        throw "PostgreSQL target fingerprint returned invalid JSON."
    }
    foreach ($field in @("database", "server_address", "server_port")) {
        if ([string]$runtime.$field -ne [string]$migration.$field) {
            throw "Migration PostgreSQL target differs from the runtime desk database ($field mismatch)."
        }
    }
    Write-Host "PostgreSQL target verified: $($runtime.database)@$($runtime.server_address):$($runtime.server_port)"
}


function Write-FrozenReceipt {
    param(
        [Parameter(Mandatory = $true)][string]$Status,
        [Parameter(Mandatory = $true)][string]$Version
    )
    $statusRoot = Join-Path $DataRoot "status"
    New-Item -ItemType Directory -Path $statusRoot -Force | Out-Null
    $receipt = [ordered]@{
        schema = "desk_v5_frozen_release_receipt_v1"
        status = $Status
        release_version = $Version
        recorded_at_utc = [DateTime]::UtcNow.ToString("o")
        lanes_activated = $false
        ai_workers_activated = $false
    }
    $path = Join-Path $statusRoot ("v5-frozen-release-{0}.json" -f [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss"))
    [System.IO.File]::WriteAllText($path, ($receipt | ConvertTo-Json -Depth 5), [System.Text.UTF8Encoding]::new($false))
    Write-Host "Receipt: $path"
}

Invoke-Main
