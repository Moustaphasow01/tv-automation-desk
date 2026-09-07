. (Join-Path $PSScriptRoot "DeskDatabase.Common.ps1")

function Assert-DeskDatabaseExternalTest {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "Desk database external-process test failed: $Message" }
}

$childScript = Join-Path ([System.IO.Path]::GetTempPath()) ("desk-postgres-process-" + [guid]::NewGuid().ToString("N") + ".ps1")
$childSource = @'
param([string]$Mode, [string]$PassedArgument)
function Write-Utf8([System.IO.Stream]$Stream, [string]$Text) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $Stream.Write($bytes, 0, $bytes.Length)
    $Stream.Flush()
}
if ($Mode -eq "fail") {
    $failureText = ([char]0x00E9) + "chec PostgreSQL simul" + ([char]0x00E9)
    Write-Utf8 ([Console]::OpenStandardError()) $failureText
    exit 7
}
$noticeText = "NOTICE simul" + ([char]0x00E9) + "e en fran" + ([char]0x00E7) + "ais"
$successText = "r" + ([char]0x00E9) + "ussi"
Write-Utf8 ([Console]::OpenStandardError()) $noticeText
Write-Utf8 ([Console]::OpenStandardOutput()) "$env:PGCLIENTENCODING|$env:PGOPTIONS|$successText|$PassedArgument"
'@
$utf8 = [System.Text.UTF8Encoding]::new($true)
[System.IO.File]::WriteAllText($childScript, $childSource, $utf8)
$previousPgOptions = [Environment]::GetEnvironmentVariable("PGOPTIONS", "Process")
$hostExecutable = (Get-Process -Id $PID).Path
try {
    [Environment]::SetEnvironmentVariable("PGOPTIONS", "-c application_name=test_sentinel", "Process")
    $complexArgument = 'space quote" and trailing slash\'
    $output = Invoke-DeskExternal -FilePath $hostExecutable -Arguments @(
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", $childScript, "success", $complexArgument
    ) -PassThru
    $expectedSuccess = "UTF8|-c application_name=test_sentinel -c client_min_messages=warning|r" + ([char]0x00E9) + "ussi|$complexArgument"
    Assert-DeskDatabaseExternalTest ($output -eq $expectedSuccess) "UTF-8 or inherited PGOPTIONS was not preserved"
    Assert-DeskDatabaseExternalTest ([Environment]::GetEnvironmentVariable("PGOPTIONS", "Process") -eq "-c application_name=test_sentinel") "parent PGOPTIONS was changed"

    $secret = "postgresql://user:top-secret@127.0.0.1:5432/desk"
    $failure = $null
    try {
        Invoke-DeskExternal -FilePath $hostExecutable -Arguments @(
            "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", $childScript, "fail", $secret
        )
    } catch {
        $failure = $_
    }
    Assert-DeskDatabaseExternalTest ($null -ne $failure) "non-zero exit was accepted"
    Assert-DeskDatabaseExternalTest ($failure.Exception.Message -match "exit code 7") "non-zero exit code was lost"
    $expectedFailure = ([char]0x00E9) + "chec PostgreSQL simul" + ([char]0x00E9)
    Assert-DeskDatabaseExternalTest ($failure.Exception.Message -match $expectedFailure) "UTF-8 error was not decoded"
    Assert-DeskDatabaseExternalTest ($failure.Exception.Message -notmatch "top-secret") "command arguments leaked into the error"
} finally {
    [Environment]::SetEnvironmentVariable("PGOPTIONS", $previousPgOptions, "Process")
    Remove-Item -LiteralPath $childScript -Force -ErrorAction SilentlyContinue
}

Write-Host "Desk database UTF-8 external-process tests passed."
