#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const required = [
  "config/strategy-contract-lock.json",
  "config/execution-policy-lock.json",
  "deploy/caddy/Caddyfile.template",
  "deploy/templates/desk.vps.env.example",
  "deploy/windows/Build-DeskRelease.ps1",
  "deploy/windows/DeskDeployment.Common.ps1",
  "deploy/windows/Install-Desk.ps1",
  "deploy/windows/Install-DeskServices.ps1",
  "deploy/windows/Install-DeskPrerequisites.ps1",
  "deploy/windows/Test-DeskPrerequisites.ps1",
  "deploy/windows/Install-DeskNinjaTrader.ps1",
  "deploy/windows/Install-DeskCodex.ps1",
  "deploy/windows/Test-DeskCodexInference.ps1",
  "deploy/windows/Set-DeskAiWorkerMode.ps1",
  "deploy/windows/Set-DeskAgentRuntimeSupervisorMode.ps1",
  "deploy/windows/Prepare-DeskSim101.ps1",
  "deploy/windows/Invoke-DeskV5FrozenRelease.ps1",
  "deploy/windows/Test-DeskV5FrozenRelease.ps1",
  "deploy/windows/Register-DeskMaintenanceTasks.ps1",
  "deploy/windows/Run-GrainsCalendarRefresh.ps1",
  "deploy/windows/Test-DeskGrainsCalendarHealth.ps1",
  "deploy/windows/Set-DeskGrainsRiskPolicy.ps1",
  "deploy/windows/Test-DeskGrainsRiskPolicy.ps1",
  "deploy/windows/Test-DeskLocalHealth.ps1",
  "deploy/windows/Test-DeskCanary.ps1",
  "deploy/windows/Invoke-DeskDrain.ps1",
  "deploy/windows/Invoke-DeskDisasterRecovery.ps1",
  "deploy/windows/Invoke-DeskScheduledBackup.ps1",
  "deploy/windows/Invoke-DeskScheduledObjectBackup.ps1",
  "deploy/windows/Invoke-DeskRuntimeMaintenance.ps1",
  "deploy/windows/Invoke-DeskBackupVerification.ps1",
  "deploy/windows/Update-Desk.ps1",
  "deploy/windows/Test-DeskUpdateRecovery.ps1",
  "deploy/windows/Rollback-Desk.ps1",
  "deploy/windows/Test-DeskRelease.ps1",
  "deploy/windows/Test-DeskDeployment.ps1",
  "deploy/windows/database/Export-DeskDockerDatabase.ps1",
  "deploy/windows/database/Initialize-DeskPostgres.ps1",
  "deploy/windows/database/Ensure-DeskContextReadOnlyRole.ps1",
  "deploy/windows/database/Restore-DeskDatabase.ps1",
  "deploy/windows/database/DeskDatabase.Common.ps1",
  "deploy/windows/database/Test-DeskDatabaseExternal.ps1",
  "deploy/windows/database/Invoke-DeskSchema.ps1",
  "deploy/windows/database/Test-DeskTheoreticalExecutionPortfolioLineage.ps1",
  "deploy/windows/database/Backup-DeskDatabase.ps1",
  "deploy/windows/database/Backup-DeskObjectStore.ps1",
  "deploy/windows/database/Compare-DeskDatabases.ps1",
  "deploy/windows/database/Test-DeskLatestBackup.ps1",
  "deploy/windows/services/DeskApi.xml.template",
  "deploy/windows/services/DeskLiveRuntime.xml.template",
  "deploy/windows/services/DeskReplayPreparation.xml.template",
  "deploy/windows/services/DeskBrokerManagement.xml.template",
  "deploy/windows/services/DeskTelegram.xml.template",
  "deploy/windows/services/DeskAgentRuntimeSupervisor.xml.template",
  "deploy/windows/services/DeskCodexLive01.xml.template",
  "deploy/windows/services/DeskCodexLive02.xml.template",
  "deploy/windows/services/DeskCodexReplay01.xml.template",
  "deploy/windows/services/DeskCaddy.xml.template",
  "infra/postgres/init/012_deployment_readiness.sql",
  "infra/postgres/init/016_telegram_alerting.sql",
  "infra/postgres/init/017_trade_outcomes_resilience.sql",
  "infra/postgres/init/018_runtime_resilience.sql",
  "infra/postgres/init/019_strategy_v5_risk_guard.sql",
  "infra/postgres/init/020_broker_rounding_risk_policy.sql",
  "infra/postgres/init/021_broker_decision_freshness_policy.sql",
  "infra/postgres/init/037_agent_runtime_registry.sql",
  "infra/postgres/init/038_agent_runtime_notifications.sql",
  "infra/postgres/init/039_agent_conversation_affinity.sql",
  "infra/postgres/init/040_agent_execution_policy_snapshots.sql",
  "infra/postgres/init/041_agent_task_recovery.sql",
  "infra/postgres/init/042_agent_task_run_metrics.sql",
  "mcp_gpt_desk/scripts/seed_contracts.mjs",
  "mcp_gpt_desk/scripts/quiesce_v5_frozen_state.mjs",
  "mcp_gpt_desk/scripts/verify_v5_frozen_state.mjs",
  "mcp_gpt_desk/scripts/prepare_v5_frozen_replay.mjs",
  "mcp_gpt_desk/scripts/verify_v5_june11_r2_import.mjs",
  "mcp_gpt_desk/scripts/verify_release_contract_integrity.mjs",
  "mcp_gpt_desk/scripts/import_tradingview_m1_backfill.mjs",
  "mcp_gpt_desk/src/v5-june11-r2-evidence.js",
  "mcp_gpt_desk/schemas/tradingview-m1-backfill-manifest.schema.json",
  "mcp_gpt_desk/scripts/run_live_runtime_scheduler.mjs",
  "mcp_gpt_desk/scripts/run_replay_preparation_worker.mjs",
  "mcp_gpt_desk/scripts/run_runtime_maintenance.mjs",
  "mcp_gpt_desk/scripts/run_telegram_alert_worker.mjs",
  "mcp_gpt_desk/scripts/run_desk_ai_worker.mjs",
  "mcp_gpt_desk/scripts/run_agent_runtime_supervisor.mjs",
  "mcp_gpt_desk/src/agent-runtime-admin-service.js",
  "mcp_gpt_desk/src/agent-runtime-admin-tools.js",
  "mcp_gpt_desk/src/agent-runtime-metrics-postgres.js",
  "mcp_gpt_desk/src/agent-runtime-postgres-common.js",
  "mcp_gpt_desk/src/agent-runtime-postgres-repository.js",
  "mcp_gpt_desk/src/agent-runtime-recovery-postgres.js",
  "mcp_gpt_desk/src/agent-runtime-scheduler-service.js",
  "mcp_gpt_desk/src/agent-runtime-supervisor.js",
  "mcp_gpt_desk/src/agent-runtime-supervisor-host.js",
];

