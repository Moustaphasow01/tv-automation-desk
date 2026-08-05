param(
    [string]$InstallRoot = "C:\DeskFutures",
    [string]$DataRoot = "C:\ProgramData\DeskFutures"
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

$node = Resolve-DeskExecutable -Name "node.exe"
$envFile = Join-Path $DataRoot "config\desk.env"
$script = Join-Path $InstallRoot "current\app\mcp_gpt_desk\scripts\run_runtime_maintenance.mjs"
if (-not (Test-Path -LiteralPath $envFile)) { throw "Desk environment missing: $envFile" }
if (-not (Test-Path -LiteralPath $script)) { throw "Desk maintenance script missing: $script" }
Invoke-DeskCommand -FilePath $node -Arguments @("--env-file=$envFile", $script)
