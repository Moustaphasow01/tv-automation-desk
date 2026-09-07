param(
    [string]$ProjectRoot = "",
    [string]$OutputRoot = "",
    [string]$Version = "",
    [string]$BackendCommit = "",
    [string]$FrontCommit = "",
    [string]$EvidenceCommit = "",
    [switch]$SkipTests,
    [switch]$UsePrebuiltFront,
    [switch]$AllowDirty,
    [switch]$Replace,
    [ValidateSet("standard", "deterministic_strategy_v5_frozen")]
    [string]$ReleaseProfile = "standard"
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

if (-not $ProjectRoot) { $ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent }
if (-not $OutputRoot) { $OutputRoot = Join-Path $ProjectRoot ".local\releases" }
$ProjectRoot = Assert-DeskDeploymentPath -Path $ProjectRoot -Label "ProjectRoot"
$OutputRoot = Assert-DeskDeploymentPath -Path $OutputRoot -Label "OutputRoot"
if (-not $Version) { $Version = (Get-Date).ToUniversalTime().ToString("yyyyMMdd.HHmmss") }
if ($Version -notmatch "^[a-zA-Z0-9._-]+$") { throw "Version contains unsupported characters." }

$npm = Resolve-DeskExecutable -Name "npm.cmd"
$node = Resolve-DeskExecutable -Name "node.exe"
$git = Resolve-DeskExecutable -Name "git.exe"
$nodeVersionText = (Invoke-DeskCapturedCommand -FilePath $node -Arguments @("--version")).Trim().TrimStart("v")
if (-not (Test-DeskNodeVersionCompatibility -RuntimeVersion $nodeVersionText -MinimumVersion "22.0.0")) {
    throw "Desk release build requires Node.js >= 22.0.0; found $nodeVersionText."
}

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

# A release must be reproducible from a clean clone. Install each independent
# package root before code generation, tests or the production front build.
Invoke-DeskCommand -FilePath $npm -Arguments @("ci", "--ignore-scripts") -WorkingDirectory $ProjectRoot
Invoke-DeskCommand -FilePath $npm -Arguments @("--prefix", "packages/desk-contracts", "run", "generate") -WorkingDirectory $ProjectRoot
Invoke-DeskCommand -FilePath $npm -Arguments @("--prefix", "packages/desk-contracts", "run", "check:generated") -WorkingDirectory $ProjectRoot
Invoke-DeskCommand -FilePath $npm -Arguments @("run", "guard:strategy-contracts") -WorkingDirectory $ProjectRoot

# Materialize local file: dependencies as regular directories only when Windows
# will execute the source-tree tests. A certified prebuilt release may come from
# WSL, where these paths are valid symbolic links that Windows cannot replace.
if (-not $SkipTests -or -not $UsePrebuiltFront) {
    Invoke-DeskCommand -FilePath $npm -Arguments @(
        "--prefix", "apps/desk-control-plane", "ci", "--ignore-scripts"
    ) -WorkingDirectory $ProjectRoot
}
if (-not $SkipTests) {
    Invoke-DeskCommand -FilePath $npm -Arguments @(
        "--prefix", "mcp_gpt_desk", "ci", "--ignore-scripts", "--install-links"
    ) -WorkingDirectory $ProjectRoot
}

$dirty = Invoke-DeskCapturedCommand -FilePath $git -Arguments @("-C", $ProjectRoot, "status", "--porcelain")
if ($dirty -and -not $AllowDirty) { throw "The repository is dirty. Commit/stage the intended release or pass -AllowDirty for an explicitly marked rehearsal artifact." }
$commit = Invoke-DeskCapturedCommand -FilePath $git -Arguments @("-C", $ProjectRoot, "rev-parse", "HEAD")
$commit = $commit.Trim()
if (-not $BackendCommit) { $BackendCommit = $commit }
if (-not $FrontCommit) { $FrontCommit = $commit }
if (-not $EvidenceCommit) { $EvidenceCommit = $commit }
foreach ($namedCommit in @($BackendCommit, $FrontCommit, $EvidenceCommit)) {
    if ($namedCommit -notmatch "^[0-9a-fA-F]{40}$") { throw "Release commit references must be full 40-character Git SHAs." }
}

if (-not $SkipTests) {
    Invoke-DeskCommand -FilePath $npm -Arguments @("run", "typecheck") -WorkingDirectory $ProjectRoot
    Invoke-DeskCommand -FilePath $npm -Arguments @("run", "test:react") -WorkingDirectory $ProjectRoot
    Invoke-DeskCommand -FilePath $npm -Arguments @("--prefix", "apps/desk-control-plane", "run", "test") -WorkingDirectory $ProjectRoot
    Invoke-DeskCommand -FilePath $npm -Arguments @("--prefix", "mcp_gpt_desk", "test") -WorkingDirectory $ProjectRoot
}
$frontDist = Join-Path $ProjectRoot "apps\desk-control-plane\dist"
if ($UsePrebuiltFront) {
    if (-not (Test-Path -LiteralPath (Join-Path $frontDist "index.html") -PathType Leaf)) {
        throw "-UsePrebuiltFront requires a populated apps\desk-control-plane\dist directory."
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
    $previousDataMode = $env:VITE_DATA_MODE
    $previousFrontApiBaseUrl = $env:VITE_FRONT_API_BASE_URL
    $previousFrontApiTimeoutMs = $env:VITE_FRONT_API_TIMEOUT_MS
    try {
        $env:VITE_DATA_MODE = "bff"
        $env:VITE_FRONT_API_BASE_URL = "/front-api/v1"
        if (-not $env:VITE_FRONT_API_TIMEOUT_MS) { $env:VITE_FRONT_API_TIMEOUT_MS = "12000" }
        Invoke-DeskCommand -FilePath $npm -Arguments @("--prefix", "apps/desk-control-plane", "run", "build") -WorkingDirectory $ProjectRoot
    } finally {
        $env:VITE_DATA_MODE = $previousDataMode
        $env:VITE_FRONT_API_BASE_URL = $previousFrontApiBaseUrl
        $env:VITE_FRONT_API_TIMEOUT_MS = $previousFrontApiTimeoutMs
    }
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

function Copy-DeskSharedPackages {
    param(
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$DestinationRoot
    )

    New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
    Get-ChildItem -LiteralPath $SourceRoot -File -Recurse |
        Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]' } |
        ForEach-Object {
            $relative = $_.FullName.Substring($SourceRoot.Length + 1)
            $target = Join-Path $DestinationRoot $relative
            New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $_.FullName -Destination $target -Force
        }
}

Copy-Item -Path (Join-Path $frontDist "*") -Destination (Join-Path $releaseRoot "front") -Recurse -Force
foreach ($path in @("src", "scripts", "contracts", "schemas")) {
    Copy-Item -LiteralPath (Join-Path $ProjectRoot "mcp_gpt_desk\$path") -Destination (Join-Path $releaseRoot "app\mcp_gpt_desk\$path") -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $ProjectRoot "mcp_gpt_desk\package.json") -Destination (Join-Path $releaseRoot "app\mcp_gpt_desk\package.json") -Force
Copy-Item -LiteralPath (Join-Path $ProjectRoot "mcp_gpt_desk\package-lock.json") -Destination (Join-Path $releaseRoot "app\mcp_gpt_desk\package-lock.json") -Force
$packagesSource = Join-Path $ProjectRoot "packages"
$packagesTarget = Join-Path $releaseRoot "app\packages"
Copy-DeskSharedPackages -SourceRoot $packagesSource -DestinationRoot $packagesTarget
# Root-level operational scripts are executed from the release root on the VPS
# and keep the same relative imports as in the source tree:
# scripts/stack/*.mjs -> ../../packages/<package>/index.js.
# Keep a second copy at the root so post-deploy gates remain self-contained.
Copy-DeskSharedPackages -SourceRoot $packagesSource -DestinationRoot (Join-Path $releaseRoot "packages")
foreach ($path in @("config", "deploy", "integrations", "infra\postgres\init", "scripts\stack", "scripts\runtime")) {
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
$frontAssetHashes = @(
    $files |
        Where-Object { $_.path -like "front/assets/*" } |
        ForEach-Object { [ordered]@{ path = $_.path; sha256 = $_.sha256 } }
)
$migrationLevel = (
    Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "infra\postgres\init") -File -Filter "*.sql" |
        Sort-Object Name |
        Select-Object -Last 1
).BaseName
$payloadHashMaterial = $files | ConvertTo-Json -Depth 10 -Compress
$payloadHasher = [System.Security.Cryptography.SHA256]::Create()
try {
    $payloadHashBytes = $payloadHasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($payloadHashMaterial))
    $artifactPayloadSha256 = ([System.BitConverter]::ToString($payloadHashBytes)).Replace("-", "").ToLowerInvariant()
} finally {
    $payloadHasher.Dispose()
}
$buildTimestamp = (Get-Date).ToUniversalTime().ToString("o")
$manifest = [ordered]@{
    schema = "desk_windows_release_v1"
    version = $Version
    created_at_utc = $buildTimestamp
    git_commit = $commit
    dirty = [bool]$dirty
    node_minimum = "22.0.0"
    release_profile = $ReleaseProfile
    strategy_contract_lock = $strategyLock
    execution_policy_lock = $executionPolicyLock
    files = $files
    releaseId = $Version
    backendCommit = $BackendCommit.ToLowerInvariant()
    frontCommit = $FrontCommit.ToLowerInvariant()
    evidenceCommit = $EvidenceCommit.ToLowerInvariant()
    artifactSha256 = $artifactPayloadSha256
    frontAssetHashes = $frontAssetHashes
    migrationLevel = $migrationLevel
    contractVersion = [ordered]@{
        master = [string]$strategyLock.active_contracts[0].schema_version
        monitor = [string]$strategyLock.active_contracts[1].schema_version
        executionPolicy = [string]$executionPolicyLock.policy.schema_version
    }
    buildTimestamp = $buildTimestamp
    AUTO_EXECUTION = $false
    PHYSICAL_LIVE = $false
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
