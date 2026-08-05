param(
    [Parameter(Mandatory = $true)][string]$ReleasePath,
    [Parameter(Mandatory = $true)][string]$Domain,
    [Parameter(Mandatory = $true)][string]$TlsEmail,
    [string]$InstallRoot = "C:\DeskFutures",
    [string]$DataRoot = "C:\ProgramData\DeskFutures",
    [string]$WinSwExecutable = "",
    [string]$CaddyExecutable = "",
    [string]$NodeExecutable = "",
    [string]$CodexExecutable = "codex",
    [ValidateSet("disabled", "shadow", "active")][string]$AiWorkerMode = "shadow",
    [string]$PostgresBin = "",
    [string]$MigrationDatabaseUrl = "",
    [string]$PostgresServiceName = "postgresql-x64-16",
    [switch]$KeepAiWorkersDisabled,
    [switch]$SkipServices,
    [switch]$SkipMaintenanceTasks,
    [switch]$SkipDatabaseMigration,
    [switch]$SkipStart,
    [switch]$Rehearsal
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

if ($Rehearsal -and (-not $SkipServices -or -not $SkipMaintenanceTasks -or -not $SkipDatabaseMigration -or -not $SkipStart)) {
    throw "-Rehearsal requires -SkipServices, -SkipMaintenanceTasks, -SkipDatabaseMigration, and -SkipStart."
}
if ($KeepAiWorkersDisabled -and $AiWorkerMode -ne "disabled") {
    throw "-KeepAiWorkersDisabled requires -AiWorkerMode disabled."
}
$expectedServices = if ($KeepAiWorkersDisabled) {
    "telegram_alert_worker"
} else {
    "live_runtime_scheduler,replay_preparation_worker,broker_management,telegram_alert_worker,codex_live_worker_01,codex_live_worker_02,codex_replay_worker_01"
}
$runtimeProfile = if ($KeepAiWorkersDisabled) { "deterministic_strategy_v5_frozen" } else { "standard" }


$InstallRoot = Assert-DeskDeploymentPath -Path $InstallRoot -Label "InstallRoot"
$DataRoot = Assert-DeskDeploymentPath -Path $DataRoot -Label "DataRoot"
$ReleasePath = Assert-DeskDeploymentPath -Path $ReleasePath -Label "ReleasePath"
if ($Domain -notmatch "^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$") { throw "Domain is invalid: $Domain" }
New-Item -ItemType Directory -Path $InstallRoot, $DataRoot, (Join-Path $InstallRoot "releases"), (Join-Path $DataRoot "config"), (Join-Path $DataRoot "objects"), (Join-Path $DataRoot "logs"), (Join-Path $DataRoot "backups"), (Join-Path $DataRoot "ninjatrader-control") -Force | Out-Null
if ($CodexExecutable -eq "codex") {
    $serviceCodex = Resolve-DeskCodexServiceExecutable -InstallDirectory (Join-Path $DataRoot "bin\codex")
    if ($serviceCodex) {
        $CodexExecutable = $serviceCodex
    }
}

$staging = Join-Path ([System.IO.Path]::GetTempPath()) ("desk-release-" + [guid]::NewGuid().ToString("N"))
try {
    if ((Get-Item -LiteralPath $ReleasePath).PSIsContainer) {
        $sourceRoot = $ReleasePath
    } else {
        if ([System.IO.Path]::GetExtension($ReleasePath) -ne ".zip") { throw "ReleasePath must be a release directory or zip archive." }
        $archiveChecksumFile = "$ReleasePath.sha256"
        if (-not (Test-Path -LiteralPath $archiveChecksumFile -PathType Leaf)) {
            throw "Release archive checksum is missing: $archiveChecksumFile"
        }
        $archiveExpected = ((Get-Content -LiteralPath $archiveChecksumFile -Raw).Trim() -split "\s+")[0].ToLowerInvariant()
        $archiveActual = Get-DeskDeploymentFileSha256 $ReleasePath
        if ($archiveActual -ne $archiveExpected) {
            throw "Release archive checksum mismatch. Expected=$archiveExpected actual=$archiveActual"
        }
        New-Item -ItemType Directory -Path $staging -Force | Out-Null
        Expand-Archive -LiteralPath $ReleasePath -DestinationPath $staging
        $sourceRoot = $staging
    }

    & (Join-Path $PSScriptRoot "Test-DeskRelease.ps1") -ReleaseRoot $sourceRoot
    $manifest = Get-Content -LiteralPath (Join-Path $sourceRoot "release-manifest.json") -Raw | ConvertFrom-Json
    $version = [string]$manifest.version
    $targetRelease = Join-Path $InstallRoot "releases\$version"
    if (-not (Test-Path -LiteralPath $targetRelease)) {
        New-Item -ItemType Directory -Path $targetRelease -Force | Out-Null
        Copy-Item -Path (Join-Path $sourceRoot "*") -Destination $targetRelease -Recurse -Force
    }
    $sourceFullPath = [System.IO.Path]::GetFullPath($sourceRoot).TrimEnd("\")
    $targetFullPath = [System.IO.Path]::GetFullPath($targetRelease).TrimEnd("\")
    if ($sourceFullPath -ine $targetFullPath) {
        & (Join-Path $PSScriptRoot "Test-DeskRelease.ps1") -ReleaseRoot $targetRelease
    }

    $envFile = Join-Path $DataRoot "config\desk.env"
    $maintenanceFile = Join-Path $DataRoot "config\maintenance.env"
    $recoveryFile = Join-Path $DataRoot "config\initial-secrets.txt"
    $pendingEnvContent = $null
    if (-not (Test-Path -LiteralPath $envFile)) {
        $databasePassword = [Environment]::GetEnvironmentVariable("DESK_DB_RUNTIME_PASSWORD")
        if ([string]::IsNullOrWhiteSpace($databasePassword) -or $databasePassword.Length -lt 20) {
            throw "DESK_DB_RUNTIME_PASSWORD must match the password used by Initialize-DeskPostgres.ps1 and contain at least 20 characters."
        }
        $contextDatabasePassword = [Environment]::GetEnvironmentVariable("DESK_DB_CONTEXT_PASSWORD")
        if ([string]::IsNullOrWhiteSpace($contextDatabasePassword) -or $contextDatabasePassword.Length -lt 20) {
            throw "DESK_DB_CONTEXT_PASSWORD must match the read-only role created by Initialize-DeskPostgres.ps1 and contain at least 20 characters."
        }
        $operatorPin = "operator-" + (New-DeskSecret 9)
        $oauthPin = "oauth-" + (New-DeskSecret 9)
        $tokens = [ordered]@{
            "__DESK_DOMAIN__" = $Domain
            "__DESK_DB_RUNTIME_PASSWORD__" = $databasePassword
            "__DESK_DB_CONTEXT_PASSWORD__" = $contextDatabasePassword
            "__DESK_MCP_API_KEY__" = (New-DeskSecret 36)
            "__DESK_OAUTH_ADMIN_PIN__" = $oauthPin
            "__DESK_OAUTH_TOKEN_SECRET__" = (New-DeskSecret 48)
            "__DESK_OPERATOR_ADMIN_PIN__" = $operatorPin
            "__DESK_OPERATOR_SESSION_SECRET__" = (New-DeskSecret 48)
            "__TRADINGVIEW_WEBHOOK_SECRET__" = (New-DeskSecret 36)
            "__DESK_NINJA_ADDON_SHARED_SECRET__" = (New-DeskSecret 48)
            "__DESK_DATA_ROOT__" = $DataRoot
            "__DESK_RELEASE_VERSION__" = $version
        }
        $template = Get-Content -LiteralPath (Join-Path $targetRelease "deploy\templates\desk.vps.env.example") -Raw
        foreach ($token in $tokens.GetEnumerator()) { $template = $template.Replace($token.Key, $token.Value) }
        $template = [regex]::Replace(
            $template,
            "(?m)^DESK_AI_WORKER_MODE=.*$",
            "DESK_AI_WORKER_MODE=$AiWorkerMode"
        )
        if ($template -match "(?m)^DESK_RUNTIME_PROFILE=") {
            $template = [regex]::Replace($template, "(?m)^DESK_RUNTIME_PROFILE=.*$", "DESK_RUNTIME_PROFILE=$runtimeProfile")
        } else {
            $template += "`nDESK_RUNTIME_PROFILE=$runtimeProfile`n"
        }
        $template = [regex]::Replace($template, "(?m)^DESK_EXPECTED_SERVICE_IDS=.*$", "DESK_EXPECTED_SERVICE_IDS=$expectedServices")
        [System.IO.File]::WriteAllText($envFile, $template, [System.Text.UTF8Encoding]::new($false))
        $recovery = @"
Desk Futures initial secrets
Created: $((Get-Date).ToUniversalTime().ToString("o"))
Domain: $Domain
DESK_DB_RUNTIME_PASSWORD=$databasePassword
DESK_DB_CONTEXT_PASSWORD=$contextDatabasePassword
DESK_OPERATOR_ADMIN_PIN=$operatorPin
DESK_OAUTH_ADMIN_PIN=$oauthPin

Move this file to the encrypted recovery vault, then remove it from the VPS.
"@
        [System.IO.File]::WriteAllText($recoveryFile, $recovery, [System.Text.UTF8Encoding]::new($false))
        if (-not $Rehearsal) {
            Set-DeskRestrictedAcl $envFile
            Set-DeskRestrictedAcl $recoveryFile
        }
        Write-Warning "Initial operator/OAuth credentials were written to $recoveryFile. Move it to the encrypted recovery vault."
    } else {
        $envContent = Get-Content -LiteralPath $envFile -Raw
        $pendingEnvContent = [regex]::Replace($envContent, "(?m)^DESK_RELEASE_VERSION=.*$", "DESK_RELEASE_VERSION=$version")
        if ($pendingEnvContent -match "(?m)^DESK_EXPECTED_SERVICE_IDS=") {
            $pendingEnvContent = [regex]::Replace(
                $pendingEnvContent,
                "(?m)^DESK_EXPECTED_SERVICE_IDS=.*$",
                "DESK_EXPECTED_SERVICE_IDS=$expectedServices"
            )
        } else {
            $pendingEnvContent += "`nDESK_EXPECTED_SERVICE_IDS=$expectedServices`n"
        }
        if ($pendingEnvContent -match "(?m)^DESK_AI_WORKER_MODE=") {
            $pendingEnvContent = [regex]::Replace(
                $pendingEnvContent,
                "(?m)^DESK_AI_WORKER_MODE=.*$",
                "DESK_AI_WORKER_MODE=$AiWorkerMode"
            )
        } else {
            $pendingEnvContent += "DESK_AI_WORKER_MODE=$AiWorkerMode`n"
        }
        if ($pendingEnvContent -match "(?m)^DESK_RUNTIME_PROFILE=") {
            $pendingEnvContent = [regex]::Replace(
                $pendingEnvContent,
                "(?m)^DESK_RUNTIME_PROFILE=.*$",
                "DESK_RUNTIME_PROFILE=$runtimeProfile"
            )
        } else {
            $pendingEnvContent += "DESK_RUNTIME_PROFILE=$runtimeProfile`n"
        }
        $aiWorkerDefaults = [ordered]@{
            "DESK_AI_WORKER_POLL_MS" = "15000"
            "DESK_AI_REPLAY_SELECTOR_MODE" = "next_ready_config"
            "DESK_AI_REPLAY_WORKER_GROUP" = "replay-v4"
            "DESK_AI_REPLAY_MAX_TRANSITIONS" = "6"
            "DESK_AI_AGENTIC_CONTEXT_ENABLED" = "true"
            "DESK_AI_CONTEXT_REQUIRE_DEDICATED_DATABASE_URL" = "true"
            "DESK_AI_CONTEXT_CAPABILITY_TTL_MS" = "900000"
            "DESK_AI_REPLAY_MAX_TRANSPORT_READS" = "80"
            "DESK_AI_REPLAY_CONTEXT_BUDGET_BYTES" = "8388608"
            "DESK_CODEX_TIMEOUT_MS" = "720000"
            "DESK_CODEX_MODEL" = ""
            "DESK_CODEX_REASONING_EFFORT" = "xhigh"
        }
        foreach ($setting in $aiWorkerDefaults.GetEnumerator()) {
            if ($pendingEnvContent -notmatch "(?m)^$([regex]::Escape($setting.Key))=") {
                $pendingEnvContent += "$($setting.Key)=$($setting.Value)`n"
            }
        }
    }

    if (-not (Test-Path -LiteralPath $maintenanceFile)) {
        $restoreDatabaseUrl = [Environment]::GetEnvironmentVariable("DESK_DB_RESTORE_URL")
        if (-not $SkipMaintenanceTasks -and [string]::IsNullOrWhiteSpace($restoreDatabaseUrl)) {
            throw "DESK_DB_RESTORE_URL is required to register the real backup restoration check."
        }
        if ($restoreDatabaseUrl) {
            [System.IO.File]::WriteAllText(
                $maintenanceFile,
                "DESK_DB_RESTORE_URL=$restoreDatabaseUrl`n",
                [System.Text.UTF8Encoding]::new($false)
            )
            if (-not $Rehearsal) { Set-DeskRestrictedAcl $maintenanceFile }
        }
    }

    $envValues = Read-DeskEnvFile $envFile
    if (-not $SkipDatabaseMigration) {
        if (-not $MigrationDatabaseUrl) {
            $MigrationDatabaseUrl = [Environment]::GetEnvironmentVariable("DESK_DB_MIGRATION_URL")
        }
        if ([string]::IsNullOrWhiteSpace($MigrationDatabaseUrl)) {
            throw "DESK_DB_MIGRATION_URL or -MigrationDatabaseUrl is required for owner-level schema migrations."
        }
        & (Join-Path $targetRelease "deploy\windows\database\Invoke-DeskSchema.ps1") `
            -DatabaseUrl $MigrationDatabaseUrl `
            -SchemaDirectory (Join-Path $targetRelease "infra\postgres\init") `
            -PostgresBin $PostgresBin `
            -ReleaseVersion $version
    }

    $current = Join-Path $InstallRoot "current"
    $previous = $null
    if (Test-Path -LiteralPath $current) {
        $previous = (Get-Item -LiteralPath $current -Force).Target
    }
    Stop-DeskServices
    try {
        Set-DeskCurrentJunction -InstallRoot $InstallRoot -ReleaseRoot $targetRelease
        if ($pendingEnvContent) {
            $nextEnvFile = "$envFile.next"
            [System.IO.File]::WriteAllText($nextEnvFile, $pendingEnvContent, [System.Text.UTF8Encoding]::new($false))
            Move-Item -LiteralPath $nextEnvFile -Destination $envFile -Force
        }
        if ($previous) {
            [System.IO.File]::WriteAllText(
                (Join-Path $InstallRoot "previous-release.txt"),
                [string]$previous,
                [System.Text.UTF8Encoding]::new($false)
            )
        }
    } catch {
        if ($previous) {
            Set-DeskCurrentJunction -InstallRoot $InstallRoot -ReleaseRoot ([string]$previous)
        } elseif (Test-Path -LiteralPath $current) {
            [System.IO.Directory]::Delete($current)
        }
        throw
    }

    if (-not $SkipServices) {
        & (Join-Path $PSScriptRoot "Install-DeskServices.ps1") `
            -InstallRoot $InstallRoot -DataRoot $DataRoot -Domain $Domain -TlsEmail $TlsEmail `
            -WinSwExecutable $WinSwExecutable -CaddyExecutable $CaddyExecutable `
            -NodeExecutable $NodeExecutable -CodexExecutable $CodexExecutable `
            -AiWorkerMode $AiWorkerMode -PostgresServiceName $PostgresServiceName `
            -KeepAiWorkersDisabled:$KeepAiWorkersDisabled -SkipStart:$SkipStart
    } elseif (-not $SkipStart) {
        Start-DeskServices
    }
    if (-not $SkipMaintenanceTasks) {
        & (Join-Path $PSScriptRoot "Register-DeskMaintenanceTasks.ps1") `
            -InstallRoot $InstallRoot -DataRoot $DataRoot -PostgresBin $PostgresBin
    }
    Write-Host "Desk Futures release $version installed."
} catch {
    Write-Error $_
    throw
} finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
