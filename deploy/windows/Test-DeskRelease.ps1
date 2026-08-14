param(
    [Parameter(Mandatory = $true)][string]$ReleaseRoot,
    [switch]$RequireV5Frozen,
    [string]$NodeExecutable = ""
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

$ReleaseRoot = Assert-DeskDeploymentPath -Path $ReleaseRoot -Label "ReleaseRoot"
$manifestPath = Join-Path $ReleaseRoot "release-manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Release manifest missing: $manifestPath" }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.schema -ne "desk_windows_release_v1") { throw "Unsupported release schema: $($manifest.schema)" }

$failures = @()
$standardReleaseFiles = @(
    "front/index.html",
    "front/manifest.webmanifest",
    "front/service-worker.js",
    "front/icons/desk-control-plane.svg",
    "scripts/stack/check_demo_paper_gate.mjs",
    "scripts/stack/check_demo_paper_release_gate.mjs",
    "scripts/stack/check_vnext_operator_e2e.mjs",
    "scripts/stack/diagnose_demo_paper_readiness.mjs",
    "scripts/stack/diagnose_tradingview_freshness.mjs",
    "scripts/stack/diagnose_ninjatrader_addon_readiness.mjs",
    "scripts/runtime/cli-entrypoint.mjs",
    "packages/desk-time/index.js",
    "packages/desk-time/package.json"
)
foreach ($standardFile in $standardReleaseFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $ReleaseRoot $standardFile.Replace("/", "\")) -PathType Leaf)) {
        $failures += "standard-release-missing:$standardFile"
    }
}
$releaseProfileProperty = $manifest.PSObject.Properties["release_profile"]
$isV5Frozen = $releaseProfileProperty -and [string]$releaseProfileProperty.Value -eq "deterministic_strategy_v5_frozen"
if ($RequireV5Frozen -and -not $isV5Frozen) {
    $failures += "release-profile-not-frozen"
}
if ($isV5Frozen) {
    $masterLock = @($manifest.strategy_contract_lock.active_contracts | Where-Object { $_.registry_key -eq "master_contract" }) | Select-Object -First 1
    $monitorLock = @($manifest.strategy_contract_lock.active_contracts | Where-Object { $_.registry_key -eq "monitor_contract" }) | Select-Object -First 1
    if ($masterLock.schema_version -ne "5.4.0") { $failures += "master-lock-not-v5-4" }
    if ($monitorLock.schema_version -ne "2.4.0") { $failures += "monitor-lock-not-v2-4" }
    if ($manifest.execution_policy_lock.policy.schema_version -ne "4.3.0") {
        $failures += "execution-policy-lock-not-v4-3"
    }
    foreach ($component in @("execution_plan_contract", "monitor_command_contract")) {
        $entry = @($manifest.execution_policy_lock.components | Where-Object { $_.registry_key -eq $component }) | Select-Object -First 1
        if ($entry.schema_version -ne "1.4.0") { $failures += "$component-lock-not-v1-4" }
    }
    $catalogLock = @($manifest.execution_policy_lock.components | Where-Object { $_.registry_key -eq "condition_catalog_contract" }) | Select-Object -First 1
    if ($catalogLock.schema_version -ne "1.2.0") { $failures += "condition-catalog-lock-not-v1-2" }
    if ($manifest.execution_policy_lock.compiler.compiler_version -ne "1.4.0") {
        $failures += "deterministic-compiler-lock-not-v1-4"
    }
    if ($manifest.execution_policy_lock.compiler.condition_engine_version -ne "1.2.0") {
        $failures += "condition-engine-lock-not-v1-2"
    }
}

