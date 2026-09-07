Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-DeskDeploymentPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )
    if ([string]::IsNullOrWhiteSpace($Path)) { throw "$Label must not be empty." }
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if ($fullPath -eq [System.IO.Path]::GetPathRoot($fullPath)) {
        throw "$Label cannot target a filesystem root: $fullPath"
    }
    return $fullPath
}

function Resolve-DeskExecutable {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string]$ExplicitPath = ""
    )
    if ($ExplicitPath) {
        if (-not (Test-Path -LiteralPath $ExplicitPath -PathType Leaf)) { throw "$Name not found: $ExplicitPath" }
        return [System.IO.Path]::GetFullPath($ExplicitPath)
    }
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) { throw "$Name was not found in PATH." }
    return $command.Source
}

function Invoke-DeskCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$WorkingDirectory = ""
    )
    $previous = Get-Location
    try {
        if ($WorkingDirectory) { Set-Location -LiteralPath $WorkingDirectory }
        $extension = [System.IO.Path]::GetExtension($FilePath).ToLowerInvariant()
        if ($extension -in @(".cmd", ".bat")) {
            # Execute command shims through cmd.exe and wait for the complete
            # child tree. Launching a .cmd directly from PowerShell started by
            # WSL/SSH may return before npm's node process has completed.
            $escapedArguments = @($Arguments | ForEach-Object {
                '"' + ([string]$_).Replace('"', '\"') + '"'
            })
            $commandLine = '""' + $FilePath.Replace('"', '""') + '" ' + ($escapedArguments -join " ") + '"'
            $process = Start-Process -FilePath $env:ComSpec `
                -ArgumentList @("/d", "/s", "/c", $commandLine) `
                -WorkingDirectory (Get-Location).Path `
                -NoNewWindow -Wait -PassThru
            $exitCode = $process.ExitCode
        } else {
            $global:LASTEXITCODE = 0
            & $FilePath @Arguments
            $exitCode = $LASTEXITCODE
        }
        if ($exitCode -ne 0) {
            throw "Command failed with exit code $exitCode`: $FilePath $($Arguments -join ' ')"
        }
    } finally {
        Set-Location $previous
    }
}

function Invoke-DeskCapturedCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$WorkingDirectory = ""
    )
    $stdout = [System.IO.Path]::GetTempFileName()
    $stderr = [System.IO.Path]::GetTempFileName()
    try {
        $escapedArguments = @($Arguments | ForEach-Object {
            '"' + ([string]$_).Replace('"', '\"') + '"'
        })
        $process = Start-Process -FilePath $FilePath `
            -ArgumentList $escapedArguments `
            -WorkingDirectory $(if ($WorkingDirectory) { $WorkingDirectory } else { (Get-Location).Path }) `
            -NoNewWindow -Wait -PassThru `
            -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        $output = Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue
        $errorOutput = Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue
        if ($process.ExitCode -ne 0) {
            throw "Command failed with exit code $($process.ExitCode): $FilePath $($Arguments -join ' ')`n$errorOutput"
        }
        return [string]$output
    } finally {
        Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
    }
}

function New-DeskSecret {
    param([int]$Bytes = 32)
    $buffer = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
    return [Convert]::ToBase64String($buffer).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Get-DeskDeploymentFileSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    } finally {
        $stream.Dispose()
        $algorithm.Dispose()
    }
}

function Read-DeskEnvFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        $separator = $trimmed.IndexOf("=")
        if ($separator -lt 1) { continue }
        $values[$trimmed.Substring(0, $separator)] = $trimmed.Substring($separator + 1)
    }
    return $values
}