const content = new Map();
for (const relative of required) {
  content.set(relative, await readFile(resolve(root, relative), "utf8"));
}

const violations = [];
const env = content.get("deploy/templates/desk.vps.env.example");
for (const expected of [
  "DESK_PUBLIC_MODE=true",
  "DESK_BIND_HOST=127.0.0.1",
  "DESK_MCP_PUBLIC_BASE_URL=https://__DESK_DOMAIN__",
  "DESK_NINJA_ALLOW_LIVE_ACCOUNT=false",
  "DESK_BROKER_EXECUTION_ENABLED=false",
  "DESK_NINJA_KILL_SWITCH=true",
  "DESK_NINJA_MAX_CONTRACTS=0",
  "DESK_RUNTIME_PROFILE=standard",
  "DESK_AI_WORKER_MODE=shadow",
  "DESK_AI_WORKER_POLL_MS=15000",
  "DESK_AGENT_SUPERVISOR_MODE=shadow",
  "DESK_AGENT_SUPERVISOR_HOST_PLATFORM=windows-service",
  "DESK_AGENT_WORKER_POOL=live",
  "DESK_AGENT_POOL_POLICY_JSON=",
  "DESK_AGENT_SUPERVISOR_POLL_MS=15000",
  "DESK_AGENT_SUPERVISOR_LEASE_SECONDS=900",
  "DESK_AGENT_CONVERSATION_PROVIDER=codex",
  "DESK_AGENT_CONVERSATION_MAX_TURNS=12",
  "DESK_AGENT_MODEL=codex",
  "DESK_AGENT_REASONING_EFFORT=xhigh",
  "DESK_AGENT_TIMEOUT_MS=780000",
  "DESK_AGENT_TOKEN_BUDGET=0",
  "DESK_AGENT_MAX_OUTPUT_TOKENS=0",
  "DESK_AGENT_RETRY_BASE_DELAY_SECONDS=60",
  "DESK_AGENT_RETRY_MAX_DELAY_SECONDS=900",
  "DESK_AGENT_RETRY_MULTIPLIER=2",
  "DESK_AGENT_RETRY_JITTER_SECONDS=0",
  "DESK_AGENT_SCHEDULER_MODE=disabled",
  "DESK_AI_REPLAY_SELECTOR_MODE=next_ready_config",
  "DESK_AI_REPLAY_WORKER_GROUP=replay-v4",
  "DESK_AI_CONTEXT_DATABASE_URL=postgresql://desk_ai_context:__DESK_DB_CONTEXT_PASSWORD__@127.0.0.1:5432/desk",
  "DESK_AI_CONTEXT_REQUIRE_DEDICATED_DATABASE_URL=true",
  "DESK_GRAINS_CALENDAR_ENABLED=false",
]) {
  if (!env.includes(expected)) violations.push(`env_missing:${expected}`);
}
if (env.includes("VITE_DESK_API_KEY")) violations.push("env_must_not_compile_operator_key");

