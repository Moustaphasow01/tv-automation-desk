param(
    [string]$ProjectDirectory = "",
    [string]$OutputDirectory = "",
    [string]$DatabaseName = "desk",
    [string]$DatabaseUser = "desk"
)

. (Join-Path $PSScriptRoot "DeskDatabase.Common.ps1")

if (-not $ProjectDirectory) {
    $ProjectDirectory = Split-Path (Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent) -Parent
}
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $ProjectDirectory ".local\database-exports"
}
$ProjectDirectory = Assert-DeskExplicitPath -Path $ProjectDirectory -Label "ProjectDirectory"
$OutputDirectory = Assert-DeskExplicitPath -Path $OutputDirectory -Label "OutputDirectory"
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$containerOutput = @(& docker compose --project-directory $ProjectDirectory ps -q postgres)
$containerId = [string]($containerOutput -join "")
$containerId = $containerId.Trim()
if ($LASTEXITCODE -ne 0 -or -not $containerId) { throw "The Docker PostgreSQL service is not running." }

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$fileName = "desk-docker-$stamp.dump"
$destination = Join-Path $OutputDirectory $fileName
$containerDump = "/tmp/$fileName"

try {
    Invoke-DeskExternal -FilePath "docker" -Arguments @(
        "exec", $containerId,
        "pg_dump", "--format=custom", "--compress=9", "--no-owner", "--no-privileges",
        "--username=$DatabaseUser", "--file=$containerDump", $DatabaseName
    )
    Invoke-DeskExternal -FilePath "docker" -Arguments @("cp", "$containerId`:$containerDump", $destination)
} finally {
    & docker exec $containerId rm -f $containerDump 2>$null
}

$checksum = Get-DeskFileSha256 $destination
[System.IO.File]::WriteAllText("$destination.sha256", "$checksum  $fileName`n", [System.Text.UTF8Encoding]::new($false))
Write-Host "Docker PostgreSQL export created: $destination"
Write-Host "SHA256: $checksum"