function Set-DeskRestrictedAcl {
    param([Parameter(Mandatory = $true)][string]$Path)

    $item = Get-Item -LiteralPath $Path -Force
    $acl = if ($item.PSIsContainer) {
        New-Object System.Security.AccessControl.DirectorySecurity
    } else {
        New-Object System.Security.AccessControl.FileSecurity
    }
    $acl.SetAccessRuleProtection($true, $false)
    $inheritance = if ($item.PSIsContainer) {
        [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
            [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    } else {
        [System.Security.AccessControl.InheritanceFlags]::None
    }
    foreach ($sidValue in @("S-1-5-18", "S-1-5-32-544")) {
        $sid = New-Object System.Security.Principal.SecurityIdentifier($sidValue)
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $sid,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        [void]$acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Resolve-DeskCodexServiceExecutable {
    param([Parameter(Mandatory = $true)][string]$InstallDirectory)

    if (-not (Test-Path -LiteralPath $InstallDirectory -PathType Container)) {
        return $null
    }

    $nativeRoot = Join-Path $InstallDirectory "node_modules\@openai\codex\node_modules\@openai"
    if (Test-Path -LiteralPath $nativeRoot -PathType Container) {
        $native = Get-ChildItem -LiteralPath $nativeRoot -Filter "codex.exe" -File -Recurse |
            Sort-Object FullName |
            Select-Object -First 1
        if ($native) { return $native.FullName }
    }

    foreach ($name in @("codex.exe", "codex.cmd")) {
        $candidate = Join-Path $InstallDirectory $name
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }
    return $null
}

function Set-DeskCurrentJunction {
    param(
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [Parameter(Mandatory = $true)][string]$ReleaseRoot
    )
    $current = Join-Path $InstallRoot "current"
    if (Test-Path -LiteralPath $current) {
        $item = Get-Item -LiteralPath $current -Force
        if (-not ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
            throw "Refusing to replace a non-junction current path: $current"
        }
        # Windows PowerShell 5.1 can throw a NullReferenceException when
        # Remove-Item targets a directory junction. Directory.Delete removes
        # the verified reparse point itself and never traverses its target.
        [System.IO.Directory]::Delete($current)
    }
    New-Item -ItemType Junction -Path $current -Target $ReleaseRoot | Out-Null
}

function Stop-DeskServices {
    foreach ($name in @("DeskFuturesCaddy", "DeskFuturesCodexReplay01", "DeskFuturesCodexLive02", "DeskFuturesCodexLive01", "DeskFuturesAgentRuntimeResearch", "DeskFuturesAgentRuntimeSupervisor", "DeskFuturesTelegram", "DeskFuturesBrokerManagement", "DeskFuturesReplayPreparation", "DeskFuturesLiveRuntime", "DeskFuturesApi")) {
        $service = Get-Service -Name $name -ErrorAction SilentlyContinue
        if ($service -and $service.Status -ne "Stopped") {
            Stop-Service -Name $name -Force
            $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
        }
    }
}

function Get-DeskFrozenProducerServiceNames {
    return @(
        "DeskFuturesLiveRuntime",
        "DeskFuturesReplayPreparation",
        "DeskFuturesBrokerManagement",
        "DeskFuturesAgentRuntimeSupervisor",
        "DeskFuturesAgentRuntimeResearch",
        "DeskFuturesCodexLive01",
        "DeskFuturesCodexLive02",
        "DeskFuturesCodexReplay01"
    )
}

function Disable-DeskFrozenProducerServices {
    foreach ($name in @(Get-DeskFrozenProducerServiceNames)) {
        $service = Get-Service -Name $name -ErrorAction SilentlyContinue
        if ($service -and $service.Status -ne "Stopped") {
            Stop-Service -Name $name -Force
            $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
        }
        if ($service) { Set-Service -Name $name -StartupType Disabled }
    }
}

function Assert-DeskFrozenProducerServices {
    $violations = @()
    foreach ($name in @(Get-DeskFrozenProducerServiceNames)) {
        $service = Get-Service -Name $name -ErrorAction SilentlyContinue
        if (-not $service -or [string]$service.Status -ne "Stopped" -or [string]$service.StartType -ne "Disabled") {
            $violations += $name
        }
    }
    if ($violations.Count -gt 0) {
        throw "Frozen producer services are not stopped and disabled: $($violations -join ', ')"
    }
}

function Test-DeskNodeVersionCompatibility {
    param(
        [Parameter(Mandatory = $true)][string]$RuntimeVersion,
        [Parameter(Mandatory = $true)][string]$MinimumVersion
    )
    try {
        $runtime = [version]$RuntimeVersion.Trim().TrimStart("v")
        $minimum = [version]$MinimumVersion.Trim().TrimStart("v")
        return $runtime -ge $minimum
    } catch {
        return $false
    }
}

function Get-DeskProducerScheduledTaskNames {
    return @(
        "DeskFutures-UsGrainsShadowRuntime",
        "DeskFutures-GrainsCalendarRefresh"
    )
}

function Test-DeskScheduledTaskEnabled {
    param([Parameter(Mandatory = $true)][object]$Task)

    $enabledProperty = $null
    if ($Task.PSObject.Properties["Settings"] -and $null -ne $Task.Settings) {
        $enabledProperty = $Task.Settings.PSObject.Properties["Enabled"]
    }
    if ($enabledProperty) { return [bool]$enabledProperty.Value }
    return [string]$Task.State -ne "Disabled"
}

function Get-DeskProducerScheduledTaskState {
    $states = @()
    foreach ($name in @(Get-DeskProducerScheduledTaskNames)) {
        $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        $states += [pscustomobject][ordered]@{
            task_name = $name
            enabled = $null -ne $task -and (Test-DeskScheduledTaskEnabled -Task $task)
        }
    }
    return $states
}

function Stop-DeskProducerScheduledTasks {
    foreach ($name in @(Get-DeskProducerScheduledTaskNames)) {
        $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if (-not $task) { continue }
        Disable-ScheduledTask -TaskName $name | Out-Null
        $disabledTask = Get-ScheduledTask -TaskName $name -ErrorAction Stop
        if ([string]$disabledTask.State -eq "Running") { Stop-ScheduledTask -TaskName $name }
    }
}

function Restore-DeskProducerScheduledTaskState {
    param([Parameter(Mandatory = $true)][object[]]$State)

    foreach ($entry in @($State)) {
        $name = [string]$entry.task_name
        $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if (-not $task) { throw "Producer scheduled task missing after installation: $name" }
        if ([bool]$entry.enabled) {
            Enable-ScheduledTask -TaskName $name | Out-Null
        } else {
            Disable-ScheduledTask -TaskName $name | Out-Null
            if ([string]$task.State -eq "Running") { Stop-ScheduledTask -TaskName $name }
        }
    }
}

function Assert-DeskProducerScheduledTasksStopped {
    $violations = @()
    foreach ($name in @(Get-DeskProducerScheduledTaskNames)) {
        $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if ($task -and ((Test-DeskScheduledTaskEnabled -Task $task) -or [string]$task.State -eq "Running")) {
            $violations += $name
        }
    }
    if ($violations.Count -gt 0) {
        throw "Producer scheduled tasks are not stopped and disabled: $($violations -join ', ')"
    }
}


function Stop-DeskProducerServices {
    Stop-DeskProducerScheduledTasks
    foreach ($name in @("DeskFuturesCodexReplay01", "DeskFuturesCodexLive02", "DeskFuturesCodexLive01", "DeskFuturesAgentRuntimeResearch", "DeskFuturesAgentRuntimeSupervisor", "DeskFuturesTelegram", "DeskFuturesBrokerManagement", "DeskFuturesReplayPreparation", "DeskFuturesLiveRuntime")) {
        $service = Get-Service -Name $name -ErrorAction SilentlyContinue
        if ($service -and $service.Status -ne "Stopped") {
            Stop-Service -Name $name
            $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
        }
    }
}

function Start-DeskServices {
    foreach ($name in @("DeskFuturesApi", "DeskFuturesLiveRuntime", "DeskFuturesReplayPreparation", "DeskFuturesBrokerManagement", "DeskFuturesTelegram", "DeskFuturesAgentRuntimeSupervisor", "DeskFuturesAgentRuntimeResearch", "DeskFuturesCodexLive01", "DeskFuturesCodexLive02", "DeskFuturesCodexReplay01", "DeskFuturesCaddy")) {
        $service = Get-Service -Name $name -ErrorAction SilentlyContinue
        if ($service -and $service.Status -ne "Running" -and $service.StartType -ne "Disabled") {
            Start-Service -Name $name
        }
    }
}

function Test-DeskExactWindowsPath {
    param([Parameter(Mandatory = $true)][pscustomobject]$Spec)
    if ([string]::IsNullOrWhiteSpace([string]$Spec.Actual)) { return $false }
    try {
        $actualPath = [System.IO.Path]::GetFullPath([string]$Spec.Actual)
        $expectedPath = [System.IO.Path]::GetFullPath([string]$Spec.Expected)
        return [string]::Equals($actualPath, $expectedPath, [System.StringComparison]::OrdinalIgnoreCase)
    } catch {
        return $false
    }
}

function Get-DeskExactServiceEnvValue {
    param([Parameter(Mandatory = $true)][pscustomobject]$Spec)
    $matches = @($Spec.Service.env | Where-Object { [string]$_.name -ceq [string]$Spec.Name })
    if ($matches.Count -ne 1) { throw "Agent supervisor environment shape is invalid." }
    return [string]$matches[0].value
}

function Test-DeskUsGrainsSupervisorConfig {
    param([Parameter(Mandatory = $true)][pscustomobject]$Spec)
    $service = $Spec.Config.service
    if (-not $service -or [string]$service.id -cne "DeskFuturesAgentRuntimeSupervisor") { return $false }
    $projectRoot = Join-Path $Spec.InstallRoot "current\app\mcp_gpt_desk"
    $runner = Join-Path $projectRoot "scripts\run_us_grains_market_context_task_runner.mjs"
    $arguments = '--env-file="' + (Join-Path $Spec.DataRoot "config\desk.env") + '" "' + `
        (Join-Path $projectRoot "scripts\run_agent_runtime_supervisor.mjs") + '"'
    $env = { param($name) Get-DeskExactServiceEnvValue ([pscustomobject]@{ Service = $service; Name = $name }) }
    $path = { param($actual, $expected) Test-DeskExactWindowsPath ([pscustomobject]@{ Actual = $actual; Expected = $expected }) }
    if (-not (& $path ([string]$service.executable) $Spec.NodeExecutable)) { return $false }
    if (-not (& $path ([string]$service.workingdirectory) $projectRoot)) { return $false }
    if (-not [string]::Equals([string]$service.arguments, $arguments, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
    if ((& $env "DESK_AGENT_SUPERVISOR_SERVICE_ID") -cne "agent_runtime_supervisor_live") { return $false }
    if ((& $env "DESK_AGENT_WORKER_POOL") -cne "live" -or (& $env "DESK_AGENT_SUPERVISOR_LANE") -cne "live") { return $false }
    if ((& $env "DESK_AGENT_SCHEDULER_MODE") -cne "disabled") { return $false }
    if (-not (& $path (& $env "DESK_AGENT_SUPERVISOR_RUNNER_COMMAND") $Spec.NodeExecutable)) { return $false }
    if (-not (& $path (& $env "DESK_AGENT_SUPERVISOR_RUNNER_ARGS") $runner)) { return $false }
    if (-not (& $path (& $env "DESK_AGENT_SUPERVISOR_PROJECT_ROOT") $projectRoot)) { return $false }
    $policy = (& $env "DESK_AGENT_POOL_POLICY_JSON") | ConvertFrom-Json
    $pools = @($policy.pools.PSObject.Properties)
    if ($pools.Count -ne 1 -or $pools[0].Name -cne "live") { return $false }
    $live = $pools[0].Value
    return [int]$live.max_concurrent_workers -eq 1 `
        -and @($live.task_type_patterns).Count -eq 1 `
        -and [string]@($live.task_type_patterns)[0] -ceq "LIVE_US_GRAINS_MARKET_CONTEXT_*" `
        -and @($live.responsibilities).Count -eq 1 `
        -and [string]@($live.responsibilities)[0] -ceq "MARKET_CONTEXT_ANALYSIS"
}

function Resolve-DeskAgentRuntimeSupervisorInstallMode {
    param([Parameter(Mandatory = $true)][pscustomobject]$Spec)
    if ($Spec.KeepAiWorkersDisabled -or $Spec.AiWorkerMode -eq "disabled") { return "disabled" }
    if (-not (Test-Path -LiteralPath $Spec.ExistingConfigPath -PathType Leaf)) { return "shadow" }
    try {
        $config = New-Object System.Xml.XmlDocument
        $config.XmlResolver = $null
        $config.LoadXml((Get-Content -LiteralPath $Spec.ExistingConfigPath -Raw))
        $scope = [pscustomobject]@{ Config = $config; InstallRoot = $Spec.InstallRoot
            DataRoot = $Spec.DataRoot; NodeExecutable = $Spec.NodeExecutable }
        if (-not (Test-DeskUsGrainsSupervisorConfig $scope)) { return "shadow" }
        $mode = Get-DeskExactServiceEnvValue ([pscustomobject]@{ Service = $config.service; Name = "DESK_AGENT_SUPERVISOR_MODE" })
        if ($mode -notin @("disabled", "shadow", "active")) { return "shadow" }
        return $mode
    } catch {
        return "shadow"
    }
}

function Get-DeskGrainsCalendarTimeReasonCodes {
    param(
        [ValidateSet("as_of", "fresh_until")][string]$Field,
        [AllowNull()][object]$Value,
        [Parameter(Mandatory = $true)][datetime]$NowUtc,
        [int]$MaxCadenceMinutes = 60
    )

    $parsedUtc = [datetime]::MinValue
    $parseStyle = [Globalization.DateTimeStyles]::AdjustToUniversal
    if (-not [datetime]::TryParse([string]$Value, [Globalization.CultureInfo]::InvariantCulture, $parseStyle, [ref]$parsedUtc)) {
        if ($Field -eq "as_of") { return "grains_calendar_as_of_invalid" }
        return "grains_calendar_fresh_until_invalid"
    }
    if ($Field -eq "fresh_until") {
        if ($parsedUtc.ToUniversalTime() -le $NowUtc.ToUniversalTime()) { return "grains_calendar_freshness_expired" }
        return
    }
    $ageMinutes = ($NowUtc.ToUniversalTime() - $parsedUtc.ToUniversalTime()).TotalMinutes
    if ($ageMinutes -gt $MaxCadenceMinutes) { Write-Output "grains_calendar_as_of_stale" }
    if ($ageMinutes -lt -5) { Write-Output "grains_calendar_as_of_future" }
}

function Get-DeskGrainsCalendarDiagnostic {
    param(
        [ValidateSet("enabled", "disabled", "invalid")][string]$Policy = "disabled",
        [AllowNull()][object]$StatusDocument,
        [Parameter(Mandatory = $true)][datetime]$NowUtc,
        [int]$MaxCadenceMinutes = 60
    )
    $observedStatus = "MISSING"
    $asOfRaw = $null
    $freshUntilRaw = $null
    $sourceReasonCodes = @()
    if ($null -ne $StatusDocument) {
        $statusProperty = $StatusDocument.PSObject.Properties["status"]
        $asOfProperty = $StatusDocument.PSObject.Properties["asOfUtc"]
        $freshUntilProperty = $StatusDocument.PSObject.Properties["freshUntilUtc"]
        $reasonCodesProperty = $StatusDocument.PSObject.Properties["reasonCodes"]
        if ($statusProperty -and $statusProperty.Value) { $observedStatus = [string]$statusProperty.Value }
        if ($asOfProperty) { $asOfRaw = $asOfProperty.Value }
        if ($freshUntilProperty) { $freshUntilRaw = $freshUntilProperty.Value }
        if ($reasonCodesProperty) { $sourceReasonCodes = @($reasonCodesProperty.Value) }
    }
    if ($Policy -ne "enabled") {
        $invalidPolicy = $Policy -eq "invalid"
        return [pscustomobject][ordered]@{
            enabled = $false
            status = $(if ($invalidPolicy) { "CONFIG_INVALID" } else { "DISABLED_BY_POLICY" })
            observed_status = $observedStatus
            as_of_utc = $asOfRaw
            fresh_until_utc = $freshUntilRaw
            degraded = $invalidPolicy
            reason_codes = $(if ($invalidPolicy) { @("grains_calendar_config_invalid") } else { @() })
            source_reason_codes = $sourceReasonCodes
        }
    }

    $reasons = New-Object System.Collections.Generic.List[string]
    if ($observedStatus -ne "AVAILABLE") {
        $reasons.Add("grains_calendar_status_" + $observedStatus.ToLowerInvariant())
    } else {
        foreach ($reason in @(Get-DeskGrainsCalendarTimeReasonCodes `
            -Field as_of -Value $asOfRaw -NowUtc $NowUtc -MaxCadenceMinutes $MaxCadenceMinutes)) {
            $reasons.Add($reason)
        }
        foreach ($reason in @(Get-DeskGrainsCalendarTimeReasonCodes `
            -Field fresh_until -Value $freshUntilRaw -NowUtc $NowUtc -MaxCadenceMinutes $MaxCadenceMinutes)) {
            $reasons.Add($reason)
        }
    }

    return [pscustomobject][ordered]@{
        enabled = $true
        status = $observedStatus
        observed_status = $observedStatus
        as_of_utc = $asOfRaw
        fresh_until_utc = $freshUntilRaw
        degraded = $reasons.Count -gt 0
        reason_codes = @($reasons)
        source_reason_codes = $sourceReasonCodes
    }
}

function Invoke-DeskUpdateRecovery {
    param(
        [string]$DeploymentId = "",
        [Parameter(Mandatory = $true)][bool]$InstallAttempted,
        [Parameter(Mandatory = $true)][bool]$KeepFrozen,
        [Parameter(Mandatory = $true)][scriptblock]$MarkDeploymentFailed,
        [Parameter(Mandatory = $true)][scriptblock]$RollbackInstallation,
        [Parameter(Mandatory = $true)][scriptblock]$RestoreServices,
        [Parameter(Mandatory = $true)][scriptblock]$PreserveFrozenServices,
        [Parameter(Mandatory = $true)][scriptblock]$VerifyLocalHealth,
        [Parameter(Mandatory = $true)][scriptblock]$RestoreDrainControls
    )

    $errors = New-Object System.Collections.Generic.List[string]
    function Invoke-RecoveryAction {
        param([string]$Label, [scriptblock]$Action)
        try {
            @(& $Action) | Out-Null
            return $true
        } catch {
            $errors.Add("$Label`: $($_.Exception.Message)")
            return $false
        }
    }

    $attempted = (-not [string]::IsNullOrWhiteSpace($DeploymentId)) -or $InstallAttempted
    if (-not $attempted) {
        return [pscustomobject]@{ recovery_attempted = $false; health_verified = $false; controls_restored = $false; errors = @() }
    }
    if ($DeploymentId) { [void](Invoke-RecoveryAction "deployment_failure_audit" $MarkDeploymentFailed) }
    $candidateReady = -not $InstallAttempted
    if ($InstallAttempted) {
        $candidateReady = Invoke-RecoveryAction "installation_rollback" $RollbackInstallation
    }
    if ($candidateReady) {
        if ($KeepFrozen) {
            $candidateReady = Invoke-RecoveryAction "frozen_service_hold" $PreserveFrozenServices
        } else {
            [void](Invoke-RecoveryAction "service_restart" $RestoreServices)
        }
    }
    $healthy = $false
    if ($candidateReady) { $healthy = Invoke-RecoveryAction "local_health" $VerifyLocalHealth }
    $controlsRestored = $false
    if ($healthy) {
        $controlsRestored = if ($DeploymentId) {
            Invoke-RecoveryAction "drain_control_restore" $RestoreDrainControls
        } else {
            $true
        }
    }
    return [pscustomobject]@{
        recovery_attempted = $true
        health_verified = $healthy
        controls_restored = $controlsRestored
        errors = @($errors)
    }
}