const caddy = content.get("deploy/caddy/Caddyfile.template");
for (const route of ["/status", "/readyz", "/api/*", "/mcp", "/oauth/*", "/.well-known/*"]) {
  if (!caddy.includes(route)) violations.push(`caddy_route_missing:${route}`);
}
if (!caddy.includes("127.0.0.1:8787")) violations.push("caddy_backend_not_loopback");
if (!caddy.includes("Strict-Transport-Security")) violations.push("caddy_hsts_missing");

const install = content.get("deploy/windows/Install-Desk.ps1");
const envTokens = [...env.matchAll(/__[A-Z0-9_]+__/g)].map((match) => match[0]);
for (const token of new Set(envTokens)) {
  if (!install.includes(token)) violations.push(`installer_does_not_render:${token}`);
}
for (const expected of ["DESK_DB_RUNTIME_PASSWORD", "DESK_DB_CONTEXT_PASSWORD", "DESK_DB_MIGRATION_URL", "DESK_DB_RESTORE_URL"]) {
  if (!install.includes(expected)) violations.push(`installer_database_secret_missing:${expected}`);
}
const initializePostgres = content.get("deploy/windows/database/Initialize-DeskPostgres.ps1");
for (const expected of [
  "DESK_DB_CONTEXT_PASSWORD",
  "desk_ai_context",
  "default_transaction_read_only",
  "GRANT SELECT ON ALL TABLES IN SCHEMA public TO $safeContext",
]) {
  if (!initializePostgres.includes(expected)) {
    violations.push(`context_readonly_role_missing:${expected}`);
  }
}
const contextRoleProvisioning = content.get("deploy/windows/database/Ensure-DeskContextReadOnlyRole.ps1");
for (const expected of [
  "REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM $safeContext",
  "GRANT SELECT ON ALL TABLES IN SCHEMA public TO $safeContext",
  "default_transaction_read_only=on",
  '$PSVersionTable.PSEdition -eq "Desktop"',
]) {
  if (!contextRoleProvisioning.includes(expected)) {
    violations.push(`context_role_provisioning_incomplete:${expected}`);
  }
}
if (contextRoleProvisioning.includes("$IsWindows")) {
  violations.push("context_role_provisioning_not_windows_powershell_5_compatible");
}

const grainsCalendarRefresh = content.get("deploy/windows/Run-GrainsCalendarRefresh.ps1");
for (const expected of ["refresh_usda_grains_calendar.mjs", "--output-root", "--status-file"]) {
  if (!grainsCalendarRefresh.includes(expected)) violations.push(`grains_calendar_refresh_wrapper_missing:${expected}`);
}
const maintenanceTasks = content.get("deploy/windows/Register-DeskMaintenanceTasks.ps1");
for (const expected of [
  'TaskName "DeskFutures-GrainsCalendarRefresh"',
  "Run-GrainsCalendarRefresh.ps1",
  "New-TimeSpan -Minutes 30",
  "ExecutionTimeLimit (New-TimeSpan -Minutes 5)",
  "-MultipleInstances IgnoreNew",
]) {
  if (!maintenanceTasks.includes(expected)) violations.push(`grains_calendar_schedule_contract_missing:${expected}`);
}