$requiredFiles = if ($isV5Frozen) { @(
    "app/mcp_gpt_desk/scripts/run_desk_ai_worker.mjs",
    "app/mcp_gpt_desk/scripts/run_agent_runtime_supervisor.mjs",
    "app/mcp_gpt_desk/scripts/run_desk_context_mcp.mjs",
    "app/mcp_gpt_desk/src/agent-runtime-postgres-repository.js",
    "app/mcp_gpt_desk/src/agent-runtime-supervisor.js",
    "app/mcp_gpt_desk/src/analytical-evidence-receipts.js",
    "app/mcp_gpt_desk/src/desk-ai-context-capability.js",
    "app/mcp_gpt_desk/src/desk-ai-context-policy.js",
    "app/mcp_gpt_desk/src/desk-ai-research-session.js",
    "app/mcp_gpt_desk/src/desk-ai-worker-envelope.js",
    "app/mcp_gpt_desk/src/codex-exec-adapter.js",
    "app/mcp_gpt_desk/src/desk-ai-worker-service.js",
    "deploy/windows/database/Ensure-DeskContextReadOnlyRole.ps1",
    "deploy/windows/database/Test-DeskLatestBackup.ps1",
    "deploy/windows/Set-DeskAiWorkerMode.ps1",
    "deploy/windows/Set-DeskAgentRuntimeSupervisorMode.ps1",
    "app/mcp_gpt_desk/scripts/run_research_agent_task_runner.mjs",
    "app/mcp_gpt_desk/src/research/research-backtest-review-runner.js",
    "app/mcp_gpt_desk/scripts/seed_contracts.mjs",
    "app/mcp_gpt_desk/scripts/verify_v5_frozen_state.mjs",
    "app/mcp_gpt_desk/scripts/prepare_v5_frozen_replay.mjs",
    "app/mcp_gpt_desk/scripts/verify_release_contract_integrity.mjs",
    "app/mcp_gpt_desk/scripts/verify_v5_june11_r2_import.mjs",
    "app/packages/desk-contracts/codegen/check-generated.mjs",
    "app/packages/desk-contracts/codegen/check-strategy-v5.mjs",
    "app/mcp_gpt_desk/scripts/import_tradingview_m1_backfill.mjs",
    "app/mcp_gpt_desk/src/v5-june11-r2-evidence.js",
    "app/mcp_gpt_desk/schemas/tradingview-m1-backfill-manifest.schema.json",
    "deploy/windows/Invoke-DeskV5FrozenRelease.ps1",
    "deploy/windows/Test-DeskV5FrozenRelease.ps1",
    "config/execution-policy-lock.json",
    "config/strategy-contract-lock.json",
    "infra/postgres/init/019_strategy_v5_risk_guard.sql",
    "infra/postgres/init/020_broker_rounding_risk_policy.sql",
    "infra/postgres/init/021_broker_decision_freshness_policy.sql",
    "infra/postgres/init/037_agent_runtime_registry.sql",
    "infra/postgres/init/038_agent_runtime_notifications.sql",
    "deploy/windows/services/DeskAgentRuntimeSupervisor.xml.template",
    "deploy/windows/services/DeskAgentRuntimeResearch.xml.template",
    "deploy/windows/services/DeskCodexLive01.xml.template",
    "deploy/windows/services/DeskCodexLive02.xml.template",
    "deploy/windows/services/DeskCodexReplay01.xml.template"
) } else { @() }
$declared = @{}
foreach ($entry in $manifest.files) {
    $declared[[string]$entry.path] = $true
    $path = Join-Path $ReleaseRoot ([string]$entry.path).Replace("/", "\")
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        $failures += "missing:$($entry.path)"
        continue
    }
    $actual = Get-DeskDeploymentFileSha256 $path
    if ($actual -ne $entry.sha256) { $failures += "checksum:$($entry.path)" }
}
foreach ($requiredFile in $requiredFiles) {
    if (-not $declared.ContainsKey($requiredFile)) { $failures += "required-undeclared:$requiredFile" }
}
Get-ChildItem -LiteralPath $ReleaseRoot -File -Recurse -Force | ForEach-Object {
    $relative = $_.FullName.Substring($ReleaseRoot.Length + 1).Replace("\", "/")
    if ($relative -notin @("release-manifest.json", "release.version") -and -not $declared.ContainsKey($relative)) {
        $failures += "undeclared:$relative"
    }
}
if ($failures.Count -gt 0) { throw "Release verification failed: $($failures -join ', ')" }
if ($isV5Frozen) {
    $node = Resolve-DeskExecutable -Name "node.exe" -ExplicitPath $NodeExecutable
    Invoke-DeskCommand -FilePath $node -Arguments @(
        (Join-Path $ReleaseRoot "app\mcp_gpt_desk\scripts\verify_release_contract_integrity.mjs"),
        "--release-root=$ReleaseRoot"
    ) -WorkingDirectory $ReleaseRoot
    Invoke-DeskCommand -FilePath $node -Arguments @(
        (Join-Path $ReleaseRoot "app\packages\desk-contracts\codegen\check-generated.mjs")
    ) -WorkingDirectory $ReleaseRoot
    Invoke-DeskCommand -FilePath $node -Arguments @(
        (Join-Path $ReleaseRoot "app\packages\desk-contracts\codegen\check-strategy-v5.mjs")
    ) -WorkingDirectory $ReleaseRoot
}
Write-Host "Release verified: $($manifest.version) ($($manifest.files.Count) files)"
