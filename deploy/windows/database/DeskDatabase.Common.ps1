Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-DeskPostgresTool {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string]$PostgresBin = ""
    )

    if ($PostgresBin) {
        $candidate = Join-Path $PostgresBin "$Name.exe"
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }

    $command = Get-Command "$Name.exe" -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    $roots = @(
        "C:\Program Files\PostgreSQL\17\bin",
        "C:\Program Files\PostgreSQL\16\bin",
        "C:\Program Files\PostgreSQL\15\bin"
    )
    foreach ($root in $roots) {
        $candidate = Join-Path $root "$Name.exe"
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }

    throw "PostgreSQL tool not found: $Name.exe. Install PostgreSQL 16+ or pass -PostgresBin."
}

function Assert-DeskExplicitPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if ([string]::IsNullOrWhiteSpace($Path)) { throw "$Label must not be empty." }
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $root = [System.IO.Path]::GetPathRoot($fullPath)
    if ($fullPath -eq $root) { throw "$Label cannot target a filesystem root: $fullPath" }
    return $fullPath
}

function Get-DeskFileSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Invoke-DeskExternal {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')"
    }
}

function ConvertTo-DeskPsqlLiteral {
    param([Parameter(Mandatory = $true)][string]$Value)
    return $Value.Replace("'", "''")
}