const backupVerification = content.get("deploy/windows/Invoke-DeskBackupVerification.ps1");
if (!backupVerification.includes("Test-DeskLatestBackup.ps1")) violations.push("backup_restore_wrapper_missing");
const backupRestore = content.get("deploy/windows/database/Test-DeskLatestBackup.ps1");
if (!backupRestore.includes("--clean") || !backupRestore.includes("--dbname")) {
  violations.push("backup_verification_does_not_restore");
}
if (
  !backupRestore.includes("& $tar.Source -tzf $objectBackup.FullName | Out-Null")
  || backupRestore.includes("Select-Object -First 1 | Out-Null")
) {
  violations.push("object_backup_verification_must_consume_complete_tar_listing");
}
for (const relative of ["deploy/windows/Test-DeskCanary.ps1", "deploy/windows/Invoke-DeskDrain.ps1"]) {
  if (/\bexit\s+[01]\b/i.test(content.get(relative))) {
    violations.push(`composable_script_must_not_exit_host:${relative}`);
  }
}
// PowerShell sources are intentionally stored with Windows CRLF endings. Normalize
// them before assertions that inspect line boundaries so the guard behaves the
// same under Windows, WSL and Linux CI.
const update = content.get("deploy/windows/Update-Desk.ps1").replace(/\r\n/g, "\n");
if (!update.includes("maintenance.env") || !update.includes('["DESK_DB_MIGRATION_URL"]')) {
  violations.push("update_protected_migration_credential_missing");
}
if (!update.includes('$keepAiWorkersDisabled = $KeepFrozen -or ($AiWorkerMode -eq "disabled")')) {
  violations.push("update_ai_worker_disabled_mode_not_bound_to_service_state");
}
if (!update.includes("-KeepAiWorkersDisabled:$keepAiWorkersDisabled")) {
  violations.push("update_ai_worker_disabled_mode_not_passed_to_install");
}
if (!update.includes("-AllowDisabledAiWorkers:$keepAiWorkersDisabled")) {
  violations.push("update_ai_worker_disabled_mode_not_passed_to_healthcheck");
}
const buildRelease = content.get("deploy/windows/Build-DeskRelease.ps1");
for (const dependencyInstall of [
  'Invoke-DeskCommand -FilePath $npm -Arguments @("ci", "--ignore-scripts")',
  '"--prefix", "apps/desk-control-plane", "ci", "--ignore-scripts"',
  '"--prefix", "mcp_gpt_desk", "ci", "--ignore-scripts", "--install-links"',
]) {
  if (!buildRelease.includes(dependencyInstall)) {
    violations.push(`release_clean_clone_dependency_install_missing:${dependencyInstall}`);
  }
}
if (
  !buildRelease.includes('[ValidateSet("standard", "deterministic_strategy_v5_frozen")]')
  || !buildRelease.includes('$ReleaseProfile = "standard"')
  || !buildRelease.includes("release_profile = $ReleaseProfile")
  || !buildRelease.includes("execution_policy_lock = $executionPolicyLock")
) {
  violations.push("release_manifest_profile_lock_missing");
}
const frozenRelease = content.get("deploy/windows/Invoke-DeskV5FrozenRelease.ps1");
if (!frozenRelease.includes('ReleaseProfile = "deterministic_strategy_v5_frozen"')) violations.push("v5_frozen_manifest_profile_not_explicit");
if (!buildRelease.includes('"schemas"')) violations.push("release_archive_mcp_schemas_missing");
if (!update.includes("KeepFrozen") || !update.includes('"CompleteFrozen"') || !update.includes("KeepAiWorkersDisabled")) violations.push("update_can_reopen_v5_release");
if (!update.includes("QuiesceFrozenState") || !update.includes("quiesce_v5_frozen_state.mjs") || !update.includes("--require-broker-lock")) violations.push("v5_frozen_quiesce_not_enforced");
const drain = content.get("deploy/windows/Invoke-DeskDrain.ps1");
if (!drain.includes('if ($Action -eq "CompleteFrozen")') || !drain.includes("ENGINE_V5_VALIDATION_HOLD")) violations.push("strict_frozen_drain_missing");
if (!drain.includes("DEPLOYMENT_RECOVERY_FAILURE") || !drain.includes("Safety drain was reasserted")) {
  violations.push("failed_deployment_does_not_reassert_safety_drain");
}

for (const name of ["DeskApi", "DeskLiveRuntime", "DeskReplayPreparation", "DeskBrokerManagement", "DeskTelegram", "DeskAgentRuntimeSupervisor", "DeskCodexLive01", "DeskCodexLive02", "DeskCodexReplay01", "DeskCaddy"]) {
  const xml = content.get(`deploy/windows/services/${name}.xml.template`);
  if (!xml.includes("<startmode>Automatic</startmode>")) violations.push(`service_not_automatic:${name}`);
  if (!xml.includes('<onfailure action="restart"')) violations.push(`service_restart_missing:${name}`);
}
const agentSupervisorTemplate = content.get("deploy/windows/services/DeskAgentRuntimeSupervisor.xml.template");
if (!agentSupervisorTemplate.includes('<env name="DESK_CODEX_BIN" value="__CODEX_EXE__"/>')) {
  violations.push("agent_supervisor_codex_executable_missing");
}
if (!agentSupervisorTemplate.includes('<env name="CODEX_HOME" value="__CODEX_HOME__"/>')) {
  violations.push("agent_supervisor_codex_home_missing");
}

const scheduler = content.get("mcp_gpt_desk/scripts/run_live_runtime_scheduler.mjs");
if (!scheduler.includes("pg_try_advisory_lock")) violations.push("live_scheduler_lock_missing");
if (!scheduler.includes("DETERMINISTIC_ENGINE_CADENCE_MINUTES")) violations.push("live_scheduler_engine_m1_missing");
if (!scheduler.includes("GPT_MONITOR_CADENCE_MINUTES")) violations.push("live_scheduler_gpt_m15_missing");

