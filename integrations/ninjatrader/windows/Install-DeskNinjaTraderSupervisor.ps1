param(
  [string]$ProjectRoot = "C:\Users\CES\Desktop\TV_Automation_PREPROD",
  [string]$ControlRoot = "",
  [string]$ConnectionName = "Simulation",
  [string]$ConnectionProvider = "NinjaTrader",
  [switch]$Enable
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$SupervisorPath = Join-Path $ProjectRoot "integrations\ninjatrader\windows\DeskNinjaTraderSupervisor.ps1"
if (-not $ControlRoot) { $ControlRoot = Join-Path $ProjectRoot ".local\ninjatrader-control" }
$ControlPath = Join-Path $ControlRoot "startup-control.json"
$StartupEntry = Join-Path ([Environment]::GetFolderPath("Startup")) "DeskNinjaTraderSupervisor.cmd"
$ScheduledTaskName = "DeskFutures-NinjaTraderSupervisor"

if (-not (Test-Path -LiteralPath $SupervisorPath)) { throw "Superviseur introuvable: $SupervisorPath" }
if ([string]::IsNullOrWhiteSpace($ConnectionName)) { throw "Le nom de connexion NinjaTrader est obligatoire." }
if ([string]::IsNullOrWhiteSpace($ConnectionProvider)) { throw "Le provider de connexion NinjaTrader est obligatoire." }
New-Item -Path $ControlRoot -ItemType Directory -Force | Out-Null

if (-not (Test-Path -LiteralPath $ControlPath)) {
  @{
    schema_version = "desk_ninjatrader_startup_control_v1"
    enabled = [bool]$Enable
    revision = 0
    connection = @{
      provider = $ConnectionProvider
      name = $ConnectionName
      connect_on_startup = $ConnectionProvider -eq "Simulator"
      simulation_only = $true
    }
    restart_policy = @{
      restart_when_process_exits = $true
      stop_running_process_when_disabled = $false
      fail_closed_execution = $true
    }
    updated_at = [datetime]::UtcNow.ToString("o")
    updated_by = "local-installer"
    reason = "Installation initiale du superviseur Windows"
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ControlPath -Encoding UTF8
} else {
  $Control = Get-Content -LiteralPath $ControlPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $ConnectionChanged = [string]$Control.connection.provider -ne $ConnectionProvider -or [string]$Control.connection.name -ne $ConnectionName
  $Control.connection.provider = $ConnectionProvider
  $Control.connection.name = $ConnectionName
  $Control.connection.connect_on_startup = $ConnectionProvider -eq "Simulator"
  $Control.connection.simulation_only = $true
  if ($Enable) { $Control.enabled = $true }
  if ($Enable -or $ConnectionChanged) {
    $Control.updated_at = [datetime]::UtcNow.ToString("o")
    $Control.updated_by = "local-installer"
    $Control.reason = if ($Enable) { "Activation du superviseur Windows" } else { "Synchronisation de la connexion NinjaTrader autorisée" }
    $Control | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ControlPath -Encoding UTF8
  }
}

$Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$SupervisorPath`" -ProjectRoot `"$ProjectRoot`" -ControlRoot `"$ControlRoot`""
$TaskAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $Arguments
$TaskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$TaskPrincipal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
$TaskSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([timespan]::Zero) `
  -MultipleInstances IgnoreNew
Register-ScheduledTask `
  -TaskName $ScheduledTaskName `
  -Action $TaskAction `
  -Trigger $TaskTrigger `
  -Principal $TaskPrincipal `
  -Settings $TaskSettings `
  -Force | Out-Null

$Command = @"
@echo off
schtasks.exe /Run /TN "$ScheduledTaskName" >nul 2>&1
"@
Set-Content -LiteralPath $StartupEntry -Value $Command -Encoding ASCII

$SupervisorPattern = "-File\s+`"?" + [regex]::Escape($SupervisorPath) + "`"?(?:\s|$)"
$Existing = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -match $SupervisorPattern }
if (-not $Existing) {
  Start-ScheduledTask -TaskName $ScheduledTaskName
}

[pscustomobject]@{
  installed = $true
  enabled = [bool]((Get-Content -LiteralPath $ControlPath -Raw -Encoding UTF8 | ConvertFrom-Json).enabled)
  startup_entry = $StartupEntry
  supervisor = $SupervisorPath
  control = $ControlPath
  scheduled_task = $ScheduledTaskName
  connection_name = $ConnectionName
  connection_provider = $ConnectionProvider
} | ConvertTo-Json -Compress
