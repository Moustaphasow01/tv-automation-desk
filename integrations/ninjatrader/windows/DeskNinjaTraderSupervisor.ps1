param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRoot,
  [string]$ControlRoot = "",
  [string]$NinjaExecutable = "C:\Program Files\NinjaTrader 8\bin\NinjaTrader.exe",
  [int]$IntervalSeconds = 10,
  [switch]$Once,
  [switch]$NoStart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $ControlRoot) { $ControlRoot = Join-Path $ProjectRoot ".local\ninjatrader-control" }
$ControlPath = Join-Path $ControlRoot "startup-control.json"
$RuntimePath = Join-Path $ControlRoot "supervisor-status.json"
$PidPath = Join-Path $ControlRoot "supervisor.pid"
$NinjaConfigPath = Join-Path $env:USERPROFILE "Documents\NinjaTrader 8\Config.xml"
$StartupEntry = Join-Path ([Environment]::GetFolderPath("Startup")) "DeskNinjaTraderSupervisor.cmd"
$DefaultConnectionName = "Simulation"
$DefaultConnectionProvider = "NinjaTrader"
$StartAttempts = [System.Collections.Generic.List[datetime]]::new()
$LastStartedAt = $null

New-Item -Path $ControlRoot -ItemType Directory -Force | Out-Null
Set-Content -LiteralPath $PidPath -Value $PID -Encoding ASCII