const replayPreparation = content.get("mcp_gpt_desk/scripts/run_replay_preparation_worker.mjs");
if (!replayPreparation.includes("pg_try_advisory_lock")) violations.push("replay_preparation_worker_lock_missing");
if (!replayPreparation.includes("desk_service_heartbeats")) violations.push("replay_preparation_worker_heartbeat_missing");

const telegram = content.get("mcp_gpt_desk/scripts/run_telegram_alert_worker.mjs");
if (!telegram.includes("pg_try_advisory_lock")) violations.push("telegram_worker_lock_missing");
if (!telegram.includes("recoverInterruptedDeliveries")) violations.push("telegram_worker_recovery_missing");

const aiWorker = content.get("mcp_gpt_desk/scripts/run_desk_ai_worker.mjs");
if (!aiWorker.includes("pg_try_advisory_lock")) violations.push("ai_worker_lock_missing");
if (!aiWorker.includes("LISTEN desk_ai_work_ready")) violations.push("ai_worker_notify_listener_missing");
if (!aiWorker.includes("replayAdmission")) violations.push("ai_worker_live_priority_missing");
if (aiWorker.includes('heartbeat("disabled"')) {
  violations.push("ai_worker_heartbeat_uses_invalid_database_status");
}
const agentSupervisor = content.get("mcp_gpt_desk/scripts/run_agent_runtime_supervisor.mjs");
if (!agentSupervisor.includes("pg_try_advisory_lock")) violations.push("agent_supervisor_lock_missing");
if (!agentSupervisor.includes("LISTEN desk_agent_runtime_ready")) violations.push("agent_supervisor_notify_listener_missing");
if (!agentSupervisor.includes("buildAgentRuntimeSupervisorHostConfig")) violations.push("agent_supervisor_host_config_missing");
const agentSupervisorHost = content.get("mcp_gpt_desk/src/agent-runtime-supervisor-host.js");
if (!agentSupervisorHost.includes("DESK_AGENT_WORKER_POOL")) violations.push("agent_supervisor_worker_pool_missing");
if (!agentSupervisorHost.includes("DESK_AGENT_SUPERVISOR_HOST_PLATFORM")) violations.push("agent_supervisor_host_platform_missing");
const agentSupervisorService = content.get("mcp_gpt_desk/src/agent-runtime-supervisor.js");
if (!agentSupervisorService.includes("RUNNER_NOT_CONFIGURED")) violations.push("agent_supervisor_active_runner_guard_missing");
if (!agentSupervisorService.includes("POOL_CONFIGURATION_REJECTED")) violations.push("agent_supervisor_pool_guard_missing");

