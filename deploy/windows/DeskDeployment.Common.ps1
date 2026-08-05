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
    foreach ($name in @("DeskFuturesCaddy", "DeskFuturesCodexReplay01", "DeskFuturesCodexLive02", "DeskFuturesCodexLive01", "DeskFuturesTelegram", "DeskFuturesBrokerManagement", "DeskFuturesReplayPreparation", "DeskFuturesLiveRuntime", "DeskFuturesApi")) {
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


function Stop-DeskProducerServices {
    foreach ($name in @("DeskFuturesCodexReplay01", "DeskFuturesCodexLive02", "DeskFuturesCodexLive01", "DeskFuturesTelegram", "DeskFuturesBrokerManagement", "DeskFuturesReplayPreparation", "DeskFuturesLiveRuntime")) {
        $service = Get-Service -Name $name -ErrorAction SilentlyContinue
        if ($service -and $service.Status -ne "Stopped") {
            Stop-Service -Name $name
            $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
        }
    }
}

function Start-DeskServices {
    foreach ($name in @("DeskFuturesApi", "DeskFuturesLiveRuntime", "DeskFuturesReplayPreparation", "DeskFuturesBrokerManagement", "DeskFuturesTelegram", "DeskFuturesCodexLive01", "DeskFuturesCodexLive02", "DeskFuturesCodexReplay01", "DeskFuturesCaddy")) {
        $service = Get-Service -Name $name -ErrorAction SilentlyContinue
        if ($service -and $service.Status -ne "Running" -and $service.StartType -ne "Disabled") {
            Start-Service -Name $name
        }
    }
}
