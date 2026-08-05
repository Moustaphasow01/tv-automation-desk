param(
    [string]$ProjectRoot = "",
    [string]$OutputRoot = "",
    [string]$Version = "",
    [switch]$SkipTests,
    [switch]$UsePrebuiltFront,
    [switch]$AllowDirty,
    [switch]$Replace
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

if (-not $ProjectRoot) { $ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent }
if (-not $OutputRoot) { $OutputRoot = Join-Path $ProjectRoot ".local\releases" }
$ProjectRoot = Assert-DeskDeploymentPath -Path $ProjectRoot -Label "ProjectRoot"
$OutputRoot = Assert-DeskDeploymentPath -Path $OutputRoot -Label "OutputRoot"
if (-not $Version) { $Version = (Get-Date).ToUniversalTime().ToString("yyyyMMdd.HHmmss") }
if ($Version -notmatch "^[a-zA-Z0-9._-]+$") { throw "Version contains unsupported characters." }

$npm = Resolve-DeskExecutable -Name "npm.cmd"
$git = Resolve-DeskExecutable -Name "git.exe"

# Processes launched from WSL can inherit PATHEXT=.CPL; preserve existing values while restoring executable and command shim resolution for npm descendants.
$pathExtensions = @(
    @($env:PATHEXT -split ";") |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ }
)
foreach ($requiredExtension in @(".COM", ".EXE", ".BAT", ".CMD")) {
    if ($pathExtensions -notcontains $requiredExtension) {
        $pathExtensions += $requiredExtension
    }
}
$env:PATHEXT = $pathExtensions -join ";"
Invoke-DeskCommand -FilePath $npm -Arguments @("--prefix", "packages/desk-contracts", "run", "generate") -WorkingDirectory $ProjectRoot
Invoke-DeskCommand -FilePath $npm -Arguments @("--prefix", "packages/desk-contracts", "run", "check:generated") -WorkingDirectory $ProjectRoot
Invoke-DeskCommand -FilePath $npm -Arguments @("run", "guard:strategy-contracts") -WorkingDirectory $ProjectRoot

# Materialize local file: dependencies as regular directories only when Windows
# will execute the source-tree tests. A certified prebuilt release may come from
# WSL, where these paths are valid symbolic links that Windows cannot replace.
if (-not $SkipTests) {
    Invoke-DeskCommand -FilePath $npm -Arguments @(
        "--prefix", "mcp_gpt_desk", "ci", "--ignore-scripts", "--install-links"
    ) -WorkingDirectory $ProjectRoot
}

$dirty = Invoke-DeskCapturedCommand -FilePath $git -Arguments @("-C", $ProjectRoot, "status", "--porcelain")
if ($dirty -and -not $AllowDirty) { throw "The repository is dirty. Commit/stage the intended release or pass -AllowDirty for an explicitly marked rehearsal artifact." }
$commit = Invoke-DeskCapturedCommand -FilePath $git -Arguments @("-C", $ProjectRoot, "rev-parse", "HEAD")
$commit = $commit.Trim()

if (-not $SkipTests) {
    Invoke-DeskCommand -FilePath $npm -Arguments @("run", "typecheck") -WorkingDirectory $ProjectRoot
    Invoke-DeskCommand -FilePath $npm -Arguments @("run", "test:react") -WorkingDirectory $ProjectRoot
    Invoke-DeskCommand -FilePath $npm -Arguments @("--prefix", "mcp_gpt_desk", "test") -WorkingDirectory $ProjectRoot
}
if ($UsePrebuiltFront) {
    $frontDist = Join-Path $ProjectRoot "dist"
    if (-not (Test-Path -LiteralPath (Join-Path $frontDist "index.html") -PathType Leaf)) {
        throw "-UsePrebuiltFront requires a populated dist directory."
    }
    $sourceMaps = @(Get-ChildItem -LiteralPath $frontDist -File -Recurse -Filter "*.map")
    if ($sourceMaps.Count -gt 0) {
        throw "Prebuilt front contains source maps: $($sourceMaps[0].FullName)"
    }
    $embeddedDevelopmentKey = Get-ChildItem -LiteralPath $frontDist -File -Recurse |
        Select-String -SimpleMatch @("local-preprod-key", "e2e-operator-key") -List
    if ($embeddedDevelopmentKey) {
        throw "Prebuilt front contains a local development or test API key."
    }
    Write-Host "Using verified prebuilt front from $frontDist"
} else {
    Invoke-DeskCommand -FilePath $npm -Arguments @("run", "build") -WorkingDirectory $ProjectRoot
}