const aiMode = content.get("deploy/windows/Set-DeskAiWorkerMode.ps1");
if (!aiMode.includes('Invoke-DeskCommand -FilePath $codex -Arguments @("login", "status")')) {
  violations.push("ai_worker_active_auth_preflight_missing");
}
if (!aiMode.includes("DESK_AI_WORKER_MODE")) violations.push("ai_worker_mode_switch_missing");
const installServices = content.get("deploy/windows/Install-DeskServices.ps1");
if (!installServices.includes("KeepAiWorkersDisabled") || !installServices.includes("StartupType Disabled")) violations.push("frozen_ai_service_disable_missing");
const frozenReleaseCheck = content.get("deploy/windows/Test-DeskV5FrozenRelease.ps1");
for (const service of ["DeskFuturesLiveRuntime", "DeskFuturesReplayPreparation", "DeskFuturesBrokerManagement", "DeskFuturesAgentRuntimeSupervisor", "DeskFuturesCodexLive01", "DeskFuturesCodexLive02", "DeskFuturesCodexReplay01"]) {
  if (!installServices.includes(service)) violations.push(`frozen_service_not_disabled:${service}`);
  if (!frozenReleaseCheck.includes(service)) violations.push(`frozen_service_not_verified:${service}`);
}
if (!install.includes('"telegram_alert_worker"')) violations.push("frozen_expected_services_not_reduced");
const localHealth = content.get("deploy/windows/Test-DeskLocalHealth.ps1");
if (!localHealth.includes("DESK_RUNTIME_PROFILE") || !localHealth.includes("AllowDisabledAiWorkers")) violations.push("frozen_health_profile_missing");
for (const service of ["DeskFuturesAgentRuntimeSupervisor", "DeskFuturesAgentRuntimeResearch"]) {
  if (!localHealth.includes(service)) violations.push(`local_health_service_missing:${service}`);
}
for (const expected of ["DESK_GRAINS_CALENDAR_ENABLED", "grains-calendar.json", "grains_calendar", "degradations"]) {
  if (!localHealth.includes(expected)) violations.push(`grains_calendar_local_health_missing:${expected}`);
}
if (/grainsCalendar[^\n]*failures|failures[^\n]*grainsCalendar/.test(localHealth)) {
  violations.push("grains_calendar_degradation_can_fail_process_health");
}
const frozenOrchestrator = content.get("deploy/windows/Invoke-DeskV5FrozenRelease.ps1");
if (!frozenOrchestrator.includes("DeployFrozen") || !frozenOrchestrator.includes("RollbackFrozen") || !frozenOrchestrator.includes("PrepareJune11")) violations.push("v5_frozen_orchestrator_incomplete");
if (!frozenOrchestrator.includes("-QuiesceFrozenState")) violations.push("v5_frozen_orchestrator_quiesce_missing");
const releaseTest = content.get("deploy/windows/Test-DeskRelease.ps1");
if (!releaseTest.includes("RequireV5Frozen") || !releaseTest.includes("execution-policy-lock-not-v4-3") || !releaseTest.includes("master-lock-not-v5-4") || !releaseTest.includes("monitor-lock-not-v2-4") || !releaseTest.includes("deterministic-compiler-lock-not-v1-4") || !releaseTest.includes("condition-engine-lock-not-v1-2")) violations.push("release_contract_lock_validation_missing");
const deploymentCommon = content.get("deploy/windows/DeskDeployment.Common.ps1");
const frozenProducerServices = [
  "DeskFuturesLiveRuntime",
  "DeskFuturesReplayPreparation",
  "DeskFuturesBrokerManagement",
  "DeskFuturesAgentRuntimeSupervisor",
  "DeskFuturesCodexLive01",
  "DeskFuturesCodexLive02",
  "DeskFuturesCodexReplay01",
];
for (const service of frozenProducerServices) {
  if (!deploymentCommon.includes(service)) violations.push(`frozen_common_service_missing:${service}`);
}
for (const helper of [
  "Get-DeskFrozenProducerServiceNames",
  "Disable-DeskFrozenProducerServices",
  "Assert-DeskFrozenProducerServices",
]) {
  if (!deploymentCommon.includes(`function ${helper}`)) violations.push(`frozen_common_helper_missing:${helper}`);
}

