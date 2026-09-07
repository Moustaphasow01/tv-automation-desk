param(
    [Parameter(Mandatory = $true)][string]$ReleasePath,
    [Parameter(Mandatory = $true)][string]$Domain,
    [Parameter(Mandatory = $true)][string]$TlsEmail,
    [string]$InstallRoot = "C:\DeskFutures",
    [string]$DataRoot = "C:\ProgramData\DeskFutures",
    [string]$WinSwExecutable = "",
    [string]$CaddyExecutable = "",
    [string]$NodeExecutable = "",
    [string]$CodexExecutable = "",
    [ValidateSet("", "disabled", "shadow", "active")][string]$AiWorkerMode = "",
    [string]$PostgresBin = "",
    [string]$MigrationDatabaseUrl = "",
    [string]$PostgresServiceName = "postgresql-x64-16",
    [switch]$SkipBackup,
    [switch]$SkipDrain,
    [switch]$KeepFrozen,
    [switch]$QuiesceFrozenState,
    [switch]$Rehearsal
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

if ($Rehearsal -and -not $SkipBackup) {
    throw "-Rehearsal requires -SkipBackup."
}

$envFile = Join-Path $DataRoot "config\desk.env"
if (-not (Test-Path -LiteralPath $envFile)) { throw "Existing Desk environment not found: $envFile" }
$envValues = Read-DeskEnvFile $envFile
if ($KeepFrozen) {
    if ($AiWorkerMode -and $AiWorkerMode -ne "disabled") {
        throw "-KeepFrozen is incompatible with AiWorkerMode=$AiWorkerMode."
    }
    $AiWorkerMode = "disabled"
}

if (-not $AiWorkerMode) {
    $AiWorkerMode = if ($envValues["DESK_AI_WORKER_MODE"]) {
        [string]$envValues["DESK_AI_WORKER_MODE"]
    } else {
        "shadow"
    }
}
if (-not $CodexExecutable) {
    $serviceCodex = Resolve-DeskCodexServiceExecutable -InstallDirectory (Join-Path $DataRoot "bin\codex")
    if ($serviceCodex) {
        $CodexExecutable = $serviceCodex
    } else {
        $resolvedCodex = Get-Command "codex.exe" -ErrorAction SilentlyContinue
        if (-not $resolvedCodex) { $resolvedCodex = Get-Command "codex.cmd" -ErrorAction SilentlyContinue }
        $CodexExecutable = if ($resolvedCodex) { $resolvedCodex.Source } else { "codex" }
    }
}

if (-not $WinSwExecutable) {
    $installedWinSw = Join-Path $DataRoot "services\DeskApi.exe"
    if (Test-Path -LiteralPath $installedWinSw) {
        $WinSwExecutable = $installedWinSw
    }
}
if (-not $CaddyExecutable) {
    $installedCaddy = Join-Path $DataRoot "bin\caddy.exe"
    if (Test-Path -LiteralPath $installedCaddy) {
        $CaddyExecutable = $installedCaddy
    }
}
if (-not $NodeExecutable) {
    $resolvedNode = Get-Command "node.exe" -ErrorAction SilentlyContinue
    if ($resolvedNode) {
        $NodeExecutable = $resolvedNode.Source
    }
}
if (-not $PostgresBin) {
    $resolvedPsql = Get-Command "psql.exe" -ErrorAction SilentlyContinue
    if ($resolvedPsql) {
        $PostgresBin = Split-Path -Parent $resolvedPsql.Source
    } else {
        $postgres16 = "C:\Program Files\PostgreSQL\16\bin"
        if (Test-Path -LiteralPath (Join-Path $postgres16 "psql.exe")) {
            $PostgresBin = $postgres16
        }
    }
}
if (-not $SkipBackup) {
    & (Join-Path $PSScriptRoot "database\Backup-DeskDatabase.ps1") `
        -DatabaseUrl $envValues["DATABASE_URL"] `
        -BackupDirectory (Join-Path $DataRoot "backups") `
        -PostgresBin $PostgresBin `
        -ReleaseVersion ($envValues["DESK_RELEASE_VERSION"])
    & (Join-Path $PSScriptRoot "database\Backup-DeskObjectStore.ps1") `
        -ObjectRoot $envValues["DESK_OBJECT_ROOT"] `
        -BackupDirectory (Join-Path $DataRoot "backups") `
        -OffsiteDirectory ($envValues["DESK_BACKUP_OFFSITE_DIRECTORY"]) `
        -ReleaseVersion ($envValues["DESK_RELEASE_VERSION"])
}

if ($Rehearsal) {
    & (Join-Path $PSScriptRoot "Install-Desk.ps1") `
        -ReleasePath $ReleasePath -Domain $Domain -TlsEmail $TlsEmail `
        -InstallRoot $InstallRoot -DataRoot $DataRoot `
        -SkipServices -SkipMaintenanceTasks -SkipDatabaseMigration -SkipStart -Rehearsal
} else {
    $probeRoot = $null
    $probeTemporary = $null
    $deploymentId = $null
    $installAttempted = $false
    try {
        if ((Get-Item -LiteralPath $ReleasePath).PSIsContainer) {
            $probeRoot = $ReleasePath
        } else {
            $probeTemporary = Join-Path ([System.IO.Path]::GetTempPath()) ("desk-update-probe-" + [guid]::NewGuid().ToString("N"))
            New-Item -ItemType Directory -Path $probeTemporary -Force | Out-Null
            Expand-Archive -LiteralPath $ReleasePath -DestinationPath $probeTemporary
            $probeRoot = $probeTemporary
        }
        & (Join-Path $probeRoot "deploy\windows\Test-DeskRelease.ps1") -ReleaseRoot $probeRoot
        $targetManifest = Get-Content -LiteralPath (Join-Path $probeRoot "release-manifest.json") -Raw | ConvertFrom-Json
        $targetVersion = [string]$targetManifest.version
        if ([string]$targetManifest.release_profile -eq "deterministic_strategy_v5_frozen") {
            $KeepFrozen = $true
            $QuiesceFrozenState = $true
            $AiWorkerMode = "disabled"
            if ($SkipDrain) {
                throw "-SkipDrain is forbidden for deterministic_strategy_v5_frozen releases."
            }
        }

        if (-not $MigrationDatabaseUrl) {
            $MigrationDatabaseUrl = [Environment]::GetEnvironmentVariable("DESK_DB_MIGRATION_URL")
        }
        if ([string]::IsNullOrWhiteSpace($MigrationDatabaseUrl)) {
            $maintenanceFile = Join-Path $DataRoot "config\maintenance.env"
            if (Test-Path -LiteralPath $maintenanceFile -PathType Leaf) {
                $maintenanceValues = Read-DeskEnvFile $maintenanceFile
                $MigrationDatabaseUrl = $maintenanceValues["DESK_DB_MIGRATION_URL"]
            }
        }
        if ([string]::IsNullOrWhiteSpace($MigrationDatabaseUrl)) {
            throw "DESK_DB_MIGRATION_URL must be supplied by process environment, protected maintenance.env, or -MigrationDatabaseUrl."
        }
        $keepAiWorkersDisabled = $KeepFrozen -or ($AiWorkerMode -eq "disabled")

        if (-not $SkipDrain) {
            $drainScript = Join-Path $probeRoot "deploy\windows\Invoke-DeskDrain.ps1"
            $pauseOutput = @(& $drainScript -Action Pause -DatabaseUrl $envValues["DATABASE_URL"] -ReleaseVersion $targetVersion -PostgresBin $PostgresBin)
            $deploymentId = [string]($pauseOutput | Select-Object -Last 1)
            Stop-DeskProducerServices
            if ($KeepFrozen) {
                Disable-DeskFrozenProducerServices
                Assert-DeskFrozenProducerServices
            }
            & $drainScript -Action Wait -DatabaseUrl $envValues["DATABASE_URL"] -ReleaseVersion $targetVersion -DeploymentId $deploymentId -PostgresBin $PostgresBin
        }

        if ($KeepFrozen) {
            if (-not $QuiesceFrozenState) {
                throw "A deterministic_strategy_v5_frozen release requires -QuiesceFrozenState before migrations."
            }
            & $NodeExecutable "--env-file=$envFile" `
                (Join-Path $probeRoot "app\mcp_gpt_desk\scripts\quiesce_v5_frozen_state.mjs") `
                "--release-version=$targetVersion" `
                "--actor=deployment-frozen"
            if ($LASTEXITCODE -ne 0) {
                throw "Frozen-state quiesce failed before database migration. Producers remain stopped and disabled."
            }
            & $NodeExecutable "--env-file=$envFile" `
                (Join-Path $probeRoot "app\mcp_gpt_desk\scripts\verify_v5_frozen_state.mjs") `
                "--freeze-only" `
                "--require-broker-lock"
            if ($LASTEXITCODE -ne 0) {
                throw "Strict freeze precondition failed before database migration."
            }
            Assert-DeskFrozenProducerServices
        }

        & (Join-Path $probeRoot "deploy\windows\database\Invoke-DeskSchema.ps1") `
            -DatabaseUrl $MigrationDatabaseUrl `
            -SchemaDirectory (Join-Path $probeRoot "infra\postgres\init") `
            -PostgresBin $PostgresBin `
            -ReleaseVersion $targetVersion
        & (Join-Path $probeRoot "deploy\windows\Test-DeskCanary.ps1") `
            -ReleaseRoot $probeRoot -EnvFile $envFile -NodeExecutable $NodeExecutable

        $installAttempted = $true
        & (Join-Path $PSScriptRoot "Install-Desk.ps1") `
            -ReleasePath $ReleasePath -Domain $Domain -TlsEmail $TlsEmail `
            -InstallRoot $InstallRoot -DataRoot $DataRoot `
            -WinSwExecutable $WinSwExecutable -CaddyExecutable $CaddyExecutable `
            -NodeExecutable $NodeExecutable -CodexExecutable $CodexExecutable -AiWorkerMode $AiWorkerMode `
            -PostgresBin $PostgresBin `
            -MigrationDatabaseUrl $MigrationDatabaseUrl `
            -PostgresServiceName $PostgresServiceName `
            -KeepAiWorkersDisabled:$keepAiWorkersDisabled

        & (Join-Path $InstallRoot "current\deploy\windows\Test-DeskLocalHealth.ps1") -DataRoot $DataRoot -AllowDisabledAiWorkers:$keepAiWorkersDisabled
        & (Join-Path $InstallRoot "current\deploy\windows\Test-DeskDeployment.ps1") -PublicBaseUrl "https://$Domain"
        if ($deploymentId) {
            & (Join-Path $InstallRoot "current\deploy\windows\Invoke-DeskDrain.ps1") `
                -Action $(if ($KeepFrozen) { "CompleteFrozen" } else { "Resume" }) -DatabaseUrl $envValues["DATABASE_URL"] -DeploymentId $deploymentId -PostgresBin $PostgresBin
        }
        if ($KeepFrozen) {
            & $NodeExecutable "--env-file=$envFile" `
                (Join-Path $InstallRoot "current\app\mcp_gpt_desk\scripts\verify_v5_frozen_state.mjs") `
                "--freeze-only" `
                "--require-broker-lock"
            if ($LASTEXITCODE -ne 0) { throw "Strict freeze postcondition failed." }
        }
        Write-Host $(if ($KeepFrozen) { "Desk update $targetVersion verified under strict freeze." } else { "Desk update $targetVersion verified and reopened." })
    } catch {
        $updateError = $_
        $recovery = Invoke-DeskUpdateRecovery `
            -DeploymentId $deploymentId `
            -InstallAttempted $installAttempted `
            -KeepFrozen $KeepFrozen `
            -MarkDeploymentFailed {
                & (Join-Path $probeRoot "deploy\windows\Invoke-DeskDrain.ps1") `
                    -Action Fail -DatabaseUrl $envValues["DATABASE_URL"] -DeploymentId $deploymentId `
                    -PostgresBin $PostgresBin -FailureReason $updateError.Exception.Message
            } `
            -RollbackInstallation {
                & (Join-Path $PSScriptRoot "Rollback-Desk.ps1") `
                    -InstallRoot $InstallRoot -DataRoot $DataRoot -SkipStart
            } `
            -RestoreServices { Start-DeskServices } `
            -PreserveFrozenServices {
                Disable-DeskFrozenProducerServices
                Assert-DeskFrozenProducerServices
                $frozenEnv = Get-Content -LiteralPath $envFile -Raw
                foreach ($setting in ([ordered]@{
                    DESK_RUNTIME_PROFILE = "deterministic_strategy_v5_frozen"
                    DESK_AI_WORKER_MODE = "disabled"
                    DESK_EXPECTED_SERVICE_IDS = "telegram_alert_worker"
                }).GetEnumerator()) {
                    $pattern = "(?m)^$([regex]::Escape($setting.Key))=.*$"
                    $frozenEnv = if ($frozenEnv -match $pattern) { [regex]::Replace($frozenEnv, $pattern, "$($setting.Key)=$($setting.Value)") } else { $frozenEnv + "`n$($setting.Key)=$($setting.Value)`n" }
                }
                [System.IO.File]::WriteAllText($envFile, $frozenEnv, [System.Text.UTF8Encoding]::new($false))
            } `
            -VerifyLocalHealth {
                & (Join-Path $InstallRoot "current\deploy\windows\Test-DeskLocalHealth.ps1") `
                    -DataRoot $DataRoot -AllowDisabledAiWorkers:$KeepFrozen
            } `
            -RestoreDrainControls {
                & (Join-Path $probeRoot "deploy\windows\Invoke-DeskDrain.ps1") `
                    -Action $(if ($KeepFrozen) { "CompleteFrozen" } else { "Resume" }) `
                    -DatabaseUrl $envValues["DATABASE_URL"] -DeploymentId $deploymentId `
                    -PostgresBin $PostgresBin -CompletionStatus rolled_back
                if ($KeepFrozen) {
                    & $NodeExecutable "--env-file=$envFile" `
                        (Join-Path $InstallRoot "current\app\mcp_gpt_desk\scripts\verify_v5_frozen_state.mjs") `
                        "--freeze-only" `
                        "--require-broker-lock"
                    if ($LASTEXITCODE -ne 0) { throw "Strict freeze rollback postcondition failed." }
                }
            }
        foreach ($recoveryError in @($recovery.errors)) {
            Write-Warning "Desk update recovery step failed; safety drain remains authoritative where controls were not restored. $recoveryError"
        }
        if ($recovery.recovery_attempted -and -not $recovery.health_verified) {
            Write-Warning "Automatic recovery did not establish local health; claims and broker execution remain drained."
        } elseif ($deploymentId -and -not $recovery.controls_restored) {
            Write-Warning "Automatic recovery could not restore the prior drain controls; the safety drain remains active."
        }
        throw $updateError
    } finally {
        if ($probeTemporary -and (Test-Path -LiteralPath $probeTemporary)) {
            Remove-Item -LiteralPath $probeTemporary -Recurse -Force
        }
    }
}