function Read-Control {
  if (-not (Test-Path -LiteralPath $ControlPath)) {
    return [pscustomobject]@{
      enabled = $false
      revision = 0
      connection = [pscustomobject]@{ provider = $DefaultConnectionProvider; name = $DefaultConnectionName; connect_on_startup = $false; simulation_only = $true }
    }
  }
  return Get-Content -LiteralPath $ControlPath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Write-RuntimeStatus([hashtable]$Status) {
  $TemporaryPath = "$RuntimePath.$PID.tmp"
  $Status.schema_version = "desk_ninjatrader_supervisor_status_v1"
  $Status.updated_at = [datetime]::UtcNow.ToString("o")
  $Status.supervisor_installed = Test-Path -LiteralPath $StartupEntry
  $Status.supervisor_running = $true
  $Status.supervisor_pid = $PID
  $Status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $TemporaryPath -Encoding UTF8
  Move-Item -LiteralPath $TemporaryPath -Destination $RuntimePath -Force
}

function Get-NinjaTraderProcess {
  return Get-Process -Name "NinjaTrader" -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Get-SimulatorConnectionNode([xml]$Config) {
  $Candidates = @($Config.SelectNodes("//ConnectOptions/*") | Where-Object { $_.Provider -and [string]$_.Provider -eq "Simulator" })
  if ($Candidates.Count -ne 1) {
    throw "Une connexion NinjaTrader Provider=Simulator unique est requise; trouvé: $($Candidates.Count)."
  }
  return $Candidates[0]
}

function Test-SimulatorAutoConnect {
  if (-not (Test-Path -LiteralPath $NinjaConfigPath)) { return $false }
  [xml]$Config = Get-Content -LiteralPath $NinjaConfigPath -Raw -Encoding UTF8
  $Connection = Get-SimulatorConnectionNode $Config
  return $Connection.ConnectOnStartup -and [string]$Connection.ConnectOnStartup -eq "true"
}

function Get-SimulatorConnectionName {
  if (-not (Test-Path -LiteralPath $NinjaConfigPath)) { return "Simulated Data Feed" }
  try {
    [xml]$Config = Get-Content -LiteralPath $NinjaConfigPath -Raw -Encoding UTF8
    $Connection = Get-SimulatorConnectionNode $Config
    if (-not [string]::IsNullOrWhiteSpace([string]$Connection.Name)) { return [string]$Connection.Name }
  } catch {}
  return "Simulated Data Feed"
}

function Enable-SimulatorAutoConnect {
  if (-not (Test-Path -LiteralPath $NinjaConfigPath)) { throw "Config.xml NinjaTrader introuvable: $NinjaConfigPath" }
  if (Get-NinjaTraderProcess) { throw "NinjaTrader doit être arrêté avant de modifier ConnectOnStartup." }

  [xml]$Config = Get-Content -LiteralPath $NinjaConfigPath -Raw -Encoding UTF8
  $Connection = Get-SimulatorConnectionNode $Config
  if (-not $Connection.ConnectOnStartup) { throw "Le noeud ConnectOnStartup de la connexion Simulator est absent." }

  $TradingOptions = $Config.SelectSingleNode("//TradingOptions/TradingOptions")
  if (-not $TradingOptions) { throw "TradingOptions NinjaTrader introuvable." }
  if ($TradingOptions.StartInGlobalSimulationMode) { $TradingOptions.StartInGlobalSimulationMode = "true" }
  if ($TradingOptions.IsGlobalSimulationMode) { $TradingOptions.IsGlobalSimulationMode = "true" }
  $Connection.ConnectOnStartup = "true"

  $BackupPath = "$NinjaConfigPath.desk-autostart.bak"
  if (-not (Test-Path -LiteralPath $BackupPath)) { Copy-Item -LiteralPath $NinjaConfigPath -Destination $BackupPath }
  $Config.Save($NinjaConfigPath)
  if (-not (Test-SimulatorAutoConnect)) { throw "La vérification ConnectOnStartup a échoué après écriture." }
  return $true
}

function Remove-OldStartAttempts([datetime]$Now) {
  for ($Index = $StartAttempts.Count - 1; $Index -ge 0; $Index--) {
    if ($StartAttempts[$Index] -lt $Now.AddMinutes(-15)) { $StartAttempts.RemoveAt($Index) }
  }
}

function Invoke-SupervisorCycle {
  $Now = [datetime]::UtcNow
  $Control = Read-Control
  $Enabled = $Control.enabled -eq $true
  $DesiredConnectionProvider = if ($Control.connection -and $Control.connection.provider) { [string]$Control.connection.provider } else { $DefaultConnectionProvider }
  $DesiredConnectionName = if ($Control.connection -and $Control.connection.name) { [string]$Control.connection.name } else { $DefaultConnectionName }
  $AutoConnectSupported = $DesiredConnectionProvider -eq "Simulator"
  $LastError = $null
  $AutoConnectConfigured = $false
  $Process = Get-NinjaTraderProcess
  $ActiveConnectionName = if ($AutoConnectSupported) { Get-SimulatorConnectionName } else { $DesiredConnectionName }

  try {
    if ($AutoConnectSupported) { $AutoConnectConfigured = Test-SimulatorAutoConnect }
    if ($Enabled -and -not $Process) {
      if ($AutoConnectSupported -and -not $AutoConnectConfigured) { $AutoConnectConfigured = Enable-SimulatorAutoConnect }
      Remove-OldStartAttempts $Now
      if ($StartAttempts.Count -ge 3) {
        $LastError = "Redémarrage suspendu après 3 tentatives en 15 minutes. Le superviseur réessaiera automatiquement après la temporisation."
      } elseif (-not $NoStart) {
        if (-not (Test-Path -LiteralPath $NinjaExecutable)) { throw "NinjaTrader.exe introuvable: $NinjaExecutable" }
        Start-Process -FilePath $NinjaExecutable -WorkingDirectory (Split-Path -Parent $NinjaExecutable)
        $StartAttempts.Add($Now)
        $LastStartedAt = $Now.ToString("o")
        Start-Sleep -Seconds 2
        $Process = Get-NinjaTraderProcess
        if (-not $Process) { throw "Le processus NinjaTrader ne s’est pas lancé." }
      }
    }
  } catch {
    $LastError = $_.Exception.Message
  }

  Write-RuntimeStatus @{
    enabled = $Enabled
    revision = [int]$Control.revision
    process_running = $null -ne $Process
    process_id = if ($Process) { $Process.Id } else { $null }
    process_window_title = if ($Process) { $Process.MainWindowTitle } else { $null }
    login_required = $null -ne $Process -and $Process.MainWindowTitle -match "^(Bienvenue|Welcome)"
    platform_ready = $null -ne $Process -and -not ($Process.MainWindowTitle -match "^(Bienvenue|Welcome)") -and -not [string]::IsNullOrWhiteSpace($Process.MainWindowTitle)
    auto_connect_supported = $AutoConnectSupported
    auto_connect_configured = $AutoConnectConfigured
    connection_name = $ActiveConnectionName
    connection_provider = $DesiredConnectionProvider
    simulation_only = $true
    restart_attempts_15m = $StartAttempts.Count
    last_started_at = if ($Process) { $Process.StartTime.ToUniversalTime().ToString("o") } else { $LastStartedAt }
    last_error = $LastError
    execution_auto_arm = $false
  }
}

try {
  do {
    Invoke-SupervisorCycle
    if (-not $Once) { Start-Sleep -Seconds ([Math]::Max(5, $IntervalSeconds)) }
  } while (-not $Once)
} finally {
  Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
}