New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
$releaseRoot = Join-Path $OutputRoot $Version
if (Test-Path -LiteralPath $releaseRoot) {
    if (-not $Replace) { throw "Release already exists: $releaseRoot" }
    $validated = Assert-DeskDeploymentPath -Path $releaseRoot -Label "ReleaseRoot"
    Remove-Item -LiteralPath $validated -Recurse -Force
}

New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $releaseRoot "front") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $releaseRoot "app\mcp_gpt_desk") -Force | Out-Null

Copy-Item -Path (Join-Path $ProjectRoot "dist\*") -Destination (Join-Path $releaseRoot "front") -Recurse -Force
foreach ($path in @("src", "scripts", "contracts", "schemas")) {
    Copy-Item -LiteralPath (Join-Path $ProjectRoot "mcp_gpt_desk\$path") -Destination (Join-Path $releaseRoot "app\mcp_gpt_desk\$path") -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $ProjectRoot "mcp_gpt_desk\package.json") -Destination (Join-Path $releaseRoot "app\mcp_gpt_desk\package.json") -Force
Copy-Item -LiteralPath (Join-Path $ProjectRoot "mcp_gpt_desk\package-lock.json") -Destination (Join-Path $releaseRoot "app\mcp_gpt_desk\package-lock.json") -Force
$packagesSource = Join-Path $ProjectRoot "packages"
$packagesTarget = Join-Path $releaseRoot "app\packages"
New-Item -ItemType Directory -Path $packagesTarget -Force | Out-Null
Get-ChildItem -LiteralPath $packagesSource -File -Recurse |
    Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]' } |
    ForEach-Object {
        $relative = $_.FullName.Substring($packagesSource.Length + 1)
        $target = Join-Path $packagesTarget $relative
        New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $_.FullName -Destination $target -Force
    }
foreach ($path in @("config", "deploy", "integrations", "infra\postgres\init")) {
    $target = Join-Path $releaseRoot $path
    New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $ProjectRoot $path) -Destination $target -Recurse -Force
}

# The backend depends on local file: packages. npm links those dependencies by
# default, but Compress-Archive does not preserve the resulting junctions across
# machines. --install-links vendors them as regular package directories so the
# release remains self-contained after extraction on the VPS.
Invoke-DeskCommand -FilePath $npm -Arguments @("ci", "--omit=dev", "--ignore-scripts", "--install-links") -WorkingDirectory (Join-Path $releaseRoot "app\mcp_gpt_desk")

$strategyLock = Get-Content -LiteralPath (Join-Path $ProjectRoot "config\strategy-contract-lock.json") -Raw | ConvertFrom-Json
$executionPolicyLock = Get-Content -LiteralPath (Join-Path $ProjectRoot "config\execution-policy-lock.json") -Raw | ConvertFrom-Json
$files = @()
[System.IO.Directory]::EnumerateFiles(
    $releaseRoot,
    "*",
    [System.IO.SearchOption]::AllDirectories
) | Sort-Object | ForEach-Object {
    $item = Get-Item -LiteralPath $_ -Force
    $relative = $item.FullName.Substring($releaseRoot.Length + 1).Replace("\", "/")
    $files += [ordered]@{
        path = $relative
        sha256 = Get-DeskDeploymentFileSha256 $item.FullName
        size_bytes = $item.Length
    }
}
$manifest = [ordered]@{
    schema = "desk_windows_release_v1"
    version = $Version
    created_at_utc = (Get-Date).ToUniversalTime().ToString("o")
    git_commit = $commit
    dirty = [bool]$dirty
    node_minimum = "20.6.0"
    release_profile = "deterministic_strategy_v5_frozen"
    strategy_contract_lock = $strategyLock
    execution_policy_lock = $executionPolicyLock
    files = $files
}
$manifestJson = $manifest | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText(
    (Join-Path $releaseRoot "release-manifest.json"),
    $manifestJson,
    [System.Text.UTF8Encoding]::new($false)
)
[System.IO.File]::WriteAllText((Join-Path $releaseRoot "release.version"), "$Version`n", [System.Text.UTF8Encoding]::new($false))

$archive = "$releaseRoot.zip"
if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $releaseRoot,
    $archive,
    [System.IO.Compression.CompressionLevel]::Fastest,
    $false
)
$archiveHash = Get-DeskDeploymentFileSha256 $archive
[System.IO.File]::WriteAllText("$archive.sha256", "$archiveHash  $([System.IO.Path]::GetFileName($archive))`n", [System.Text.UTF8Encoding]::new($false))

Write-Host "Release directory: $releaseRoot"
Write-Host "Release archive: $archive"
Write-Host "SHA256: $archiveHash"