const migrationIndex = update.indexOf("Invoke-DeskSchema.ps1");
for (const requiredBeforeMigration of [
  "Stop-DeskProducerServices",
  "Disable-DeskFrozenProducerServices",
  "quiesce_v5_frozen_state.mjs",
  "verify_v5_frozen_state.mjs",
  "Assert-DeskFrozenProducerServices",
]) {
  const index = update.indexOf(requiredBeforeMigration);
  if (index < 0 || migrationIndex < 0 || index > migrationIndex) {
    violations.push(`frozen_action_not_before_migration:${requiredBeforeMigration}`);
  }
}
if (!update.includes("$QuiesceFrozenState = $true")) {
  violations.push("frozen_target_does_not_force_quiesce");
}
if (!update.includes("-PreserveFrozenServices") || !update.includes("-RestoreServices { Start-DeskServices }")) {
  violations.push("frozen_preinstall_failure_restart_guard_missing");
}
if (/if \(-not \$installAttempted\)\s*\{\s*Start-DeskServices/.test(update)) {
  violations.push("frozen_preinstall_failure_can_restart_services");
}
if (!update.includes("Invoke-DeskUpdateRecovery") || !update.includes("health_verified") || !update.includes("controls_restored")) {
  violations.push("update_resilient_recovery_or_health_gate_missing");
}
if (!/Rollback-Desk\.ps1[\s\S]{0,180}-SkipStart/.test(update)) {
  violations.push("update_rollback_starts_services_inside_rollback_step");
}
if (/catch\s*\{[\s\S]{0,500}Write-Error/.test(update)) {
  violations.push("update_recovery_can_mask_original_error");
}

const databaseCommon = content.get("deploy/windows/database/DeskDatabase.Common.ps1");
for (const expected of [
  'EnvironmentVariables["PGCLIENTENCODING"] = "UTF8"',
  'client_min_messages=warning',
  "RedirectStandardOutput = $true",
  "RedirectStandardError = $true",
  "ReadToEndAsync()",
  "[switch]$PassThru",
]) {
  if (!databaseCommon.includes(expected)) violations.push(`postgres_utf8_process_contract_missing:${expected}`);
}
if (databaseCommon.includes("$Arguments -join")) {
  violations.push("postgres_failure_can_expose_command_arguments");
}
if (!databaseCommon.includes('GetEnvironmentVariable("PGOPTIONS", "Process")') || !databaseCommon.includes('"$pgOptions $warningOption"')) {
  violations.push("postgres_process_does_not_preserve_inherited_pgoptions");
}
const databaseExternalTest = content.get("deploy/windows/database/Test-DeskDatabaseExternal.ps1");
for (const expected of ["application_name=test_sentinel", "client_min_messages=warning", "0x00E9", "Write-Utf8", "complexArgument", "top-secret", "exit code 7"]) {
  if (!databaseExternalTest.includes(expected)) violations.push(`postgres_external_process_test_missing:${expected}`);
}
for (const relative of [
  "deploy/windows/database/Invoke-DeskSchema.ps1",
  "deploy/windows/database/Test-DeskTheoreticalExecutionPortfolioLineage.ps1",
  "deploy/windows/Invoke-DeskDrain.ps1",
]) {
  const postgresCaller = content.get(relative);
  if (/&\s+\$psql\b/.test(postgresCaller)) violations.push(`direct_psql_native_invocation:${relative}`);
  if (!postgresCaller.includes("Invoke-DeskExternal") || !postgresCaller.includes("ON_ERROR_STOP=1")) {
    violations.push(`postgres_caller_not_fail_closed:${relative}`);
  }
}

const recoveryTest = content.get("deploy/windows/Test-DeskUpdateRecovery.ps1");
for (const scenario of ["deploy-sql", "pre-drain backup failure", "deploy-drain", "deploy-canary", "deploy-rollback", "deploy-start", "deploy-resume", "deploy-frozen"]) {
  if (!recoveryTest.includes(scenario)) violations.push(`update_recovery_failure_scenario_missing:${scenario}`);
}
if (!recoveryTest.includes('"audit,start,health,resume"') || !recoveryTest.includes('"audit,rollback,start,health,resume"')) {
  violations.push("update_recovery_order_assertions_missing");
}
if (process.platform === "win32") {
  const powerShell = resolve(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
  for (const relative of ["deploy/windows/Test-DeskUpdateRecovery.ps1", "deploy/windows/Test-DeskGrainsCalendarHealth.ps1", "deploy/windows/database/Test-DeskDatabaseExternal.ps1"]) {
    const result = spawnSync(powerShell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", resolve(root, relative)], {
      cwd: root,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      const detail = String(result.stderr || result.stdout || result.error?.message || "unknown error").trim();
      violations.push(`windows_powershell_test_failed:${relative}:${detail}`);
    }
  }
}

const skipTestsIndex = buildRelease.indexOf("if (-not $SkipTests)");
const dirtyCheckIndex = buildRelease.indexOf('"status", "--porcelain"');
for (const mandatoryBuildGuard of [
  '"--prefix", "packages/desk-contracts", "run", "generate"',
  '"--prefix", "packages/desk-contracts", "run", "check:generated"',
  '"run", "guard:strategy-contracts"',
]) {
  const index = buildRelease.indexOf(mandatoryBuildGuard);
  if (index < 0 || index > skipTestsIndex || index > dirtyCheckIndex) {
    violations.push(`mandatory_build_integrity_guard_missing_or_late:${mandatoryBuildGuard}`);
  }
}

for (const releaseIntegrityToken of [
  "verify_release_contract_integrity.mjs",
  "codegen\\check-generated.mjs",
  "codegen\\check-strategy-v5.mjs",
]) {
  if (!releaseTest.includes(releaseIntegrityToken)) {
    violations.push(`release_intrinsic_integrity_missing:${releaseIntegrityToken}`);
  }
}
const releaseIntegrity = content.get("mcp_gpt_desk/scripts/verify_release_contract_integrity.mjs");
for (const expected of [
  "release_manifest.strategy_contract_lock:differs-from-packaged-lock",
  "release_manifest.execution_policy_lock:differs-from-packaged-lock",
  "schema_sha256",
  "companion_schemas",
  "executionLock.compiler",
  "artifact_sha256",
  "registry[bucketName]",
]) {
  if (!releaseIntegrity.includes(expected)) violations.push(`release_contract_verifier_missing:${expected}`);
}

for (const importStageToken of [
  '"ImportJune11R2"',
  "June11R2PackagePath",
  "DRY_RUN_VALIDATED",
  "ALREADY_IMPORTED",
  "verify_v5_june11_r2_import.mjs",
  "Assert-DeskFrozenProducerServices",
  "0fd35d23ff12a8e3bdc84781266458350b02a55bf00a7d5eb8e924846c13e054",
  "No replay was prepared or started",
]) {
  if (!frozenOrchestrator.includes(importStageToken)) {
    violations.push(`june11_r2_import_stage_missing:${importStageToken}`);
  }
}
if (!frozenOrchestrator.includes("-PrepareJune11AfterDeploy is forbidden")) {
  violations.push("implicit_june11_preparation_not_forbidden");
}
const deployStageIndex = frozenOrchestrator.indexOf('if ($Stage -eq "DeployFrozen")');
const importStageIndex = frozenOrchestrator.indexOf('if ($Stage -eq "ImportJune11R2")');
const prepareStageIndex = frozenOrchestrator.indexOf('if ($Stage -eq "PrepareJune11")');
if (!(deployStageIndex >= 0 && importStageIndex > deployStageIndex && prepareStageIndex > importStageIndex)) {
  violations.push("june11_r2_stage_order_invalid");
}
const importVerifier = content.get("mcp_gpt_desk/scripts/verify_v5_june11_r2_import.mjs");
for (const expected of ["verifyV5June11R2Import", "V5_JUNE11_R2_IMPORT_VERIFIED", "total_m1_rows"]) {
  if (!importVerifier.includes(expected)) violations.push(`june11_r2_import_verifier_missing:${expected}`);
}

const verifier = content.get("mcp_gpt_desk/scripts/verify_v5_frozen_state.mjs");
for (const expected of ["DeskMasterAnalysisContract_v5_4_0", "DeskHourlyThesisMonitorContract_v2_4_0", "DeskDeterministicExecutionPolicy_v4_3_0", "packaged_schema_hash", "--require-broker-lock", "ENGINE_V5_VALIDATION_HOLD"]) {
  if (!verifier.includes(expected)) violations.push(`v5_verifier_missing:${expected}`);
}
const frozenPreparation = content.get("mcp_gpt_desk/scripts/prepare_v5_frozen_replay.mjs");
if (!frozenPreparation.includes('const TRADING_DATE = "2026-06-11"') || !frozenPreparation.includes('status: "PAUSED"')) violations.push("june11_v5_frozen_config_missing");
if (!frozenPreparation.includes("enabled: false") || frozenPreparation.includes("publishReplayPreparation")) violations.push("june11_preparation_can_start_run");
for (const expected of ["verifyV5June11R2Import", "assertV5June11R2PackEvidence", "source_evidence", "desk_v5_frozen_prepare_receipt_v1"]) {
  if (!frozenPreparation.includes(expected)) violations.push(`june11_r2_preparation_missing:${expected}`);
}
const r2Evidence = content.get("mcp_gpt_desk/src/v5-june11-r2-evidence.js");
for (const expected of [
  "tv_m1_backfill__0fd35d23ff12a8e3bdc84781266458350b02a55b",
  "0fd35d23ff12a8e3bdc84781266458350b02a55bf00a7d5eb8e924846c13e054",
  "0af3a904dc924e558c775292a5d7b4b1d0766ae22bb341cc8d8c6144937d507c",
  "settled_closed_bar_v2",
]) {
  if (!r2Evidence.includes(expected)) violations.push(`june11_r2_evidence_missing:${expected}`);
}
const contractSeed = content.get("mcp_gpt_desk/scripts/seed_contracts.mjs");
for (const expected of ['contractSpec("DeskMasterAnalysisContract", "5.4.0"', 'contractSpec("DeskHourlyThesisMonitorContract", "2.4.0"', 'contractSpec("DeskDeterministicExecutionPolicy", "4.3.0"']) {
  if (!contractSeed.includes(expected)) violations.push(`v5_seed_missing:${expected}`);
}
const sim101 = content.get("deploy/windows/Prepare-DeskSim101.ps1");
const riskGuard = content.get("infra/postgres/init/019_strategy_v5_risk_guard.sql");
const roundingRiskGuard = content.get("infra/postgres/init/020_broker_rounding_risk_policy.sql");
const decisionFreshnessGuard = content.get("infra/postgres/init/021_broker_decision_freshness_policy.sql");
if (!sim101.includes("min_reward_risk = 2") || !riskGuard.includes("CHECK (min_reward_risk >= 2)")) violations.push("minimum_rr_two_guard_missing");
if (!roundingRiskGuard.includes("max_rounding_excess_pct") || !roundingRiskGuard.includes("BETWEEN 0 AND 0.25")) violations.push("rounding_excess_policy_guard_missing");
if (!decisionFreshnessGuard.includes("max_decision_age_seconds") || !decisionFreshnessGuard.includes("BETWEEN 5 AND 3600")) violations.push("broker_decision_freshness_policy_guard_missing");

if (violations.length) {
  console.error(`[windows-deployment-kit] ok=false violations=${violations.length}`);
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}
console.log(`[windows-deployment-kit] ok=true files=${required.length} env_tokens=${new Set(envTokens).size}`);
