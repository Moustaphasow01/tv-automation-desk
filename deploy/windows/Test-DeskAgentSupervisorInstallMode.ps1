. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

function Assert-DeskAgentSupervisorInstallModeTest {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "Desk agent supervisor install-mode test failed: $Message" }
}

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("desk-agent-supervisor-install-mode-" + [guid]::NewGuid().ToString("N"))
$installRoot = "C:\DeskFutures"
$dataRoot = "C:\ProgramData\DeskFutures"
$node = "C:\Program Files\nodejs\node.exe"
$configPath = Join-Path $testRoot "DeskAgentRuntimeSupervisor.xml"

function Write-TestSupervisorConfig {
    param(
        [string]$Mode = "active",
        [string]$ServiceId = "DeskFuturesAgentRuntimeSupervisor",
        [string]$Pool = "live",
        [string]$Lane = "live",
        [string]$TaskPattern = "LIVE_US_GRAINS_MARKET_CONTEXT_*",
        [string]$SchedulerMode = "disabled",
        [string]$Runner = "C:\DeskFutures\current\app\mcp_gpt_desk\scripts\run_us_grains_market_context_task_runner.mjs",
        [string]$PolicySuffix = ""
    )
    $policy = '{&quot;pools&quot;:{&quot;live&quot;:{&quot;max_concurrent_workers&quot;:1,&quot;task_type_patterns&quot;:[&quot;' + $TaskPattern + '&quot;],&quot;responsibilities&quot;:[&quot;MARKET_CONTEXT_ANALYSIS&quot;]}}' + $PolicySuffix + '}'
    $xml = @"
<service>
  <id>$ServiceId</id>
  <executable>$node</executable>
  <arguments>--env-file=&quot;$dataRoot\config\desk.env&quot; &quot;$installRoot\current\app\mcp_gpt_desk\scripts\run_agent_runtime_supervisor.mjs&quot;</arguments>
  <workingdirectory>$installRoot\current\app\mcp_gpt_desk</workingdirectory>
  <env name="DESK_AGENT_SUPERVISOR_SERVICE_ID" value="agent_runtime_supervisor_live"/>
  <env name="DESK_AGENT_WORKER_POOL" value="$Pool"/>
  <env name="DESK_AGENT_POOL_POLICY_JSON" value="$policy"/>
  <env name="DESK_AGENT_SUPERVISOR_LANE" value="$Lane"/>
  <env name="DESK_AGENT_SUPERVISOR_MODE" value="$Mode"/>
  <env name="DESK_AGENT_SUPERVISOR_RUNNER_COMMAND" value="$node"/>
  <env name="DESK_AGENT_SUPERVISOR_RUNNER_ARGS" value="$Runner"/>
  <env name="DESK_AGENT_SUPERVISOR_PROJECT_ROOT" value="$installRoot\current\app\mcp_gpt_desk"/>
  <env name="DESK_AGENT_SCHEDULER_MODE" value="$SchedulerMode"/>
</service>
"@
    [System.IO.File]::WriteAllText($configPath, $xml, [System.Text.UTF8Encoding]::new($false))
}

function Resolve-TestMode {
    param([string]$AiWorkerMode = "shadow", [switch]$KeepAiWorkersDisabled)
    return Resolve-DeskAgentRuntimeSupervisorInstallMode ([pscustomobject]@{
        ExistingConfigPath = $configPath
        InstallRoot = $installRoot
        DataRoot = $dataRoot
        NodeExecutable = $node
        AiWorkerMode = $AiWorkerMode
        KeepAiWorkersDisabled = [bool]$KeepAiWorkersDisabled
    })
}

try {
    New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
    Assert-DeskAgentSupervisorInstallModeTest ((Resolve-TestMode) -eq "shadow") "first install did not default to shadow"

    Write-TestSupervisorConfig -Mode active
    Assert-DeskAgentSupervisorInstallModeTest ((Resolve-TestMode) -eq "active") "exact US grains active scope was not preserved"
    Assert-DeskAgentSupervisorInstallModeTest ((Resolve-TestMode -AiWorkerMode disabled) -eq "disabled") "explicit disabled AI mode did not close supervisor"
    Assert-DeskAgentSupervisorInstallModeTest ((Resolve-TestMode -KeepAiWorkersDisabled) -eq "disabled") "frozen worker hold did not close supervisor"

    Write-TestSupervisorConfig -Mode invalid
    Assert-DeskAgentSupervisorInstallModeTest ((Resolve-TestMode) -eq "shadow") "invalid prior mode was preserved"
    [System.IO.File]::WriteAllText($configPath, "<service>", [System.Text.UTF8Encoding]::new($false))
    Assert-DeskAgentSupervisorInstallModeTest ((Resolve-TestMode) -eq "shadow") "malformed XML did not fail closed to shadow"

    foreach ($case in @(
        @{ Label = "service"; Arguments = @{ ServiceId = "DeskFuturesAgentRuntimeResearch" } },
        @{ Label = "pool"; Arguments = @{ Pool = "research" } },
        @{ Label = "lane"; Arguments = @{ Lane = "research" } },
        @{ Label = "task pattern"; Arguments = @{ TaskPattern = "LIVE_*" } },
        @{ Label = "scheduler"; Arguments = @{ SchedulerMode = "active" } },
        @{ Label = "runner"; Arguments = @{ Runner = "C:\DeskFutures\current\app\mcp_gpt_desk\scripts\run_research_agent_task_runner.mjs" } }
    )) {
        $arguments = $case.Arguments
        Write-TestSupervisorConfig @arguments
        Assert-DeskAgentSupervisorInstallModeTest ((Resolve-TestMode) -eq "shadow") "$($case.Label) scope drift preserved active mode"
    }
} finally {
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}

Write-Host "Desk agent supervisor install-mode tests passed."
